// O QUE A TELA DA PROPOSTA PREENCHE SOZINHA — e que a régua do servidor não decide.
//
// Lucas (04/09/2026), desenhando o "Gerar proposta": *"dá para adicionar proponentes, cada um
// informa a % de participação"* e, sobre a montagem, *"a data da primeira parcela da entrada, já
// preenchida com o próximo dia escolhido"*.
//
// ⚠️ ISTO NÃO É RÉGUA, É PREENCHIMENTO. Quem RECUSA uma proposta é `conferirProposta` (a soma que
// não fecha 100%, a data no passado, o dia fora da faixa), e essas regras continuam lá, num lugar
// só, rodando também no servidor. Aqui está o contrário: o que a tela oferece pronto para a pessoa
// não digitar — o próximo dia 10 e a divisão igual entre os compradores. Misturar os dois faria a
// tela ter uma segunda opinião sobre o que vale, e a segunda opinião sempre acaba mais frouxa que
// a primeira.
//
// ⚠️ E POR QUE NÃO DENTRO DE `proposta.ts`. Aquele arquivo é o contrato entre a tela e a rota: tudo
// o que está lá as duas pontas obedecem. Um padrão de preenchimento não obriga ninguém — a pessoa
// troca a data no campo ao lado —, e deixá-lo junto da régua convidaria o próximo leitor a tratar
// "o próximo dia 10" como regra de negócio.
//
// ⚠️ NADA AQUI LÊ O RELÓGIO. `agoraIso` chega por parâmetro, como em `conferirProposta`: é o que
// permite testar "hoje é dia 20" sem congelar o tempo do processo inteiro.

import { repartirEmPartesIguais } from "./cronograma";
import { diaDoCalendario, VENCIMENTO_DIA_MAXIMO } from "./proposta";

const doisDigitos = (n: number): string => String(n).padStart(2, "0");

/**
 * O próximo dia `dia` do calendário — a data com que o campo da primeira parcela nasce.
 *
 * ⚠️ HOJE CONTA. Quem gera a proposta no dia 10 escolhendo vencimento no 10 quer a entrada HOJE, e
 * empurrar para o mês seguinte daria de graça um mês de carência que ninguém negociou.
 * `conferirProposta` aceita a data de hoje justamente por isso (ela compara dia contra dia, não
 * instante contra instante), e o padrão da tela não pode ser mais rígido do que a régua.
 *
 * ⚠️ O DIA É PRESO EM 28, pela constante de `proposta.ts` e não por um 28 escrito aqui. Acima disso
 * existe mês sem o dia pedido, e a data nascida assim (31/11) é a que o `Date` rola calada para o
 * mês seguinte. Preso em 28, o dia existe em todo mês e a soma de meses nunca precisa encolher.
 *
 * ⚠️ O MÊS ANDA PELA CONTA DE MESES, e não somando 30 dias num `Date`: 31 de janeiro mais um mês é
 * fevereiro, e "mais 30 dias" seria 2 de março.
 *
 * Devolve `""` quando `agoraIso` não é data — o mesmo silêncio de `diaDoCalendario`, para quem
 * chama tratar como "campo vazio" em vez de renderizar `NaN-NaN-NaN`.
 */
export function proximoVencimento(agoraIso: string, dia: number): string {
  const hoje = diaDoCalendario(agoraIso);
  if (!hoje) return "";

  const alvo = Math.min(VENCIMENTO_DIA_MAXIMO, Math.max(1, Math.trunc(dia) || 1));
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7));
  const hojeDia = Number(hoje.slice(8, 10));

  const total = ano * 12 + (mes - 1) + (hojeDia > alvo ? 1 : 0);
  const anoFinal = Math.floor(total / 12);
  const mesFinal = total - anoFinal * 12 + 1;

  return `${anoFinal}-${doisDigitos(mesFinal)}-${doisDigitos(alvo)}`;
}

/**
 * As participações divididas em partes iguais entre `quantidade` compradores.
 *
 * ⚠️ É A MESMA DIVISÃO DO DINHEIRO, DE PROPÓSITO — `repartirEmPartesIguais`, do cronograma. Três
 * compradores dão 33,34 + 33,33 + 33,33, e não 33,33 três vezes: o resto vai na primeira parte, que
 * é a do titular. Uma segunda divisão escrita aqui perderia o centésimo e a soma cairia em 99,99%,
 * que é exatamente o que `conferirProposta` recusa.
 *
 * ⚠️ E É SÓ O PONTO DE PARTIDA. O campo de cada comprador continua editável: casal que compra
 * 70/30 troca os dois números na tela. O padrão existe porque a divisão igual é a esmagadora
 * maioria, não porque ela seja a regra.
 */
export function participacoesIguais(quantidade: number): number[] {
  return repartirEmPartesIguais(100, Math.max(0, Math.trunc(quantidade)));
}

/**
 * Quanto as participações somam, em pontos percentuais.
 *
 * ⚠️ SOMA EM CENTÉSIMOS INTEIROS, como `conferirProposta`. Em ponto flutuante 33,34 + 33,33 + 33,33
 * dá 100.00000000000001, e a tela escreveria "está em 100,000000000000014%" logo abaixo do erro que
 * diz que a soma não fecha.
 *
 * ⚠️ ISTO NÃO DECIDE NADA — é leitura. Quem bloqueia o botão é o erro de `conferirProposta`; esta
 * função só existe para a linha "soma 90% · faltam 10%", que responde a pergunta que a pessoa faz
 * olhando a lista.
 */
export function somaDasParticipacoes(participacoes: number[]): number {
  const centesimos = participacoes.reduce(
    (total, p) => total + Math.round((Number.isFinite(p) ? p : 0) * 100),
    0,
  );
  return centesimos / 100;
}

/**
 * "12,5" e "12.5" viram 12,5; o resto vira 0, e nada passa de 100.
 *
 * ⚠️ PERCENTUAL NÃO É DINHEIRO: não tem separador de milhar, e por isso não usa o parser de reais.
 * "1.5" em dinheiro é mil e quinhentos; em percentual é um e meio.
 *
 * ⚠️ UM PARSER SÓ para os dois campos de % da venda (a entrada do simulador e a participação de
 * cada comprador). Ele nasceu privado dentro do simulador; virou público aqui quando o segundo
 * campo apareceu, porque duas leituras de "33,33" que discordassem em um centésimo é o tipo de
 * diferença que ninguém acha olhando a tela.
 */
export function lerPercentualDigitado(texto: string): number {
  const limpo = String(texto ?? "")
    .replace(/[^\d,.]/g, "")
    .replace(",", ".");
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

/**
 * Quanto falta para fechar 100% — negativo quando passou.
 *
 * Devolve o número, e não a frase: a frase de recusa é a de `conferirProposta`, e duas frases
 * dizendo a mesma coisa com palavras diferentes é como uma delas envelhece sozinha.
 */
export function faltaParaFechar(participacoes: number[]): number {
  return Math.round((100 - somaDasParticipacoes(participacoes)) * 100) / 100;
}
