/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  IrisCrm360Registration,
  IrisData,
  IrisMessage,
  IrisMessageReaction,
  IrisPriority,
  IrisQueueConfig,
  IrisReplyPreview,
  IrisSnapshot,
  IrisStatus,
  IrisTicket,
  IrisTicketProfileConfig,
} from "../types/iris-types";

export const emptyIrisData: IrisData = {
  broadcasts: [],
  channels: [],
  profiles: [],
  queues: [],
  templates: [],
  tickets: [],
};

export const IRIS_QUEUE_LOAD_TIMEOUT_MS = 15_000;
const IRIS_CRM360_ENRICH_TIMEOUT_MS = 4_000;

// Cache do último CRM 360 casado com sucesso, por telefone. O overlay (nome do
// cadastro + painel do Apolo) é re-buscado a cada refresh (90s + realtime + foco);
// se a chamada estoura o timeout ou volta "missing" transitório, NÃO derrubamos o
// cadastro já conhecido — senão, no meio do atendimento, o nome do comprador vira o
// handle do WhatsApp e o painel da direita esvazia. Reseta no reload (robustez em memória).
const irisCrm360RegistrationCache = new Map<string, IrisCrm360Registration>();

export async function loadIrisData({
  operatorUserId,
  queueSlugFilter,
}: {
  operatorUserId?: string | null;
  queueSlugFilter?: string | null;
} = {}): Promise<IrisData> {
  const supabase = getHubSupabaseClient();

  if (!supabase) {
    return emptyIrisData;
  }

  const normalizedQueueSlugFilter =
    normalizeOptionalIrisQueueSlug(queueSlugFilter);
  const queuesResult = await supabase
    .from("caredesk_queues")
    .select(
      "id,name,slug,color,status,default_priority,sla_first_response_minutes,sla_resolution_minutes,routing_strategy,assignment_strategy,metadata",
    )
    .order("name", { ascending: true });

  if (queuesResult.error) {
    throw queuesResult.error;
  }

  const queues = (queuesResult.data ?? []).map(mapQueueRow);
  const scopedQueueIds = normalizedQueueSlugFilter
    ? queues
        .filter((queue) =>
          isSameIrisQueueScope(queue, normalizedQueueSlugFilter),
        )
        .map((queue) => queue.id)
    : [];
  let ticketsQuery = supabase
    .from("caredesk_tickets")
    .select(
      "id,protocol,contact_id,queue_id,profile_id,channel_id,status,priority,subject,source_module,source_entity_type,source_context,assigned_to_user_id,opened_at,first_response_due_at,resolution_due_at,first_responded_at,resolved_at,closed_at,metadata,created_at,updated_at",
    )
    .order("opened_at", { ascending: false })
    .limit(200);

  if (operatorUserId) {
    ticketsQuery = ticketsQuery.eq("assigned_to_user_id", operatorUserId);
  }

  if (normalizedQueueSlugFilter) {
    ticketsQuery = scopedQueueIds.length
      ? ticketsQuery.in("queue_id", scopedQueueIds)
      : ticketsQuery.eq("queue_id", "__iris_queue_scope_not_found__");
  }

  const [
    ticketsResult,
    profilesResult,
    templatesResult,
    channelsResult,
    broadcastsResult,
  ] = await Promise.all([
    ticketsQuery,
    supabase
      .from("caredesk_ticket_profiles")
      .select(
        "id,queue_id,name,slug,category,priority,sla_first_response_minutes,sla_resolution_minutes,description,required_fields,status",
      )
      .order("category", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("caredesk_templates")
      .select(
        "id,name,slug,category,channel_kind,body,variables,status,metadata",
      )
      .order("name", { ascending: true }),
    supabase
      .from("caredesk_channels")
      .select("id,name,kind,status,external_account_id")
      .order("name", { ascending: true }),
    supabase
      .from("caredesk_broadcasts")
      .select("id,name,status,scheduled_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const failedResult = [
    ticketsResult,
    profilesResult,
    templatesResult,
    channelsResult,
    broadcastsResult,
  ].find((result) => result.error);

  if (failedResult?.error) {
    throw failedResult.error;
  }

  const ticketsRows = ticketsResult.data ?? [];
  const ticketIds = ticketsRows.map((ticket) => ticket.id);
  const contactIds = unique(
    ticketsRows.map((ticket) => ticket.contact_id).filter(Boolean),
  );
  const assignedUserIds = unique(
    ticketsRows.map((ticket) => ticket.assigned_to_user_id).filter(Boolean),
  );

  const [contactsResult, messagesResult, assignedUsersResult] =
    await Promise.all([
      contactIds.length
        ? supabase
            .from("caredesk_contacts")
            .select(
              "id,display_name,document,email,phone,whatsapp_phone,metadata,c2x_payload",
            )
            .in("id", contactIds)
        : Promise.resolve({ data: [], error: null }),
      ticketIds.length
        ? supabase
            .from("caredesk_messages")
            .select(
              "id,ticket_id,body,direction,sender_type,sender_user_id,message_type,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id,sender_user:hub_users(display_name,email,avatar_url)",
            )
            .in("ticket_id", ticketIds)
            // Sem .limit explicito o PostgREST corta em 1000 linhas; com ordem
            // ASCENDENTE isso derrubava as mensagens MAIS NOVAS (tickets recentes
            // ficavam "sem mensagens" depois que o workspace passou de 1000 msgs).
            // Buscamos as 1000 MAIS NOVAS (desc) e o groupMessagesByTicket reordena
            // ascendente por ticket para o resto do codigo (ultima msg, nao-lidas).
            .order("created_at", { ascending: false })
            .limit(1000)
        : Promise.resolve({ data: [], error: null }),
      assignedUserIds.length
        ? supabase
            .from("hub_users")
            .select("id,display_name,avatar_url")
            .in("id", assignedUserIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  const failedNestedResult = [
    contactsResult,
    messagesResult,
    assignedUsersResult,
  ].find((result) => result.error);

  if (failedNestedResult?.error) {
    throw failedNestedResult.error;
  }

  const channels = (channelsResult.data ?? []).map((channel) => ({
    id: channel.id,
    kind: channel.kind,
    name: channel.name,
    phoneNumberId:
      typeof channel.external_account_id === "string"
        ? channel.external_account_id
        : null,
    status: channel.status,
  }));
  const templates = (templatesResult.data ?? [])
    .map((template) => ({
      body: template.body ?? null,
      category: template.category,
      channelKind: template.channel_kind,
      id: template.id,
      metadata:
        template.metadata && typeof template.metadata === "object"
          ? template.metadata
          : null,
      name: template.name,
      slug: template.slug,
      status: template.status,
      variables: normalizeTemplateVariablesValue(template.variables),
    }))
    .filter((template) => {
      const status = String(template.status ?? "")
        .trim()
        .toLocaleLowerCase("pt-BR");

      return status !== "archived";
    });
  const broadcasts = (broadcastsResult.data ?? []).map((broadcast) => ({
    id: broadcast.id,
    name: broadcast.name,
    scheduledAt: broadcast.scheduled_at,
    status: broadcast.status,
  }));
  const queueById = new Map(queues.map((queue) => [queue.id, queue]));
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const contactById = new Map(
    (contactsResult.data ?? []).map((contact) => [contact.id, contact]),
  );
  const assignedUserById = new Map(
    (assignedUsersResult.data ?? []).map((user) => [user.id, user]),
  );
  const profileRows = profilesResult.data ?? [];
  const profiles = profileRows.map((profile) =>
    mapTicketProfileRow(
      profile,
      profile.queue_id ? queueById.get(profile.queue_id) : null,
    ),
  );
  const profileById = new Map(
    profileRows.map((profile) => [profile.id, profile]),
  );
  const messagesByTicket = groupMessagesByTicket(messagesResult.data ?? []);

  // Grupos NAO sao tickets (decisao do Lucas, 14/jul): sao entidades proprias
  // (GRP-xxxx) e as mensagens penduram direto neles. Aqui eles entram na mesma
  // lista de conversas do cockpit, como uma conversa permanente (sem SLA/encerramento).
  const groupConversations = await loadGroupConversations({
    includeGroups:
      !operatorUserId &&
      (!normalizedQueueSlugFilter ||
        normalizedQueueSlugFilter === GROUP_QUEUE_SLUG),
    queues,
    supabase,
  });

  return {
    broadcasts,
    channels,
    profiles,
    queues,
    templates,
    tickets: [
      ...ticketsRows.map((ticket) =>
        mapTicketRow({
          channel: ticket.channel_id
            ? channelById.get(ticket.channel_id)
            : null,
          contact: ticket.contact_id ? contactById.get(ticket.contact_id) : null,
          messages: messagesByTicket.get(ticket.id) ?? [],
          profile: ticket.profile_id ? profileById.get(ticket.profile_id) : null,
          queue: ticket.queue_id
            ? (queueById.get(ticket.queue_id) ?? null)
            : null,
          assignedUser: ticket.assigned_to_user_id
            ? assignedUserById.get(ticket.assigned_to_user_id)
            : null,
          row: ticket,
        }),
      ),
      ...groupConversations,
    ],
  };
}

const GROUP_QUEUE_SLUG = "grupos-whatsapp";
const GROUP_CHANNEL_SLUG = "whatsapp-grupo";

// Carrega os grupos monitorados e suas mensagens, devolvendo cada grupo como uma
// CONVERSA (formato IrisTicket para o cockpit reaproveitar a tela). Nao ha ticket
// por tras: o "protocolo" e o codigo do grupo (GRP-xxxx) e o id e o id do grupo.
async function loadGroupConversations({
  includeGroups,
  queues,
  supabase,
}: {
  includeGroups: boolean;
  queues: IrisQueueConfig[];
  supabase: NonNullable<ReturnType<typeof getHubSupabaseClient>>;
}): Promise<IrisTicket[]> {
  if (!includeGroups) {
    return [];
  }

  const groupsResult = await supabase
    .from("caredesk_whatsapp_groups")
    .select(
      "id,code,group_jid,subject,participants_count,monitored,last_message_at,created_at,updated_at",
    )
    .eq("monitored", true)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  const groupRows = groupsResult.data ?? [];

  if (groupRows.length === 0) {
    return [];
  }

  const groupIds = groupRows.map((group: any) => group.id as string);

  const groupMessagesResult = await supabase
    .from("caredesk_messages")
    .select(
      "id,group_id,body,direction,sender_type,sender_user_id,message_type,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id,sender_user:hub_users(display_name,email,avatar_url)",
    )
    .in("group_id", groupIds)
    .order("created_at", { ascending: false })
    .limit(1000);

  const messagesByGroup = new Map<string, IrisMessage[]>();
  for (const row of groupMessagesResult.data ?? []) {
    const groupId = (row as any).group_id as string | null;
    if (!groupId) {
      continue;
    }
    const list = messagesByGroup.get(groupId) ?? [];
    list.push(mapMessageRow(row));
    messagesByGroup.set(groupId, list);
  }
  // Vieram DESC (pra nao perder as mais novas no corte de 1000); o resto do
  // codigo espera ordem cronologica.
  for (const list of messagesByGroup.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  const groupQueue = queues.find((queue) => queue.slug === GROUP_QUEUE_SLUG);
  // O mapeamento de canais nao carrega o slug — busca o canal do grupo direto.
  const groupChannelResult = await supabase
    .from("caredesk_channels")
    .select("id,name")
    .eq("slug", GROUP_CHANNEL_SLUG)
    .maybeSingle<{ id: string; name: string }>();
  const groupChannel = groupChannelResult.data ?? null;

  return groupRows.map((group: any) => {
    const messages = messagesByGroup.get(group.id as string) ?? [];
    const lastMessage = messages[messages.length - 1];
    const title = (group.subject as string | null)?.trim() || "Grupo sem nome";

    return {
      assignedToLabel: "Grupo monitorado",
      channelId: groupChannel?.id ?? null,
      channelKind: "whatsapp",
      channelLabel: groupChannel?.name ?? "Relacionamento",
      contactLabel: title,
      contactPhone: null,
      createdAt: (group.created_at as string) ?? new Date().toISOString(),
      id: group.id as string,
      isGroup: true,
      lastMessageAt:
        (group.last_message_at as string | null) ??
        lastMessage?.createdAt ??
        (group.created_at as string),
      lastMessagePreview: lastMessage
        ? irisMessagePreview(lastMessage)
        : "Sem mensagens registradas",
      messages,
      metadata: {
        groupCode: group.code,
        groupJid: group.group_jid,
        participantsCount: group.participants_count,
      },
      openedAt: (group.created_at as string) ?? new Date().toISOString(),
      priority: "medium",
      profileLabel: "Grupo",
      protocol: (group.code as string) ?? "GRP",
      queueLabel: groupQueue?.name ?? "Grupo",
      queueSlug: groupQueue?.slug ?? GROUP_QUEUE_SLUG,
      sourceContext: {
        groupJid: group.group_jid,
        provider: "evolution",
        readOnly: false,
      },
      sourceLabel: "WhatsApp · Relacionamento",
      status: "open",
      subject: title,
      unread: false,
      unreadCount: 0,
    } satisfies IrisTicket;
  });
}

export async function enrichTicketsWithCrm360(
  data: IrisData,
  {
    getAccessToken,
  }: {
    getAccessToken: () => Promise<string | null>;
  },
): Promise<IrisData> {
  const phones = unique(
    data.tickets
      .map((ticket) => ticket.contactPhone)
      .filter((phone): phone is string => Boolean(phone?.trim())),
  );

  if (!phones.length) {
    return data;
  }

  // Aplica o melhor cadastro por ticket: um resultado fresco REGISTRADO ganha e vai
  // pro cache; senão mantém o último cadastro conhecido (cache); senão o que já tinha
  // no ticket; senão "missing". Assim uma falha/timeout ou um "missing" transitório
  // NÃO derruba o nome/painel de quem já resolveu como comprador do Apolo.
  const applyRegistrations = (
    results: Record<string, IrisCrm360Registration>,
  ): IrisData => ({
    ...data,
    tickets: data.tickets.map((ticket) => {
      const phone = ticket.contactPhone;

      if (!phone) {
        return { ...ticket, crm360Registration: ticket.crm360Registration ?? null };
      }

      const fresh = results[phone];

      if (fresh && fresh.status === "registered") {
        irisCrm360RegistrationCache.set(phone, fresh);
        return { ...ticket, crm360Registration: fresh };
      }

      const cached = irisCrm360RegistrationCache.get(phone);

      return {
        ...ticket,
        crm360Registration:
          cached ?? fresh ?? ticket.crm360Registration ?? { status: "missing" },
      };
    }),
  });

  try {
    const accessToken = await getAccessToken();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      IRIS_CRM360_ENRICH_TIMEOUT_MS,
    );

    const response = await fetch("/api/iris/apolo/phone-match", {
      body: JSON.stringify({ phones }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);

    if (!response.ok) {
      // Endpoint falhou: preserva o último cadastro conhecido em vez de derrubar.
      return applyRegistrations({});
    }

    const payload = (await response.json().catch(() => null)) as {
      results?: Record<string, IrisCrm360Registration>;
    } | null;

    return applyRegistrations(payload?.results ?? {});
  } catch (error) {
    const isAbort =
      error instanceof DOMException && error.name === "AbortError";

    if (isAbort) {
      console.warn("[iris] consulta CRM 360 excedeu o tempo limite");
    } else {
      console.error("[iris] nao foi possivel consultar o CRM 360", error);
    }

    // Timeout/erro: preserva o último cadastro conhecido (não pisca nome/painel).
    return applyRegistrations({});
  }
}

export async function withIrisTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: number | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} excedeu ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

export function mapQueueRow(row: any): IrisQueueConfig {
  return {
    assignmentStrategy: row.assignment_strategy ?? "manual",
    channelId:
      typeof row.metadata?.channelId === "string" ? row.metadata.channelId : null,
    color: row.color ?? "#A07C3B",
    defaultPriority: normalizePriority(row.default_priority),
    id: row.id,
    name: row.name,
    routingStrategy: row.routing_strategy ?? "manual",
    slaFirstResponseMinutes: Number(row.sla_first_response_minutes ?? 60),
    slaResolutionMinutes: Number(row.sla_resolution_minutes ?? 480),
    slug: row.slug,
    status: row.status,
  };
}

export function mapTicketProfileRow(
  row: any,
  queue?: IrisQueueConfig | null,
): IrisTicketProfileConfig {
  return {
    category: row.category ?? "Atendimento",
    description: row.description ?? null,
    id: row.id,
    name: row.name ?? "Sem nome",
    priority: normalizePriority(row.priority),
    queueId: row.queue_id ?? null,
    queueLabel: queue?.name ?? "Sem fila",
    requiredFields: normalizeRequiredFields(row.required_fields),
    slaFirstResponseMinutes: Number(row.sla_first_response_minutes ?? 60),
    slaResolutionMinutes: Number(row.sla_resolution_minutes ?? 480),
    slug: row.slug ?? "",
    status: row.status ?? "active",
  };
}

// Não-lidas: quantas mensagens do CLIENTE chegaram desde a última resposta nossa
// (igual o Hermes). Conta as inbound do fim pra trás até bater numa outbound.
// Notas internas não contam nem zeram. Ticket fechado = 0.
function computeUnreadCount(messages: IrisMessage[], status: unknown): number {
  if (["closed", "resolved", "cancelled"].includes(String(status ?? ""))) {
    return 0;
  }

  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const direction = messages[index]?.direction;

    if (direction === "outbound") {
      break;
    }
    if (direction === "inbound") {
      count += 1;
    }
  }

  return count;
}

// Erro de envio: o ticket está "em erro" se a ÚLTIMA mensagem de saída falhou
// (ex.: 131042/pagamento). Se uma mensagem posterior saiu, o ticket sai do erro.
function hasTicketDeliveryError(messages: IrisMessage[]): boolean {
  const outbound = messages.filter(
    (message) => message.direction === "outbound",
  );

  if (!outbound.length) {
    return false;
  }

  const latest = outbound.reduce((current, candidate) =>
    (candidate.createdAt ?? "") >= (current.createdAt ?? "") ? candidate : current,
  );

  return latest.deliveryStatus === "failed";
}

function mapTicketRow(input: {
  assignedUser?: any;
  channel: any;
  contact: any;
  messages: IrisMessage[];
  profile: any;
  queue: IrisQueueConfig | null;
  row: any;
}): IrisTicket {
  const lastMessage = input.messages[input.messages.length - 1];
  const sourceModule = String(input.row.source_module ?? "").trim();

  return {
    assignedToAvatarUrl: isUsableUrl(input.assignedUser?.avatar_url)
      ? input.assignedUser.avatar_url
      : null,
    assignedToLabel: readTicketAssignedToLabel(
      input.assignedUser,
      input.messages,
    ),
    assignedToUserId: input.row.assigned_to_user_id ?? null,
    channelId: input.row.channel_id,
    channelKind: input.channel?.kind ?? null,
    channelLabel: input.channel?.name ?? "Canal nao definido",
    isGroup: input.row.source_entity_type === "whatsapp-group",
    isDirect: input.row.source_entity_type === "whatsapp-direct",
    hasDeliveryError: hasTicketDeliveryError(input.messages),
    contactAvatarUrl: getContactAvatarUrl(input.contact),
    contactDocument: input.contact?.document ?? null,
    contactEmail: input.contact?.email ?? null,
    contactId: input.row.contact_id,
    contactLabel: input.contact?.display_name ?? "Cliente sem cadastro",
    contactPhone: input.contact?.whatsapp_phone ?? input.contact?.phone ?? null,
    closedAt: input.row.closed_at,
    createdAt: input.row.created_at,
    firstRespondedAt: input.row.first_responded_at,
    firstResponseDueAt: input.row.first_response_due_at,
    id: input.row.id,
    lastMessageAt:
      lastMessage?.createdAt ?? input.row.updated_at ?? input.row.opened_at,
    lastMessagePreview: lastMessage
      ? irisMessagePreview(lastMessage)
      : "Sem mensagens registradas",
    metadata:
      input.row.metadata && typeof input.row.metadata === "object"
        ? input.row.metadata
        : null,
    messages: input.messages,
    openedAt: input.row.opened_at,
    priority: normalizePriority(input.row.priority),
    profileLabel: input.profile?.name ?? "Sem perfil",
    protocol: input.row.protocol,
    queueLabel: input.queue?.name ?? "Sem fila",
    queueSlug: input.queue?.slug ?? null,
    resolutionDueAt: input.row.resolution_due_at,
    resolvedAt: input.row.resolved_at,
    sourceContext:
      input.row.source_context && typeof input.row.source_context === "object"
        ? input.row.source_context
        : null,
    sourceLabel: sourceModule ? labelForSource(sourceModule) : "Entrada direta",
    status: normalizeStatus(input.row.status),
    // Assunto em branco até o operador definir (regra Lucas) — sem fallback automático.
    subject: input.row.subject ?? "",
    unread: Boolean(
      lastMessage &&
        lastMessage.direction === "inbound" &&
        !["closed", "resolved", "cancelled"].includes(input.row.status),
    ),
    unreadCount: computeUnreadCount(input.messages, input.row.status),
  };
}

export function mapMessageRow(row: any): IrisMessage {
  return {
    audioDurationMs: readMessageAudioDuration(row),
    audioMimeType: readMessageAudioMimeType(row),
    audioUrl: readMessageAudioUrl(row),
    body: row.body ?? "",
    createdAt: row.created_at,
    deliveryStatus: row.delivery_status ?? "queued",
    direction: row.direction ?? "internal",
    editedAt: readMessageEditedAt(row),
    deliveredAt: row.delivered_at ?? null,
    externalMessageId: row.external_message_id ?? null,
    failureReason: readMessageFailureReason(row),
    id: row.id,
    mediaFileName: readMessageMediaFileName(row),
    mediaKind: readMessageMediaKind(row),
    mediaMimeType: readMessageAudioMimeType(row),
    mediaUrl: readMessageAudioUrl(row),
    messageType: row.message_type ?? readMessageType(row),
    operatorAvatarUrl: readMessageOperatorAvatarUrl(row),
    readAt: row.read_at ?? null,
    reactions: readMessageReactions(row),
    replyTo: readMessageReplyPreview(row),
    senderLabel: readMessageSenderLabel(row),
    senderType: row.sender_type ?? "system",
    sentAt: row.sent_at ?? null,
  };
}

// Traducao amigavel dos erros de entrega do Meta (codigos da Cloud API) pra
// tela explicar a falha em vez do generico "Falha no envio".
const META_DELIVERY_ERROR_LABELS: Record<string, string> = {
  "131042": "Problema de pagamento na conta do WhatsApp (Meta) — verifique o metodo de pagamento.",
  "131047": "Fora da janela de 24h — precisa de template aprovado.",
  "131026": "Mensagem nao entregue (numero invalido ou sem WhatsApp).",
  "131049": "Bloqueada pela Meta para manter engajamento saudavel.",
  "130472": "Numero em experimento da Meta (entrega limitada).",
  "132000": "Parametros do template nao batem com o aprovado.",
  "132001": "Template nao existe ou nao esta aprovado.",
};

function readMessageFailureReason(row: any): string | null {
  const payload = row?.provider_payload;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const deliveryError = (payload as Record<string, unknown>).deliveryError;

  if (!deliveryError || typeof deliveryError !== "object") {
    return null;
  }

  const record = deliveryError as Record<string, unknown>;
  const code =
    record.code == null ? "" : String(record.code).replace(/\D/g, "");
  const friendly = code ? META_DELIVERY_ERROR_LABELS[code] : undefined;

  if (friendly) {
    return friendly;
  }

  const message =
    typeof record.message === "string" && record.message.trim()
      ? record.message.trim()
      : typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : null;

  return message;
}

function readMessageSenderLabel(row: any) {
  const payload = row?.provider_payload;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    // Mensagem de grupo de WhatsApp: quem enviou é o participante, não o "grupo".
    const groupParticipant = (payload as Record<string, unknown>)
      .groupParticipantName;
    if (typeof groupParticipant === "string" && groupParticipant.trim()) {
      return groupParticipant.trim();
    }

    const operatorLabel = (payload as Record<string, unknown>).operatorLabel;
    const displayLabel = maybeIrisOperatorLabel(operatorLabel);

    if (displayLabel) {
      return displayLabel;
    }
  }

  const nestedUser = row?.sender_user;

  if (
    nestedUser &&
    typeof nestedUser === "object" &&
    !Array.isArray(nestedUser) &&
    typeof nestedUser.display_name === "string" &&
    nestedUser.display_name.trim()
  ) {
    return maybeIrisOperatorLabel(nestedUser.display_name) ?? "Operador Iris";
  }

  if (typeof row?.sender_label === "string" && row.sender_label.trim()) {
    return row?.sender_type === "operator"
      ? formatIrisOperatorLabel(row.sender_label)
      : row.sender_label.trim();
  }

  return row?.sender_type === "operator" ? "Operador Iris" : null;
}

function readMessageOperatorAvatarUrl(row: any) {
  const payload = row?.provider_payload;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const avatarUrl = (payload as Record<string, unknown>).operatorAvatarUrl;

    if (isUsableUrl(avatarUrl)) {
      return avatarUrl;
    }
  }

  const nestedUser = row?.sender_user;

  if (
    nestedUser &&
    typeof nestedUser === "object" &&
    !Array.isArray(nestedUser) &&
    isUsableUrl(nestedUser.avatar_url)
  ) {
    return nestedUser.avatar_url;
  }

  return null;
}

function readMessageType(row: any) {
  const payload = row?.provider_payload;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const media = (payload as Record<string, unknown>).media;

    if (media && typeof media === "object" && !Array.isArray(media)) {
      const type = (media as Record<string, unknown>).type;

      if (typeof type === "string" && type.trim()) {
        return type.trim();
      }
    }
  }

  return "text";
}

function readMessageEditedAt(row: any) {
  const payload = row?.provider_payload;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const editedAt = (payload as Record<string, unknown>).editedAt;

    if (typeof editedAt === "string" && editedAt.trim()) {
      return editedAt.trim();
    }
  }

  return null;
}

function readMessageReplyPreview(row: any): IrisReplyPreview | null {
  const payload = row?.provider_payload;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const reply = (payload as Record<string, unknown>).replyTo;

  if (!reply || typeof reply !== "object" || Array.isArray(reply)) {
    return null;
  }

  const record = reply as Record<string, unknown>;
  const messageId =
    typeof record.messageId === "string" ? record.messageId : "";

  if (!messageId) {
    return null;
  }

  return {
    body:
      typeof record.body === "string" ? record.body : "Mensagem selecionada",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
    direction:
      record.direction === "inbound" ||
      record.direction === "outbound" ||
      record.direction === "internal"
        ? record.direction
        : null,
    externalMessageId:
      typeof record.externalMessageId === "string"
        ? record.externalMessageId
        : null,
    messageId,
    senderLabel:
      typeof record.senderLabel === "string" && record.senderLabel.trim()
        ? record.senderLabel.trim()
        : null,
  };
}

function readMessageReactions(row: any): IrisMessageReaction[] {
  const payload = row?.provider_payload;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const reactions = (payload as Record<string, unknown>).reactions;

  if (!Array.isArray(reactions)) {
    return [];
  }

  return reactions
    .map((reaction) => {
      if (
        !reaction ||
        typeof reaction !== "object" ||
        Array.isArray(reaction)
      ) {
        return null;
      }

      const record = reaction as Record<string, unknown>;
      const emoji = typeof record.emoji === "string" ? record.emoji.trim() : "";

      if (!emoji) {
        return null;
      }

      return {
        actorAvatarUrl: isUsableUrl(record.actorAvatarUrl)
          ? record.actorAvatarUrl
          : null,
        actorLabel:
          typeof record.actorLabel === "string" && record.actorLabel.trim()
            ? record.actorLabel.trim()
            : null,
        actorUserId:
          typeof record.actorUserId === "string" && record.actorUserId.trim()
            ? record.actorUserId.trim()
            : null,
        createdAt:
          typeof record.createdAt === "string" && record.createdAt.trim()
            ? record.createdAt.trim()
            : null,
        emoji,
      } satisfies IrisMessageReaction;
    })
    .filter(Boolean) as IrisMessageReaction[];
}

function readMessageAudioDuration(row: any) {
  const media = readMessageMediaPayload(row);
  const duration = media?.durationMs;

  return typeof duration === "number" && Number.isFinite(duration)
    ? duration
    : null;
}

function readMessageAudioMimeType(row: any) {
  const media = readMessageMediaPayload(row);
  const mimeType = media?.mimeType;

  return typeof mimeType === "string" && mimeType.trim()
    ? mimeType.trim()
    : null;
}

function readMessageAudioUrl(row: any) {
  const media = readMessageMediaPayload(row);
  const url = media?.url ?? media?.externalUrl;

  return isUsableUrl(url) ? url : null;
}

function readMessageMediaPayload(row: any): Record<string, unknown> | null {
  const payload = row?.provider_payload;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const media = (payload as Record<string, unknown>).media;

  return media && typeof media === "object" && !Array.isArray(media)
    ? (media as Record<string, unknown>)
    : null;
}

function readMessageMediaKind(row: any) {
  const media = readMessageMediaPayload(row);
  const kind = media?.type;

  return typeof kind === "string" && kind.trim() ? kind.trim() : null;
}

function readMessageMediaFileName(row: any) {
  const media = readMessageMediaPayload(row);
  const fileName = media?.fileName;

  return typeof fileName === "string" && fileName.trim()
    ? fileName.trim()
    : null;
}

export function ensureOperatorIdentity(
  message: IrisMessage,
  operatorLabel: string,
  operatorAvatarUrl?: string | null,
) {
  if (message.direction !== "outbound") {
    return message;
  }

  return {
    ...message,
    operatorAvatarUrl: message.operatorAvatarUrl ?? operatorAvatarUrl ?? null,
    senderLabel:
      maybeIrisOperatorLabel(message.senderLabel) ??
      formatIrisOperatorLabel(operatorLabel),
  };
}

function groupMessagesByTicket(rows: any[]) {
  const groups = new Map<string, IrisMessage[]>();

  // Reordena ASCENDENTE (mais antiga -> mais nova) independentemente da ordem que veio
  // do banco, porque o resto do fluxo assume essa ordem (ultima mensagem, contagem de
  // nao-lidas e a thread da conversa). A busca vem desc (1000 mais novas) por causa do
  // teto de linhas do PostgREST.
  const ascending = [...rows].sort((a, b) => {
    const aTime = new Date(a?.created_at ?? 0).getTime();
    const bTime = new Date(b?.created_at ?? 0).getTime();

    return aTime - bTime;
  });

  ascending.forEach((row) => {
    const ticketId = row.ticket_id;
    if (!ticketId) {
      return;
    }

    const current = groups.get(ticketId) ?? [];
    current.push(mapMessageRow(row));
    groups.set(ticketId, current);
  });

  return groups;
}

// Historico COMPLETO de UM ticket, buscado sob demanda ao abrir a conversa. A carga em
// massa (loadIrisData) tem o teto de 1000 linhas do PostgREST por WORKSPACE — aqui
// filtramos por um unico ticket_id, entao o limite alto e so uma guarda; um ticket
// isolado nao chega perto disso. No render, o resultado e mesclado (uniao por id) com as
// mensagens ao vivo do snapshot, para nenhum ticket (novo ou antigo) truncar nunca.
export async function loadTicketMessages(
  ticketId: string,
): Promise<IrisMessage[]> {
  const supabase = getHubSupabaseClient();

  if (!supabase || !ticketId) {
    return [];
  }

  const { data, error } = await supabase
    .from("caredesk_messages")
    .select(
      "id,ticket_id,body,direction,sender_type,sender_user_id,message_type,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id,sender_user:hub_users(display_name,email,avatar_url)",
    )
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true })
    .limit(2000);

  if (error || !data) {
    return [];
  }

  return data.map((row) => mapMessageRow(row));
}

