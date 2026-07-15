import { NextResponse, type NextRequest } from "next/server";

import {
  sendEvolutionGroupAudio,
  sendEvolutionGroupMedia,
  sendEvolutionGroupReaction,
  sendEvolutionGroupText,
} from "@/lib/iris/evolution-api";
import { uploadIrisMediaBuffer } from "@/lib/iris/meta-media-storage";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";
import { signWhatsAppBody } from "@/lib/iris/meta-whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Saida do OPERADOR para um grupo de WhatsApp, pelo gateway Evolution (o numero
// observador e membro do grupo). Cobre texto, imagem, documento, audio e reacao.
// Grupo nao e ticket: a mensagem pendura direto no grupo (caredesk_messages.group_id).
//
// ⚠️ Esta rota fica FORA de /api/iris/evolution de proposito: aquele prefixo esta
// na allowlist do proxy.ts (webhook publico) e libera subcaminhos. Aqui exigimos
// sessao do operador, como em qualquer rota /api/*.

const MESSAGE_SELECT =
  "id,ticket_id,group_id,body,direction,sender_type,sender_user_id,message_type,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id";

type OutboundMedia = {
  base64: string;
  durationMs: number | null;
  fileName: string;
  mimeType: string;
  type: "audio" | "document" | "image";
};

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const { client, user } = authorization;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
  }

  const input = (payload ?? {}) as Record<string, unknown>;
  const groupId = typeof input.groupId === "string" ? input.groupId : "";

  if (!groupId) {
    return NextResponse.json({ error: "Informe o grupo." }, { status: 400 });
  }

  const { data: group } = await client
    .from("caredesk_whatsapp_groups")
    .select("id,group_jid")
    .eq("id", groupId)
    .maybeSingle<{ id: string; group_jid: string }>();

  if (!group) {
    return NextResponse.json(
      { error: "Grupo nao encontrado." },
      { status: 404 },
    );
  }

  const operatorLabel = await readOperatorLabel(client, user.id);

  if (input.action === "react") {
    return reactInGroup({
      client,
      emoji: typeof input.emoji === "string" ? input.emoji : "",
      group,
      messageId: typeof input.messageId === "string" ? input.messageId : "",
      operatorLabel,
      userId: user.id,
    });
  }

  const body = typeof input.body === "string" ? input.body.trim() : "";
  const media = normalizeOutboundMedia(input.media);

  if (!body && !media) {
    return NextResponse.json(
      { error: "Informe o texto ou o arquivo da mensagem." },
      { status: 400 },
    );
  }

  return sendToGroup({
    body,
    client,
    group,
    media,
    operatorLabel,
    userId: user.id,
  });
}

async function sendToGroup({
  body,
  client,
  group,
  media,
  operatorLabel,
  userId,
}: {
  body: string;
  client: any;
  group: { id: string; group_jid: string };
  media: OutboundMedia | null;
  operatorLabel: string;
  userId: string;
}) {
  // No grupo quem fala e o numero observador — a mensagem vai assinada com o nome
  // de quem escreveu. O corpo salvo fica SEM assinatura: o cockpit mostra o autor.
  const signed = signWhatsAppBody(operatorLabel, body);

  const sent = media
    ? media.type === "audio"
      ? await sendEvolutionGroupAudio({
          base64: media.base64,
          groupJid: group.group_jid,
        })
      : await sendEvolutionGroupMedia({
          base64: media.base64,
          caption: signed,
          fileName: media.fileName,
          groupJid: group.group_jid,
          mediatype: media.type,
          mimeType: media.mimeType,
        })
    : await sendEvolutionGroupText({
        groupJid: group.group_jid,
        text: signed,
      });

  if (!sent.ok) {
    return NextResponse.json({ error: sent.error }, { status: 502 });
  }

  // Guarda a midia no Storage pra aparecer no cockpit (a conversa le
  // provider_payload.media.{url,type,fileName}). Best-effort.
  const mediaPayload = media
    ? {
        durationMs: media.durationMs,
        fileName: media.fileName,
        mimeType: media.mimeType,
        type: media.type,
        url: await uploadOutboundMedia(client, media),
      }
    : null;

  const channelId = await readGroupChannelId(client);
  const now = new Date().toISOString();

  const { data: message, error } = await client
    .from("caredesk_messages")
    .insert({
      body,
      channel_id: channelId,
      delivery_status: "sent",
      direction: "outbound",
      external_message_id: sent.providerMessageId,
      group_id: group.id,
      message_type: media?.type ?? "text",
      provider_payload: {
        groupJid: group.group_jid,
        media: mediaPayload,
        operatorLabel,
        provider: "evolution",
        source_module: "iris",
      },
      sender_type: "operator",
      sender_user_id: userId,
      sent_at: now,
      ticket_id: null,
    })
    .select(MESSAGE_SELECT)
    .single();

  if (error) {
    // A mensagem FOI para o grupo; so o registro local falhou.
    return NextResponse.json(
      {
        error:
          "Mensagem enviada ao grupo, mas nao foi possivel registra-la na conversa.",
      },
      { status: 500 },
    );
  }

  await client
    .from("caredesk_whatsapp_groups")
    .update({ last_message_at: now, updated_at: now })
    .eq("id", group.id);

  return NextResponse.json(
    { ok: true, message },
    { headers: { "Cache-Control": "no-store" }, status: 200 },
  );
}

