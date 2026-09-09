// PAGINAÇÃO DO HISTÓRICO DA IRIS — as duas decisões, puras, longe do Supabase.
//
// ⚠️ O HISTÓRICO MOSTRAVA 32 HORAS E DIZIA QUE MOSTRAVA TUDO. Medido em 09/09/2026 na base de
// produção: `caredesk_tickets` tinha 5.869 encerrados e a carga levava 400 para a tela
// (`iris-data-client.ts`, `.limit(400)`), então 5.469 eram invisíveis. Os 400 cobriam de
// 07/09 23:48 a 09/09 07:57 — o encerrado mais antigo do banco é de 25/06. De 1.558 clientes
// com atendimento, só 283 apareciam: 1.275 sumiam por inteiro.
//
// ⚠️ E O COMENTÁRIO PROMETIA UMA PEÇA QUE NÃO EXISTIA: "o histórico busca no banco quando
// precisa de um antigo". Não buscava. `iris-history-view.tsx` não tinha um único fetch — só
// filtrava em memória a lista que recebia. Este arquivo é a metade pura da peça que faltava.
//
// O que ficou fora daqui de propósito: a leitura em si (mora no `iris-data-client.ts`, que é o
// único lugar que fala com o Supabase) e a régua de acesso por fila, que não pode ter duas
// versões — quem decide o que o usuário enxerga continua sendo `montarQueryTickets`.

/** O mínimo que a paginação precisa saber de um ticket. */
type TicketPaginavel = {
  closedAt?: null | string;
  id: string;
};

/**
 * Por onde o PRÓXIMO lote começa: o encerramento mais antigo que já está na tela.
 *
 * ⚠️ OS ABERTOS VIVEM NA MESMA LISTA. `irisData.tickets` mistura os 490 abertos com os
 * encerrados, e aberto não tem `closedAt`. Pegar o menor valor sem filtrar devolveria nulo, o
 * lote seguinte começaria do zero e traria de novo as mesmas linhas, para sempre.
 *
 * @returns O `closed_at` (ISO) do mais antigo, ou `null` quando não há encerrado carregado —
 *          e aí não há por onde continuar.
 */
export function cursorDoHistorico(tickets: TicketPaginavel[]): null | string {
  let cursor: null | string = null;
  let cursorEmMs = Number.POSITIVE_INFINITY;

  for (const ticket of tickets) {
    const closedAt = ticket.closedAt;

    if (!closedAt) {
      continue;
    }

    // Data inválida gravada na linha não pode envenenar o cursor: `NaN` em comparação é
    // sempre falso, então ela simplesmente não concorre.
    const emMs = new Date(closedAt).getTime();

    if (!Number.isFinite(emMs) || emMs >= cursorEmMs) {
      continue;
    }

    cursor = closedAt;
    cursorEmMs = emMs;
  }

  return cursor;
}

/**
 * Une o que a carga corrente trouxe com os lotes antigos já paginados.
 *
 * ⚠️ A BASE VENCE, E ISSO É A REGRA. `base` vem do refresh de 90s (e do realtime), então é a
 * versão mais nova: se o atendimento foi reaberto ou trocou de responsável depois de ter sido
 * paginado, a tela mostra o estado de agora, não a fotografia do clique.
 *
 * ⚠️ E DEDUPLICA POR ID. Sem isso, cada refresh empilharia de novo tudo o que já tinha sido
 * paginado e a lista cresceria sozinha, com o mesmo protocolo repetido na tela.
 */
export function mesclarTicketsDoHistorico<T extends TicketPaginavel>(
  base: T[],
  extras: T[],
): T[] {
  if (extras.length === 0) {
    return base;
  }

  const jaListados = new Set(base.map((ticket) => ticket.id));
  const mesclado = [...base];

  for (const extra of extras) {
    if (jaListados.has(extra.id)) {
      continue;
    }

    jaListados.add(extra.id);
    mesclado.push(extra);
  }

  return mesclado;
}
