import { NextResponse, type NextRequest } from "next/server";

import {
  MetaWhatsAppSendError,
  getMetaWhatsAppConfigStatus,
  sendMetaWhatsAppTextMessage,
} from "@/lib/iris/meta-whatsapp";
import {
  authorizeIrisMetaRequest,
  createIrisMetaAdminClient,
} from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SendMessageBody = {
  body?: unknown;
  channelId?: unknown;
  contactId?: unknown;
  messageId?: unknown;
  ticketId?: unknown;
  to?: unknown;
};

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const configStatus = getMetaWhatsAppConfigStatus();

  if (!configStatus.outboundReady) {
    return NextResponse.json(
      {
        error: "Envio Meta WhatsApp ainda nao esta configurado na Iris.",
        missing: configStatus.missingOutboundKeys,
      },
      { status: 503 },
    );
  }

  const input = (await request.json().catch(() => null)) as
    | SendMessageBody
    | null;
  const to = normalizeWhatsAppDestination(input?.to);
  const body = normalizeMessageBody(input?.body);
  const ticketId = normalizeUuid(input?.ticketId);
  const channelId = normalizeUuid(input?.channelId);
  const contactId = normalizeUuid(input?.contactId);
  const messageId = normalizeUuid(input?.messageId);

  if (!to) {
    return NextResponse.json(
      { error: "Informe o telefone WhatsApp em formato internacional." },
      { status: 400 },
    );
  }

  if (!body) {
    return NextResponse.json(
      { error: "Informe a mensagem para enviar pelo WhatsApp." },
      { status: 400 },
    );
  }

  let localMessage:
    | {
        body: string | null;
        created_at: string;
        delivery_status: string;
        direction: string;
        id: string;
        provider_payload?: unknown;
        sender_user_id?: string | null;
        sender_type: string;
      }
    | null = null;
  const operatorLabel = await getOperatorLabel({
    client: authorization.client,
    userId: authorization.user.id,
  });

  if (messageId) {
    const prepared = await prepareExistingTicketMessage({
      client: authorization.client,
      messageId,
      operatorLabel,
      ticketId,
      to,
      userId: authorization.user.id,
    });

    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.error }, { status: 500 });
    }

    if (prepared.alreadySent) {
      return NextResponse.json(
        {
          alreadySent: true,
          message: prepared.message,
          ok: true,
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    localMessage = prepared.message;
  } else if (ticketId) {
    const created = await createQueuedTicketMessage({
      body,
      channelId,
      client: authorization.client,
      contactId,
      operatorLabel,
      ticketId,
      to,
      userId: authorization.user.id,
    });

    if (!created.ok) {
      return NextResponse.json({ error: created.error }, { status: 500 });
    }

    localMessage = created.message;
  }

  try {
    const result = await sendMetaWhatsAppTextMessage({ body, to });

    if (!result.messageId) {
      throw new Error("Meta WhatsApp nao retornou ID da mensagem.");
    }

    const persistence = await persistOutboundReference({
      client: authorization.client,
      localMessageId: localMessage?.id ?? null,
      messageId: result.messageId,
      payload: result.raw,
      to,
      waContactId: result.contactWaId,
    });
    const updatedMessage = localMessage
      ? await markLocalMessageSent({
          client: authorization.client,
          messageId: localMessage.id,
          operatorLabel,
          payload: result.raw,
          waMessageId: result.messageId,
        })
      : null;

    return NextResponse.json(
      {
        contactWaId: result.contactWaId,
        messageId: result.messageId,
        message: updatedMessage ?? localMessage,
        ok: true,
        persistence,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const status =
      error instanceof MetaWhatsAppSendError ? error.status : 502;
    const failedMessage = localMessage
      ? await markLocalMessageFailed({
          client: authorization.client,
          error,
          messageId: localMessage.id,
          operatorLabel,
        })
      : null;

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar a mensagem pela Meta.",
        message: failedMessage ?? localMessage,
      },
      { status },
    );
  }
}

async function createQueuedTicketMessage({
  body,
  channelId,
  client,
  contactId,
  operatorLabel,
  ticketId,
  to,
  userId,
}: {
  body: string;
  channelId: string | null;
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  contactId: string | null;
  operatorLabel: string;
  ticketId: string;
  to: string;
  userId: string;
}) {
  const { data, error } = await client
    .from("caredesk_messages")
    .insert({
      body,
      channel_id: channelId,
      delivery_status: "queued",
      direction: "outbound",
      message_type: "text",
      provider_payload: {
        destination: to,
        operatorLabel,
        provider: "meta",
        source_module: "iris",
      },
      sender_contact_id: contactId,
      sender_type: "operator",
      sender_user_id: userId,
      ticket_id: ticketId,
    })
    .select(MESSAGE_SELECT)
    .single();

  if (error) {
    return {
      error: "Nao foi possivel registrar a mensagem antes do envio.",
      ok: false as const,
    };
  }

  return {
    message: data,
    ok: true as const,
  };
}

async function prepareExistingTicketMessage({
  client,
  messageId,
  operatorLabel,
  ticketId,
  to,
  userId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  messageId: string;
  operatorLabel: string;
  ticketId: string | null;
  to: string;
  userId: string;
}) {
  const { data: existing, error: existingError } = await client
    .from("caredesk_messages")
    .select(`${MESSAGE_SELECT},ticket_id`)
    .eq("id", messageId)
    .maybeSingle<
      {
        body: string | null;
        created_at: string;
        delivery_status: string;
        direction: string;
        external_message_id: string | null;
        id: string;
        provider_payload?: unknown;
        sender_type: string;
        sender_user_id?: string | null;
        ticket_id: string | null;
      }
    >();

  if (existingError || !existing) {
    return {
      error: "Mensagem local nao encontrada para envio.",
      ok: false as const,
    };
  }

  if (existing.direction !== "outbound") {
    return {
      error: "Somente mensagens outbound podem ser enviadas pela Meta.",
      ok: false as const,
    };
  }

  if (ticketId && existing.ticket_id !== ticketId) {
    return {
      error: "Mensagem local nao pertence ao ticket informado.",
      ok: false as const,
    };
  }

  if (existing.external_message_id) {
    return {
      alreadySent: true as const,
      message: existing,
      ok: true as const,
    };
  }

  const { data, error } = await client
    .from("caredesk_messages")
    .update({
      delivery_status: "queued",
      provider_payload: {
        destination: to,
        operatorLabel,
        provider: "meta",
        source_module: "iris",
      },
      sender_type: "operator",
      sender_user_id: existing.sender_user_id ?? userId,
    })
    .eq("id", messageId)
    .select(MESSAGE_SELECT)
    .single();

  if (error) {
    return {
      error: "Nao foi possivel preparar a mensagem local para envio.",
      ok: false as const,
    };
  }

  return {
    alreadySent: false as const,
    message: data,
    ok: true as const,
  };
}

async function persistOutboundReference({
  client,
  localMessageId,
  messageId,
  payload,
  to,
  waContactId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  localMessageId: string | null;
  messageId: string;
  payload: unknown;
  to: string;
  waContactId: string | null;
}) {
  const { data: channel } = await client
    .from("caredesk_channels")
    .select("id,phone_number")
    .eq("slug", "whatsapp-careli")
    .eq("provider", "meta")
    .maybeSingle<{ id: string; phone_number: string | null }>();
  const { error } = await client
    .from("caredesk_whatsapp_message_refs")
    .upsert(
      {
        channel_id: channel?.id ?? null,
        delivery_status: "sent",
        direction: "outbound",
        message_id: localMessageId,
        payload: normalizeJsonPayload(payload),
        phone_number_id: process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? null,
        provider: "meta",
        wa_contact_id: waContactId ?? to,
        wa_message_id: messageId,
      },
      {
        onConflict: "provider,wa_message_id",
      },
    );

  if (error) {
    return {
      ok: false,
      warning:
        "Mensagem enviada, mas a referencia local nao foi registrada.",
    };
  }

  return {
    ok: true,
  };
}

async function markLocalMessageSent({
  client,
  messageId,
  operatorLabel,
  payload,
  waMessageId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  messageId: string;
  operatorLabel: string;
  payload: unknown;
  waMessageId: string;
}) {
  const { data, error } = await client
    .from("caredesk_messages")
    .update({
      delivery_status: "sent",
      external_message_id: waMessageId,
      provider_payload: {
        meta: normalizeJsonPayload(payload),
        operatorLabel,
        provider: "meta",
      },
      sent_at: new Date().toISOString(),
    })
    .eq("id", messageId)
    .select(MESSAGE_SELECT)
    .single();

  if (error) {
    return null;
  }

  return data;
}

async function markLocalMessageFailed({
  client,
  error,
  messageId,
  operatorLabel,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  error: unknown;
  messageId: string;
  operatorLabel: string;
}) {
  const { data } = await client
    .from("caredesk_messages")
    .update({
      delivery_status: "failed",
      provider_payload: {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar a mensagem pela Meta.",
        operatorLabel,
        provider: "meta",
      },
    })
    .eq("id", messageId)
    .select(MESSAGE_SELECT)
    .single();

  return data ?? null;
}

async function getOperatorLabel({
  client,
  userId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  userId: string;
}) {
  const { data } = await client
    .from("hub_users")
    .select("display_name,email")
    .eq("id", userId)
    .maybeSingle<{ display_name: string | null; email: string | null }>();
  const name = data?.display_name?.trim();

  if (name) {
    return name;
  }

  return data?.email?.trim() || "Operador Iris";
}

function normalizeWhatsAppDestination(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const digits = value.replace(/\D/g, "");

  if (digits.length < 10 || digits.length > 15) {
    return null;
  }

  return digits;
}

function normalizeMessageBody(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 4096);
}

function normalizeUuid(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized,
  )
    ? normalized
    : null;
}

function normalizeJsonPayload(value: unknown) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    (typeof value === "object" && value !== null)
  ) {
    return value;
  }

  return {};
}

const MESSAGE_SELECT =
  "id,body,direction,sender_type,sender_user_id,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id";
