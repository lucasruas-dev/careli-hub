import type { SupabaseClient } from "@supabase/supabase-js";

import { abrirAtendimentoDaAcao } from "@/lib/apolo/acao-atendimento";
import { renderConvitePreview } from "@/lib/apolo/acao-template";

// BACKFILL: cria o atendimento (ticket + conversa) para disparos que JÁ saíram antes de o disparo
// passar a abrir atendimento. NÃO reenvia nada — reusa o disparo_wa_message_id já gravado. É
// idempotente (a idempotência da mensagem em abrirAtendimentoDaAcao evita duplicar). Ver
// [[project_apolo_acao_contato]].

const PHONE_4143 = "1167201739813897";

function primeiroNome(nome: string | null): string {
  const p = (nome ?? "").trim().split(/\s+/)[0];
  return p || "tudo bem";
}

type AlvoBackfill = {
  disparo_wa_message_id: string | null;
  entity_id: string | null;
  id: string;
  nome: string | null;
  resposta_em: string | null;
  resposta_texto: string | null;
  telefone: string | null;
};

// Joga a resposta que o cliente já tinha dado (capturada antes de existir o atendimento) na conversa.
async function inserirRespostaNaConversa(
  client: SupabaseClient,
  ticketId: string,
  texto: string,
  em: string,
): Promise<boolean> {
  const { data: jaTem } = await client
    .from("caredesk_messages")
    .select("id")
    .eq("ticket_id", ticketId)
    .eq("direction", "inbound")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (jaTem) return false;

  const { data: ticket } = await client
    .from("caredesk_tickets")
    .select("channel_id, contact_id")
    .eq("id", ticketId)
    .maybeSingle<{ channel_id: string | null; contact_id: string | null }>();

  await client.from("caredesk_messages").insert({
    body: texto,
    channel_id: ticket?.channel_id ?? null,
    delivery_status: "delivered",
    direction: "inbound",
    message_type: "button",
    provider_payload: { backfill: true },
    sender_contact_id: ticket?.contact_id ?? null,
    sender_type: "customer",
    sent_at: em,
    ticket_id: ticketId,
  });
  await client
    .from("caredesk_tickets")
    .update({ status: "waiting_operator", updated_at: em })
    .eq("id", ticketId);
  return true;
}

export async function backfillAtendimentosDaAcao(
  client: SupabaseClient,
  acaoId: string,
): Promise<{ atendimentos: number; respostas: number; total: number }> {
  const { data: acao } = await client
    .from("apolo_acoes")
    .select("nome")
    .eq("id", acaoId)
    .maybeSingle<{ nome: string }>();

  const { data: alvos } = await client
    .from("apolo_acao_alvos")
    .select(
      "id, nome, telefone, entity_id, disparo_wa_message_id, resposta_texto, resposta_em",
    )
    .eq("acao_id", acaoId)
    .not("disparo_wa_message_id", "is", null);

  const lista = (alvos ?? []) as AlvoBackfill[];
  let atendimentos = 0;
  let respostas = 0;

  for (const alvo of lista) {
    if (!alvo.telefone) continue;
    const r = await abrirAtendimentoDaAcao(client, {
      acaoId,
      acaoNome: acao?.nome ?? "Ação de contato",
      alvoId: alvo.id,
      entityId: alvo.entity_id,
      metaRaw: null,
      nome: alvo.nome,
      phoneNumberId: PHONE_4143,
      previewTexto: renderConvitePreview(primeiroNome(alvo.nome)),
      telefone: alvo.telefone,
      waMessageId: alvo.disparo_wa_message_id,
    });
    if (!r) continue;
    atendimentos += 1;

    if (alvo.resposta_texto && alvo.resposta_em) {
      const ok = await inserirRespostaNaConversa(
        client,
        r.ticketId,
        alvo.resposta_texto,
        alvo.resposta_em,
      );
      if (ok) respostas += 1;
    }
  }

  return { atendimentos, respostas, total: lista.length };
}
