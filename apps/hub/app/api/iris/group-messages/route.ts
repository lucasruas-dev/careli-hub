import { NextResponse, type NextRequest } from "next/server";

import {
  sendEvolutionGroupAudio,
  sendEvolutionGroupMedia,
  sendEvolutionGroupReaction,
  sendEvolutionGroupText,
} from "@/lib/iris/evolution-api";
import { uploadIrisMediaBuffer } from "@/lib/iris/meta-media-storage";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";
import { signWhatsAppBody } from "@/lib/iris/meta-whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Saída do OPERADOR pelo canal Relacionamento (6566), via gateway Evolution.
// Serve os DOIS mundos:
//  • GRUPO (groupId): mensagem pendura no grupo (group_id), sem ticket.
//  • DIRECT (ticketId): mensagem pendura no ticket 1:1; assinada? NÃO — no 1:1
//    quem fala já é o número, então vai limpo (diferente do grupo).
//
// ⚠️ FORA de /api/iris/evolution de propósito (aquele prefixo é público via gate).

const MESSAGE_SELECT =
  "id,ticket_id,group_id,body,direction,sender_type,sender_user_id,message_type,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id";

const DIRECT_JID_SUFFIX = "@s.whatsapp.net";

type OutboundMedia = {
  base64: string;
  durationMs: number | null;
  fileName: string;
  mimeType: string;
  type: "audio" | "document" | "image";
};

// Alvo resolvido: pra onde enviar (Evolution) e a quem pertence a mensagem.
type SendTarget = {
  sendNumber: string; // 'number' do Evolution: group_jid ou telefone
  reactionJid: string; // remoteJid pra montar a chave da reação
  ownerColumn: "group_id" | "ticket_id";
  ownerId: string;
  ticketId: string | null; // só direct: pra atualizar status/SLA
  sign: boolean; // grupo assina com o nome; direct não
};

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const { client, user } = authorization;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
  }

  const input = (payload ?? {}) as Record<string, unknown>;
  const groupId = typeof input.groupId === "string" ? input.groupId : "";
  const ticketId = typeof input.ticketId === "string" ? input.ticketId : "";

  const target = groupId
    ? await resolveGroupTarget(client, groupId)
    : ticketId
      ? await resolveDirectTarget(client, ticketId)
      : null;

  if (!target) {
    return NextResponse.json(
      { error: "Conversa (grupo ou direct) nao encontrada." },
      { status: 404 },
    );
  }

  const operatorLabel = await readOperatorLabel(client, user.id);

  if (input.action === "react") {
    return reactInConversation({
      client,
      emoji: typeof input.emoji === "string" ? input.emoji : "",
      messageId: typeof input.messageId === "string" ? input.messageId : "",
      operatorLabel,
      target,
      userId: user.id,
    });
  }

  const body = typeof input.body === "string" ? input.body.trim() : "";
  const media = normalizeOutboundMedia(input.media);

  if (!body && !media) {
    return NextResponse.json(
      { error: "Informe o texto ou o arquivo da mensagem." },
      { status: 400 },
    );
  }

  return sendToTarget({
    body,
    client,
    media,
    mentions: normalizeMentions(input.mentions),
    operatorLabel,
    target,
    userId: user.id,
  });
}

