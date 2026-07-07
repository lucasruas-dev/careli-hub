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
  isCacaClaudeEngineEnabled,
  isCacaVoiceReplyEnabled,
  runCacaClaudeTurn,
} from "@/lib/iris/caca/agent";
import {
  buildBrazilianPhoneVariants,
  downloadMetaWhatsAppMedia,
  getMetaWhatsAppOutboundConfig,
  type MetaWhatsAppDownloadedMedia,
  type MetaWhatsAppSendMessageResult,
  sendMetaWhatsAppAudioMessage,
  sendMetaWhatsAppTemplateMessage,
  sendMetaWhatsAppTextMessage,
  signWhatsAppBody,
} from "@/lib/iris/meta-whatsapp";
import { synthesizeCacaVoiceNote } from "@/lib/iris/tts";
import {
  uploadInboundMediaBuffer,
  uploadIrisMediaBuffer,
} from "@/lib/iris/meta-media-storage";
import { publishHubNotification } from "@/lib/notifications/publish";

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

// Consulta a blocklist casando por TODAS as variantes do número (com/sem 9º dígito,
// com/sem 55). Fail-open: se a checagem falhar, NÃO derruba o webhook (não vale
// perder cliente legítimo por erro transitório) — só loga e segue.
async function isWhatsAppNumberBlocked(
  client: IrisMetaProcessorClient,
  waId: string,
): Promise<boolean> {
  const variants = buildBrazilianPhoneVariants(waId);
  const candidates = variants.length ? variants : [waId];

  const { data, error } = await client
    .from("caredesk_blocked_numbers")
    .select("phone")
    .in("phone", candidates)
    .limit(1);

  if (error) {
    console.error("[iris/meta] checagem de bloqueio falhou", error);
    return false;
  }

  return Boolean(data && data.length > 0);
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

  // Bloqueio de números abusivos (spam/pornografia): descarta o inbound ANTES de
  // criar contato/ticket/mensagem ou responder. Fonte: caredesk_blocked_numbers.
  const inboundWaId = normalizeWhatsAppId(event.contact_wa_id);

  if (inboundWaId && (await isWhatsAppNumberBlocked(client, inboundWaId))) {
    await markWebhookEvent(
      client,
      event.id,
      "ignored",
      "Numero bloqueado (abuso/spam).",
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
  const channel = await getWhatsAppChannel(client, event.phone_number_id);
  const channelId = channel?.id ?? null;
  const channelQueueSlug = readChannelQueueSlug(channel);
  const channelCacaEnabled = readChannelCacaEnabled(channel);
  const queue =
    (await getQueueBySlug(client, channelQueueSlug)) ??
    (channelQueueSlug === DEFAULT_QUEUE_SLUG
      ? null
      : await getDefaultQueue(client));
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
    await enrichInboundMessageDetailWithMediaAnalysis(messageDetail, event, client);
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

  // Central de notificacoes (best-effort, isolado): quando o ticket pertence a um
  // operador HUMANO (assigned_to_user_id setado), avisa que o cliente mandou mensagem.
  // Tickets sob a Caca ficam SEM assigned (ela usa handlingOwner no metadata) -> nao
  // notifica. Fire-and-forget: NUNCA pode quebrar o recebimento do WhatsApp.
  if (activeTicket.assigned_to_user_id) {
    const irisTicketHref = `/iris?ticket=${encodeURIComponent(activeTicket.protocol)}`;
    const inboundPreview =
      enrichedMessageDetail.body.replace(/\s+/g, " ").trim().slice(0, 140) ||
      "(mensagem)";

    void publishHubNotification({
      actionHref: irisTicketHref,
      body: `${contact.display_name}: ${inboundPreview}`,
      context: { entityId: activeTicket.id, entityType: "iris-ticket" },
      kind: "atendimento",
      moduleId: "iris",
      push: { url: irisTicketHref },
      recipientUserIds: [activeTicket.assigned_to_user_id],
      severity: ticketCreated ? "warning" : "info",
      title: ticketCreated
        ? `Novo atendimento ${activeTicket.protocol}`
        : `Nova mensagem em ${activeTicket.protocol}`,
    }).catch(() => undefined);
  }

  const autoReplySent = await maybeSendCacaAutoReply({
    cacaEnabled: channelCacaEnabled,
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

    const deliveryError =
      deliveryStatus === "failed"
        ? extractStatusError(event.payload, providerStatusId)
        : null;

    if (deliveryError) {
      // Falha: guarda o motivo (merge no provider_payload existente) pra tela
      // mostrar "por que falhou". Read-modify-write so no caminho de erro (raro).
      const { data: failedRows } = await client
        .from("caredesk_messages")
        .select("id,body,message_type,provider_payload")
        .in("id", messageIds);

      for (const row of failedRows ?? []) {
        const current =
          row.provider_payload && typeof row.provider_payload === "object"
            ? (row.provider_payload as Record<string, unknown>)
            : {};

        await client
          .from("caredesk_messages")
          .update({
            ...messageStatusPatch,
            provider_payload: {
              ...current,
              deliveryError: {
                at: event.received_at,
                code: deliveryError.code,
                message: deliveryError.message,
                title: deliveryError.title,
              },
            },
          })
          .eq("id", row.id);

        // Auto-retry do 9o digito: "undeliverable" generico em numero BR costuma ser o
        // Meta ter batido na variante errada do 9o digito. Reenvia UMA vez na outra
        // variante (so se o Meta ainda nao a tentou). Best-effort — nunca quebra o webhook.
        try {
          await maybeRetryBrazilNinthDigit({
            client,
            deliveryError,
            event,
            row: {
              body: typeof row.body === "string" ? row.body : null,
              id: row.id as string,
              messageType:
                typeof row.message_type === "string" ? row.message_type : null,
              providerPayload: current,
            },
          });
        } catch (retryError) {
          console.error(
            "[iris/meta] auto-retry 9o digito falhou",
            retryError instanceof Error ? retryError.message : retryError,
          );
        }
      }
    } else {
      await client
        .from("caredesk_messages")
        .update(messageStatusPatch)
        .in("id", messageIds);
    }
  }

  await markWebhookEvent(client, event.id, "processed");
  return true;
}

// Reenvia UMA vez na outra variante do 9o digito quando o Meta reporta "undeliverable"
// (generico, sem codigo) num numero BR — cobre o caso do disparo ativo bater na forma
// errada do celular. Pula o reenvio se a alternativa e justamente a que o Meta ja tentou
// (o wa_id que falhou), evitando reenvio inutil e custo de template a toa.
async function maybeRetryBrazilNinthDigit({
  client,
  deliveryError,
  event,
  row,
}: {
  client: IrisMetaProcessorClient;
  deliveryError: { code: number | null; message: string | null; title: string | null };
  event: IrisMetaWebhookEventRow;
  row: {
    body: string | null;
    id: string;
    messageType: string | null;
    providerPayload: Record<string, unknown>;
  };
}): Promise<void> {
  const reason = `${deliveryError.title ?? ""} ${deliveryError.message ?? ""}`.toLowerCase();

  // So o "undeliverable" generico (sem codigo). Erros com codigo (bloqueio/spam/etc.)
  // nao sao caso de 9o digito.
  if (deliveryError.code || !reason.includes("undeliver")) {
    return;
  }

  const payload = row.providerPayload;

  // Anti-loop: ja avaliou/reenviou uma vez.
  if (payload.nineDigitRetry) {
    return;
  }

  const sentTo = digitsOnly(readString(payload.destination) ?? "");
  const metaContacts = asRecord(payload.meta)?.contacts;
  const failedWaId = digitsOnly(
    readString(
      asRecord(Array.isArray(metaContacts) ? metaContacts[0] : null)?.wa_id,
    ) ?? "",
  );
  const alternate = flipBrazilNinthDigit(sentTo);

  if (!alternate || alternate === sentTo || (failedWaId && alternate === failedWaId)) {
    // Sem alternativa util (ou o Meta ja tentou essa forma). Marca como avaliado e sai.
    await flagNineDigitRetry(client, row.id, payload, {
      skipped: failedWaId && alternate === failedWaId ? "meta_ja_tentou" : "sem_alternativa",
    });
    return;
  }

  const template = asRecord(payload.template);
  const phoneNumberId =
    readString(template?.phoneNumberId) ||
    readString(asRecord(payload.meta)?.phoneNumberId) ||
    "";
  const baseConfig = getMetaWhatsAppOutboundConfig();
  const config = phoneNumberId
    ? { ...baseConfig, phoneNumberId }
    : baseConfig;

  let result: MetaWhatsAppSendMessageResult;

  if (row.messageType === "template" && template && readString(template.name)) {
    result = await sendMetaWhatsAppTemplateMessage({
      bodyParameters: Array.isArray(template.bodyParameters)
        ? template.bodyParameters.map((value) => String(value))
        : [],
      config,
      language: readString(template.language) || "pt_BR",
      name: readString(template.name) ?? "",
      to: alternate,
    });
  } else if (row.body) {
    result = await sendMetaWhatsAppTextMessage({
      body: row.body,
      config,
      to: alternate,
    });
  } else {
    await flagNineDigitRetry(client, row.id, payload, { skipped: "sem_conteudo" });
    return;
  }

  if (!result.messageId) {
    await flagNineDigitRetry(client, row.id, payload, { skipped: "sem_message_id" });
    return;
  }

  // Reaponta a mensagem pro novo envio: volta pra "sent", novo external id + rastro do retry.
  await client
    .from("caredesk_messages")
    .update({
      delivery_status: "sent",
      external_message_id: result.messageId,
      sent_at: event.received_at,
      provider_payload: {
        ...payload,
        nineDigitRetry: {
          at: event.received_at,
          previousDestination: sentTo,
          to: alternate,
          waMessageId: result.messageId,
        },
      },
    })
    .eq("id", row.id);

  // Nova ref: as proximas atualizacoes de status desse envio caem NESTA mensagem.
  await client.from("caredesk_whatsapp_message_refs").upsert(
    {
      delivery_status: "sent",
      direction: "outbound",
      message_id: row.id,
      phone_number_id: phoneNumberId || null,
      provider: META_PROVIDER,
      wa_contact_id: alternate,
      wa_message_id: result.messageId,
    },
    { onConflict: "provider,wa_message_id" },
  );
}

async function flagNineDigitRetry(
  client: IrisMetaProcessorClient,
  messageId: string,
  payload: Record<string, unknown>,
  info: Record<string, unknown>,
): Promise<void> {
  await client
    .from("caredesk_messages")
    .update({
      provider_payload: {
        ...payload,
        nineDigitRetry: { ...info, at: new Date().toISOString() },
      },
    })
    .eq("id", messageId);
}

// Devolve a OUTRA variante do 9o digito de um celular BR (com 9 -> sem 9, sem 9 -> com 9),
// sempre com DDI 55. null se nao for um celular BR reconhecivel.
function flipBrazilNinthDigit(digits: string): string | null {
  const withCountry =
    digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  const withNinth = /^55(\d{2})9(\d{8})$/.exec(withCountry);

  if (withNinth) {
    return `55${withNinth[1]}${withNinth[2]}`;
  }

  const withoutNinth = /^55(\d{2})(\d{8})$/.exec(withCountry);

  if (withoutNinth) {
    return `55${withoutNinth[1]}9${withoutNinth[2]}`;
  }

  return null;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
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

type IrisChannelRow = {
  config: Record<string, unknown> | null;
  external_account_id: string | null;
  id: string;
  phone_number: string | null;
};

const WHATSAPP_CHANNEL_SELECT = "id,phone_number,external_account_id,config";
const QUEUE_SELECT =
  "id,name,slug,default_priority,sla_first_response_minutes,sla_resolution_minutes";

// Resolve o canal WhatsApp pelo phone_number_id de entrada (multi-numero).
// Se nao houver canal mapeado pra esse numero, faz fallback no canal padrao por
// slug — preservando o comportamento atual (numero unico -> canal/fila padrao).
async function getWhatsAppChannel(
  client: IrisMetaProcessorClient,
  phoneNumberId?: string | null,
): Promise<IrisChannelRow | null> {
  const normalizedPhoneNumberId = phoneNumberId?.trim();

  if (normalizedPhoneNumberId) {
    const { data, error } = await client
      .from("caredesk_channels")
      .select(WHATSAPP_CHANNEL_SELECT)
      .eq("provider", META_PROVIDER)
      .eq("external_account_id", normalizedPhoneNumberId)
      .maybeSingle<IrisChannelRow>();

    if (error) {
      throw error;
    }

    if (data) {
      return data;
    }
  }

  const { data, error } = await client
    .from("caredesk_channels")
    .select(WHATSAPP_CHANNEL_SELECT)
    .eq("slug", WHATSAPP_CHANNEL_SLUG)
    .eq("provider", META_PROVIDER)
    .maybeSingle<IrisChannelRow>();

  if (error) {
    throw error;
  }

  return data;
}

// Slug da fila default deste canal (config.defaultQueueSlug); cai no padrao.
function readChannelQueueSlug(channel: IrisChannelRow | null): string {
  const config = channel && isRecord(channel.config) ? channel.config : null;
  return readString(config?.defaultQueueSlug) ?? DEFAULT_QUEUE_SLUG;
}

// CACA so atende quando o canal habilita (config.cacaEnabled). Default = true
// pra nao desligar a automacao do canal atual que ainda nao tem a flag.
function readChannelCacaEnabled(channel: IrisChannelRow | null): boolean {
  const config = channel && isRecord(channel.config) ? channel.config : null;
  return config?.cacaEnabled !== false;
}

async function getQueueBySlug(client: IrisMetaProcessorClient, slug: string) {
  const { data, error } = await client
    .from("caredesk_queues")
    .select(QUEUE_SELECT)
    .eq("slug", slug)
    .maybeSingle<IrisQueueRow>();

  if (error) {
    throw error;
  }

  return data;
}

async function getDefaultQueue(client: IrisMetaProcessorClient) {
  return getQueueBySlug(client, DEFAULT_QUEUE_SLUG);
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

  // Casa o contato por TODAS as variantes do número (com/sem 9º dígito, com/sem 55).
  // A Meta manda o waId SEM o 9; o cadastro do Apolo grava COM o 9 — sem isto, o
  // inbound forka um contato novo e duplica o ticket.
  const phoneVariants = buildBrazilianPhoneVariants(waId);
  const phoneFilterList = (phoneVariants.length ? phoneVariants : [waId]).join(",");
  const { data: existingContacts, error: lookupError } = await client
    .from("caredesk_contacts")
    .select(
      "id,display_name,document,email,phone,whatsapp_phone,metadata,c2x_payload,created_at,updated_at",
    )
    .or(`whatsapp_phone.in.(${phoneFilterList}),phone.in.(${phoneFilterList})`)
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

  // Regra única: variantes com/sem 9º dígito e com/sem 55 (ver meta-whatsapp.ts).
  const variants = buildBrazilianPhoneVariants(normalized);

  return (variants.length ? variants : [normalized]).filter((value) =>
    Boolean(normalizeWhatsAppId(value)),
  );
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
      // Assunto começa EM BRANCO — o operador define (regra Lucas).
      subject: null,
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
  client: IrisMetaProcessorClient,
): Promise<InboundMessageDetail> {
  if (!messageDetail.media) {
    return messageDetail;
  }

  const config = event.phone_number_id
    ? {
        ...getMetaWhatsAppOutboundConfig(),
        phoneNumberId: event.phone_number_id,
      }
    : undefined;
  const media = messageDetail.media;

  // 1 download só da Meta, reusado pelo Storage (exibição) E pela CACÁ (leitura/transcrição).
  let downloaded: MetaWhatsAppDownloadedMedia | null = null;

  if (media.providerMediaId) {
    try {
      downloaded = await downloadMetaWhatsAppMedia({
        config,
        mediaId: media.providerMediaId,
      });
    } catch (error) {
      console.error("[iris] falha ao baixar midia inbound", errorMessage(error));
    }
  }

  const [storedUrl, mediaAnalysis] = await Promise.all([
    downloaded
      ? persistInboundMediaForPlayback({ client, downloaded, media })
      : Promise.resolve(null),
    analyzeCacaInboundMedia({ config, media, preloaded: downloaded }),
  ]);

  return {
    ...messageDetail,
    media: storedUrl ? { ...media, storedUrl } : media,
    mediaAnalysis,
  };
}

// Sobe a mídia recebida (qualquer tipo — imagem, documento, vídeo, áudio) no Storage e devolve a
// URL pública pra exibição. Best-effort: falha aqui não derruba o inbound.
async function persistInboundMediaForPlayback({
  client,
  downloaded,
  media,
}: {
  client: IrisMetaProcessorClient;
  downloaded: MetaWhatsAppDownloadedMedia;
  media: CacaInboundMedia;
}): Promise<string | null> {
  if (!media.providerMediaId) {
    return null;
  }

  try {
    const persisted = await uploadInboundMediaBuffer({
      buffer: downloaded.buffer,
      client,
      mediaId: media.providerMediaId,
      mimeType: downloaded.mimeType ?? media.mimeType,
    });

    return persisted?.url ?? null;
  } catch (error) {
    console.error("[iris] falha ao persistir midia inbound", errorMessage(error));

    return null;
  }
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
    // id real da mídia → habilita backfill/re-download enquanto a Meta retém o arquivo.
    providerMediaId: media.providerMediaId ?? null,
    sha256: media.sha256 ?? null,
    type: media.type,
    // URL pública persistida no Storage → o player do front (`media.url`) toca direto.
    url: media.storedUrl ?? null,
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

// Motivo de uma falha de entrega (Meta manda em statuses[].errors[]). Guardamos
// code/title/message pra tela explicar "por que falhou" em vez do generico.
function extractStatusError(payload: Json, statusId: string) {
  const status = findStatuses(payload).find(
    (candidate) => readString(candidate.id) === statusId,
  );
  const errors = Array.isArray(status?.errors) ? status?.errors : [];
  const first = asRecord(errors[0]);

  if (!first) {
    return null;
  }

  const errorData = asRecord(first.error_data);
  const rawCode = readString(first.code);
  const code = rawCode && Number.isFinite(Number(rawCode)) ? Number(rawCode) : null;
  const title = readString(first.title) || null;
  const message =
    readString(first.message) ||
    readString(errorData?.details) ||
    title ||
    null;

  if (!code && !title && !message) {
    return null;
  }

  return { code, message, title };
}

async function maybeSendCacaAutoReply({
  cacaEnabled,
  channelId,
  client,
  contact,
  event,
  messageDetail,
  ticket,
}: {
  cacaEnabled: boolean;
  channelId: string | null;
  client: IrisMetaProcessorClient;
  contact: IrisContactRow;
  event: IrisMetaWebhookEventRow;
  messageDetail: InboundMessageDetail;
  ticket: IrisTicketRow;
}) {
  const destination = normalizeWhatsAppId(event.contact_wa_id);

  if (!cacaEnabled || !destination || !shouldCacaAutomationRun(ticket)) {
    return false;
  }

  // Engine novo (Cacá super-agente Claude) atrás de flag, com fallback automático pra
  // Cacá determinística se a Claude não estiver configurada ou falhar — nenhum atendimento
  // fica sem resposta.
  // Espelhar: se o cliente mandou ÁUDIO e o master switch está ligado, a CACÁ responde em VOZ.
  // Só com o engine Claude (texto "falado" natural). Ver [[project-caca-voice-tts]].
  const voiceReply =
    isCacaVoiceReplyEnabled() &&
    isCacaClaudeEngineEnabled() &&
    messageDetail.messageType === "audio";

  let reply: CacaAutoReply;

  if (isCacaClaudeEngineEnabled()) {
    try {
      reply = await runCacaClaudeTurn({
        client,
        contact,
        destination,
        messageDetail,
        outboundPhoneNumberId: event.phone_number_id ?? null,
        ticket,
        voiceMode: voiceReply,
      });
    } catch (error) {
      console.error(
        "[iris] Cacá-Claude falhou; usando a Cacá deterministica",
        errorMessage(error),
      );
      reply = await runCacaAgentTurn({ client, contact, messageDetail, ticket });
    }
  } else {
    reply = await runCacaAgentTurn({ client, contact, messageDetail, ticket });
  }

  // Link precisa ser clicável -> se a resposta tiver URL, manda por texto mesmo (não vira voz).
  const sendAsVoice = voiceReply && !/https?:\/\//i.test(reply.replyText);

  const queuedMessage = await insertCacaOutboundMessage({
    body: reply.replyText,
    channelId,
    client,
    contactId: contact.id,
    event,
    ticketId: ticket.id,
    voiceReply: sendAsVoice,
  });

  try {
    const outboundConfig = event.phone_number_id
      ? {
          ...getMetaWhatsAppOutboundConfig(),
          phoneNumberId: event.phone_number_id,
        }
      : undefined;

    let result: MetaWhatsAppSendMessageResult | null = null;
    // Mídia do áudio da CACÁ persistida no Storage → o cockpit consegue TOCAR a voz dela
    // (o front lê provider_payload.media.url). Sem isso, a mensagem outbound só guardava o
    // resultado do envio Meta e aparecia como "Audio WhatsApp 0:00" sem player.
    let outboundAudioMedia: Record<string, unknown> | null = null;

    if (sendAsVoice) {
      try {
        const voice = await synthesizeCacaVoiceNote(reply.replyText);

        result = await sendMetaWhatsAppAudioMessage({
          audioBase64: voice.audioBase64,
          config: outboundConfig,
          contextMessageId: event.provider_message_id,
          fileName: voice.fileName,
          mimeType: voice.mimeType,
          to: destination,
        });

        // Só persiste depois do envio dar certo (o áudio realmente foi pra o cliente).
        // Best-effort: falha ao subir não pode derrubar a resposta.
        try {
          const persisted = await uploadIrisMediaBuffer({
            buffer: Buffer.from(voice.audioBase64, "base64"),
            client,
            folder: "outbound",
            mimeType: voice.mimeType,
            name: queuedMessage.id,
          });

          if (persisted?.url) {
            outboundAudioMedia = {
              fileName: voice.fileName,
              mimeType: persisted.mimeType,
              type: "audio",
              url: persisted.url,
              voice: true,
            };
          }
        } catch (persistError) {
          console.error(
            "[iris] falha ao persistir a voz da Cacá no storage",
            errorMessage(persistError),
          );
        }
      } catch (voiceError) {
        // TTS/envio de áudio falhou: cai pra TEXTO pra o cliente nunca ficar sem resposta.
        console.error(
          "[iris] Cacá voz falhou; caindo pra texto",
          errorMessage(voiceError),
        );
      }
    }

    if (!result) {
      // Assina pro cliente como "Cacá" (o corpo salvo localmente fica sem assinatura).
      result = await sendMetaWhatsAppTextMessage({
        body: signWhatsAppBody(CACA_OPERATOR_LABEL, reply.replyText),
        config: outboundConfig,
        contextMessageId: event.provider_message_id,
        to: destination,
      });
    }
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
        media: outboundAudioMedia,
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

  const state = readCacaAutomationState(ticket.metadata);

  if (state.handoffRequired) {
    return false;
  }

  if (isActiveContactTicket(ticket)) {
    // Cobranca: a CACA assume o contato ATIVO (processo validado) quando o
    // cliente responde — estamos processando um inbound, entao o cliente
    // respondeu. Demais contatos ativos seguem sem automacao.
    return isCobrancaActiveContactTicket(ticket);
  }

  return true;
}

function isCobrancaActiveContactTicket(ticket: IrisTicketRow) {
  const metadata = isRecord(ticket.metadata) ? ticket.metadata : null;
  return isRecord(metadata?.cobranca);
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
  voiceReply = false,
}: {
  body: string;
  channelId: string | null;
  client: IrisMetaProcessorClient;
  contactId: string;
  event: IrisMetaWebhookEventRow;
  ticketId: string;
  // Foi enviada como nota de voz (áudio). O body guarda o texto falado (transcrição).
  voiceReply?: boolean;
}) {
  const { data, error } = await client
    .from("caredesk_messages")
    .insert({
      body,
      channel_id: channelId,
      delivery_status: "queued",
      direction: "outbound",
      message_type: voiceReply ? "audio" : "text",
      provider_payload: {
        automation: "caca",
        operatorLabel: CACA_OPERATOR_LABEL,
        provider: META_PROVIDER,
        replyTo: {
          externalMessageId: event.provider_message_id,
          webhookEventId: event.id,
        },
        source_module: "iris",
        voiceReply,
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
  media,
  messageId,
  result,
  to,
}: {
  client: IrisMetaProcessorClient;
  // Mídia (áudio da voz da CACÁ) persistida no Storage — vai pro provider_payload.media
  // pra o cockpit tocar. null quando a resposta foi por texto.
  media?: Record<string, unknown> | null;
  messageId: string;
  result: MetaWhatsAppSendMessageResult;
  to: string;
}) {
  const providerPayload: Record<string, unknown> = {
    automation: "caca",
    destination: to,
    meta: normalizeJsonPayload(result.raw),
    operatorLabel: CACA_OPERATOR_LABEL,
    provider: META_PROVIDER,
    source_module: "iris",
  };

  if (media) {
    providerPayload.media = media;
  }

  const { error } = await client
    .from("caredesk_messages")
    .update({
      delivery_status: "sent",
      external_message_id: result.messageId,
      provider_payload: providerPayload,
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
