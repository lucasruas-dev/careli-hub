import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { prepareBoletoResendAction } from "@/lib/guardian/asaas";
import { loadHadesAttendanceClient } from "@/lib/guardian/attendance";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

const DEFAULT_MODEL = "gpt-5.5";

type IrisAttendantAction = "analyze" | "select_boleto";
type DocumentFragmentPosition = "first4" | "last4";

type AttendantTicketRow = {
  channel_id?: string | null;
  contact_id?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  opened_at?: string | null;
  priority?: string | null;
  profile_id?: string | null;
  protocol?: string | null;
  queue_id?: string | null;
  source_context?: Record<string, unknown> | null;
  source_module?: string | null;
  status?: string | null;
  subject?: string | null;
};

type AttendantContactRow = {
  c2x_payload?: Record<string, unknown> | null;
  display_name?: string | null;
  document?: string | null;
  email?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  phone?: string | null;
  whatsapp_phone?: string | null;
};

type AttendantMessageRow = {
  body?: string | null;
  created_at?: string | null;
  direction?: string | null;
  id: string;
  message_type?: string | null;
  sender_type?: string | null;
};

type BillingItem = {
  acquisitionRequestId: string;
  dueDate: string;
  id: string;
  number: string;
  overdueDays: number;
  reference: string;
  status: "Vencida" | "A vencer" | "Liquidada";
  unitCode?: string;
  unitLabel?: string;
  value: string;
};

type AttendantContext = {
  billingError?: string | null;
  billingItems: BillingItem[];
  c2xClientId: string | null;
  contact: AttendantContactRow | null;
  contactDocument: string | null;
  latestInboundMessage: string;
  messages: AttendantMessageRow[];
  ticket: AttendantTicketRow;
};

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
      { error: "Payload invalido para a Cacá." },
      { status: 400 },
    );
  }

  const ticketId = readString(payload.ticketId);

  if (!ticketId) {
    return NextResponse.json(
      { error: "ticketId e obrigatorio para a Cacá." },
      { status: 400 },
    );
  }

  const action = normalizeAction(payload.action);
  const documentFragment = normalizeDigits(readString(payload.documentFragment));
  const documentFragmentPosition = normalizeDocumentFragmentPosition(
    readString(payload.documentFragmentPosition),
  );
  const selectedPaymentId = readString(payload.selectedPaymentId);
  const userMessage = readString(payload.message);

  try {
    const context = await loadAttendantContext(authorization.client, ticketId);
    const message = userMessage || context.latestInboundMessage;
    const boletoIntent = hasBoletoIntent(message);
    const authentication = verifyDocumentFragment({
      documentDigits: normalizeDigits(context.contactDocument),
      fragment: documentFragment,
      position: documentFragmentPosition,
      required: boletoIntent || action === "select_boleto",
    });

    const shouldLoadBilling =
      Boolean(context.c2xClientId) &&
      authentication.status === "verified" &&
      (boletoIntent || action === "select_boleto");
    const billing = shouldLoadBilling && context.c2xClientId
      ? await loadBillingItems(context.c2xClientId)
      : { error: null, items: [] as BillingItem[] };
    const billingItems = billing.items;

    const selectedBillingItem = selectedPaymentId
      ? billingItems.find((item) => item.id === selectedPaymentId) ?? null
      : null;

    if (selectedPaymentId && !selectedBillingItem) {
      return NextResponse.json(
        {
          error:
            "Parcela selecionada nao pertence ao contexto autenticado do cliente.",
        },
        { status: 400 },
      );
    }

    const boleto = selectedBillingItem
      ? await prepareBoletoResendAction(selectedBillingItem.id, "link")
      : null;

    const enrichedContext: AttendantContext = {
      ...context,
      billingError: billing.error,
      billingItems,
    };
    const deterministic = buildDeterministicReply({
      action,
      authentication,
      boleto,
      boletoIntent,
      context: enrichedContext,
      message,
      selectedBillingItem,
    });
    const aiReply =
      deterministic.locked || boleto
        ? null
        : await requestOpenAiReply({
            authentication,
            context: enrichedContext,
            deterministicReply: deterministic.replyText,
            message,
          });
    const replyText = aiReply || deterministic.replyText;

    return NextResponse.json({
      action,
      authentication,
      billingItems,
      boleto: boleto
        ? {
            boletoUrl: boleto.boletoUrl,
            deliveryMode: boleto.deliveryMode,
            message: boleto.message,
            paymentId: boleto.paymentId,
            providerAction: boleto.providerAction,
          }
        : null,
      customer: {
        c2xClientKnown: Boolean(context.c2xClientId),
        documentMasked: maskDocument(context.contactDocument),
        label: context.contact?.display_name ?? "Cliente Iris",
        phoneMasked: maskPhone(
          context.contact?.whatsapp_phone ?? context.contact?.phone ?? null,
        ),
      },
      handoff: deterministic.handoff,
      model: aiReply
        ? process.env.HUB_IRIS_ATTENDANT_MODEL?.trim() ||
          process.env.HUB_AI_MODEL?.trim() ||
          DEFAULT_MODEL
        : null,
      nextStep: deterministic.nextStep,
      replyText,
      source: aiReply ? "openai" : "fallback",
      ticket: {
        protocol: context.ticket.protocol ?? null,
        status: context.ticket.status ?? null,
      },
    });
  } catch (error) {
    console.error("[iris-attendant] falha no agente", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel acionar a Cacá agora.",
      },
      { status: 500 },
    );
  }
}

