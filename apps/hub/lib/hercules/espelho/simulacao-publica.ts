// O QUE A ROTA PÚBLICA DO PDF DA SIMULAÇÃO ACEITA — preço, prazo, entrada e anuais, conferidos no
// servidor contra o PLANO escolhido.
//
// Revisão de 18/09/2026, com os planos do Garden ganhando desconto (0178): a rota do PDF do espelho
// público (`app/api/publico/espelho/simulacao`) aceitava o `valor` e a `entrada` que viessem no corpo,
// sem piso nenhum, numa página SEM LOGIN. Com o plano de desconto, a folha passou a imprimir "Valor de
// tabela" e "Desconto X%" calculados desse valor: qualquer pessoa com o link baixava uma folha com a
// marca da casa dizendo "Desconto 50%".
//
// ⚠️ A TELA NÃO É A ÚLTIMA PALAVRA. O corpo da requisição é do cliente e se escreve à mão, numa
// página SEM LOGIN. Aqui o servidor refaz a régua em cima do que o cadastro diz.
//
// ⚠️ O PREÇO DEIXOU DE SER PRESO AO DESCONTO DO PLANO EM 23/09/2026, E ISSO É DECISÃO TOMADA, COM O
// RISCO POSTO. Lucas: *"sabe aquela parte do desconto que incluimos no comercial, vamos colocar para
// cecilio também"* e, perguntado como fazer, com as três opções e o risco escrito em cada uma:
// **"Liberar para todo mundo"**. Qualquer pessoa com o link `/e/<apelido>-<selo>` passa a poder
// ajustar o preço e baixar uma folha com a marca da casa e o desconto que ela mesma escolheu.
//
// ⚠️ ISTO REABRE, DE PROPÓSITO, O BURACO QUE A REVISÃO DE 18/09/2026 FECHOU, e está escrito aqui
// para que ninguém o feche de novo sem saber. O que a revisão 3 fazia era prender o preço no piso do
// PLANO ESCOLHIDO, no prazo do corpo (`descontoDoPlanoNoPrazo`); com o campo de desconto liberado na
// tela (`SimuladorDeProposta`), prender aqui viraria o pior dos mundos: a tela mostrando R$ 391.500
// e a folha imprimindo R$ 400.200, em silêncio, depois do clique. É a MESMA família do item 4 do
// Lucas de 22/09 (*"mesmo eu alterando o valor de entrada (...) ele não traz o valor que eu tinha
// colocado"*), agora no preço, e um número trocado sem aviso é pior do que não ter a função.
//
// ⚠️ E A PERMUTA ENTROU JUNTO, NO MESMO DIA. Eu havia escrito aqui que ela ficaria de fora, porque
// permuta é negociação e o espelho é vitrine; Lucas, lendo isso: *"permuta tem que entrar, não
// entendi sua colocação"*. A separação era MINHA, não dele. O corpo passa a trazer `bensPedidos`, e
// eles abatem o saldo no cronograma e saem impressos na folha — conferidos pela MESMA função da
// rota da proposta (`conferirBensEPermutasDoCorpo`), e não por uma cópia frouxa deste lado.
//
// ⚠️ O QUE ATENUA, E QUE NÃO PODE SER REMOVIDO, É A FRASE QUE A FOLHA CARREGA: "não
// constitui proposta, não reserva a unidade e não
// vincula as partes" (`proposta-para-pdf.ts`, bandeira `simulacao`), mais a tarja de prévia. Com o
// preço E os bens livres, essa frase é a única coisa entre um número inventado e um papel com cara
// de oferta: quem mexer nela está mexendo na última proteção que sobrou.
//
// ⚠️ E O PLANO MANDA NO RESTO TAMBÉM (revisão 3): a entrada não respeitava a escada da tabela (os
// 40% do INVESTIDOR); 10 anuais passavam num contrato de 36 meses e a folha imprimia as 10; e a
// entrada em vezes não tinha teto. A decisão de cada caso:
//
//   • VALOR, ENTRADA, QUANTIDADE DE ANUAIS E VEZES DA ENTRADA SE PRENDEM AO LIMITE, como a rota sempre
//     fez com o valor e o piso: são números dentro de uma condição que continua a mesma, e a tela
//     nunca produz o número fora (a entrada abaixo do mínimo ela marca em vermelho; as anuais e as
//     vezes da entrada ela nem deixa subir).
//     ⚠️ A ENTRADA SAIU DESTA LISTA EM 22/09/2026. A premissa "a tela nunca produz o número fora"
//     era FALSA para ela: a tela marca em vermelho e DEIXA SEGUIR, e prender aqui trocava o número
//     do corretor em silêncio (ver a decisão inteira junto do `return`, no fim do arquivo).
//   • O PRAZO FORA DO PLANO É RECUSADO (422), e não preso. O prazo é o que decide a condição inteira
//     (desconto, juros, entrada da faixa): prender 180 vezes do INVESTIDOR em 36 imprimiria uma folha
//     de 36 vezes com 40% de entrada para quem digitou 180, e ninguém veria a troca. A frase diz até
//     quantas parcelas o plano vai, e a tela a mostra ao lado do botão.
//
// ⚠️ A ENTRADA MÍNIMA É A MESMA RÉGUA DA TELA E DA MESA, E NÃO UMA TERCEIRA (revisão de 18/09/2026).
// ⚠️ DESDE 22/09/2026 ELA É A SUGESTÃO DE QUEM NÃO MANDOU ENTRADA NENHUMA, e não mais um piso que
// prende: o parágrafo abaixo continua valendo para decidir QUAL número sugerir, e é só isso que ele
// decide. "Não mandou" é a chave AUSENTE (ou nula, vazia, lixo, negativa) — coisa que só um corpo
// escrito à mão produz. ZERO É UMA ESCOLHA e vai ao papel como zero: é o campo apagado na tela, e a
// tela já calcula e imprime a composição inteira com ele.
// A primeira versão da revisão 3 somava a entrada do PLANO ESCOLHIDO ao piso do empreendimento e à
// faixa do prazo. Nos empreendimentos em que a escada é irregular (um plano mais curto com entrada
// MENOR que a de um mais longo: 20, 29, 38 e 42) a tela aceitava a entrada sem o aviso "Abaixo do
// mínimo" e a folha saía com outra, maior, sem ninguém ver: 72 combinações de plano × prazo, como o
// Curto do 20 em 24 vezes (tela R$ 9.290, PDF R$ 18.580). A régua é a de `SimuladorDeProposta`
// (`pisoDoPrazo`) e a de `conferirProposta`, que recusa a proposta da Mesa: o piso do empreendimento
// e a faixa do prazo (`pisoDaEntradaNoPrazo`). No Garden a escada é regular, e a faixa já exige o
// que o plano exige (os 40% do INVESTIDOR em 36 vezes, os 10% do NORMAL em 60).