// Reacao = toggle na propria mensagem (provider_payload.reactions) + envio ao
// WhatsApp usando a chave do provedor. Mesmo comportamento do 1:1.
async function reactInGroup({
  client,
  emoji,
  group,
  messageId,
  operatorLabel,
  userId,
}: {
  client: any;
  emoji: string;
  group: { id: string; group_jid: string };
  messageId: string;
  operatorLabel: string;
  userId: string;
}) {
  if (!emoji || !messageId) {
    return NextResponse.json(
      { error: "Informe a mensagem e o emoji." },
      { status: 400 },
    );
  }

  const { data: existing } = await client
    .from("caredesk_messages")
    .select("id,group_id,direction,external_message_id,provider_payload")
    .eq("id", messageId)
    .eq("group_id", group.id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json(
      { error: "Mensagem nao encontrada no grupo." },
      { status: 404 },
    );
  }

  const payload =
    existing.provider_payload &&
    typeof existing.provider_payload === "object" &&
    !Array.isArray(existing.provider_payload)
      ? (existing.provider_payload as Record<string, unknown>)
      : {};

  const currentReactions = Array.isArray(payload.reactions)
    ? (payload.reactions as Record<string, unknown>[]).filter(
        (reaction) =>
          reaction && typeof reaction === "object" && !Array.isArray(reaction),
      )
    : [];

  const alreadySame = currentReactions.some(
    (reaction) =>
      reaction.actorUserId === userId && reaction.emoji === emoji,
  );
  const withoutCurrentUser = currentReactions.filter(
    (reaction) => reaction.actorUserId !== userId,
  );

  const nextReactions = alreadySame
    ? withoutCurrentUser
    : [
        ...withoutCurrentUser,
        {
          actorLabel: operatorLabel,
          actorUserId: userId,
          createdAt: new Date().toISOString(),
          emoji,
        },
      ];

  // Tirar a reacao no WhatsApp = enviar reacao vazia (protocolo do WhatsApp).
  if (existing.external_message_id) {
    const sent = await sendEvolutionGroupReaction({
      emoji: alreadySame ? "" : emoji,
      fromMe: existing.direction === "outbound",
      groupJid: group.group_jid,
      providerMessageId: existing.external_message_id,
    });

    if (!sent.ok) {
      return NextResponse.json({ error: sent.error }, { status: 502 });
    }
  }

  const { data: message, error } = await client
    .from("caredesk_messages")
    .update({
      provider_payload: { ...payload, reactions: nextReactions },
    })
    .eq("id", existing.id)
    .select(MESSAGE_SELECT)
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel registrar a reacao." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, message },
    { headers: { "Cache-Control": "no-store" }, status: 200 },
  );
}

async function readOperatorLabel(client: any, userId: string) {
  const { data } = await client
    .from("hub_users")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();

  const displayName = data?.display_name;

  return typeof displayName === "string" && displayName.trim()
    ? displayName.trim()
    : "Operador Iris";
}

async function readGroupChannelId(client: any) {
  const { data } = await client
    .from("caredesk_channels")
    .select("id")
    .eq("slug", "whatsapp-grupo")
    .maybeSingle();

  return typeof data?.id === "string" ? data.id : null;
}

async function uploadOutboundMedia(client: any, media: OutboundMedia) {
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
    console.error("[iris] falha ao persistir midia enviada ao grupo", error);

    return null;
  }
}

// O cliente manda { dataUrl, fileName, mimeType, type, durationMs } — mesmo
// contrato do caminho do Meta.
function normalizeOutboundMedia(value: unknown): OutboundMedia | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl : "";
  const type = record.type;

  if (
    !dataUrl ||
    (type !== "audio" && type !== "document" && type !== "image")
  ) {
    return null;
  }

  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);

  if (!match || !match[2]) {
    return null;
  }

  const mimeType =
    (typeof record.mimeType === "string" && record.mimeType) ||
    match[1] ||
    "application/octet-stream";

  const durationMs =
    typeof record.durationMs === "number" && Number.isFinite(record.durationMs)
      ? record.durationMs
      : null;

  return {
    base64: match[2],
    durationMs,
    fileName:
      typeof record.fileName === "string" && record.fileName.trim()
        ? record.fileName.trim()
        : "arquivo",
    mimeType,
    type,
  };
}
