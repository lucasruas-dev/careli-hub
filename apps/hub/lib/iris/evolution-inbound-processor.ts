import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchEvolutionGroupInfo } from "@/lib/iris/evolution-api";

// Ingestão de mensagens de grupo vindas da Evolution API (instância
// caca-observadora).
//
// ARQUITETURA (decisão do Lucas, 14/jul): grupo NÃO é atendimento. Não existe
// ticket, nem encerramento, nem SLA. O GRUPO é a entidade-âncora (id + código
// GRP-xxxx) e as mensagens penduram direto nele (caredesk_messages.group_id).
// Mais pra frente, as atividades/demandas detectadas no grupo é que viram
// ticket próprio, vinculado ao grupo.

type EvolutionClient = SupabaseClient;

const GROUP_CHANNEL_SLUG = "whatsapp-grupo";
const GROUP_JID_SUFFIX = "@g.us";
const DEFAULT_INSTANCE = "caca-observadora";

type Json =
  | boolean
  | number
  | string
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type EvolutionWebhookBody = {
  event?: string | null;
  instance?: string | null;
  data?: unknown;
};

type NormalizedGroupMessage = {
  groupJid: string;
  messageId: string;
  senderJid: string | null;
  senderName: string | null;
  body: string;
  messageType: string;
  sentAt: string;
  fromMe: boolean;
  raw: Record<string, unknown>;
};

export type EvolutionProcessingResult = {
  received: number;
  ingested: number;
  skipped: number;
  errors: number;
};

export async function processEvolutionWebhook({
  client,
  body,
}: {
  client: EvolutionClient;
  body: EvolutionWebhookBody;
}): Promise<EvolutionProcessingResult> {
  const result: EvolutionProcessingResult = {
    received: 0,
    ingested: 0,
    skipped: 0,
    errors: 0,
  };

  const event = typeof body.event === "string" ? body.event : "";
  if (event !== "messages.upsert") {
    return result;
  }

  const instance =
    typeof body.instance === "string" && body.instance.trim()
      ? body.instance.trim()
      : DEFAULT_INSTANCE;

  const items = Array.isArray(body.data) ? body.data : [body.data];
  const messages: NormalizedGroupMessage[] = [];
  for (const item of items) {
    const normalized = normalizeGroupMessage(item);
    if (normalized) {
      messages.push(normalized);
    }
  }
  result.received = messages.length;

  if (messages.length === 0) {
    return result;
  }

  const channel = await getChannelBySlug(client, GROUP_CHANNEL_SLUG);

  for (const message of messages) {
    // Eco da própria mensagem enviada pelo número observador — já está gravada.
    if (message.fromMe) {
      result.skipped += 1;
      continue;
    }

    try {
      if (await messageAlreadyStored(client, message.messageId)) {
        result.skipped += 1;
        continue;
      }

      const groupId = await ensureGroup({ client, message, instance });

      await insertGroupMessage({
        client,
        message,
        channelId: channel?.id ?? null,
        groupId,
      });

      await client
        .from("caredesk_whatsapp_groups")
        .update({
          last_message_at: message.sentAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", groupId);

      result.ingested += 1;
    } catch {
      result.errors += 1;
    }
  }

  return result;
}

function normalizeGroupMessage(item: unknown): NormalizedGroupMessage | null {
  if (!isRecord(item)) {
    return null;
  }

  const key = isRecord(item.key) ? item.key : null;
  const remoteJid = key && typeof key.remoteJid === "string" ? key.remoteJid : "";
  if (!remoteJid.endsWith(GROUP_JID_SUFFIX)) {
    return null;
  }

  const messageId = key && typeof key.id === "string" ? key.id : "";
  if (!messageId) {
    return null;
  }

  const fromMe = Boolean(key && key.fromMe === true);
  const senderJid =
    key && typeof key.participant === "string" ? key.participant : null;
  const senderName =
    typeof item.pushName === "string" && item.pushName.trim()
      ? item.pushName.trim()
      : null;

  const { body, messageType } = extractMessageContent(item);

  return {
    groupJid: remoteJid,
    messageId,
    senderJid,
    senderName,
    body,
    messageType,
    sentAt: resolveTimestamp(item.messageTimestamp),
    fromMe,
    raw: item,
  };
}

function extractMessageContent(item: Record<string, unknown>): {
  body: string;
  messageType: string;
} {
  const message = isRecord(item.message) ? item.message : null;
  const declaredType =
    typeof item.messageType === "string" ? item.messageType : "";

  if (message) {
    if (typeof message.conversation === "string") {
      return { body: message.conversation, messageType: "text" };
    }
    const extended = isRecord(message.extendedTextMessage)
      ? message.extendedTextMessage
      : null;
    if (extended && typeof extended.text === "string") {
      return { body: extended.text, messageType: "text" };
    }
    const imageCaption = captionOf(message.imageMessage);
    if (imageCaption !== null) {
      return { body: imageCaption || "[imagem]", messageType: "image" };
    }
    const videoCaption = captionOf(message.videoMessage);
    if (videoCaption !== null) {
      return { body: videoCaption || "[vídeo]", messageType: "video" };
    }
    if (isRecord(message.audioMessage)) {
      return { body: "[áudio]", messageType: "audio" };
    }
    if (isRecord(message.documentMessage)) {
      return { body: "[documento]", messageType: "document" };
    }
    if (isRecord(message.stickerMessage)) {
      return { body: "[figurinha]", messageType: "sticker" };
    }
  }

  return {
    body: declaredType ? `[${declaredType}]` : "[mensagem]",
    messageType: declaredType || "unknown",
  };
}

function captionOf(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  return typeof value.caption === "string" ? value.caption : "";
}

function resolveTimestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return new Date(Number(value) * 1000).toISOString();
  }
  return new Date().toISOString();
}