async function loadAttendantContext(client: SupabaseClient, ticketId: string) {
  const { data: ticket, error: ticketError } = await client
    .from("caredesk_tickets")
    .select(
      "id,protocol,status,subject,priority,contact_id,channel_id,queue_id,profile_id,source_module,source_context,metadata,opened_at",
    )
    .eq("id", ticketId)
    .maybeSingle();

  if (ticketError || !ticket) {
    throw new Error("Ticket Iris nao encontrado para atendimento IA.");
  }

  const typedTicket = ticket as AttendantTicketRow;
  const contact = typedTicket.contact_id
    ? await loadContact(client, typedTicket.contact_id)
    : null;
  const messages = await loadMessages(client, typedTicket.id);
  const contactDocument = firstDocument(
    contact?.document,
    contact?.metadata,
    contact?.c2x_payload,
    typedTicket.metadata,
    typedTicket.source_context,
  );

  return {
    billingError: null,
    billingItems: [],
    c2xClientId: extractC2xClientId(contact, typedTicket),
    contact,
    contactDocument,
    latestInboundMessage: latestInbound(messages),
    messages,
    ticket: typedTicket,
  } satisfies AttendantContext;
}

async function loadContact(client: SupabaseClient, contactId: string) {
  const { data: contact, error } = await client
    .from("caredesk_contacts")
    .select(
      "id,display_name,document,email,phone,whatsapp_phone,metadata,c2x_payload",
    )
    .eq("id", contactId)
    .maybeSingle();

  if (error) {
    throw new Error("Nao foi possivel carregar o contato Iris.");
  }

  return (contact as AttendantContactRow | null) ?? null;
}

async function loadMessages(client: SupabaseClient, ticketId: string) {
  const { data: messages, error } = await client
    .from("caredesk_messages")
    .select("id,body,direction,sender_type,message_type,created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })
    .limit(40);

  if (error) {
    throw new Error("Nao foi possivel carregar mensagens do ticket Iris.");
  }

  return (messages ?? []) as AttendantMessageRow[];
}

async function loadBillingItems(c2xClientId: string) {
  try {
    const client = await loadHadesAttendanceClient(c2xClientId);
    const items = (client?.c2xInstallments ?? [])
      .filter((item) => item.status === "Vencida" || item.status === "A vencer")
      .filter((item) => item.paymentUrl || item.invoiceUrl)
      .sort((first, second) => {
        if (first.status !== second.status) {
          return first.status === "Vencida" ? -1 : 1;
        }

        return first.referenceValue - second.referenceValue;
      })
      .slice(0, 12)
      .map((item) => ({
        acquisitionRequestId: item.acquisitionRequestId,
        dueDate: item.dueDate,
        id: item.id,
        number: item.number,
        overdueDays: item.overdueDays,
        reference: item.reference,
        status: item.status,
        unitCode: item.unitCode,
        unitLabel: item.unitLabel,
        value: item.value,
      }));

    return { error: null, items };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Nao foi possivel consultar parcelas no Hades.",
      items: [] as BillingItem[],
    };
  }
}

