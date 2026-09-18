// A TABELA DO EMPREENDIMENTO APLICADA A UM LOTE — cada plano com o desconto, a entrada e as anuais
// dele.
//
// Lucas (18/09/2026), com o print da Mesa de Venda do Garden: *"olha por favor os planos, esta
// diferente"* · *"esta faltando as anuais"* · *"tem que ser igual o mmendes"*. O cartão do
// INVESTIDOR PARCELADO dizia "R$ 4.764 · 84x · entrada R$ 34.800 (8%)" num lote de R$ 435.000, que
// é `(435.000 − 34.800) ÷ 84`: sem as 4 anuais de R$ 25.000 e sem os 8% de desconto do plano. No mapa
// do Garden no portal da MMendes (`masterplans-internos/garden.html`, `condicoes(preco, p, i)`) o
// mesmo plano parte de `preço × (1 − desconto)`, tira a entrada do plano e as anuais do plano, e só
// então divide pelo prazo.
//
// ⚠️ ESTA É A CONTA DO CARTÃO, DO CLIQUE E DA ABERTURA DO LOTE. Até aqui o simulador tinha três
// cópias dela (o `useMemo` da tabela, `carregarPlano` e o efeito que abre o lote no plano mais
// longo), as três com `baloesQuantidade: 0`. Uma função só é o que impede o cartão de anunciar uma
// parcela e o clique carregar outra.
//
// ⚠️ E A PARCELA É A DE `montarProposta`, NÃO UMA FÓRMULA NOVA. É ela que alimenta o cartão grande,
// e é a mesma conta que `montarCronograma` faz para o PDF (as anuais abatem o saldo por
// `anuaisQueAbatemOSaldo`: valor de face no SACOC, como a MMendes; valor presente na Price e no SAC).

import {
  calcularParcela,
  type NaturezaDaParcela,
  type PlanoComercial,
  type SistemaAmortizacao,
  taxaMensal,
} from "@/lib/apolo/planos-comerciais";

import {
  type AjusteDePreco,
  aplicarAjuste,
  ajusteDoPlano,
  descontoDoPlano,
  precoNoPlano,
  SEM_AJUSTE,
} from "./ajuste-de-preco";
import { anuaisDoPlano, entradaMinima } from "./composicoes";
import { montarProposta, sistemaDoCadastro } from "./simulacao";

/** O que a conta precisa saber de um plano. É um subconjunto de `PlanoDaComposicao`. */
export type PlanoDaTabela = {
  /** As anuais do plano (0138). Andam em par: meia configuração não é anual nenhuma. */
  anuaisQuantidade?: null | number;
  anuaisValor?: null | number;
  /** O desconto do plano sobre a tabela, 0 a 100 (0178). Ausente ou nulo = sem desconto. */
  descontoPercentual?: null | number;
  entradaPercentual: number;
  parcelas: number;
  sistemaAmortizacao: SistemaAmortizacao;
  /** Taxa MENSAL já convertida por `taxaMensal`. */
  taxaAoMes: number;
};

export type CondicaoDoPlano = {
  /** O desconto do plano escrito como o campo de desconto do simulador o entende. */
  ajuste: AjusteDePreco;
  /** As anuais que cabem no prazo, e de quanto. Zero e zero quando o plano não tem. */
  anuais: { quantidade: number; valor: number };
  /** O desconto do plano, já normalizado (0 quando não tem). */
  descontoPercentual: number;
  entrada: number;
  financiado: number;
  /** A do PRIMEIRO ciclo no SACOC, como em `montarProposta`. */
  parcela: number;
  /** A tabela com o desconto do plano: é o valor negociado quando o plano é escolhido. */
  precoDoPlano: number;
  total: number;
};

/**
 * A entrada que o plano sugere para este preço.
 *
 * ⚠️ ARREDONDA PARA CIMA E NUNCA FICA ABAIXO DO PISO. 10% de R$ 136.521 é R$ 13.652,10; arredondar
 * para baixo dava R$ 13.652 e a própria sugestão do plano nascia dez centavos abaixo do mínimo,
 * com a tela acusando "abaixo do mínimo" no valor que ela mesma tinha preenchido.
 *
 * ⚠️ MUDOU DE CASA, NÃO DE CONTA (18/09/2026): era uma função privada do simulador, e é copiada aqui
 * linha a linha. O teste de regressão compara com a fórmula antiga.
 */
