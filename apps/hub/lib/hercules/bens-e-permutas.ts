// O BEM E A PERMUTA RECEBIDOS NA AQUISIÇÃO — o carro, o lote, o apartamento que entram na conta.
//
// Lucas (22/09/2026), em resposta direta: *"Abate, como uma entrada"*; quantos cabem numa proposta,
// *"Vários"*; e se conta para a entrada mínima de 10%, *"pode ser um ou outro, pode apontar na
// entrada ou somente no valor negociado"*.
//
// ⚠️ POR QUE UM MÓDULO SÓ PARA ISTO, E NÃO O TIPO SOLTO EM `proposta.ts`. Quatro contas leem a
// mesma lista — `montarCronograma` (o PDF e o boleto), `conferirProposta` (a régua do servidor),
// `montarProposta`/`entradaParaAParcela` (a tela) e `composicoesQueFecham` (a busca por parcela) —
// e o módulo da régua importa o da conta, não o contrário. Com o tipo em `proposta.ts`,
// `cronograma.ts` e `simulacao.ts` passariam a importar a régua para somar dinheiro, e o import
// ficaria circular. Aqui não depende de ninguém, e por isso todo mundo pode depender.
//
// ⚠️ E A SOMA É UMA FUNÇÃO SÓ, PELO MESMO MOTIVO DE `anuaisQueAbatemOSaldo`. Cada chamador somando
// a lista do seu jeito é como a tela e o PDF voltam a anunciar dois financiados para a mesma venda
// — foi exatamente o que aconteceu com os reforços anuais (o cartão dizia R$ 180.000 e o papel do
// cliente, R$ 166.111,11).

/** Um bem ou uma permuta recebido na aquisição da unidade. */
export type BemOuPermuta = {
  /** O que é o bem, em texto livre: "Ford Ka 2019 placa ABC1D23", "lote 12 da quadra 4 em Anápolis". */
  descricao: string;
  /**
   * Onde o valor entra na conta.
   * "entrada"     — conta como entrada e CUMPRE a entrada mínima.
   * "abatimento"  — reduz o saldo a financiar mas NÃO cumpre a entrada mínima.
   */
  entraComo: "abatimento" | "entrada";
  tipo: "bem" | "permuta";
  /** Em reais. */
  valor: number;
};

/**
 * Só o que é dinheiro de verdade.
 *
 * ⚠️ VALOR QUE NÃO É NÚMERO POSITIVO NÃO SOMA. A lista chega de um formulário que está sendo
 * preenchido: uma linha recém-adicionada tem `valor` vazio (`NaN` depois do `Number`), e somá-la
 * levaria `NaN` para o financiado — e `NaN < 0` é falso, então a trava de composição que não fecha
 * deixaria passar um cronograma inteiro de parcelas `NaN`.
 *
 * ⚠️ ELA É EXPORTADA PORQUE QUEM IMPRIME TAMBÉM PRECISA DELA. O quadro do contrato
 * (`lib/temis/tabela-de-pagamentos.ts`) e a folha da proposta (`proposta-para-pdf.ts`) decidem quais
 * itens viram LINHA, e a linha tem de ser exatamente o que esta soma conta. Enquanto o quadro teve
 * a sua própria cópia — que coagia com `Number(bem.valor)` —, a lista `[{ valor: "80000" }]`
 * imprimia um total de R$ 2.000.080.000.100.000,00 embaixo de uma cláusula que dizia R$ 0,00
 * (medido em 22/09/2026). Régua de dinheiro é uma só, pelo mesmo motivo de `somarBensEPermutas`.
 *
 * ⚠️ E NÃO COAGE DE PROPÓSITO. `valor` é `number` no contrato do tipo: quem grava normaliza (a rota
 * faz `Number` antes do upsert). Aceitar texto aqui seria aceitar que ele chegue torto lá.
 */
export const valeDinheiro = (bem: BemOuPermuta): boolean =>
  Number.isFinite(bem.valor) && bem.valor > 0;

/** Centavos inteiros: é nesta moeda que dinheiro se soma sem susto de ponto flutuante. */
const emReais = (valor: number): number => Math.round(valor * 100) / 100;

/**
 * Quanto os bens e permutas abatem do valor a financiar — PELO VALOR CHEIO, os dois `entraComo`.
 *
 * ⚠️ ELES NÃO PASSAM POR `anuaisQueAbatemOSaldo`. Aquele critério de valor presente é do reforço
 * ANUAL, que vence lá na frente (o balão do terceiro aniversário vale hoje menos que a face); o bem
 * é entregue no ato da aquisição, e o que é entregue hoje vale hoje o que vale. Descontá-lo a valor
 * presente tiraria do comprador uma parte do carro que ele já deu.
 *
 * ⚠️ E O `entraComo` NÃO MUDA ESTE NÚMERO. Lucas (22/09/2026): *"Abate, como uma entrada"* — os
 * dois modos abatem igual. O que "abatimento" não faz é CUMPRIR a entrada mínima, e isso é a outra
 * função deste arquivo.
 */
export function somarBensEPermutas(
  bens: null | readonly BemOuPermuta[] | undefined,
): number {
  if (!bens || bens.length === 0) return 0;
  return emReais(
    bens.reduce((total, bem) => (valeDinheiro(bem) ? total + bem.valor : total), 0),
  );
}

/**
 * Quanto dos bens e permutas CUMPRE a entrada mínima — só os `entraComo: "entrada"`.
 *
 * ⚠️ É UM CAMPO POR ITEM, E NÃO UMA REGRA FIXA DA CASA (Lucas, 22/09/2026, perguntado se a permuta
 * conta para a entrada mínima de 10%: *"pode ser um ou outro, pode apontar na entrada ou somente no
 * valor negociado"*). Fixar a regra num lado só tiraria do comercial a escolha que ele acabou de
 * pedir: com "sempre conta", o piso de 10% vira letra morta em toda venda com permuta grande; com
 * "nunca conta", o cliente que entrega um carro de R$ 80.000 num lote de R$ 200.000 ainda precisa
 * pôr R$ 20.000 em espécie.
 */
export function somarBensQueContamNaEntrada(
  bens: null | readonly BemOuPermuta[] | undefined,
): number {
  if (!bens || bens.length === 0) return 0;
  return emReais(
    bens.reduce(
      (total, bem) =>
        bem.entraComo === "entrada" && valeDinheiro(bem) ? total + bem.valor : total,
      0,
    ),
  );
}