import { precoNoPlano } from "../ajuste-de-preco";
import {
  type BemOuPermuta,
  conferirBensEPermutasDoCorpo,
} from "../bens-e-permutas";
import { entradaMinima } from "../composicoes";
import { pisoDaEntradaNoPrazo } from "../faixa-do-plano";
import { ENTRADA_VEZES_MAXIMA } from "../proposta";
import { descontoDoPlanoNoPrazo } from "../tabela-do-lote";

/**
 * O desconto máximo que a folha da simulação pode anunciar, em percentual do preço de tabela.
 *
 * ⚠️ SEM TETO NENHUM, UM CORPO ESCRITO À MÃO PEDE 99% E A FOLHA SAI COM O LOTE DE R$ 435.000 A
 * R$ 4.350, com a logo do empreendimento no topo e a marca do C2X no rodapé. A página não tem login:
 * o número que chega aqui não passou por pessoa nenhuma da casa.
 *
 * ⚠️ O TETO FOI REMOVIDO EM 23/09/2026, POR DECISÃO EXPLÍCITA, e a constante fica só para quem
 * precisar do número que já valeu. Medido no banco naquele dia: `temis_planos` tinha 37 planos
 * ativos e só DOIS com desconto de tabela, 12% e 8%; e das 4.947 linhas de `hercules_propostas`,
 * UMA tinha desconto à mão, de 10%. O teto de 15% cobria tudo isso com folga. O Lucas, perguntado
 * com o risco na frente, respondeu *"Liberar para todo mundo"* e *"pode liberar tudo"*, e a régua
 * saiu. Quem for repor um teto aqui está desfazendo uma decisão, não consertando um esquecimento.
 */
