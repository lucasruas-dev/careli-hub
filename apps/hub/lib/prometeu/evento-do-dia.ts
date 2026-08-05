import type { PrometeuEvento } from "./types";

// QUAL EVENTO A TELA DE OPERAÇÃO DEVE ABRIR.
//
// O ciclo do evento é: `ativo` (montado, em preparação) -> `em_andamento` (o dia começou, depois
// do "Iniciar evento real") -> `encerrado`. As telas do posto procuravam só por `ativo`: no minuto
// em que o lançamento COMEÇA de verdade o status muda e elas caem no fallback `lista[0]`, que é o
// evento mais recente da lista — podendo ser um encerrado, ou outro lançamento qualquer.
//
// Espelha a prioridade que o servidor já usa em `eventoOperavelId`: quem está EM ANDAMENTO manda;
// senão, o que está ativo. Nunca cai num encerrado.
export function eventoDoDia(
  eventos: readonly PrometeuEvento[],
): PrometeuEvento | undefined {
  return (
    eventos.find((e) => e.status === "em_andamento") ??
    eventos.find((e) => e.status === "ativo") ??
    // Último recurso: nada em operação — devolve o primeiro que NÃO esteja encerrado, e só então
    // o primeiro da lista (dev/ensaio, onde pode não haver nenhum evento em pé).
    eventos.find((e) => e.status !== "encerrado") ??
    eventos[0]
  );
}
