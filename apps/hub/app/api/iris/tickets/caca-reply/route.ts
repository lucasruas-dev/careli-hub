import { NextResponse, type NextRequest } from "next/server";

import { canReplyAsCaca } from "@/lib/iris/caca-reply-access";
import {
  getMetaWhatsAppOutboundConfig,
  sendMetaWhatsAppTextMessage,
  signWhatsAppBody,
} from "@/lib/iris/meta-whatsapp";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Responder COMO CACÁ: um operador dispara, mas o servidor de produção envia com as
// credenciais dele, assina a mensagem como *Cacá* e registra como automação dela —
// SEM reatribuir o ticket (segue conduzido pela Cacá). Reutilizável p/ correções.
const CACA_LABEL = "Cacá";
const META_PROVIDER = "meta";
const MESSAGE_SELECT =
  "id,ticket_id,body,direction,sender_type,sender_user_id,provider_payload,created_at,delivery_status,message_type,external_message_id,channel_id";

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length ? trimmed : null;
}

function normalizeUuid(value: unknown): string | null {
  const text = normalizeText(value);

  return text &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function normalizeWhatsAppDestination(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const digits = value.replace(/\D/g, "");

  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
    "operator",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  // Acesso restrito: só o dono pode responder como Cacá (Lucas, 30/jun).
  if (!canReplyAsCaca(authorization.user.id)) {
    return NextResponse.json(
      { error: "Sem permissão para responder como Cacá." },
      { status: 403 },
    );
  }

  const { client } = authorization;
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
      { error: "Informe a mensagem para enviar como Cacá." },
      { status: 400 },
    );
  }

  const { data: ticket, error: ticketError } = await client
    .from("caredesk_tickets")
    .select("id,contact_id,channel_id")
    .eq("id", ticketId)
    .maybeSingle<{
      channel_id: string | null;
      contact_id: string | null;
      id: string;
    }>();

  if (ticketError) {
    return NextResponse.json(
      { error: "Não foi possível localizar o ticket." },
      { status: 500 },
    );
  }

  if (!ticket?.contact_id) {
    return NextResponse.json(
      { error: "Ticket sem contato vinculado." },
      { status: 404 },
    );
  }

  const { data: contact } = await client
    .from("caredesk_contacts")
    .select("id,whatsapp_phone,phone")
    .eq("id", ticket.contact_id)
    .maybeSingle<{
      id: string;
      phone: string | null;
      whatsapp_phone: string | null;
    }>();

  const destination = normalizeWhatsAppDestination(
    contact?.whatsapp_phone ?? contact?.phone,
  );

  if (!destination) {
    return NextResponse.json(
      { error: "O contato do ticket não tem WhatsApp válido." },
      { status: 400 },
    );
  }

  let phoneNumberId: string | null = null;

  if (ticket.channel_id) {
    const { data: channel } = await client
      .from("caredesk_channels")
      .select("external_account_id")
      .eq("id", ticket.channel_id)
      .maybeSingle<{ external_account_id: string | null }>();

    phoneNumberId = normalizeText(channel?.external_account_id);
  }

  const basePayload = {
    automation: "caca",
    manualCaca: true,
    manualSenderUserId: authorization.user.id,
    operatorLabel: CACA_LABEL,
    provider: META_PROVIDER,
    source_module: "iris",
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
      ticket_id: ticket.id,
    })
    .select(MESSAGE_SELECT)
    .single();

  if (insertError || !queued) {
    return NextResponse.json(
      { error: "Não foi possível registrar a mensagem da Cacá." },
      { status: 500 },
    );
  }

  const config = phoneNumberId
    ? { ...getMetaWhatsAppOutboundConfig(), phoneNumberId }
    : getMetaWhatsAppOutboundConfig();

  try {
    const result = await sendMetaWhatsAppTextMessage({
      body: signWhatsAppBody(CACA_LABEL, body),
      config,
      to: destination,
    });

    if (!result.messageId) {
      throw new Error("Meta WhatsApp não retornou ID da mensagem.");
    }

    const { data: updated } = await client
      .from("caredesk_messages")
      .update({
        delivery_status: "sent",
        external_message_id: result.messageId,
        provider_payload: { ...basePayload, destination, meta: result.raw },
        sent_at: new Date().toISOString(),
      })
      .eq("id", queued.id)
      .select(MESSAGE_SELECT)
      .single();

    await client.from("caredesk_whatsapp_message_refs").upsert(
      {
        channel_id: ticket.channel_id,
        delivery_status: "sent",
        direction: "outbound",
        message_id: queued.id,
        payload: result.raw ?? null,
        phone_number_id:
          phoneNumberId ?? process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? null,
        provider: META_PROVIDER,
        wa_contact_id: result.contactWaId ?? destination,
        wa_message_id: result.messageId,
        webhook_event_id: null,
      },
      { onConflict: "provider,wa_message_id" },
    );

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

    const status =
      typeof (error as { status?: unknown })?.status === "number"
        ? (error as { status: number }).status
        : 502;

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível enviar a mensagem como Cacá.",
      },
      { status },
    );
  }
}
