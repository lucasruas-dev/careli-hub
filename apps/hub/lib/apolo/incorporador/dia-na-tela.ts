/**
 * A DATA QUE É UM DIA, não um instante — vencimento, pagamento, faturamento, geração.
 *
 * ⚠️ POR QUE ISTO EXISTE. Em 18/08/2026 o Lucas comparou a Carteira do portal com o C2X e TODO
 * vencimento aparecia um dia antes (31/07 contra 01/08, 18/08 contra 19/08). A causa é a de
 * sempre com data sem hora: `p.due_date` chega do MySQL como `Date`, vira
 * `2026-08-01T00:00:00.000Z` no JSON, e a tela formatava isso no fuso de São Paulo — três horas
 * para trás, 31/07 às 21h, dia anterior. A tela INTERNA do Apolo nunca teve o problema porque
 * formata em UTC; o portal foi portado com a régua trocada.
 *
 * ⚠️ E POR QUE NÃO "USAR UTC EM TUDO". Nem toda data da tela é um dia: `criadoEm` de documento e
 * `desde` de prospect são INSTANTES, e mostrá-los em UTC erraria de madrugada (um evento das 22h
 * de terça viraria quarta). A régua olha o valor: dia puro e meia-noite exata em UTC são DIA;
 * qualquer outra hora é instante e vai para o fuso de São Paulo.
 */
const FUSO_DA_CASA = "America/Sao_Paulo";

/** `2026-08-01` ou `2026-08-01T00:00:00.000Z` — as duas formas em que um DIA chega até aqui. */
const DIA_PURO = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/;

export function diaNaTela(valor: null | string | undefined, vazio = "-"): string {
  if (!valor) return vazio;

  const comoDia = DIA_PURO.exec(valor.trim());
  if (comoDia) return `${comoDia[3]}/${comoDia[2]}/${comoDia[1]}`;

  const data = new Date(valor);

  return Number.isNaN(data.getTime())
    ? vazio
    : data.toLocaleDateString("pt-BR", { timeZone: FUSO_DA_CASA });
}

/** O mês da competência (mm/aaaa). Sempre UTC: competência é mês, nunca instante. */
export function mesNaTela(valor: null | string | undefined, vazio = "-"): string {
  if (!valor) return vazio;

  const comoDia = DIA_PURO.exec(valor.trim());
  if (comoDia) return `${comoDia[2]}/${comoDia[1]}`;

  const data = new Date(valor);

  return Number.isNaN(data.getTime())
    ? vazio
    : data.toLocaleDateString("pt-BR", { month: "2-digit", timeZone: "UTC", year: "numeric" });
}
