import { Buffer } from "node:buffer";

import { NextResponse, type NextRequest } from "next/server";

import {
  MetaWhatsAppSendError,
  type MetaWhatsAppSendMessageResult,
  getMetaWhatsAppConfigStatus,
  getMetaWhatsAppOutboundConfig,
  sendMetaWhatsAppAudioMessage,
  sendMetaWhatsAppMediaMessage,
  sendMetaWhatsAppReactionMessage,
  sendMetaWhatsAppTemplateMessage,
  sendMetaWhatsAppTextMessage,
  signWhatsAppBody,
} from "@/lib/iris/meta-whatsapp";
import { IRIS_MEDIA_BUCKET, uploadIrisMediaBuffer } from "@/lib/iris/meta-media-storage";
import {
  authorizeIrisMetaRequest,
  createIrisMetaAdminClient,
} from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IRIS_AUDIO_MAX_BASE64_LENGTH = 4_000_000;
const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

type SendMessageBody = {
  action?: unknown;
  body?: unknown;
  channelId?: unknown;
  contactId?: unknown;
  emoji?: unknown;
  media?: unknown;
  messageId?: unknown;
  replyToMessageId?: unknown;
  // Template aprovado da Meta: o ÚNICO jeito de falar com quem está fora da janela de 24h.
  // Ver normalizeTemplateInput logo abaixo.
  template?: unknown;
  ticketId?: unknown;
  to?: unknown;
};

type TemplateInput = {
  bodyParameters: string[];
  language: string;
  name: string;
};

// REABRIR CONVERSA FORA DA JANELA DE 24H.
//
// O problema (auditoria de 26/07): 80 dos 98 atendimentos abertos estavam com a janela da Meta
// fechada. Nesses, o campo de texto vem desabilitado e NÃO havia nenhum caminho de template
// dentro da conversa — o operador lia o pedido do cliente e não tinha o que clicar. O único
// atalho era "+ Novo atendimento", que recusa com 409 porque já existe ticket ativo e manda
// "abra o atendimento existente", justamente a tela onde ele não pode escrever. Eram 61 clientes
// com a bola conosco e sem saída.
//
// Aqui o template passa a poder ser enviado NO PROTOCOLO ATUAL, sem criar ticket novo.
// PREENCHE OS PARÂMETROS DO TEMPLATE QUANDO O CHAMADOR NÃO MANDOU NENHUM.
//
// A Meta recusa o envio quando a quantidade de parâmetros não bate com o que o template
// aprovado declara, e recusa também parâmetro em branco. O botão "Reabrir conversa" mandava
// `bodyParameters: []` fixo (erro meu, 26/07): com o modelo "Devolutiva de ticket", que tem
// quatro variáveis, todo reabrir falhava com "Não foi possível reabrir a conversa".
//
// Resolve por CHAVE, do mesmo jeito que /api/iris/tickets: o template diz quais variáveis usa
// e em que ordem, e cada uma é preenchida com o valor certo. Fica no SERVIDOR de propósito —
// é aqui que existem ticket, contato e operador, e assim qualquer chamador fica protegido,
// não só a tela que eu consertei.
async function preencherParametrosDoTemplate({
  client,
  metaTemplateName,
  operatorName,
  ticketId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  metaTemplateName: string;
  operatorName: string | null;
  ticketId: string | null;
}): Promise<string[]> {
  // O nome aprovado na Meta mora no metadata (`metaTemplateName`), não em coluna própria —
  // conferido no banco antes de escrever, porque typecheck não pega nome de coluna errado.
  // `limit(1)` e não `maybeSingle`: há modelos repetidos apontando pro mesmo nome da Meta.
  const { data: modelos } = await client
    .from("caredesk_templates")
    .select("variables")
    .eq("metadata->>metaTemplateName", metaTemplateName)
    .limit(1);

  const modelo = (modelos ?? [])[0] as { variables: unknown } | undefined;

  const variaveis = Array.isArray(modelo?.variables)
    ? (modelo.variables as unknown[]).filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  if (variaveis.length === 0) {
    return [];
  }

  const { data: ticket } = ticketId
    ? await client
        .from("caredesk_tickets")
        .select(
          "protocol, subject, caredesk_contacts(display_name), caredesk_ticket_profiles(name), caredesk_queues(name)",
        )
        .eq("id", ticketId)
        .maybeSingle<{
          caredesk_contacts: { display_name: string | null } | null;
          caredesk_queues: { name: string | null } | null;
          caredesk_ticket_profiles: { name: string | null } | null;
          protocol: string | null;
          subject: string | null;
        }>()
    : { data: null };

  const nomeCompleto = ticket?.caredesk_contacts?.display_name?.trim() ?? "";
  const primeiroNome = nomeCompleto.split(/\s+/)[0] ?? "";
  // O assunto costuma vir do perfil do ticket; quando a ficha está sem assunto (acontece, e
  // era o caso do AT-001285), a fila responde pelo contexto. NUNCA devolver string vazia:
  // a Meta rejeita o envio inteiro por causa de um parâmetro em branco.
  const assunto =
    ticket?.caredesk_ticket_profiles?.name?.trim() ||
    ticket?.subject?.trim() ||
    ticket?.caredesk_queues?.name?.trim() ||
    "seu atendimento";

  const valorPorChave: Record<string, string> = {
    assunto,
    nome_cliente: nomeCompleto || primeiroNome || "cliente",
    operador: operatorName?.trim() || "equipe Careli",
    primeiro_nome: primeiroNome || "cliente",
    protocolo: ticket?.protocol?.trim() || "-",
  };

  return variaveis.map((chave) => valorPorChave[chave] ?? "-");
}

function normalizeTemplateInput(value: unknown): TemplateInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const registro = value as Record<string, unknown>;
  const name = typeof registro.name === "string" ? registro.name.trim() : "";
  const language =
    typeof registro.language === "string" ? registro.language.trim() : "";

  if (!name || !language) {
    return null;
  }

  const bodyParameters = Array.isArray(registro.bodyParameters)
    ? registro.bodyParameters
        .map((parametro) =>
          typeof parametro === "string" ? parametro.trim() : "",
        )
        // A Meta recusa parâmetro vazio; melhor mandar um traço do que estourar o envio.
        .map((parametro) => parametro || "-")
    : [];

  return { bodyParameters, language, name };
}

type OperatorIdentity = {
  avatarUrl: string | null;
  label: string;
};