export function buildIrisSnapshot(
  data: IrisData,
  onlineOperators = 0,
): IrisSnapshot {
  const tickets = data.tickets;
  const total = tickets.length;
  const openTickets = tickets.filter((ticket) => !isClosedTicket(ticket));
  const critical = tickets.filter(
    (ticket) => ticket.priority === "critical" || isSlaCritical(ticket),
  ).length;
  const slaCritical = tickets.filter(isSlaCritical).length;
  const unanswered = tickets.filter(isWaitingForIris).length;
  const waitingOperator = tickets.filter(
    (ticket) =>
      effectiveIrisStatus(ticket) === "waiting_operator" ||
      ticket.assignedToLabel === "Sem responsavel",
  ).length;
  const inbox = tickets.filter(
    (ticket) =>
      effectiveIrisStatus(ticket) === "new" ||
      effectiveIrisStatus(ticket) === "waiting_operator" ||
      effectiveIrisStatus(ticket) === "pending",
  ).length;
  const contacts = unique(
    tickets.map((ticket) => ticket.contactId).filter(Boolean),
  ).length;
  const messages = tickets.reduce(
    (totalMessages, ticket) => totalMessages + ticket.messages.length,
    0,
  );
  const topTicket = [...tickets].sort(scoreTicketForAction)[0] ?? null;

  return {
    aiActions: Math.max(critical + unanswered + waitingOperator, 0),
    contacts,
    critical,
    averageHandlingTimeLabel: estimateAverageHandlingTime(tickets),
    firstResponseLabel: estimateFirstResponse(tickets),
    followUpsToday: unanswered + slaCritical,
    inbox,
    messages,
    onlineOperators,
    open: openTickets.length,
    responseTimeLabel: estimateAverageResponse(tickets),
    slaCritical,
    topTicket,
    total,
    unanswered,
    waitingOperator,
  };
}