function buildDeterministicReply({
  action,
  authentication,
  boleto,
  boletoIntent,
  context,
  message,
  selectedBillingItem,
}: {
  action: IrisAttendantAction;
  authentication: ReturnType<typeof verifyDocumentFragment>;
  boleto: Awaited<ReturnType<typeof prepareBoletoResendAction>> | null;
  boletoIntent: boolean;
  context: AttendantContext;
  message: string;
  selectedBillingItem: BillingItem | null;
}) {
  if (action === "select_boleto" && boleto && selectedBillingItem) {
    return {
      handoff: { reason: null, required: false },
      locked: true,
      nextStep: "boleto_ready",
      replyText: [
        "Pronto, localizei o boleto solicitado.",
        "",
        `Parcela: ${selectedBillingItem.number} - ${selectedBillingItem.reference}`,
        `Unidade: ${selectedBillingItem.unitLabel ?? selectedBillingItem.unitCode ?? "Nao informada"}`,
        `Valor: ${selectedBillingItem.value}`,
        `Link do boleto: ${boleto.boletoUrl}`,
        "",
        "Por seguranca, confira os dados antes de concluir o pagamento.",
      ].join("\n"),
    };
  }

  if ((boletoIntent || action === "select_boleto") && authentication.status === "missing_fragment") {
    return {
      handoff: { reason: null, required: false },
      locked: true,
      nextStep: "ask_document_fragment",
      replyText:
        "Claro, eu te ajudo com o boleto. Para confirmar seu cadastro com seguranca, me informe os 4 ultimos digitos do CPF ou CNPJ do titular.",
    };
  }

  if ((boletoIntent || action === "select_boleto") && authentication.status === "failed") {
    return {
      handoff: {
        reason: "Documento informado nao confere com o cadastro do Iris.",
        required: true,
      },
      locked: true,
      nextStep: "handoff",
      replyText:
        "Nao consegui confirmar o CPF/CNPJ com os dados informados. Vou encaminhar para um atendente humano validar seu cadastro com seguranca.",
    };
  }

  if ((boletoIntent || action === "select_boleto") && authentication.status === "unavailable") {
    return {
      handoff: {
        reason: "Contato Iris sem documento legado para autenticacao automatica.",
        required: true,
      },
      locked: true,
      nextStep: "handoff",
      replyText:
        "Consigo te ajudar com o boleto, mas preciso que um atendente confirme seu cadastro porque nao encontrei CPF/CNPJ vinculado ao contato.",
    };
  }

  if ((boletoIntent || action === "select_boleto") && !context.c2xClientId) {
    return {
      handoff: {
        reason: "Contato Iris ainda sem id de cliente C2X para consulta financeira.",
        required: true,
      },
      locked: true,
      nextStep: "handoff",
      replyText:
        "Seu cadastro foi confirmado, mas ainda nao encontrei o vinculo financeiro necessario para listar boletos. Vou encaminhar para um atendente humano consultar pelo C2X.",
    };
  }

  if ((boletoIntent || action === "select_boleto") && context.billingError) {
    return {
      handoff: {
        reason: context.billingError,
        required: true,
      },
      locked: true,
      nextStep: "handoff",
      replyText:
        "Seu cadastro foi confirmado, mas a consulta financeira nao respondeu agora. Vou encaminhar para um atendente humano conferir seus boletos com seguranca.",
    };
  }

  if ((boletoIntent || action === "select_boleto") && context.billingItems.length === 0) {
    return {
      handoff: { reason: null, required: false },
      locked: true,
      nextStep: "general_reply",
      replyText:
        "Conferi seu cadastro e nao encontrei boletos vencidos ou a vencer com link disponivel neste momento.",
    };
  }

  if ((boletoIntent || action === "select_boleto") && context.billingItems.length > 0) {
    const list = context.billingItems
      .slice(0, 6)
      .map((item, index) => {
        const status =
          item.status === "Vencida"
            ? `vencida ha ${item.overdueDays} dia(s)`
            : "a vencer";

        return `${index + 1}. ${item.number} - ${item.reference} - ${item.value} - ${status}`;
      })
      .join("\n");

    return {
      handoff: { reason: null, required: false },
      locked: true,
      nextStep: "choose_boleto",
      replyText: [
        "Cadastro confirmado. Encontrei estes boletos disponiveis:",
        "",
        list,
        "",
        "Me diga qual parcela voce quer receber.",
      ].join("\n"),
    };
  }

  return {
    handoff: { reason: null, required: false },
    locked: false,
    nextStep: "general_reply",
    replyText:
      message.trim() ||
      "Ola, eu sou a assistente da Iris. Vou organizar seu atendimento e, se necessario, encaminhar para um atendente humano.",
  };
}

async function requestOpenAiReply({
  authentication,
  context,
  deterministicReply,
  message,
}: {
  authentication: ReturnType<typeof verifyDocumentFragment>;
  context: AttendantContext;
  deterministicReply: string;
  message: string;
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
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: [
              {
                text: [
                  `Mensagem do cliente: ${message || "Nao informada."}`,
                  `Protocolo: ${context.ticket.protocol ?? "Nao informado"}`,
                  `Cliente: ${context.contact?.display_name ?? "Nao identificado"}`,
                  `Autenticacao: ${authentication.status}`,
                  `Resposta operacional base: ${deterministicReply}`,
                ].join("\n"),
                type: "input_text",
              },
            ],
            role: "user",
          },
        ],
        instructions:
          "Voce e a Cacá, agente exclusiva de atendimento ao cliente da Careli dentro da Iris. Responda em portugues do Brasil, com tom educado, breve, prestativo e operacional. Nao atue como agente de bordo do operador; esse papel pertence a Athena. Nao invente dados, nao prometa envio automatico se nao houver confirmacao no contexto, nao solicite documentos completos e encaminhe para humano quando houver risco ou falta de dado.",
        max_output_tokens: 700,
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
    const text = extractOpenAiText(data);

    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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

