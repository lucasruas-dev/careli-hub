// A FAIXA DO PRAZO — qual plano vale para o parcelamento pedido, e quanto ele exige de entrada.
//
// Lucas (05/09/2026): *"temos umas faixas: normal, curto, investidor, à vista. Acontece que se eu
// colocar o parcelamento de 30 vezes eu não posso ter uma entrada menor que 56k, pois está dentro
// do plano investidor; se eu colocar 48 eu não posso ter uma entrada menor que 28k"*.
//
// ⚠️ ISTO MUDA O QUE `entradaPercentual` SIGNIFICA. Até aqui ele era lido como a entrada SUGERIDA
// de cada plano — o número que preenche o campo quando a pessoa escolhe o plano —, e o único chão
// real era o piso da casa (10%, 8% no Garden). Só que a tabela do empreendimento não é uma lista de
// sugestões: ela é uma escada em que prazo curto custa entrada alta, e é assim que o produto é
// vendido. Com o percentual valendo só como sugestão, a tela aceitava 30 parcelas com entrada de
// 10% — uma condição que nenhum plano da casa sustenta, saindo no papel do cliente.
//
// ⚠️ A FAIXA É O PLANO DE MENOR PRAZO QUE AINDA COMPORTA O PARCELAMENTO. Pedir 30 parcelas não
// escolhe o plano de 120: escolhe o primeiro degrau que cabe, que é o de 36. É o mesmo raciocínio
// de quem monta a tabela — "até 36 meses, 40% de entrada" —, e é por isso que a busca é pelo MENOR
// prazo maior-ou-igual, e não pelo mais próximo em qualquer direção: o plano de 36 comporta 30
// parcelas (sobra prazo), o de 1 não comporta coisa nenhuma além de 1.
//
// ⚠️ E O PISO FINAL É O MAIOR DOS DOIS. O piso da casa continua valendo por baixo: um
// empreendimento cujo plano longo pede 8% não passa a vender abaixo do mínimo da Careli só porque
// a tabela dele diz isso.

/** O que esta régua precisa saber de um plano. É um subconjunto do que a tela já carrega. */
export type PlanoDaFaixa = {
  entradaPercentual: number;
  nome: string;
  parcelas: number;
};

export type FaixaEncontrada = {
  /** O percentual de entrada que ESTE prazo exige. */
  entradaPercentual: number;
  nome: string;
  /** O prazo do plano que define a faixa — 36 quando se pediu 30. */
  parcelas: number;
};

/**
 * O plano que vale para este parcelamento.
 *
 * `null` quando nenhum plano comporta o prazo pedido (pediram 180 numa tabela que vai até 120), e
 * aí quem chama decide: a tela avisa, e a régua do servidor recusa.
 */
export function faixaDoPrazo(
  planos: PlanoDaFaixa[],
  parcelas: number,
): FaixaEncontrada | null {
  if (!Number.isFinite(parcelas) || parcelas < 1) return null;

  const candidatos = planos
    .filter((p) => Number.isFinite(p.parcelas) && p.parcelas >= parcelas)
    // ⚠️ ORDEM EXPLÍCITA, e não "o primeiro que achar". A lista chega do banco sem `order` e do
    // C2X na ordem do legado: sem ordenar, o mesmo prazo cairia ora no plano de 36, ora no de 120,
    // e a entrada mínima mudaria entre dois cliques iguais.
    .sort((a, b) => a.parcelas - b.parcelas);

  const escolhido = candidatos[0];
  if (!escolhido) return null;

  return {
    entradaPercentual: escolhido.entradaPercentual,
    nome: escolhido.nome,
    parcelas: escolhido.parcelas,
  };
}

/**
 * O piso de entrada em reais para este prazo, já com o piso da casa por baixo.
 *
 * `pisoDaCasaEmReais` é o que `entradaMinima` já calcula hoje (10% da casa, 8% no Garden). Aqui
 * ele não é recalculado: entra pronto, para não existirem duas contas do mesmo mínimo.
 */
export function pisoDaEntradaNoPrazo(entrada: {
  parcelas: number;
  pisoDaCasaEmReais: number;
  planos: PlanoDaFaixa[];
  valorNegociado: number;
}): { emReais: number; faixa: FaixaEncontrada | null } {
  const faixa = faixaDoPrazo(entrada.planos, entrada.parcelas);
  const piso = Number.isFinite(entrada.pisoDaCasaEmReais) ? entrada.pisoDaCasaEmReais : 0;

  if (!faixa || !Number.isFinite(entrada.valorNegociado) || entrada.valorNegociado <= 0) {
    return { emReais: piso, faixa };
  }

  // ⚠️ ARREDONDA NO CENTAVO, PARA CIMA. 40% de R$ 145.451 é R$ 58.180,40; truncar no real daria um
  // piso dez centavos abaixo do que a tabela manda, e a tela acusaria "abaixo do mínimo" no
  // próprio número que ela sugeriu — o mesmo defeito que o campo de % da entrada já teve.
  const doPlano = Math.ceil(entrada.valorNegociado * faixa.entradaPercentual) / 100;

  return { emReais: Math.max(piso, doPlano), faixa };
}
