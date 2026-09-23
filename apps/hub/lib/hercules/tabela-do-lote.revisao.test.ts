import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { taxaMensal } from "@/lib/apolo/planos-comerciais";
import { conferirNaUnidade, type PlanoDoTemis } from "@/lib/temis/planos";

import { composicoesQueFecham } from "./composicoes";
import { montarCronograma } from "./cronograma";
import { comoPlano, type LinhaDoPlano } from "./planos-do-panteon";
import { montarFolhaDaProposta } from "./proposta-para-pdf";
import { sistemaDoCadastro } from "./simulacao";
import { condicaoDoPlano, type PlanoDaTabela } from "./tabela-do-lote";

// REVISÃO (18/09/2026) — "tem que ser igual o mmendes", medido lote a lote.
//
// A conta da MMendes NÃO é transcrita aqui: ela é EXTRAÍDA do próprio `masterplans-internos/garden.html`
// (PLANOS, POLITICA, fatorAnuidade, fatorBaloes, calcParcela, condicoes, ofEdit, ofBalanco) e rodada
// como está. O cartão que o corretor lê no mapa da MMendes é o de `ofEdit`/`ofBalanco`: a entrada é
// `Math.round(condicoes().ent)` e a parcela é `calcParcela` com essa entrada arredondada.
//
// Os lotes são os 87 DISPONÍVEIS com preço de `hercules_unidades` (enterprise 39), lidos por SELECT em
// produção em 18/09/2026. Os planos são as três linhas de `temis_planos` do Garden, lidas no mesmo dia,
// passando por `comoPlano` (a mesma normalização da Mesa), com o desconto que a 0178 vai gravar.

const HTML = fs.readFileSync(
  path.join(__dirname, "..", "..", "masterplans-internos", "garden.html"),
  "utf8",
);

type PlanoMM = { anQtd: number; anVal: number; desc: number; ent: number; id: string; nome: string; prazo: number };
type ContaMM = {
  PLANOS: PlanoMM[];
  POLITICA: { jurosAM: number };
  cartao: (preco: number, k: number) => { ent: number; parcela: number };
  condicoes: (preco: number, p: PlanoMM, i: number) => { ent: number; parcela: number; PD: number };
  /** A busca por parcela do mapa (`propor`, garden.html ~3294), como está lá. */
  propor: (
    preco: number,
    alvo: number,
    entMax: null | number,
    anMax: null | number,
    i: number,
  ) => Array<{ anQtd: number; anVal: number; ent: number; id: string; parcela: number; pd: number }>;
};

/** O trecho do arquivo, do primeiro marcador (inclusive) ao segundo (exclusive). */
function trecho(de: string, ate: string): string {
  const i = HTML.indexOf(de);
  const f = HTML.indexOf(ate, i);
  if (i < 0 || f < 0) throw new Error(`marcador ausente no garden.html: ${de} / ${ate}`);
  return HTML.slice(i, f);
}

const MM: ContaMM = new Function(
  [
    trecho("const PLANOS=[", "/* ============================== abrir"),
    trecho("const OF_TOL=1.00;", "const OF_OK="),
    trecho("/* -------------------- 1) da parcela para o plano", "/* nada fechou no valor pedido?"),
    // O cartão como `renderOficial` o desenha: lote aberto, EDIT zerado, parcela não tocada.
    "function cartao(preco,k){ SIM.preco=preco; SIM.precoTabela=preco; EDIT=[];",
    "  const e=ofEdit(k), b=ofBalanco(k); return {ent:e.ent, parcela:b.parcela}; }",
    "return {PLANOS, POLITICA, cartao, condicoes, propor};",
  ].join("\n"),
)() as ContaMM;

