import type { SupabaseClient } from "@supabase/supabase-js";

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
  id: string;
  display_name: string;
  metadata: Record<string, unknown> | null;
  phone: string | null;
  whatsapp_phone: string | null;
};

type IrisQueueRow = {
  default_priority: string | null;
  id: string;
  sla_first_response_minutes: number | null;
  sla_resolution_minutes: number | null;
};

type IrisTicketProfileRow = {
  id: string;
  priority: string | null;
  sla_first_response_minutes: number | null;
  sla_resolution_minutes: number | null;
};

type IrisTicketRow = {
  id: string;
  protocol: string;
  status: string;
};

type InboundMessageDetail = {
  body: string;
  messageType: string;
};

const CLOSED_TICKET_STATUSES = new Set(["cancelled", "closed", "resolved"]);
const META_PROVIDER = "meta";
const WHATSAPP_CHANNEL_SLUG = "whatsapp-careli";
const DEFAULT_QUEUE_SLUG = "atendimento";

export async function processMetaWhatsAppWebhookEvents({
  client,
  events,
}: {
  client: IrisMetaProcessorClient;
  events: IrisMetaWebhookEventRow[];
}) {
  const result = {
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
  const queue = await getDefaultQueue(client);
  const profile = queue ? await getDefaultProfile(client, queue.id) : null;
  const contact = await findOrCreateContact({
    client,
    event,
    workspaceId,
  });
  const existingTicket = await findOpenTicket({
    channelId: channel?.id ?? null,
    client,
    contactId: contact.id,
  });
  const ticketResult = existingTicket
    ? {
        ticket: await touchTicketForInbound(client, existingTicket),
        ticketCreated: false,
      }
    : {
        ticket: await createTicketFromInbound({
          channelId: channel?.id ?? null,
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
  const message = await insertInboundMessage({
    channelId: channel?.id ?? null,
    client,
    contactId: contact.id,
    event,
    messageDetail,
    ticketId: ticketResult.ticket.id,
  });

  await Promise.all([
    upsertMessageReference({
      channelId: channel?.id ?? null,
      client,
      event,
      messageId: message.id,
    }),
    insertTicketTimelineEvent({
      client,
      contactId: contact.id,
      event,
      messageDetail,
      ticketId: ticketResult.ticket.id,
      title: ticketResult.ticketCreated
        ? "Ticket aberto via WhatsApp"
        : "Mensagem recebida via WhatsApp",
    }),
    markWebhookEvent(client, event.id, "processed"),
  ]);

  return {
    ignored: false,
    messageCreated: true,
    ticketCreated: ticketResult.ticketCreated,
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
      "id,default_priority,sla_first_response_minutes,sla_resolution_minutes",
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
  client,
  event,
  workspaceId,
}: {
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
    .select("id,display_name,phone,whatsapp_phone,metadata")
    .or(`whatsapp_phone.eq.${waId},phone.eq.${waId}`)
    .limit(1);

  if (lookupError) {
    throw lookupError;
  }

  const existingContact = existingContacts?.[0] as IrisContactRow | undefined;
  const displayName = normalizeDisplayName(event.contact_name, waId);

  if (existingContact) {
    const metadata = {
      ...(isRecord(existingContact.metadata) ? existingContact.metadata : {}),
      lastInboundAt: event.received_at,
      provider: META_PROVIDER,
      providerContactId: waId,
      source: "meta_whatsapp",
    };

    const { data, error } = await client
      .from("caredesk_contacts")
      .update({
        display_name:
          existingContact.display_name === "Contato WhatsApp"
            ? displayName
            : existingContact.display_name,
        metadata,
        phone: existingContact.phone ?? waId,
        whatsapp_phone: existingContact.whatsapp_phone ?? waId,
      })
      .eq("id", existingContact.id)
      .select("id,display_name,phone,whatsapp_phone,metadata")
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
    .select("id,display_name,phone,whatsapp_phone,metadata")
    .single<IrisContactRow>();

  if (error) {
    throw error;
  }

  return data;
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
    .select("id,protocol,status")
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

  return ((data ?? []) as IrisTicketRow[]).find(
    (ticket) => !CLOSED_TICKET_STATUSES.has(ticket.status),
  );
}

async function touchTicketForInbound(
  client: IrisMetaProcessorClient,
  ticket: IrisTicketRow,
) {
  const nextStatus =
    ticket.status === "waiting_customer" ? "waiting_operator" : ticket.status;

  if (nextStatus === ticket.status) {
    return ticket;
  }

  const { data, error } = await client
    .from("caredesk_tickets")
    .update({
      status: nextStatus,
    })
    .eq("id", ticket.id)
    .select("id,protocol,status")
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
        firstMetaWebhookEventId: event.id,
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
    .select("id,protocol,status")
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
      provider_payload: {
        provider: META_PROVIDER,
        webhookEventId: event.id,
      },
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
}: {
  channelId: string | null;
  client: IrisMetaProcessorClient;
  event: IrisMetaWebhookEventRow;
  messageId: string;
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
  const messageType = readString(message?.type) ?? "text";

  if (messageType === "text") {
    const body = readString(asRecord(message?.text)?.body);

    return {
      body: body || "Mensagem de texto recebida pelo WhatsApp.",
      messageType,
    };
  }

  const caption =
    readString(asRecord(message?.image)?.caption) ??
    readString(asRecord(message?.document)?.caption) ??
    readString(asRecord(message?.video)?.caption);

  return {
    body: caption || `Mensagem ${messageType} recebida pelo WhatsApp.`,
    messageType,
  };
}

function extractStatusDetail(payload: Json, statusId: string) {
  const status = findStatuses(payload).find(
    (candidate) => readString(candidate.id) === statusId,
  );

  return readString(status?.status);
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

function addMinutes(value: string, minutes: number) {
  return new Date(
    new Date(value).getTime() + Number(minutes || 60) * 60000,
  ).toISOString();
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
