// A MATEMÁTICA DA PROPOSTA PERSONALIZADA — entrada, prazo, balões anuais e parcela-alvo.
//
// Lucas (03/09/2026): *"o simulador de proposta eu quero o mesmo que temos na Cecilio, aquele ficou
// ótimo"*, e logo depois *"e a parte da personalizada"*. A vista oficial monta a proposta a partir
// do plano cadastrado; a personalizada é onde o coordenador NEGOCIA — mexe na entrada, no prazo, põe
// um balão anual, ou parte da parcela que o cliente aguenta e descobre a entrada que fecha a conta.
//
// ⚠️ POR QUE ISTO NÃO ESTÁ EM `planos-comerciais.ts`. Aquele módulo calcula a parcela DE UM PLANO —
// a entrada sai do percentual do plano e não há balão nenhum. Aqui a entrada é digitada e existem
// pagamentos anuais fora da série mensal, que mudam a fórmula: o valor presente dos balões sai do
// saldo antes de dividir. São duas perguntas diferentes sobre a mesma taxa.
//
// ⚠️ E A TAXA VEM DE LÁ (`taxaMensal`), sempre. É ela que sabe converter 8% ao ano em taxa mensal
// pela convenção do plano (equivalente ou proporcional) — e essa diferença, num financiamento de
// 120 parcelas, custa cerca de 1% por parcela.

/** Valor presente de `n` balões anuais de `valor`, à taxa mensal `i`. */
export function valorPresenteDosBaloes(quantidade: number, valor: number, i: number): number {
  if (quantidade <= 0 || valor <= 0) return 0;
  if (i <= 0) return quantidade * valor;

  let soma = 0;
  // O k-ésimo balão cai no aniversário k, ou seja, 12k meses à frente.
  for (let k = 1; k <= quantidade; k += 1) soma += valor * (1 + i) ** (-12 * k);
  return soma;
}

/** Fator de anuidade: quanto vale hoje uma série de `parcelas` pagamentos de 1, à taxa `i`. */
export function fatorDeAnuidade(parcelas: number, i: number): number {
  if (parcelas <= 0) return 0;
  if (i <= 0) return parcelas;
  return (1 - (1 + i) ** -parcelas) / i;
}

export type PropostaMontada = {
  /** O que sobra para a série mensal, depois da entrada e do valor presente dos balões. */
  financiado: number;
  parcela: number;
  /** Soma de tudo o que o cliente desembolsa: entrada + parcelas + balões. */
  total: number;
};

/**
 * A parcela de uma proposta montada à mão.
 *
 * ⚠️ O BALÃO SAI DO SALDO PELO VALOR PRESENTE, e não pelo valor de face. Somar R$ 20.000 de um
 * balão que cai daqui a três anos como se fosse dinheiro de hoje reduziria a parcela além do que a
 * conta permite — e a proposta sairia mais barata do que o contrato consegue cumprir.
 */
export function montarProposta(entrada: {
  baloesQuantidade: number;
  baloesValor: number;
  entrada: number;
  parcelas: number;
  taxaAoMes: number;
  valor: number;
}): PropostaMontada {
  const { baloesQuantidade, baloesValor, parcelas, taxaAoMes, valor } = entrada;
  const desembolsoInicial = Math.max(0, entrada.entrada);

  const vpBaloes = valorPresenteDosBaloes(baloesQuantidade, baloesValor, taxaAoMes);
  const financiado = Math.max(0, valor - desembolsoInicial - vpBaloes);
  const parcela = parcelas > 0 ? financiado / fatorDeAnuidade(parcelas, taxaAoMes) : 0;

  return {
    financiado,
    parcela,
    total: desembolsoInicial + parcela * parcelas + baloesQuantidade * baloesValor,
  };
}

/**
 * O caminho inverso: o cliente diz quanto pode pagar por mês, e a conta devolve a entrada.
 *
 * ⚠️ É A PERGUNTA QUE MAIS APARECE NA MESA. "Consigo pagar 1.500" é como o comprador fala; sair
 * disso para a entrada, na mão, é tentativa e erro. Entrada negativa significa que a parcela pedida
 * já paga o lote inteiro antes do prazo — devolvemos zero e quem chama avisa que sobra.
 */
export function entradaParaAParcela(entrada: {
  baloesQuantidade: number;
  baloesValor: number;
  parcela: number;
  parcelas: number;
  taxaAoMes: number;
  valor: number;
}): { entrada: number; sobra: number } {
  const { baloesQuantidade, baloesValor, parcela, parcelas, taxaAoMes, valor } = entrada;

  const vpBaloes = valorPresenteDosBaloes(baloesQuantidade, baloesValor, taxaAoMes);
  const vpParcelas = parcela * fatorDeAnuidade(parcelas, taxaAoMes);
  const bruta = valor - vpBaloes - vpParcelas;

  return bruta >= 0 ? { entrada: bruta, sobra: 0 } : { entrada: 0, sobra: -bruta };
}