/** As três linhas de `temis_planos` do Garden (SELECT de 18/09/2026), mais o desconto da 0178. */
const LINHAS_DO_GARDEN: LinhaDoPlano[] = [
  { anuais_quantidade: 5, anuais_valor: "25000.00", desconto_percentual: 0, enterprise_id: "39", entrada_percentual: "10.000", indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "anual", juros_taxa: "6.000000", nome: "NORMAL", ordem: 1, parcelas: 60, sistema_amortizacao: "sacoc" } as LinhaDoPlano,
  { anuais_quantidade: 4, anuais_valor: "25000.00", desconto_percentual: 8, enterprise_id: "39", entrada_percentual: "8.000", indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "anual", juros_taxa: "6.000000", nome: "INVESTIDOR PARCELADO", ordem: 2, parcelas: 84, sistema_amortizacao: "sacoc" } as LinhaDoPlano,
  { anuais_quantidade: 3, anuais_valor: "30000.00", desconto_percentual: 12, enterprise_id: "39", entrada_percentual: "40.000", indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "anual", juros_taxa: "0.000000", nome: "INVESTIDOR", ordem: 3, parcelas: 36, sistema_amortizacao: "sacoc" } as LinhaDoPlano,
];
const PANTEON = LINHAS_DO_GARDEN.map(comoPlano);

/** Como o simulador monta `planosDaConta` a partir do plano da rota. */
const daConta = (p: (typeof PANTEON)[number]): PlanoDaTabela => ({
  anuaisQuantidade: p.anuaisQuantidade,
  anuaisValor: p.anuaisValor,
  descontoPercentual: p.descontoPercentual,
  entradaPercentual: p.entradaPercentual,
  parcelas: p.parcelas,
  sistemaAmortizacao: sistemaDoCadastro(p.sistemaAmortizacao),
  taxaAoMes: taxaMensal(p),
});

const PISO_DO_GARDEN = 8; // apolo_enterprise_settings.entrada_minima_percentual, enterprise 39

/** Os 87 lotes disponíveis com preço (hercules_unidades, enterprise 39, 18/09/2026), agrupados. */
const LOTES_DISPONIVEIS: Record<number, string[]> = {
  410_000: ["0101", "0102", "0103", "0104", "0105", "0110", "0111", "0112", "0113", "0201", "0202", "0203", "0204", "0209", "0210", "0211", "0212"],
  416_000: ["0402", "0411", "0412", "0416", "0427", "0428", "0429", "0430", "0431", "0432", "0503", "0504", "0505", "0611", "0626", "0627", "0628", "0701", "0702"],
  420_000: ["0304"],
  421_500: ["0401", "0707", "0708", "0803", "0827", "1002", "1003", "1004", "1005", "1006", "1012", "1801", "1802"],
  430_000: ["0314", "0315", "1108", "1109", "1225", "1324", "1325", "1407", "1408", "1616", "1617", "1618", "1706", "1707", "1803", "1804"],
  435_000: ["1110", "1111", "1223", "1224", "1311", "1312", "1313", "1409", "1410", "1411"],
  440_000: ["0305"],
  460_000: ["0306"],
  470_000: ["0307", "0308", "0313"],
  480_000: ["0309"],
  490_000: ["0310"],
  510_000: ["0311"],
  530_000: ["0312"],
  570_000: ["1805"],
  580_000: ["1806"],
};
const LOTES = Object.entries(LOTES_DISPONIVEIS).flatMap(([preco, lotes]) =>
  lotes.map((l) => ({ codigo: `GDN${l}`, preco: Number(preco) })),
);

const centavos = (v: number) => Math.round(v * 100);

/** Qual plano da MMendes é qual plano do Panteon. */
const PAR: Record<string, string> = {
  INVESTIDOR: "invest",
  "INVESTIDOR PARCELADO": "invparc",
  NORMAL: "normal",
};

function comparar(opcoes: { taxaZeroNasAnuais: boolean }) {
  const linhas: Array<{ codigo: string; entradaIgual: boolean; parcelaIgual: boolean; plano: string; preco: number; dela: { ent: number; parcela: number }; nossa: { entrada: number; parcela: number } }> = [];
  for (const { codigo, preco } of LOTES) {
    for (const plano of PANTEON) {
      const k = MM.PLANOS.findIndex((p) => p.id === PAR[plano.nome]);
      const dela = MM.cartao(preco, k);
      const conta = daConta(plano);
      const nossa = condicaoDoPlano({
        entradaMinimaPercentual: PISO_DO_GARDEN,
        plano: opcoes.taxaZeroNasAnuais ? { ...conta, taxaAoMes: 0 } : conta,
        precoDeTabela: preco,
      });
      linhas.push({
        codigo,
        dela,
        entradaIgual: nossa.entrada === dela.ent,
        nossa: { entrada: nossa.entrada, parcela: nossa.parcela },
        parcelaIgual: centavos(nossa.parcela) === centavos(dela.parcela),
        plano: plano.nome,
        preco,
      });
    }
  }
  return linhas;
}

