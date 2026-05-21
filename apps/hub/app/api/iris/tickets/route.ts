import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MetaWhatsAppSendError,
  listMetaWhatsAppMessageTemplates,
  sendMetaWhatsAppTemplateMessage,
} from "@/lib/iris/meta-whatsapp";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IRIS_OPT_IN_TEMPLATE = {
  bodyText: "Olá {{1}}, estou testando a Iris, podemos conversar?",
  language: "pt_BR",
  name: "iris_opt_in_teste_v1",
};

export async function GET(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
    "operator",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  const { client } = authorization;
  const protocol = normalizeOperationalProtocol(
    new URL(request.url).searchParams.get("protocol"),
  );

  if (protocol) {
    return resolveTicketByProtocol(client, protocol);
  }

  try {
    const [channelsResult, queuesResult, profilesResult, templatesResult, operator] =
      await Promise.all([
        client
          .from("caredesk_channels")
          .select("id,name,slug,kind,provider,status")
          .eq("kind", "whatsapp")
          .eq("provider", "meta")
          .eq("status", "active")
          .order("name", { ascending: true }),
        client
          .from("caredesk_queues")
          .select(
            "id,name,slug,status,default_priority,sla_first_response_minutes,sla_resolution_minutes",
          )
          .eq("status", "active")
          .order("name", { ascending: true }),
        client
          .from("caredesk_ticket_profiles")
          .select(
            "id,queue_id,name,slug,category,priority,sla_first_response_minutes,sla_resolution_minutes,description,required_fields,status",
          )
          .eq("status", "active")
          .order("category", { ascending: true })
          .order("name", { ascending: true }),
        client
          .from("caredesk_templates")
          .select("id,name,slug,category,channel_kind,body,variables,status,metadata")
          .eq("channel_kind", "whatsapp")
          .eq("status", "active")
          .order("name", { ascending: true }),
        getOperatorIdentity(client, authorization.user.id),
      ]);

    const failedResult = [channelsResult, queuesResult, profilesResult, templatesResult].find(
      (result) => result.error,
    );

    if (failedResult?.error) {
      throw failedResult.error;
    }

    return NextResponse.json(
      {
        channels: channelsResult.data ?? [],
        operator,
        profiles: profilesResult.data ?? [],
        queues: queuesResult.data ?? [],
        templates: mapApprovedTemplateRows(templatesResult.data ?? []),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar a estrutura real da Iris.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
    "operator",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  const input = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const contactName = normalizeText(input?.contactName);
  const phone = normalizeWhatsAppDestination(input?.phone);
  const requestedTemplateName =
    normalizeTemplateName(input?.templateName) ?? IRIS_OPT_IN_TEMPLATE.name;
  const requestedTemplateLanguage =
    normalizeLanguage(input?.templateLanguage) ?? IRIS_OPT_IN_TEMPLATE.language;
  const firstName = normalizeFirstName(input?.firstName ?? contactName);
  const apoloEntityId = normalizeText(input?.apoloEntityId);
  const apoloProfileLabel = normalizeText(input?.apoloProfileLabel);
  const channelId = normalizeUuid(input?.channelId);
  const profileId = normalizeUuid(input?.profileId);
  const requestedQueueId = normalizeUuid(input?.queueId);
  const templateId = normalizeUuid(input?.templateId);
  const sourceContextInput = normalizeRecord(input?.sourceContext);
  const sourceEntityId =
    normalizeText(input?.sourceEntityId) ?? apoloEntityId ?? null;
  const sourceEntityType =
    normalizeText(input?.sourceEntityType) ?? "apolo-crm360";
  const sourceModule = normalizeSourceModule(input?.sourceModule);
  const subject = normalizeText(input?.subject);
  const metadataInput = normalizeRecord(input?.metadata);
  const linkedAttendanceProtocol =
    normalizeAttendanceProtocol(input?.linkedAttendanceProtocol) ??
    normalizeAttendanceProtocol(input?.attendanceProtocol) ??
    normalizeAttendanceProtocol(sourceContextInput.linkedAttendanceProtocol) ??
    normalizeAttendanceProtocol(sourceContextInput.attendanceProtocol) ??
    normalizeAttendanceProtocol(metadataInput.linkedAttendanceProtocol) ??
    normalizeAttendanceProtocol(metadataInput.attendanceProtocol);
  const sendTemplate = input?.sendTemplate !== false;

  if (!contactName) {
    return NextResponse.json(
      { error: "Selecione um cliente do CRM 360 para iniciar o atendimento." },
      { status: 400 },
    );
  }

  if (!phone) {
    return NextResponse.json(
      { error: "O cliente selecionado nao possui telefone WhatsApp valido." },
      { status: 400 },
    );
  }

  const { client } = authorization;

  try {
    const [channel, requestedQueue, profile, defaultQueue, operator] =
      await Promise.all([
        getWhatsAppChannel(client, channelId),
        requestedQueueId
          ? getQueueById(client, requestedQueueId)
          : Promise.resolve(null),
        profileId
          ? getProfileById(client, profileId)
          : getDefaultProfile(client),
        getDefaultQueue(client),
        getOperatorIdentity(client, authorization.user.id),
      ]);

    if (!channel?.id) {
      return NextResponse.json(
        { error: "Canal WhatsApp da Iris nao localizado." },
        { status: 503 },
      );
    }

    if (channelId && channel.id !== channelId) {
      return NextResponse.json(
        { error: "Canal WhatsApp informado nao esta disponivel na Iris." },
        { status: 400 },
      );
    }

    if (profileId && !profile?.id) {
      return NextResponse.json(
        { error: "Perfil de ticket informado nao esta ativo na Iris." },
        { status: 400 },
      );
    }

    const profileQueue = profile?.queue_id
      ? await getQueueById(client, profile.queue_id)
      : null;
    const queue = profileQueue ?? requestedQueue ?? defaultQueue;
    const linkedAttendanceTicket =
      sourceModule === "hades" && linkedAttendanceProtocol
        ? await findTicketByAttendanceProtocol(client, linkedAttendanceProtocol)
        : null;

    if (sourceModule === "hades" && linkedAttendanceProtocol && !linkedAttendanceTicket) {
      return NextResponse.json(
        { error: "Atendimento Iris informado para vincular a cobranca nao foi localizado." },
        { status: 404 },
      );
    }

    const localTemplate = sendTemplate
      ? await getApprovedLocalTemplate(client, {
          name: requestedTemplateName,
          templateId,
        })
      : null;

    if (sendTemplate && sourceModule === "hades" && !localTemplate) {
      return NextResponse.json(
        { error: "Selecione um template Meta aprovado dentro da Iris." },
        { status: 400 },
      );
    }

    const approvedTemplate = sendTemplate
      ? await resolveApprovedMetaTemplate({
          language: localTemplate?.language ?? requestedTemplateLanguage,
          name: localTemplate?.templateName ?? requestedTemplateName,
        })
      : null;
    const templateName = approvedTemplate?.name ?? requestedTemplateName;
    const templateLanguage =
      approvedTemplate?.language ?? requestedTemplateLanguage;
    const templateBody = localTemplate?.body ?? IRIS_OPT_IN_TEMPLATE.bodyText;
    const templatePreview = renderTemplatePreview(templateBody, firstName);
    const sent = sendTemplate
      ? await sendMetaWhatsAppTemplateMessage({
          bodyParameters: [firstName],
          language: templateLanguage,
          name: templateName,
          to: phone,
        })
      : null;
    const now = new Date();
    const queueId = profile?.queue_id ?? queue?.id ?? null;
    const protocol = linkedAttendanceTicket?.protocol ?? await nextTicketProtocol(client);
    const collectionProtocol =
      sourceModule === "hades"
        ? collectionProtocolFromAttendanceProtocol(protocol)
        : null;
    const contact = await findOrCreateContact({
      apoloEntityId,
      apoloProfileLabel,
      client,
      contactName,
      phone,
    });
    const firstResponseMinutes =
      Number(profile?.sla_first_response_minutes) ||
      Number(queue?.sla_first_response_minutes) ||
      60;
    const resolutionMinutes =
      Number(profile?.sla_resolution_minutes) ||
      Number(queue?.sla_resolution_minutes) ||
      480;
    const ticketProjection = "id,protocol,profile_id,queue_id,priority,status,opened_at,subject";
    const ticketSubject =
      subject ??
      (sourceModule === "hades"
        ? `Cobranca Hades - ${profile?.name ?? "Atendimento WhatsApp"}`
        : "Contato ativo - aceite Iris");
    let ticket: { id: string; protocol: string; [key: string]: unknown } | null = null;

    if (linkedAttendanceTicket) {
      const currentMetadata = normalizeRecord(linkedAttendanceTicket.metadata);
      const currentSourceContext = normalizeRecord(linkedAttendanceTicket.source_context);
      const ticketResult = await client
        .from("caredesk_tickets")
        .update({
          assigned_to_user_id: authorization.user.id,
          metadata: {
            ...currentMetadata,
            ...metadataInput,
            activeContactConsent: "awaiting_customer_reply",
            attendanceProtocol: protocol,
            collectionProtocol,
            initialTemplateName: templateName,
            initialTemplateLanguage: templateLanguage,
            initialTemplateId: localTemplate?.id ?? null,
            linkedAttendanceProtocol: protocol,
            metaTemplateStatus: sendTemplate ? "sent" : "not_sent",
            sourceModule,
          },
          priority: profile?.priority ?? linkedAttendanceTicket.priority ?? queue?.default_priority ?? "medium",
          profile_id: profile?.id ?? linkedAttendanceTicket.profile_id ?? null,
          queue_id: queueId ?? linkedAttendanceTicket.queue_id ?? null,
          source_context: {
            ...currentSourceContext,
            ...sourceContextInput,
            apoloEntityId,
            apoloProfileLabel,
            attendanceProtocol: protocol,
            collectionProtocol,
            collectionSourceModule: sourceModule,
            contactOrigin: currentSourceContext.contactOrigin ?? "active",
            linkedAttendanceProtocol: protocol,
            templateBody,
          },
          source_entity_id: sourceEntityId ?? linkedAttendanceTicket.source_entity_id ?? null,
          source_entity_type: sourceEntityType ?? linkedAttendanceTicket.source_entity_type ?? null,
          status: isClosedTicketStatus(linkedAttendanceTicket.status)
            ? linkedAttendanceTicket.status
            : "waiting_customer",
          subject: ticketSubject ?? linkedAttendanceTicket.subject ?? null,
          updated_at: now.toISOString(),
        })
        .eq("id", linkedAttendanceTicket.id)
        .select(ticketProjection)
        .single();

      if (ticketResult.error || !ticketResult.data) {
        throw ticketResult.error ?? new Error("Atendimento Iris nao foi atualizado.");
      }

      ticket = ticketResult.data;
    } else {
      const ticketResult = await client
        .from("caredesk_tickets")
        .insert({
          assigned_to_user_id: authorization.user.id,
          channel_id: channel.id,
          contact_id: contact.id,
          created_by_user_id: authorization.user.id,
          first_response_due_at: addMinutes(now, firstResponseMinutes),
          metadata: {
            ...metadataInput,
            activeContactConsent: "awaiting_customer_reply",
            attendanceProtocol: protocol,
            collectionProtocol,
            initialTemplateName: templateName,
            initialTemplateLanguage: templateLanguage,
            initialTemplateId: localTemplate?.id ?? null,
            metaTemplateStatus: sendTemplate ? "sent" : "not_sent",
            sourceModule,
          },
          opened_at: now.toISOString(),
          priority: profile?.priority ?? queue?.default_priority ?? "medium",
          profile_id: profile?.id ?? null,
          protocol,
          queue_id: queueId,
          resolution_due_at: addMinutes(now, resolutionMinutes),
          source_context: {
            ...sourceContextInput,
            apoloEntityId,
            apoloProfileLabel,
            attendanceProtocol: protocol,
            collectionProtocol,
            contactOrigin: "active",
            templateBody,
          },
          source_entity_id: sourceEntityId,
          source_entity_type: sourceEntityType,
          source_module: sourceModule,
          status: "waiting_customer",
          subject: ticketSubject,
        })
        .select(ticketProjection)
        .single();

      if (ticketResult.error || !ticketResult.data) {
        throw ticketResult.error ?? new Error("Ticket nao foi criado.");
      }

      ticket = ticketResult.data;
    }
    let messageId: string | null = null;

    if (sendTemplate) {
      const messageResult = await client
        .from("caredesk_messages")
        .insert({
          body: templatePreview,
          channel_id: channel.id,
          delivery_status: sent?.messageId ? "sent" : "queued",
          direction: "outbound",
          external_message_id: sent?.messageId ?? null,
          message_type: "template",
          provider_payload: {
            meta: sent?.raw ?? null,
            operatorAvatarUrl: operator.avatarUrl,
            operatorLabel: operator.label,
            template: {
              bodyParameters: [firstName],
              language: templateLanguage,
              name: templateName,
            },
          },
          sender_type: "operator",
          sender_user_id: authorization.user.id,
          sent_at: sent?.messageId ? now.toISOString() : null,
          ticket_id: ticket.id,
        })
        .select("id")
        .single();

      if (messageResult.error || !messageResult.data) {
        throw messageResult.error ?? new Error("Mensagem inicial nao foi criada.");
      }

      messageId = messageResult.data.id;

      if (sent?.messageId) {
        const refResult = await client.from("caredesk_whatsapp_message_refs").insert({
          channel_id: channel.id,
          delivery_status: "sent",
          direction: "outbound",
          message_id: messageId,
          payload: sent.raw,
          phone_number_id: process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? null,
          provider: "meta",
          wa_contact_id: sent.contactWaId,
          wa_message_id: sent.messageId,
        });

        if (refResult.error) {
          throw refResult.error;
        }
      }
    }

    return NextResponse.json(
      {
        messageId,
        collectionProtocol,
        ok: true,
        ticket,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof MetaWhatsAppSendError ? error.status : 500;
    const message =
      error instanceof MetaWhatsAppSendError &&
      isMetaTemplateTranslationError(error)
        ? "A Meta nao encontrou este template na WABA do telefone de envio. Consulte ou crie novamente o template na aba Templates e aguarde a aprovacao."
        : error instanceof Error
          ? error.message
          : "Nao foi possivel iniciar o atendimento Iris.";

    return NextResponse.json(
      {
        error: message,
      },
      { status },
    );
  }
}

async function resolveTicketByProtocol(client: SupabaseClient, protocol: string) {
  try {
    const ticket =
      protocol.startsWith("CB-")
        ? await findTicketByCollectionProtocol(client, protocol)
        : await findTicketByAttendanceProtocol(client, protocol);

    if (!ticket) {
      return NextResponse.json(
        { error: "Protocolo nao localizado na Iris." },
        { status: 404 },
      );
    }

    const sourceContext = normalizeRecord(ticket.source_context);
    const metadata = normalizeRecord(ticket.metadata);

    return NextResponse.json(
      {
        collectionProtocol:
          normalizeOperationalProtocol(sourceContext.collectionProtocol) ??
          normalizeOperationalProtocol(metadata.collectionProtocol) ??
          null,
        ok: true,
        ticket,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel localizar o protocolo na Iris.",
      },
      { status: 500 },
    );
  }
}

async function findTicketByAttendanceProtocol(client: SupabaseClient, protocol: string) {
  const { data, error } = await client
    .from("caredesk_tickets")
    .select("id,protocol,profile_id,queue_id,priority,status,opened_at,subject,source_module,source_entity_type,source_entity_id,source_context,metadata")
    .eq("protocol", protocol)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function findTicketByCollectionProtocol(client: SupabaseClient, protocol: string) {
  const sourceContextResult = await client
    .from("caredesk_tickets")
    .select("id,protocol,profile_id,queue_id,priority,status,opened_at,subject,source_module,source_entity_type,source_entity_id,source_context,metadata")
    .contains("source_context", { collectionProtocol: protocol })
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sourceContextResult.error) {
    throw sourceContextResult.error;
  }

  if (sourceContextResult.data) {
    return sourceContextResult.data;
  }

  const metadataResult = await client
    .from("caredesk_tickets")
    .select("id,protocol,profile_id,queue_id,priority,status,opened_at,subject,source_module,source_entity_type,source_entity_id,source_context,metadata")
    .contains("metadata", { collectionProtocol: protocol })
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (metadataResult.error) {
    throw metadataResult.error;
  }

  return metadataResult.data ?? null;
}

function mapApprovedTemplateRows(rows: Record<string, unknown>[]) {
  return rows
    .map(mapLocalTemplateRow)
    .filter((template): template is NonNullable<ReturnType<typeof mapLocalTemplateRow>> =>
      Boolean(template && template.metaStatus === "APPROVED"),
    );
}

function mapLocalTemplateRow(row: Record<string, unknown>) {
  const metadata = normalizeRecord(row.metadata);
  const templateName =
    normalizeTemplateName(metadata.metaTemplateName) ??
    normalizeTemplateName(row.slug) ??
    normalizeTemplateName(row.name);
  const language =
    normalizeLanguage(metadata.metaLanguage) ?? IRIS_OPT_IN_TEMPLATE.language;
  const metaStatus = normalizeTemplateStatus(metadata.metaStatus);

  if (!templateName || metaStatus !== "APPROVED") {
    return null;
  }

  return {
    body: normalizeText(row.body),
    category: normalizeText(row.category),
    id: String(row.id ?? ""),
    language,
    metaStatus,
    name: normalizeText(row.name) ?? templateName,
    slug: normalizeText(row.slug),
    templateName,
  };
}

async function getApprovedLocalTemplate(
  client: SupabaseClient,
  {
    name,
    templateId,
  }: {
    name: string;
    templateId?: string | null;
  },
) {
  if (templateId) {
    const { data, error } = await client
      .from("caredesk_templates")
      .select("id,name,slug,category,channel_kind,body,variables,status,metadata")
      .eq("id", templateId)
      .eq("channel_kind", "whatsapp")
      .eq("status", "active")
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return mapLocalTemplateRow(data);
  }

  const { data, error } = await client
    .from("caredesk_templates")
    .select("id,name,slug,category,channel_kind,body,variables,status,metadata")
    .eq("channel_kind", "whatsapp")
    .eq("status", "active")
    .limit(50);

  if (error || !data) {
    return null;
  }

  return mapApprovedTemplateRows(data).find(
    (template) => template.templateName === name || template.slug === name,
  ) ?? null;
}

async function resolveApprovedMetaTemplate({
  language,
  name,
}: {
  language: string;
  name: string;
}) {
  const templates = await listMetaWhatsAppMessageTemplates({
    limit: 50,
    name,
  });
  const exactTemplates = templates.filter((template) => template.name === name);
  const approvedTemplates = exactTemplates.filter(
    (template) => template.status === "APPROVED",
  );
  const preferred = approvedTemplates.find(
    (template) => template.language === language,
  );

  if (!preferred?.name || !preferred.language) {
    throw new MetaWhatsAppSendError(
      `Template Meta ${name} ainda nao possui traducao aprovada para o telefone de envio.`,
      409,
      {
        code: "IRIS_TEMPLATE_NOT_APPROVED",
      },
    );
  }

  return {
    language: preferred.language,
    name: preferred.name,
  };
}

function isMetaTemplateTranslationError(error: MetaWhatsAppSendError) {
  return (
    String(error.code) === "132001" ||
    error.message.toLowerCase().includes("translation")
  );
}

async function getWhatsAppChannel(
  client: SupabaseClient,
  channelId?: string | null,
) {
  let query = client
    .from("caredesk_channels")
    .select("id,name,slug,status")
    .eq("kind", "whatsapp")
    .eq("provider", "meta")
    .eq("status", "active");

  if (channelId) {
    query = query.eq("id", channelId);
  } else {
    query = query.eq("slug", "whatsapp-careli");
  }

  const { data } = await query.maybeSingle();

  return data ?? null;
}

async function getQueueById(client: SupabaseClient, queueId: string) {
  const { data } = await client
    .from("caredesk_queues")
    .select("id,slug,default_priority,sla_first_response_minutes,sla_resolution_minutes")
    .eq("id", queueId)
    .eq("status", "active")
    .maybeSingle();

  return data ?? null;
}

async function getDefaultQueue(client: SupabaseClient) {
  const { data: atendimento } = await client
    .from("caredesk_queues")
    .select("id,slug,default_priority,sla_first_response_minutes,sla_resolution_minutes")
    .eq("slug", "atendimento")
    .eq("status", "active")
    .maybeSingle();

  if (atendimento) {
    return atendimento;
  }

  const { data } = await client
    .from("caredesk_queues")
    .select("id,slug,default_priority,sla_first_response_minutes,sla_resolution_minutes")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

async function getProfileById(client: SupabaseClient, profileId: string) {
  const { data } = await client
    .from("caredesk_ticket_profiles")
    .select("id,queue_id,name,priority,sla_first_response_minutes,sla_resolution_minutes")
    .eq("id", profileId)
    .eq("status", "active")
    .maybeSingle();

  return data ?? null;
}

async function getDefaultProfile(client: SupabaseClient) {
  const { data: primeiroContato } = await client
    .from("caredesk_ticket_profiles")
    .select("id,queue_id,name,priority,sla_first_response_minutes,sla_resolution_minutes")
    .eq("slug", "primeiro-contato")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (primeiroContato) {
    return primeiroContato;
  }

  const { data } = await client
    .from("caredesk_ticket_profiles")
    .select("id,queue_id,name,priority,sla_first_response_minutes,sla_resolution_minutes")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

async function getOperatorIdentity(client: SupabaseClient, userId: string) {
  const { data } = await client
    .from("hub_users")
    .select("display_name,email,avatar_url")
    .eq("id", userId)
    .maybeSingle();

  return {
    avatarUrl: normalizeText(data?.avatar_url),
    label: normalizeText(data?.display_name) ?? "Operador Iris",
  };
}

async function nextTicketProtocol(client: SupabaseClient) {
  const { data, error } = await client.rpc("next_caredesk_ticket_protocol");

  if (!error && typeof data === "string" && data.startsWith("AT-")) {
    return data;
  }

  return `AT-${Date.now()}`;
}

async function findOrCreateContact({
  apoloEntityId,
  apoloProfileLabel,
  client,
  contactName,
  phone,
}: {
  apoloEntityId: string | null;
  apoloProfileLabel: string | null;
  client: SupabaseClient;
  contactName: string;
  phone: string;
}) {
  const existingWhatsapp = await client
    .from("caredesk_contacts")
    .select("id")
    .eq("whatsapp_phone", phone)
    .maybeSingle();

  if (existingWhatsapp.data?.id) {
    return existingWhatsapp.data;
  }

  const existingPhone = await client
    .from("caredesk_contacts")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (existingPhone.data?.id) {
    await client
      .from("caredesk_contacts")
      .update({ whatsapp_phone: phone })
      .eq("id", existingPhone.data.id);

    return existingPhone.data;
  }

  const inserted = await client
    .from("caredesk_contacts")
    .insert({
      display_name: contactName,
      metadata: {
        apoloEntityId,
        apoloProfileLabel,
        source: "iris_active_contact",
      },
      person_type: apoloProfileLabel,
      phone,
      whatsapp_phone: phone,
    })
    .select("id")
    .single();

  if (inserted.error || !inserted.data) {
    throw inserted.error ?? new Error("Contato do ticket nao foi criado.");
  }

  return inserted.data;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000).toISOString();
}

function renderTemplatePreview(bodyText: string, firstName: string) {
  return bodyText.replace("{{1}}", firstName);
}

function collectionProtocolFromAttendanceProtocol(protocol: string) {
  const match = /^AT-(\d+)$/i.exec(protocol.trim());

  if (match?.[1]) {
    return `CB-${match[1]}`;
  }

  return `CB-${Date.now()}`;
}

function normalizeWhatsAppDestination(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const digits = value.replace(/\D/g, "");

  if (digits.length >= 12 && digits.length <= 15) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return null;
}

function normalizeTemplateName(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return /^[a-z0-9_]{3,512}$/.test(normalized) ? normalized : null;
}

function normalizeLanguage(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return /^[a-z]{2}_[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function normalizeTemplateStatus(value: unknown) {
  const normalized = normalizeText(value)?.toUpperCase();

  if (
    normalized === "APPROVED" ||
    normalized === "PENDING" ||
    normalized === "REJECTED" ||
    normalized === "PAUSED"
  ) {
    return normalized;
  }

  return "PENDING";
}

function normalizeOperationalProtocol(value: unknown) {
  const normalized = normalizeText(value)?.toUpperCase();

  return normalized && /^(AT|CB)-\d{1,12}$/.test(normalized)
    ? normalized
    : null;
}

function normalizeAttendanceProtocol(value: unknown) {
  const protocol = normalizeOperationalProtocol(value);

  return protocol?.startsWith("AT-") ? protocol : null;
}

function isClosedTicketStatus(value: unknown) {
  const normalized = normalizeText(value)?.toLowerCase();

  return Boolean(
    normalized &&
      ["cancelled", "canceled", "closed", "resolved"].includes(normalized),
  );
}

function normalizeUuid(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized,
  )
    ? normalized
    : null;
}

function normalizeFirstName(value: unknown) {
  const normalized = normalizeText(value);
  const firstName = normalized?.split(/\s+/)[0];

  return firstName || "cliente";
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeSourceModule(value: unknown) {
  const normalized = normalizeText(value)?.toLowerCase();

  if (normalized === "hades" || normalized === "iris" || normalized === "apolo") {
    return normalized;
  }

  return "iris";
}