function scoreTicketForAction(first: IrisTicket, second: IrisTicket) {
  return ticketScore(second) - ticketScore(first);
}

function ticketScore(ticket: IrisTicket) {
  return (
    (ticket.priority === "critical" ? 500 : 0) +
    (ticket.priority === "high" ? 250 : 0) +
    (isSlaCritical(ticket) ? 300 : 0) +
    (isWaitingForIris(ticket) ? 180 : 0) +
    (effectiveIrisStatus(ticket) === "waiting_operator" ? 120 : 0)
  );
}

function readTicketAssignedToLabel(assignedUser: any, messages: IrisMessage[]) {
  const assignedLabel = maybeIrisOperatorLabel(assignedUser?.display_name);

  if (assignedLabel) {
    return assignedLabel;
  }

  const latestOperatorMessage = [...messages]
    .reverse()
    .find(
      (message) =>
        message.direction === "outbound" &&
        message.senderType === "operator" &&
        Boolean(maybeIrisOperatorLabel(message.senderLabel)),
    );
  const latestOperatorLabel = maybeIrisOperatorLabel(
    latestOperatorMessage?.senderLabel,
  );

  return latestOperatorLabel ?? "Sem responsavel";
}

function normalizeTemplateVariablesValue(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : null))
    .filter((item): item is string => Boolean(item));
}

