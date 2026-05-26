import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MetaWhatsAppSendError,
  type MetaWhatsAppTemplateHeaderMedia,
  getMetaWhatsAppOutboundConfig,
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
const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TRANSFER_QUEUE_SLUG = "atendimento";
const MAX_TRANSFER_HISTORY = 30;

type CustomerServiceWindowState = {
  expiresAt: string | null;
  lastCustomerMessageAt: string | null;
  open: boolean;
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
  const requestedPhoneNumberId = normalizeText(input?.phoneNumberId);
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
  const requestedTemplateSend = input?.sendTemplate !== false;
  const relatedInstallmentLabels = readRelatedInstallmentLabels({
    metadataInput,
    sourceContextInput,
  });

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
    const protocol =
      linkedAttendanceTicket?.protocol ?? (await nextTicketProtocol(client));
    const collectionProtocol =
      sourceModule === "hades"
        ? collectionProtocolFromAttendanceProtocol(protocol)
        : null;
    const templateProtocolReference =
      sourceModule === "hades"
        ? collectionProtocol ?? protocol
        : protocol;

    if (sourceModule === "hades" && linkedAttendanceProtocol && !linkedAttendanceTicket) {
      return NextResponse.json(
        { error: "Atendimento Iris informado para vincular a cobranca nao foi localizado." },
        { status: 404 },
      );
    }

    const contact = await findOrCreateContact({
      apoloEntityId,
      apoloProfileLabel,
      client,
      contactName,
      phone,
    });
    const customerServiceWindow = await getContactCustomerServiceWindow(
      client,
      contact.id,
      phone,
    );
    const shouldSendTemplate =
      requestedTemplateSend && !customerServiceWindow.open;

    if (!requestedTemplateSend && !customerServiceWindow.open) {
      return NextResponse.json(
        {
          error:
            "Janela de 24h fechada. Envie um template aprovado e aguarde a resposta do cliente antes de iniciar conversa livre.",
        },
        { status: 409 },
      );
    }

    const localTemplate = shouldSendTemplate
      ? await getApprovedLocalTemplate(client, {
          name: requestedTemplateName,
          phoneNumberId: requestedPhoneNumberId,
          templateId,
        })
      : null;

    if (shouldSendTemplate && sourceModule === "hades" && !localTemplate) {
      return NextResponse.json(
        { error: "Selecione um template Meta aprovado dentro da Iris." },
        { status: 400 },
      );
    }

    const approvedTemplate = shouldSendTemplate
      ? await resolveApprovedMetaTemplate({
          language: localTemplate?.language ?? requestedTemplateLanguage,
          name: localTemplate?.templateName ?? requestedTemplateName,
          phoneNumberId: localTemplate?.phoneNumberId ?? requestedPhoneNumberId,
        })
      : null;
    const templateName = shouldSendTemplate
      ? approvedTemplate?.name ?? requestedTemplateName
      : null;
    const templateLanguage = shouldSendTemplate
      ? approvedTemplate?.language ?? requestedTemplateLanguage
      : null;
    const templateBody = shouldSendTemplate
      ? localTemplate?.body ?? IRIS_OPT_IN_TEMPLATE.bodyText
      : null;
    const templateInstallmentSummary =
      formatTemplateInstallmentSummary(relatedInstallmentLabels);
    const templateBodyParameters = shouldSendTemplate
      ? buildTemplateBodyParameters({
          firstName,
          installmentsSummary: templateInstallmentSummary,
          protocolReference: templateProtocolReference,
          templateBody,
        })
      : [];
    const templatePreview =
      shouldSendTemplate && templateBody
        ? renderTemplatePreview(templateBody, templateBodyParameters)
        : null;
    const templateHeaderMedia = shouldSendTemplate && localTemplate
      ? buildTemplateHeaderMedia(localTemplate)
      : null;
    const templatePhoneNumberId = shouldSendTemplate
      ? localTemplate?.phoneNumberId ?? requestedPhoneNumberId ?? null
      : requestedPhoneNumberId ?? null;
    const templateSendConfig =
      shouldSendTemplate && templatePhoneNumberId
        ? {
            ...getMetaWhatsAppOutboundConfig(),
            phoneNumberId: templatePhoneNumberId,
          }
        : getMetaWhatsAppOutboundConfig();

    if (
      shouldSendTemplate &&
      localTemplate?.mediaHeaderFormat &&
      !templateHeaderMedia
    ) {
      return NextResponse.json(
        {
          error:
            "Template com midia precisa de URL publica ou media id antes de iniciar o atendimento.",
        },
        { status: 400 },
      );
    }

    const sent = shouldSendTemplate
      ? await sendMetaWhatsAppTemplateMessage({
          bodyParameters: templateBodyParameters,
          config: templateSendConfig,
          headerMedia: templateHeaderMedia,
          language: templateLanguage!,
          name: templateName!,
          to: phone,
        })
      : null;
    const now = new Date();
    const queueId = profile?.queue_id ?? queue?.id ?? null;
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
    const activeContactConsent = shouldSendTemplate
      ? "awaiting_customer_reply"
      : "customer_replied";
    const initialStatus = shouldSendTemplate
      ? "waiting_customer"
      : "waiting_operator";
    const metaTemplateStatus = shouldSendTemplate
      ? "sent"
      : customerServiceWindow.open
        ? "window_open_reused"
        : "not_sent";
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
            activeContactConsent,
            attendanceProtocol: protocol,
            collectionProtocol,
            customerServiceWindowExpiresAt: customerServiceWindow.expiresAt,
            customerServiceWindowOpenedAt:
              customerServiceWindow.lastCustomerMessageAt,
            initialTemplateName: shouldSendTemplate ? templateName : null,
            initialTemplateLanguage: shouldSendTemplate
              ? templateLanguage
              : null,
            initialTemplateId: shouldSendTemplate
              ? localTemplate?.id ?? null
              : null,
            lastCustomerMessageAt: customerServiceWindow.lastCustomerMessageAt,
            linkedAttendanceProtocol: protocol,
            metaPhoneDisplayNumber: shouldSendTemplate
              ? localTemplate?.phoneDisplayNumber ?? null
              : null,
            metaPhoneLabel: shouldSendTemplate
              ? localTemplate?.phoneLabel ?? null
              : null,
            metaPhoneNumberId: templatePhoneNumberId,
            metaTemplateStatus,
            sourceModule,
            templateInstallmentSummary,
            templateProtocolReference,
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
            relatedInstallmentLabels,
            relatedInstallments:
              normalizeStringList(sourceContextInput.relatedInstallments),
            templateInstallmentSummary,
            templateBody:
              templateBody ??
              normalizeText(currentSourceContext.templateBody) ??
              null,
            templateProtocolReference,
          },
          source_entity_id: sourceEntityId ?? linkedAttendanceTicket.source_entity_id ?? null,
          source_entity_type: sourceEntityType ?? linkedAttendanceTicket.source_entity_type ?? null,
          status: isClosedTicketStatus(linkedAttendanceTicket.status)
            ? linkedAttendanceTicket.status
            : initialStatus,
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
            activeContactConsent,
            attendanceProtocol: protocol,
            collectionProtocol,
            customerServiceWindowExpiresAt: customerServiceWindow.expiresAt,
            customerServiceWindowOpenedAt:
              customerServiceWindow.lastCustomerMessageAt,
            initialTemplateName: shouldSendTemplate ? templateName : null,
            initialTemplateLanguage: shouldSendTemplate
              ? templateLanguage
              : null,
            initialTemplateId: shouldSendTemplate
              ? localTemplate?.id ?? null
              : null,
            lastCustomerMessageAt: customerServiceWindow.lastCustomerMessageAt,
            metaPhoneDisplayNumber: shouldSendTemplate
              ? localTemplate?.phoneDisplayNumber ?? null
              : null,
            metaPhoneLabel: shouldSendTemplate
              ? localTemplate?.phoneLabel ?? null
              : null,
            metaPhoneNumberId: templatePhoneNumberId,
            metaTemplateStatus,
            sourceModule,
            templateInstallmentSummary,
            templateProtocolReference,
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
            relatedInstallmentLabels,
            relatedInstallments:
              normalizeStringList(sourceContextInput.relatedInstallments),
            templateInstallmentSummary,
            templateBody,
            templateProtocolReference,
          },
          source_entity_id: sourceEntityId,
          source_entity_type: sourceEntityType,
          source_module: sourceModule,
          status: initialStatus,
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

    if (shouldSendTemplate && templatePreview) {
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
              bodyParameters: templateBodyParameters,
              headerMediaFormat: localTemplate?.mediaHeaderFormat ?? null,
              headerMediaFileName: localTemplate?.mediaHeaderFileName ?? null,
              hasHeaderMedia: Boolean(templateHeaderMedia),
              language: templateLanguage,
              name: templateName,
              phoneDisplayNumber: localTemplate?.phoneDisplayNumber ?? null,
              phoneLabel: localTemplate?.phoneLabel ?? null,
              phoneNumberId: templatePhoneNumberId,
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
          phone_number_id:
            templatePhoneNumberId ?? process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? null,
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
        customerServiceWindow,
        ok: true,
        ticket,
        templateSent: shouldSendTemplate,
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

export async function PATCH(request: NextRequest) {
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
  const action = normalizeText(input?.action)?.toLowerCase();
  const ticketId = normalizeUuid(input?.ticketId);
  const closeReason =
    normalizeText(input?.closeReason) ??
    "Encerrado pelo operador no modulo Iris.";
  const transferReason =
    normalizeText(input?.transferReason) ??
    "Transferido para a fila de atendimento pelo operador na Iris.";
  const targetQueueId = normalizeUuid(input?.targetQueueId);
  const targetQueueSlug =
    normalizeQueueSlug(input?.targetQueueSlug) ??
    DEFAULT_TRANSFER_QUEUE_SLUG;

  if (!ticketId) {
    return NextResponse.json(
      { error: "Informe o ticket da operacao Iris." },
      { status: 400 },
    );
  }

  const { client } = authorization;

  try {
    if (action === "transfer") {
      const { data: existing, error: existingError } = await client
        .from("caredesk_tickets")
        .select("id,protocol,status,queue_id,profile_id,metadata,source_context")
        .eq("id", ticketId)
        .maybeSingle<{
          id: string;
          metadata?: unknown;
          profile_id?: string | null;
          protocol: string | null;
          queue_id?: string | null;
          source_context?: unknown;
          status: string | null;
        }>();

      if (existingError || !existing) {
        return NextResponse.json(
          { error: "Ticket nao encontrado para transferencia." },
          { status: 404 },
        );
      }

      if (isClosedTicketStatus(existing.status)) {
        return NextResponse.json(
          { error: "Ticket encerrado nao pode ser transferido." },
          { status: 409 },
        );
      }

      const fromQueueId = normalizeUuid(existing.queue_id);
      const [
        sourceQueue,
        explicitTargetById,
        explicitTargetBySlug,
        fallbackQueue,
        operator,
      ] = await Promise.all([
        fromQueueId ? getQueueById(client, fromQueueId) : Promise.resolve(null),
        targetQueueId ? getQueueById(client, targetQueueId) : Promise.resolve(null),
        targetQueueSlug
          ? getQueueBySlug(client, targetQueueSlug)
          : Promise.resolve(null),
        getDefaultQueue(client),
        getOperatorIdentity(client, authorization.user.id),
      ]);
      const targetQueue = explicitTargetById ?? explicitTargetBySlug ?? fallbackQueue;

      if (!targetQueue?.id) {
        return NextResponse.json(
          { error: "Fila de destino nao foi localizada na Iris." },
          { status: 503 },
        );
      }

      const nowIso = new Date().toISOString();
      const targetProfile = await getDefaultProfileByQueue(client, targetQueue.id);
      const currentMetadata = normalizeRecord(existing.metadata);
      const currentSourceContext = normalizeRecord(existing.source_context);
      const transferHistory = normalizeTransferHistory(
        currentMetadata.transferHistory,
      );
      const transferEntry = {
        byUserId: authorization.user.id,
        fromQueueId: sourceQueue?.id ?? fromQueueId ?? null,
        fromQueueLabel: sourceQueue?.name ?? sourceQueue?.slug ?? "sem_fila",
        occurredAt: nowIso,
        operatorLabel: operator.label,
        reason: transferReason,
        toQueueId: targetQueue.id,
        toQueueLabel: targetQueue.name ?? targetQueue.slug ?? "atendimento",
      };
      const nextMetadata = {
        ...currentMetadata,
        activeContactConsent: "customer_replied",
        handoffToOperatorAt: nowIso,
        handoffToOperatorByUserId: authorization.user.id,
        handoffToOperatorReason: transferReason,
        handlingOwner: "operator",
        lastTransfer: transferEntry,
        transferHistory: [transferEntry, ...transferHistory].slice(
          0,
          MAX_TRANSFER_HISTORY,
        ),
      };
      const nextSourceContext = {
        ...currentSourceContext,
        handoffQueueId: targetQueue.id,
        handoffQueueLabel: targetQueue.name ?? targetQueue.slug ?? null,
        handoffReason: transferReason,
      };

      const { data: updated, error: updateError } = await client
        .from("caredesk_tickets")
        .update({
          assigned_to_user_id: null,
          metadata: nextMetadata,
          profile_id: targetProfile?.id ?? normalizeUuid(existing.profile_id) ?? null,
          queue_id: targetQueue.id,
          source_context: nextSourceContext,
          status: "waiting_operator",
          updated_at: nowIso,
        })
        .eq("id", ticketId)
        .select("id,protocol,status,closed_at,resolved_at,queue_id,metadata")
        .single<{
          closed_at: string | null;
          id: string;
          metadata?: unknown;
          protocol: string | null;
          queue_id?: string | null;
          resolved_at: string | null;
          status: string | null;
        }>();

      if (updateError || !updated) {
        throw updateError ?? new Error("Transferencia do ticket nao foi salva.");
      }

      const transferMessage = [
        `Transferencia registrada: ${transferEntry.fromQueueLabel} -> ${transferEntry.toQueueLabel}.`,
        `Motivo: ${transferReason}.`,
      ].join(" ");
      const [timelineInsert, chatInsert] = await Promise.all([
        client.from("caredesk_ticket_events").insert({
          actor_type: "user",
          actor_user_id: authorization.user.id,
          description: transferReason,
          event_type: "ticket_transfer",
          metadata: {
            fromQueueId: transferEntry.fromQueueId,
            fromQueueLabel: transferEntry.fromQueueLabel,
            operatorLabel: operator.label,
            source: "iris_operator",
            toQueueId: transferEntry.toQueueId,
            toQueueLabel: transferEntry.toQueueLabel,
          },
          ticket_id: ticketId,
          title: `Transferido para ${transferEntry.toQueueLabel}`,
        }),
        client.from("caredesk_messages").insert({
          body: transferMessage,
          delivery_status: "sent",
          direction: "internal",
          message_type: "system",
          provider_payload: {
            operatorLabel: operator.label,
            source_module: "iris",
            transfer: {
              fromQueueId: transferEntry.fromQueueId,
              fromQueueLabel: transferEntry.fromQueueLabel,
              reason: transferReason,
              toQueueId: transferEntry.toQueueId,
              toQueueLabel: transferEntry.toQueueLabel,
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

      return NextResponse.json(
        {
          ok: true,
          ticket: {
            closedAt: updated.closed_at,
            id: updated.id,
            metadata: normalizeRecord(updated.metadata),
            protocol: updated.protocol,
            queueId: normalizeUuid(updated.queue_id) ?? targetQueue.id,
            resolvedAt: updated.resolved_at,
            status: normalizeText(updated.status) ?? "waiting_operator",
          },
          transfer: {
            fromQueueId: transferEntry.fromQueueId,
            fromQueueLabel: transferEntry.fromQueueLabel,
            toQueueId: transferEntry.toQueueId,
            toQueueLabel: transferEntry.toQueueLabel,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (action === "context_update") {
      const { data: existing, error: existingError } = await client
        .from("caredesk_tickets")
        .select("id,protocol,metadata")
        .eq("id", ticketId)
        .maybeSingle<{
          id: string;
          metadata?: unknown;
          protocol: string | null;
        }>();

      if (existingError || !existing) {
        return NextResponse.json(
          { error: "Ticket nao encontrado para atualizar contexto." },
          { status: 404 },
        );
      }

      const nowIso = new Date().toISOString();
      const existingMetadata = normalizeRecord(existing.metadata);
      const hasContextNote = Object.prototype.hasOwnProperty.call(
        input ?? {},
        "contextNote",
      );
      const hasContextAgendaEvents = Object.prototype.hasOwnProperty.call(
        input ?? {},
        "contextAgendaEvents",
      );
      const contextNote = normalizeText(input?.contextNote);
      const contextAgendaEvents = normalizeTicketContextAgendaEvents(
        input?.contextAgendaEvents,
      );
      const nextMetadata = {
        ...existingMetadata,
        contextUpdatedAt: nowIso,
      } as Record<string, unknown>;

      if (hasContextNote) {
        nextMetadata.operatorContextNote = contextNote
          ? {
              text: contextNote,
              updatedAt: nowIso,
              updatedByUserId: authorization.user.id,
            }
          : null;
      }

      if (hasContextAgendaEvents) {
        nextMetadata.contextAgendaEvents = contextAgendaEvents;
      }

      const { data: updated, error: updateError } = await client
        .from("caredesk_tickets")
        .update({
          metadata: nextMetadata,
          updated_at: nowIso,
        })
        .eq("id", ticketId)
        .select("id,protocol,status,closed_at,resolved_at,metadata")
        .single<{
          closed_at: string | null;
          id: string;
          metadata?: unknown;
          protocol: string | null;
          resolved_at: string | null;
          status: string | null;
        }>();

      if (updateError || !updated) {
        throw updateError ?? new Error("Contexto do ticket nao foi atualizado.");
      }

      return NextResponse.json(
        {
          ok: true,
          ticket: {
            closedAt: updated.closed_at,
            id: updated.id,
            metadata: normalizeRecord(updated.metadata),
            protocol: updated.protocol,
            resolvedAt: updated.resolved_at,
            status: normalizeText(updated.status) ?? "open",
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (action !== "close") {
      return NextResponse.json(
        { error: "Acao de ticket nao suportada pela Iris." },
        { status: 400 },
      );
    }

    const { data: existing, error: existingError } = await client
      .from("caredesk_tickets")
      .select("id,protocol,status,closed_at,resolved_at,metadata")
      .eq("id", ticketId)
      .maybeSingle<{
        closed_at: string | null;
        id: string;
        metadata?: unknown;
        protocol: string | null;
        resolved_at: string | null;
        status: string | null;
      }>();

    if (existingError || !existing) {
      return NextResponse.json(
        { error: "Ticket nao encontrado para encerramento." },
        { status: 404 },
      );
    }

    const nowIso = new Date().toISOString();
    const effectiveClosedAt = existing.closed_at ?? nowIso;
    const existingMetadata = normalizeRecord(existing.metadata);
    const nextMetadata = {
      ...existingMetadata,
      closedAt: effectiveClosedAt,
      closedByUserId: authorization.user.id,
      closedReason: closeReason,
      closedSource: "iris_operator",
      closedTicketProtocol: existing.protocol ?? null,
    };

    if (isClosedTicketStatus(existing.status)) {
      return NextResponse.json(
        {
          alreadyClosed: true,
          ok: true,
          ticket: {
            closedAt: effectiveClosedAt,
            id: existing.id,
            metadata: nextMetadata,
            protocol: existing.protocol,
            resolvedAt: existing.resolved_at,
            status: normalizeText(existing.status) ?? "closed",
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: updated, error: updateError } = await client
      .from("caredesk_tickets")
      .update({
        closed_at: effectiveClosedAt,
        metadata: nextMetadata,
        status: "closed",
        updated_at: nowIso,
      })
      .eq("id", ticketId)
      .select("id,protocol,status,closed_at,resolved_at,metadata")
      .single<{
        closed_at: string | null;
        id: string;
        metadata?: unknown;
        protocol: string | null;
        resolved_at: string | null;
        status: string | null;
      }>();

    if (updateError || !updated) {
      throw updateError ?? new Error("Ticket nao foi encerrado.");
    }

    return NextResponse.json(
      {
        alreadyClosed: false,
        ok: true,
        ticket: {
          closedAt: updated.closed_at,
          id: updated.id,
          metadata: normalizeRecord(updated.metadata),
          protocol: updated.protocol,
          resolvedAt: updated.resolved_at,
          status: normalizeText(updated.status) ?? "closed",
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel encerrar o ticket na Iris.",
      },
      { status: 500 },
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
    mediaHeaderFileName: normalizeText(metadata.mediaHeaderFileName),
    mediaHeaderFormat: normalizeTemplateHeaderFormat(metadata.mediaHeaderFormat),
    mediaHeaderMediaId: normalizeText(metadata.mediaHeaderMediaId),
    mediaHeaderSendLink: normalizeText(metadata.mediaHeaderSendLink),
    metaStatus,
    name: normalizeText(row.name) ?? templateName,
    phoneDisplayNumber: normalizeText(metadata.metaPhoneDisplayNumber),
    phoneLabel: normalizeText(metadata.metaPhoneLabel),
    phoneNumberId: normalizeText(metadata.metaPhoneNumberId),
    slug: normalizeText(row.slug),
    templateName,
  };
}

function buildTemplateHeaderMedia(template: {
  mediaHeaderFileName?: string | null;
  mediaHeaderFormat?: string | null;
  mediaHeaderMediaId?: string | null;
  mediaHeaderSendLink?: string | null;
}): MetaWhatsAppTemplateHeaderMedia | null {
  const type = mapTemplateHeaderMediaType(template.mediaHeaderFormat);
  const id = normalizeText(template.mediaHeaderMediaId);
  const link = normalizeText(template.mediaHeaderSendLink);

  if (!type || (!id && !link)) {
    return null;
  }

  return {
    fileName: normalizeText(template.mediaHeaderFileName),
    id,
    link,
    type,
  };
}

function mapTemplateHeaderMediaType(value?: string | null) {
  if (value === "DOCUMENT") {
    return "document";
  }

  if (value === "IMAGE") {
    return "image";
  }

  if (value === "VIDEO") {
    return "video";
  }

  return null;
}

function normalizeTemplateHeaderFormat(value: unknown) {
  return value === "DOCUMENT" || value === "IMAGE" || value === "VIDEO"
    ? value
    : null;
}

async function getApprovedLocalTemplate(
  client: SupabaseClient,
  {
    name,
    phoneNumberId,
    templateId,
  }: {
    name: string;
    phoneNumberId?: string | null;
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

  const approvedTemplates = mapApprovedTemplateRows(data).filter((template) => {
    return (
      !phoneNumberId ||
      !template.phoneNumberId ||
      template.phoneNumberId === phoneNumberId
    );
  });

  return (
    approvedTemplates.find(
      (template) => template.templateName === name || template.slug === name,
    ) ?? null
  );
}

async function resolveApprovedMetaTemplate({
  language,
  name,
  phoneNumberId,
}: {
  language: string;
  name: string;
  phoneNumberId?: string | null;
}) {
  const templates = await listMetaWhatsAppMessageTemplates({
    limit: 50,
    name,
    phoneNumberId,
  });
  const exactTemplates = templates.filter((template) => template.name === name);
  const approvedTemplates = exactTemplates.filter(
    (template) => isMetaTemplateApprovedStatus(template.status),
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

function isMetaTemplateApprovedStatus(status?: string | null) {
  const normalized = normalizeMetaTemplateStatusKey(status);

  return (
    normalized === "APPROVED" ||
    normalized === "ACTIVE" ||
    Boolean(normalized?.startsWith("APPROVED_")) ||
    Boolean(normalized?.startsWith("ACTIVE_"))
  );
}

function normalizeMetaTemplateStatusKey(status?: string | null) {
  return status?.trim().toUpperCase().replace(/[\s-]+/g, "_") ?? null;
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
    .select("id,name,slug,default_priority,sla_first_response_minutes,sla_resolution_minutes")
    .eq("id", queueId)
    .eq("status", "active")
    .maybeSingle();

  return data ?? null;
}

async function getQueueBySlug(client: SupabaseClient, queueSlug: string) {
  const { data } = await client
    .from("caredesk_queues")
    .select("id,name,slug,default_priority,sla_first_response_minutes,sla_resolution_minutes")
    .eq("slug", queueSlug)
    .eq("status", "active")
    .maybeSingle();

  return data ?? null;
}

async function getDefaultQueue(client: SupabaseClient) {
  const { data: atendimento } = await client
    .from("caredesk_queues")
    .select("id,name,slug,default_priority,sla_first_response_minutes,sla_resolution_minutes")
    .eq("slug", DEFAULT_TRANSFER_QUEUE_SLUG)
    .eq("status", "active")
    .maybeSingle();

  if (atendimento) {
    return atendimento;
  }

  const { data } = await client
    .from("caredesk_queues")
    .select("id,name,slug,default_priority,sla_first_response_minutes,sla_resolution_minutes")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

async function getDefaultProfileByQueue(client: SupabaseClient, queueId: string) {
  const { data } = await client
    .from("caredesk_ticket_profiles")
    .select("id")
    .eq("queue_id", queueId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();

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

async function getContactCustomerServiceWindow(
  client: SupabaseClient,
  contactId: string,
  phone?: string | null,
): Promise<CustomerServiceWindowState> {
  const contactIds = await resolveWindowContactIdsByIdentity({
    client,
    contactId,
    phone,
  });
  const scopedContactIds = contactIds.length ? contactIds : [contactId];
  const latestBySenderContact = await client
    .from("caredesk_messages")
    .select("created_at,sent_at")
    .eq("direction", "inbound")
    .in("sender_contact_id", scopedContactIds)
    .eq("sender_type", "customer")
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string | null; sent_at: string | null }>();

  if (latestBySenderContact.error) {
    throw latestBySenderContact.error;
  }

  if (latestBySenderContact.data) {
    return describeCustomerServiceWindow(
      latestBySenderContact.data.sent_at ??
        latestBySenderContact.data.created_at ??
        null,
    );
  }

  const { data: ticketRows, error: ticketError } = await client
    .from("caredesk_tickets")
    .select("id")
    .in("contact_id", scopedContactIds)
    .order("opened_at", { ascending: false })
    .limit(120);

  if (ticketError) {
    throw ticketError;
  }

  const ticketIds = (ticketRows ?? [])
    .map((row) => normalizeText((row as Record<string, unknown>).id))
    .filter((id): id is string => Boolean(id));

  if (!ticketIds.length) {
    return describeCustomerServiceWindow(null);
  }

  const latestByTicket = await client
    .from("caredesk_messages")
    .select("created_at,sent_at")
    .in("ticket_id", ticketIds)
    .eq("direction", "inbound")
    .eq("sender_type", "customer")
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string | null; sent_at: string | null }>();

  if (latestByTicket.error) {
    throw latestByTicket.error;
  }

  return describeCustomerServiceWindow(
    latestByTicket.data?.sent_at ?? latestByTicket.data?.created_at ?? null,
  );
}

async function resolveWindowContactIdsByIdentity({
  client,
  contactId,
  phone,
}: {
  client: SupabaseClient;
  contactId: string;
  phone?: string | null;
}) {
  const ids = new Set<string>([contactId]);
  const normalizedPhone = normalizeWhatsAppDestination(phone);

  if (!normalizedPhone) {
    return Array.from(ids);
  }

  for (const candidate of buildBrazilWhatsAppDestinationCandidates(normalizedPhone)) {
    const [whatsappRows, phoneRows] = await Promise.all([
      client
        .from("caredesk_contacts")
        .select("id")
        .eq("whatsapp_phone", candidate)
        .limit(32),
      client
        .from("caredesk_contacts")
        .select("id")
        .eq("phone", candidate)
        .limit(32),
    ]);

    if (whatsappRows.error) {
      throw whatsappRows.error;
    }

    if (phoneRows.error) {
      throw phoneRows.error;
    }

    for (const row of [
      ...(whatsappRows.data ?? []),
      ...(phoneRows.data ?? []),
    ] as Array<{ id?: string | null }>) {
      const normalizedId = normalizeUuid(row.id);

      if (normalizedId) {
        ids.add(normalizedId);
      }
    }
  }

  return Array.from(ids);
}

function describeCustomerServiceWindow(
  lastCustomerMessageAt: string | null,
): CustomerServiceWindowState {
  if (!lastCustomerMessageAt) {
    return {
      expiresAt: null,
      lastCustomerMessageAt: null,
      open: false,
    };
  }

  const openedAt = new Date(lastCustomerMessageAt).getTime();

  if (Number.isNaN(openedAt)) {
    return {
      expiresAt: null,
      lastCustomerMessageAt: null,
      open: false,
    };
  }

  const expiresAt = new Date(openedAt + CUSTOMER_SERVICE_WINDOW_MS).toISOString();

  return {
    expiresAt,
    lastCustomerMessageAt,
    open: Date.now() < openedAt + CUSTOMER_SERVICE_WINDOW_MS,
  };
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000).toISOString();
}

function readRelatedInstallmentLabels({
  metadataInput,
  sourceContextInput,
}: {
  metadataInput: Record<string, unknown>;
  sourceContextInput: Record<string, unknown>;
}) {
  const labels = uniqueStringList([
    ...normalizeStringList(metadataInput.relatedInstallmentLabels),
    ...normalizeStringList(sourceContextInput.relatedInstallmentLabels),
  ]);

  if (labels.length) {
    return labels;
  }

  return uniqueStringList([
    ...normalizeStringList(metadataInput.relatedInstallments),
    ...normalizeStringList(sourceContextInput.relatedInstallments),
  ]).map((value) => parseInstallmentLabel(value));
}

function formatTemplateInstallmentSummary(labels: string[]) {
  if (!labels.length) {
    return "Sem parcela informada";
  }

  const preview = labels.slice(0, 3).join(" | ");
  const suffix =
    labels.length > 3 ? ` +${labels.length - 3} parcela(s)` : "";

  return trimTemplateVariable(`${preview}${suffix}`);
}

function buildTemplateBodyParameters({
  firstName,
  installmentsSummary,
  protocolReference,
  templateBody,
}: {
  firstName: string;
  installmentsSummary: string;
  protocolReference: string;
  templateBody: string | null;
}) {
  const expectedCount = countTemplateBodyVariables(templateBody);
  const baseParameters = [
    firstName,
    installmentsSummary,
    protocolReference,
  ];
  const parameters = baseParameters.slice(0, expectedCount);

  while (parameters.length < expectedCount) {
    parameters.push("-");
  }

  return parameters.map((value) => trimTemplateVariable(value));
}

function countTemplateBodyVariables(templateBody: string | null) {
  if (!templateBody) {
    return 1;
  }

  const placeholderIndexes = new Set<number>();
  const regex = /{{\s*(\d+)\s*}}/g;
  let match = regex.exec(templateBody);

  while (match) {
    const index = Number.parseInt(match[1] ?? "", 10);

    if (!Number.isNaN(index) && index > 0) {
      placeholderIndexes.add(index);
    }

    match = regex.exec(templateBody);
  }

  return placeholderIndexes.size || 1;
}

function renderTemplatePreview(bodyText: string, bodyParameters: string[]) {
  if (!bodyParameters.length) {
    return bodyText;
  }

  return bodyText.replace(/{{\s*(\d+)\s*}}/g, (placeholder, rawIndex) => {
    const index = Number.parseInt(rawIndex, 10);

    if (Number.isNaN(index) || index <= 0) {
      return placeholder;
    }

    return bodyParameters[index - 1] ?? placeholder;
  });
}

function parseInstallmentLabel(value: string) {
  const parts = value
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const parcel = parts[2] ?? "";
  const dueDate = parts[3] ?? "";
  const amount = parts[4] ?? "";
  const parsed = [parcel, dueDate, amount].filter(Boolean).join(" · ");

  return parsed || value;
}

function uniqueStringList(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function trimTemplateVariable(value: string) {
  const normalized = value.trim();

  if (normalized.length <= 320) {
    return normalized;
  }

  return `${normalized.slice(0, 317)}...`;
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

function buildBrazilWhatsAppDestinationCandidates(to: string) {
  const candidates = [to];
  const withoutBrazilianNinthDigit = /^55(\d{2})(\d{8})$/.exec(to);
  const withBrazilianNinthDigit = /^55(\d{2})9(\d{8})$/.exec(to);

  if (withoutBrazilianNinthDigit) {
    candidates.push(
      `55${withoutBrazilianNinthDigit[1]}9${withoutBrazilianNinthDigit[2]}`,
    );
  }

  if (withBrazilianNinthDigit) {
    candidates.push(`55${withBrazilianNinthDigit[1]}${withBrazilianNinthDigit[2]}`);
  }

  return Array.from(new Set(candidates));
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

function normalizeQueueSlug(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return /^[a-z0-9-]{2,80}$/.test(normalized) ? normalized : null;
}

function normalizeRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeText(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeTicketContextAgendaEvents(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((event, index) => {
      const record = normalizeRecord(event);
      const title = normalizeText(record.title);
      const scheduledAt = normalizeTicketContextDate(record.scheduledAt);

      if (!title || !scheduledAt) {
        return null;
      }

      const createdAt =
        normalizeTicketContextDate(record.createdAt) ?? new Date().toISOString();

      return {
        createdAt,
        createdByLabel: normalizeText(record.createdByLabel) ?? "Operador Iris",
        id: normalizeText(record.id) ?? `ctx-agenda-${index}-${scheduledAt}`,
        kind: normalizeText(record.kind) ?? "atividade",
        notes: normalizeText(record.notes),
        scheduledAt,
        status: normalizeText(record.status) ?? "planned",
        title: title.slice(0, 180),
      };
    })
    .filter(
      (
        event,
      ): event is {
        createdAt: string;
        createdByLabel: string;
        id: string;
        kind: string;
        notes: string | null;
        scheduledAt: string;
        status: string;
        title: string;
      } => Boolean(event),
    )
    .slice(0, 200);
}

function normalizeTicketContextDate(value: unknown) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  const parsed = new Date(text);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeSourceModule(value: unknown) {
  const normalized = normalizeText(value)?.toLowerCase();

  if (normalized === "hades" || normalized === "iris" || normalized === "apolo") {
    return normalized;
  }

  return "iris";
}

function normalizeTransferHistory(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeRecord(entry))
    .map((entry) => ({
      byUserId: normalizeUuid(entry.byUserId),
      fromQueueId: normalizeUuid(entry.fromQueueId),
      fromQueueLabel: normalizeText(entry.fromQueueLabel),
      occurredAt: normalizeTicketContextDate(entry.occurredAt),
      operatorLabel: normalizeText(entry.operatorLabel),
      reason: normalizeText(entry.reason),
      toQueueId: normalizeUuid(entry.toQueueId),
      toQueueLabel: normalizeText(entry.toQueueLabel),
    }))
    .filter((entry) => Boolean(entry.occurredAt));
}
