import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { loadHadesAttendanceClient } from "@/lib/guardian/attendance";
import {
  fetchContractPdfDataUrl,
  hasContractIntent,
} from "@/lib/guardian/contract-reader";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

// ATHENA — assistente do OPERADOR de cobranca (Hades). Diferente da CACA (que e
// o agente de atendimento que fala com o cliente). A Athena ajuda o operador a:
// redigir mensagens, consultar o contexto do cliente (parcelas/saldo/tickets/
// conversa) e ajustar o tom. NUNCA envia sozinha — devolve um rascunho.

const DEFAULT_MODEL = "gpt-5.5";
const ATHENA_ACTIONS = new Set([
  "ajustar_tom",
  "boletos",
  "livre",
  "resumir",
  "total",
]);

type AthenaAction =
  | "ajustar_tom"
  | "boletos"
  | "livre"
  | "resumir"
  | "total";

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
    "operator",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Payload invalido para a Athena." },
      { status: 400 },
    );
  }

  const ticketId = readString(payload.ticketId);
  if (!ticketId) {
    return NextResponse.json(
      { error: "ticketId e obrigatorio para a Athena." },
      { status: 400 },
    );
  }

  const action = normalizeAction(payload.action);
  const prompt = readString(payload.prompt) ?? "";
  const draft = readString(payload.draft) ?? "";
  const contextMessage = readString(payload.contextMessage) ?? "";

  try {
    const context = await loadAthenaContext(authorization.client, ticketId);
    const wantsContract = hasContractIntent([prompt, contextMessage].join(" "));

    // Pediu algo do contrato mas o cliente NAO tem contrato assinado: avisa o
    // operador de forma clara (em vez de uma resposta generica).
    if (wantsContract && !context.contractDocumentId) {
      return NextResponse.json({
        action,
        model: null,
        replyText: `${firstName(context.clientName)} não tem contrato assinado disponível no D4Sign, então não consigo consultar o contrato. Posso ajudar com saldo, parcelas e a negociação.`,
        source: "fallback",
      });
    }

    // Pediu do contrato e ha contrato assinado: baixa o PDF da D4Sign pra Athena
    // responder fundamentada no documento.
    const contractPdf =
      wantsContract && context.contractDocumentId
        ? await fetchContractPdfDataUrl(context.contractDocumentId)
        : null;

    if (wantsContract && context.contractDocumentId && !contractPdf) {
      return NextResponse.json({
        action,
        model: null,
        replyText:
          "Não consegui acessar o contrato assinado deste cliente agora. Tente novamente em instantes.",
        source: "fallback",
      });
    }

    const reply = await requestAthenaReply({
      action,
      context,
      contextMessage,
      contractPdf,
      draft,
      prompt,
    });

    return NextResponse.json({
      action,
      model: reply
        ? process.env.HUB_IRIS_ATTENDANT_MODEL?.trim() ||
          process.env.HUB_AI_MODEL?.trim() ||
          DEFAULT_MODEL
        : null,
      replyText: reply ?? buildFallback({ action, context, draft, prompt }),
      source: reply ? "openai" : "fallback",
    });
  } catch (error) {
    console.error("[iris-athena] falha no assistente", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel acionar a Athena agora.",
      },
      { status: 500 },
    );
  }
}

type AthenaContext = {
  clientName: string;
  contractDocumentId: string | null;
  empreendimentos: string;
  messages: string;
  overdueLines: string;
  overdueWithLinkCount: number;
  protocol: string;
  saldo: string;
  ticketsCount: number;
  vencidas: number;
};

