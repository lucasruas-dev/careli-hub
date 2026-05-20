import { NextResponse, type NextRequest } from "next/server";

import {
  MetaWhatsAppSendError,
  getMetaWhatsAppConfigStatus,
  sendMetaWhatsAppTextMessage,
} from "@/lib/iris/meta-whatsapp";
import {
  authorizeIrisMetaRequest,
  createIrisMetaAdminClient,
} from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SendMessageBody = {
  body?: unknown;
  to?: unknown;
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
  const body = normalizeMessageBody(input?.body);

  if (!to) {
    return NextResponse.json(
      { error: "Informe o telefone WhatsApp em formato internacional." },
      { status: 400 },
    );
  }

  if (!body) {
    return NextResponse.json(
      { error: "Informe a mensagem para enviar pelo WhatsApp." },
      { status: 400 },
    );
  }

  try {
    const result = await sendMetaWhatsAppTextMessage({ body, to });

    if (!result.messageId) {
      return NextResponse.json(
        { error: "Meta WhatsApp nao retornou ID da mensagem." },
        { status: 502 },
      );
    }

    const persistence = await persistOutboundReference({
      client: authorization.client,
      messageId: result.messageId,
      payload: result.raw,
      to,
      waContactId: result.contactWaId,
    });

    return NextResponse.json(
      {
        contactWaId: result.contactWaId,
        messageId: result.messageId,
        ok: true,
        persistence,
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

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel enviar a mensagem pela Meta.",
      },
      { status },
    );
  }
}

async function persistOutboundReference({
  client,
  messageId,
  payload,
  to,
  waContactId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  messageId: string;
  payload: unknown;
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
        payload: normalizeJsonPayload(payload),
        phone_number_id: process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? null,
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
