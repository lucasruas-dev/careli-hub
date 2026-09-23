import { describe, expect, it } from "vitest";

import {
  DESCONTO_MAXIMO_DA_SIMULACAO,
  valoresDaSimulacaoPublica,
} from "./simulacao-publica";

// O PREÇO AJUSTADO DA TELA PASSA, ATÉ UM TETO (23/09/2026).
//
// Lucas: *"sabe aquela parte do desconto que incluimos no comercial, vamos colocar para cecilio
// também"* e, perguntado como, com as três opções e o risco escrito em cada uma: **"Liberar para
// todo mundo"**.
//
// ⚠️ ATÉ AQUI A RÉGUA PRENDIA O PREÇO NO DESCONTO DO PLANO (revisão 3, 18/09/2026), e com o campo
// liberado na tela isso viraria o pior dos mundos: a tela mostrando 391.500 e a folha imprimindo
// 400.200, em silêncio, depois do clique. É a MESMA família do item 4 do Lucas de 22/09 (*"mesmo eu
// alterando o valor de entrada (...) ele não traz o valor que eu tinha colocado"*), agora no preço.
//
// ⚠️ E O TETO SAIU NO MESMO DIA, POR DECISÃO DELE, E NÃO POR ESQUECIMENTO. Eu havia posto um teto
// de 15% e escrito aqui o que ele evitava: um corpo com 99% de desconto sai com o lote de
// R$ 435.000 a R$ 4.350, numa folha com a marca da casa. Perguntado com esse risco na frente,
// Lucas: **"pode liberar tudo"**. Medido em 23/09/2026 antes de tirar: `temis_planos` tinha 37
// planos ativos e só DOIS com desconto de tabela (12% e 8%), e das 4.947 linhas de
// `hercules_propostas` UMA tinha desconto à mão, de 10% — o teto cobria tudo isso com folga, e
// ainda assim saiu. `DESCONTO_MAXIMO_DA_SIMULACAO` sobrou só como registro do número que já valeu.
//
// ⚠️ O QUE CONTINUA DE PÉ, E É O QUE ESTE ARQUIVO GUARDA AGORA: preço ACIMA da tabela é recusa
// (anunciar a unidade mais cara do que a casa vende não é desconto), lixo/negativo/zero continuam
// sendo "não mandou valor", e a folha continua carregando a frase de que não vincula.

const NORMAL = {
  anuaisQuantidade: 5,
  anuaisValor: 25_000,
  descontoPercentual: 0,
  entradaPercentual: 10,
  nome: "NORMAL",
  parcelas: 60,
};
const PARCELADO = {
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  descontoPercentual: 8,
  entradaPercentual: 8,
  nome: "INVESTIDOR PARCELADO",
  parcelas: 84,
};
const INVESTIDOR = {
  anuaisQuantidade: 3,
  anuaisValor: 30_000,
  descontoPercentual: 12,
  entradaPercentual: 40,
  nome: "INVESTIDOR",
  parcelas: 36,
};
const GARDEN = [NORMAL, PARCELADO, INVESTIDOR];

/** O lote do print do Lucas: R$ 435.000 de tabela. */
const TABELA = 435_000;

function pedir(p: {
  parcelas?: number;
  plano?: typeof NORMAL;
  planos?: typeof GARDEN;
  tabela?: number;
  valor: unknown;
}) {
  return valoresDaSimulacaoPublica({
    anuaisPedidas: { quantidade: 0, valor: 0 },
    entradaMinimaPercentual: 8,
    entradaPedida: 0,
    parcelasPedidas: p.parcelas,
    plano: p.plano ?? PARCELADO,
    planos: p.planos ?? GARDEN,
    precoDeTabela: p.tabela ?? TABELA,
    valorPedido: p.valor,
  });
}

describe("peça 2: o preço ajustado na tela vai ao papel", () => {
  it("⚠️ 10% à mão no INVESTIDOR PARCELADO (8%): passa como está, e não sobe para o preço do plano", () => {
    // Antes de 23/09/2026 isto devolvia 400.200 — o preço do plano —, e a folha desmentia a tela.
    expect(pedir({ valor: 391_500 })).toMatchObject({ ok: true, valor: 391_500 });
  });

  it("um desconto à mão em plano SEM desconto também passa (o NORMAL do Garden)", () => {
    expect(pedir({ parcelas: 60, plano: NORMAL, valor: 400_000 })).toMatchObject({
      ok: true,
      valor: 400_000,
    });
  });

  it("os centavos da tela passam intactos", () => {
    expect(pedir({ valor: 391_499.37 })).toMatchObject({ ok: true, valor: 391_499.37 });
  });
});

