import { NextResponse, type NextRequest } from "next/server";

import { sendEvolutionGroupText } from "@/lib/iris/evolution-api";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";
import { signWhatsAppBody } from "@/lib/iris/meta-whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Envio do OPERADOR para um grupo de WhatsApp monitorado, via gateway Evolution
// (o número observador é membro do grupo — a mensagem sai por ele).
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
  const ticketId = typeof input.ticketId === "string" ? input.ticketId : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";

  if (!ticketId || !body) {
    return NextResponse.json(
      { error: "Informe o ticket e o texto da mensagem." },
      { status: 400 },
    );
  }

  const { data: ticket } = await client
    .from("caredesk_tickets")
    .select("id,channel_id,source_entity_id,source_entity_type,status")
    .eq("id", ticketId)
    .maybeSingle<{
      id: string;
      channel_id: string | null;
      source_entity_id: string | null;
      source_entity_type: string | null;
      status: string | null;
    }>();

  if (!ticket) {
    return NextResponse.json(
      { error: "Conversa nao encontrada." },
      { status: 404 },
    );
  }

  if (ticket.source_entity_type !== "whatsapp-group" || !ticket.source_entity_id) {
    return NextResponse.json(
      { error: "Esta conversa nao e um grupo de WhatsApp." },
      { status: 400 },
    );
  }

  const groupJid = ticket.source_entity_id;

  const { data: operator } = await client
    .from("hub_users")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle<{ display_name: string | null }>();

  const operatorLabel = operator?.display_name?.trim() || "Operador Iris";

  // No grupo, quem fala é o número observador — então a mensagem vai assinada
  // com o nome de quem escreveu (mesma convenção do atendimento 1:1). O corpo
  // salvo na conversa fica SEM assinatura: o cockpit já mostra o autor no selo.
  const sent = await sendEvolutionGroupText({
    groupJid,
    text: signWhatsAppBody(operatorLabel, body),
  });

  if (!sent.ok) {
    return NextResponse.json({ error: sent.error }, { status: 502 });
  }

  const now = new Date().toISOString();

  const { data: message, error } = await client
    .from("caredesk_messages")
    .insert({
      body,
      channel_id: ticket.channel_id,
      delivery_status: "sent",
      direction: "outbound",
      external_message_id: sent.providerMessageId,
      message_type: "text",
      provider_payload: {
        provider: "evolution",
        groupJid,
        operatorLabel,
      },
      sender_type: "operator",
      sender_user_id: user.id,
      sent_at: now,
      ticket_id: ticket.id,
    })
    .select(
      "id,ticket_id,body,direction,sender_type,sender_user_id,message_type,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id",
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
    .from("caredesk_tickets")
    .update({ updated_at: now })
    .eq("id", ticket.id);

  return NextResponse.json(
    { ok: true, message },
    { headers: { "Cache-Control": "no-store" }, status: 200 },
  );
}
