// Guarda de turno da CACA: decide se ESTA execucao deve responder ao cliente.
//
// O PROBLEMA (medido em prod, 25/jun a 26/jul): cada mensagem que chega dispara uma execucao
// independente do agente. Quando o cliente manda duas mensagens seguidas ("Olá" + "Bom dia"),
// as duas execucoes geram e as DUAS respostas vao pro cliente, quase identicas. No pior caso
// visto (AT-000923, dona Elizabete), as duas respostas sairam com 8 segundos de diferenca — uma
// do Claude e uma do motor legado — e a cliente recebeu as duas na cara.
//
// A SOLUCAO, sem lock distribuido e sem sleep (serverless: esperar custa dinheiro):
//   1. RAJADA — se ja' existe mensagem do cliente MAIS NOVA que a minha, eu desisto. A execucao
//      da mensagem mais nova responde o lote inteiro, porque ela le' o historico completo (que
//      inclui a minha). Uma resposta so', considerando tudo que o cliente falou.
//   2. CORRIDA — se ja' existe resposta NOSSA depois da mensagem que eu estou processando,
//      alguem (outra execucao, ou um operador humano) ja' respondeu. Eu desisto.
//
// A checagem 1 roda ANTES de chamar o modelo (economiza token) e a 2 roda antes de chamar E
// depois de gerar, imediatamente antes do envio, que e' onde a janela de corrida realmente mora.

import type { SupabaseClient } from "@supabase/supabase-js";

export type DecisaoDeTurno =
  // `motivo` no caminho liberado existe so' pra log: diz POR QUE liberamos sem ancora de tempo.
  | { motivo?: "mensagem_desconhecida"; responder: true }
  | { motivo: "rajada" | "ja_respondido"; responder: false };

export type EstadoDoTurno = {
  // created_at (ISO) da mensagem do cliente que esta execucao esta processando.
  minhaInboundEm: string | null;
  // created_at (ISO) da mensagem MAIS RECENTE do cliente neste atendimento.
  inboundMaisRecenteEm: string | null;
  // created_at (ISO) da resposta MAIS RECENTE nossa (CACA ou humano) neste atendimento.
  outboundMaisRecenteEm: string | null;
};

// Logica pura: separada do banco justamente pra poder ser testada caso a caso.
export function decidirTurno(estado: EstadoDoTurno): DecisaoDeTurno {
  const { inboundMaisRecenteEm, minhaInboundEm, outboundMaisRecenteEm } = estado;

  if (!minhaInboundEm) {
    // Nao achei minha propria mensagem no banco (webhook fora de ordem, dedup, ou insert que
    // ainda nao commitou). Sem ancora de tempo nao da' pra comparar nada: respondo, porque
    // deixar o cliente sem resposta e' pior que arriscar uma duplicata.
    return { motivo: "mensagem_desconhecida", responder: true };
  }

  if (inboundMaisRecenteEm && inboundMaisRecenteEm > minhaInboundEm) {
    return { motivo: "rajada", responder: false };
  }

  if (outboundMaisRecenteEm && outboundMaisRecenteEm > minhaInboundEm) {
    return { motivo: "ja_respondido", responder: false };
  }

  return { responder: true };
}

// A resposta do PostgREST e' tipada na mao: a inferencia encadeada do supabase-js estoura o
// limite do compilador aqui (TS2589) porque as tabelas nao tem tipos gerados.
type RespostaDeTempo = {
  data: Array<{ created_at: string | null }> | null;
  error: unknown;
};

async function ultimaMensagemEm(
  client: SupabaseClient,
  ticketId: string,
  direction: "inbound" | "outbound",
): Promise<string | null> {
  const { data, error } = (await client
    .from("caredesk_messages")
    .select("created_at")
    .eq("ticket_id", ticketId)
    .eq("direction", direction)
    .order("created_at", { ascending: false })
    .limit(1)) as RespostaDeTempo;

  if (error) {
    // Falha de leitura nao pode calar a CACA: devolve null, que faz o guarda liberar o turno.
    return null;
  }

  return data?.[0]?.created_at ?? null;
}

// Le o estado do atendimento pra alimentar decidirTurno. `providerMessageId` e' o id da Meta
// (caredesk_messages.external_message_id), a unica ancora estavel que temos da mensagem atual.
export async function consultarEstadoDoTurno({
  client,
  providerMessageId,
  ticketId,
}: {
  client: SupabaseClient;
  providerMessageId: string | null;
  ticketId: string;
}): Promise<EstadoDoTurno> {
  let minhaInboundEm: string | null = null;

  if (providerMessageId) {
    const { data } = (await client
      .from("caredesk_messages")
      .select("created_at")
      .eq("ticket_id", ticketId)
      .eq("external_message_id", providerMessageId)
      .order("created_at", { ascending: false })
      .limit(1)) as RespostaDeTempo;

    minhaInboundEm = data?.[0]?.created_at ?? null;
  }

  const [inboundMaisRecenteEm, outboundMaisRecenteEm] = await Promise.all([
    ultimaMensagemEm(client, ticketId, "inbound"),
    ultimaMensagemEm(client, ticketId, "outbound"),
  ]);

  return { inboundMaisRecenteEm, minhaInboundEm, outboundMaisRecenteEm };
}