// Menção só faz sentido em grupo. { everyone } = @todos; { phones } = pessoas.
function normalizeMentions(
  value: unknown,
): { everyone?: boolean; phones?: string[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (record.everyone === true) {
    return { everyone: true };
  }

  const phones = Array.isArray(record.phones)
    ? record.phones
        .filter((phone): phone is string => typeof phone === "string")
        .map((phone) => phone.replace(/\D/g, ""))
        .filter(Boolean)
    : [];

  return phones.length ? { phones } : null;
}

async function resolveGroupTarget(
  client: any,
  groupId: string,
): Promise<SendTarget | null> {
  const { data } = await client
    .from("caredesk_whatsapp_groups")
    .select("id,group_jid")
    .eq("id", groupId)
    .maybeSingle();

  if (!data) {
    return null;
  }

  return {
    sendNumber: data.group_jid,
    reactionJid: data.group_jid,
    ownerColumn: "group_id",
    ownerId: data.id,
    ticketId: null,
    sign: true,
  };
}

async function resolveDirectTarget(
  client: any,
  ticketId: string,
): Promise<SendTarget | null> {
  const { data: ticket } = await client
    .from("caredesk_tickets")
    .select("id,contact_id,source_entity_type,source_entity_id")
    .eq("id", ticketId)
    .maybeSingle();

  if (!ticket || ticket.source_entity_type !== "whatsapp-direct") {
    return null;
  }

  // O telefone é o source_entity_id; se faltar, busca no contato.
  let phone: string | null =
    typeof ticket.source_entity_id === "string" ? ticket.source_entity_id : null;

  if (!phone && ticket.contact_id) {
    const { data: contact } = await client
      .from("caredesk_contacts")
      .select("whatsapp_phone,phone")
      .eq("id", ticket.contact_id)
      .maybeSingle();
    phone = contact?.whatsapp_phone ?? contact?.phone ?? null;
  }

  if (!phone) {
    return null;
  }

  return {
    sendNumber: phone,
    reactionJid: `${phone}${DIRECT_JID_SUFFIX}`,
    ownerColumn: "ticket_id",
    ownerId: ticket.id,
    ticketId: ticket.id,
    sign: false,
  };
}

async function sendToTarget({
  body,
  client,
  media,
  mentions,
  operatorLabel,
  target,
  userId,
}: {
  body: string;
  client: any;
  media: OutboundMedia | null;
  mentions: { everyone?: boolean; phones?: string[] } | null;
  operatorLabel: string;
  target: SendTarget;
  userId: string;
}) {
  // Grupo assina com o nome (quem fala é o número compartilhado); direct vai limpo.
  const text = target.sign ? signWhatsAppBody(operatorLabel, body) : body;
  // Menção só em grupo (target.sign identifica grupo); no direct 1:1 não faz sentido.
  const effectiveMentions = target.sign ? mentions : null;

  const sent = media
    ? media.type === "audio"
      ? await sendEvolutionGroupAudio({
          base64: media.base64,
          groupJid: target.sendNumber,
        })
      : await sendEvolutionGroupMedia({
          base64: media.base64,
          caption: text,
          fileName: media.fileName,
          groupJid: target.sendNumber,
          mediatype: media.type,
          mentions: effectiveMentions,
          mimeType: media.mimeType,
        })
    : await sendEvolutionGroupText({
        groupJid: target.sendNumber,
        mentions: effectiveMentions,
        text,
      });

  if (!sent.ok) {
    return NextResponse.json({ error: sent.error }, { status: 502 });
  }

  const mediaPayload = media
    ? {
        durationMs: media.durationMs,
        fileName: media.fileName,
        mimeType: media.mimeType,
        type: media.type,
        url: await uploadOutboundMedia(client, media),
      }
    : null;

  const channelId = await readRelacionamentoChannelId(client);
  const now = new Date().toISOString();

  const { data: message, error } = await client
    .from("caredesk_messages")
    .insert({
      body,
      channel_id: channelId,
      delivery_status: "sent",
      direction: "outbound",
      external_message_id: sent.providerMessageId,
      [target.ownerColumn]: target.ownerId,
      message_type: media?.type ?? "text",
      provider_payload: {
        media: mediaPayload,
        operatorLabel,
        provider: "evolution",
        source_module: "iris",
      },
      sender_type: "operator",
      sender_user_id: userId,
      sent_at: now,
    })
    .select(MESSAGE_SELECT)
    .single();

  if (error) {
    return NextResponse.json(
      {
        error:
          "Mensagem enviada, mas nao foi possivel registra-la na conversa.",
      },
      { status: 500 },
    );
  }

  if (target.ticketId) {
    // Direct: TODA resposta nossa tira o ticket de "Pendente" (aguardando o
    // cliente). Antes isso só rodava na 1ª resposta — da 2ª em diante o ticket
    // voltava a parecer pendente mesmo respondido.
    await client
      .from("caredesk_tickets")
      .update({ status: "waiting_customer", updated_at: now })
      .eq("id", target.ticketId);
    // first_responded_at é da PRIMEIRA resposta: só grava se ainda não tem.
    await client
      .from("caredesk_tickets")
      .update({ first_responded_at: now })
      .eq("id", target.ticketId)
      .is("first_responded_at", null);
  } else {
    await client
      .from("caredesk_whatsapp_groups")
      .update({ last_message_at: now, updated_at: now })
      .eq("id", target.ownerId);
  }

  return NextResponse.json(
    { ok: true, message },
    { headers: { "Cache-Control": "no-store" }, status: 200 },
  );
}

async function reactInConversation({
  client,
  emoji,
  messageId,
  operatorLabel,
  target,
  userId,
}: {
  client: any;
  emoji: string;
  messageId: string;
  operatorLabel: string;
  target: SendTarget;
  userId: string;
}) {
  if (!emoji || !messageId) {
    return NextResponse.json(
      { error: "Informe a mensagem e o emoji." },
      { status: 400 },
    );
  }

  const { data: existing } = await client
    .from("caredesk_messages")
    .select("id,direction,external_message_id,provider_payload")
    .eq("id", messageId)
    .eq(target.ownerColumn, target.ownerId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: "Mensagem nao encontrada na conversa." },
      { status: 404 },
    );
  }

  const payload =
    existing.provider_payload &&
    typeof existing.provider_payload === "object" &&
    !Array.isArray(existing.provider_payload)
      ? (existing.provider_payload as Record<string, unknown>)
      : {};

  const currentReactions = Array.isArray(payload.reactions)
    ? (payload.reactions as Record<string, unknown>[]).filter(
        (reaction) =>
          reaction && typeof reaction === "object" && !Array.isArray(reaction),
      )
    : [];

  const alreadySame = currentReactions.some(
    (reaction) => reaction.actorUserId === userId && reaction.emoji === emoji,
  );
  const withoutCurrentUser = currentReactions.filter(
    (reaction) => reaction.actorUserId !== userId,
  );

  const nextReactions = alreadySame
    ? withoutCurrentUser
    : [
        ...withoutCurrentUser,
        {
          actorLabel: operatorLabel,
          actorUserId: userId,
          createdAt: new Date().toISOString(),
          emoji,
        },
      ];

  if (existing.external_message_id) {
    const sent = await sendEvolutionGroupReaction({
      emoji: alreadySame ? "" : emoji,
      fromMe: existing.direction === "outbound",
      groupJid: target.reactionJid,
      providerMessageId: existing.external_message_id,
    });

    if (!sent.ok) {
      return NextResponse.json({ error: sent.error }, { status: 502 });
    }
  }

  const { data: message, error } = await client
    .from("caredesk_messages")
    .update({ provider_payload: { ...payload, reactions: nextReactions } })
    .eq("id", existing.id)
    .select(MESSAGE_SELECT)
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel registrar a reacao." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, message },
    { headers: { "Cache-Control": "no-store" }, status: 200 },
  );
}