function normalizeRequiredFields(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      return parseRequiredFields(value);
    }
  }

  return [];
}

function parseRequiredFields(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugifyIrisQueue(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "fila-atendimento";
}

function normalizeOptionalIrisQueueSlug(value?: string | null) {
  const trimmed = String(value ?? "").trim();

  return trimmed ? slugifyIrisQueue(trimmed) : null;
}

function isSameIrisQueueScope(
  queue: IrisQueueConfig,
  normalizedQueueSlug: string,
) {
  return [queue.slug, queue.name]
    .map((value) => normalizeOptionalIrisQueueSlug(value))
    .includes(normalizedQueueSlug);
}

function normalizePriority(value: unknown): IrisPriority {
  if (
    value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low"
  ) {
    return value;
  }

  return "medium";
}

function normalizeStatus(value: unknown): IrisStatus {
  if (
    value === "new" ||
    value === "open" ||
    value === "waiting_customer" ||
    value === "waiting_operator" ||
    value === "pending" ||
    value === "resolved" ||
    value === "closed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return "new";
}

function isClosedTicket(ticket: IrisTicket) {
  return ["cancelled", "closed", "resolved"].includes(ticket.status);
}

function effectiveIrisStatus(ticket: IrisTicket): IrisStatus {
  if (shouldPromoteNewTicketToPending(ticket)) {
    return "pending";
  }

  return ticket.status;
}

function shouldPromoteNewTicketToPending(ticket: IrisTicket) {
  if (ticket.status !== "new" || hasCareliResponse(ticket)) {
    return false;
  }

  const openedAt = dateValue(ticket.openedAt);

  if (!openedAt) {
    return false;
  }

  return Date.now() - openedAt >= 3 * 60 * 1000;
}

function hasCareliResponse(ticket: IrisTicket) {
  return (
    Boolean(ticket.firstRespondedAt) || getFirstCareliResponseAt(ticket) > 0
  );
}

function isWaitingForIris(ticket: IrisTicket) {
  const status = effectiveIrisStatus(ticket);

  return (
    !isClosedTicket(ticket) &&
    (ticket.unread ||
      status === "new" ||
      status === "pending" ||
      status === "waiting_operator")
  );
}

function isSlaCritical(ticket: IrisTicket) {
  const due = ticket.firstRespondedAt
    ? ticket.resolutionDueAt
    : (ticket.firstResponseDueAt ?? ticket.resolutionDueAt);

  if (!due || isClosedTicket(ticket)) {
    return false;
  }

  return new Date(due).getTime() <= Date.now();
}

function estimateFirstResponse(tickets: IrisTicket[]) {
  const responseTimes = tickets
    .map((ticket) => {
      const openedAt = dateValue(ticket.openedAt);
      const firstResponseAt = getFirstCareliResponseAt(ticket);

      return openedAt && firstResponseAt
        ? Math.max(0, firstResponseAt - openedAt) / 60000
        : null;
    })
    .filter((minutes): minutes is number => minutes !== null);

  if (!responseTimes.length) {
    return "Sem dados";
  }

  return formatDuration(average(responseTimes));
}

function estimateAverageResponse(tickets: IrisTicket[]) {
  const responseTimes = tickets.flatMap(ticketResponseTimeMinutes);

  if (!responseTimes.length) {
    return "Sem dados";
  }

  return formatDuration(average(responseTimes));
}

function estimateAverageHandlingTime(tickets: IrisTicket[]) {
  const handlingTimes = tickets
    .map((ticket) => {
      const openedAt = dateValue(ticket.openedAt);
      const closedAt =
        dateValue(ticket.closedAt) || dateValue(ticket.resolvedAt);

      return openedAt && closedAt
        ? Math.max(0, closedAt - openedAt) / 60000
        : null;
    })
    .filter((minutes): minutes is number => minutes !== null);

  if (!handlingTimes.length) {
    return "Sem dados";
  }

  return formatDuration(average(handlingTimes));
}

function getFirstCareliResponseAt(ticket: IrisTicket) {
  const firstRespondedAt = dateValue(ticket.firstRespondedAt);

  if (firstRespondedAt) {
    return firstRespondedAt;
  }

  const openedAt = dateValue(ticket.openedAt);
  const firstResponse = sortedTicketMessages(ticket).find((message) => {
    return isCareliMessage(message) && dateValue(message.createdAt) >= openedAt;
  });

  return dateValue(firstResponse?.createdAt);
}

function ticketResponseTimeMinutes(ticket: IrisTicket) {
  const waits: number[] = [];
  let waitingFrom: number | null = null;

  sortedTicketMessages(ticket).forEach((message) => {
    const createdAt = dateValue(message.createdAt);

    if (!createdAt) {
      return;
    }

    if (isCustomerMessage(message) && waitingFrom === null) {
      waitingFrom = createdAt;
      return;
    }

    if (
      isCareliMessage(message) &&
      waitingFrom !== null &&
      createdAt >= waitingFrom
    ) {
      waits.push((createdAt - waitingFrom) / 60000);
      waitingFrom = null;
    }
  });

  return waits;
}

function sortedTicketMessages(ticket: IrisTicket) {
  return [...ticket.messages].sort(
    (first, second) => dateValue(first.createdAt) - dateValue(second.createdAt),
  );
}

function isCareliMessage(message: IrisMessage) {
  return message.direction === "outbound" || message.senderType === "operator";
}

function isCustomerMessage(message: IrisMessage) {
  return message.direction === "inbound" || message.senderType === "customer";
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatDuration(minutes: number) {
  if (!Number.isFinite(minutes)) {
    return "Sem dados";
  }

  const rounded = Math.round(minutes);

  if (rounded < 60) {
    return `${rounded}m`;
  }

  return `${Math.floor(rounded / 60)}h ${rounded % 60}m`;
}

function labelForSource(source: string) {
  if (source === "manual") {
    return "Entrada manual";
  }

  if (source === "support") {
    return "Suporte ao cliente";
  }

  return "Acionamento externo";
}

function irisMessagePreview(message: IrisMessage) {
  if (message.messageType === "audio") {
    return "Audio WhatsApp";
  }

  if (message.messageType && message.messageType !== "text") {
    return message.body || `Mensagem ${message.messageType}`;
  }

  return message.body || "Mensagem sem texto";
}

function getContactAvatarUrl(contact: any) {
  const candidates = [
    contact?.metadata?.avatar_url,
    contact?.metadata?.avatarUrl,
    contact?.metadata?.profile_picture_url,
    contact?.metadata?.profilePictureUrl,
    contact?.metadata?.profile_photo_url,
    contact?.metadata?.profilePhotoUrl,
    contact?.metadata?.picture,
    contact?.metadata?.image,
    contact?.c2x_payload?.avatar_url,
    contact?.c2x_payload?.avatarUrl,
    contact?.c2x_payload?.profile_picture_url,
    contact?.c2x_payload?.profilePictureUrl,
    contact?.c2x_payload?.picture,
  ];

  return candidates.find(isUsableUrl) ?? null;
}

function isUsableUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^https?:\/\//i.test(value.trim()) &&
    value.trim().length <= 2048
  );
}

function maybeIrisOperatorLabel(value?: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized || normalized.includes("@")) {
    return null;
  }

  return formatIrisDisplayName(normalized);
}

function formatIrisOperatorLabel(value?: unknown) {
  return maybeIrisOperatorLabel(value) ?? "Operador Iris";
}

function formatIrisDisplayName(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return value;
  }

  return normalized
    .split(" ")
    .map((word, index) => formatIrisDisplayNameWord(word, index))
    .join(" ");
}

function formatIrisDisplayNameWord(word: string, index: number) {
  const lower = word.toLocaleLowerCase("pt-BR");
  const smallWords = new Set(["da", "das", "de", "do", "dos", "e"]);

  if (index > 0 && smallWords.has(lower)) {
    return lower;
  }

  return lower.replace(/(^|[-'`])(\p{L})/gu, (match, prefix, letter) => {
    return `${prefix}${letter.toLocaleUpperCase("pt-BR")}`;
  });
}

function dateValue(value?: string | null) {
  if (!value) return 0;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