describe("revisão: a conta extraída do garden.html é a que o Lucas conhece", () => {
  it("os três planos e a taxa zero estão lá como o relato diz", () => {
    expect(LOTES).toHaveLength(87);
    expect(MM.POLITICA.jurosAM).toBe(0);
    expect(MM.PLANOS.map((p) => [p.id, p.desc, p.ent, p.anQtd, p.anVal, p.prazo])).toEqual([
      ["normal", 0, 0.1, 5, 25_000, 60],
      ["invparc", 0.08, 0.08, 4, 25_000, 84],
      ["invest", 0.12, 0.4, 3, 30_000, 36],
    ]);
    // Q01 L01, R$ 410.000: 4.066,67 · 2.940,76 · 3.513,33 (o cartão, com a entrada arredondada).
    expect([0, 1, 2].map((k) => centavos(MM.cartao(410_000, k).parcela) / 100)).toEqual([
      4_066.67, 2_940.76, 3_513.33,
    ]);
    expect(centavos(MM.cartao(435_000, 1).parcela) / 100).toBe(3_192.67);
  });
});

describe("revisão: Panteon x MMendes nos 87 lotes disponíveis do Garden (0178 aplicada)", () => {
  const linhas = comparar({ taxaZeroNasAnuais: false });
  const por = (nome: string) => linhas.filter((l) => l.plano === nome);

  it("INVESTIDOR (0% a.a.): 87 de 87 batem ao centavo, entrada e parcela", () => {
    expect(por("INVESTIDOR").filter((l) => l.parcelaIgual && l.entradaIgual)).toHaveLength(87);
  });

  it("a entrada bate em 87 de 87 no NORMAL; no INVESTIDOR PARCELADO só erra por R$ 1 nos 13 lotes de R$ 421.500", () => {
    expect(por("NORMAL").filter((l) => l.entradaIgual)).toHaveLength(87);
    const fora = por("INVESTIDOR PARCELADO").filter((l) => !l.entradaIgual);
    // 8% de 387.780 (421.500 − 8%) = 31.022,40. A MMendes arredonda (31.022, R$ 0,40 ABAIXO do piso
    // de 8%); o Panteon arredonda para cima (31.023) e respeita o piso. Divergência esperada.
    expect(fora.map((l) => l.preco)).toEqual(Array(13).fill(421_500));
    expect(fora.every((l) => l.nossa.entrada - l.dela.ent === 1)).toBe(true);
  });

  // CORRIGIDO EM 18/09/2026 (na revisão, vermelho: "não bate com a MMendes em NENHUM lote"). Medido antes
  // da correção: 0 de 87 no NORMAL e 0 de 87 no INVESTIDOR PARCELADO, com R$ 328,18/mês e R$ 159,19
  // (ou 159,20)/mês a mais, que era (face − valor presente das anuais a 6% a.a.) ÷ prazo. Decisão do
  // Zeus: no SACOC as anuais abatem o saldo pelo valor de face (`anuaisQueAbatemOSaldo`).
  //
  // ⚠️ UMA EXPECTATIVA MUDOU, E NÃO SÓ O NOME: a revisão esperava 87 de 87 também no INVESTIDOR
  // PARCELADO, mas o teste logo acima já mede que a ENTRADA difere em R$ 1 nos 13 lotes de R$ 421.500
  // (a MMendes arredonda 31.022,40 para 31.022, abaixo do piso de 8%; o Panteon sobe para 31.023).
  // R$ 1 a mais de entrada é R$ 0,01 a menos de parcela, então esses 13 não podem bater ao centavo, e
  // o Panteon é quem está certo. O número honesto é 74 de 87, com os 13 explicados um a um.
  it("NORMAL e INVESTIDOR PARCELADO: a parcela é a da MMendes ao centavo; a única exceção é o R$ 1 da entrada nos lotes de R$ 421.500", () => {
    const batemNormal = por("NORMAL").filter((l) => l.parcelaIgual).length;
    const batemParcelado = por("INVESTIDOR PARCELADO").filter((l) => l.parcelaIgual).length;
    const diferencas = new Set(
      linhas
        .filter((l) => l.plano !== "INVESTIDOR" && l.entradaIgual)
        .map((l) => `${l.plano}:${(centavos(l.nossa.parcela) - centavos(l.dela.parcela)) / 100}`),
    );
    expect([...diferencas].sort()).toEqual(["INVESTIDOR PARCELADO:0", "NORMAL:0"]);
    expect({ batemNormal, batemParcelado }).toEqual({ batemNormal: 87, batemParcelado: 74 });

    const excecoes = por("INVESTIDOR PARCELADO").filter((l) => !l.parcelaIgual);
    expect(excecoes.map((l) => l.preco)).toEqual(Array(13).fill(421_500));
    expect(excecoes.every((l) => l.nossa.entrada - l.dela.ent === 1)).toBe(true);
    expect(
      excecoes.every((l) => centavos(l.dela.parcela) - centavos(l.nossa.parcela) === 1),
    ).toBe(true);

    // No total: 248 das 261 combinações (87 lotes × 3 planos) batem entrada e parcela ao centavo.
    expect(linhas.filter((l) => l.parcelaIgual && l.entradaIgual)).toHaveLength(248);
  });
});

