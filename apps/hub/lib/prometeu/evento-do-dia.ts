import type { PrometeuEvento } from "./types";

// QUAL EVENTO A TELA DE OPERAÇÃO DEVE ABRIR.
//
// O ciclo do evento é: `ativo` (montado, em preparação) -> `em_andamento` (o dia começou, depois
// do "Iniciar evento real") -> `encerrado`. As telas do posto procuravam só por `ativo`: no minuto
// em que o lançamento COMEÇA de verdade o status muda e elas caem no fallback `lista[0]`, que é o
// evento mais recente da lista — podendo ser um encerrado, ou outro lançamento qualquer.
//
// Espelha a prioridade que o servidor já usa em `eventoOperavelId`: quem está EM ANDAMENTO manda;
// senão, o que está ativo.
//
// ⚠️ NUNCA DEVOLVE UM ENCERRADO — e até 21/08/2026 devolvia, contrariando esta mesma frase. O
// último fallback era `?? eventos[0]`, o evento mais recente da lista, e com o Vale do Ouro
// (encerrado em 01/08) sendo o ÚNICO evento do banco era exatamente ele que voltava. Por isso o
// check-in, o atendente e a gestão mobile abriam num lançamento morto enquanto as rotas de
// servidor recusavam com "sem evento ativo": as duas pontas discordavam.
//
// `undefined` é a resposta certa quando não há lançamento em pé. A tela mostra o vazio, que é a
// verdade, em vez de operar em cima de um evento que acabou.
export function eventoDoDia(
  eventos: readonly PrometeuEvento[],
): PrometeuEvento | undefined {
  return (
    eventos.find((e) => e.status === "em_andamento") ??
    eventos.find((e) => e.status === "ativo") ??
    // Último recurso: um RASCUNHO (lançamento sendo montado). Serve para o ensaio antes do dia.
    eventos.find((e) => e.status === "rascunho")
  );
}