async function readOperatorLabel(client: any, userId: string) {
  const { data } = await client
    .from("hub_users")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  const displayName = data?.display_name;

  return typeof displayName === "string" && displayName.trim()
    ? displayName.trim()
    : "Operador Iris";
}

async function readRelacionamentoChannelId(client: any) {
  const { data } = await client
    .from("caredesk_channels")
    .select("id")
    .eq("slug", "whatsapp-grupo")
    .maybeSingle();

  return typeof data?.id === "string" ? data.id : null;
}

async function uploadOutboundMedia(client: any, media: OutboundMedia) {
  try {
    const persisted = await uploadIrisMediaBuffer({
      buffer: Buffer.from(media.base64, "base64"),
      client,
      folder: "outbound",
      mimeType: media.mimeType,
      name: crypto.randomUUID(),
    });

    return persisted?.url ?? null;
  } catch (error) {
    console.error("[iris] falha ao persistir midia enviada (relacionamento)", error);

    return null;
  }
}

// O cliente manda { dataUrl, fileName, mimeType, type, durationMs } — mesmo
// contrato do caminho do Meta.
function normalizeOutboundMedia(value: unknown): OutboundMedia | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";
  const type = record.type;

  if (
    !dataUrl ||
    (type !== "audio" && type !== "document" && type !== "image")
  ) {
    return null;
  }

  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);

  if (!match || !match[2]) {
    return null;
  }

  const mimeType =
    (typeof record.mimeType === "string" && record.mimeType) ||
    match[1] ||
    "application/octet-stream";

  const durationMs =
    typeof record.durationMs === "number" && Number.isFinite(record.durationMs)
      ? record.durationMs
      : null;

  return {
    base64: match[2],
    durationMs,
    fileName:
      typeof record.fileName === "string" && record.fileName.trim()
        ? record.fileName.trim()
        : "arquivo",
    mimeType,
    type,
  };
}