describe("peça 2: sem teto de desconto, e a recusa que sobrou", () => {
  it("o que era o teto (15% da tabela: R$ 369.750) passa, como qualquer outro número", () => {
    // ⚠️ A CONSTANTE SOBREVIVEU AO TETO, E SÓ COMO REGISTRO. Ela não manda em nada desde
    // 23/09/2026; fica para o número que já valeu não se perder, e esta linha existe para que quem
    // a reencontrar no código chegue neste arquivo e leia que ela não recusa mais nada.
    expect(DESCONTO_MAXIMO_DA_SIMULACAO).toBe(15);
    expect(pedir({ valor: 369_750 })).toMatchObject({ ok: true, valor: 369_750 });
  });

  it("⚠️ um centavo abaixo do que era o teto passa igual, e não é trocado em silêncio", () => {
    // ⚠️ ESTA ASSERÇÃO VIROU DE LADO EM 23/09/2026, E É DECISÃO, NÃO DEFEITO. Ela exigia
    // `ok: false` com a frase "15% de desconto"; Lucas, perguntado com o risco escrito na frente,
    // respondeu *"Liberar para todo mundo"* e, sobre o teto, **"pode liberar tudo"**. Quem
    // "consertar" isto de volta está desfazendo a decisão dele, não corrigindo um esquecimento.
    // O que o caso continua medindo é o de sempre: o número da tela chega inteiro, até o centavo.
    expect(pedir({ valor: 369_749.99 })).toMatchObject({ ok: true, valor: 369_749.99 });
  });

  it("⚠️ o corpo forjado do defeito de 18/09 (50% de desconto) agora passa, e é decisão", () => {
    // ⚠️ ESTE CASO MEDE O QUE A DECISÃO CUSTA, e por isso ele foi INVERTIDO e não apagado. O
    // defeito de 18/09/2026 era exatamente este corpo: metade do preço, escrito à mão, numa página
    // sem login. Lucas, em 23/09/2026, com esse histórico na frente: *"Liberar para todo mundo"* e
    // **"pode liberar tudo"**. Fica registrado até onde isso alcança: 99% também passa, e o lote de
    // R$ 435.000 sai a R$ 4.350. O que segura a folha é a frase que ela carrega, não esta régua.
    expect(pedir({ valor: 217_500 })).toMatchObject({ ok: true, valor: 217_500 });
    expect(pedir({ valor: 4_350 })).toMatchObject({ ok: true, valor: 4_350 });
  });

  it("⚠️ acima da tabela também é recusa, e não uma descida silenciosa até ela", () => {
    // O campo do lote tem botão de ACRÉSCIMO, e no espelho ele agora está à mão de qualquer um.
    // Prender em 435.000 devolveria a mesma troca silenciosa que este arquivo veio matar.
    const r = pedir({ valor: 999_999 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.mensagem).toMatch(/tabela/);
  });

  it("lixo, negativo, zero e ausente continuam sendo 'não mandou valor': a tabela", () => {
    for (const valor of [undefined, null, "", "abc", -5, 0])
      expect(pedir({ valor })).toMatchObject({ ok: true, valor: TABELA });
  });
});

describe("peça 2: o preço do PRÓPRIO plano continua passando", () => {
  it("o INVESTIDOR (12%) no prazo dele passa, e a folha chama isso de desconto de tabela", () => {
    expect(pedir({ parcelas: 36, plano: INVESTIDOR, valor: 382_800 })).toMatchObject({
      descontoPercentual: 12,
      ok: true,
      valor: 382_800,
    });
  });

  it("⚠️ e um plano cadastrado com 20% passa pelo preço dele, e abaixo dele também", () => {
    // Hoje o maior desconto cadastrado é 12% (medido em `temis_planos` em 23/09/2026: 37 planos
    // ativos, dois com desconto, 12% e 8%). Este caso nasceu para provar que o teto de 15% não
    // recusaria a folha do PRÓPRIO plano da casa se amanhã alguém cadastrasse 20% — seria o
    // simulador negando a tabela que o corretor vende.
    //
    // ⚠️ A SEGUNDA ASSERÇÃO VIROU DE LADO EM 23/09/2026 (*"pode liberar tudo"*). Ela exigia recusa
    // um centavo abaixo do preço do plano, e sem teto não há mais nada abaixo do que recusar. O
    // caso fica porque a primeira metade continua valendo: o preço do plano nunca é barrado.
    const VINTE = { ...PARCELADO, descontoPercentual: 20, nome: "LANÇAMENTO" };
    expect(
      pedir({ parcelas: 84, plano: VINTE, planos: [...GARDEN, VINTE], valor: 348_000 }),
    ).toMatchObject({ descontoPercentual: 20, ok: true, valor: 348_000 });
    expect(
      pedir({ parcelas: 84, plano: VINTE, planos: [...GARDEN, VINTE], valor: 347_999.99 }),
    ).toMatchObject({ ok: true, valor: 347_999.99 });
  });
});