describe("revisão: a correção proposta (anuais pelo valor de face no SACOC) fecharia?", () => {
  // Medido antes da correção, zerando a taxa à mão. Depois dela, a conta de verdade dá o mesmo número
  // (ver o teste de cima): as anuais do SACOC já abatem pelo valor de face.
  it("com taxa zero nas anuais: 261 − 13 = 248 de 261 ao centavo; os 13 restantes são o R$ 1 da entrada", () => {
    const linhas = comparar({ taxaZeroNasAnuais: true });
    const batem = linhas.filter((l) => l.parcelaIgual && l.entradaIgual);
    const naoBatem = linhas.filter((l) => !(l.parcelaIgual && l.entradaIgual));
    expect(batem).toHaveLength(248);
    expect(naoBatem.every((l) => l.plano === "INVESTIDOR PARCELADO" && l.preco === 421_500)).toBe(true);
    // R$ 1 a mais de entrada é R$ 0,01 a menos de parcela (1 ÷ 84 = 0,0119).
    expect(
      naoBatem.every((l) => centavos(l.dela.parcela) - centavos(l.nossa.parcela) === 1),
    ).toBe(true);
  });
});

describe("revisão: o cronograma (PDF) com as anuais do plano", () => {
  const investidorParcelado = PANTEON[1]!;
  const nossa = condicaoDoPlano({
    entradaMinimaPercentual: PISO_DO_GARDEN,
    plano: daConta(investidorParcelado),
    precoDeTabela: 435_000,
  });
  const cronograma = montarCronograma({
    anuaisQuantidade: nossa.anuais.quantidade,
    anuaisValor: nossa.anuais.valor,
    diaDeVencimento: 10,
    entradaValor: nossa.entrada,
    entradaVezes: 1,
    parcelasMensais: investidorParcelado.parcelas,
    plano: investidorParcelado,
    primeiraParcelaDaEntrada: "2026-10-10",
    valorNegociado: nossa.precoDoPlano,
  });

  it("a primeira mensal do PDF é a parcela do cartão, e o financiado é o mesmo", () => {
    expect(nossa.precoDoPlano).toBe(400_200);
    expect(nossa.entrada).toBe(32_016);
    expect(cronograma.mensais).toHaveLength(84);
    expect(cronograma.mensais[0]!.valor).toBe(centavos(nossa.parcela) / 100);
    expect(centavos(cronograma.totais.financiado)).toBe(centavos(nossa.financiado));
    expect(cronograma.anuais.map((a) => a.valor)).toEqual([25_000, 25_000, 25_000, 25_000]);
    expect(cronograma.totais.anuais).toBe(100_000);
  });

  it("o total do PDF é entrada + anuais de face + soma das mensais; o do cartão é o preço do plano", () => {
    const soma = cronograma.mensais.reduce((s, m) => s + centavos(m.valor), 0);
    expect(centavos(cronograma.totais.geral)).toBe(centavos(32_016) + centavos(100_000) + soma);
    // ⚠️ OS DOIS SE SEPARARAM EM 22/09/2026, E É DE PROPÓSITO. O cronograma cobra o degrau do
    // aniversário do SACOC, porque é o papel do contrato; o cartão da simulação soma o que anuncia
    // (Lucas: *"não calculamos juros nessa etapa, é somente informativo"*) e fecha nos R$ 400.200
    // do INVESTIDOR PARCELADO. A diferença medida aqui, R$ 45.974,32, é o degrau — era ela que
    // aparecia como "Total pago" embaixo de "R$ 4.383,14 por mês, 84 vezes".
    expect(centavos(nossa.total)).toBe(centavos(400_200));
    expect(centavos(cronograma.totais.geral) - centavos(nossa.total)).toBe(centavos(45_974.32));
  });

  // ⚠️ A EXPECTATIVA MUDOU COM A DECISÃO 2 (18/09/2026): a anual k vence junto com a mensal 12k
  // (o `fatorBaloes` da MMendes), e não com a 12k + 1. Era "meses 13, 25, 37 e 49".
  it("as 4 anuais caem dentro das 84 mensais (junto com as mensais 12, 24, 36 e 48)", () => {
    const ultimaMensal = cronograma.mensais.at(-1)!.vencimento;
    expect(cronograma.anuais.every((a) => a.vencimento <= ultimaMensal)).toBe(true);
    expect(cronograma.anuais.map((a) => a.vencimento)).toEqual([
      cronograma.mensais[11]!.vencimento,
      cronograma.mensais[23]!.vencimento,
      cronograma.mensais[35]!.vencimento,
      cronograma.mensais[47]!.vencimento,
    ]);
  });

  // CORRIGIDO EM 18/09/2026 (na revisão, vermelho: "anterior, só aparece agora"): medido antes, a última
  // mensal vencia em 10/10/2029 e a 3ª anual em 10/11/2029. Agora as duas vencem no mesmo dia.
  it("a 3ª anual do INVESTIDOR (36x) vence junto com a última mensal, nunca depois", () => {
    const investidor = PANTEON[2]!;
    const c = condicaoDoPlano({
      entradaMinimaPercentual: PISO_DO_GARDEN,
      plano: daConta(investidor),
      precoDeTabela: 435_000,
    });
    const cr = montarCronograma({
      anuaisQuantidade: c.anuais.quantidade,
      anuaisValor: c.anuais.valor,
      diaDeVencimento: 10,
      entradaValor: c.entrada,
      entradaVezes: 1,
      parcelasMensais: investidor.parcelas,
      plano: investidor,
      primeiraParcelaDaEntrada: "2026-10-10",
      valorNegociado: c.precoDoPlano,
    });
    expect(c.anuais.quantidade).toBe(3);
    const ultimaMensal = cr.mensais.at(-1)!.vencimento;
    expect({ terceiraAnual: cr.anuais[2]!.vencimento, ultimaMensal }).toEqual({
      terceiraAnual: "2029-10-10",
      ultimaMensal: "2029-10-10",
    });
    expect(cr.anuais.every((a) => a.vencimento <= ultimaMensal)).toBe(true);
  });
});

