import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchEvolutionGroupInfo } from "@/lib/iris/evolution-api";

// Ingestão READ-ONLY de mensagens de grupo vindas da Evolution API
// (instância caca-observadora). Modelo: 1 grupo = 1 conversa contínua na fila
// "Grupos". A CACÁ apenas observa — nada é respondido nem enviado ao grupo.

type EvolutionClient = SupabaseClient;

const GROUP_CHANNEL_SLUG = "whatsapp-grupo";
const GROUP_QUEUE_SLUG = "grupos-whatsapp";
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
  // Só nos interessa a chegada de mensagens novas.
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
  const queue = await getQueueBySlug(client, GROUP_QUEUE_SLUG);
  const workspaceId = await getDefaultWorkspaceId(client);

  for (const message of messages) {
    // Observador puro: ignora eco de mensagens do próprio número.
    if (message.fromMe) {
      result.skipped += 1;
      continue;
    }

    try {
      const alreadyStored = await messageAlreadyStored(client, message.messageId);
      if (alreadyStored) {
        result.skipped += 1;
        continue;
      }

      const group = await ensureGroupConversation({
        client,
        message,
        instance,
        channelId: channel?.id ?? null,
        queue,
        workspaceId,
      });

      await insertGroupMessage({
        client,
        message,
        channelId: channel?.id ?? null,
        ticketId: group.ticketId,
        contactId: group.contactId,
      });

      await touchGroupAndTicket({
        client,
        group,
        message,
      });

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

async function getQueueBySlug(client: EvolutionClient, slug: string) {
  const { data } = await client
    .from("caredesk_queues")
    .select(
      "id,default_priority,sla_first_response_minutes,sla_resolution_minutes",
    )
    .eq("slug", slug)
    .maybeSingle<{
      id: string;
      default_priority: string | null;
      sla_first_response_minutes: number | null;
      sla_resolution_minutes: number | null;
    }>();
  return data ?? null;
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

type GroupConversation = {
  groupId: string;
  ticketId: string;
  contactId: string;
};

async function ensureGroupConversation({
  client,
  message,
  instance,
  channelId,
  queue,
  workspaceId,
}: {
  client: EvolutionClient;
  message: NormalizedGroupMessage;
  instance: string;
  channelId: string | null;
  queue: {
    id: string;
    default_priority: string | null;
    sla_first_response_minutes: number | null;
    sla_resolution_minutes: number | null;
  } | null;
  workspaceId: string | null;
}): Promise<GroupConversation> {
  const existing = await client
    .from("caredesk_whatsapp_groups")
    .select("id,ticket_id,contact_id,subject")
    .eq("group_jid", message.groupJid)
    .maybeSingle<{
      id: string;
      ticket_id: string | null;
      contact_id: string | null;
      subject: string | null;
    }>();

  const existingRow = existing.data;
  if (existingRow?.ticket_id && existingRow.contact_id) {
    return {
      groupId: existingRow.id,
      ticketId: existingRow.ticket_id,
      contactId: existingRow.contact_id,
    };
  }

  // Nome do grupo não vem no messages.upsert — busca na Evolution (best-effort)
  // para dar título à conversa. Se falhar, cai no título genérico.
  const groupInfo = existingRow?.subject
    ? null
    : await fetchEvolutionGroupInfo(message.groupJid);
  const resolvedSubject = existingRow?.subject ?? groupInfo?.subject ?? null;

  // Contato sintético = o próprio grupo (título da conversa no cockpit).
  const contactId =
    existingRow?.contact_id ??
    (await ensureGroupContact({
      client,
      groupJid: message.groupJid,
      subject: resolvedSubject,
    }));

  const ticketId =
    existingRow?.ticket_id ??
    (await createGroupTicket({
      client,
      message,
      contactId,
      channelId,
      queue,
      workspaceId,
      subject: resolvedSubject,
    }));

  if (existingRow) {
    await client
      .from("caredesk_whatsapp_groups")
      .update({
        contact_id: contactId,
        ticket_id: ticketId,
        channel_id: channelId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingRow.id);
    return { groupId: existingRow.id, ticketId, contactId };
  }

  const inserted = await client
    .from("caredesk_whatsapp_groups")
    .insert({
      group_jid: message.groupJid,
      subject: resolvedSubject,
      participants_count: groupInfo?.size ?? null,
      evolution_instance: instance,
      channel_id: channelId,
      ticket_id: ticketId,
      contact_id: contactId,
      monitored: true,
      last_message_at: message.sentAt,
    })
    .select("id")
    .single<{ id: string }>();

  if (inserted.error) {
    throw inserted.error;
  }

  return { groupId: inserted.data.id, ticketId, contactId };
}

async function ensureGroupContact({
  client,
  groupJid,
  subject,
}: {
  client: EvolutionClient;
  groupJid: string;
  subject: string | null;
}): Promise<string> {
  const existing = await client
    .from("caredesk_contacts")
    .select("id")
    .eq("whatsapp_phone", groupJid)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existing.data) {
    return existing.data.id;
  }

  const inserted = await client
    .from("caredesk_contacts")
    .insert({
      display_name: subject?.trim() || "Grupo de WhatsApp",
      whatsapp_phone: groupJid,
      metadata: { source: "whatsapp-group", groupJid },
    })
    .select("id")
    .single<{ id: string }>();

  if (inserted.error) {
    throw inserted.error;
  }

  return inserted.data.id;
}

async function createGroupTicket({
  client,
  message,
  contactId,
  channelId,
  queue,
  workspaceId,
  subject,
}: {
  client: EvolutionClient;
  message: NormalizedGroupMessage;
  contactId: string;
  channelId: string | null;
  queue: {
    id: string;
    default_priority: string | null;
    sla_first_response_minutes: number | null;
    sla_resolution_minutes: number | null;
  } | null;
  workspaceId: string | null;
  subject: string | null;
}): Promise<string> {
  const protocol = await nextTicketProtocol(client);
  const now = message.sentAt || new Date().toISOString();

  const inserted = await client
    .from("caredesk_tickets")
    .insert({
      channel_id: channelId,
      contact_id: contactId,
      metadata: {
        provider: "evolution",
        source: "whatsapp_group_monitor",
        groupJid: message.groupJid,
        lastGroupMessageAt: now,
      },
      opened_at: now,
      priority: queue?.default_priority ?? "medium",
      protocol,
      queue_id: queue?.id ?? null,
      source_context: {
        provider: "evolution",
        groupJid: message.groupJid,
        readOnly: true,
      },
      source_entity_id: message.groupJid,
      source_entity_type: "whatsapp-group",
      source_module: "iris",
      status: "open",
      subject,
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

async function insertGroupMessage({
  client,
  message,
  channelId,
  ticketId,
  contactId,
}: {
  client: EvolutionClient;
  message: NormalizedGroupMessage;
  channelId: string | null;
  ticketId: string;
  contactId: string;
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
    message_type: message.messageType,
    provider_payload: providerPayload,
    sender_contact_id: contactId,
    sender_type: "customer",
    sent_at: message.sentAt,
    ticket_id: ticketId,
  });

  if (error) {
    throw error;
  }
}

async function touchGroupAndTicket({
  client,
  group,
  message,
}: {
  client: EvolutionClient;
  group: GroupConversation;
  message: NormalizedGroupMessage;
}) {
  await client
    .from("caredesk_whatsapp_groups")
    .update({
      last_message_at: message.sentAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", group.groupId);

  await client
    .from("caredesk_tickets")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", group.ticketId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
