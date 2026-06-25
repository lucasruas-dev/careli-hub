import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CACA_AGENT_VERSION,
  readCacaAutomationState,
  runCacaAgentTurn,
  type CacaAgentTurn,
} from "@/lib/iris/caca-agent";
import {
  analyzeCacaInboundMedia,
  type CacaInboundMedia,
  type CacaInboundMediaAnalysis,
  type CacaInboundMediaType,
} from "@/lib/iris/caca-media-analysis";
import {
  getMetaWhatsAppOutboundConfig,
  type MetaWhatsAppSendMessageResult,
  sendMetaWhatsAppTextMessage,
} from "@/lib/iris/meta-whatsapp";

type Json =
  | boolean
  | number
  | string
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type IrisMetaProcessorClient = SupabaseClient;

type IrisMetaWebhookEventRow = {
  contact_name: string | null;
  contact_wa_id: string | null;
  display_phone_number: string | null;
  id: string;
  payload: Json;
  phone_number_id: string | null;
  provider_event_type: string;
  provider_message_id: string | null;
  provider_status_id: string | null;
  received_at: string;
};

type IrisContactRow = {
  c2x_payload?: Record<string, unknown> | null;
  created_at?: string | null;
  document?: string | null;
  email?: string | null;
  id: string;
  display_name: string;
  metadata: Record<string, unknown> | null;
  phone: string | null;
  updated_at?: string | null;
  whatsapp_phone: string | null;
};

type IrisQueueRow = {
  default_priority: string | null;
  id: string;
  name?: string | null;
  sla_first_response_minutes: number | null;
  sla_resolution_minutes: number | null;
  slug?: string | null;
};

type IrisTicketProfileRow = {
  id: string;
  priority: string | null;
  sla_first_response_minutes: number | null;
  sla_resolution_minutes: number | null;
};

type IrisTicketRow = {
  assigned_to_user_id?: string | null;
  channel_id?: string | null;
  closed_at?: string | null;
  contact_id?: string | null;
  id: string;
  metadata: Record<string, unknown> | null;
  opened_at?: string | null;
  queue_id?: string | null;
  resolved_at?: string | null;
  source_context?: Record<string, unknown> | null;
  status: string;
  updated_at?: string | null;
  protocol: string;
};

type InboundMessageDetail = {
  body: string;
  media?: CacaInboundMedia | null;
  mediaAnalysis?: CacaInboundMediaAnalysis | null;
  replyContextMessageId: string | null;
  messageType: string;
};

type CacaAutoReply = CacaAgentTurn;

const CLOSED_TICKET_STATUSES = new Set(["cancelled", "closed", "resolved"]);
const REOPENABLE_TICKET_STATUSES = new Set(["closed", "resolved"]);
const META_PROVIDER = "meta";
const WHATSAPP_CHANNEL_SLUG = "whatsapp-careli";
const DEFAULT_QUEUE_SLUG = "atendimento";
const CACA_OPERATOR_LABEL = "Cacá";
const CACA_AUTOMATION_METADATA_KEY = "cacaAutomation";
const CACA_TRANSFER_REASON_FALLBACK =
  "Cacá encaminhou para atendimento humano por necessidade operacional.";
const INBOUND_TICKET_SELECT =
  "id,protocol,status,metadata,source_context,assigned_to_user_id,queue_id,contact_id,channel_id,opened_at,updated_at,closed_at,resolved_at";
const INBOUND_REUSE_RETRY_DELAYS_MS = [120, 260];

export async function processMetaWhatsAppWebhookEvents({
  client,
  events,
}: {
  client: IrisMetaProcessorClient;
  events: IrisMetaWebhookEventRow[];
}) {
  const result = {
    autoRepliesSent: 0,
    failed: 0,
    ignored: 0,
    messagesCreated: 0,
    processed: 0,
    statusUpdates: 0,
    ticketsCreated: 0,
  };

  for (const event of events) {
    try {
      if (event.provider_event_type.startsWith("message:")) {
        const processed = await processInboundMessage({ client, event });

        result.autoRepliesSent += processed.autoReplySent ? 1 : 0;
        result.messagesCreated += processed.messageCreated ? 1 : 0;
        result.ticketsCreated += processed.ticketCreated ? 1 : 0;
        result.ignored += processed.ignored ? 1 : 0;
        result.processed += processed.ignored ? 0 : 1;
        continue;
      }

      if (event.provider_event_type.startsWith("status:")) {
        const updated = await processStatusUpdate({ client, event });

        result.statusUpdates += updated ? 1 : 0;
        result.ignored += updated ? 0 : 1;
        result.processed += updated ? 1 : 0;
        continue;
      }
    } catch (error) {
      result.failed += 1;
      await markWebhookEvent(client, event.id, "failed", error);
      continue;
    }

    result.ignored += 1;
    await markWebhookEvent(
      client,
      event.id,
      "ignored",
      "Evento Meta sem acao operacional neste recorte.",
    );
  }

  return result;
}

async function processInboundMessage({
  client,
  event,
}: {
  client: IrisMetaProcessorClient;
  event: IrisMetaWebhookEventRow;
}) {
  if (!event.provider_message_id) {
    await markWebhookEvent(
      client,
      event.id,
      "failed",
      "Mensagem inbound sem ID do provedor.",
    );
    return {
      autoReplySent: false,
      ignored: false,
      messageCreated: false,
      ticketCreated: false,
    };
  }

  const existingMessage = await findExistingMessage(
    client,
    event.provider_message_id,
  );

  if (existingMessage) {
    await markWebhookEvent(
      client,
      event.id,
      "ignored",
      "Mensagem Meta ja processada anteriormente.",
    );
    return {
      autoReplySent: false,
      ignored: true,
      messageCreated: false,
      ticketCreated: false,
    };
  }

  const messageDetail = extractInboundMessageDetail(
    event.payload,
    event.provider_message_id,
  );
  const workspaceId = await getDefaultWorkspaceId(client);
  const channel = await getWhatsAppChannel(client);
  const channelId = channel?.id ?? null;
  const queue = await getDefaultQueue(client);
  const profile = queue ? await getDefaultProfile(client, queue.id) : null;
  const contact = await findOrCreateContact({
    channelId,
    client,
    event,
    workspaceId,
  });
  const contactWaId = normalizeWhatsAppId(
    contact.whatsapp_phone ?? contact.phone ?? event.contact_wa_id,
  );
  const replyContextTicket = messageDetail.replyContextMessageId
    ? await findTicketByReplyContextMessageId({
        channelId,
        client,
        replyContextMessageId: messageDetail.replyContextMessageId,
      })
    : null;
  const existingTicket =
    replyContextTicket ??
    (await findReusableTicketForInbound({
      channelId,
      client,
      contactId: contact.id,
      waId: contactWaId,
    }));
  const delayedReusableTicket =
    !existingTicket && contactWaId
      ? await waitForConcurrentTicketReuse({
          channelId,
          client,
          contactId: contact.id,
          waId: contactWaId,
        })
      : null;
  const reusableTicket = existingTicket ?? delayedReusableTicket;
  const ticketResult = reusableTicket
    ? {
        ticket: await touchTicketForInbound(client, reusableTicket, event, {
          forceReopen: Boolean(replyContextTicket?.id === reusableTicket.id),
        }),
        ticketCreated: false,
      }
    : {
        ticket: await createTicketFromInbound({
          channelId,
          client,
          contact,
          event,
          messageDetail,
          profile,
          queue,
          workspaceId,
        }),
        ticketCreated: true,
      };
  const ticketAfterCoalesce =
    ticketResult.ticketCreated && contactWaId
      ? await coalesceConcurrentTicketAfterCreate({
          channelId,
          client,
          contactId: contact.id,
          createdTicket: ticketResult.ticket,
          event,
          waId: contactWaId,
        })
      : {
          coalesced: false,
          ticket: ticketResult.ticket,
        };
  const activeTicket = ticketAfterCoalesce.ticket;
  const ticketCreated = ticketResult.ticketCreated && !ticketAfterCoalesce.coalesced;
  const enrichedMessageDetail =
    await enrichInboundMessageDetailWithMediaAnalysis(messageDetail, event);
  const message = await insertInboundMessage({
    channelId,
    client,
    contactId: contact.id,
    event,
    messageDetail: enrichedMessageDetail,
    ticketId: activeTicket.id,
  });

  await Promise.all([
    upsertMessageReference({
      channelId,
      client,
      event,
      messageId: message.id,
      messageDetail: enrichedMessageDetail,
    }),
    insertTicketTimelineEvent({
      client,
      contactId: contact.id,
      event,
      messageDetail: enrichedMessageDetail,
      ticketId: activeTicket.id,
      title: ticketCreated
        ? "Ticket aberto via WhatsApp"
        : "Mensagem recebida via WhatsApp",
    }),
    markWebhookEvent(client, event.id, "processed"),
  ]);

  const autoReplySent = await maybeSendCacaAutoReply({
    channelId,
    client,
    contact,
    event,
    messageDetail: enrichedMessageDetail,
    ticket: activeTicket,
  });

  return {
    autoReplySent,
    ignored: false,
    messageCreated: true,
    ticketCreated,
  };
}