export function entradaDoPlano(
  valor: number,
  percentual: number,
  minimo: null | number,
): number {
  return Math.max(entradaMinima(valor, minimo), Math.ceil((valor * percentual) / 100));
}

/**
 * Um plano aplicado a um preço de tabela: desconto, entrada, anuais e parcela.
 *
 * `precoDeTabela` é o preço ANTES do desconto do plano. `entradaMinimaPercentual` é o piso do
 * empreendimento (nulo = padrão da casa, zero = zero), e incide sobre o preço já com o desconto.
 */
export function condicaoDoPlano(entrada: {
  entradaMinimaPercentual: null | number;
  plano: PlanoDaTabela;
  precoDeTabela: number;
}): CondicaoDoPlano {
  const { entradaMinimaPercentual, plano, precoDeTabela } = entrada;
  const descontoPercentual = descontoDoPlano(plano.descontoPercentual);
  const precoDoPlano = precoNoPlano(precoDeTabela, descontoPercentual);
  const valorDaEntrada = entradaDoPlano(
    precoDoPlano,
    plano.entradaPercentual,
    entradaMinimaPercentual,
  );
  const anuais = anuaisDoPlano(plano);
  const montada = montarProposta({
    baloesQuantidade: anuais.quantidade,
    baloesValor: anuais.valor,
    entrada: valorDaEntrada,
    parcelas: plano.parcelas,
    sistemaAmortizacao: plano.sistemaAmortizacao,
    taxaAoMes: plano.taxaAoMes,
    valor: precoDoPlano,
  });

  return {
    ajuste: ajusteDoPlano(descontoPercentual),
    anuais,
    descontoPercentual,
    entrada: valorDaEntrada,
    financiado: montada.financiado,
    parcela: montada.parcela,
    precoDoPlano,
    total: montada.total,
  };
}

/** O plano do cadastro (o `PlanoComercial` com o que só o Panteon tem) que a tabela do lote lê. */
export type PlanoDoCadastro = PlanoComercial & {
  anuaisQuantidade?: null | number;
  anuaisValor?: null | number;
  descontoPercentual?: null | number;
};

/**
 * O plano do cadastro no formato da conta: a taxa já mensal e o sistema já normalizado.
 *
 * ⚠️ É A MESMA CONVERSÃO QUE O SIMULADOR FAZ NO `planosDaConta` (taxa por `taxaMensal`, sistema por
 * `sistemaDoCadastro`). Quem confere um plano fora da Mesa (a aba de planos do Apolo) passa por
 * aqui, e não por uma segunda tradução: foi uma segunda conta, a `calcularParcela` sem anuais, que
 * fez o Apolo anunciar R$ 4.383,14 no Investidor Parcelado do Garden enquanto a Mesa dizia outro
 * número.
 */
export function planoDaTabela(plano: PlanoDoCadastro): PlanoDaTabela {
  return {
    anuaisQuantidade: plano.anuaisQuantidade ?? null,
    anuaisValor: plano.anuaisValor ?? null,
    descontoPercentual: plano.descontoPercentual ?? null,
    entradaPercentual: plano.entradaPercentual,
    parcelas: plano.parcelas,
    sistemaAmortizacao: sistemaDoCadastro(plano.sistemaAmortizacao),
    taxaAoMes: taxaMensal(plano),
  };
}

/**
 * A conferência de um plano do cadastro contra o preço de uma unidade: a MESMA conta da Mesa.
 *
 * Lucas (18/09/2026): *"tem que ser igual o mmendes"*. A aba de planos do Apolo conferia o plano com
 * `calcularParcela`, que não conhece anual: no Investidor Parcelado do Garden, lote de R$ 435.000,
 * o Apolo dizia R$ 4.383,14 e a Mesa outro número. Aqui é `condicaoDoPlano` (desconto, entrada com o
 * piso do empreendimento, anuais que cabem no prazo, parcela de `montarProposta`), e a natureza da
 * parcela ("inicial", "primeira", "fixa") continua vindo de `calcularParcela`, que é quem a define.
 */
