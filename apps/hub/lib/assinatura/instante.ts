// O INSTANTE DA ASSINATURA, NO FUSO DE QUEM ASSINOU — uma folha pura, sem import nenhum.
//
// ⚠️ ELA NÃO TEM IMPORT DE PROPÓSITO: `scripts/temis/reprocessar-eventos-clicksign.mjs` a carrega
// pelo `jiti`, que não conhece o apelido `@/` do Next. Um import daqui arrastaria o script para
// fora do ar no dia em que alguém "arrumasse" o caminho.
//
// ⚠️ O PORQUÊ DO ARQUIVO (plano da fonte única, 0.10 e seção 10, I6). `hercules_propostas.
// data_assinatura` é DATE, e a Clicksign manda o mesmo instante em dois fusos no mesmo payload
// (`-03:00` na raiz, `Z` em `document.events[]`). Um `slice(0, 10)` sobre o `Z` de uma assinatura
// feita às 23:30 em Brasília grava o DIA SEGUINTE na venda, e o prazo de 7 dias começa um dia
// depois do que o cliente viveu.

/** O deslocamento de Brasília. ⚠️ Fixo: o Brasil não tem horário de verão desde 2019. */
const BRASILIA_EM_MS = -3 * 60 * 60 * 1000;

/**
 * O instante em ISO com `-03:00`, que é o TEXTO que a 0195 guarda nas marcas de cada pessoa.
 *
 * ⚠️ O TEXTO GUARDADO É ESTE, E NÃO O DO PROVEDOR. A função SQL só faz o cast para validar e
 * ordenar; o que a tela mostra é o texto. Guardar `Z` deixaria a leitura humana do jsonb um fuso
 * adiante do contrato.
 *
 * ⚠️ E O HORÁRIO DE VERÃO ANTIGO NÃO VOLTA: um instante de antes de 2019 sai com `-03:00` mesmo
 * que naquele dia Brasília estivesse em `-02:00`. O instante continua o mesmo (o texto é outro
 * jeito de escrever o mesmo ponto no tempo); só a hora de parede fica uma hora diferente. Não há
 * contrato da Clicksign antes de 2026.
 *
 * `null` quando não dá para ler: marca sem data não é marca.
 */
export function emBrasilia(iso: unknown): null | string {
  if (typeof iso !== "string" || !iso.trim()) return null;
  const lido = Date.parse(iso.trim());
  if (Number.isNaN(lido)) return null;
  // Desloca o relógio para a parede de Brasília e escreve com o fuso certo no fim.
  const parede = new Date(lido + BRASILIA_EM_MS).toISOString();
  return `${parede.slice(0, 23)}-03:00`;
}

/** O formatador do dia, criado uma vez (o `Intl` é caro para montar a cada chamada). */
const FORMATADOR_DO_DIA = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric",
});

/**
 * O DIA, em Brasília, no formato de coluna DATE (`AAAA-MM-DD`).
 *
 * ⚠️ PELO `Intl` COM `timeZone`, NUNCA POR `slice(0, 10)`. O `slice` lê o dia do fuso em que o
 * texto foi escrito: `2026-09-12T02:30:00Z` é 23:30 do dia 11 em Brasília, e o `slice` diria 12.
 * `en-CA` porque é o locale que já escreve na ordem ano, mês, dia.
 */
export function diaEmBrasilia(iso: unknown): null | string {
  if (typeof iso !== "string" || !iso.trim()) return null;
  const lido = Date.parse(iso.trim());
  if (Number.isNaN(lido)) return null;
  return FORMATADOR_DO_DIA.format(new Date(lido));
}
