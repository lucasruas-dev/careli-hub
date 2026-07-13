// Inbound de e-mail da Iris: lê os não-lidos da caixa robô caca@ (que é membro dos Grupos
// do Workspace) e transforma cada e-mail em ticket + mensagem no caredesk, espelhando o
// processador do Meta (canal → contato → ticket → mensagem), porém mais simples: e-mail não
// tem a janela de 24h do WhatsApp, e o dedup de conversa é por `threadId` do Gmail. Roda por
// cron (poll). Ver [[project-iris-email-grupos]].
import {
  getGmailIngestMailbox,
  getGmailMessage,
  isGmailConfigured,
  listGmailMessageIds,
  markGmailMessageRead,
  type ParsedGmailMessage,
} from "@/lib/iris/gmail";
import { createIrisMetaAdminClient } from "@/lib/iris/meta-server";

type IrisAdminClient = NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;

// Status de ticket que contam como "aberto" (anexa em vez de abrir outro).
const OPEN_TICKET_STATUSES = [
  "new",
  "open",
  "waiting_customer",
  "waiting_operator",
  "pending",
];
const DEFAULT_EMAIL_QUEUE_SLUG = "atendimento";
const GMAIL_PROVIDER = "gmail";

type ChannelRow = {
  config: Record<string, unknown> | null;
  external_account_id: string | null;
  id: string;
  workspace_id: string | null;
};

type ContactRow = {
  display_name: string | null;
  email: string | null;
  id: string;
  metadata: Record<string, unknown> | null;
};

type IngestOutcome = "appended" | "created" | "skipped";

export type GmailInboundSummary = {
  appended: number;
  created: number;
  errors: number;
  mailbox: string;
  ok: boolean;
  processed: number;
  reason?: string;
  skipped: number;
  unread: number;
};