async function getChannelBySlug(client: EvolutionClient, slug: string) {
  const { data } = await client
    .from("caredesk_channels")
    .select("id")
    .eq("slug", slug)
    .maybeSingle<{ id: string }>();
  return data ?? null;
}

async function messageAlreadyStored(
  client: EvolutionClient,
  externalMessageId: string,
) {
  const { data } = await client
    .from("caredesk_messages")
    .select("id")
    .eq("external_message_id", externalMessageId)
    .limit(1)
    .maybeSingle<{ id: string }>();
  return Boolean(data);
}

// O grupo é criado na primeira mensagem. O nome não vem no messages.upsert:
// buscamos na Evolution (best-effort). O código GRP-xxxx sai do default no banco.
async function ensureGroup({
  client,
  message,
  instance,
}: {
  client: EvolutionClient;
  message: NormalizedGroupMessage;
  instance: string;
}): Promise<string> {
  const existing = await client
    .from("caredesk_whatsapp_groups")
    .select("id")
    .eq("group_jid", message.groupJid)
    .maybeSingle<{ id: string }>();

  if (existing.data) {
    return existing.data.id;
  }

  const info = await fetchEvolutionGroupInfo(message.groupJid);

  const inserted = await client
    .from("caredesk_whatsapp_groups")
    .insert({
      group_jid: message.groupJid,
      subject: info?.subject ?? null,
      participants_count: info?.size ?? null,
      evolution_instance: instance,
      monitored: true,
      last_message_at: message.sentAt,
    })
    .select("id")
    .single<{ id: string }>();

  if (inserted.error) {
    throw inserted.error;
  }

  return inserted.data.id;
}

async function insertGroupMessage({
  client,
  message,
  channelId,
  groupId,
}: {
  client: EvolutionClient;
  message: NormalizedGroupMessage;
  channelId: string | null;
  groupId: string;
}) {
  const providerPayload: Record<string, Json> = {
    provider: "evolution",
    groupJid: message.groupJid,
    groupParticipant: message.senderJid,
    groupParticipantName: message.senderName,
    evolutionMessageType: message.messageType,
    raw: message.raw as Json,
  };

  const { error } = await client.from("caredesk_messages").insert({
    body: message.body,
    channel_id: channelId,
    delivery_status: "delivered",
    direction: "inbound",
    external_message_id: message.messageId,
    group_id: groupId,
    message_type: message.messageType,
    provider_payload: providerPayload,
    sender_type: "customer",
    sent_at: message.sentAt,
    ticket_id: null,
  });

  if (error) {
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
