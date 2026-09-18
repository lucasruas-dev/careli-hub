// O QUE A ROTA PÚBLICA DO PDF DA SIMULAÇÃO ACEITA — preço, prazo, entrada e anuais, conferidos no
// servidor contra o PLANO escolhido.
//
// Revisão de 18/09/2026, com os planos do Garden ganhando desconto (0178): a rota do PDF do espelho
// público (`app/api/publico/espelho/simulacao`) aceitava o `valor` e a `entrada` que viessem no corpo,
// sem piso nenhum, numa página SEM LOGIN. Com o plano de desconto, a folha passou a imprimir "Valor de
// tabela" e "Desconto X%" calculados desse valor: qualquer pessoa com o link baixava uma folha com a
// marca da casa dizendo "Desconto 50%".
//
// ⚠️ A TELA NÃO É A ÚLTIMA PALAVRA. O simulador no modo simulação já prende o desconto ao do plano
// escolhido, no prazo do plano (`SimuladorDeProposta`, `ajusteDaTela`), mas o corpo da requisição é
// do cliente e se escreve à mão. Aqui o servidor refaz a MESMA régua da tela e da Mesa de Venda.
//
// ⚠️ O PISO DO PREÇO É O DO PLANO ESCOLHIDO, NO PRAZO DO CORPO (revisão 3, 18/09/2026). A primeira
// versão usava a tabela com o MAIOR desconto de QUALQUER plano do empreendimento, e um corpo forjado
// imprimia o NORMAL com "Desconto 12%" (o desconto do INVESTIDOR), o INVESTIDOR PARCELADO a
// R$ 382.800 (12%, e não os 8% dele) e o INVESTIDOR em 180 vezes com os 12% que ele só dá em 36.
// Agora o piso é a tabela com o desconto do plano escolhido quando o prazo é o do plano
// (`descontoDoPlanoNoPrazo`); fora do prazo do plano, desconto zero, e o piso é a própria tabela.
//
// ⚠️ E O PLANO MANDA NO RESTO TAMBÉM (revisão 3): a entrada não respeitava a escada da tabela (os
// 40% do INVESTIDOR); 10 anuais passavam num contrato de 36 meses e a folha imprimia as 10; e a
// entrada em vezes não tinha teto. A decisão de cada caso:
//
//   • VALOR, ENTRADA, QUANTIDADE DE ANUAIS E VEZES DA ENTRADA SE PRENDEM AO LIMITE, como a rota sempre
//     fez com o valor e o piso: são números dentro de uma condição que continua a mesma, e a tela
//     nunca produz o número fora (a entrada abaixo do mínimo ela marca em vermelho; as anuais e as
//     vezes da entrada ela nem deixa subir).
//   • O PRAZO FORA DO PLANO É RECUSADO (422), e não preso. O prazo é o que decide a condição inteira
//     (desconto, juros, entrada da faixa): prender 180 vezes do INVESTIDOR em 36 imprimiria uma folha
//     de 36 vezes com 40% de entrada para quem digitou 180, e ninguém veria a troca. A frase diz até
//     quantas parcelas o plano vai, e a tela a mostra ao lado do botão.
//
// ⚠️ A ENTRADA MÍNIMA É A MESMA RÉGUA DA TELA E DA MESA, E NÃO UMA TERCEIRA (revisão de 18/09/2026).
// A primeira versão da revisão 3 somava a entrada do PLANO ESCOLHIDO ao piso do empreendimento e à
// faixa do prazo. Nos empreendimentos em que a escada é irregular (um plano mais curto com entrada
// MENOR que a de um mais longo: 20, 29, 38 e 42) a tela aceitava a entrada sem o aviso "Abaixo do
// mínimo" e a folha saía com outra, maior, sem ninguém ver: 72 combinações de plano × prazo, como o
// Curto do 20 em 24 vezes (tela R$ 9.290, PDF R$ 18.580). A régua é a de `SimuladorDeProposta`
// (`pisoDoPrazo`) e a de `conferirProposta`, que recusa a proposta da Mesa: o piso do empreendimento
// e a faixa do prazo (`pisoDaEntradaNoPrazo`). No Garden a escada é regular, e a faixa já exige o
// que o plano exige (os 40% do INVESTIDOR em 36 vezes, os 10% do NORMAL em 60).

import { precoNoPlano } from "../ajuste-de-preco";
import { entradaMinima } from "../composicoes";
import { pisoDaEntradaNoPrazo } from "../faixa-do-plano";
import { ENTRADA_VEZES_MAXIMA } from "../proposta";
import { descontoDoPlanoNoPrazo } from "../tabela-do-lote";

/**
 * O que esta régua precisa saber do plano escolhido (é um recorte de `PlanoPublico`).
 *
 * ⚠️ SEM `entradaPercentual` DE PROPÓSITO: a entrada do plano escolhido não é régua sozinha. Quem
 * decide a entrada mínima é a faixa do prazo sobre TODOS os planos (`planos`, abaixo), como na tela.
 */
export type PlanoDaSimulacaoPublica = {
  anuaisQuantidade: number;
  anuaisValor: number;
  descontoPercentual?: unknown;
  nome: string;
  parcelas: number;
};

export type SimulacaoPublicaAceita = {
  anuais: { quantidade: number; valor: number };
  /** O desconto do plano que VALE para este prazo (zero fora do prazo do plano). */
  descontoPercentual: number;
  entrada: number;
  /** Em quantas vezes a entrada se divide, de 1 a `ENTRADA_VEZES_MAXIMA`. */
  entradaVezes: number;
  ok: true;
  parcelas: number;
  valor: number;
};

export type SimulacaoPublicaRecusada = { mensagem: string; ok: false };

