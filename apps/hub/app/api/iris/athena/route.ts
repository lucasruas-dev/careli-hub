import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getAnthropicClient, resolveClaudeModel } from "@/lib/ai/claude";
import { runClaudeAgent, type ClaudeAgentTool } from "@/lib/ai/claude-agent";
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
      supabase: authorization.client,
    });

    return NextResponse.json({
      action,
      model: reply ? resolveClaudeModel("heavy") : null,
      replyText: reply ?? buildFallback({ action, context, draft, prompt }),
      source: reply ? "claude" : "fallback",
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
  cobrancaClientId: string | null;
  contactId: string | null;
  contractDocumentId: string | null;
  empreendimentos: string;
  hasCarteira: boolean;
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
  let hasCarteira = false;

  if (cobrancaClientId) {
    try {
      const hadesClient = await loadHadesAttendanceClient(cobrancaClientId);
      if (hadesClient) {
        hasCarteira = true;
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
    cobrancaClientId,
    contactId: ticket?.contact_id ?? null,
    contractDocumentId,
    empreendimentos,
    hasCarteira,
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

const ATHENA_SYSTEM_PROMPT = [
  "Voce e a Athena, copiloto INTERNO do OPERADOR da Careli no cockpit de atendimento (Iris/Hades). Voce fala com o OPERADOR, nunca com o cliente.",
  "Voce e um agente INVESTIGATIVO: BUSQUE VOCE MESMA os dados no hub com as ferramentas antes de pedir qualquer coisa ao operador. Nunca responda 'me passe o historico' se existe ferramenta para isso — chame a ferramenta.",
  "Entenda o PERFIL do cliente antes de responder: comprador (tem carteira/parcelas), imobiliaria, colaborador, fornecedor ou prospect. Imobiliaria/colaborador/fornecedor/prospect NAO tem parcelas — nunca invente cobranca pra eles nem peca parcelas que nao existem.",
  "Leia o historico e o TOM das conversas: se o cliente esta irritado, se e inadimplente, o teor dos ultimos atendimentos — e calibre a resposta por isso.",
  "Missao: redigir mensagens pro cliente, resumir o cliente/atendimentos, responder duvidas com base nos dados REAIS que voce buscar, e ajustar o tom de rascunhos.",
  "Voce NUNCA envia nada sozinha — sempre entrega rascunho/resposta pro operador revisar.",
  "Tom: portugues do Brasil, profissional, cordial e firme, direto. Ao redigir mensagem pro cliente, entregue APENAS o texto pronto, sem rotulos/aspas. Assine como equipe Careli (nunca 'equipe do empreendimento' nem o nome do loteamento).",
  "Nao invente dados, valores, parcelas ou clausulas. Se uma ferramenta nao trouxer o dado, diga com franqueza o que falta.",
  "Se houver contrato (PDF) anexado, use-o citando o que o documento diz, sem extrapolar.",
].join("\n");

function buildAthenaSystemPrompt(context: AthenaContext): string {
  const perfilLinha = context.hasCarteira
    ? `- Perfil: COMPRADOR com carteira. Situacao: saldo ${context.saldo}, ${context.vencidas} parcela(s) vencida(s)${
        context.empreendimentos !== "-"
          ? `, empreendimento ${context.empreendimentos}`
          : ""
      }.`
    : "- Perfil: SEM carteira de compra (provavelmente imobiliaria, colaborador, fornecedor ou prospect). NAO cobre parcelas nem invente saldo — trate pelo perfil real e pelos atendimentos.";

  return [
    ATHENA_SYSTEM_PROMPT,
    "",
    "CONTEXTO-BASE deste atendimento (ja carregado — use antes de acionar ferramentas para o basico):",
    `- Cliente: ${context.clientName}`,
    `- Protocolo atual: ${context.protocol}`,
    perfilLinha,
    `- Total de atendimentos deste cliente: ${context.ticketsCount}.`,
    "",
    "Conversa recente:",
    context.messages,
    "",
    "FERRAMENTAS: 'tickets_do_cliente' (historico com assunto/status/data) e 'situacao_de_cobranca' (parcelas/boletos/saldo — so para comprador). Use-as para responder com dados reais em vez de pedir ao operador.",
  ].join("\n");
}

function buildAthenaTools({
  context,
  supabase,
}: {
  context: AthenaContext;
  supabase: SupabaseClient;
}): ClaudeAgentTool[] {
  return [
    {
      definition: {
        description:
          "Lista os atendimentos (tickets) deste cliente: protocolo, assunto, status e data. Use para resumir o historico ou entender atendimentos abertos/duplicados.",
        input_schema: { properties: {}, type: "object" },
        name: "tickets_do_cliente",
      },
      run: async () => {
        if (!context.contactId) {
          return "Contato nao identificado — nao consigo listar os tickets.";
        }
        const { data } = await supabase
          .from("caredesk_tickets")
          .select("protocol,subject,status,opened_at")
          .eq("contact_id", context.contactId)
          .order("opened_at", { ascending: false })
          .limit(25);
        const rows = (data ?? []) as {
          opened_at?: string | null;
          protocol?: string | null;
          status?: string | null;
          subject?: string | null;
        }[];
        if (!rows.length) {
          return "Nenhum ticket encontrado para este cliente.";
        }
        return rows
          .map(
            (row) =>
              `- ${row.protocol ?? "?"} · ${row.subject?.trim() || "sem assunto"} · status: ${row.status ?? "?"} · ${row.opened_at ?? "?"}`,
          )
          .join("\n");
      },
    },
    {
      definition: {
        description:
          "Detalha a cobranca do cliente comprador: saldo devedor, parcelas vencidas (numero, referencia, valor, link do boleto) e empreendimento. So use para cliente com carteira de compra.",
        input_schema: { properties: {}, type: "object" },
        name: "situacao_de_cobranca",
      },
      run: async () => {
        if (!context.cobrancaClientId) {
          return "Este cliente nao tem carteira de compra vinculada (imobiliaria, colaborador, fornecedor ou prospect). Nao ha parcelas nem saldo para cobrar.";
        }
        try {
          const hades = await loadHadesAttendanceClient(
            context.cobrancaClientId,
          );
          if (!hades) {
            return "Nao encontrei carteira de cobranca para este cliente.";
          }
          const overdue = (hades.c2xInstallments ?? []).filter(
            (item) => item.status === "Vencida",
          );
          const lines = overdue.slice(0, 30).map((item) => {
            const link = item.invoiceUrl ?? item.paymentUrl ?? "";
            return `- ${item.unitCode ? `${item.unitCode} · ` : ""}${item.number} (${item.reference}) ${item.value}${
              link ? ` · boleto: ${link}` : " · sem link"
            }`;
          });
          return [
            `Cliente: ${hades.nome ?? context.clientName}`,
            `Saldo devedor: ${hades.saldoDevedor ?? "-"}`,
            `Parcelas vencidas: ${hades.parcelas?.vencidas ?? 0}`,
            `Empreendimento: ${hades.carteira?.empreendimento ?? "-"}`,
            overdue.length
              ? `Parcelas vencidas:\n${lines.join("\n")}`
              : "Sem parcelas vencidas.",
          ].join("\n");
        } catch {
          return "Falha ao carregar a cobranca agora.";
        }
      },
    },
  ];
}

function extractPdfBase64(dataUrl: string | null): string | null {
  if (!dataUrl) return null;
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return base64.trim() || null;
}

async function requestAthenaReply({
  action,
  context,
  contextMessage,
  contractPdf,
  draft,
  prompt,
  supabase,
}: {
  action: AthenaAction;
  context: AthenaContext;
  contextMessage: string;
  contractPdf: string | null;
  draft: string;
  prompt: string;
  supabase: SupabaseClient;
}) {
  const anthropic = getAnthropicClient();
  if (!anthropic) {
    return null;
  }

  const userText = [
    `Pedido do operador: ${actionInstruction(action, draft, prompt)}`,
    contextMessage
      ? `\nMensagem do cliente em foco (responder/considerar esta): """${contextMessage}"""`
      : "",
    contractPdf
      ? "\nO contrato assinado do cliente esta anexado (PDF). Cite o que o documento diz, sem inventar clausulas."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const content: Anthropic.ContentBlockParam[] = [
    { text: userText, type: "text" },
  ];
  const pdfBase64 = extractPdfBase64(contractPdf);
  if (pdfBase64) {
    content.unshift({
      source: {
        data: pdfBase64,
        media_type: "application/pdf",
        type: "base64",
      },
      type: "document",
    });
  }

  try {
    const result = await runClaudeAgent({
      client: anthropic,
      effort: "high",
      maxTokens: 900,
      maxToolIterations: 5,
      messages: [{ content, role: "user" }],
      model: resolveClaudeModel("heavy"),
      system: buildAthenaSystemPrompt(context),
      thinking: true,
      tools: buildAthenaTools({ context, supabase }),
    });
    return result.text.trim() || null;
  } catch (error) {
    console.error("[iris-athena] Claude agent failed", error);
    return null;
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