/**
 * O total geral que a folha do INVESTIDOR PARCELADO de R$ 435.000 imprime depois da correção: entrada
 * + 4 anuais de face + a série de 84 mensais sobre R$ 268.184,00, com os degraus do SACOC. Antes
 * (anuais a valor presente) eram R$ 461.839,12.
 */
const TOTAL_GERAL_DO_PAPEL = 446_174.32;

describe("revisão: a folha da proposta (PDF) do INVESTIDOR PARCELADO, lote de R$ 435.000", () => {
  const investidorParcelado = PANTEON[1]!;
  const nossa = condicaoDoPlano({
    entradaMinimaPercentual: PISO_DO_GARDEN,
    plano: daConta(investidorParcelado),
    precoDeTabela: 435_000,
  });
  const cronograma = montarCronograma({
    anuaisQuantidade: nossa.anuais.quantidade,
    anuaisValor: nossa.anuais.valor,
    diaDeVencimento: 10,
    entradaValor: nossa.entrada,
    entradaVezes: 1,
    parcelasMensais: 84,
    plano: investidorParcelado,
    primeiraParcelaDaEntrada: "2026-10-10",
    valorNegociado: nossa.precoDoPlano,
  });
  const folha = montarFolhaDaProposta({
    atendimento: { coordenador: null, corretor: null, imobiliaria: null, telefone: null },
    codigo: "000099",
    compradores: [],
    cronograma,
    diaDeVencimento: 10,
    emitidaEmIso: "2026-09-18T12:00:00.000Z",
    empreendimento: "Garden",
    logoC2x: null,
    logoEmpreendimento: null,
    plano: investidorParcelado,
    // Como a rota da proposta manda: a tabela só vai quando o plano tem desconto.
    precoDeTabela: investidorParcelado.descontoPercentual > 0 ? 435_000 : null,
    unidade: { area: 420, cidade: null, nome: "Quadra 11 · Lote 10", uf: null },
    validadeEmIso: null,
    valorNegociado: nossa.precoDoPlano,
  });
  const destaque = (rotulo: string) => folha.destaques.find((d) => d.rotulo === rotulo);
  const condicao = (rotulo: string) => folha.condicoes.find((c) => c.rotulo === rotulo)?.valor;

  it("valor negociado, tabela, desconto, entrada, anuais e parcela são os do cartão", () => {
    expect(destaque("Valor da unidade")?.valor).toBe("R$ 400.200,00");
    expect(condicao("Valor de tabela")).toBe("R$ 435.000,00");
    expect(condicao("Desconto")).toBe("8% · R$ 34.800,00");
    expect(destaque("Entrada")?.valor).toBe("R$ 32.016,00");
    expect(condicao("Parcelas mensais")).toBe("84");
    expect(condicao("Parcelas anuais")).toBe("4 de R$ 25.000,00");
    // Depois da correção (anuais pelo valor de face no SACOC): a parcela é a da MMendes, R$ 3.192,67
    // (era R$ 3.351,86), e o financiado é 400.200 − 32.016 − 100.000 (era R$ 281.556,36).
    expect(destaque("Parcela mensal")?.valor).toBe("R$ 3.192,67");
    expect(destaque("Financiado")?.valor).toBe("R$ 268.184,00");
    // A legenda diz o que o número é: o saldo das mensais, com as anuais fora dele.
    expect(destaque("Financiado")?.detalhe).toBe("84 mensais, fora as 4 anuais");
    // O total geral soma a série com os degraus do SACOC (juros de 6% a.a. a partir do 2º ano).
    expect(centavos(cronograma.totais.geral) / 100).toBe(TOTAL_GERAL_DO_PAPEL);
  });

  // CORRIGIDO EM 18/09/2026 (na revisão, vermelho: "a folha não fecha"). Medido antes: o papel somava
  // R$ 413.572,36, R$ 13.372,36 a mais que o valor, que era (face − valor presente) das anuais.
  it("a folha fecha: entrada + financiado + anuais escritos = valor da unidade, ao centavo", () => {
    const somaDoPapel =
      cronograma.totais.entrada + cronograma.totais.financiado + cronograma.totais.anuais;
    expect(centavos(somaDoPapel)).toBe(centavos(nossa.precoDoPlano));
    // E o que está ESCRITO na folha fecha do mesmo jeito.
    const escrito = (texto: string | undefined) =>
      centavos(Number((texto ?? "").replace(/[^\d,]/g, "").replace(",", ".")));
    expect(
      escrito(destaque("Entrada")?.valor) +
        escrito(destaque("Financiado")?.valor) +
        4 * escrito("R$ 25.000,00"),
    ).toBe(escrito(destaque("Valor da unidade")?.valor));
  });
});