/** Um número do corpo, em reais com centavos; lixo vira nulo. */
function reais(v: unknown): null | number {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Um inteiro do corpo; lixo, negativo ou ausente vira o padrão de quem chama. */
function inteiro(v: unknown, padrao: number): number {
  if (v === null || v === undefined || v === "") return padrao;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : padrao;
}

export function valoresDaSimulacaoPublica(entrada: {
  /** As anuais que vieram no corpo. Ausentes = as do plano. */
  anuaisPedidas?: { quantidade?: unknown; valor?: unknown };
  /** O piso do empreendimento (`pisoDeEntradaPublico`). Nulo = padrão da casa. */
  entradaMinimaPercentual: null | number;
  /** A entrada que veio no corpo. */
  entradaPedida: unknown;
  /** Em quantas vezes o corpo pediu a entrada. Ausente, zero ou lixo = à vista (1). */
  entradaVezesPedidas?: unknown;
  /** O prazo que veio no corpo. Ausente, zero ou lixo = o prazo do plano. */
  parcelasPedidas?: unknown;
  /** O plano escolhido, lido do banco. */
  plano: PlanoDaSimulacaoPublica;
  /** Todos os planos do empreendimento: a escada de prazo que decide a entrada da faixa. */
  planos: ReadonlyArray<{
    entradaPercentual: number;
    nome: string;
    parcelas: number;
  }>;
  /** A tabela do lote, lida do banco. */
  precoDeTabela: number;
  /** O valor que veio no corpo. Ausente = a tabela. */
  valorPedido: unknown;
}): SimulacaoPublicaAceita | SimulacaoPublicaRecusada {
  const { plano, precoDeTabela } = entrada;

  // ── O prazo: dentro do plano, ou recusa ──
  //
  // ⚠️ ZERO É "O PRAZO DO PLANO", como o campo em branco na tela (`prazoDaFaixa`): nenhum contrato
  // tem zero parcelas, e a tela nunca manda zero.
  const pedidas = inteiro(entrada.parcelasPedidas, plano.parcelas);
  const parcelas = pedidas >= 1 ? pedidas : plano.parcelas;
  if (parcelas > plano.parcelas) {
    return {
      mensagem: `O plano ${plano.nome} vai até ${plano.parcelas} parcelas. Para um prazo maior, escolha outro plano.`,
      ok: false,
    };
  }

  // ── O preço: entre a tabela com o desconto do plano NO PRAZO e a tabela ──
  const descontoPercentual = descontoDoPlanoNoPrazo({
    descontoDoPlano: plano.descontoPercentual,
    parcelasDoPlano: plano.parcelas,
    parcelasEfetivas: parcelas,
  });
  const piso = precoNoPlano(precoDeTabela, descontoPercentual);
  const pedido = reais(entrada.valorPedido);
  const valor = Math.min(
    precoDeTabela,
    Math.max(piso, pedido !== null && pedido > 0 ? pedido : precoDeTabela),
  );

  // ── As anuais: até um por aniversário do prazo ──
  //
  // ⚠️ O TETO É `floor(prazo ÷ 12)`, o mesmo do contador da tela e de `anuaisDoPlano`: um reforço por
  // aniversário que cabe no prazo. Como o prazo já não passa do plano, o teto também não passa do que
  // o plano permite.
  const teto = Math.floor(parcelas / 12);
  const quantidade = Math.min(
    teto,
    inteiro(entrada.anuaisPedidas?.quantidade, plano.anuaisQuantidade),
  );
  const anuais =
    quantidade > 0
      ? {
          quantidade,
          valor: inteiro(entrada.anuaisPedidas?.valor, plano.anuaisValor),
        }
      : { quantidade: 0, valor: 0 };

  // ── A entrada: o piso da tela, e nunca acima do valor ──
  //
  // ⚠️ O MAIOR ENTRE O PISO DO EMPREENDIMENTO E A ENTRADA DA FAIXA DO PRAZO, a chamada IGUAL à do
  // `pisoDoPrazo` do simulador e à de `conferirProposta` (ver o cabeçalho): o que a tela aceita sem o
  // aviso vermelho é o que a folha imprime. A faixa é a escada da tabela: o INVESTIDOR do Garden em
  // 36 vezes exige os 40% dele, e o INVESTIDOR PARCELADO encurtado para 50 vezes cai no degrau do
  // NORMAL (10%). Tudo sobre o valor já com o desconto do plano, como a MMendes (`pd × entMin`).
  const minima = pisoDaEntradaNoPrazo({
    parcelas,
    pisoDaCasaEmReais: entradaMinima(valor, entrada.entradaMinimaPercentual),
    planos: [...entrada.planos],
    valorNegociado: valor,
  }).emReais;
  const entradaPedida = reais(entrada.entradaPedida) ?? 0;

  // ── As vezes da entrada: de 1 ao teto do contador da tela ──
  //
  // ⚠️ O NÚMERO NÃO CHEGA CRU AO CRONOGRAMA. Sem teto, 240 vezes imprimiam a primeira mensal 20 anos
  // depois, com o financiado esperando sem juros, e 10.000.000 esgotavam a memória do processo antes
  // de chegar ao PDF. Preso como as anuais: a tela para em `ENTRADA_VEZES_MAXIMA`, então só um corpo
  // escrito à mão passa daqui, e ele recebe a folha no teto. Lixo, zero ou negativo é à vista.
  const vezes = inteiro(entrada.entradaVezesPedidas, 1);
  const entradaVezes = Math.min(ENTRADA_VEZES_MAXIMA, Math.max(1, vezes));

  return {
    anuais,
    descontoPercentual,
    entrada: Math.min(valor, Math.max(minima, entradaPedida)),
    entradaVezes,
    ok: true,
    parcelas,
    valor,
  };
}
