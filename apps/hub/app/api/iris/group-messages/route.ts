import { NextResponse, type NextRequest } from "next/server";

import { sendEvolutionGroupText } from "@/lib/iris/evolution-api";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";
import { signWhatsAppBody } from "@/lib/iris/meta-whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Envio do OPERADOR para um grupo de WhatsApp, via gateway Evolution (o número
// observador é membro do grupo). Grupo não é ticket: a mensagem pendura direto
// no grupo (caredesk_messages.group_id).
//
// ⚠️ Esta rota fica FORA de /api/iris/evolution de propósito: aquele prefixo está
// na allowlist do proxy.ts (webhook público) e libera subcaminhos. Aqui exigimos
// sessão do operador, como em qualquer rota /api/*.

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
  const body = typeof input.body === "string" ? input.body.trim() : "";

  if (!groupId || !body) {
    return NextResponse.json(
      { error: "Informe o grupo e o texto da mensagem." },
      { status: 400 },
    );
  }

  const { data: group } = await client
    .from("caredesk_whatsapp_groups")
    .select("id,group_jid,monitored")
    .eq("id", groupId)
    .maybeSingle<{
      id: string;
      group_jid: string;
      monitored: boolean | null;
    }>();

  if (!group) {
    return NextResponse.json(
      { error: "Grupo nao encontrado." },
      { status: 404 },
    );
  }

  const { data: operator } = await client
    .from("hub_users")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle<{ display_name: string | null }>();

  const operatorLabel = operator?.display_name?.trim() || "Operador Iris";

  // No grupo quem fala é o número observador — a mensagem vai assinada com o nome
  // de quem escreveu (mesma convenção do 1:1). O corpo salvo fica SEM assinatura:
  // o cockpit já mostra o autor no selo.
  const sent = await sendEvolutionGroupText({
    groupJid: group.group_jid,
    text: signWhatsAppBody(operatorLabel, body),
  });

  if (!sent.ok) {
    return NextResponse.json({ error: sent.error }, { status: 502 });
  }

  const { data: channel } = await client
    .from("caredesk_channels")
    .select("id")
    .eq("slug", "whatsapp-grupo")
    .maybeSingle<{ id: string }>();

  const now = new Date().toISOString();

  const { data: message, error } = await client
    .from("caredesk_messages")
    .insert({
      body,
      channel_id: channel?.id ?? null,
      delivery_status: "sent",
      direction: "outbound",
      external_message_id: sent.providerMessageId,
      group_id: group.id,
      message_type: "text",
      provider_payload: {
        provider: "evolution",
        groupJid: group.group_jid,
        operatorLabel,
      },
      sender_type: "operator",
      sender_user_id: user.id,
      sent_at: now,
      ticket_id: null,
    })
    .select(
      "id,ticket_id,group_id,body,direction,sender_type,sender_user_id,message_type,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id",
    )
    .single();

  if (error) {
    // A mensagem FOI para o grupo; só o registro local falhou.
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