describe("revisão: a conferência da aba de planos do Apolo (planos-comerciais-tab.tsx)", () => {
  // CORRIGIDO EM 18/09/2026 (na revisão, vermelho: "o Apolo anuncia uma parcela e a Mesa outra"). Medido
  // antes: a aba conferia com `calcularParcela`, que não conhece anual, e dizia R$ 4.383,14 no
  // INVESTIDOR PARCELADO de R$ 435.000, contra R$ 3.351,86 da Mesa e R$ 3.192,67 da MMendes.
  //
  // ⚠️ O TESTE PASSOU A CHAMAR A CONTA QUE A ABA FAZ (`conferirNaUnidade`, lib/temis/planos.ts), com o
  // plano montado como o GET de /api/temis/planos o entrega (agora com as anuais). A versão anterior
  // chamava `calcularParcela` direto, que por definição continua sem anual.
  it("com as anuais cadastradas, o Apolo anuncia a mesma parcela da Mesa (e da MMendes)", () => {
    const linha = LINHAS_DO_GARDEN[1]!;
    const doCadastro: PlanoDoTemis = {
      anuaisQuantidade: Number(linha.anuais_quantidade),
      anuaisValor: Number(linha.anuais_valor),
      ativo: true,
      categoriaId: null,
      categoriaNome: null,
      criadoEm: "",
      descontoPercentual: Number(linha.desconto_percentual),
      entradaPercentual: Number(linha.entrada_percentual),
      id: "c25514fe-6d18-47c0-8521-aac7681d4f3c",
      indiceCorrecao: String(linha.indice_correcao),
      jurosConvencao: String(linha.juros_convencao),
      jurosPeriodicidade: String(linha.juros_periodicidade),
      jurosTaxa: Number(linha.juros_taxa),
      minutaId: null,
      minutaNome: null,
      nome: String(linha.nome),
      observacao: null,
      ordem: 2,
      parcelas: Number(linha.parcelas),
      sistemaAmortizacao: String(linha.sistema_amortizacao),
      slot: null,
    };
    const doApolo = conferirNaUnidade(doCadastro, 435_000, PISO_DO_GARDEN)!;
    const daMesa = condicaoDoPlano({
      entradaMinimaPercentual: PISO_DO_GARDEN,
      plano: daConta(PANTEON[1]!),
      precoDeTabela: 435_000,
    });
    expect(centavos(daMesa.parcela) / 100).toBe(3_192.67);
    expect(centavos(doApolo.parcela)).toBe(centavos(daMesa.parcela));
    expect(centavos(doApolo.parcela)).toBe(centavos(MM.cartao(435_000, 1).parcela));
    expect(doApolo.entrada).toBe(32_016);
    expect(doApolo.anuais).toEqual({ quantidade: 4, valor: 25_000 });
  });
});