async function processStatusUpdate({
  client,
  event,
}: {
  client: IrisMetaProcessorClient;
  event: IrisMetaWebhookEventRow;
}) {
  const providerStatusId = event.provider_status_id;

  if (!providerStatusId) {
    await markWebhookEvent(
      client,
      event.id,
      "ignored",
      "Status Meta sem ID de mensagem.",
    );
    return false;
  }

  const deliveryStatus = normalizeDeliveryStatus(
    extractStatusDetail(event.payload, providerStatusId),
  );

  const { data, error } = await client
    .from("caredesk_whatsapp_message_refs")
    .update({
      delivery_status: deliveryStatus,
      payload: {
        provider: META_PROVIDER,
        providerStatusId,
        updatedFromWebhookEventId: event.id,
      },
    })
    .eq("provider", META_PROVIDER)
    .eq("wa_message_id", providerStatusId)
    .select("id,message_id");

  if (error) {
    throw error;
  }

  const updatedRows = data ?? [];

  if (updatedRows.length === 0) {
    await markWebhookEvent(
      client,
      event.id,
      "ignored",
      "Status Meta sem referencia local de mensagem.",
    );
    return false;
  }

  const messageIds = updatedRows
    .map((row: { message_id?: string | null }) => row.message_id)
    .filter(Boolean);

  if (messageIds.length) {
    const messageStatusPatch: Record<string, string> = {
      delivery_status: deliveryStatus,
    };

    if (deliveryStatus === "sent") {
      messageStatusPatch.sent_at = event.received_at;
    }

    if (deliveryStatus === "delivered") {
      messageStatusPatch.delivered_at = event.received_at;
    }

    if (deliveryStatus === "read") {
      messageStatusPatch.delivered_at = event.received_at;
      messageStatusPatch.read_at = event.received_at;
    }

    await client
      .from("caredesk_messages")
      .update(messageStatusPatch)
      .in("id", messageIds);
  }

  await markWebhookEvent(client, event.id, "processed");
  return true;
}

async function findExistingMessage(
  client: IrisMetaProcessorClient,
  externalMessageId: string,
) {
  const { data, error } = await client
    .from("caredesk_messages")
    .select("id")
    .eq("external_message_id", externalMessageId)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw error;
  }

  return data;
}

async function getDefaultWorkspaceId(client: IrisMetaProcessorClient) {
  const { data } = await client
    .from("hub_workspaces")
    .select("id")
    .eq("slug", "careli")
    .maybeSingle<{ id: string }>();

  return data?.id ?? null;
}

async function getWhatsAppChannel(client: IrisMetaProcessorClient) {
  const { data, error } = await client
    .from("caredesk_channels")
    .select("id,phone_number")
    .eq("slug", WHATSAPP_CHANNEL_SLUG)
    .eq("provider", META_PROVIDER)
    .maybeSingle<{ id: string; phone_number: string | null }>();

  if (error) {
    throw error;
  }

  return data;
}