export const DESCONTO_MAXIMO_DA_SIMULACAO = 15;

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
  /**
   * Os bens e permutas do corpo, já conferidos item a item. Lista vazia = simulação só em dinheiro.
   *
   * ⚠️ ELES ENTRAM NA CONTA DO CRONOGRAMA E NA FOLHA (23/09/2026). Lucas, depois de eu escrever que
   * permuta ficaria fora do espelho porque é negociação e não vitrine: *"permuta tem que entrar, não
   * entendi sua colocação"*. A separação era minha, não dele.
   */
  bens: BemOuPermuta[];
  /** O desconto do plano que VALE para este prazo (zero fora do prazo do plano). */
  descontoPercentual: number;
  entrada: number;
  /**
   * Os valores das parcelas da entrada montadas à mão, ou nulo para a divisão igual de sempre.
   *
   * É o que `montarCronograma` recebe em `entradaParcelas`. Só sai daqui a lista que FECHA com a
   * entrada aceita — ver `parcelasDaEntradaAceitas`, no fim do arquivo.
   */
  entradaParcelas: null | number[];
  /**
   * A data escolhida à mão para cada parcela da entrada, ou nulo quando ninguém escolheu nenhuma.
   *
   * `AAAA-MM-DD` ou nulo em cada posição, como `montarCronograma` espera em `entradaDatas`: nulo é
   * "a data calculada", que continua sendo o estado normal.
   */
  entradaDatas: null | (null | string)[];
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

/**
 * Reais em centavos inteiros.
 *
 * ⚠️ TODA COMPARAÇÃO DE PREÇO PASSA POR AQUI. `435000 * 0.85` em ponto flutuante dá
 * 369749.99999999994, e o teto recusaria o próprio número que ele acabou de calcular.
 */