export function conferenciaDoPlano(entrada: {
  entradaMinimaPercentual: null | number;
  plano: PlanoDoCadastro;
  precoDeTabela: number;
}): CondicaoDoPlano & { naturezaDaParcela: NaturezaDaParcela; parcelas: number } {
  return {
    ...condicaoDoPlano({
      entradaMinimaPercentual: entrada.entradaMinimaPercentual,
      plano: planoDaTabela(entrada.plano),
      precoDeTabela: entrada.precoDeTabela,
    }),
    naturezaDaParcela: calcularParcela(entrada.plano, null).naturezaDaParcela,
    parcelas: entrada.plano.parcelas,
  };
}

/**
 * O desconto do plano que VALE para o prazo que está na tela.
 *
 * ⚠️ O DESCONTO SÓ É "DO PLANO" NO PRAZO DO PLANO (18/09/2026). O Investidor do Garden dá 12% em
 * 36 parcelas com 40% de entrada. Sem esta régua, o coordenador escolhia o Investidor, trocava
 * Parcelas para 84, e a proposta saía com 12% de desconto em 84 vezes sem motivo escrito: a modal
 * tratava os 12% como tabela oficial, e o servidor aceitava porque a faixa de 84 é a do Investidor
 * Parcelado (8% de entrada). Fora do prazo do plano o desconto que está no campo é uma EXCEÇÃO,
 * como qualquer desconto à mão, e a `ModalDeProposta` pede a nota.
 *
 * Devolve o desconto do plano quando o prazo efetivo é o do plano, e zero quando não é.
 */
export function descontoDoPlanoNoPrazo(entrada: {
  descontoDoPlano: unknown;
  parcelasDoPlano: number;
  parcelasEfetivas: number;
}): number {
  const desconto = descontoDoPlano(entrada.descontoDoPlano);
  if (desconto === 0) return 0;
  return entrada.parcelasEfetivas === entrada.parcelasDoPlano ? desconto : 0;
}

/**
 * O menor preço que algum plano do empreendimento dá a este lote: a tabela com o MAIOR desconto de
 * plano cadastrado.
 *
 * ⚠️ É O PISO DO PREÇO NO ESPELHO PÚBLICO (18/09/2026). A página não tem login, e a rota do PDF da
 * simulação aceitava o valor que viesse no corpo: dava para baixar uma folha com a marca da casa
 * dizendo "Desconto 50%". Nenhum plano vende abaixo disto, então nenhuma simulação pode. Sem plano
 * com desconto, é a própria tabela.
 */
export function menorPrecoDePlano(
  precoDeTabela: number,
  planos: ReadonlyArray<{ descontoPercentual?: unknown }>,
): number {
  const maior = planos.reduce((m, p) => Math.max(m, descontoDoPlano(p.descontoPercentual)), 0);
  return precoNoPlano(precoDeTabela, maior);
}

/**
 * Os dois ajustes são o mesmo desconto? Mesma moeda e mesmo número; zero é zero em qualquer moeda.
 *
 * ⚠️ POR VALOR, E NÃO POR REFERÊNCIA: `ajusteDoPlano(8)` devolve um objeto novo a cada chamada, e
 * comparar com `===` diria que os 8% do plano não são os 8% do plano.
 */
export function mesmoAjuste(a: AjusteDePreco, b: AjusteDePreco): boolean {
  if (a.valor === 0 && b.valor === 0) return true;
  return a.modo === b.modo && a.valor === b.valor;
}

/**
 * O desconto que fica no campo quando o coordenador troca de plano.
 *
 * ⚠️ O DESCONTO DO PLANO VAI E VEM COM O PLANO. Escolher o Investidor Parcelado põe os 8% dele no
 * campo; voltar para o Normal (sem desconto) tira. É a tabela oficial mudando, não uma exceção.
 *
 * ⚠️ O DESCONTO À MÃO SÓ SOBREVIVE ENTRE PLANOS SEM DESCONTO, e é isso que mantém os outros
 * empreendimentos exatamente como eram: lá nenhum plano tem desconto, e o desconto que o coordenador
 * digitou continua de pé quando ele troca de plano, como sempre continuou. Quando o plano de saída
 * tinha desconto, o que está no campo nasceu dele (ou foi ajustado em cima dele), e levá-lo para um
 * plano que não dá desconto seria vender o Normal com o preço do Investidor.
 */
