// QUE DIA É HOJE PARA O HADES — uma régua só, no fuso de quem cobra.
//
// ⚠️ A VERCEL RODA EM UTC E A NÍVEA NÃO. `new Date().toISOString().slice(0, 10)` vira o dia
// SEGUINTE às 21h de Brasília, e das 21h à meia-noite todo motor do Hades passava a achar que já
// era amanhã: a promessa que vence HOJE era lida como vencida (`etapaDoCompromisso`) e a parcela
// que vence hoje sumia da Previsibilidade (`todayDateOnly`, já anotado como pendência no
// changelog em 24/09/2026). Três horas por dia, todo dia, e não uma borda rara.
//
// ⚠️ E É UMA RÉGUA SÓ DE PROPÓSITO. `todayDateOnly` (compromissos.ts), o `today` da régua de
// lembretes (regua-cron.ts) e o `hoje` da etapa (etapa-do-compromisso.ts) eram três cópias byte a
// byte da mesma conta. Consertar o fuso em uma delas faria a etapa acionar um cliente que a régua
// ainda considera em dia — que é pior do que o defeito que se estava consertando. O molde é o
// mesmo já usado em `lib/apolo/c2x-write.ts:104` e em `lib/apolo/incorporador/dia-na-tela.ts`.

/** O fuso em que a cobrança trabalha. */
export const FUSO_DA_CASA = "America/Sao_Paulo";

// "en-CA" formata exatamente como AAAA-MM-DD, que é o formato de `promised_date` e `due_date`.
const COMO_DIA = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_DA_CASA });

/** Hoje em `YYYY-MM-DD`, no fuso de Brasília. */
export function hojeNaCasa(now: Date = new Date()): string {
  return COMO_DIA.format(now);
}