function emCentavos(v: number): number {
  return Math.round(v * 100);
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
  /**
   * Os bens e permutas que vieram no corpo. Ausentes ou nulos = simulação só em dinheiro.
   *
   * Conferidos por `conferirBensEPermutasDoCorpo`, A MESMA função da rota da proposta — ver a nota
   * na régua, mais abaixo.
   */
  bensPedidos?: unknown;
  /** O piso do empreendimento (`pisoDeEntradaPublico`). Nulo = padrão da casa. */
  entradaMinimaPercentual: null | number;
  /**
   * As datas escolhidas para as parcelas da entrada, quando alguém escolheu alguma.
   *
   * Ausente, nula ou só de nulos = as datas calculadas. Ver `datasDaEntradaAceitas`.
   */
  entradaDatasPedidas?: unknown;
  /**
   * As parcelas da entrada montadas à mão, quando a tela as montou.
   *
   * Ausente ou nulo = a divisão igual de sempre. Ver `parcelasDaEntradaAceitas`.
   */
  entradaParcelasPedidas?: unknown;
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

  // ── Os bens e permutas: a MESMA conferência da rota da proposta ──
  //
  // ⚠️ A RÉGUA DE RECUSA É UMA SÓ, E POR ISSO ELA É IMPORTADA, E NÃO REESCRITA AQUI
  // (`conferirBensEPermutasDoCorpo`, em `lib/hercules/bens-e-permutas.ts`). Uma segunda cópia é
  // como o quadro do contrato ganhou a própria soma e imprimiu R$ 2.000.080.000.100.000,00 embaixo
  // de uma cláusula que dizia R$ 0,00 (medido em 22/09/2026). Aqui a cópia seria pior ainda: a
  // conferência frouxa ficaria justamente do lado SEM LOGIN.
  //
  // ⚠️ E VALOR VAZIO É ERRO, NUNCA ZERO. `Number("")` é 0, e nesta casa isso já virou cobrança de
  // R$ 0,00 emitida; no papel público viraria uma permuta de zero reais impressa como se tivesse
  // sido combinada com alguém.
  //
  // ⚠️ A RECUSA É A PRIMEIRA FRASE, E NÃO A LISTA DE CAMPOS. A rota da proposta devolve `campo` +
  // `mensagem` porque a Mesa de Venda pinta o input de vermelho pelo caminho do JSON; o espelho tem
  // uma linha só de erro embaixo do botão (`erroDoPdf`, em `EspelhoPublico`), e ela precisa dizer
  // QUAL item está incompleto — é o que a frase já faz, com a posição dentro dela.
  const bens = conferirBensEPermutasDoCorpo(entrada.bensPedidos);
  if (bens.erros.length > 0) {
    return { mensagem: bens.erros[0]!.mensagem, ok: false };
  }

  // ── O preço: o que a tela escolheu, entre o teto de desconto e a tabela ──
  //
  // ⚠️ O NÚMERO DA TELA PASSA INTEIRO, ATÉ O CENTAVO, e fora da banda a resposta é RECUSA, nunca um
  // número trocado (ver o cabeçalho). Prender aqui faria a folha desmentir a tela em silêncio; a
  // recusa, pelo menos, o visitante lê antes de encaminhar o papel para alguém.
  const descontoPercentual = descontoDoPlanoNoPrazo({
    descontoDoPlano: plano.descontoPercentual,
    parcelasDoPlano: plano.parcelas,
    parcelasEfetivas: parcelas,
  });
  // ⚠️ O MENOR ENTRE O TETO E O PREÇO DO PRÓPRIO PLANO. Hoje o maior desconto cadastrado é 12% e o
  // teto é 15%, então quem manda é o teto; mas no dia em que alguém cadastrar um plano de 20% o
  // simulador não pode recusar a folha do preço que a casa vende — seria a régua negando a tabela.
  // ⚠️ NÃO EXISTE MAIS PISO DE DESCONTO, E FOI DECISÃO DO LUCAS, NÃO ESQUECIMENTO. Perguntado em
  // 23/09/2026, com o risco escrito na frente (qualquer pessoa com o link imprimindo uma folha com
  // a marca da casa e o desconto que ela mesma escolher), ele respondeu *"Liberar para todo mundo"*
  // e, sobre o teto, *"pode liberar tudo"*. O que segura a folha continua sendo o texto que ela
  // carrega: não constitui proposta, não reserva a unidade e não vincula as partes. E a VENDA não
  // passa por aqui: quem protege a proposta é `conferirProposta`, com login.
  const piso = 0;
  const pedido = reais(entrada.valorPedido);
  // Lixo, ausente, nulo, vazio, negativo ou zero é "não mandou valor", e vale a tabela: só um corpo
  // escrito à mão produz qualquer um deles, porque a tela sempre manda o número que está no campo.
  const valor = pedido !== null && pedido > 0 ? pedido : precoDeTabela;
  if (emCentavos(valor) <= emCentavos(piso)) {
    return {
      mensagem: "Informe o valor da unidade para simular.",
      ok: false,
    };
  }
  // ⚠️ ACIMA DA TABELA TAMBÉM É RECUSA, E NÃO UMA DESCIDA SILENCIOSA ATÉ ELA (23/09/2026). Até aqui
  // o valor acima era preso na tabela, e isso era inofensivo porque a tela do espelho NÃO TINHA como
  // produzir um número maior: o campo era somente leitura. Com o campo liberado, o botão de
  // ACRÉSCIMO passou a estar à mão de qualquer visitante, e prender devolveria exatamente a troca
  // silenciosa que esta rodada veio matar, só que para o outro lado.
  if (emCentavos(valor) > emCentavos(precoDeTabela)) {
    return {
      mensagem: "Esta simulação não passa do valor de tabela da unidade. Para um valor maior, fale com o corretor.",
      ok: false,
    };
  }

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

  // ── A entrada: a que veio da tela, e nunca acima do valor ──
  //
  // A SUGESTÃO, para quem não escolheu entrada nenhuma: o maior entre o piso do empreendimento e a
  // entrada da faixa do prazo, a chamada IGUAL à do `pisoDoPrazo` do simulador e à de
  // `conferirProposta` (ver o cabeçalho). A faixa é a escada da tabela: o INVESTIDOR do Garden em 36
  // vezes sugere os 40% dele, e o INVESTIDOR PARCELADO encurtado para 50 vezes cai no degrau do
  // NORMAL (10%). Tudo sobre o valor já com o desconto do plano, como a MMendes (`pd × entMin`).
  const sugerida = pisoDaEntradaNoPrazo({
    parcelas,
    pisoDaCasaEmReais: entradaMinima(valor, entrada.entradaMinimaPercentual),
    planos: [...entrada.planos],
    valorNegociado: valor,
  }).emReais;
  const entradaPedida = reais(entrada.entradaPedida);

  // ── As vezes da entrada: de 1 ao teto do contador da tela ──
  //
  // ⚠️ O NÚMERO NÃO CHEGA CRU AO CRONOGRAMA. Sem teto, 240 vezes imprimiam a primeira mensal 20 anos
  // depois, com o financiado esperando sem juros, e 10.000.000 esgotavam a memória do processo antes
  // de chegar ao PDF. Preso como as anuais: a tela para em `ENTRADA_VEZES_MAXIMA`, então só um corpo
  // escrito à mão passa daqui, e ele recebe a folha no teto. Lixo, zero ou negativo é à vista.
  const vezes = inteiro(entrada.entradaVezesPedidas, 1);
  const entradaVezes = Math.min(ENTRADA_VEZES_MAXIMA, Math.max(1, vezes));

  // ⚠️ A ENTRADA DIGITADA VAI AO PAPEL COMO ESTÁ, E NÃO PRESA NO MÍNIMO (22/09/2026). Até aqui esta
  // linha era `Math.max(minima, entradaPedida)`, e o PDF trocava o número do corretor em silêncio,
  // depois do clique: medido no print do Lucas, Quadra 03 · Lote 07 do Cecílio Rocha com R$ 10.000
  // digitados (a tela avisando "Abaixo do mínimo de 8% (R$ 34.592)" e deixando seguir) saía impresso
  // com ENTRADA R$ 34.592, financiado R$ 297.808 e parcela R$ 3.545,33, no lugar dos R$ 322.400 e
  // R$ 3.838,10 que estavam na tela. O corretor mostra uma conta e entrega outra pelo WhatsApp, e
  // ninguém percebe a troca até o cliente cobrar a parcela que ele viu. Lucas: *"na cecilio pode
  // deixar tudo liberado, sem trava, somente com alertas (...) somente garante essa visão"*.
  //
  // ⚠️ AFROUXAR AQUI NÃO AFROUXA A VENDA, e é por isso que dá para fazer: esta régua é só da
  // SIMULAÇÃO do espelho, a folha que sai com a tarja de prévia e a frase "não constitui proposta,
  // não reserva a unidade e não vincula as partes". Quem protege a venda é `conferirProposta`
  // (`lib/hercules/proposta.ts`), na rota `api/incorporador/venda/proposta`, e lá a entrada mínima
  // continua RECUSANDO — são duas funções, dois chamadores, e nenhum dos dois passa pelo outro.
  //
  // ⚠️ E NÃO HÁ MAIS TETO DE PREÇO (23/09/2026, decisão do Lucas): qualquer desconto passa, e o
  // que a folha carrega é a frase de que não vincula. O que continua recusado é preço ACIMA da
  // tabela, porque isso não é desconto, é a página anunciando a unidade mais cara do que a casa
  // vende. Entrada não é preço: ela só reparte o mesmo total entre o ato e as mensais.
  //
  // ⚠️ ZERO É UMA ESCOLHA, E NÃO "NÃO ESCOLHI" (22/09/2026). Até aqui a condição era
  // `entradaPedida > 0`, e a justificativa escrita nesta linha dizia que "a tela trata campo vazio
  // como ainda não escolhi". Medido em `SimuladorDeProposta.tsx`, é FALSO: apagar o campo faz
  // `cockpit.entrada = 0`, `conferirEntradaMontada` devolve `entrada: 0`, o cartão grande imprime
  // "Entrada R$ 0,00" e sobe `entradaValor: 0` no pedido do PDF. Com os números do print do Lucas
  // (Cecílio Rocha, R$ 432.400, INVESTIDOR PARCELADO em 84x, 4 anuais de R$ 25.000) a tela mostrava
  // entrada R$ 0,00, a financiar R$ 332.400 e parcela R$ 3.957,14, e o papel saía com R$ 34.592,
  // R$ 297.808 e R$ 3.545,33 — a MESMA troca silenciosa do item 4 dele, e a pior de todas, porque
  // em zero a tela nem pintava o aviso vermelho (`abaixoDoMinimo` exigia `valor > 0`; isso também
  // foi corrigido, e agora o zero acusa "Abaixo do mínimo" com o botão "usar o mínimo").
  //
  // ⚠️ A TELA NUNCA OMITE A CHAVE: ela sempre manda um número. Só um corpo escrito à mão manda
  // ausente, nulo, vazio, lixo ou negativo — e para ESSES a sugestão continua sendo a resposta
  // certa, porque não há tela nenhuma dizendo o contrário. `reais` devolve nulo para todos eles,
  // e é essa a fronteira entre "escolheu zero" e "não mandou entrada".
  //
  // ⚠️ O TETO NO VALOR FICA, E É SANIDADE, NÃO RÉGUA COMERCIAL: entrada maior que o valor faz
  // `montarCronograma` quebrar, e a folha não sairia de jeito nenhum.
  const entradaAceita = Math.min(
    valor,
    entradaPedida !== null ? entradaPedida : sugerida,
  );

  return {
    anuais,
    bens: bens.lista,
    descontoPercentual,
    entrada: entradaAceita,
    entradaDatas: datasDaEntradaAceitas(
      entrada.entradaDatasPedidas,
      entradaVezes,
    ),
    entradaParcelas: parcelasDaEntradaAceitas(
      entrada.entradaParcelasPedidas,
      entradaAceita,
      entradaVezes,
    ),
    entradaVezes,
    ok: true,
    parcelas,
    valor,
  };
}