export function ajusteAoTrocarDePlano(entrada: {
  ajusteAtual: AjusteDePreco;
  descontoDoAnterior: unknown;
  descontoDoNovo: unknown;
}): AjusteDePreco {
  const novo = descontoDoPlano(entrada.descontoDoNovo);
  if (novo > 0) return ajusteDoPlano(novo);
  if (descontoDoPlano(entrada.descontoDoAnterior) > 0) return SEM_AJUSTE;
  return entrada.ajusteAtual;
}

/**
 * Sobre que preço o cartão de um plano é calculado — que é o preço que o clique nele vai carregar.
 *
 * ⚠️ O CARTÃO É O CLIQUE. `ajusteAoTrocarDePlano` decide o desconto que o clique deixa no campo, e
 * esta função devolve o preço de TABELA que produz aquele mesmo valor com o desconto do plano por
 * cima (`condicaoDoPlano`):
 *
 *   • plano com desconto: a tabela do lote (o clique troca o desconto pelo do plano);
 *   • plano sem desconto, saindo de um plano com desconto: a tabela (o clique zera o campo);
 *   • plano sem desconto, saindo de outro sem desconto: o valor que está na tela, com o desconto à
 *     mão que houver — exatamente o que o cartão sempre mostrou nos outros empreendimentos.
 */
export function precoDeTabelaDoCartao(entrada: {
  descontoDoAtivo: unknown;
  descontoDoPlano: unknown;
  valorDaUnidade: number;
  valorNaTela: number;
}): number {
  return descontoDoPlano(entrada.descontoDoPlano) > 0 ||
    descontoDoPlano(entrada.descontoDoAtivo) > 0
    ? entrada.valorDaUnidade
    : entrada.valorNaTela;
}

/**
 * O ajuste da proposta, comparado com o desconto do plano escolhido.
 *
 * ⚠️ O DESCONTO DO PLANO NÃO PEDE MOTIVO. Ele é a tabela oficial do empreendimento, cadastrada no
 * Apolo, e não uma exceção do coordenador. Só o que passa DELE é desconto que alguém precisa
 * explicar — e é a pergunta que a caixa de nota da `ModalDeProposta` faz.
 *
 *   • `"nenhum"`: sem ajuste.
 *   • `"do-plano"`: o valor negociado é exatamente a tabela com o desconto do plano.
 *   • `"desconto"`: abaixo disso (desconto além do plano, ou desconto num plano sem desconto).
 *   • `"acrescimo"`: acima disso (acréscimo, ou desconto menor que o do plano).
 *
 * ⚠️ PLANO SEM DESCONTO RESPONDE PELO SINAL DO AJUSTE, e não pelo preço: é a regra de antes
 * (`ajuste.valor < 0` é desconto), mantida ao pé da letra para os outros empreendimentos.
 */
export function ajusteFrenteAoPlano(entrada: {
  ajuste: AjusteDePreco | null | undefined;
  descontoDoPlanoPercentual: unknown;
  precoDeTabela: number;
  valorNegociado: number;
}): "acrescimo" | "desconto" | "do-plano" | "nenhum" {
  const { ajuste } = entrada;
  if (!ajuste || !Number.isFinite(ajuste.valor) || ajuste.valor === 0) return "nenhum";

  const desconto = descontoDoPlano(entrada.descontoDoPlanoPercentual);
  if (desconto === 0) return ajuste.valor < 0 ? "desconto" : "acrescimo";

  const doPlano = Math.round(
    aplicarAjuste(entrada.precoDeTabela, ajusteDoPlano(desconto)).valor * 100,
  );
  const negociado = Math.round(entrada.valorNegociado * 100);
  if (negociado === doPlano) return "do-plano";
  return negociado < doPlano ? "desconto" : "acrescimo";
}
