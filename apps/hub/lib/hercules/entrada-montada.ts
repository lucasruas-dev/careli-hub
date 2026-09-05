// A ENTRADA MONTADA À MÃO — quando o cliente não paga em parcelas iguais.
//
// Lucas (05/09/2026): *"quando a entrada for parcelada, temos que dar opção do usuário poder montar
// os valores em cada parcela"*. E, corrigindo a régua logo depois: *"eu havia dito que não poderia
// ser maior ou menor; o que não pode é ser MENOR — maior pode, e ao ser maior, atualizar o valor de
// entrada"*.
//
// ⚠️ A ASSIMETRIA É A REGRA, e ela é comercial, não técnica. Somar MENOS que a entrada combinada é
// vender por menos do que foi negociado: o financiado cresce, a parcela sobe e o papel deixa de
// bater com a conta que a mesa fez. Somar MAIS é o cliente pagando mais no ato — bom para a casa,
// e não há por que impedir. Por isso o excedente não é erro: ele VIRA a entrada, o financiado cai
// junto e a proposta sai com o número que a pessoa realmente montou.
//
// ⚠️ E É POR ISSO QUE ESTA LIB DEVOLVE UM VALOR, e não só um "válido/inválido": quem chama precisa
// saber que a entrada mudou para recalcular o resto. Uma função que só dissesse "pode" deixaria a
// tela mostrando R$ 28.000 de entrada com R$ 30.000 somados embaixo.
//
// ⚠️ TUDO EM CENTAVOS INTEIROS. Somar reais em ponto flutuante faz 3.333,33 × 3 dar
// 9.999,989999999998, e a comparação com 10.000 recusaria a divisão mais comum entre três parcelas.
// O dinheiro da casa se mede em centavo; o `number` só volta na saída.

/** Centavos inteiros a partir de reais, tolerando o que a tela ainda não terminou de digitar. */
function centavos(valor: number): number {
  return Number.isFinite(valor) ? Math.round(valor * 100) : 0;
}

export type EntradaMontada = {
  /**
   * O valor da entrada DEPOIS da montagem.
   *
   * Igual ao combinado quando a soma fecha; igual à SOMA quando ela passa. Ver o aviso do topo.
   */
  entrada: number;
  /** Quanto passou do combinado, em reais. Zero quando fecha exatamente. */
  excedente: number;
  /** O que falta para chegar ao combinado, em reais. Zero quando fecha ou passa. */
  falta: number;
  /** `false` só quando a soma é MENOR que o combinado. */
  ok: boolean;
  /** A soma das parcelas, em reais. */
  soma: number;
};

/**
 * Confere a entrada montada contra a entrada combinada.
 *
 * `combinada` é o valor que está no campo Entrada; `parcelas` são os valores digitados linha a
 * linha. Parcela vazia ou meio digitada entra como zero — e é isso que faz a soma ficar abaixo
 * enquanto a pessoa preenche, sem a tela acusar erro em cada tecla (quem decide quando reclamar é
 * a tela, olhando `ok` só depois que ela terminou).
 */
export function conferirEntradaMontada(
  combinada: number,
  parcelas: number[],
): EntradaMontada {
  const alvo = centavos(combinada);
  const somaEmCentavos = parcelas.reduce((total, p) => total + centavos(p), 0);

  const soma = somaEmCentavos / 100;
  const diferenca = somaEmCentavos - alvo;

  return {
    // ⚠️ A ENTRADA ACOMPANHA PARA CIMA, e só para cima. Para baixo ela fica onde estava, e `ok`
    // fica falso: é o caso em que a montagem ainda não fecha o que foi negociado.
    entrada: diferenca > 0 ? soma : combinada,
    excedente: diferenca > 0 ? diferenca / 100 : 0,
    falta: diferenca < 0 ? -diferenca / 100 : 0,
    ok: diferenca >= 0,
    soma,
  };
}

/**
 * As parcelas iguais de partida, com o resto na PRIMEIRA.
 *
 * ⚠️ É A MESMA REGRA DO CRONOGRAMA (`repartirEmPartesIguais`), e tem que continuar sendo: a
 * montagem começa exatamente do que a proposta faria sozinha, para quem não quiser mexer em nada
 * ter o mesmo resultado de antes. R$ 10.000 em 3× nasce 3.333,34 / 3.333,33 / 3.333,33.
 */
export function partesIguais(total: number, vezes: number): number[] {
  if (!Number.isFinite(total) || !Number.isInteger(vezes) || vezes < 1) return [];

  const alvo = centavos(total);
  const base = Math.floor(alvo / vezes);
  const resto = alvo - base * vezes;

  return Array.from({ length: vezes }, (_, i) => (i === 0 ? base + resto : base) / 100);
}

/**
 * Redistribui mantendo o que a pessoa já digitou nas outras linhas.
 *
 * ⚠️ SERVE AO CASO REAL: "a primeira é 10 mil, divide o resto". Ela recebe o índice da parcela que
 * foi FIXADA e devolve as demais repartidas igualmente sobre o que sobra — com o resto na primeira
 * das que sobraram, pela mesma razão de sempre. Quando o fixado já passa do total, as outras vão a
 * zero em vez de negativo: parcela negativa não existe, e o excedente é tratado por
 * `conferirEntradaMontada`, que sobe a entrada.
 */
export function redistribuirDemais(
  total: number,
  parcelas: number[],
  indiceFixado: number,
): number[] {
  if (parcelas.length === 0) return parcelas;

  const alvo = centavos(total);
  const fixado = centavos(parcelas[indiceFixado] ?? 0);
  const sobra = Math.max(0, alvo - fixado);
  const quantas = parcelas.length - 1;

  if (quantas < 1) return [fixado / 100];

  const base = Math.floor(sobra / quantas);
  const resto = sobra - base * quantas;

  let primeiraDasOutras = true;
  return parcelas.map((valor, i) => {
    if (i === indiceFixado) return fixado / 100;
    const comResto = primeiraDasOutras ? base + resto : base;
    primeiraDasOutras = false;
    return comResto / 100;
  });
}
