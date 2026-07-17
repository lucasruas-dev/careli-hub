import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchEvolutionGroupInfo,
  fetchEvolutionMediaBase64,
} from "@/lib/iris/evolution-api";
import { uploadInboundMediaBuffer } from "@/lib/iris/meta-media-storage";

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
  hasMedia: boolean;
  mimeType: string | null;
  fileName: string | null;
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

  // Alimenta a lista de menção (@): quem fala vira participante conhecido, e é
  // daqui que sai o NOME (o WhatsApp não devolve nome na lista de participantes).
  await rememberGroupParticipant({ client, groupId, message });

  const outbound = message.fromMe;
  const providerPayload: Record<string, Json> = {
    provider: "evolution",
    groupJid: message.chatJid,
    groupParticipant: message.senderJid,
    groupParticipantName: message.senderName,
    evolutionMessageType: message.messageType,
    media: await persistInboundMedia(client, message),
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

// Participante do grupo: o número sai do JID de quem enviou; o nome, do pushName.
// Só a mensagem tem nome — a lista de participantes do WhatsApp vem sem.
// Best-effort: nunca derruba a ingestão da mensagem.
async function rememberGroupParticipant({
  client,
  groupId,
  message,
}: {
  client: EvolutionClient;
  groupId: string;
  message: NormalizedMessage;
}) {
  const phone = jidToPhone(message.senderJid);

  if (!phone) {
    return;
  }

  try {
    const patch: Record<string, unknown> = {
      group_id: groupId,
      phone,
      updated_at: new Date().toISOString(),
    };

    // Só sobrescreve o nome quando temos um (evita apagar nome já conhecido).
    if (message.senderName) {
      patch.display_name = message.senderName;
    }

    await client
      .from("caredesk_whatsapp_group_participants")
      .upsert(patch, { onConflict: "group_id,phone" });
  } catch (error) {
    console.error("[iris] falha ao registrar participante do grupo", error);
  }
}

// "5531999998888@s.whatsapp.net" -> "5531999998888". Ignora @lid (id interno do
// WhatsApp, que não serve pra mencionar).
function jidToPhone(jid: string | null): string | null {
  if (!jid || !jid.includes("@s.whatsapp.net")) {
    return null;
  }

  const phone = jid.split("@")[0]?.replace(/\D/g, "") ?? "";

  return phone || null;
}

// Semeia os participantes a partir da lista do WhatsApp (só números — o nome vem
// depois, de quem falar). Best-effort.
async function seedGroupParticipants({
  client,
  groupId,
  participants,
}: {
  client: EvolutionClient;
  groupId: string;
  participants: { phoneNumber: string | null; admin: string | null }[];
}) {
  const rows = participants
    .map((participant) => ({
      group_id: groupId,
      is_admin: Boolean(participant.admin),
      phone: jidToPhone(participant.phoneNumber),
    }))
    .filter((row) => row.phone);

  if (!rows.length) {
    return;
  }

  try {
    await client
      .from("caredesk_whatsapp_group_participants")
      .upsert(rows, { onConflict: "group_id,phone" });
  } catch (error) {
    console.error("[iris] falha ao semear participantes do grupo", error);
  }
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

  // Semeia a lista de menção (@) com os participantes do grupo (só números; o
  // nome vem depois, de quem falar).
  if (info?.participants?.length) {
    await seedGroupParticipants({
      client,
      groupId: inserted.data.id,
      participants: info.participants,
    });
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
    media: await persistInboundMedia(client, message),
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

  // Resposta nossa => aguardando o cliente; mensagem do cliente => volta a pendente.
  await client
    .from("caredesk_tickets")
    .update({
      status: outbound ? "waiting_customer" : "open",
      updated_at: new Date().toISOString(),
    })
    .eq("id", ticketId);

  // first_responded_at é da PRIMEIRA resposta: só grava se ainda não tem.
  if (outbound) {
    await client
      .from("caredesk_tickets")
      .update({ first_responded_at: message.sentAt })
      .eq("id", ticketId)
      .is("first_responded_at", null);
  }
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

  const content = extractMessageContent(item);

  return {
    isGroup,
    chatJid: remoteJid,
    contactPhone: isDirect ? remoteJid.replace(DIRECT_JID_SUFFIX, "") : null,
    messageId,
    senderJid,
    senderName,
    body: content.body,
    messageType: content.messageType,
    hasMedia: content.hasMedia,
    mimeType: content.mimeType,
    fileName: content.fileName,
    sentAt: resolveTimestamp(item.messageTimestamp),
    fromMe,
    raw: item,
  };
}

// Baixa o arquivo recebido e guarda no Storage — é o que faz o PDF/PNG/áudio
// ABRIR no cockpit (a conversa lê provider_payload.media.{url,type,fileName}).
// Best-effort: se falhar, a mensagem entra mesmo assim (só sem o anexo).
async function persistInboundMedia(
  client: EvolutionClient,
  message: NormalizedMessage,
): Promise<Json> {
  if (!message.hasMedia) {
    return null;
  }

  try {
    const downloaded = await fetchEvolutionMediaBase64(message.messageId);
    if (!downloaded) {
      // NÃO ficar em silêncio: sem este log a falha é cega (foi o que atrasou o
      // diagnóstico do "áudio não toca"). A mensagem entra mesmo assim, sem anexo.
      console.error(
        "[iris] evolution nao devolveu a midia",
        JSON.stringify({
          chatJid: message.chatJid,
          messageId: message.messageId,
          messageType: message.messageType,
        }),
      );
      return null;
    }

    const mimeType = downloaded.mimeType ?? message.mimeType;
    const persisted = await uploadInboundMediaBuffer({
      buffer: Buffer.from(downloaded.base64, "base64"),
      client,
      mediaId: message.messageId,
      mimeType,
    });

    if (!persisted?.url) {
      return null;
    }

    return {
      fileName: downloaded.fileName ?? message.fileName,
      mimeType: mimeType ?? null,
      type: message.messageType,
      url: persisted.url,
    };
  } catch (error) {
    console.error("[iris] falha ao guardar midia recebida (evolution)", error);
    return null;
  }
}

type ExtractedContent = {
  body: string;
  messageType: string;
  // Quando é mídia, guardamos o suficiente pra buscar e exibir o arquivo.
  hasMedia: boolean;
  mimeType: string | null;
  fileName: string | null;
};

function extractMessageContent(item: Record<string, unknown>): ExtractedContent {
  const message = isRecord(item.message) ? item.message : null;
  const declaredType =
    typeof item.messageType === "string" ? item.messageType : "";

  const text = (body: string, messageType: string): ExtractedContent => ({
    body,
    messageType,
    hasMedia: false,
    mimeType: null,
    fileName: null,
  });

  const media = (
    body: string,
    messageType: string,
    node: Record<string, unknown>,
    fallbackName: string,
  ): ExtractedContent => ({
    body,
    messageType,
    hasMedia: true,
    mimeType: typeof node.mimetype === "string" ? node.mimetype : null,
    fileName:
      typeof node.fileName === "string" && node.fileName.trim()
        ? node.fileName.trim()
        : fallbackName,
  });

  if (message) {
    if (typeof message.conversation === "string") {
      return text(message.conversation, "text");
    }
    const extended = isRecord(message.extendedTextMessage)
      ? message.extendedTextMessage
      : null;
    if (extended && typeof extended.text === "string") {
      return text(extended.text, "text");
    }
    if (isRecord(message.imageMessage)) {
      const caption = captionOf(message.imageMessage) || "";
      return media(caption, "image", message.imageMessage, "imagem.jpg");
    }
    if (isRecord(message.videoMessage)) {
      const caption = captionOf(message.videoMessage) || "";
      return media(caption, "video", message.videoMessage, "video.mp4");
    }
    if (isRecord(message.audioMessage)) {
      return media("", "audio", message.audioMessage, "audio.ogg");
    }
    if (isRecord(message.documentMessage)) {
      const caption = captionOf(message.documentMessage) || "";
      return media(caption, "document", message.documentMessage, "documento");
    }
    // documentWithCaptionMessage: PDF enviado com legenda (embrulha o document).
    const wrapped = isRecord(message.documentWithCaptionMessage)
      ? message.documentWithCaptionMessage
      : null;
    const wrappedInner =
      wrapped && isRecord(wrapped.message) && isRecord(wrapped.message.documentMessage)
        ? wrapped.message.documentMessage
        : null;
    if (wrappedInner) {
      const caption = captionOf(wrappedInner) || "";
      return media(caption, "document", wrappedInner, "documento");
    }
    if (isRecord(message.stickerMessage)) {
      return media("", "sticker", message.stickerMessage, "figurinha.webp");
    }
  }

  return text(declaredType ? `[${declaredType}]` : "[mensagem]", declaredType || "unknown");
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
