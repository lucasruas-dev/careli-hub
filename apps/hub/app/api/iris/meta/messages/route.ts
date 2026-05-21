import { NextResponse, type NextRequest } from "next/server";

import {
  MetaWhatsAppSendError,
  type MetaWhatsAppSendMessageResult,
  getMetaWhatsAppConfigStatus,
  sendMetaWhatsAppAudioMessage,
  sendMetaWhatsAppReactionMessage,
  sendMetaWhatsAppTextMessage,
} from "@/lib/iris/meta-whatsapp";
import {
  authorizeIrisMetaRequest,
  createIrisMetaAdminClient,
} from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IRIS_AUDIO_MAX_BASE64_LENGTH = 4_000_000;

type SendMessageBody = {
  action?: unknown;
  body?: unknown;
  channelId?: unknown;
  contactId?: unknown;
  emoji?: unknown;
  media?: unknown;
  messageId?: unknown;
  replyToMessageId?: unknown;
  ticketId?: unknown;
  to?: unknown;
};

type OperatorIdentity = {
  avatarUrl: string | null;
  label: string;
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
  const hasMediaInput = Boolean(input?.media);
  const audioMedia = normalizeAudioMedia(input?.media);
  const body = audioMedia
    ? normalizeMessageBody(input?.body) ?? "Audio WhatsApp"
    : normalizeMessageBody(input?.body);
  const ticketId = normalizeUuid(input?.ticketId);
  const channelId = normalizeUuid(input?.channelId);
  const contactId = normalizeUuid(input?.contactId);
  const messageId = normalizeUuid(input?.messageId);
  const replyToMessageId = normalizeUuid(input?.replyToMessageId);

  if (!to) {
    return NextResponse.json(
      { error: "Informe o telefone WhatsApp em formato internacional." },
      { status: 400 },
    );
  }

  if (hasMediaInput && !audioMedia) {
    return NextResponse.json(
      { error: "Audio invalido ou acima do limite de homologacao." },
      { status: 400 },
    );
  }

  if (!body && !audioMedia) {
    return NextResponse.json(
      { error: "Informe a mensagem para enviar pelo WhatsApp." },
      { status: 400 },
    );
  }
  const outboundBody = body ?? "Audio WhatsApp";

  let localMessage:
    | {
        body: string | null;
        created_at: string;
        delivery_status: string;
        direction: string;
        id: string;
        message_type?: string | null;
        provider_payload?: unknown;
        sender_user_id?: string | null;
        sender_type: string;
      }
    | null = null;
  const operatorIdentity = await getOperatorIdentity({
    client: authorization.client,
    userId: authorization.user.id,
  });
  const replyContext = replyToMessageId
    ? await getReplyContext({
        client: authorization.client,
        replyToMessageId,
        ticketId,
      })
    : null;

  if (replyContext?.error) {
    return NextResponse.json({ error: replyContext.error }, { status: 400 });
  }
  const replyPreview = replyContext?.preview ?? null;

  if (messageId) {
    const prepared = await prepareExistingTicketMessage({
      client: authorization.client,
      messageId,
      operatorIdentity,
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
      body: outboundBody,
      channelId,
      client: authorization.client,
      contactId,
      media: audioMedia,
      messageType: audioMedia ? "audio" : "text",
      operatorIdentity,
      replyContext: replyPreview,
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
    const sendAttempt = await sendMetaWhatsAppMessageWithFallback({
      send: (candidate) =>
        audioMedia
          ? sendMetaWhatsAppAudioMessage({
              audioBase64: audioMedia.base64,
              contextMessageId: replyPreview?.externalMessageId ?? null,
              fileName: audioMedia.fileName,
              mimeType: audioMedia.mimeType,
              to: candidate,
            })
          : sendMetaWhatsAppTextMessage({
              body: outboundBody,
              contextMessageId: replyPreview?.externalMessageId ?? null,
              to: candidate,
            }),
      to,
    });
    const result = sendAttempt.result;

    if (!result.messageId) {
      throw new Error("Meta WhatsApp nao retornou ID da mensagem.");
    }

    const persistence = await persistOutboundReference({
      client: authorization.client,
      localMessageId: localMessage?.id ?? null,
      messageId: result.messageId,
      payload: result.raw,
      to: sendAttempt.sentTo,
      waContactId: result.contactWaId,
    });
    const updatedMessage = localMessage
      ? await markLocalMessageSent({
          client: authorization.client,
          destination: sendAttempt.sentTo,
          existingPayload: localMessage.provider_payload,
          fallbackUsed: sendAttempt.usedFallback,
          messageId: localMessage.id,
          operatorIdentity,
          payload: result.raw,
          sendAttemptCount: sendAttempt.attemptedDestinations.length,
          waMessageId: result.messageId,
        })
      : null;

    return NextResponse.json(
      {
        contactWaId: result.contactWaId,
        destination: sendAttempt.sentTo,
        messageId: result.messageId,
        message: updatedMessage ?? localMessage,
        ok: true,
        persistence,
        usedFallback: sendAttempt.usedFallback,
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
          existingPayload: localMessage.provider_payload,
          messageId: localMessage.id,
          operatorIdentity,
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

export async function PATCH(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const input = (await request.json().catch(() => null)) as
    | SendMessageBody
    | null;
  const action = typeof input?.action === "string" ? input.action : "";
  const messageId = normalizeUuid(input?.messageId);

  if (!messageId) {
    return NextResponse.json(
      { error: "Informe a mensagem do Iris para atualizar." },
      { status: 400 },
    );
  }

  const operatorIdentity = await getOperatorIdentity({
    client: authorization.client,
    userId: authorization.user.id,
  });

  if (action === "edit") {
    const body = normalizeMessageBody(input?.body);

    if (!body) {
      return NextResponse.json(
        { error: "Informe o novo texto da mensagem." },
        { status: 400 },
      );
    }

    const result = await editIrisMessage({
      body,
      client: authorization.client,
      messageId,
      operatorIdentity,
      userId: authorization.user.id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      { message: result.message, ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (action === "react") {
    const emoji = normalizeEmoji(input?.emoji);

    if (!emoji) {
      return NextResponse.json(
        { error: "Informe uma reacao valida." },
        { status: 400 },
      );
    }

    const result = await reactToIrisMessage({
      client: authorization.client,
      emoji,
      messageId,
      operatorIdentity,
      to: normalizeWhatsAppDestination(input?.to),
      userId: authorization.user.id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      { message: result.message, ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { error: "Acao de mensagem nao suportada pela Iris." },
    { status: 400 },
  );
}

async function sendMetaWhatsAppMessageWithFallback({
  send,
  to,
}: {
  send: (candidate: string) => Promise<MetaWhatsAppSendMessageResult>;
  to: string;
}) {
  const attemptedDestinations: string[] = [];
  const candidates = buildBrazilWhatsAppDestinationCandidates(to);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    attemptedDestinations.push(candidate);

    try {
      const result = await send(candidate);

      return {
        attemptedDestinations,
        result,
        sentTo: candidate,
        usedFallback: candidate !== to,
      };
    } catch (error) {
      lastError = error;

      if (!isMetaRecipientAllowedListError(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

type ReplyContextPreview = {
  body: string;
  createdAt: string | null;
  direction: string | null;
  externalMessageId: string | null;
  messageId: string;
  senderLabel: string | null;
};

type NormalizedAudioMedia = {
  base64: string;
  durationMs: number | null;
  fileName: string;
  mimeType: string;
};

async function getReplyContext({
  client,
  replyToMessageId,
  ticketId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  replyToMessageId: string;
  ticketId: string | null;
}): Promise<{ error?: string; preview?: ReplyContextPreview }> {
  let query = client
    .from("caredesk_messages")
    .select(
      "id,ticket_id,body,direction,sender_type,provider_payload,created_at,external_message_id",
    )
    .eq("id", replyToMessageId);

  if (ticketId) {
    query = query.eq("ticket_id", ticketId);
  }

  const { data, error } = await query.maybeSingle<{
    body: string | null;
    created_at: string | null;
    direction: string | null;
    external_message_id: string | null;
    id: string;
    provider_payload?: unknown;
    sender_type: string | null;
    ticket_id: string | null;
  }>();

  if (error || !data) {
    return { error: "Mensagem selecionada para resposta nao foi encontrada." };
  }

  return {
    preview: {
      body:
        data.body ??
        (data.sender_type === "customer" ? "Mensagem do cliente" : "Mensagem"),
      createdAt: data.created_at,
      direction: data.direction,
      externalMessageId: data.external_message_id,
      messageId: data.id,
      senderLabel: readPayloadString(data.provider_payload, "operatorLabel") ??
        (data.sender_type === "customer" ? "Cliente" : "Operador Iris"),
    },
  };
}

async function editIrisMessage({
  body,
  client,
  messageId,
  operatorIdentity,
  userId,
}: {
  body: string;
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  messageId: string;
  operatorIdentity: OperatorIdentity;
  userId: string;
}) {
  const { data: existing, error } = await client
    .from("caredesk_messages")
    .select(`${MESSAGE_SELECT},ticket_id`)
    .eq("id", messageId)
    .maybeSingle<{
      body: string | null;
      direction: string | null;
      external_message_id: string | null;
      id: string;
      provider_payload?: unknown;
      sender_type: string | null;
      sender_user_id?: string | null;
    }>();

  if (error || !existing) {
    return {
      error: "Mensagem nao encontrada para edicao.",
      ok: false as const,
      status: 404,
    };
  }

  if (existing.direction !== "outbound" || existing.sender_type !== "operator") {
    return {
      error: "Somente mensagens do operador podem ser editadas no Iris.",
      ok: false as const,
      status: 403,
    };
  }

  if (existing.sender_user_id && existing.sender_user_id !== userId) {
    return {
      error: "Somente o operador autor da mensagem pode editar este registro.",
      ok: false as const,
      status: 403,
    };
  }

  const now = new Date().toISOString();
  const { data, error: updateError } = await client
    .from("caredesk_messages")
    .update({
      body,
      provider_payload: {
        ...normalizeRecordPayload(existing.provider_payload),
        editScope: existing.external_message_id ? "iris-local" : "local-before-send",
        editedAt: now,
        operatorAvatarUrl: operatorIdentity.avatarUrl,
        operatorLabel: operatorIdentity.label,
        originalBody:
          readPayloadString(existing.provider_payload, "originalBody") ??
          existing.body,
      },
    })
    .eq("id", messageId)
    .select(MESSAGE_SELECT)
    .single();

  if (updateError) {
    return {
      error: "Nao foi possivel salvar a edicao no Iris.",
      ok: false as const,
      status: 500,
    };
  }

  return {
    message: data,
    ok: true as const,
    status: 200,
  };
}

async function reactToIrisMessage({
  client,
  emoji,
  messageId,
  operatorIdentity,
  to,
  userId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  emoji: string;
  messageId: string;
  operatorIdentity: OperatorIdentity;
  to: string | null;
  userId: string;
}) {
  const { data: existing, error } = await client
    .from("caredesk_messages")
    .select(`${MESSAGE_SELECT},ticket_id`)
    .eq("id", messageId)
    .maybeSingle<{
      direction: string | null;
      external_message_id: string | null;
      id: string;
      provider_payload?: unknown;
      sender_type: string | null;
    }>();

  if (error || !existing) {
    return {
      error: "Mensagem nao encontrada para reacao.",
      ok: false as const,
      status: 404,
    };
  }

  const payload = normalizeRecordPayload(existing.provider_payload);
  const currentReactions = Array.isArray(payload.reactions)
    ? payload.reactions.filter(
        (reaction) =>
          reaction &&
          typeof reaction === "object" &&
          !Array.isArray(reaction),
      )
    : [];
  const withoutCurrentUser = currentReactions.filter(
    (reaction) =>
      (reaction as Record<string, unknown>).actorUserId !== userId,
  );
  const alreadySame = currentReactions.some(
    (reaction) =>
      (reaction as Record<string, unknown>).actorUserId === userId &&
      (reaction as Record<string, unknown>).emoji === emoji,
  );

  const nextReactions = alreadySame
    ? withoutCurrentUser
    : [
        ...withoutCurrentUser,
        {
          actorAvatarUrl: operatorIdentity.avatarUrl,
          actorLabel: operatorIdentity.label,
          actorUserId: userId,
          createdAt: new Date().toISOString(),
          emoji,
        },
      ];

  const shouldSendMetaReaction =
    !alreadySame &&
    existing.direction === "inbound" &&
    existing.sender_type === "customer" &&
    Boolean(existing.external_message_id) &&
    Boolean(to);

  if (shouldSendMetaReaction) {
    try {
      await sendMetaWhatsAppReactionMessage({
        emoji,
        messageId: existing.external_message_id!,
        to: to!,
      });
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar a reacao pela Meta.",
        ok: false as const,
        status: error instanceof MetaWhatsAppSendError ? error.status : 502,
      };
    }
  }

  const { data, error: updateError } = await client
    .from("caredesk_messages")
    .update({
      provider_payload: {
        ...payload,
        reactions: nextReactions,
      },
    })
    .eq("id", messageId)
    .select(MESSAGE_SELECT)
    .single();

  if (updateError) {
    return {
      error: "Nao foi possivel registrar a reacao no Iris.",
      ok: false as const,
      status: 500,
    };
  }

  return {
    message: data,
    ok: true as const,
    status: 200,
  };
}

async function createQueuedTicketMessage({
  body,
  channelId,
  client,
  contactId,
  media,
  messageType,
  operatorIdentity,
  replyContext,
  ticketId,
  to,
  userId,
}: {
  body: string;
  channelId: string | null;
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  contactId: string | null;
  media: NormalizedAudioMedia | null;
  messageType: string;
  operatorIdentity: OperatorIdentity;
  replyContext: ReplyContextPreview | null;
  ticketId: string;
  to: string;
  userId: string;
}) {
  const assignment = await assignTicketToOperator({
    client,
    ticketId,
    userId,
  });

  if (!assignment.ok) {
    return assignment;
  }

  const { data, error } = await client
    .from("caredesk_messages")
    .insert({
      body,
      channel_id: channelId,
      delivery_status: "queued",
      direction: "outbound",
      message_type: messageType,
      provider_payload: {
        destination: to,
        media: media
          ? {
              durationMs: media.durationMs,
              fileName: media.fileName,
              mimeType: media.mimeType,
              type: "audio",
            }
          : null,
        operatorAvatarUrl: operatorIdentity.avatarUrl,
        operatorLabel: operatorIdentity.label,
        provider: "meta",
        replyTo: replyContext,
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
  operatorIdentity,
  ticketId,
  to,
  userId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  messageId: string;
  operatorIdentity: OperatorIdentity;
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

  const assignment = await assignTicketToOperator({
    client,
    ticketId: existing.ticket_id,
    userId,
  });

  if (!assignment.ok) {
    return assignment;
  }

  const { data, error } = await client
    .from("caredesk_messages")
    .update({
      delivery_status: "queued",
      provider_payload: {
        ...normalizeRecordPayload(existing.provider_payload),
        destination: to,
        operatorAvatarUrl: operatorIdentity.avatarUrl,
        operatorLabel: operatorIdentity.label,
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

async function assignTicketToOperator({
  client,
  ticketId,
  userId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  ticketId: string | null;
  userId: string;
}) {
  if (!ticketId) {
    return { ok: true as const };
  }

  const { error } = await client
    .from("caredesk_tickets")
    .update({
      assigned_to_user_id: userId,
      status: "waiting_customer",
    })
    .eq("id", ticketId);

  if (error) {
    return {
      error: "Nao foi possivel assumir o responsavel do atendimento.",
      ok: false as const,
    };
  }

  return { ok: true as const };
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
  destination,
  existingPayload,
  fallbackUsed,
  messageId,
  operatorIdentity,
  payload,
  sendAttemptCount,
  waMessageId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  destination: string;
  existingPayload?: unknown;
  fallbackUsed: boolean;
  messageId: string;
  operatorIdentity: OperatorIdentity;
  payload: unknown;
  sendAttemptCount: number;
  waMessageId: string;
}) {
  const { data, error } = await client
    .from("caredesk_messages")
    .update({
      delivery_status: "sent",
      external_message_id: waMessageId,
      provider_payload: {
        ...normalizeRecordPayload(existingPayload),
        destination,
        fallbackUsed,
        meta: normalizeJsonPayload(payload),
        operatorAvatarUrl: operatorIdentity.avatarUrl,
        operatorLabel: operatorIdentity.label,
        provider: "meta",
        sendAttemptCount,
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
  existingPayload,
  messageId,
  operatorIdentity,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  error: unknown;
  existingPayload?: unknown;
  messageId: string;
  operatorIdentity: OperatorIdentity;
}) {
  const { data } = await client
    .from("caredesk_messages")
    .update({
      delivery_status: "failed",
      provider_payload: {
        ...normalizeRecordPayload(existingPayload),
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar a mensagem pela Meta.",
        operatorAvatarUrl: operatorIdentity.avatarUrl,
        operatorLabel: operatorIdentity.label,
        provider: "meta",
      },
    })
    .eq("id", messageId)
    .select(MESSAGE_SELECT)
    .single();

  return data ?? null;
}

async function getOperatorIdentity({
  client,
  userId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  userId: string;
}): Promise<OperatorIdentity> {
  const { data } = await client
    .from("hub_users")
    .select("display_name,email,avatar_url")
    .eq("id", userId)
    .maybeSingle<{
      avatar_url: string | null;
      display_name: string | null;
      email: string | null;
    }>();
  const name = data?.display_name?.trim();

  return {
    avatarUrl: normalizeUrl(data?.avatar_url),
    label: name || "Operador Iris",
  };
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

function buildBrazilWhatsAppDestinationCandidates(to: string) {
  const candidates = [to];
  const withoutBrazilianNinthDigit = /^55(\d{2})(\d{8})$/.exec(to);
  const withBrazilianNinthDigit = /^55(\d{2})9(\d{8})$/.exec(to);

  if (withoutBrazilianNinthDigit) {
    candidates.push(
      `55${withoutBrazilianNinthDigit[1]}9${withoutBrazilianNinthDigit[2]}`,
    );
  }

  if (withBrazilianNinthDigit) {
    candidates.push(
      `55${withBrazilianNinthDigit[1]}${withBrazilianNinthDigit[2]}`,
    );
  }

  return Array.from(new Set(candidates));
}

function isMetaRecipientAllowedListError(error: unknown) {
  return (
    error instanceof MetaWhatsAppSendError &&
    (String(error.code) === "131030" ||
      /recipient phone number not in allowed list/i.test(error.message))
  );
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

function normalizeAudioMedia(value: unknown): NormalizedAudioMedia | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (record.type !== "audio" || typeof record.dataUrl !== "string") {
    return null;
  }

  const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/i.exec(
    record.dataUrl.trim(),
  );

  if (!dataUrlMatch) {
    return null;
  }

  const mimeType = dataUrlMatch[1]?.toLowerCase();

  if (!mimeType?.startsWith("audio/")) {
    return null;
  }

  const base64 = dataUrlMatch[2]?.replace(/\s/g, "");

  if (
    !base64 ||
    base64.length > IRIS_AUDIO_MAX_BASE64_LENGTH ||
    !/^[a-z0-9+/=]+$/i.test(base64)
  ) {
    return null;
  }

  const fileName =
    typeof record.fileName === "string" && record.fileName.trim()
      ? record.fileName.trim().replace(/[^a-z0-9._-]+/gi, "-").slice(0, 120)
      : "iris-audio.webm";
  const durationMs =
    typeof record.durationMs === "number" && Number.isFinite(record.durationMs)
      ? Math.max(0, Math.round(record.durationMs))
      : null;

  return {
    base64,
    durationMs,
    fileName,
    mimeType,
  };
}

function normalizeEmoji(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized || normalized.length > 16) {
    return null;
  }

  return normalized;
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

function normalizeRecordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function readPayloadString(value: unknown, key: string) {
  const record = normalizeRecordPayload(value);
  const raw = record[key];

  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function normalizeUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return /^https?:\/\//i.test(normalized) && normalized.length <= 2048
    ? normalized
    : null;
}

const MESSAGE_SELECT =
  "id,body,direction,sender_type,sender_user_id,message_type,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id,sender_user:hub_users(display_name,email,avatar_url)";