describe("revisão: a busca por parcela, Panteon x `propor` da MMendes (lote de R$ 435.000)", () => {
  // Item 4 da rodada 2 (18/09/2026): a varredura livre de sempre (zero anual e os valores de anual da
  // casa) MAIS o arranjo do plano como uma opção a mais; cada plano compõe sobre o próprio preço.
  // Não precisa ser idêntico ao `propor` (a casa ancora a entrada no piso em vez de descartar, e não
  // tem o reforço de R$ 10.000), mas o INVESTIDOR PARCELADO não pode sumir onde a MMendes o
  // recomenda.
  const PLANOS_DA_BUSCA = PANTEON.map((p) => ({ ...daConta(p), nome: p.nome }));
  const nossa = (alvo: number) =>
    composicoesQueFecham({
      entradaMinimaPercentual: PISO_DO_GARDEN,
      parcelaAlvo: alvo,
      planos: PLANOS_DA_BUSCA,
      precoDeTabela: 435_000,
      valor: 435_000,
    });
  const dela = (alvo: number) => MM.propor(435_000, alvo, null, null, MM.POLITICA.jurosAM);

  it("o que cada um recomenda nos quatro alvos", () => {
    const resumo = (alvo: number) => ({
      dela: dela(alvo).map((o) => `${o.id} ${o.ent} ${o.anQtd}x${o.anVal}`),
      nossa: nossa(alvo)
        .slice(0, 3)
        .map((c) => `${c.plano} ${c.entrada} ${c.anuais.quantidade}x${c.anuais.valor}`),
    });
    expect(resumo(3_000)).toEqual({
      dela: ["invparc 44000 7x15000", "normal 105000 5x30000", "invest 185000 3x30000"],
      nossa: [
        "INVESTIDOR PARCELADO 33000 6x20000",
        "INVESTIDOR PARCELADO 49000 4x25000",
        "NORMAL 105000 5x30000",
      ],
    });
    expect(resumo(4_000)).toEqual({
      dela: ["invparc 35000 3x10000", "normal 45000 5x30000", "invest 164000 3x25000"],
      nossa: [
        "INVESTIDOR PARCELADO 33000 3x15000",
        "NORMAL 45000 5x30000",
        "INVESTIDOR PARCELADO 65000 0x0",
      ],
    });
    // ⚠️ ESTAS DUAS EMPATAM EM ENTRADA E EM TOTAL, E QUEM DESEMPATA AGORA É A PARCELA. A ordem
    // primária continua sendo a MENOR ENTRADA, e ela não mudou em alvo nenhum. O que mudou é o
    // degrau de baixo: no Garden TODAS as composições passaram a somar exatamente o preço do plano
    // (R$ 400.200 nas duas aqui), porque os três planos têm anuais cadastradas e o SACOC as abate
    // pelo valor de face — o desempate por total virou empate, e até 22/09/2026 a ordem caía na de
    // GERAÇÃO (a ordem em que `anuaisPossiveis` está escrita), que é estável mas não é critério.
    // O terceiro critério passou a ser a menor parcela mensal: R$ 4.192,86 (1 × R$ 15.000) na frente
    // de R$ 4.371,43 (sem reforço), mesma entrada de R$ 33.000 e mesmo total. Fora do Garden (Price,
    // ou reforço à mão em plano sem anual cadastrada) o total continua diferindo e continua
    // desempatando antes disso.
    expect(resumo(4_500)).toEqual({
      dela: ["normal 45000 4x30000", "invest 161000 3x20000"],
      nossa: [
        "INVESTIDOR PARCELADO 33000 1x15000",
        "INVESTIDOR PARCELADO 33000 0x0",
        "NORMAL 44000 5x30000",
      ],
    });
    expect(resumo(5_000)).toEqual({
      dela: ["normal 45000 3x30000", "invest 158000 3x15000"],
      // Mesmo empate de R$ 44.000 de entrada e de R$ 435.000 de total, mesmo desempate: R$ 4.433,33
      // (5 × R$ 25.000) na frente de R$ 4.850,00 (5 × R$ 20.000).
      nossa: ["NORMAL 44000 5x25000", "NORMAL 44000 5x20000", "NORMAL 135000 0x0"],
    });
  });

  it("⚠️ onde a MMendes recomenda o INVESTIDOR PARCELADO, o Panteon também (e na frente)", () => {
    let conferidos = 0;
    for (const alvo of [3_000, 4_000, 4_500, 5_000]) {
      if (!dela(alvo).some((o) => o.id === "invparc")) continue;
      const r = nossa(alvo);
      expect(r[0]?.plano).toBe("INVESTIDOR PARCELADO");
      // Sobre o preço do plano, como a MMendes (`pd = preço × (1 − desconto)`).
      expect(r[0]?.valor).toBe(400_200);
      conferidos += 1;
    }
    // A MMendes recomenda o INVESTIDOR PARCELADO em 3.000 e 4.000.
    expect(conferidos).toBe(2);
  });

  it("toda composição entrega a parcela pedida ou menos, e a conta fecha sobre o preço dela", () => {
    for (const alvo of [3_000, 4_000, 4_500, 5_000]) {
      for (const c of nossa(alvo)) {
        expect(c.parcela).toBeLessThanOrEqual(alvo + 0.005);
        const face = c.anuais.quantidade * c.anuais.valor;
        expect(centavos(c.entrada + face + c.financiado)).toBe(centavos(c.valor));
      }
    }
  });
});

