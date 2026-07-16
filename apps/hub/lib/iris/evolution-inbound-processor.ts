import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchEvolutionGroupInfo } from "@/lib/iris/evolution-api";

// Ingestão de mensagens do número de Relacionamento (6566) via Evolution API.
//
// Dois mundos, decisão do Lucas:
//  • GRUPO (@g.us): NÃO é ticket. Entidade própria (GRP-xxxx), read-only, só
//    organização. As mensagens penduram direto no grupo (group_id).
//  • DIRECT (@s.whatsapp.net): atendimento 1:1 normal (ticket, SLA, encerramento)
//    na fila "Direct", MAS sem template nem janela de 24h (é Evolution, não Meta).
//
// `fromMe` (mensagem que sai pelo próprio 6566, seja pela Iris ou pelo celular do
// time) NÃO é mais descartado: entra como SAÍDA. O eco dos envios feitos pela Iris
// é deduplicado por external_message_id — então o que o time responde direto do
// celular passa a aparecer, sem duplicar.

type EvolutionClient = SupabaseClient;

const RELACIONAMENTO_CHANNEL_SLUG = "whatsapp-grupo";
const DIRECT_QUEUE_SLUG = "relacionamento-direct";
const GROUP_JID_SUFFIX = "@g.us";
const DIRECT_JID_SUFFIX = "@s.whatsapp.net";
const DEFAULT_INSTANCE = "caca-observadora";
const CLOSED_TICKET_STATUSES = ["cancelled", "closed", "resolved"];

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

type NormalizedMessage = {
  isGroup: boolean;
  chatJid: string; // remoteJid: grupo (@g.us) ou contato (@s.whatsapp.net)
  contactPhone: string | null; // só direct: dígitos do número da pessoa
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
  const messages: NormalizedMessage[] = [];
  for (const item of items) {
    const normalized = normalizeMessage(item);
    if (normalized) {
      messages.push(normalized);
    }
  }
  result.received = messages.length;

  if (messages.length === 0) {
    return result;
  }

  const channel = await getChannelBySlug(client, RELACIONAMENTO_CHANNEL_SLUG);

  for (const message of messages) {
    try {
      // Eco de envio (fromMe) OU reprocesso: se já gravamos, pula (dedup).
      if (await messageAlreadyStored(client, message.messageId)) {
        result.skipped += 1;
        continue;
      }

      if (message.isGroup) {
        await ingestGroupMessage({
          client,
          message,
          instance,
          channelId: channel?.id ?? null,
        });
      } else {
        await ingestDirectMessage({
          client,
          message,
          channelId: channel?.id ?? null,
        });
      }

      result.ingested += 1;
    } catch {
      result.errors += 1;
    }
  }

  return result;
}

// ─────────────────────────────── GRUPO ───────────────────────────────