/**
 * As parcelas da entrada montadas à mão, quando elas fecham com a entrada aceita.
 *
 * ⚠️ É O SEGUNDO "DIGITEI E NÃO FOI PARA O PAPEL" (22/09/2026). O botão "montar valores" aparece no
 * espelho público sempre que a entrada tem mais de uma parcela (`SimuladorDeProposta.tsx`), e o
 * cartão grande passa a anunciar "4× · 1ª de R$ 10.000". O corpo do PDF não levava a lista, e a
 * folha saía com a divisão igual: quem montou 10.000 + 7.000 + 7.000 + 7.000 encaminhava um papel
 * dizendo 4 × R$ 7.750. Mesma família do item 4 do Lucas, mesmo remédio.
 *
 * ⚠️ E A LISTA SÓ VALE SE FECHAR COM A ENTRADA QUE A FOLHA VAI IMPRIMIR. A folha traz a entrada no
 * destaque E o fluxo linha a linha: uma lista que soma outra coisa faria o cabeçalho brigar com o
 * próprio fluxo, no papel que vai ao cliente. Quando não fecha, a resposta é a divisão igual de
 * sempre — que sempre soma a entrada por construção —, e não uma recusa: a página não tem login, o
 * corpo se escreve à mão, e derrubar o PDF por causa de uma lista estranha só castigaria o visitante
 * honesto cuja tela mandou a montagem de um estado anterior.
 *
 * ⚠️ A COMPARAÇÃO É EM CENTAVOS INTEIROS, como em `conferirEntradaMontada`: 3.333,33 × 3 dá
 * 9.999,989999999998 em ponto flutuante, e a divisão mais comum entre três parcelas seria recusada.
 */