export async function ingestGmailInbox({
  maxResults = 25,
}: { maxResults?: number } = {}): Promise<GmailInboundSummary> {
  const mailbox = getGmailIngestMailbox();
  const empty: GmailInboundSummary = {
    appended: 0,
    created: 0,
    errors: 0,
    mailbox,
    ok: false,
    processed: 0,
    skipped: 0,
    unread: 0,
  };

  if (!isGmailConfigured()) {
    return { ...empty, reason: "gmail-not-configured" };
  }

  const client = createIrisMetaAdminClient();

  if (!client) {
    return { ...empty, reason: "supabase-not-configured" };
  }

  const unread = await listGmailMessageIds({ maxResults, query: "is:unread" });
  const summary: GmailInboundSummary = { ...empty, ok: true, unread: unread.length };

  for (const { id } of unread) {
    try {
      const message = await getGmailMessage(id);
      const outcome = await ingestOne(client, message);

      summary.processed += 1;

      // Só marca lido quando VIROU ticket (created/appended). O "skipped" (sem canal
      // mapeado) fica UNREAD de propósito: assim, se o canal daquele grupo for criado
      // depois, o e-mail ainda é ingerido — nada se perde. (São poucos: a caca@ só recebe
      // cópia dos grupos de que é membro; e-mail de sistema direto pra ela é raro.)
      if (outcome === "created") {
        summary.created += 1;
        await markGmailMessageRead(id);
      } else if (outcome === "appended") {
        summary.appended += 1;
        await markGmailMessageRead(id);
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(
        "[iris][gmail-inbound] falha ao processar mensagem",
        id,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return summary;
}

async function ingestOne(
  client: IrisAdminClient,
  message: ParsedGmailMessage,
): Promise<IngestOutcome> {
  const recipients = extractEmails([message.deliveredTo, message.to]);
  const channel = await findEmailChannel(client, recipients);

  if (!channel) {
    // Nenhum grupo mapeado (piloto = só contato@). Não vira ticket.
    return "skipped";
  }

  const fromEmail = message.fromEmail?.trim().toLowerCase() ?? null;

  if (!fromEmail) {
    return "skipped";
  }

  const contact = await findOrCreateEmailContact(client, {
    displayName: message.fromName ?? fromEmail,
    email: fromEmail,
    receivedAt: message.date,
    workspaceId: channel.workspace_id,
  });

  const body = pickMessageBody(message);
  const existingTicketId = await findOpenTicketId(client, channel.id, message.threadId);

  const ticketId =
    existingTicketId ??
    (await createEmailTicket(client, { body, channel, contact, message }));

  await insertInboundMessage(client, { body, channelId: channel.id, contact, message, ticketId });

  if (existingTicketId) {
    await touchTicketOnReply(client, existingTicketId, message.date);
  }

  return existingTicketId ? "appended" : "created";
}

// --- canal ---

async function findEmailChannel(
  client: IrisAdminClient,
  recipients: string[],
): Promise<ChannelRow | null> {
  if (recipients.length === 0) {
    return null;
  }

  const { data, error } = await client
    .from("caredesk_channels")
    .select("id,external_account_id,config,workspace_id")
    .eq("kind", "email")
    .eq("status", "active")
    .in("external_account_id", recipients)
    .limit(1)
    .maybeSingle<ChannelRow>();

  if (error) {
    throw error;
  }

  return data;
}

function readChannelQueueSlug(channel: ChannelRow): string {
  const slug = channel.config?.["defaultQueueSlug"];

  return typeof slug === "string" && slug.trim() ? slug.trim() : DEFAULT_EMAIL_QUEUE_SLUG;
}

// --- contato ---

async function findOrCreateEmailContact(
  client: IrisAdminClient,
  input: {
    displayName: string;
    email: string;
    receivedAt: string | null;
    workspaceId: string | null;
  },
): Promise<ContactRow> {
  const { data: existing, error: lookupError } = await client
    .from("caredesk_contacts")
    .select("id,display_name,email,metadata")
    .ilike("email", input.email)
    .limit(1)
    .maybeSingle<ContactRow>();

  if (lookupError) {
    throw lookupError;
  }

  const now = input.receivedAt ?? new Date().toISOString();

  if (existing) {
    const metadata = {
      ...(isRecord(existing.metadata) ? existing.metadata : {}),
      lastInboundAt: now,
      provider: GMAIL_PROVIDER,
      source: "gmail_email",
    };
    const { data, error } = await client
      .from("caredesk_contacts")
      .update({
        display_name: existing.display_name?.trim() || input.displayName,
        metadata,
      })
      .eq("id", existing.id)
      .select("id,display_name,email,metadata")
      .single<ContactRow>();

    if (error) {
      throw error;
    }

    return data;
  }

  const { data, error } = await client
    .from("caredesk_contacts")
    .insert({
      display_name: input.displayName,
      email: input.email,
      metadata: {
        firstInboundAt: now,
        lastInboundAt: now,
        provider: GMAIL_PROVIDER,
        source: "gmail_email",
      },
      person_type: "email",
      workspace_id: input.workspaceId,
    })
    .select("id,display_name,email,metadata")
    .single<ContactRow>();

  if (error) {
    throw error;
  }

  return data;
}

// --- ticket ---

async function findOpenTicketId(
  client: IrisAdminClient,
  channelId: string,
  threadId: string,
): Promise<string | null> {
  if (!threadId) {
    return null;
  }

  const { data, error } = await client
    .from("caredesk_tickets")
    .select("id,status")
    .eq("channel_id", channelId)
    .eq("source_context->>gmailThreadId", threadId)
    .in("status", OPEN_TICKET_STATUSES)
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; status: string }>();

  if (error) {
    throw error;
  }

  return data?.id ?? null;
}

async function createEmailTicket(
  client: IrisAdminClient,
  input: {
    body: string;
    channel: ChannelRow;
    contact: ContactRow;
    message: ParsedGmailMessage;
  },
): Promise<string> {
  const { channel, contact, message } = input;
  const queue = await getQueueBySlug(client, readChannelQueueSlug(channel));
  const profile = queue ? await getDefaultProfile(client, queue.id) : null;
  const protocol = await nextTicketProtocol(client);
  const now = message.date ?? new Date().toISOString();
  const firstResponseMinutes =
    profile?.sla_first_response_minutes ?? queue?.sla_first_response_minutes ?? 60;
  const resolutionMinutes =
    profile?.sla_resolution_minutes ?? queue?.sla_resolution_minutes ?? 480;
  const priority = profile?.priority ?? queue?.default_priority ?? "medium";
  const subject = message.subject?.trim() ? message.subject.trim().slice(0, 200) : null;

  const { data, error } = await client
    .from("caredesk_tickets")
    .insert({
      channel_id: channel.id,
      contact_id: contact.id,
      first_response_due_at: addMinutes(now, firstResponseMinutes),
      metadata: {
        firstGmailMessageId: message.id,
        gmailThreadId: message.threadId,
        lastCustomerMessageAt: now,
        provider: GMAIL_PROVIDER,
        source: "gmail_email_inbound",
      },
      opened_at: now,
      priority,
      profile_id: profile?.id ?? null,
      protocol,
      queue_id: queue?.id ?? null,
      resolution_due_at: addMinutes(now, resolutionMinutes),
      source_context: {
        firstMessagePreview: truncate(input.body, 220),
        fromEmail: message.fromEmail,
        fromName: message.fromName,
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        groupAddress: channel.external_account_id,
        provider: GMAIL_PROVIDER,
        subject: message.subject,
      },
      source_entity_id: message.id,
      source_entity_type: "gmail-message",
      source_module: "iris",
      status: "new",
      // E-mail já tem assunto próprio (diferente do WhatsApp), então prefill.
      subject,
      workspace_id: channel.workspace_id,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    throw error;
  }

  return data.id;
}

async function touchTicketOnReply(
  client: IrisAdminClient,
  ticketId: string,
  receivedAt: string | null,
) {
  const now = receivedAt ?? new Date().toISOString();
  const { data: ticket } = await client
    .from("caredesk_tickets")
    .select("metadata,status")
    .eq("id", ticketId)
    .maybeSingle<{ metadata: Record<string, unknown> | null; status: string }>();

  const metadata = {
    ...(isRecord(ticket?.metadata) ? ticket?.metadata : {}),
    lastCustomerMessageAt: now,
  };
  // Cliente respondeu: se estava aguardando o cliente, volta pra fila do operador.
  const status = ticket?.status === "waiting_customer" ? "waiting_operator" : ticket?.status;

  await client
    .from("caredesk_tickets")
    .update({ metadata, ...(status ? { status } : {}) })
    .eq("id", ticketId);
}

async function insertInboundMessage(
  client: IrisAdminClient,
  input: {
    body: string;
    channelId: string;
    contact: ContactRow;
    message: ParsedGmailMessage;
    ticketId: string;
  },
) {
  const { message } = input;
  const { error } = await client.from("caredesk_messages").insert({
    body: input.body,
    channel_id: input.channelId,
    delivery_status: "delivered",
    direction: "inbound",
    external_message_id: message.id,
    message_type: "text",
    provider_payload: {
      attachments: message.attachments,
      deliveredTo: message.deliveredTo,
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      gmailMessageId: message.id,
      gmailThreadId: message.threadId,
      hasHtml: Boolean(message.bodyHtml),
      inReplyTo: message.inReplyTo,
      messageIdHeader: message.messageIdHeader,
      provider: GMAIL_PROVIDER,
      references: message.references,
      subject: message.subject,
    },
    sender_contact_id: input.contact.id,
    sender_type: "customer",
    sent_at: message.date ?? new Date().toISOString(),
    ticket_id: input.ticketId,
  });

  if (error) {
    throw error;
  }
}

async function nextTicketProtocol(client: IrisAdminClient): Promise<string> {
  const { data, error } = await client.rpc("next_caredesk_ticket_protocol");

  if (error || typeof data !== "string" || !data.startsWith("AT-")) {
    throw new Error("Sequencia de protocolo AT da Iris nao esta configurada no banco.");
  }

  return data;
}

async function getQueueBySlug(client: IrisAdminClient, slug: string) {
  const { data, error } = await client
    .from("caredesk_queues")
    .select("id,default_priority,sla_first_response_minutes,sla_resolution_minutes")
    .eq("slug", slug)
    .maybeSingle<{
      default_priority: string | null;
      id: string;
      sla_first_response_minutes: number | null;
      sla_resolution_minutes: number | null;
    }>();

  if (error) {
    throw error;
  }

  return data;
}

async function getDefaultProfile(client: IrisAdminClient, queueId: string) {
  const { data, error } = await client
    .from("caredesk_ticket_profiles")
    .select("id,priority,sla_first_response_minutes,sla_resolution_minutes")
    .eq("queue_id", queueId)
    .eq("status", "active")
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle<{
      id: string;
      priority: string | null;
      sla_first_response_minutes: number | null;
      sla_resolution_minutes: number | null;
    }>();

  if (error) {
    throw error;
  }

  return data;
}

// --- helpers ---

// Extrai os endereços de e-mail (lowercase) de uma lista de headers To/Delivered-To, que
// podem vir como "Nome <addr@x>", "addr@x" ou vários separados por vírgula.
function extractEmails(headers: Array<string | null>): string[] {
  const found = new Set<string>();

  for (const header of headers) {
    if (!header) {
      continue;
    }

    for (const match of header.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
      found.add(match[0].toLowerCase());
    }
  }

  return Array.from(found);
}

function pickMessageBody(message: ParsedGmailMessage): string {
  const text = message.bodyText?.trim();

  if (text) {
    return text;
  }

  const fromHtml = message.bodyHtml ? htmlToText(message.bodyHtml) : "";

  if (fromHtml.trim()) {
    return fromHtml.trim();
  }

  return message.snippet?.trim() || "(e-mail sem corpo de texto)";
}

// Conversão simples HTML→texto pra guardar o corpo legível (o provider_payload.hasHtml
// marca que havia HTML; a renderização rica fica pra depois).
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
