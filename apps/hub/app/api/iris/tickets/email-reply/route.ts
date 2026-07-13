import { NextResponse, type NextRequest } from "next/server";

import { sendGmailMessage } from "@/lib/iris/gmail";
import {
  authorizeIrisMetaRequest,
  createIrisMetaAdminClient,
} from "@/lib/iris/meta-server";

type IrisAdminClient = NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Responder um ticket de E-MAIL da Iris. O operador escreve no cockpit e o servidor envia
// pela caixa robô caca@ (Gmail API), respondendo NO MESMO thread (In-Reply-To/References +
// threadId) pra cair como resposta na conversa do cliente. Espelha o caca-reply do WhatsApp,
// mas o transporte é o Gmail. Gated por config.outbound_enabled do canal (interruptor do
// Lucas). Ver [[project-iris-email-grupos]].
const GMAIL_PROVIDER = "gmail";
const DEFAULT_FROM_NAME = "Careli";
const MESSAGE_SELECT =
  "id,ticket_id,body,direction,sender_type,sender_user_id,message_type,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id,sender_user:hub_users(display_name,email,avatar_url)";

type ChannelRow = {
  config: Record<string, unknown> | null;
  external_account_id: string | null;
  id: string;
  kind: string | null;
  name: string | null;
};

type TicketRow = {
  channel_id: string | null;
  contact_id: string | null;
  id: string;
  metadata: Record<string, unknown> | null;
  source_context: Record<string, unknown> | null;
  subject: string | null;
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

  const { client, user } = authorization;
  const input = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const ticketId = normalizeUuid(input?.ticketId);
  const body = normalizeText(input?.body);

  if (!ticketId) {
    return NextResponse.json({ error: "Ticket inválido." }, { status: 400 });
  }

  if (!body) {
    return NextResponse.json(
      { error: "Escreva a mensagem do e-mail." },
      { status: 400 },
    );
  }

  const { data: ticket, error: ticketError } = await client
    .from("caredesk_tickets")
    .select("id,contact_id,channel_id,subject,source_context,metadata")
    .eq("id", ticketId)
    .maybeSingle<TicketRow>();

  if (ticketError) {
    return NextResponse.json(
      { error: "Não foi possível localizar o ticket." },
      { status: 500 },
    );
  }

  if (!ticket?.channel_id) {
    return NextResponse.json(
      { error: "Ticket sem canal vinculado." },
      { status: 404 },
    );
  }

  const { data: channel } = await client
    .from("caredesk_channels")
    .select("id,kind,external_account_id,config,name")
    .eq("id", ticket.channel_id)
    .maybeSingle<ChannelRow>();

  if (!channel || channel.kind !== "email") {
    return NextResponse.json(
      { error: "Este ticket não é de e-mail." },
      { status: 400 },
    );
  }

  const config = isRecord(channel.config) ? channel.config : {};

  if (config.outbound_enabled !== true) {
    return NextResponse.json(
      {
        error:
          "Envio de e-mail desativado neste canal (config.outbound_enabled). Ligue o canal antes de responder.",
      },
      { status: 409 },
    );
  }

  // Threading: pega o ÚLTIMO inbound do ticket pra responder no mesmo thread do Gmail.
  const { data: lastInbound } = await client
    .from("caredesk_messages")
    .select("provider_payload,sender_contact_id")
    .eq("ticket_id", ticket.id)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      provider_payload: Record<string, unknown> | null;
      sender_contact_id: string | null;
    }>();

  const inboundPayload = isRecord(lastInbound?.provider_payload)
    ? lastInbound.provider_payload
    : {};
  const sourceContext = isRecord(ticket.source_context)
    ? ticket.source_context
    : {};

  // Destinatário: o e-mail de quem escreveu (fromEmail do inbound) ou o e-mail do contato.
  let recipient =
    readString(inboundPayload.fromEmail) ?? readString(sourceContext.fromEmail);

  if (!recipient && ticket.contact_id) {
    const { data: contact } = await client
      .from("caredesk_contacts")
      .select("email")
      .eq("id", ticket.contact_id)
      .maybeSingle<{ email: string | null }>();

    recipient = readString(contact?.email);
  }

  if (!recipient) {
    return NextResponse.json(
      { error: "Não foi possível identificar o e-mail do destinatário." },
      { status: 400 },
    );
  }

  const threadId =
    readString(inboundPayload.gmailThreadId) ??
    readString(sourceContext.gmailThreadId);
  const inReplyTo = readString(inboundPayload.messageIdHeader);
  const references = readString(inboundPayload.references);
  const baseSubject =
    readString(ticket.subject) ??
    readString(sourceContext.subject) ??
    readString(inboundPayload.subject) ??
    "Atendimento Careli";
  const subjectLine = withReplyPrefix(baseSubject);
  const groupAddress =
    readString(config.groupAddress) ??
    readString(channel.external_account_id) ??
    undefined;
  // Nome amigável do remetente (o cliente vê "Careli <contato@…>"). Override via config.
  const fromName = readString(config.fromName) ?? DEFAULT_FROM_NAME;
  const from = groupAddress ? `${fromName} <${groupAddress}>` : undefined;

  const operator = await getOperatorIdentity(client, user.id);

  const basePayload = {
    operatorAvatarUrl: operator.avatarUrl,
    operatorLabel: operator.label,
    provider: GMAIL_PROVIDER,
    source_module: "iris",
    subject: subjectLine,
    to: recipient,
    ...(threadId ? { gmailThreadId: threadId } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
  };

  const { data: queued, error: insertError } = await client
    .from("caredesk_messages")
    .insert({
      body,
      channel_id: ticket.channel_id,
      delivery_status: "queued",
      direction: "outbound",
      message_type: "text",
      provider_payload: basePayload,
      sender_contact_id: ticket.contact_id,
      sender_type: "operator",
      sender_user_id: user.id,
      ticket_id: ticket.id,
    })
    .select(MESSAGE_SELECT)
    .single();

  if (insertError || !queued) {
    return NextResponse.json(
      { error: "Não foi possível registrar o e-mail antes do envio." },
      { status: 500 },
    );
  }

  // Assume o ticket pra quem respondeu e move pra "aguardando cliente".
  await client
    .from("caredesk_tickets")
    .update({ assigned_to_user_id: user.id, status: "waiting_customer" })
    .eq("id", ticket.id);

  try {
    const result = await sendGmailMessage({
      bodyText: body,
      ...(from ? { from } : {}),
      inReplyTo,
      references,
      subjectLine,
      threadId,
      to: recipient,
    });

    const { data: updated } = await client
      .from("caredesk_messages")
      .update({
        delivery_status: "sent",
        external_message_id: result.id || null,
        provider_payload: {
          ...basePayload,
          from: from ?? null,
          gmailMessageId: result.id,
          gmailThreadId: result.threadId || threadId || null,
        },
        sent_at: new Date().toISOString(),
      })
      .eq("id", queued.id)
      .select(MESSAGE_SELECT)
      .single();

    // Fecha o thread do Gmail no metadata do ticket (útil pra próximos replies e Fase C).
    await client
      .from("caredesk_tickets")
      .update({
        metadata: {
          ...(isRecord(ticket.metadata) ? ticket.metadata : {}),
          gmailThreadId: result.threadId || threadId || null,
          lastAgentMessageAt: new Date().toISOString(),
        },
      })
      .eq("id", ticket.id);

    return NextResponse.json(
      { message: updated ?? queued, ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    await client
      .from("caredesk_messages")
      .update({
        delivery_status: "failed",
        provider_payload: {
          ...basePayload,
          error: error instanceof Error ? error.message : String(error),
        },
      })
      .eq("id", queued.id);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível enviar o e-mail agora.",
      },
      { status: 502 },
    );
  }
}

async function getOperatorIdentity(
  client: IrisAdminClient,
  userId: string,
): Promise<{ avatarUrl: string | null; label: string }> {
  const { data } = await client
    .from("hub_users")
    .select("display_name,avatar_url")
    .eq("id", userId)
    .maybeSingle<{ avatar_url: string | null; display_name: string | null }>();
  const name = readString(data?.display_name);

  return {
    avatarUrl: readUrl(data?.avatar_url),
    label: name ?? "Operador Iris",
  };
}

function withReplyPrefix(subject: string): string {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length ? trimmed : null;
}

function readString(value: unknown): string | null {
  return normalizeText(value);
}

function readUrl(value: unknown): string | null {
  const text = normalizeText(value);

  return text && /^https?:\/\//i.test(text) && text.length <= 2048 ? text : null;
}

function normalizeUuid(value: unknown): string | null {
  const text = normalizeText(value);

  return text &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