async function getDefaultQueue(client: IrisMetaProcessorClient) {
  const { data, error } = await client
    .from("caredesk_queues")
    .select(
      "id,name,slug,default_priority,sla_first_response_minutes,sla_resolution_minutes",
    )
    .eq("slug", DEFAULT_QUEUE_SLUG)
    .maybeSingle<IrisQueueRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function getDefaultProfile(
  client: IrisMetaProcessorClient,
  queueId: string,
) {
  const { data, error } = await client
    .from("caredesk_ticket_profiles")
    .select("id,priority,sla_first_response_minutes,sla_resolution_minutes")
    .eq("queue_id", queueId)
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle<IrisTicketProfileRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function findOrCreateContact({
  channelId,
  client,
  event,
  workspaceId,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  event: IrisMetaWebhookEventRow;
  workspaceId: string | null;
}) {
  const waId = normalizeWhatsAppId(event.contact_wa_id);

  if (!waId) {
    throw new Error("Mensagem inbound sem contato WhatsApp.");
  }

  const { data: existingContacts, error: lookupError } = await client
    .from("caredesk_contacts")
    .select(
      "id,display_name,document,email,phone,whatsapp_phone,metadata,c2x_payload,created_at,updated_at",
    )
    .or(`whatsapp_phone.eq.${waId},phone.eq.${waId}`)
    .limit(24);

  if (lookupError) {
    throw lookupError;
  }

  const existingContact = await pickPreferredContactForInbound({
    channelId,
    client,
    contacts: ((existingContacts ?? []) as IrisContactRow[]).filter(
      (contact) => typeof contact.id === "string" && contact.id.trim().length > 0,
    ),
  });
  const displayName = normalizeDisplayName(event.contact_name, waId);

  if (existingContact) {
    const metadata = {
      ...(isRecord(existingContact.metadata) ? existingContact.metadata : {}),
      lastInboundAt: event.received_at,
      provider: META_PROVIDER,
      providerContactId: waId,
      source: "meta_whatsapp",
    };
    const shouldRefreshDisplayName = shouldRefreshWhatsAppDisplayName(
      existingContact.display_name,
      displayName,
    );

    const { data, error } = await client
      .from("caredesk_contacts")
      .update({
        display_name: shouldRefreshDisplayName
          ? displayName
          : existingContact.display_name,
        metadata,
        phone: existingContact.phone ?? waId,
        whatsapp_phone: existingContact.whatsapp_phone ?? waId,
      })
      .eq("id", existingContact.id)
      .select(
        "id,display_name,document,email,phone,whatsapp_phone,metadata,c2x_payload,created_at,updated_at",
      )
      .single<IrisContactRow>();

    if (error) {
      throw error;
    }

    return data;
  }

  const { data, error } = await client
    .from("caredesk_contacts")
    .insert({
      display_name: displayName,
      metadata: {
        firstInboundAt: event.received_at,
        lastInboundAt: event.received_at,
        provider: META_PROVIDER,
        providerContactId: waId,
        source: "meta_whatsapp",
      },
      person_type: "whatsapp",
      phone: waId,
      whatsapp_phone: waId,
      workspace_id: workspaceId,
    })
    .select(
      "id,display_name,document,email,phone,whatsapp_phone,metadata,c2x_payload,created_at,updated_at",
    )
    .single<IrisContactRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function pickPreferredContactForInbound({
  channelId,
  client,
  contacts,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  contacts: IrisContactRow[];
}) {
  if (contacts.length <= 1) {
    return contacts[0];
  }

  const contactIds = contacts.map((contact) => contact.id);
  let query = client
    .from("caredesk_tickets")
    .select("contact_id,status,opened_at,updated_at")
    .in("contact_id", contactIds)
    .order("opened_at", { ascending: false })
    .limit(120);

  if (channelId) {
    query = query.eq("channel_id", channelId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as Array<{
    contact_id?: string | null;
    opened_at?: string | null;
    status?: string | null;
    updated_at?: string | null;
  }>;
  const latestOpenByContact = new Map<
    string,
    { openedAt: string | null; updatedAt: string | null }
  >();

  for (const row of rows) {
    const contactId = readString(row.contact_id);

    if (!contactId || CLOSED_TICKET_STATUSES.has(row.status ?? "")) {
      continue;
    }

    const currentValue = latestOpenByContact.get(contactId);
    const rowUpdatedAt = row.updated_at ?? null;
    const rowOpenedAt = row.opened_at ?? null;
    const rowTime = dateValue(rowUpdatedAt ?? rowOpenedAt);
    const currentTime = currentValue
      ? dateValue(currentValue.updatedAt ?? currentValue.openedAt)
      : 0;

    if (!currentValue || rowTime > currentTime) {
      latestOpenByContact.set(contactId, {
        openedAt: rowOpenedAt,
        updatedAt: rowUpdatedAt,
      });
    }
  }

  if (latestOpenByContact.size > 0) {
    const preferredContactId = [...latestOpenByContact.entries()]
      .sort((left, right) => {
        const leftTime = dateValue(
          left[1].updatedAt ?? left[1].openedAt ?? null,
        );
        const rightTime = dateValue(
          right[1].updatedAt ?? right[1].openedAt ?? null,
        );

        return rightTime - leftTime;
      })[0]?.[0];

    const preferredContact = contacts.find(
      (contact) => contact.id === preferredContactId,
    );

    if (preferredContact) {
      return preferredContact;
    }
  }

  return [...contacts].sort((left, right) => {
    const rightTime = dateValue(right.updated_at ?? right.created_at ?? null);
    const leftTime = dateValue(left.updated_at ?? left.created_at ?? null);

    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }

    const leftCreatedAt = dateValue(left.created_at ?? null);
    const rightCreatedAt = dateValue(right.created_at ?? null);

    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }

    return left.id.localeCompare(right.id);
  })[0];
}

async function findOpenTicket({
  channelId,
  client,
  contactId,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  contactId: string;
}) {
  let query = client
    .from("caredesk_tickets")
    .select(INBOUND_TICKET_SELECT)
    .eq("contact_id", contactId)
    .order("opened_at", { ascending: false })
    .limit(8);

  if (channelId) {
    query = query.eq("channel_id", channelId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return pickPreferredTicketForInbound((data ?? []) as IrisTicketRow[]);
}

async function findReusableTicketForInbound({
  channelId,
  client,
  contactId,
  waId,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  contactId: string;
  waId: string | null;
}) {
  return (
    (await findOpenTicket({
      channelId,
      client,
      contactId,
    })) ??
    (waId
      ? await findOpenTicketByWhatsAppIdentity({
          channelId,
          client,
          excludedContactId: contactId,
          waId,
        })
      : null)
  );
}

async function waitForConcurrentTicketReuse({
  channelId,
  client,
  contactId,
  waId,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  contactId: string;
  waId: string;
}) {
  for (const delayMs of INBOUND_REUSE_RETRY_DELAYS_MS) {
    await sleepMs(delayMs);
    const reusableTicket = await findReusableTicketForInbound({
      channelId,
      client,
      contactId,
      waId,
    });

    if (reusableTicket) {
      return reusableTicket;
    }
  }

  return null;
}

async function coalesceConcurrentTicketAfterCreate({
  channelId,
  client,
  contactId,
  createdTicket,
  event,
  waId,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  contactId: string;
  createdTicket: IrisTicketRow;
  event: IrisMetaWebhookEventRow;
  waId: string;
}) {
  const canonicalTicket = await findOldestOpenTicketByWhatsAppIdentity({
    channelId,
    client,
    waId,
  });

  if (!canonicalTicket || canonicalTicket.id === createdTicket.id) {
    return {
      coalesced: false,
      ticket: createdTicket,
    };
  }

  await markTicketAsInboundDuplicate({
    client,
    contactId,
    duplicateTicket: createdTicket,
    event,
    stableTicketId: canonicalTicket.id,
  });

  const refreshedTicket = await touchTicketForInbound(
    client,
    canonicalTicket,
    event,
  );

  return {
    coalesced: true,
    ticket: refreshedTicket,
  };
}

async function findOpenTicketByWhatsAppIdentity({
  channelId,
  client,
  excludedContactId,
  waId,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  excludedContactId: string;
  waId: string;
}) {
  const contactIds = await listContactIdsByWhatsAppIdentity({ client, waId });
  const eligibleContactIds = contactIds.filter((id) => id !== excludedContactId);

  if (eligibleContactIds.length === 0) {
    return null;
  }

  let query = client
    .from("caredesk_tickets")
    .select(INBOUND_TICKET_SELECT)
    .in("contact_id", eligibleContactIds)
    .order("opened_at", { ascending: false })
    .limit(16);

  if (channelId) {
    query = query.eq("channel_id", channelId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return pickPreferredTicketForInbound((data ?? []) as IrisTicketRow[]);
}

async function listContactIdsByWhatsAppIdentity({
  client,
  waId,
}: {
  client: IrisMetaProcessorClient;
  waId: string;
}) {
  const contactIds = new Set<string>();

  for (const variant of buildWhatsAppIdVariants(waId)) {
    const { data, error } = await client
      .from("caredesk_contacts")
      .select("id")
      .or(`whatsapp_phone.eq.${variant},phone.eq.${variant}`)
      .limit(16);

    if (error) {
      throw error;
    }

    for (const row of (data ?? []) as Array<{ id?: string | null }>) {
      if (typeof row.id === "string" && row.id.trim()) {
        contactIds.add(row.id);
      }
    }
  }

  return Array.from(contactIds);
}

function buildWhatsAppIdVariants(waId: string) {
  const normalized = normalizeWhatsAppId(waId);

  if (!normalized) {
    return [];
  }

  const variants = new Set<string>();
  variants.add(normalized);

  if (normalized.startsWith("55") && normalized.length > 11) {
    variants.add(normalized.slice(2));
  } else if (!normalized.startsWith("55")) {
    variants.add(`55${normalized}`);
  }

  return Array.from(variants).filter((value) => Boolean(normalizeWhatsAppId(value)));
}

async function findOldestOpenTicketByWhatsAppIdentity({
  channelId,
  client,
  waId,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  waId: string;
}) {
  const contactIds = await listContactIdsByWhatsAppIdentity({ client, waId });

  if (!contactIds.length) {
    return null;
  }

  let query = client
    .from("caredesk_tickets")
    .select(INBOUND_TICKET_SELECT)
    .in("contact_id", contactIds)
    .order("opened_at", { ascending: true })
    .limit(60);

  if (channelId) {
    query = query.eq("channel_id", channelId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return ((data ?? []) as IrisTicketRow[]).find(
    (ticket) => !CLOSED_TICKET_STATUSES.has(ticket.status),
  );
}

async function markTicketAsInboundDuplicate({
  client,
  contactId,
  duplicateTicket,
  event,
  stableTicketId,
}: {
  client: IrisMetaProcessorClient;
  contactId: string;
  duplicateTicket: IrisTicketRow;
  event: IrisMetaWebhookEventRow;
  stableTicketId: string;
}) {
  const mergedAt = event.received_at || new Date().toISOString();
  const metadata = {
    ...(isRecord(duplicateTicket.metadata) ? duplicateTicket.metadata : {}),
    duplicateMergedAt: mergedAt,
    duplicateMergedBy: "meta_inbound_coalescer",
    duplicateReason: "concurrent_whatsapp_inbound",
    duplicateStableTicketId: stableTicketId,
    duplicateWebhookEventId: event.id,
  };

  const { error } = await client
    .from("caredesk_tickets")
    .update({
      closed_at: mergedAt,
      metadata,
      status: "closed",
    })
    .eq("id", duplicateTicket.id);

  if (error) {
    throw error;
  }

  const [stableTicketEvent, duplicateTicketEvent] = await Promise.all([
    client.from("caredesk_ticket_events").insert({
      actor_type: "system",
      description:
        "Inbound consolidado automaticamente para evitar ticket duplicado por concorrencia.",
      event_type: "ticket_merge",
      metadata: {
        source: "meta_inbound_coalescer",
        stableTicketId,
        webhookEventId: event.id,
      },
      ticket_id: stableTicketId,
      title: `Ticket ${duplicateTicket.protocol} consolidado automaticamente`,
    }),
    client.from("caredesk_ticket_events").insert({
      actor_type: "system",
      description: `Consolidado para ${stableTicketId} apos inbound concorrente.`,
      event_type: "ticket_merge",
      metadata: {
        contactId,
        source: "meta_inbound_coalescer",
        stableTicketId,
        webhookEventId: event.id,
      },
      ticket_id: duplicateTicket.id,
      title: `Ticket consolidado em ${stableTicketId}`,
    }),
  ]);

  if (stableTicketEvent.error) {
    throw stableTicketEvent.error;
  }

  if (duplicateTicketEvent.error) {
    throw duplicateTicketEvent.error;
  }
}

async function findTicketByReplyContextMessageId({
  channelId,
  client,
  replyContextMessageId,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  replyContextMessageId: string;
}) {
  const { data: messages, error: messagesError } = await client
    .from("caredesk_messages")
    .select("ticket_id")
    .eq("external_message_id", replyContextMessageId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (messagesError) {
    throw messagesError;
  }

  const ticketIds = (messages ?? [])
    .map((row) =>
      readString((row as Record<string, unknown>).ticket_id),
    )
    .filter((ticketId): ticketId is string => Boolean(ticketId));

  if (!ticketIds.length) {
    return null;
  }

  let query = client
    .from("caredesk_tickets")
    .select(INBOUND_TICKET_SELECT)
    .in("id", ticketIds)
    .limit(8);

  if (channelId) {
    query = query.eq("channel_id", channelId);
  }

  const { data: tickets, error: ticketsError } = await query;

  if (ticketsError) {
    throw ticketsError;
  }

  const ticketById = new Map<string, IrisTicketRow>(
    ((tickets ?? []) as IrisTicketRow[]).map((ticket) => [ticket.id, ticket]),
  );

  for (const ticketId of ticketIds) {
    const ticket = ticketById.get(ticketId);

    if (ticket) {
      return ticket;
    }
  }

  return pickPreferredTicketForInbound((tickets ?? []) as IrisTicketRow[]);
}

function pickPreferredTicketForInbound(tickets: IrisTicketRow[]) {
  const openTickets = tickets.filter(
    (ticket) => !CLOSED_TICKET_STATUSES.has(ticket.status),
  );

  if (openTickets.length > 0) {
    openTickets.sort(
      (left, right) => ticketReusePriority(left) - ticketReusePriority(right),
    );
    return openTickets[0];
  }

  const reopenableTickets = tickets
    .filter((ticket) => isReopenableActiveContactTicket(ticket))
    .sort((left, right) => {
      return (
        ticketClosedReusePriority(right) - ticketClosedReusePriority(left)
      );
    });

  return reopenableTickets[0];
}

function ticketReusePriority(ticket: IrisTicketRow) {
  const metadata = isRecord(ticket.metadata) ? ticket.metadata : null;
  const activeContactConsent = readString(metadata?.activeContactConsent);

  if (
    activeContactConsent === "awaiting_customer_reply" &&
    isActiveContactTicket(ticket)
  ) {
    return 0;
  }

  if (isActiveContactTicket(ticket)) {
    return 1;
  }

  if (ticket.status === "waiting_customer") {
    return 2;
  }

  return 3;
}

function isReopenableActiveContactTicket(ticket: IrisTicketRow) {
  if (!REOPENABLE_TICKET_STATUSES.has(ticket.status)) {
    return false;
  }

  const metadata = isRecord(ticket.metadata) ? ticket.metadata : null;
  const activeContactConsent = readString(metadata?.activeContactConsent);

  return (
    activeContactConsent === "awaiting_customer_reply" &&
    isActiveContactTicket(ticket)
  );
}

function ticketClosedReusePriority(ticket: IrisTicketRow) {
  return dateValue(
    ticket.updated_at ?? ticket.closed_at ?? ticket.resolved_at ?? ticket.opened_at,
  );
}

async function touchTicketForInbound(
  client: IrisMetaProcessorClient,
  ticket: IrisTicketRow,
  event: IrisMetaWebhookEventRow,
  options?: {
    forceReopen?: boolean;
  },
) {
  const shouldReopen =
    REOPENABLE_TICKET_STATUSES.has(ticket.status) &&
    (options?.forceReopen || isReopenableActiveContactTicket(ticket));
  const nextStatus =
    shouldReopen || ticket.status === "waiting_customer"
      ? "waiting_operator"
      : ticket.status;
  const updatePayload: Record<string, unknown> = {
    metadata: buildCustomerServiceWindowMetadata(ticket.metadata, event),
    status: nextStatus,
  };

  if (shouldReopen) {
    updatePayload.closed_at = null;
    updatePayload.resolved_at = null;
  }

  const { data, error } = await client
    .from("caredesk_tickets")
    .update(updatePayload)
    .eq("id", ticket.id)
    .select(INBOUND_TICKET_SELECT)
    .single<IrisTicketRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function createTicketFromInbound({
  channelId,
  client,
  contact,
  event,
  messageDetail,
  profile,
  queue,
  workspaceId,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  contact: IrisContactRow;
  event: IrisMetaWebhookEventRow;
  messageDetail: InboundMessageDetail;
  profile: IrisTicketProfileRow | null;
  queue: IrisQueueRow | null;
  workspaceId: string | null;
}) {
  const protocol = await nextTicketProtocol(client);
  const now = event.received_at || new Date().toISOString();
  const firstResponseMinutes =
    profile?.sla_first_response_minutes ??
    queue?.sla_first_response_minutes ??
    60;
  const resolutionMinutes =
    profile?.sla_resolution_minutes ?? queue?.sla_resolution_minutes ?? 480;
  const priority =
    profile?.priority ?? queue?.default_priority ?? "medium";

  const { data, error } = await client
    .from("caredesk_tickets")
    .insert({
      channel_id: channelId,
      contact_id: contact.id,
      first_response_due_at: addMinutes(now, firstResponseMinutes),
      metadata: {
        activeContactConsent: "customer_replied",
        customerServiceWindowExpiresAt: addHours(now, 24),
        customerServiceWindowOpenedAt: now,
        firstMetaWebhookEventId: event.id,
        lastCustomerMessageAt: now,
        provider: META_PROVIDER,
        providerMessageId: event.provider_message_id,
        source: "meta_whatsapp_inbound",
      },
      opened_at: now,
      priority,
      profile_id: profile?.id ?? null,
      protocol,
      queue_id: queue?.id ?? null,
      resolution_due_at: addMinutes(now, resolutionMinutes),
      source_context: {
        contactWaId: event.contact_wa_id,
        displayPhoneNumber: event.display_phone_number,
        firstMessagePreview: truncateText(messageDetail.body, 220),
        phoneNumberId: event.phone_number_id,
        provider: META_PROVIDER,
        providerMessageId: event.provider_message_id,
        webhookEventId: event.id,
      },
      source_entity_id: event.provider_message_id,
      source_entity_type: "meta-whatsapp-message",
      source_module: "iris",
      status: "new",
      subject: `WhatsApp - ${contact.display_name}`,
      workspace_id: workspaceId,
    })
    .select(INBOUND_TICKET_SELECT)
    .single<IrisTicketRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function nextTicketProtocol(client: IrisMetaProcessorClient) {
  const { data, error } = await client.rpc("next_caredesk_ticket_protocol");

  if (error || typeof data !== "string" || !data.startsWith("AT-")) {
    throw new Error(
      "Sequencia de protocolo AT da Iris nao esta configurada no banco.",
    );
  }

  return data;
}

async function insertInboundMessage({
  channelId,
  client,
  contactId,
  event,
  messageDetail,
  ticketId,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  contactId: string;
  event: IrisMetaWebhookEventRow;
  messageDetail: InboundMessageDetail;
  ticketId: string;
}) {
  const { data, error } = await client
    .from("caredesk_messages")
    .insert({
      body: messageDetail.body,
      channel_id: channelId,
      delivery_status: "delivered",
      direction: "inbound",
      external_message_id: event.provider_message_id,
      message_type: messageDetail.messageType,
      provider_payload: buildInboundProviderPayload(event, messageDetail),
      sender_contact_id: contactId,
      sender_type: "customer",
      sent_at: event.received_at,
      ticket_id: ticketId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    throw error;
  }

  return data;
}

async function upsertMessageReference({
  channelId,
  client,
  event,
  messageId,
  messageDetail,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  event: IrisMetaWebhookEventRow;
  messageId: string;
  messageDetail: InboundMessageDetail;
}) {
  if (!event.provider_message_id) {
    return;
  }

  const { error } = await client.from("caredesk_whatsapp_message_refs").upsert(
    {
      channel_id: channelId,
      delivery_status: "delivered",
      direction: "inbound",
      message_id: messageId,
      payload: {
        mediaAnalysisStatus: messageDetail.mediaAnalysis?.status ?? null,
        mediaType: messageDetail.media?.type ?? null,
        provider: META_PROVIDER,
        webhookEventId: event.id,
      },
      phone_number_id: event.phone_number_id,
      provider: META_PROVIDER,
      wa_contact_id: event.contact_wa_id,
      wa_message_id: event.provider_message_id,
      webhook_event_id: event.id,
    },
    {
      onConflict: "provider,wa_message_id",
    },
  );

  if (error) {
    throw error;
  }
}

async function insertTicketTimelineEvent({
  client,
  contactId,
  event,
  messageDetail,
  ticketId,
  title,
}: {
  client: IrisMetaProcessorClient;
  contactId: string;
  event: IrisMetaWebhookEventRow;
  messageDetail: InboundMessageDetail;
  ticketId: string;
  title: string;
}) {
  const { error } = await client.from("caredesk_ticket_events").insert({
    actor_contact_id: contactId,
    actor_type: "customer",
    description: truncateText(messageDetail.body, 500),
    event_type: "whatsapp_inbound",
    metadata: {
      mediaAnalysisStatus: messageDetail.mediaAnalysis?.status ?? null,
      mediaType: messageDetail.media?.type ?? null,
      provider: META_PROVIDER,
      providerMessageId: event.provider_message_id,
      webhookEventId: event.id,
    },
    ticket_id: ticketId,
    title,
  });

  if (error) {
    throw error;
  }
}

async function enrichInboundMessageDetailWithMediaAnalysis(
  messageDetail: InboundMessageDetail,
  event: IrisMetaWebhookEventRow,
): Promise<InboundMessageDetail> {
  if (!messageDetail.media) {
    return messageDetail;
  }

  const mediaAnalysis = await analyzeCacaInboundMedia({
    config: event.phone_number_id
      ? {
          ...getMetaWhatsAppOutboundConfig(),
          phoneNumberId: event.phone_number_id,
        }
      : undefined,
    media: messageDetail.media,
  });

  return {
    ...messageDetail,
    mediaAnalysis,
  };
}

function buildInboundProviderPayload(
  event: IrisMetaWebhookEventRow,
  messageDetail: InboundMessageDetail,
) {
  const payload: Record<string, unknown> = {
    provider: META_PROVIDER,
    replyToExternalMessageId: messageDetail.replyContextMessageId,
    webhookEventId: event.id,
  };

  if (messageDetail.media) {
    payload.media = sanitizeInboundMediaPayload(messageDetail.media);
  }

  if (messageDetail.mediaAnalysis) {
    payload.cacaMediaAnalysis = normalizeJsonPayload(
      messageDetail.mediaAnalysis,
    );
  }

  return payload;
}

function sanitizeInboundMediaPayload(media: CacaInboundMedia) {
  return {
    caption: media.caption ?? null,
    fileName: media.fileName ?? null,
    hasProviderMediaId: Boolean(media.providerMediaId),
    mimeType: media.mimeType ?? null,
    sha256: media.sha256 ?? null,
    type: media.type,
    voice: media.voice ?? null,
  };
}

async function markWebhookEvent(
  client: IrisMetaProcessorClient,
  eventId: string,
  status: "processed" | "ignored" | "failed",
  error?: unknown,
) {
  const payload: Record<string, unknown> = {
    error_message: error ? errorMessage(error) : null,
    processed_at: new Date().toISOString(),
    status,
  };

  const { error: updateError } = await client
    .from("caredesk_meta_webhook_events")
    .update(payload)
    .eq("id", eventId);

  if (updateError) {
    throw updateError;
  }
}

function extractInboundMessageDetail(
  payload: Json,
  messageId: string,
): InboundMessageDetail {
  const message = findMessages(payload).find(
    (candidate) => readString(candidate.id) === messageId,
  );
  const replyContextMessageId = readString(asRecord(message?.context)?.id);
  const messageType = readString(message?.type) ?? "text";
  const media = extractInboundMedia(message, messageType);

  if (messageType === "text") {
    const body = readString(asRecord(message?.text)?.body);

    return {
      body: body || "Mensagem de texto recebida pelo WhatsApp.",
      replyContextMessageId,
      messageType,
    };
  }

  if (messageType === "button") {
    const button = asRecord(message?.button);
    const body = readString(button?.text) ?? readString(button?.payload);

    return {
      body: body || "Resposta de botao recebida pelo WhatsApp.",
      replyContextMessageId,
      messageType,
    };
  }

  if (messageType === "interactive") {
    const interactive = asRecord(message?.interactive);
    const buttonReply = asRecord(interactive?.button_reply);
    const listReply = asRecord(interactive?.list_reply);
    const body =
      readString(buttonReply?.title) ??
      readString(buttonReply?.id) ??
      readString(listReply?.title) ??
      readString(listReply?.id);

    return {
      body: body || "Resposta interativa recebida pelo WhatsApp.",
      replyContextMessageId,
      messageType,
    };
  }

  const caption =
    media?.caption ??
    readString(asRecord(message?.image)?.caption) ??
    readString(asRecord(message?.document)?.caption) ??
    readString(asRecord(message?.video)?.caption);

  return {
    body: caption || `Mensagem ${messageType} recebida pelo WhatsApp.`,
    media,
    replyContextMessageId,
    messageType,
  };
}

function extractInboundMedia(
  message: Record<string, unknown> | undefined,
  messageType: string,
): CacaInboundMedia | null {
  const mediaType = normalizeInboundMediaType(messageType);

  if (!mediaType) {
    return null;
  }

  const mediaPayload = asRecord(message?.[messageType]);

  if (!mediaPayload) {
    return null;
  }

  return {
    caption: readString(mediaPayload.caption),
    fileName: readString(mediaPayload.filename),
    mimeType: readString(mediaPayload.mime_type),
    providerMediaId: readString(mediaPayload.id),
    sha256: readString(mediaPayload.sha256),
    type: mediaType,
    voice: mediaPayload.voice === true,
  };
}

function normalizeInboundMediaType(
  messageType: string,
): CacaInboundMediaType | null {
  if (
    messageType === "audio" ||
    messageType === "document" ||
    messageType === "image" ||
    messageType === "video"
  ) {
    return messageType;
  }

  return null;
}

function extractStatusDetail(payload: Json, statusId: string) {
  const status = findStatuses(payload).find(
    (candidate) => readString(candidate.id) === statusId,
  );

  return readString(status?.status);
}

async function maybeSendCacaAutoReply({
  channelId,
  client,
  contact,
  event,
  messageDetail,
  ticket,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  contact: IrisContactRow;
  event: IrisMetaWebhookEventRow;
  messageDetail: InboundMessageDetail;
  ticket: IrisTicketRow;
}) {
  const destination = normalizeWhatsAppId(event.contact_wa_id);

  if (!destination || !shouldCacaAutomationRun(ticket)) {
    return false;
  }

  const reply = await runCacaAgentTurn({
    client,
    contact,
    messageDetail,
    ticket,
  });
  const queuedMessage = await insertCacaOutboundMessage({
    body: reply.replyText,
    channelId,
    client,
    contactId: contact.id,
    event,
    ticketId: ticket.id,
  });

  try {
    const result = await sendMetaWhatsAppTextMessage({
      body: reply.replyText,
      config: event.phone_number_id
        ? {
            ...getMetaWhatsAppOutboundConfig(),
            phoneNumberId: event.phone_number_id,
          }
        : undefined,
      contextMessageId: event.provider_message_id,
      to: destination,
    });
    const ticketUpdate = await updateTicketAfterCacaReply({
      client,
      reply,
      ticket,
    });

    await Promise.all([
      persistCacaOutboundReference({
        channelId,
        client,
        event,
        localMessageId: queuedMessage.id,
        result,
        to: destination,
      }),
      markCacaOutboundMessageSent({
        client,
        messageId: queuedMessage.id,
        result,
        to: destination,
      }),
      insertCacaTimelineEvent({
        client,
        event,
        reply,
        ticketId: ticket.id,
      }),
      insertCacaTransferEventWhenHandoff({
        client,
        reason: ticketUpdate.handoffReason,
        ticketId: ticket.id,
        toQueueId: ticketUpdate.handoffQueueId,
        toQueueLabel: ticketUpdate.handoffQueueLabel,
      }),
    ]);

    return true;
  } catch (error) {
    await Promise.all([
      markCacaOutboundMessageFailed({
        client,
        error,
        messageId: queuedMessage.id,
      }),
      insertCacaAutomationFailureEvent({
        client,
        error,
        ticketId: ticket.id,
      }),
    ]);

    return false;
  }
}

function shouldCacaAutomationRun(ticket: IrisTicketRow) {
  if (CLOSED_TICKET_STATUSES.has(ticket.status)) {
    return false;
  }

  if (ticket.assigned_to_user_id) {
    return false;
  }

  if (isActiveContactTicket(ticket)) {
    return false;
  }

  const state = readCacaAutomationState(ticket.metadata);

  return !state.handoffRequired;
}

function isActiveContactTicket(ticket: IrisTicketRow) {
  const metadata = isRecord(ticket.metadata) ? ticket.metadata : null;
  const sourceContext = isRecord(ticket.source_context)
    ? ticket.source_context
    : null;
  const activeContactConsent = readString(metadata?.activeContactConsent);
  const contactOrigin = readString(sourceContext?.contactOrigin);

  if (activeContactConsent === "awaiting_customer_reply") {
    return true;
  }

  if (contactOrigin === "active") {
    return true;
  }

  return Boolean(
    readString(metadata?.initialTemplateId) ||
      readString(metadata?.initialTemplateName) ||
      readString(metadata?.attendanceProtocol) ||
      readString(metadata?.linkedAttendanceProtocol) ||
      readString(sourceContext?.attendanceProtocol) ||
      readString(sourceContext?.linkedAttendanceProtocol),
  );
}

async function insertCacaOutboundMessage({
  body,
  channelId,
  client,
  contactId,
  event,
  ticketId,
}: {
  body: string;
  channelId: string | null;
  client: IrisMetaProcessorClient;
  contactId: string;
  event: IrisMetaWebhookEventRow;
  ticketId: string;
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
        automation: "caca",
        operatorLabel: CACA_OPERATOR_LABEL,
        provider: META_PROVIDER,
        replyTo: {
          externalMessageId: event.provider_message_id,
          webhookEventId: event.id,
        },
        source_module: "iris",
      },
      sender_contact_id: contactId,
      sender_type: "operator",
      ticket_id: ticketId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    throw error;
  }

  return data;
}

async function persistCacaOutboundReference({
  channelId,
  client,
  event,
  localMessageId,
  result,
  to,
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  event: IrisMetaWebhookEventRow;
  localMessageId: string;
  result: MetaWhatsAppSendMessageResult;
  to: string;
}) {
  if (!result.messageId) {
    throw new Error("Meta WhatsApp nao retornou ID da mensagem da Cacá.");
  }

  const { error } = await client.from("caredesk_whatsapp_message_refs").upsert(
    {
      channel_id: channelId,
      delivery_status: "sent",
      direction: "outbound",
      message_id: localMessageId,
      payload: normalizeJsonPayload(result.raw),
      phone_number_id:
        event.phone_number_id ?? process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? null,
      provider: META_PROVIDER,
      wa_contact_id: result.contactWaId ?? to,
      wa_message_id: result.messageId,
      webhook_event_id: event.id,
    },
    {
      onConflict: "provider,wa_message_id",
    },
  );

  if (error) {
    throw error;
  }
}

async function markCacaOutboundMessageSent({
  client,
  messageId,
  result,
  to,
}: {
  client: IrisMetaProcessorClient;
  messageId: string;
  result: MetaWhatsAppSendMessageResult;
  to: string;
}) {
  const { error } = await client
    .from("caredesk_messages")
    .update({
      delivery_status: "sent",
      external_message_id: result.messageId,
      provider_payload: {
        automation: "caca",
        destination: to,
        meta: normalizeJsonPayload(result.raw),
        operatorLabel: CACA_OPERATOR_LABEL,
        provider: META_PROVIDER,
        source_module: "iris",
      },
      sent_at: new Date().toISOString(),
    })
    .eq("id", messageId);

  if (error) {
    throw error;
  }
}

async function markCacaOutboundMessageFailed({
  client,
  error,
  messageId,
}: {
  client: IrisMetaProcessorClient;
  error: unknown;
  messageId: string;
}) {
  await client
    .from("caredesk_messages")
    .update({
      delivery_status: "failed",
      provider_payload: {
        automation: "caca",
        error: errorMessage(error),
        operatorLabel: CACA_OPERATOR_LABEL,
        provider: META_PROVIDER,
        source_module: "iris",
      },
    })
    .eq("id", messageId);
}

async function updateTicketAfterCacaReply({
  client,
  reply,
  ticket,
}: {
  client: IrisMetaProcessorClient;
  reply: CacaAutoReply;
  ticket: IrisTicketRow;
}) {
  const now = new Date().toISOString();
  const handoffRequired = reply.handoff.required;
  const handoffReason = reply.handoff.reason ?? CACA_TRANSFER_REASON_FALLBACK;
  const defaultQueue = handoffRequired ? await getDefaultQueue(client) : null;
  const handoffQueueId = defaultQueue?.id ?? ticket.queue_id ?? null;
  const handoffQueueLabel =
    defaultQueue?.name ??
    defaultQueue?.slug ??
    readString(
      isRecord(ticket.source_context) ? ticket.source_context.handoffQueueLabel : null,
    ) ??
    DEFAULT_QUEUE_SLUG;
  const previousMetadata = isRecord(ticket.metadata) ? ticket.metadata : {};
  const sourceContext = isRecord(ticket.source_context) ? ticket.source_context : {};
  const transferHistory = Array.isArray(previousMetadata.transferHistory)
    ? previousMetadata.transferHistory.filter(
        (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
  const transferEntry = handoffRequired
    ? {
        byUserId: null,
        fromQueueId: ticket.queue_id ?? null,
        fromQueueLabel: CACA_OPERATOR_LABEL,
        occurredAt: now,
        operatorLabel: CACA_OPERATOR_LABEL,
        reason: handoffReason,
        toQueueId: handoffQueueId,
        toQueueLabel: handoffQueueLabel,
      }
    : null;
  const metadata = {
    ...previousMetadata,
    [CACA_AUTOMATION_METADATA_KEY]: {
      ...reply.nextState,
      agentVersion: reply.agentVersion ?? CACA_AGENT_VERSION,
      lastAutoReplyAt: now,
      lastHandoffReason: handoffReason,
      lastModel: reply.model ?? null,
      lastNextStep: reply.nextStep,
      lastSource: reply.source ?? "deterministic",
      lastTrace: reply.trace?.slice(-10) ?? [],
      source: "iris_meta_inbound",
      toolsUsed: reply.toolsUsed ?? [],
    },
    ...(handoffRequired
      ? {
          activeContactConsent: "customer_replied",
          handoffToOperatorAt: now,
          handoffToOperatorByUserId: null,
          handoffToOperatorReason: handoffReason,
          handlingOwner: "operator",
          lastTransfer: transferEntry,
          transferHistory: [transferEntry, ...transferHistory].slice(0, 30),
        }
      : {
          handlingOwner: "caca",
        }),
  };

  const updatePayload: Record<string, unknown> = {
    metadata,
    source_context: handoffRequired
      ? {
          ...sourceContext,
          handoffQueueId,
          handoffQueueLabel,
          handoffReason,
        }
      : sourceContext,
    status: handoffRequired ? "waiting_operator" : "waiting_customer",
  };

  if (handoffRequired && handoffQueueId) {
    updatePayload.queue_id = handoffQueueId;
  }

  const { error } = await client
    .from("caredesk_tickets")
    .update(updatePayload)
    .eq("id", ticket.id);

  if (error) {
    throw error;
  }

  return {
    handoffQueueId: handoffRequired ? handoffQueueId : null,
    handoffQueueLabel: handoffRequired ? handoffQueueLabel : null,
    handoffReason: handoffRequired ? handoffReason : null,
  };
}

async function insertCacaTransferEventWhenHandoff({
  client,
  reason,
  ticketId,
  toQueueId,
  toQueueLabel,
}: {
  client: IrisMetaProcessorClient;
  reason: string | null;
  ticketId: string;
  toQueueId: string | null;
  toQueueLabel: string | null;
}) {
  if (!toQueueLabel) {
    return;
  }

  const handoffReason = reason ?? CACA_TRANSFER_REASON_FALLBACK;
  const transferMessage = [
    `Transferencia registrada: ${CACA_OPERATOR_LABEL} -> ${toQueueLabel}.`,
    `Motivo: ${handoffReason}.`,
  ].join(" ");

  const [timelineInsert, chatInsert] = await Promise.all([
    client.from("caredesk_ticket_events").insert({
      actor_type: "system",
      description: handoffReason,
      event_type: "ticket_transfer",
      metadata: {
        fromQueueId: null,
        fromQueueLabel: CACA_OPERATOR_LABEL,
        operatorLabel: CACA_OPERATOR_LABEL,
        source: "caca_auto_handoff",
        toQueueId,
        toQueueLabel,
      },
      ticket_id: ticketId,
      title: `Transferido para ${toQueueLabel}`,
    }),
    client.from("caredesk_messages").insert({
      body: transferMessage,
      delivery_status: "sent",
      direction: "internal",
      message_type: "system",
      provider_payload: {
        operatorLabel: CACA_OPERATOR_LABEL,
        source_module: "iris",
        transfer: {
          fromQueueId: null,
          fromQueueLabel: CACA_OPERATOR_LABEL,
          reason: handoffReason,
          toQueueId,
          toQueueLabel,
        },
      },
      sender_type: "system",
      ticket_id: ticketId,
    }),
  ]);

  if (timelineInsert.error) {
    throw timelineInsert.error;
  }

  if (chatInsert.error) {
    throw chatInsert.error;
  }
}

async function insertCacaTimelineEvent({
  client,
  event,
  reply,
  ticketId,
}: {
  client: IrisMetaProcessorClient;
  event: IrisMetaWebhookEventRow;
  reply: CacaAutoReply;
  ticketId: string;
}) {
  const { error } = await client.from("caredesk_ticket_events").insert({
    actor_type: "system",
    description: truncateText(reply.replyText, 500),
    event_type: "caca_auto_reply",
    metadata: {
      agentVersion: reply.agentVersion ?? CACA_AGENT_VERSION,
      handoffRequired: reply.handoff.required,
      model: reply.model ?? null,
      nextStep: reply.nextStep,
      provider: META_PROVIDER,
      source: reply.source ?? "deterministic",
      toolsUsed: reply.toolsUsed ?? [],
      trace: reply.trace?.slice(-10) ?? [],
      webhookEventId: event.id,
    },
    ticket_id: ticketId,
    title: reply.handoff.required
      ? "Cacá encaminhou para atendimento humano"
      : "Cacá respondeu automaticamente",
  });

  if (error) {
    throw error;
  }
}

async function insertCacaAutomationFailureEvent({
  client,
  error,
  ticketId,
}: {
  client: IrisMetaProcessorClient;
  error: unknown;
  ticketId: string;
}) {
  await client.from("caredesk_ticket_events").insert({
    actor_type: "system",
    description: truncateText(errorMessage(error), 500),
    event_type: "caca_auto_reply_failed",
    metadata: {
      provider: META_PROVIDER,
      source: "iris_meta_inbound",
    },
    ticket_id: ticketId,
    title: "Cacá nao conseguiu responder automaticamente",
  });
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

function findMessages(payload: Json) {
  const messages: Array<Record<string, unknown>> = [];

  for (const change of findChanges(payload)) {
    const value = asRecord(change.value);
    const changeMessages = Array.isArray(value?.messages)
      ? value.messages
      : [];

    for (const message of changeMessages) {
      const normalizedMessage = asRecord(message);

      if (normalizedMessage) {
        messages.push(normalizedMessage);
      }
    }
  }

  return messages;
}

function findStatuses(payload: Json) {
  const statuses: Array<Record<string, unknown>> = [];

  for (const change of findChanges(payload)) {
    const value = asRecord(change.value);
    const changeStatuses = Array.isArray(value?.statuses)
      ? value.statuses
      : [];

    for (const status of changeStatuses) {
      const normalizedStatus = asRecord(status);

      if (normalizedStatus) {
        statuses.push(normalizedStatus);
      }
    }
  }

  return statuses;
}

function findChanges(payload: Json) {
  const changes: Array<Record<string, unknown>> = [];
  const root = asRecord(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];

  for (const entry of entries) {
    const normalizedEntry = asRecord(entry);
    const entryChanges = Array.isArray(normalizedEntry?.changes)
      ? normalizedEntry.changes
      : [];

    for (const change of entryChanges) {
      const normalizedChange = asRecord(change);

      if (normalizedChange) {
        changes.push(normalizedChange);
      }
    }
  }

  return changes;
}

function normalizeDeliveryStatus(value: string | null) {
  if (
    value === "sent" ||
    value === "delivered" ||
    value === "read" ||
    value === "failed"
  ) {
    return value;
  }

  return "sent";
}

function normalizeWhatsAppId(value: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";

  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

function normalizeDisplayName(name: string | null, waId: string) {
  const normalized = name?.trim();

  return normalized || `WhatsApp ${waId.slice(-4)}`;
}

function shouldRefreshWhatsAppDisplayName(
  currentName: string | null | undefined,
  incomingName: string,
) {
  const current = normalizeDisplayNameToken(currentName);
  const incoming = normalizeDisplayNameToken(incomingName);

  if (!incoming || isGenericWhatsAppDisplayNameToken(incoming)) {
    return false;
  }

  if (!current) {
    return true;
  }

  return isGenericWhatsAppDisplayNameToken(current);
}

function normalizeDisplayNameToken(value: string | null | undefined) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function isGenericWhatsAppDisplayNameToken(value: string) {
  const normalized = value.toLowerCase();

  return (
    normalized === "contato whatsapp" ||
    normalized === "cliente sem cadastro" ||
    normalized === "sem cadastro" ||
    /^whatsapp\s+\d{4,}$/.test(normalized)
  );
}

function buildCustomerServiceWindowMetadata(
  metadata: Record<string, unknown> | null,
  event: IrisMetaWebhookEventRow,
) {
  const receivedAt = event.received_at || new Date().toISOString();

  return {
    ...(isRecord(metadata) ? metadata : {}),
    activeContactConsent: "customer_replied",
    customerServiceWindowExpiresAt: addHours(receivedAt, 24),
    customerServiceWindowOpenedAt: receivedAt,
    lastCustomerMessageAt: receivedAt,
    lastMetaWebhookEventId: event.id,
    lastProviderMessageId: event.provider_message_id,
    provider: META_PROVIDER,
    source: "meta_whatsapp_inbound",
  };
}

function addHours(value: string, hours: number) {
  return new Date(
    new Date(value).getTime() + Number(hours || 24) * 60 * 60000,
  ).toISOString();
}

function sleepMs(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function addMinutes(value: string, minutes: number) {
  return new Date(
    new Date(value).getTime() + Number(minutes || 60) * 60000,
  ).toISOString();
}

function dateValue(value?: string | null) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();

  return Number.isNaN(parsed) ? 0 : parsed;
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