type CustomerServiceWindowState = {
  expiresAt: string | null;
  lastCustomerMessageAt: string | null;
  open: boolean;
  reason: "contact_required" | "expired" | "no_customer_reply" | "open";
};

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const configStatus = getMetaWhatsAppConfigStatus();

  if (!configStatus.outboundReady) {
    return NextResponse.json(
      {
        error: "Envio Meta WhatsApp ainda nao esta configurado na Iris.",
        missing: configStatus.missingOutboundKeys,
      },
      { status: 503 },
    );
  }

  const input = (await request.json().catch(() => null)) as
    | SendMessageBody
    | null;
  const to = normalizeWhatsAppDestination(input?.to);
  const hasMediaInput = Boolean(input?.media);
  const audioMedia = normalizeAudioMedia(input?.media);
  const attachmentMedia = audioMedia
    ? null
    : normalizeAttachmentMedia(input?.media);
  const body = audioMedia
    ? normalizeMessageBody(input?.body) ?? "Audio WhatsApp"
    : normalizeMessageBody(input?.body);
  const ticketId = normalizeUuid(input?.ticketId);
  const channelId = normalizeUuid(input?.channelId);
  const contactId = normalizeUuid(input?.contactId);
  const messageId = normalizeUuid(input?.messageId);
  const template = normalizeTemplateInput(input?.template);
  const replyToMessageId = normalizeUuid(input?.replyToMessageId);

  if (!to) {
    return NextResponse.json(
      { error: "Informe o telefone WhatsApp em formato internacional." },
      { status: 400 },
    );
  }

  if (hasMediaInput && !audioMedia && !attachmentMedia) {
    return NextResponse.json(
      {
        error:
          "Anexo invalido ou acima do limite. Aceito: imagem (JPG/PNG, ate ~3MB) ou documento (PDF/Office/texto).",
      },
      { status: 400 },
    );
  }

  if (!body && !audioMedia && !attachmentMedia && !template) {
    return NextResponse.json(
      { error: "Informe a mensagem para enviar pelo WhatsApp." },
      { status: 400 },
    );
  }
  // No template, o `body` é o texto JÁ RENDERIZADO que a tela mostra no histórico (o que a Meta
  // envia é o modelo aprovado, com os parâmetros). Se vier sem texto, guarda ao menos o nome do
  // modelo para o histórico não ficar com uma mensagem em branco.
  const outboundBody =
    body ??
    (audioMedia ? "Audio WhatsApp" : template ? `[${template.name}]` : "");
  // Mídia normalizada (áudio OU anexo) num único formato pra persistir/enviar.
  const outboundMedia: NormalizedOutboundMedia | null = audioMedia
    ? { ...audioMedia, type: "audio" }
    : attachmentMedia
      ? {
          base64: attachmentMedia.base64,
          durationMs: null,
          fileName: attachmentMedia.fileName,
          mimeType: attachmentMedia.mimeType,
          type: attachmentMedia.kind,
          // ⚠️ SEM ISTO O ANEXO GRANDE SOME DO HISTÓRICO. No caminho do upload direto o
          // `attachmentMedia` tem só `url` (o `base64` é undefined de propósito): não copiar a
          // URL fazia `uploadOutboundMedia` cair no `if (!media.base64) return null`, então o
          // cliente recebia o arquivo pela Meta e a conversa ficava sem ele.
          url: attachmentMedia.url,
        }
      : null;
  const outboundMessageType = outboundMedia?.type ?? "text";

  let localMessage:
    | {
        body: string | null;
        created_at: string;
        delivery_status: string;
        direction: string;
        id: string;
        message_type?: string | null;
        provider_payload?: unknown;
        sender_user_id?: string | null;
        sender_type: string;
      }
    | null = null;
  const operatorIdentity = await getOperatorIdentity({
    client: authorization.client,
    userId: authorization.user.id,
  });
  const replyContext = replyToMessageId
    ? await getReplyContext({
        client: authorization.client,
        replyToMessageId,
        ticketId,
      })
    : null;

  if (replyContext?.error) {
    return NextResponse.json({ error: replyContext.error }, { status: 400 });
  }
  const replyPreview = replyContext?.preview ?? null;
  let customerServiceWindow: CustomerServiceWindowState;

  try {
    customerServiceWindow = await getCustomerServiceWindow({
      client: authorization.client,
      contactId,
      ticketId,
      to,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Nao foi possivel validar a janela de 24h do WhatsApp: ${error.message}`
            : "Nao foi possivel validar a janela de 24h do WhatsApp.",
      },
      { status: 500 },
    );
  }

  // A trava da janela vale para TEXTO LIVRE. O template aprovado é justamente o que a Meta
  // permite fora dela: barrar aqui deixaria o operador sem nenhum caminho para responder os 80
  // atendimentos (de 98) que estão com a janela fechada — que é o problema que estamos
  // consertando. Com template, segue para o envio.
  if (!template && !customerServiceWindow.open) {
    return NextResponse.json(
      customerServiceWindowErrorPayload(customerServiceWindow),
      { status: 409 },
    );
  }
  let metaPhoneNumberId: string | null = null;

  try {
    metaPhoneNumberId = await resolveTicketMetaPhoneNumberId({
      client: authorization.client,
      ticketId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? `Nao foi possivel validar o telefone de envio do ticket: ${error.message}`
            : "Nao foi possivel validar o telefone de envio do ticket.",
      },
      { status: 500 },
    );
  }

  const metaSendConfig = metaPhoneNumberId
    ? {
        ...getMetaWhatsAppOutboundConfig(),
        phoneNumberId: metaPhoneNumberId,
      }
    : undefined;

  if (messageId) {
    const prepared = await prepareExistingTicketMessage({
      client: authorization.client,
      messageId,
      operatorIdentity,
      ticketId,
      to,
      userId: authorization.user.id,
    });

    if (!prepared.ok) {
      return NextResponse.json({ error: prepared.error }, { status: 500 });
    }

    if (prepared.alreadySent) {
      return NextResponse.json(
        {
          alreadySent: true,
          message: prepared.message,
          ok: true,
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    localMessage = prepared.message;
  } else if (ticketId) {
    const created = await createQueuedTicketMessage({
      body: outboundBody,
      channelId,
      client: authorization.client,
      contactId,
      media: outboundMedia,
      messageType: outboundMessageType,
      operatorIdentity,
      replyContext: replyPreview,
      ticketId,
      to,
      userId: authorization.user.id,
    });

    if (!created.ok) {
      return NextResponse.json({ error: created.error }, { status: 500 });
    }

    localMessage = created.message;
  }

  // Assina o texto enviado ao cliente com o nome de quem atende — mas só quando o
  // remetente muda (não repete a assinatura em mensagens seguidas do mesmo operador).
  const signOutbound = await shouldSignOutboundMessage({
    client: authorization.client,
    ticketId,
    userId: authorization.user.id,
  });

  // Só entra quando o chamador não mandou parâmetro nenhum. Quem já monta os seus (a abertura
  // de atendimento, por exemplo) continua mandando e nada muda.
  const templateBodyParameters =
    template && template.bodyParameters.length === 0
      ? await preencherParametrosDoTemplate({
          client: authorization.client,
          metaTemplateName: template.name,
          operatorName: operatorIdentity?.label ?? null,
          ticketId,
        })
      : (template?.bodyParameters ?? []);

  try {
    const sendAttempt = await sendMetaWhatsAppMessageWithFallback({
      send: (candidate) =>
        // Template primeiro: é o caminho de quem está fora da janela de 24h, e a Meta recusa
        // texto livre nesse caso. Nunca assina o corpo (o conteúdo é o aprovado por ela).
        template
          ? sendMetaWhatsAppTemplateMessage({
              bodyParameters: templateBodyParameters,
              ...(metaSendConfig ? { config: metaSendConfig } : {}),
              language: template.language,
              name: template.name,
              to: candidate,
            })
          : audioMedia
          ? sendMetaWhatsAppAudioMessage({
              audioBase64: audioMedia.base64,
              ...(metaSendConfig ? { config: metaSendConfig } : {}),
              contextMessageId: replyPreview?.externalMessageId ?? null,
              fileName: audioMedia.fileName,
              mimeType: audioMedia.mimeType,
              to: candidate,
            })
          : attachmentMedia
          ? sendMetaWhatsAppMediaMessage({
              caption: body,
              ...(metaSendConfig ? { config: metaSendConfig } : {}),
              contextMessageId: replyPreview?.externalMessageId ?? null,
              fileName: attachmentMedia.fileName,
              kind: attachmentMedia.kind,
              mediaBase64: attachmentMedia.base64,
              mediaUrl: attachmentMedia.url,
              mimeType: attachmentMedia.mimeType,
              to: candidate,
            })
          : sendMetaWhatsAppTextMessage({
              body: signOutbound
                ? signWhatsAppBody(operatorIdentity.label, outboundBody)
                : outboundBody,
              ...(metaSendConfig ? { config: metaSendConfig } : {}),
              contextMessageId: replyPreview?.externalMessageId ?? null,
              to: candidate,
            }),
      to,
    });
    const result = sendAttempt.result;

    if (!result.messageId) {
      throw new Error("Meta WhatsApp nao retornou ID da mensagem.");
    }

    const persistence = await persistOutboundReference({
      client: authorization.client,
      localMessageId: localMessage?.id ?? null,
      messageId: result.messageId,
      payload: result.raw,
      phoneNumberId:
        metaPhoneNumberId ?? process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? null,
      to: sendAttempt.sentTo,
      waContactId: result.contactWaId,
    });
    const updatedMessage = localMessage
      ? await markLocalMessageSent({
          client: authorization.client,
          destination: sendAttempt.sentTo,
          existingPayload: localMessage.provider_payload,
          fallbackUsed: sendAttempt.usedFallback,
          messageId: localMessage.id,
          operatorIdentity,
          payload: result.raw,
          sendAttemptCount: sendAttempt.attemptedDestinations.length,
          waMessageId: result.messageId,
        })
      : null;

    return NextResponse.json(
      {
        contactWaId: result.contactWaId,
        destination: sendAttempt.sentTo,
        messageId: result.messageId,
        message: updatedMessage ?? localMessage,
        ok: true,
        persistence,
        customerServiceWindow,
        usedFallback: sendAttempt.usedFallback,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const status =
      error instanceof MetaWhatsAppSendError ? error.status : 502;
    const failedMessage = localMessage
      ? await markLocalMessageFailed({
          client: authorization.client,
          error,
          existingPayload: localMessage.provider_payload,
          messageId: localMessage.id,
          operatorIdentity,
        })
      : null;

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar a mensagem pela Meta.",
        message: failedMessage ?? localMessage,
      },
      { status },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const input = (await request.json().catch(() => null)) as
    | SendMessageBody
    | null;
  const action = typeof input?.action === "string" ? input.action : "";
  const messageId = normalizeUuid(input?.messageId);

  if (!messageId) {
    return NextResponse.json(
      { error: "Informe a mensagem do Iris para atualizar." },
      { status: 400 },
    );
  }

  const operatorIdentity = await getOperatorIdentity({
    client: authorization.client,
    userId: authorization.user.id,
  });

  if (action === "edit") {
    const body = normalizeMessageBody(input?.body);

    if (!body) {
      return NextResponse.json(
        { error: "Informe o novo texto da mensagem." },
        { status: 400 },
      );
    }

    const result = await editIrisMessage({
      body,
      client: authorization.client,
      messageId,
      operatorIdentity,
      userId: authorization.user.id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      { message: result.message, ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (action === "react") {
    const emoji = normalizeEmoji(input?.emoji);

    if (!emoji) {
      return NextResponse.json(
        { error: "Informe uma reacao valida." },
        { status: 400 },
      );
    }

    const result = await reactToIrisMessage({
      client: authorization.client,
      emoji,
      messageId,
      operatorIdentity,
      to: normalizeWhatsAppDestination(input?.to),
      userId: authorization.user.id,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      { message: result.message, ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { error: "Acao de mensagem nao suportada pela Iris." },
    { status: 400 },
  );
}

async function sendMetaWhatsAppMessageWithFallback({
  send,
  to,
}: {
  send: (candidate: string) => Promise<MetaWhatsAppSendMessageResult>;
  to: string;
}) {
  const attemptedDestinations: string[] = [];
  const candidates = buildBrazilWhatsAppDestinationCandidates(to);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    attemptedDestinations.push(candidate);

    try {
      const result = await send(candidate);

      return {
        attemptedDestinations,
        result,
        sentTo: candidate,
        usedFallback: candidate !== to,
      };
    } catch (error) {
      lastError = error;

      if (!isMetaRecipientAllowedListError(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function getCustomerServiceWindow({
  client,
  contactId,
  ticketId,
  to,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  contactId: string | null;
  ticketId: string | null;
  to: string | null;
}): Promise<CustomerServiceWindowState> {
  const resolvedContactIds = await resolveCustomerServiceWindowContactIds({
    client,
    contactId,
    ticketId,
    to,
  });

  if (resolvedContactIds.length > 0) {
    const lastCustomerMessageAt = await findLatestCustomerInboundAtByContactIds({
      client,
      contactIds: resolvedContactIds,
    });

    return describeCustomerServiceWindow(lastCustomerMessageAt);
  }

  if (!ticketId) {
    return {
      expiresAt: null,
      lastCustomerMessageAt: null,
      open: false,
      reason: "contact_required",
    };
  }

  const fallbackLastCustomerMessageAt = await findLatestCustomerInboundAtByTicket({
    client,
    ticketId,
  });

  return describeCustomerServiceWindow(fallbackLastCustomerMessageAt);
}

async function resolveCustomerServiceWindowContactIds({
  client,
  contactId,
  ticketId,
  to,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  contactId: string | null;
  ticketId: string | null;
  to: string | null;
}) {
  const contactIds = new Set<string>();

  if (contactId) {
    contactIds.add(contactId);
  }

  if (ticketId) {
    const ticketContactId = await findContactIdByTicketId({ client, ticketId });

    if (ticketContactId) {
      contactIds.add(ticketContactId);
    }
  }

  if (to) {
    const contactIdsByDestination = await findContactIdsByDestination({
      client,
      to,
    });

    for (const destinationContactId of contactIdsByDestination) {
      contactIds.add(destinationContactId);
    }
  }

  return Array.from(contactIds);
}

async function findContactIdByTicketId({
  client,
  ticketId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  ticketId: string;
}) {
  const { data, error } = await client
    .from("caredesk_tickets")
    .select("contact_id")
    .eq("id", ticketId)
    .maybeSingle<{ contact_id: string | null }>();

  if (error) {
    throw error;
  }

  return normalizeUuid(data?.contact_id);
}

async function findContactIdsByDestination({
  client,
  to,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  to: string;
}) {
  const candidates = buildBrazilWhatsAppDestinationCandidates(to);
  const contactIds = new Set<string>();

  if (!candidates.length) {
    return [];
  }

  const [whatsappResult, phoneResult] = await Promise.all([
    client
      .from("caredesk_contacts")
      .select("id")
      .in("whatsapp_phone", candidates)
      .limit(60),
    client
      .from("caredesk_contacts")
      .select("id")
      .in("phone", candidates)
      .limit(60),
  ]);

  if (whatsappResult.error) {
    throw whatsappResult.error;
  }

  if (phoneResult.error) {
    throw phoneResult.error;
  }

  for (const row of [
    ...(whatsappResult.data ?? []),
    ...(phoneResult.data ?? []),
  ] as Array<{ id?: string | null }>) {
    const normalizedContactId = normalizeUuid(row.id);

    if (normalizedContactId) {
      contactIds.add(normalizedContactId);
    }
  }

  return Array.from(contactIds);
}

async function findLatestCustomerInboundAtByContactIds({
  client,
  contactIds,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  contactIds: string[];
}) {
  if (!contactIds.length) {
    return null;
  }

  const latestBySenderContact = await client
    .from("caredesk_messages")
    .select("created_at,sent_at")
    .eq("direction", "inbound")
    .in("sender_contact_id", contactIds)
    .eq("sender_type", "customer")
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string | null; sent_at: string | null }>();

  if (latestBySenderContact.error) {
    throw latestBySenderContact.error;
  }

  if (latestBySenderContact.data) {
    return (
      latestBySenderContact.data.sent_at ??
      latestBySenderContact.data.created_at ??
      null
    );
  }

  const { data: ticketRows, error: ticketError } = await client
    .from("caredesk_tickets")
    .select("id")
    .in("contact_id", contactIds)
    .order("opened_at", { ascending: false })
    .limit(120);

  if (ticketError) {
    throw ticketError;
  }

  const ticketIds = (ticketRows ?? [])
    .map((row) => normalizeUuid((row as Record<string, unknown>).id))
    .filter((id): id is string => Boolean(id));

  if (!ticketIds.length) {
    return null;
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

  return latestByTicket.data?.sent_at ?? latestByTicket.data?.created_at ?? null;
}

async function findLatestCustomerInboundAtByTicket({
  client,
  ticketId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  ticketId: string;
}) {
  const { data, error } = await client
    .from("caredesk_messages")
    .select("created_at,sent_at")
    .eq("ticket_id", ticketId)
    .eq("direction", "inbound")
    .eq("sender_type", "customer")
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string | null; sent_at: string | null }>();

  if (error) {
    throw error;
  }

  return data?.sent_at ?? data?.created_at ?? null;
}

async function resolveTicketMetaPhoneNumberId({
  client,
  ticketId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  ticketId: string | null;
}) {
  if (!ticketId) {
    return null;
  }

  // PREFERÊNCIA MÁXIMA: responder pelo MESMO número (phone_number_id) em que o cliente FALOU —
  // o do último INBOUND deste ticket. O Meta conta a janela de 24h por par (nosso número ↔
  // cliente); mandar por outro número devolve 131047 "Re-engagement" mesmo com a janela aberta.
  // É robusto a migração de WABA / troca de phone_number_id e a source_context sem o número.
  // Best-effort: qualquer falha cai pros fallbacks de metadata/source_context abaixo.
  try {
    const { data: inboundMessages } = await client
      .from("caredesk_messages")
      .select("id")
      .eq("ticket_id", ticketId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(10);

    const inboundIds = (inboundMessages ?? [])
      .map((row) => (row as { id?: string }).id)
      .filter((id): id is string => Boolean(id));

    if (inboundIds.length > 0) {
      const { data: refs } = await client
        .from("caredesk_whatsapp_message_refs")
        .select("phone_number_id, created_at")
        .in("message_id", inboundIds)
        .not("phone_number_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);

      const inboundPhoneNumberId = (
        refs?.[0] as { phone_number_id?: string } | undefined
      )?.phone_number_id;

      if (
        typeof inboundPhoneNumberId === "string" &&
        inboundPhoneNumberId.trim()
      ) {
        return inboundPhoneNumberId.trim();
      }
    }
  } catch {
    // segue pros fallbacks
  }

  const { data, error } = await client
    .from("caredesk_tickets")
    .select("metadata,source_context")
    .eq("id", ticketId)
    .maybeSingle<{ metadata?: unknown; source_context?: unknown }>();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return (
    readPayloadString(data.metadata, "metaPhoneNumberId") ??
    readPayloadString(data.metadata, "phoneNumberId") ??
    readPayloadString(data.source_context, "phoneNumberId") ??
    readPayloadString(data.source_context, "metaPhoneNumberId") ??
    null
  );
}

function describeCustomerServiceWindow(
  lastCustomerMessageAt: string | null,
): CustomerServiceWindowState {
  if (!lastCustomerMessageAt) {
    return {
      expiresAt: null,
      lastCustomerMessageAt: null,
      open: false,
      reason: "no_customer_reply",
    };
  }

  const openedAt = new Date(lastCustomerMessageAt).getTime();

  if (Number.isNaN(openedAt)) {
    return {
      expiresAt: null,
      lastCustomerMessageAt: null,
      open: false,
      reason: "no_customer_reply",
    };
  }

  const expiresAt = new Date(openedAt + CUSTOMER_SERVICE_WINDOW_MS).toISOString();
  const open = Date.now() < openedAt + CUSTOMER_SERVICE_WINDOW_MS;

  return {
    expiresAt,
    lastCustomerMessageAt,
    open,
    reason: open ? "open" : "expired",
  };
}

function customerServiceWindowErrorPayload(window: CustomerServiceWindowState) {
  const baseMessage =
    window.reason === "contact_required"
      ? "Envio livre bloqueado: a Iris precisa identificar o contato para validar a janela de 24h do WhatsApp."
      : "Janela de 24h do WhatsApp fechada. Envie um template aprovado e aguarde a resposta do cliente antes de usar mensagem livre.";

  return {
    customerServiceWindow: window,
    error: baseMessage,
  };
}

type ReplyContextPreview = {
  body: string;
  createdAt: string | null;
  direction: string | null;
  externalMessageId: string | null;
  messageId: string;
  senderLabel: string | null;
};

type NormalizedAudioMedia = {
  base64: string;
  durationMs: number | null;
  fileName: string;
  mimeType: string;
};

type NormalizedAttachmentMedia = {
  // Uma das duas: `base64` (arquivo pequeno, veio no corpo) ou `url` (arquivo grande, o
  // navegador já subiu direto para o Storage e mandou só a referência).
  base64?: string;
  fileName: string;
  kind: "document" | "image";
  mimeType: string;
  url?: string;
};

type NormalizedOutboundMedia = {
  base64?: string;
  durationMs: number | null;
  fileName: string;
  mimeType: string;
  type: "audio" | "document" | "image";
  // Preenchida quando o arquivo já está no Storage (upload direto). Nesse caso não há o que
  // subir: a URL que a Meta vai baixar é esta.
  url?: string;
};

async function getReplyContext({
  client,
  replyToMessageId,
  ticketId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  replyToMessageId: string;
  ticketId: string | null;
}): Promise<{ error?: string; preview?: ReplyContextPreview }> {
  let query = client
    .from("caredesk_messages")
    .select(
      "id,ticket_id,body,direction,sender_type,provider_payload,created_at,external_message_id",
    )
    .eq("id", replyToMessageId);

  if (ticketId) {
    query = query.eq("ticket_id", ticketId);
  }

  const { data, error } = await query.maybeSingle<{
    body: string | null;
    created_at: string | null;
    direction: string | null;
    external_message_id: string | null;
    id: string;
    provider_payload?: unknown;
    sender_type: string | null;
    ticket_id: string | null;
  }>();

  if (error || !data) {
    return { error: "Mensagem selecionada para resposta nao foi encontrada." };
  }

  return {
    preview: {
      body:
        data.body ??
        (data.sender_type === "customer" ? "Mensagem do cliente" : "Mensagem"),
      createdAt: data.created_at,
      direction: data.direction,
      externalMessageId: data.external_message_id,
      messageId: data.id,
      senderLabel: readPayloadString(data.provider_payload, "operatorLabel") ??
        (data.sender_type === "customer" ? "Cliente" : "Operador Iris"),
    },
  };
}

async function editIrisMessage({
  body,
  client,
  messageId,
  operatorIdentity,
  userId,
}: {
  body: string;
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  messageId: string;
  operatorIdentity: OperatorIdentity;
  userId: string;
}) {
  const { data: existing, error } = await client
    .from("caredesk_messages")
    .select(`${MESSAGE_SELECT},ticket_id`)
    .eq("id", messageId)
    .maybeSingle<{
      body: string | null;
      direction: string | null;
      external_message_id: string | null;
      id: string;
      provider_payload?: unknown;
      sender_type: string | null;
      sender_user_id?: string | null;
    }>();

  if (error || !existing) {
    return {
      error: "Mensagem nao encontrada para edicao.",
      ok: false as const,
      status: 404,
    };
  }

  if (existing.direction !== "outbound" || existing.sender_type !== "operator") {
    return {
      error: "Somente mensagens do operador podem ser editadas no Iris.",
      ok: false as const,
      status: 403,
    };
  }

  if (existing.sender_user_id && existing.sender_user_id !== userId) {
    return {
      error: "Somente o operador autor da mensagem pode editar este registro.",
      ok: false as const,
      status: 403,
    };
  }

  const now = new Date().toISOString();
  const { data, error: updateError } = await client
    .from("caredesk_messages")
    .update({
      body,
      provider_payload: {
        ...normalizeRecordPayload(existing.provider_payload),
        editScope: existing.external_message_id ? "iris-local" : "local-before-send",
        editedAt: now,
        operatorAvatarUrl: operatorIdentity.avatarUrl,
        operatorLabel: operatorIdentity.label,
        originalBody:
          readPayloadString(existing.provider_payload, "originalBody") ??
          existing.body,
      },
    })
    .eq("id", messageId)
    .select(MESSAGE_SELECT)
    .single();

  if (updateError) {
    return {
      error: "Nao foi possivel salvar a edicao no Iris.",
      ok: false as const,
      status: 500,
    };
  }

  return {
    message: data,
    ok: true as const,
    status: 200,
  };
}

async function reactToIrisMessage({
  client,
  emoji,
  messageId,
  operatorIdentity,
  to,
  userId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  emoji: string;
  messageId: string;
  operatorIdentity: OperatorIdentity;
  to: string | null;
  userId: string;
}) {
  const { data: existing, error } = await client
    .from("caredesk_messages")
    .select(`${MESSAGE_SELECT},sender_contact_id,ticket_id`)
    .eq("id", messageId)
    .maybeSingle<{
      direction: string | null;
      external_message_id: string | null;
      id: string;
      provider_payload?: unknown;
      sender_contact_id?: string | null;
      sender_type: string | null;
      ticket_id: string | null;
    }>();

  if (error || !existing) {
    return {
      error: "Mensagem nao encontrada para reacao.",
      ok: false as const,
      status: 404,
    };
  }

  const payload = normalizeRecordPayload(existing.provider_payload);
  const currentReactions = Array.isArray(payload.reactions)
    ? payload.reactions.filter(
        (reaction) =>
          reaction &&
          typeof reaction === "object" &&
          !Array.isArray(reaction),
      )
    : [];
  const withoutCurrentUser = currentReactions.filter(
    (reaction) =>
      (reaction as Record<string, unknown>).actorUserId !== userId,
  );
  const alreadySame = currentReactions.some(
    (reaction) =>
      (reaction as Record<string, unknown>).actorUserId === userId &&
      (reaction as Record<string, unknown>).emoji === emoji,
  );

  const nextReactions = alreadySame
    ? withoutCurrentUser
    : [
        ...withoutCurrentUser,
        {
          actorAvatarUrl: operatorIdentity.avatarUrl,
          actorLabel: operatorIdentity.label,
          actorUserId: userId,
          createdAt: new Date().toISOString(),
          emoji,
        },
      ];

  const shouldSendMetaReaction =
    !alreadySame &&
    existing.direction === "inbound" &&
    existing.sender_type === "customer" &&
    Boolean(existing.external_message_id) &&
    Boolean(to);

  if (shouldSendMetaReaction) {
    let customerServiceWindow: CustomerServiceWindowState;

    try {
      customerServiceWindow = await getCustomerServiceWindow({
        client,
        contactId: normalizeUuid(existing.sender_contact_id),
        ticketId: existing.ticket_id,
        to,
      });
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? `Nao foi possivel validar a janela de 24h do WhatsApp: ${error.message}`
            : "Nao foi possivel validar a janela de 24h do WhatsApp.",
        ok: false as const,
        status: 500,
      };
    }

    if (!customerServiceWindow.open) {
      return {
        error: customerServiceWindowErrorPayload(customerServiceWindow).error,
        ok: false as const,
        status: 409,
      };
    }

    let metaPhoneNumberId: string | null = null;

    try {
      metaPhoneNumberId = await resolveTicketMetaPhoneNumberId({
        client,
        ticketId: existing.ticket_id,
      });
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? `Nao foi possivel validar o telefone de envio do ticket: ${error.message}`
            : "Nao foi possivel validar o telefone de envio do ticket.",
        ok: false as const,
        status: 500,
      };
    }

    const metaSendConfig = metaPhoneNumberId
      ? {
          ...getMetaWhatsAppOutboundConfig(),
          phoneNumberId: metaPhoneNumberId,
        }
      : undefined;

    try {
      await sendMetaWhatsAppReactionMessage({
        ...(metaSendConfig ? { config: metaSendConfig } : {}),
        emoji,
        messageId: existing.external_message_id!,
        to: to!,
      });
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar a reacao pela Meta.",
        ok: false as const,
        status: error instanceof MetaWhatsAppSendError ? error.status : 502,
      };
    }
  }

  const { data, error: updateError } = await client
    .from("caredesk_messages")
    .update({
      provider_payload: {
        ...payload,
        reactions: nextReactions,
      },
    })
    .eq("id", messageId)
    .select(MESSAGE_SELECT)
    .single();

  if (updateError) {
    return {
      error: "Nao foi possivel registrar a reacao no Iris.",
      ok: false as const,
      status: 500,
    };
  }

  return {
    message: data,
    ok: true as const,
    status: 200,
  };
}

async function createQueuedTicketMessage({
  body,
  channelId,
  client,
  contactId,
  media,
  messageType,
  operatorIdentity,
  replyContext,
  ticketId,
  to,
  userId,
}: {
  body: string;
  channelId: string | null;
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  contactId: string | null;
  media: NormalizedOutboundMedia | null;
  messageType: string;
  operatorIdentity: OperatorIdentity;
  replyContext: ReplyContextPreview | null;
  ticketId: string;
  to: string;
  userId: string;
}) {
  const assignment = await assignTicketToOperator({
    client,
    ticketId,
    userId,
  });

  if (!assignment.ok) {
    return assignment;
  }

  // Guarda a mídia enviada (áudio/imagem/documento) no Storage pra aparecer no cockpit
  // (a exibição da conversa lê provider_payload.media.{url,type,fileName}). Best-effort.
  const mediaPayload = media
    ? {
        durationMs: media.durationMs,
        fileName: media.fileName,
        mimeType: media.mimeType,
        type: media.type,
        url: await uploadOutboundMedia(client, media),
      }
    : null;

  const { data, error } = await client
    .from("caredesk_messages")
    .insert({
      body,
      channel_id: channelId,
      delivery_status: "queued",
      direction: "outbound",
      message_type: messageType,
      provider_payload: {
        destination: to,
        media: mediaPayload,
        operatorAvatarUrl: operatorIdentity.avatarUrl,
        operatorLabel: operatorIdentity.label,
        provider: "meta",
        replyTo: replyContext,
        source_module: "iris",
      },
      sender_contact_id: contactId,
      sender_type: "operator",
      sender_user_id: userId,
      ticket_id: ticketId,
    })
    .select(MESSAGE_SELECT)
    .single();

  if (error) {
    return {
      error: "Nao foi possivel registrar a mensagem antes do envio.",
      ok: false as const,
    };
  }

  return {
    message: data,
    ok: true as const,
  };
}

async function uploadOutboundMedia(
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>,
  media: NormalizedOutboundMedia,
): Promise<string | null> {
  // Já está no Storage (upload direto do navegador): não há o que subir.
  if (media.url) {
    return media.url;
  }

  if (!media.base64) {
    return null;
  }

  try {
    const persisted = await uploadIrisMediaBuffer({
      buffer: Buffer.from(media.base64, "base64"),
      client,
      folder: "outbound",
      mimeType: media.mimeType,
      name: crypto.randomUUID(),
    });

    return persisted?.url ?? null;
  } catch (error) {
    console.error("[iris] falha ao persistir midia enviada", error);

    return null;
  }
}

async function prepareExistingTicketMessage({
  client,
  messageId,
  operatorIdentity,
  ticketId,
  to,
  userId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  messageId: string;
  operatorIdentity: OperatorIdentity;
  ticketId: string | null;
  to: string;
  userId: string;
}) {
  const { data: existing, error: existingError } = await client
    .from("caredesk_messages")
    .select(`${MESSAGE_SELECT},ticket_id`)
    .eq("id", messageId)
    .maybeSingle<
      {
        body: string | null;
        created_at: string;
        delivery_status: string;
        direction: string;
        external_message_id: string | null;
        id: string;
        provider_payload?: unknown;
        sender_type: string;
        sender_user_id?: string | null;
        ticket_id: string | null;
      }
    >();

  if (existingError || !existing) {
    return {
      error: "Mensagem local nao encontrada para envio.",
      ok: false as const,
    };
  }

  if (existing.direction !== "outbound") {
    return {
      error: "Somente mensagens outbound podem ser enviadas pela Meta.",
      ok: false as const,
    };
  }

  if (ticketId && existing.ticket_id !== ticketId) {
    return {
      error: "Mensagem local nao pertence ao ticket informado.",
      ok: false as const,
    };
  }

  if (existing.external_message_id) {
    return {
      alreadySent: true as const,
      message: existing,
      ok: true as const,
    };
  }

  const assignment = await assignTicketToOperator({
    client,
    ticketId: existing.ticket_id,
    userId,
  });

  if (!assignment.ok) {
    return assignment;
  }

  const { data, error } = await client
    .from("caredesk_messages")
    .update({
      delivery_status: "queued",
      provider_payload: {
        ...normalizeRecordPayload(existing.provider_payload),
        destination: to,
        operatorAvatarUrl: operatorIdentity.avatarUrl,
        operatorLabel: operatorIdentity.label,
        provider: "meta",
        source_module: "iris",
      },
      sender_type: "operator",
      sender_user_id: existing.sender_user_id ?? userId,
    })
    .eq("id", messageId)
    .select(MESSAGE_SELECT)
    .single();

  if (error) {
    return {
      error: "Nao foi possivel preparar a mensagem local para envio.",
      ok: false as const,
    };
  }

  return {
    alreadySent: false as const,
    message: data,
    ok: true as const,
  };
}

async function assignTicketToOperator({
  client,
  ticketId,
  userId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  ticketId: string | null;
  userId: string;
}) {
  if (!ticketId) {
    return { ok: true as const };
  }

  const { error } = await client
    .from("caredesk_tickets")
    .update({
      assigned_to_user_id: userId,
      status: "waiting_customer",
    })
    .eq("id", ticketId);

  if (error) {
    return {
      error: "Nao foi possivel assumir o responsavel do atendimento.",
      ok: false as const,
    };
  }

  return { ok: true as const };
}

async function persistOutboundReference({
  client,
  localMessageId,
  messageId,
  payload,
  phoneNumberId,
  to,
  waContactId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  localMessageId: string | null;
  messageId: string;
  payload: unknown;
  phoneNumberId: string | null;
  to: string;
  waContactId: string | null;
}) {
  const { data: channel } = await client
    .from("caredesk_channels")
    .select("id,phone_number")
    .eq("slug", "whatsapp-careli")
    .eq("provider", "meta")
    .maybeSingle<{ id: string; phone_number: string | null }>();
  const { error } = await client
    .from("caredesk_whatsapp_message_refs")
    .upsert(
      {
        channel_id: channel?.id ?? null,
        delivery_status: "sent",
        direction: "outbound",
        message_id: localMessageId,
        payload: normalizeJsonPayload(payload),
        phone_number_id: phoneNumberId,
        provider: "meta",
        wa_contact_id: waContactId ?? to,
        wa_message_id: messageId,
      },
      {
        onConflict: "provider,wa_message_id",
      },
    );

  if (error) {
    return {
      ok: false,
      warning:
        "Mensagem enviada, mas a referencia local nao foi registrada.",
    };
  }

  return {
    ok: true,
  };
}

async function markLocalMessageSent({
  client,
  destination,
  existingPayload,
  fallbackUsed,
  messageId,
  operatorIdentity,
  payload,
  sendAttemptCount,
  waMessageId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  destination: string;
  existingPayload?: unknown;
  fallbackUsed: boolean;
  messageId: string;
  operatorIdentity: OperatorIdentity;
  payload: unknown;
  sendAttemptCount: number;
  waMessageId: string;
}) {
  const { data, error } = await client
    .from("caredesk_messages")
    .update({
      delivery_status: "sent",
      external_message_id: waMessageId,
      provider_payload: {
        ...normalizeRecordPayload(existingPayload),
        destination,
        fallbackUsed,
        meta: normalizeJsonPayload(payload),
        operatorAvatarUrl: operatorIdentity.avatarUrl,
        operatorLabel: operatorIdentity.label,
        provider: "meta",
        sendAttemptCount,
      },
      sent_at: new Date().toISOString(),
    })
    .eq("id", messageId)
    .select(MESSAGE_SELECT)
    .single();

  if (error) {
    return null;
  }

  return data;
}

async function markLocalMessageFailed({
  client,
  error,
  existingPayload,
  messageId,
  operatorIdentity,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  error: unknown;
  existingPayload?: unknown;
  messageId: string;
  operatorIdentity: OperatorIdentity;
}) {
  const { data } = await client
    .from("caredesk_messages")
    .update({
      delivery_status: "failed",
      provider_payload: {
        ...normalizeRecordPayload(existingPayload),
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar a mensagem pela Meta.",
        operatorAvatarUrl: operatorIdentity.avatarUrl,
        operatorLabel: operatorIdentity.label,
        provider: "meta",
      },
    })
    .eq("id", messageId)
    .select(MESSAGE_SELECT)
    .single();

  return data ?? null;
}

// Assina a próxima mensagem só quando o remetente muda: lê a última mensagem "real"
// do ticket (entrada do cliente ou saída já enviada — ignora o rascunho recém-enfileirado)
// e NÃO assina se ela já foi um envio do mesmo operador (continuação de um turno).
async function shouldSignOutboundMessage({
  client,
  ticketId,
  userId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  ticketId: string | null;
  userId: string;
}): Promise<boolean> {
  if (!ticketId) {
    return true;
  }

  try {
    const { data } = await client
      .from("caredesk_messages")
      .select("direction,sender_user_id,external_message_id")
      .eq("ticket_id", ticketId)
      .or("direction.eq.inbound,external_message_id.not.is.null")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{
        direction: string | null;
        external_message_id: string | null;
        sender_user_id: string | null;
      }>();

    if (!data) {
      return true;
    }

    return !(data.direction === "outbound" && data.sender_user_id === userId);
  } catch {
    return true;
  }
}

async function getOperatorIdentity({
  client,
  userId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  userId: string;
}): Promise<OperatorIdentity> {
  const { data } = await client
    .from("hub_users")
    .select("display_name,email,avatar_url")
    .eq("id", userId)
    .maybeSingle<{
      avatar_url: string | null;
      display_name: string | null;
      email: string | null;
    }>();
  const name = data?.display_name?.trim();

  return {
    avatarUrl: normalizeUrl(data?.avatar_url),
    label: name || "Operador Iris",
  };
}

function normalizeWhatsAppDestination(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const digits = value.replace(/\D/g, "");

  if (digits.length < 10 || digits.length > 15) {
    return null;
  }

  return digits;
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
    candidates.push(
      `55${withBrazilianNinthDigit[1]}${withBrazilianNinthDigit[2]}`,
    );
  }

  return Array.from(new Set(candidates));
}

function isMetaRecipientAllowedListError(error: unknown) {
  return (
    error instanceof MetaWhatsAppSendError &&
    (String(error.code) === "131030" ||
      /recipient phone number not in allowed list/i.test(error.message))
  );
}

function normalizeMessageBody(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 4096);
}

function normalizeAudioMedia(value: unknown): NormalizedAudioMedia | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (record.type !== "audio" || typeof record.dataUrl !== "string") {
    return null;
  }

  // O header pode trazer parâmetros do tipo de mídia (ex.: o Chrome grava
  // "audio/webm;codecs=opus"), então capturamos tudo até a vírgula e isolamos o mime base.
  const dataUrlMatch = /^data:([^,]+),(.+)$/i.exec(record.dataUrl.trim());

  if (!dataUrlMatch) {
    return null;
  }

  const header = dataUrlMatch[1]?.toLowerCase() ?? "";

  if (!header.includes("base64")) {
    return null;
  }

  const mimeType = header.split(";")[0]?.trim();

  if (!mimeType?.startsWith("audio/")) {
    return null;
  }

  const base64 = dataUrlMatch[2]?.replace(/\s/g, "");

  if (
    !base64 ||
    base64.length > IRIS_AUDIO_MAX_BASE64_LENGTH ||
    !/^[a-z0-9+/=]+$/i.test(base64)
  ) {
    return null;
  }

  const fileName =
    typeof record.fileName === "string" && record.fileName.trim()
      ? record.fileName.trim().replace(/[^a-z0-9._-]+/gi, "-").slice(0, 120)
      : "iris-audio.webm";
  const durationMs =
    typeof record.durationMs === "number" && Number.isFinite(record.durationMs)
      ? Math.max(0, Math.round(record.durationMs))
      : null;

  return {
    base64,
    durationMs,
    fileName,
    mimeType,
  };
}

// Anexo de saída (imagem/documento) enviado pelo operador. Mesmo formato dataURL do áudio,
// com whitelist de mime e limite de tamanho (o body JSON da Vercel tem teto ~4,5MB; imagens
// grandes são reduzidas no cliente antes de subir).
const IRIS_ATTACHMENT_MAX_BASE64_LENGTH = 4_500_000;

const IRIS_IMAGE_MIME_WHITELIST = new Set(["image/jpeg", "image/png"]);

const IRIS_DOCUMENT_MIME_WHITELIST = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

function normalizeAttachmentMedia(
  value: unknown,
): NormalizedAttachmentMedia | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (record.type !== "image" && record.type !== "document") {
    return null;
  }

  const kindPedido = record.type === "image" ? "image" : "document";

  // Mesmo par de envs que o resto do Hub usa (ver lib/chronos/livekit.ts).
  const hostDoNossoStorage = (): string =>
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || "";

  // ── ARQUIVO GRANDE: já subiu direto para o Storage, veio só a referência ──
  // Aceita apenas URL do NOSSO bucket público: com URL livre, a Meta buscaria (e entregaria ao
  // cliente) um arquivo de qualquer lugar da internet apontado por quem chamasse a rota.
  if (typeof record.url === "string" && record.url.trim()) {
    const url = record.url.trim();
    const mimeType = typeof record.mimeType === "string" ? record.mimeType : "";
    const whitelistDireta =
      kindPedido === "image" ? IRIS_IMAGE_MIME_WHITELIST : IRIS_DOCUMENT_MIME_WHITELIST;

    // ⚠️ PRENDE O HOST, não só o trecho do caminho. `includes("/iris-media/")` deixava passar
    // qualquer domínio da internet que tivesse esse pedaço na URL, e a Meta baixaria de lá para
    // entregar ao cliente. O host tem que ser o do NOSSO Supabase.
    let urlValida = false;
    try {
      const alvoUrl = new URL(url);
      const nossoHost = new URL(hostDoNossoStorage()).host;
      urlValida =
        alvoUrl.protocol === "https:" &&
        alvoUrl.host === nossoHost &&
        alvoUrl.pathname.includes(`/${IRIS_MEDIA_BUCKET}/`);
    } catch {
      urlValida = false;
    }

    if (!urlValida || !whitelistDireta.has(mimeType)) {
      return null;
    }

    return {
      fileName:
        typeof record.fileName === "string" && record.fileName.trim()
          ? record.fileName.trim().replace(/[^a-z0-9._-]+/gi, "-").slice(0, 120)
          : kindPedido === "image"
            ? "imagem.jpg"
            : "documento",
      kind: kindPedido,
      mimeType,
      url,
    };
  }

  if (typeof record.dataUrl !== "string") {
    return null;
  }

  const dataUrlMatch = /^data:([^,]+),(.+)$/i.exec(record.dataUrl.trim());

  if (!dataUrlMatch) {
    return null;
  }

  const header = dataUrlMatch[1]?.toLowerCase() ?? "";

  if (!header.includes("base64")) {
    return null;
  }

  const mimeType = header.split(";")[0]?.trim() ?? "";
  const kind = record.type === "image" ? "image" : "document";
  const whitelist =
    kind === "image" ? IRIS_IMAGE_MIME_WHITELIST : IRIS_DOCUMENT_MIME_WHITELIST;

  if (!whitelist.has(mimeType)) {
    return null;
  }

  const base64 = dataUrlMatch[2]?.replace(/\s/g, "");

  if (
    !base64 ||
    base64.length > IRIS_ATTACHMENT_MAX_BASE64_LENGTH ||
    !/^[a-z0-9+/=]+$/i.test(base64)
  ) {
    return null;
  }

  const fileName =
    typeof record.fileName === "string" && record.fileName.trim()
      ? record.fileName.trim().replace(/[^a-z0-9._-]+/gi, "-").slice(0, 120)
      : kind === "image"
        ? "imagem.jpg"
        : "documento";

  return { base64, fileName, kind, mimeType };
}

function normalizeEmoji(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized || normalized.length > 16) {
    return null;
  }

  return normalized;
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

function normalizeRecordPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function readPayloadString(value: unknown, key: string) {
  const record = normalizeRecordPayload(value);
  const raw = record[key];

  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function normalizeUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return /^https?:\/\//i.test(normalized) && normalized.length <= 2048
    ? normalized
    : null;
}

const MESSAGE_SELECT =
  "id,body,direction,sender_type,sender_user_id,message_type,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id,sender_user:hub_users(display_name,email,avatar_url)";