async function loadAthenaContext(
  client: SupabaseClient,
  ticketId: string,
): Promise<AthenaContext> {
  const { data: ticket } = await client
    .from("caredesk_tickets")
    .select("id,protocol,contact_id,metadata,source_context")
    .eq("id", ticketId)
    .maybeSingle<{
      contact_id?: string | null;
      id: string;
      metadata?: Record<string, unknown> | null;
      protocol?: string | null;
      source_context?: Record<string, unknown> | null;
    }>();

  const protocol = ticket?.protocol ?? "Nao informado";
  const cobrancaClientId =
    readCobrancaClientId(ticket?.metadata) ??
    readCobrancaClientId(ticket?.source_context);

  const [messagesResult, ticketsCount] = await Promise.all([
    client
      .from("caredesk_messages")
      .select("body,direction,created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true })
      .limit(40),
    ticket?.contact_id
      ? client
          .from("caredesk_tickets")
          .select("id", { count: "exact", head: true })
          .eq("contact_id", ticket.contact_id)
      : Promise.resolve({ count: 0 }),
  ]);

  const messages = (messagesResult.data ?? [])
    .slice(-16)
    .map((row) => {
      const who = row.direction === "inbound" ? "Cliente" : "Operador";
      const body = typeof row.body === "string" ? row.body.trim() : "";
      return body ? `${who}: ${body}` : null;
    })
    .filter(Boolean)
    .join("\n");

  let clientName = "Cliente";
  let saldo = "-";
  let vencidas = 0;
  let overdueLines = "Sem parcelas vencidas carregadas.";
  let overdueWithLinkCount = 0;
  let empreendimentos = "-";
  let contractDocumentId: string | null = null;

  if (cobrancaClientId) {
    try {
      const hadesClient = await loadHadesAttendanceClient(cobrancaClientId);
      if (hadesClient) {
        clientName = hadesClient.nome ?? clientName;
        saldo = hadesClient.saldoDevedor ?? saldo;
        vencidas = hadesClient.parcelas?.vencidas ?? 0;
        empreendimentos =
          hadesClient.carteira?.empreendimento ?? empreendimentos;
        contractDocumentId =
          (hadesClient.carteira?.unidades ?? [])
            .map((unit) => unit.signedContractDocumentId?.trim())
            .find((id) => id) ?? null;
        const overdue = (hadesClient.c2xInstallments ?? []).filter(
          (item) => item.status === "Vencida",
        );
        overdueWithLinkCount = overdue.filter(
          (item) => item.invoiceUrl ?? item.paymentUrl,
        ).length;
        overdueLines =
          overdue
            .slice(0, 20)
            .map((item) => {
              const link = item.invoiceUrl ?? item.paymentUrl ?? "";
              return `- ${item.unitCode ? `${item.unitCode} · ` : ""}${item.number} (${item.reference}) ${item.value}${
                link ? ` · boleto: ${link}` : " · sem link"
              }`;
            })
            .join("\n") || overdueLines;
      }
    } catch {
      // contexto financeiro best-effort.
    }
  }

  return {
    clientName,
    contractDocumentId,
    empreendimentos,
    messages: messages || "Sem mensagens registradas.",
    overdueLines,
    overdueWithLinkCount,
    protocol,
    saldo,
    ticketsCount:
      typeof (ticketsCount as { count?: number | null }).count === "number"
        ? ((ticketsCount as { count?: number | null }).count ?? 0)
        : 0,
    vencidas,
  };
}

function actionInstruction(action: AthenaAction, draft: string, prompt: string) {
  switch (action) {
    case "boletos":
      return "Monte uma mensagem cordial para enviar ao cliente com os links dos boletos das parcelas vencidas listadas no contexto (use apenas os que tem link). Se nenhum tiver link, avise que os boletos serao providenciados.";
    case "total":
      return "Monte uma mensagem para o cliente informando o total em aberto (saldo devedor) e a quantidade de parcelas vencidas, com tom respeitoso e convidando a negociar.";
    case "resumir":
      return "Resuma para o operador, em topicos curtos, o andamento da conversa e o status da cobranca deste cliente.";
    case "ajustar_tom":
      return `Reescreva o rascunho do operador a seguir mantendo o sentido, com tom inteligente e confiante, em portugues do Brasil. Rascunho: """${draft || prompt}"""`;
    default:
      return `Atenda o pedido do operador: """${prompt}""". Se for redigir mensagem para o cliente, entregue o texto pronto; se for uma pergunta sobre o cliente, responda com base no contexto.`;
  }
}

async function requestAthenaReply({
  action,
  context,
  contextMessage,
  contractPdf,
  draft,
  prompt,
}: {
  action: AthenaAction;
  context: AthenaContext;
  contextMessage: string;
  contractPdf: string | null;
  draft: string;
  prompt: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  const model =
    process.env.HUB_IRIS_ATTENDANT_MODEL?.trim() ||
    process.env.HUB_AI_MODEL?.trim() ||
    DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    contractPdf ? 35_000 : 14_000,
  );

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: [
              {
                text: [
                  `Pedido do operador: ${actionInstruction(action, draft, prompt)}`,
                  contextMessage
                    ? `\nMensagem do cliente em foco (responder/considerar esta): """${contextMessage}"""`
                    : "",
                  contractPdf
                    ? "\nO contrato assinado do cliente esta anexado (PDF). Use-o para responder duvidas sobre o contrato, citando o que o documento diz. Nao invente clausulas."
                    : "",
                  "",
                  "Contexto do cliente:",
                  `- Nome: ${context.clientName}`,
                  `- Empreendimento: ${context.empreendimentos}`,
                  `- Saldo devedor: ${context.saldo}`,
                  `- Parcelas vencidas: ${context.vencidas}`,
                  `- Atendimentos deste cliente: ${context.ticketsCount}`,
                  `- Protocolo atual: ${context.protocol}`,
                  "",
                  "Parcelas vencidas:",
                  context.overdueLines,
                  "",
                  "Conversa recente:",
                  context.messages,
                ].join("\n"),
                type: "input_text",
              },
              ...(contractPdf
                ? [
                    {
                      file_data: contractPdf,
                      filename: "contrato.pdf",
                      type: "input_file",
                    },
                  ]
                : []),
            ],
            role: "user",
          },
        ],
        instructions:
          "Voce e a Athena, a assistente do OPERADOR de cobranca da Careli (Hades). Ajude o operador a redigir mensagens, responder duvidas sobre o cliente consultando o contexto fornecido, e ajustar o tom. Voce NUNCA envia mensagens sozinha — sempre entrega um rascunho para o operador revisar. Responda em portugues do Brasil, claro e direto. Quando redigir mensagem para o cliente, entregue apenas o texto da mensagem, sem rotulos. Nao invente dados que nao estejam no contexto.",
        max_output_tokens: 900,
        model,
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    return extractOpenAiText(data) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildFallback({
  action,
  context,
  draft,
  prompt,
}: {
  action: AthenaAction;
  context: AthenaContext;
  draft: string;
  prompt: string;
}) {
  if (action === "total") {
    return `Olá ${firstName(context.clientName)}, tudo bem? Identificamos um saldo em aberto de ${context.saldo} referente a ${context.vencidas} parcela(s) vencida(s). Podemos resolver isso da forma que for melhor pra você — como prefere seguir?`;
  }
  if (action === "boletos") {
    return context.overdueWithLinkCount > 0
      ? `Olá ${firstName(context.clientName)}, segue(m) o(s) link(s) do(s) boleto(s) das parcelas em aberto:\n${context.overdueLines}`
      : "No momento não há boletos com link disponível para este cliente.";
  }
  if (action === "resumir") {
    return `Cliente: ${context.clientName}. Saldo em aberto ${context.saldo} (${context.vencidas} vencidas). Atendimentos: ${context.ticketsCount}.\nÚltimas mensagens:\n${context.messages}`;
  }
  if (action === "ajustar_tom") {
    return draft || prompt || "Sem texto para ajustar.";
  }
  return "A Athena está sem o modelo de IA configurado no momento. Configure a chave para respostas geradas.";
}

function readCobrancaClientId(value: Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const cobranca = (value as Record<string, unknown>).cobranca;
  if (cobranca && typeof cobranca === "object" && !Array.isArray(cobranca)) {
    const clientId = (cobranca as Record<string, unknown>).clientId;
    if (typeof clientId === "string" && clientId.trim()) {
      return clientId.trim();
    }
  }
  return null;
}

function extractOpenAiText(data: Record<string, unknown>) {
  const directText = readString(data.output_text);
  if (directText) {
    return directText;
  }
  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const text = readString((part as Record<string, unknown>).text);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

function normalizeAction(value: unknown): AthenaAction {
  const normalized = typeof value === "string" ? value.trim() : "";
  return ATHENA_ACTIONS.has(normalized) ? (normalized as AthenaAction) : "livre";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
