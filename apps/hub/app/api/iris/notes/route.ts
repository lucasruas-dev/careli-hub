import { NextResponse, type NextRequest } from "next/server";

import {
  authorizeIrisMetaRequest,
  createIrisMetaAdminClient,
} from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Operação assistida (sussurro interno): registra uma nota visível só à equipe,
// SEM enviar nada pela Meta. Não assume o ticket nem mexe na janela de 24h.
const MESSAGE_SELECT =
  "id,body,direction,sender_type,sender_user_id,message_type,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id,sender_user:hub_users(display_name,email,avatar_url)";

type CreateNoteBody = {
  body?: unknown;
  channelId?: unknown;
  ticketId?: unknown;
};

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const input = (await request.json().catch(() => null)) as CreateNoteBody | null;
  const ticketId = normalizeUuid(input?.ticketId);
  const channelId = normalizeUuid(input?.channelId);
  const body =
    typeof input?.body === "string" ? input.body.trim().slice(0, 4096) : "";

  if (!ticketId) {
    return NextResponse.json(
      { error: "Informe o ticket da nota interna." },
      { status: 400 },
    );
  }

  if (!body) {
    return NextResponse.json(
      { error: "Escreva a nota interna." },
      { status: 400 },
    );
  }

  const operator = await getOperatorIdentity({
    client: authorization.client,
    userId: authorization.user.id,
  });

  const { data, error } = await authorization.client
    .from("caredesk_messages")
    .insert({
      body,
      channel_id: channelId,
      delivery_status: "sent",
      direction: "internal",
      message_type: "note",
      provider_payload: {
        internalNote: true,
        operatorAvatarUrl: operator.avatarUrl,
        operatorLabel: operator.label,
        source_module: "iris",
      },
      sender_type: "operator",
      sender_user_id: authorization.user.id,
      ticket_id: ticketId,
    })
    .select(MESSAGE_SELECT)
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel registrar a nota interna." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { message: data, ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function getOperatorIdentity({
  client,
  userId,
}: {
  client: NonNullable<ReturnType<typeof createIrisMetaAdminClient>>;
  userId: string;
}): Promise<{ avatarUrl: string | null; label: string }> {
  const { data } = await client
    .from("hub_users")
    .select("display_name,avatar_url")
    .eq("id", userId)
    .maybeSingle<{ avatar_url: string | null; display_name: string | null }>();
  const name = data?.display_name?.trim();
  const avatarUrl =
    typeof data?.avatar_url === "string" && /^https?:\/\//i.test(data.avatar_url)
      ? data.avatar_url
      : null;

  return {
    avatarUrl,
    label: name || "Operador Iris",
  };
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