function parcelasDaEntradaAceitas(
  pedidas: unknown,
  entradaAceita: number,
  entradaVezes: number,
): null | number[] {
  if (!Array.isArray(pedidas) || pedidas.length !== entradaVezes) return null;

  const valores: number[] = [];
  for (const bruto of pedidas) {
    const v = reais(bruto);
    // Zero no meio da lista não é montagem: é a tela em preenchimento, e `montarCronograma`
    // descarta a linha, deixando a entrada somando menos do que o destaque anuncia.
    if (v === null || v <= 0) return null;
    valores.push(v);
  }

  const soma = valores.reduce((total, v) => total + Math.round(v * 100), 0);
  return soma === Math.round(entradaAceita * 100) ? valores : null;
}

/**
 * As datas escolhidas à mão para as parcelas da entrada.
 *
 * ⚠️ O CAMPO DE DATA FICA VISÍVEL NO ESPELHO PÚBLICO, ao contrário do bloco "Cobrança". O dia de
 * vencimento e a data da primeira mensal somem no modo simulação, a pedido do Lucas (*"tira essa
 * coisa de vencimento (...) como é um simulador"*), mas a data de CADA PARCELA DA ENTRADA aparece
 * junto com a montagem, e sem ela no corpo o corretor escolhia "a segunda cai em janeiro" e a folha
 * agendava outro mês. A data da entrada ainda empurra a primeira mensal (`montarCronograma`), então
 * o fluxo inteiro saía diferente do que estava na tela: é a mesma queixa do item 4, num terceiro
 * campo.
 *
 * ⚠️ SÓ `AAAA-MM-DD` DE VERDADE PASSA, e a lista inteira cai junto quando uma posição não é data.
 * Um campo pela metade ("2026-1") viraria vencimento, e a folha pública se escreve à mão. A
 * conferência é a do calendário, e não só a do formato: "2026-02-31" é formato válido e dia
 * nenhum, e `Date` o empurraria para março sem avisar.
 *
 * Lista só de nulos devolve nulo: ninguém escolheu nada, e as datas calculadas continuam valendo.
 *
 * ⚠️ LISTA MAIS CURTA QUE `entradaVezes` VALE, E LISTA MAIOR NÃO (22/09/2026). Até aqui a régua
 * exigia `length === entradaVezes` e jogava fora a lista INTEIRA quando o tamanho não batia. Medido
 * em `SimuladorDeProposta.tsx`, o tamanho quase nunca bate: `datasDaEntradaCruas` nasce `[]` e o
 * `onChange` do campo de data só faz a lista crescer até a posição tocada
 * (`while (proxima.length <= i) proxima.push(null)`). Nada a completa até `entradaVezes`. Quem
 * escolhe a data da 2ª de 4 parcelas sobe `entradaVezes: 4` com `entradaDatas: [null, "2026-12-20"]`
 * (tamanho 2), a régua devolvia nulo e a folha agendava a data CALCULADA: o corretor escolhia uma
 * data, via a data escolhida na tela e o papel saía com outra. É o item 4 do Lucas num terceiro
 * campo (*"mesmo eu alterando o valor... quando eu mando para PDF ele não traz o valor que eu tinha
 * colocado"*), e a Mesa nunca teve esse defeito: a rota da proposta só mapeia a lista e deixa o
 * cronograma decidir posição a posição.
 *
 * ⚠️ OS DOIS CASOS SÃO DIFERENTES DE VERDADE, e por isso só um afrouxou:
 *
 *   • CURTA É A TELA NORMAL. As posições ausentes são as que ninguém tocou, e "não tocada" já quer
 *     dizer "a data calculada" em toda posição nula do meio da lista. Completar com nulo até
 *     `entradaVezes` diz exatamente a mesma coisa, e nenhuma data inventada entra no papel.
 *   • MAIOR É ESTADO VELHO, de uma simulação com MAIS parcelas que a de agora. As datas de lá foram
 *     escolhidas para um arranjo que não existe mais, e casá-las por posição com o arranjo de agora
 *     agendaria a entrada por um combinado que ninguém fez. A resposta certa continua sendo a lista
 *     inteira fora, e as datas calculadas de volta.
 *
 * ⚠️ E O TETO DE VEZES CONTINUA VALENDO POR TABELA: `entradaVezes` já chega preso em
 * `ENTRADA_VEZES_MAXIMA`, então 200 datas num corpo escrito à mão caem como lista maior.
 */
function datasDaEntradaAceitas(
  pedidas: unknown,
  entradaVezes: number,
): null | (null | string)[] {
  if (!Array.isArray(pedidas) || pedidas.length > entradaVezes) return null;

  const datas: (null | string)[] = [];
  for (const bruto of pedidas) {
    if (bruto === null || bruto === undefined || bruto === "") {
      datas.push(null);
      continue;
    }
    if (typeof bruto !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(bruto))
      return null;
    // O dia existe no calendário? `toISOString` devolve o mesmo texto só quando existe.
    const data = new Date(`${bruto}T00:00:00Z`);
    if (Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== bruto)
      return null;
    datas.push(bruto);
  }

  // As posições que a tela nunca tocou: nulo é "a data calculada", como em toda posição do meio.
  while (datas.length < entradaVezes) datas.push(null);

  return datas.some((d) => d !== null) ? datas : null;
}