function verifyDocumentFragment({
  documentDigits,
  fragment,
  position,
  required,
}: {
  documentDigits: string;
  fragment: string;
  position: DocumentFragmentPosition;
  required: boolean;
}) {
  if (!required) {
    return {
      label: "Autenticacao nao exigida para esta resposta.",
      status: "not_required" as const,
    };
  }

  if (!documentDigits || documentDigits.length < 4) {
    return {
      label: "Documento ausente no cadastro.",
      status: "unavailable" as const,
    };
  }

  if (!fragment || fragment.length < 4) {
    return {
      label: "Informe 4 digitos do CPF/CNPJ.",
      status: "missing_fragment" as const,
    };
  }

  const expected =
    position === "first4"
      ? documentDigits.slice(0, 4)
      : documentDigits.slice(-4);

  if (fragment.slice(0, 4) === expected) {
    return {
      label: "Documento confirmado.",
      status: "verified" as const,
    };
  }

  return {
    label: "Documento nao confere.",
    status: "failed" as const,
  };
}

function latestInbound(messages: AttendantMessageRow[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.direction === "inbound" && message.body?.trim()) {
      return message.body.trim();
    }
  }

  return "";
}

function hasBoletoIntent(value: string) {
  return /\b(boleto|segunda via|2a via|parcela|fatura|vencid|a vencer|pagamento|pix|linha digitavel)\b/i.test(
    value,
  );
}

function extractC2xClientId(
  contact: AttendantContactRow | null,
  ticket: AttendantTicketRow,
) {
  return (
    findLegacyId(contact?.c2x_payload, true) ||
    findLegacyId(contact?.metadata, false) ||
    findLegacyId(ticket.metadata, false) ||
    findLegacyId(ticket.source_context, false)
  );
}

function findLegacyId(
  source: Record<string, unknown> | null | undefined,
  allowGenericId: boolean,
): string | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const keys = [
    "c2xClientId",
    "c2x_client_id",
    "clientC2xId",
    "client_c2x_id",
    "legacyClientId",
    "legacy_client_id",
    "legacyUserId",
    "legacy_user_id",
    "c2xUserId",
    "c2x_user_id",
    "clientId",
    "client_id",
    "userId",
    "user_id",
    ...(allowGenericId ? ["id"] : []),
  ];

  for (const key of keys) {
    const value = legacyIdValue(source[key]);

    if (value) {
      return value;
    }
  }

  for (const value of Object.values(source)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const nested: string | null = findLegacyId(
      value as Record<string, unknown>,
      false,
    );

    if (nested) {
      return nested;
    }
  }

  return null;
}

function legacyIdValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return /^\d+$/.test(normalized) ? normalized : null;
}

function firstDocument(...sources: unknown[]) {
  for (const source of sources) {
    if (typeof source === "string") {
      const normalized = normalizeDigits(source);

      if (normalized.length >= 11) {
        return source;
      }
    }

    if (!source || typeof source !== "object" || Array.isArray(source)) {
      continue;
    }

    const record = source as Record<string, unknown>;

    for (const key of [
      "document",
      "documento",
      "cpf",
      "cnpj",
      "taxId",
      "tax_id",
      "contactDocument",
      "contact_document",
    ]) {
      const value = readString(record[key]);

      if (normalizeDigits(value).length >= 11) {
        return value;
      }
    }
  }

  return null;
}

function normalizeAction(value: unknown): IrisAttendantAction {
  return value === "select_boleto" ? "select_boleto" : "analyze";
}

function normalizeDocumentFragmentPosition(
  value: string | null,
): DocumentFragmentPosition {
  return value === "first4" ? "first4" : "last4";
}

function normalizeDigits(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function maskDocument(value: string | null | undefined) {
  const digits = normalizeDigits(value);

  if (digits.length <= 4) {
    return digits || null;
  }

  return `${"*".repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
}

function maskPhone(value: string | null | undefined) {
  const digits = normalizeDigits(value);

  if (digits.length <= 4) {
    return digits || null;
  }

  return `${"*".repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