async function ingestGroupMessage({
  client,
  message,
  instance,
  channelId,
}: {
  client: EvolutionClient;
  message: NormalizedMessage;
  instance: string;
  channelId: string | null;
}) {
  const groupId = await ensureGroup({ client, message, instance });

  const outbound = message.fromMe;
  const providerPayload: Record<string, Json> = {
    provider: "evolution",
    groupJid: message.chatJid,
    groupParticipant: message.senderJid,
    groupParticipantName: message.senderName,
    evolutionMessageType: message.messageType,
    raw: message.raw as Json,
  };

  const { error } = await client.from("caredesk_messages").insert({
    body: message.body,
    channel_id: channelId,
    delivery_status: "delivered",
    direction: outbound ? "outbound" : "inbound",
    external_message_id: message.messageId,
    group_id: groupId,
    message_type: message.messageType,
    provider_payload: providerPayload,
    sender_type: outbound ? "operator" : "customer",
    sent_at: message.sentAt,
    ticket_id: null,
  });
  if (error) {
    throw error;
  }

  await client
    .from("caredesk_whatsapp_groups")
    .update({
      last_message_at: message.sentAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", groupId);
}

// O grupo é criado na primeira mensagem. O nome não vem no messages.upsert:
// buscamos na Evolution (best-effort). O código GRP-xxxx sai do default no banco.
async function ensureGroup({
  client,
  message,
  instance,
}: {
  client: EvolutionClient;
  message: NormalizedMessage;
  instance: string;
}): Promise<string> {
  const existing = await client
    .from("caredesk_whatsapp_groups")
    .select("id")
    .eq("group_jid", message.chatJid)
    .maybeSingle<{ id: string }>();

  if (existing.data) {
    return existing.data.id;
  }

  const info = await fetchEvolutionGroupInfo(message.chatJid);

  const inserted = await client
    .from("caredesk_whatsapp_groups")
    .insert({
      group_jid: message.chatJid,
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

// ─────────────────────────────── DIRECT (1:1) ───────────────────────────────

async function ingestDirectMessage({
  client,
  message,
  channelId,
}: {
  client: EvolutionClient;
  message: NormalizedMessage;
  channelId: string | null;
}) {
  const phone = message.contactPhone;
  if (!phone) {
    return;
  }

  const outbound = message.fromMe;
  const contactId = await findOrCreateDirectContact({
    client,
    phone,
    name: outbound ? null : message.senderName,
  });

  const queue = await getDirectQueue(client);
  const workspaceId = await getDefaultWorkspaceId(client);

  const ticketId = await ensureOpenDirectTicket({
    client,
    contactId,
    channelId,
    queue,
    workspaceId,
    message,
  });

  const providerPayload: Record<string, Json> = {
    provider: "evolution",
    contactPhone: phone,
    evolutionMessageType: message.messageType,
    raw: message.raw as Json,
  };

  const { error } = await client.from("caredesk_messages").insert({
    body: message.body,
    channel_id: channelId,
    delivery_status: "delivered",
    direction: outbound ? "outbound" : "inbound",
    external_message_id: message.messageId,
    message_type: message.messageType,
    provider_payload: providerPayload,
    sender_contact_id: outbound ? null : contactId,
    sender_type: outbound ? "operator" : "customer",
    sent_at: message.sentAt,
    ticket_id: ticketId,
  });
  if (error) {
    throw error;
  }

  // Resposta (nossa) marca a primeira resposta; mensagem do cliente reabre.
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (outbound) {
    patch.status = "waiting_customer";
    patch.first_responded_at = message.sentAt;
  } else {
    patch.status = "open";
  }
  await client.from("caredesk_tickets").update(patch).eq("id", ticketId);
}

async function findOrCreateDirectContact({
  client,
  phone,
  name,
}: {
  client: EvolutionClient;
  phone: string;
  name: string | null;
}): Promise<string> {
  const existing = await client
    .from("caredesk_contacts")
    .select("id")
    .eq("whatsapp_phone", phone)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existing.data) {
    return existing.data.id;
  }

  const inserted = await client
    .from("caredesk_contacts")
    .insert({
      display_name: name?.trim() || phone,
      whatsapp_phone: phone,
      phone,
      metadata: { source: "evolution-direct" },
    })
    .select("id")
    .single<{ id: string }>();

  if (inserted.error) {
    throw inserted.error;
  }

  return inserted.data.id;
}

type DirectQueue = {
  id: string;
  default_priority: string | null;
  sla_first_response_minutes: number | null;
  sla_resolution_minutes: number | null;
} | null;

async function getDirectQueue(client: EvolutionClient): Promise<DirectQueue> {
  const { data } = await client
    .from("caredesk_queues")
    .select(
      "id,default_priority,sla_first_response_minutes,sla_resolution_minutes",
    )
    .eq("slug", DIRECT_QUEUE_SLUG)
    .maybeSingle<NonNullable<DirectQueue>>();
  return data ?? null;
}

async function ensureOpenDirectTicket({
  client,
  contactId,
  channelId,
  queue,
  workspaceId,
  message,
}: {
  client: EvolutionClient;
  contactId: string;
  channelId: string | null;
  queue: DirectQueue;
  workspaceId: string | null;
  message: NormalizedMessage;
}): Promise<string> {
  const open = await client
    .from("caredesk_tickets")
    .select("id")
    .eq("contact_id", contactId)
    .eq("source_entity_type", "whatsapp-direct")
    .not("status", "in", `(${CLOSED_TICKET_STATUSES.join(",")})`)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (open.data) {
    return open.data.id;
  }

  const protocol = await nextTicketProtocol(client);
  const now = message.sentAt || new Date().toISOString();
  const firstMinutes = queue?.sla_first_response_minutes ?? 60;
  const resolutionMinutes = queue?.sla_resolution_minutes ?? 480;

  const inserted = await client
    .from("caredesk_tickets")
    .insert({
      channel_id: channelId,
      contact_id: contactId,
      first_response_due_at: addMinutes(now, firstMinutes),
      metadata: { provider: "evolution", source: "whatsapp_direct" },
      opened_at: now,
      priority: queue?.default_priority ?? "medium",
      protocol,
      queue_id: queue?.id ?? null,
      resolution_due_at: addMinutes(now, resolutionMinutes),
      source_context: { provider: "evolution", contactPhone: message.contactPhone },
      source_entity_id: message.contactPhone,
      source_entity_type: "whatsapp-direct",
      source_module: "iris",
      status: "new",
      subject: null,
      workspace_id: workspaceId,
    })
    .select("id")
    .single<{ id: string }>();

  if (inserted.error) {
    throw inserted.error;
  }

  return inserted.data.id;
}

async function nextTicketProtocol(client: EvolutionClient): Promise<string> {
  const { data, error } = await client.rpc("next_caredesk_ticket_protocol");
  if (error || typeof data !== "string" || !data.startsWith("AT-")) {
    throw new Error(
      "Sequencia de protocolo AT da Iris nao esta configurada no banco.",
    );
  }
  return data;
}

async function getDefaultWorkspaceId(client: EvolutionClient) {
  const { data } = await client
    .from("hub_workspaces")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

// ─────────────────────────────── COMUM ───────────────────────────────

function normalizeMessage(item: unknown): NormalizedMessage | null {
  if (!isRecord(item)) {
    return null;
  }

  const key = isRecord(item.key) ? item.key : null;
  const remoteJid =
    key && typeof key.remoteJid === "string" ? key.remoteJid : "";

  const isGroup = remoteJid.endsWith(GROUP_JID_SUFFIX);
  const isDirect = remoteJid.endsWith(DIRECT_JID_SUFFIX);
  if (!isGroup && !isDirect) {
    return null; // status@broadcast, newsletter, etc.
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
    isGroup,
    chatJid: remoteJid,
    contactPhone: isDirect ? remoteJid.replace(DIRECT_JID_SUFFIX, "") : null,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
