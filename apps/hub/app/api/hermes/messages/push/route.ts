import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { sendHermesMessagePush } from "@/lib/pulsex/push";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reforço de entrega do Web Push (Lote 1 das notificações do Hermes).
//
// O envio de mensagem tenta a rota /api/hermes/messages (que dispara o push via
// after()) e, se ela falhar por QUALQUER motivo, cai num INSERT direto do browser
// no Supabase — caminho que não passa pelo servidor, então o Web Push simplesmente
// não acontecia: mensagem entregue, nenhuma notificação de SO pra ninguém. Era uma
// das causas do "tem hora que chega, tem hora que não" do time.
//
// O client agora chama esta rota fire-and-forget depois do INSERT direto. Ela lê a
// mensagem do banco (fonte da verdade — não confia no payload do client) e dispara
// o mesmo sendHermesMessagePush da rota principal.
export async function POST(request: NextRequest) {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Configure a chave server-side para notificar mensagens." },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!accessToken) {
    return NextResponse.json({ error: "Sessao ausente." }, { status: 401 });
  }

  const adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } =
    await adminClient.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Sessao invalida." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as {
    messageId?: unknown;
  } | null;
  const messageId =
    typeof payload?.messageId === "string" ? payload.messageId.trim() : "";

  if (!messageId) {
    return NextResponse.json({ error: "messageId ausente." }, { status: 400 });
  }

  const { data: message } = await adminClient
    .from("pulsex_messages")
    .select("id,channel_id,author_user_id,body,metadata,deleted_at")
    .eq("id", messageId)
    .maybeSingle<{
      author_user_id: string | null;
      body: string | null;
      channel_id: string;
      deleted_at: string | null;
      id: string;
      metadata: Record<string, unknown> | null;
    }>();

  if (!message || message.deleted_at) {
    return NextResponse.json(
      { error: "Mensagem nao encontrada." },
      { status: 404 },
    );
  }

  // Só o AUTOR dispara o push da própria mensagem (impede notificação forjada).
  if (message.author_user_id !== authData.user.id) {
    return NextResponse.json({ error: "Sem permissao." }, { status: 403 });
  }

  const metadata = message.metadata ?? {};
  const mentionUserIds = Array.isArray(metadata.mentionUserIds)
    ? metadata.mentionUserIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const threadParentMessageId =
    typeof metadata.threadParentMessageId === "string"
      ? metadata.threadParentMessageId
      : null;

  try {
    await sendHermesMessagePush({
      authorUserId: message.author_user_id,
      body: message.body ?? "",
      channelId: message.channel_id,
      mentionUserIds,
      messageId: message.id,
      threadParentMessageId,
    });
  } catch {
    // Best-effort: o push nunca pode virar erro pro remetente.
  }

  return NextResponse.json({ ok: true });
}
