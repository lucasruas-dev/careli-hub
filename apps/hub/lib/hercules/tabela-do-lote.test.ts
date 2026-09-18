import { describe, expect, it } from "vitest";

import { type PlanoComercial, taxaMensal } from "@/lib/apolo/planos-comerciais";

import { aplicarAjuste, SEM_AJUSTE } from "./ajuste-de-preco";
import {
  composicoesQueFecham,
  entradaMinima,
  type PlanoDaComposicao,
} from "./composicoes";
import { pisoDaEntradaNoPrazo } from "./faixa-do-plano";
import {
  entradaParaAParcela,
  fatorDoFinanciado,
  montarProposta,
  parcelaDoFinanciado,
  sistemaDoCadastro,
  somaDasMensais,
  temAnuaisCadastradas,
  valorPresenteDosBaloes,
} from "./simulacao";
import {
  ajusteAoTrocarDePlano,
  ajusteFrenteAoPlano,
  condicaoDoPlano,
  conferenciaDoPlano,
  descontoDoPlanoNoPrazo,
  mesmoAjuste,
  precoDeTabelaDoCartao,
} from "./tabela-do-lote";

// A TABELA DO LOTE — "tem que ser igual o mmendes" (Lucas, 18/09/2026).
//
// Os três planos do Garden como estão em `temis_planos` (enterprise_id 39, gravados em 17/09/2026):
// NORMAL 60x, entrada 10%, 5 anuais de R$ 25.000, 6% a.a. equivalente, IPCA anual, SACOC;
// INVESTIDOR PARCELADO 84x, 8%, 4 × R$ 25.000, 6% a.a., SACOC; INVESTIDOR 36x, 40%, 3 × R$ 30.000,
// 0%, SACOC. O desconto (8% e 12%) é o da migration 0178, que ainda não roda: aqui ele entra como o
// UPDATE de `0178_desconto_do_plano.dados-garden.sql` vai deixá-lo.

type PlanoDoTeste = PlanoDaComposicao & { jurosTaxa: number };

function doCadastro(p: {
  anuaisQuantidade: number;
  anuaisValor: number;
  descontoPercentual: number;
  entradaPercentual: number;
  jurosTaxa: number;
  nome: string;
  parcelas: number;
}): PlanoDoTeste {
  const comercial = {
    entradaPercentual: p.entradaPercentual,
    indiceCorrecao: "IPCA_ANUAL",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "anual",
    jurosTaxa: p.jurosTaxa,
    nome: p.nome,
    parcelas: p.parcelas,
    sistemaAmortizacao: "sacoc",
    slot: null,
  } as PlanoComercial;
  return {
    ...p,
    sistemaAmortizacao: sistemaDoCadastro("sacoc"),
    taxaAoMes: taxaMensal(comercial),
  };
}

const NORMAL = doCadastro({
  anuaisQuantidade: 5,
  anuaisValor: 25_000,
  descontoPercentual: 0,
  entradaPercentual: 10,
  jurosTaxa: 6,
  nome: "NORMAL",
  parcelas: 60,
});
const INVESTIDOR_PARCELADO = doCadastro({
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  descontoPercentual: 8,
  entradaPercentual: 8,
  jurosTaxa: 6,
  nome: "INVESTIDOR PARCELADO",
  parcelas: 84,
});
const INVESTIDOR = doCadastro({
  anuaisQuantidade: 3,
  anuaisValor: 30_000,
  descontoPercentual: 12,
  entradaPercentual: 40,
  jurosTaxa: 0,
  nome: "INVESTIDOR",
  parcelas: 36,
});
const GARDEN = [NORMAL, INVESTIDOR_PARCELADO, INVESTIDOR];

/** O piso do Garden em `apolo_enterprise_settings` (8,00). */
const PISO_DO_GARDEN = 8;

/**
 * A conta da MMendes, transcrita de `masterplans-internos/garden.html` (`condicoes`, linha ~2475),
 * com `jurosAM: 0` como está lá.
 */
function contaDaMMendes(
  preco: number,
  p: { anQtd: number; anVal: number; desc: number; ent: number; prazo: number },
) {
  const PD = preco * (1 - p.desc);
  const ent = PD * p.ent;
  const parcela = (PD - ent - p.anVal * p.anQtd) / p.prazo;
  return { PD, ent, parcela };
}

const MMENDES = {
  investidor: { anQtd: 3, anVal: 30_000, desc: 0.12, ent: 0.4, prazo: 36 },
  investidorParcelado: { anQtd: 4, anVal: 25_000, desc: 0.08, ent: 0.08, prazo: 84 },
  normal: { anQtd: 5, anVal: 25_000, desc: 0, ent: 0.1, prazo: 60 },
};

const aplicado = (preco: number, plano: PlanoDoTeste) =>
  condicaoDoPlano({
    entradaMinimaPercentual: PISO_DO_GARDEN,
    plano,
    precoDeTabela: preco,
  });

describe("condicaoDoPlano: os três planos do Garden", () => {
  it("a MMendes, transcrita, dá os números que o Lucas conhece (Q01 L01, R$ 410.000)", () => {
    expect(contaDaMMendes(410_000, MMENDES.normal).parcela).toBeCloseTo(4_066.67, 2);
    expect(contaDaMMendes(410_000, MMENDES.investidorParcelado).parcela).toBeCloseTo(2_940.76, 2);
    expect(contaDaMMendes(410_000, MMENDES.investidor).parcela).toBeCloseTo(3_513.33, 2);
    expect(contaDaMMendes(435_000, MMENDES.investidorParcelado).parcela).toBeCloseTo(3_192.67, 2);
  });

  it("desconto, entrada e anuais do plano entram na conta, nos dois lotes", () => {
    const q01 = aplicado(410_000, INVESTIDOR_PARCELADO);
    expect(q01.precoDoPlano).toBe(377_200);
    expect(q01.entrada).toBe(30_176);
    expect(q01.anuais).toEqual({ quantidade: 4, valor: 25_000 });
    expect(q01.ajuste).toEqual({ modo: "percentual", valor: -8 });

    const de435 = aplicado(435_000, INVESTIDOR_PARCELADO);
    expect(de435.precoDoPlano).toBe(400_200);
    // ⚠️ NÃO É MAIS O DO PRINT. O cartão dizia "entrada R$ 34.800 (8%)": 8% da TABELA, sem desconto.
    expect(de435.entrada).toBe(32_016);

    expect(aplicado(410_000, INVESTIDOR).precoDoPlano).toBe(360_800);
    expect(aplicado(410_000, INVESTIDOR).entrada).toBe(144_320);
    expect(aplicado(435_000, INVESTIDOR).precoDoPlano).toBe(382_800);
    expect(aplicado(435_000, INVESTIDOR).entrada).toBe(153_120);

    expect(aplicado(410_000, NORMAL).precoDoPlano).toBe(410_000);
    expect(aplicado(410_000, NORMAL).entrada).toBe(41_000);
    expect(aplicado(410_000, NORMAL).ajuste).toBe(SEM_AJUSTE);
    expect(aplicado(435_000, NORMAL).entrada).toBe(43_500);
  });

  it("INVESTIDOR (0% de juros) bate com a MMendes AO CENTAVO nos dois lotes", () => {
    for (const preco of [410_000, 435_000]) {
      const nosso = aplicado(preco, INVESTIDOR);
      const dela = contaDaMMendes(preco, MMENDES.investidor);
      expect(Math.round(nosso.parcela * 100)).toBe(Math.round(dela.parcela * 100));
      expect(nosso.entrada).toBe(dela.ent);
      expect(nosso.precoDoPlano).toBeCloseTo(dela.PD, 6);
    }
    expect(aplicado(410_000, INVESTIDOR).parcela).toBeCloseTo(3_513.33, 2);
    expect(aplicado(435_000, INVESTIDOR).parcela).toBeCloseTo(3_880, 2);
  });

  // ⚠️ NORMAL E INVESTIDOR PARCELADO AGORA BATEM COM A MMENDES (18/09/2026).
  //
  // Medido antes da correção: nos dois planos COM juros (6% a.a.), `montarProposta` abatia as anuais
  // do saldo pelo VALOR PRESENTE à taxa do plano, e a MMendes (`jurosAM: 0`) abate pelo VALOR DE
  // FACE: R$ 328,18 a mais por mês no NORMAL e R$ 159,19 no INVESTIDOR PARCELADO, em todo lote.
  // Decisão do Zeus: no SACOC da casa a parcela do 1º ciclo é o saldo dividido pelo prazo e os juros
  // entram pelo degrau do aniversário, então as anuais abatem pelo valor de face
  // (`anuaisQueAbatemOSaldo`). Estes são os números de antes, para a diferença ficar escrita.
  it("NORMAL e INVESTIDOR PARCELADO: a parcela é a da MMendes, ao centavo", () => {
    const casos = [
      { antes: 4_394.85, mmendes: MMENDES.normal, plano: NORMAL, preco: 410_000, esperado: 4_066.67 },
      { antes: 4_769.85, mmendes: MMENDES.normal, plano: NORMAL, preco: 435_000, esperado: 4_441.67 },
      {
        antes: 3_099.96,
        mmendes: MMENDES.investidorParcelado,
        plano: INVESTIDOR_PARCELADO,
        preco: 410_000,
        esperado: 2_940.76,
      },
      {
        antes: 3_351.86,
        mmendes: MMENDES.investidorParcelado,
        plano: INVESTIDOR_PARCELADO,
        preco: 435_000,
        esperado: 3_192.67,
      },
    ];

    for (const { antes, esperado, mmendes, plano, preco } of casos) {
      const nosso = aplicado(preco, plano);
      const dela = contaDaMMendes(preco, mmendes);
      expect(Math.round(nosso.parcela * 100)).toBe(Math.round(dela.parcela * 100));
      expect(Math.round(nosso.parcela * 100) / 100).toBe(esperado);

      // A folha fecha: entrada + anuais de face + saldo das mensais = preço do plano.
      const face = mmendes.anQtd * mmendes.anVal;
      expect(Math.round((nosso.entrada + face + nosso.financiado) * 100)).toBe(
        Math.round(nosso.precoDoPlano * 100),
      );

      // E a diferença para o número de antes é exatamente o desconto que as anuais tinham.
      const valorPresente = valorPresenteDosBaloes(mmendes.anQtd, mmendes.anVal, plano.taxaAoMes);
      expect(antes - nosso.parcela).toBeCloseTo((face - valorPresente) / plano.parcelas, 2);
    }
  });

  it("anuais cadastradas além do prazo são cortadas nos aniversários que cabem", () => {
    const curto = aplicado(410_000, { ...INVESTIDOR, parcelas: 24 });
    expect(curto.anuais).toEqual({ quantidade: 2, valor: 30_000 });
    expect(aplicado(410_000, { ...INVESTIDOR, parcelas: 11 }).anuais).toEqual({
      quantidade: 0,
      valor: 0,
    });
  });

  it("anual pela metade, desconto inválido: plano sem anual e sem desconto", () => {
    const meio = aplicado(200_000, { ...NORMAL, anuaisValor: null });
    expect(meio.anuais).toEqual({ quantidade: 0, valor: 0 });
    for (const lixo of [null, undefined, -5, 100, 150, Number.NaN]) {
      const r = aplicado(200_000, { ...NORMAL, descontoPercentual: lixo as never });
      expect(r.precoDoPlano).toBe(200_000);
      expect(r.ajuste).toBe(SEM_AJUSTE);
    }
  });
});

// ── REGRESSÃO: planos SEM desconto e SEM anuais saem idênticos ───────────────
//
// Os planos reais de `temis_planos` de outros empreendimentos, lidos em 18/09/2026 (SELECT em
// produção), com o piso de cada um em `apolo_enterprise_settings`. Nenhum tem anual nem desconto.
// A conta ANTIGA do simulador (o `useMemo` da tabela e o efeito de abertura) está copiada abaixo.

type Real = {
  entradaPercentual: number;
  jurosPeriodicidade: "anual" | "mensal";
  jurosTaxa: null | number;
  nome: string;
  parcelas: number;
  sistema: string;
};

const REAIS: Array<{ enterprise: string; piso: null | number; planos: Real[] }> = [
  {
    enterprise: "19",
    piso: 10,
    planos: [
      { entradaPercentual: 10, jurosPeriodicidade: "anual", jurosTaxa: null, nome: "INVESTIDOR", parcelas: 24, sistema: "sacoc" },
      { entradaPercentual: 10, jurosPeriodicidade: "mensal", jurosTaxa: 0, nome: "CURTO", parcelas: 36, sistema: "sacoc" },
      { entradaPercentual: 10, jurosPeriodicidade: "mensal", jurosTaxa: 0.5, nome: "NORMAL - SACOC", parcelas: 168, sistema: "sacoc" },
      { entradaPercentual: 10, jurosPeriodicidade: "mensal", jurosTaxa: 0.5, nome: "NORMAL - PRICE", parcelas: 168, sistema: "price" },
    ],
  },
  {
    enterprise: "20",
    piso: 10,
    planos: [
      { entradaPercentual: 0, jurosPeriodicidade: "mensal", jurosTaxa: 0, nome: "Investidor", parcelas: 24, sistema: "sacoc" },
      { entradaPercentual: 20, jurosPeriodicidade: "mensal", jurosTaxa: 0, nome: "Curto", parcelas: 36, sistema: "sacoc" },
      { entradaPercentual: 10, jurosPeriodicidade: "mensal", jurosTaxa: 0.6434, nome: "Normal", parcelas: 120, sistema: "sacoc" },
    ],
  },
  {
    enterprise: "27",
    piso: 12,
    planos: [
      { entradaPercentual: 20, jurosPeriodicidade: "mensal", jurosTaxa: 0, nome: "INVESTIDOR 01", parcelas: 36, sistema: "sacoc" },
      { entradaPercentual: 12, jurosPeriodicidade: "mensal", jurosTaxa: 0, nome: "INVESTIDOR 02", parcelas: 48, sistema: "sacoc" },
      { entradaPercentual: 12, jurosPeriodicidade: "mensal", jurosTaxa: 0.8, nome: "NORMAL 01", parcelas: 72, sistema: "sacoc" },
      { entradaPercentual: 12, jurosPeriodicidade: "mensal", jurosTaxa: 0.8, nome: "NORMAL 02", parcelas: 120, sistema: "sacoc" },
    ],
  },
  {
    enterprise: "35",
    piso: 10,
    planos: [
      { entradaPercentual: 20, jurosPeriodicidade: "mensal", jurosTaxa: 0, nome: "INVESTIDOR", parcelas: 24, sistema: "sacoc" },
      { entradaPercentual: 20, jurosPeriodicidade: "mensal", jurosTaxa: 0, nome: "CURTO", parcelas: 36, sistema: "sacoc" },
      { entradaPercentual: 10, jurosPeriodicidade: "mensal", jurosTaxa: 0.7207, nome: "NORMAL", parcelas: 156, sistema: "sacoc" },
    ],
  },
  {
    enterprise: "38",
    piso: 10,
    planos: [
      { entradaPercentual: 20, jurosPeriodicidade: "anual", jurosTaxa: 0, nome: "INVESTIDOR", parcelas: 12, sistema: "sacoc" },
      { entradaPercentual: 30, jurosPeriodicidade: "anual", jurosTaxa: 0, nome: "CURTO", parcelas: 24, sistema: "sacoc" },
      { entradaPercentual: 10, jurosPeriodicidade: "mensal", jurosTaxa: 0.6434, nome: "NORMAL", parcelas: 180, sistema: "sacoc" },
    ],
  },
  {
    enterprise: "42",
    piso: 0,
    planos: [
      { entradaPercentual: 0, jurosPeriodicidade: "anual", jurosTaxa: 0, nome: "Investidor", parcelas: 12, sistema: "sacoc" },
      { entradaPercentual: 30, jurosPeriodicidade: "anual", jurosTaxa: 0, nome: "Curto", parcelas: 36, sistema: "sacoc" },
      { entradaPercentual: 10, jurosPeriodicidade: "mensal", jurosTaxa: 0.6434, nome: "Normal - Price", parcelas: 120, sistema: "price" },
    ],
  },
  {
    // Sem linha em `apolo_enterprise_settings`: vale o padrão da casa.
    enterprise: "33",
    piso: null,
    planos: [
      { entradaPercentual: 20, jurosPeriodicidade: "mensal", jurosTaxa: 0, nome: "INVESTIDOR 01", parcelas: 36, sistema: "sacoc" },
      { entradaPercentual: 20, jurosPeriodicidade: "mensal", jurosTaxa: null, nome: "INVESTIDOR 02", parcelas: 48, sistema: "sacoc" },
      { entradaPercentual: 20, jurosPeriodicidade: "mensal", jurosTaxa: 0.8, nome: "NORMAL 01", parcelas: 72, sistema: "sacoc" },
      { entradaPercentual: 12, jurosPeriodicidade: "mensal", jurosTaxa: 0.8, nome: "NORMAL 02", parcelas: 120, sistema: "sacoc" },
    ],
  },
];

/** Como o simulador monta `planosDaConta` — sem desconto e sem anuais, que é o que o cadastro tem. */
const paraAConta = (r: Real): PlanoDaComposicao => ({
  entradaPercentual: r.entradaPercentual,
  nome: r.nome,
  parcelas: r.parcelas,
  sistemaAmortizacao: sistemaDoCadastro(r.sistema),
  taxaAoMes: taxaMensal({
    entradaPercentual: r.entradaPercentual,
    indiceCorrecao: "IPCA_ANUAL",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: r.jurosPeriodicidade,
    jurosTaxa: r.jurosTaxa,
    nome: r.nome,
    parcelas: r.parcelas,
    sistemaAmortizacao: sistemaDoCadastro(r.sistema),
    slot: null,
  }),
});

/** A conta do cartão ANTES de 18/09/2026, copiada do simulador (entradaDoPlano + montarProposta). */
function cartaoAntigo(valor: number, p: PlanoDaComposicao, minimo: null | number) {
  const entrada = Math.max(
    entradaMinima(valor, minimo),
    Math.ceil((valor * p.entradaPercentual) / 100),
  );
  const montada = montarProposta({
    baloesQuantidade: 0,
    baloesValor: 0,
    entrada,
    parcelas: p.parcelas,
    sistemaAmortizacao: p.sistemaAmortizacao,
    taxaAoMes: p.taxaAoMes,
    valor,
  });
  return { entrada, ...montada };
}

/**
 * `montarProposta` e `entradaParaAParcela` como estavam na main v1.349.6: as anuais SEMPRE a valor
 * presente. Desde 18/09/2026 o SACOC abate pelo valor de face (decisão do Zeus, "tem que ser igual o
 * mmendes"); a Price e o SAC continuam aqui.
 */
const contaAntiga = {
  entradaParaAParcela: (e: Parameters<typeof entradaParaAParcela>[0]) => {
    const baloesNoSaldo = valorPresenteDosBaloes(e.baloesQuantidade, e.baloesValor, e.taxaAoMes);
    const financiadoQueAParcelaPaga =
      e.parcela *
      fatorDoFinanciado({
        parcelas: e.parcelas,
        sistemaAmortizacao: e.sistemaAmortizacao,
        taxaAoMes: e.taxaAoMes,
      });
    const bruta = e.valor - baloesNoSaldo - financiadoQueAParcelaPaga;
    return bruta >= 0 ? { entrada: bruta, sobra: 0 } : { entrada: 0, sobra: -bruta };
  },
  montarProposta: (e: Parameters<typeof montarProposta>[0]) => {
    const desembolsoInicial = Math.max(0, e.entrada);
    const baloesNoSaldo = valorPresenteDosBaloes(e.baloesQuantidade, e.baloesValor, e.taxaAoMes);
    const financiado = Math.max(0, e.valor - desembolsoInicial - baloesNoSaldo);
    const sistema = {
      parcelas: e.parcelas,
      sistemaAmortizacao: e.sistemaAmortizacao,
      taxaAoMes: e.taxaAoMes,
    };
    return {
      financiado,
      parcela: parcelaDoFinanciado({ financiado, ...sistema }),
      total:
        desembolsoInicial +
        somaDasMensais({ financiado, ...sistema }) +
        Math.max(0, e.baloesQuantidade) * Math.max(0, e.baloesValor),
    };
  },
};

/**
 * `composicoesQueFecham` como estava na main v1.349.6, sem os comentários.
 *
 * ⚠️ A CONTA DAS ANUAIS É PARÂMETRO: com a conta de hoje ela prende a LÓGICA da busca (piso, milhar,
 * teto, uma por plano e reforço); com a `contaAntiga` ela prende os NÚMEROS de antes, que só podem
 * ter mudado no SACOC com anual e juros.
 */
function composicoesAntigas(entrada: {
  conta?: typeof contaAntiga;
  entradaMinimaPercentual?: null | number;
  parcelaAlvo: number;
  planos: PlanoDaComposicao[];
  tetoDaEntrada?: null | number;
  valor: number;
}) {
  const conta = entrada.conta ?? { entradaParaAParcela, montarProposta };
  const anuaisPossiveis = [0, 15_000, 20_000, 25_000, 30_000];
  const { parcelaAlvo, planos, valor } = entrada;
  const milhar = (v: number) => Math.ceil(v / 1_000) * 1_000;
  const teto = entrada.tetoDaEntrada ?? null;
  const pisoDaCasa = milhar(entradaMinima(valor, entrada.entradaMinimaPercentual));
  const pisoDoPlano = (plano: PlanoDaComposicao) =>
    Math.min(
      valor,
      milhar(
        pisoDaEntradaNoPrazo({
          parcelas: plano.parcelas,
          pisoDaCasaEmReais: pisoDaCasa,
          planos: planos.map((p) => ({
            entradaPercentual: p.entradaPercentual,
            nome: p.nome,
            parcelas: p.parcelas,
          })),
          valorNegociado: valor,
        }).emReais,
      ),
    );
  if (parcelaAlvo <= 0 || valor <= 0) return [];
  const achadas: Array<{
    anuais: { quantidade: number; valor: number };
    entrada: number;
    entradaPercentual: number;
    financiado: number;
    parcela: number;
    parcelas: number;
    plano: string;
    total: number;
  }> = [];
  for (const plano of planos) {
    if (plano.parcelas <= 0) continue;
    const aniversarios = Math.floor(plano.parcelas / 12);
    for (const valorAnual of anuaisPossiveis) {
      const quantidades =
        valorAnual === 0 ? [0] : Array.from({ length: Math.min(6, aniversarios) }, (_, i) => i + 1);
      for (const quantidade of quantidades) {
        const { entrada: exata, sobra } = conta.entradaParaAParcela({
          baloesQuantidade: quantidade,
          baloesValor: valorAnual,
          parcela: parcelaAlvo,
          parcelas: plano.parcelas,
          sistemaAmortizacao: plano.sistemaAmortizacao,
          taxaAoMes: plano.taxaAoMes,
          valor,
        });
        if (sobra > 0) continue;
        const arredondada = Math.max(pisoDoPlano(plano), milhar(exata));
        if (arredondada >= valor) continue;
        if (teto !== null && arredondada > teto) continue;
        const montada = conta.montarProposta({
          baloesQuantidade: quantidade,
          baloesValor: valorAnual,
          entrada: arredondada,
          parcelas: plano.parcelas,
          sistemaAmortizacao: plano.sistemaAmortizacao,
          taxaAoMes: plano.taxaAoMes,
          valor,
        });
        achadas.push({
          anuais: { quantidade, valor: valorAnual },
          entrada: arredondada,
          entradaPercentual: valor > 0 ? (arredondada / valor) * 100 : 0,
          financiado: montada.financiado,
          parcela: montada.parcela,
          parcelas: plano.parcelas,
          plano: plano.nome,
          total: montada.total,
        });
      }
    }
  }
  const melhorPorChave = new Map<string, (typeof achadas)[number]>();
  for (const c of achadas) {
    const chave = `${c.plano}|${c.anuais.quantidade > 0 ? "com-reforco" : "sem-reforco"}`;
    const atual = melhorPorChave.get(chave);
    if (!atual || c.entrada < atual.entrada) melhorPorChave.set(chave, c);
  }
  return [...melhorPorChave.values()].sort((a, b) => a.entrada - b.entrada || a.total - b.total);
}

const PRECOS = [98_750, 136_521, 145_451, 178_100, 185_400.5, 220_000, 434_999.99];

describe("⚠️ regressão: os outros empreendimentos saem IDÊNTICOS", () => {
  it("o cartão da tabela (entrada, parcela, financiado, total) é o mesmo número, ao bit", () => {
    let conferidos = 0;
    for (const { piso, planos } of REAIS) {
      for (const real of planos) {
        const plano = paraAConta(real);
        for (const preco of PRECOS) {
          const antes = cartaoAntigo(preco, plano, piso);
          const agora = condicaoDoPlano({ entradaMinimaPercentual: piso, plano, precoDeTabela: preco });
          expect(agora.precoDoPlano).toBe(preco);
          expect(agora.entrada).toBe(antes.entrada);
          expect(agora.parcela).toBe(antes.parcela);
          expect(agora.financiado).toBe(antes.financiado);
          expect(agora.total).toBe(antes.total);
          expect(agora.anuais).toEqual({ quantidade: 0, valor: 0 });
          expect(agora.ajuste).toBe(SEM_AJUSTE);
          conferidos += 1;
        }
      }
    }
    expect(conferidos).toBe(24 * PRECOS.length);
  });

  it("as outras composições são as mesmas, com ou sem o preço de tabela informado", () => {
    let comparadasComOsNumerosDeAntes = 0;
    for (const { piso, planos } of REAIS) {
      const daConta = planos.map(paraAConta);
      for (const preco of PRECOS) {
        for (const parcelaAlvo of [900, 1_500, 2_400, 3_450, 6_000]) {
          const antes = composicoesAntigas({
            entradaMinimaPercentual: piso,
            parcelaAlvo,
            planos: daConta,
            valor: preco,
          });
          // O preço de tabela diferente do valor (desconto à mão) NÃO pode mexer em plano sem desconto.
          const agora = composicoesQueFecham({
            entradaMinimaPercentual: piso,
            parcelaAlvo,
            planos: daConta,
            precoDeTabela: preco * 1.07,
            valor: preco,
          });
          expect(
            agora.map(
              ({ arranjoDoPlano: _a, descontoPercentual: _d, valor: _v, ...resto }) => resto,
            ),
          ).toEqual(antes);
          expect(
            agora.every(
              (c) => c.valor === preco && c.descontoPercentual === 0 && !c.arranjoDoPlano,
            ),
          ).toBe(true);
          // Contra os NÚMEROS de antes (anuais a valor presente): igual em tudo o que não é SACOC
          // com anual e juros. É o que a decisão de 18/09/2026 mudou, e só isso.
          const deAntes = composicoesAntigas({
            conta: contaAntiga,
            entradaMinimaPercentual: piso,
            parcelaAlvo,
            planos: daConta,
            valor: preco,
          });
          const naoMudou = (c: { anuais: { quantidade: number }; plano: string }) => {
            const p = daConta.find((x) => x.nome === c.plano)!;
            return c.anuais.quantidade === 0 || p.sistemaAmortizacao !== "sacoc" || p.taxaAoMes === 0;
          };
          const chave = (c: { anuais: { quantidade: number }; plano: string }) =>
            `${c.plano}|${c.anuais.quantidade > 0 ? "com" : "sem"}`;
          const semArranjo = agora.map(
            ({ arranjoDoPlano: _a, descontoPercentual: _d, valor: _v, ...resto }) => resto,
          );
          for (const c of deAntes.filter(naoMudou)) {
            expect(semArranjo.find((x) => chave(x) === chave(c))).toEqual(c);
          }
          for (const c of semArranjo.filter(naoMudou)) {
            expect(deAntes.find((x) => chave(x) === chave(c))).toEqual(c);
          }
          comparadasComOsNumerosDeAntes += deAntes.filter(naoMudou).length;

          // E com o preço de cada plano informado pela tela (o do cartão, que aqui é o do campo),
          // a lista é a mesma.
          expect(
            composicoesQueFecham({
              entradaMinimaPercentual: piso,
              parcelaAlvo,
              planos: daConta,
              precoDeTabela: preco,
              precos: daConta.map(() => preco),
              valor: preco,
            }),
          ).toEqual(agora);
        }
      }
    }
    expect(comparadasComOsNumerosDeAntes).toBeGreaterThan(300);
  });
});

// ── O CARTÃO É O CLIQUE ─────────────────────────────────────────────────────
describe("ajusteAoTrocarDePlano e precoDeTabelaDoCartao", () => {
  const manual = { modo: "percentual" as const, valor: -5 };

  it("o desconto do plano vai e vem com o plano", () => {
    expect(
      ajusteAoTrocarDePlano({ ajusteAtual: SEM_AJUSTE, descontoDoAnterior: 0, descontoDoNovo: 8 }),
    ).toEqual({ modo: "percentual", valor: -8 });
    expect(
      ajusteAoTrocarDePlano({
        ajusteAtual: { modo: "percentual", valor: -8 },
        descontoDoAnterior: 8,
        descontoDoNovo: 12,
      }),
    ).toEqual({ modo: "percentual", valor: -12 });
    expect(
      ajusteAoTrocarDePlano({
        ajusteAtual: { modo: "percentual", valor: -8 },
        descontoDoAnterior: 8,
        descontoDoNovo: 0,
      }),
    ).toBe(SEM_AJUSTE);
  });

  it("⚠️ entre planos sem desconto, o desconto à mão fica, como sempre ficou", () => {
    expect(
      ajusteAoTrocarDePlano({ ajusteAtual: manual, descontoDoAnterior: 0, descontoDoNovo: 0 }),
    ).toBe(manual);
    expect(
      ajusteAoTrocarDePlano({ ajusteAtual: manual, descontoDoAnterior: null, descontoDoNovo: undefined }),
    ).toBe(manual);
  });

  it("o preço do cartão é o preço que o clique carrega, em toda combinação", () => {
    const valorDaUnidade = 435_000;
    const ajustes = [SEM_AJUSTE, manual, { modo: "percentual" as const, valor: -8 }, { modo: "reais" as const, valor: -10_000 }];
    const descontos = [0, 8, 12];
    for (const ajusteAtual of ajustes) {
      for (const descontoDoAtivo of descontos) {
        const valorNaTela = aplicarAjuste(valorDaUnidade, ajusteAtual).valor;
        for (const plano of GARDEN) {
          for (const descontoDoPlano of descontos) {
            const noCartao = condicaoDoPlano({
              entradaMinimaPercentual: PISO_DO_GARDEN,
              plano: { ...plano, descontoPercentual: descontoDoPlano },
              precoDeTabela: precoDeTabelaDoCartao({
                descontoDoAtivo,
                descontoDoPlano,
                valorDaUnidade,
                valorNaTela,
              }),
            });
            const depoisDoClique = aplicarAjuste(
              valorDaUnidade,
              ajusteAoTrocarDePlano({ ajusteAtual, descontoDoAnterior: descontoDoAtivo, descontoDoNovo: descontoDoPlano }),
            ).valor;
            expect(noCartao.precoDoPlano).toBe(depoisDoClique);
          }
        }
      }
    }
  });
});

// ── O DESCONTO DO PLANO NÃO PEDE MOTIVO ─────────────────────────────────────
describe("ajusteFrenteAoPlano", () => {
  const base = { precoDeTabela: 435_000 };

  it("o desconto igual ao do plano é a tabela, não exceção", () => {
    expect(
      ajusteFrenteAoPlano({
        ...base,
        ajuste: { modo: "percentual", valor: -8 },
        descontoDoPlanoPercentual: 8,
        valorNegociado: 400_200,
      }),
    ).toBe("do-plano");
    // O mesmo dinheiro digitado em reais também é o do plano.
    expect(
      ajusteFrenteAoPlano({
        ...base,
        ajuste: { modo: "reais", valor: -34_800 },
        descontoDoPlanoPercentual: 8,
        valorNegociado: 400_200,
      }),
    ).toBe("do-plano");
  });

  it("além do plano é desconto; aquém do plano é acréscimo", () => {
    expect(
      ajusteFrenteAoPlano({
        ...base,
        ajuste: { modo: "percentual", valor: -10 },
        descontoDoPlanoPercentual: 8,
        valorNegociado: 391_500,
      }),
    ).toBe("desconto");
    expect(
      ajusteFrenteAoPlano({
        ...base,
        ajuste: { modo: "percentual", valor: -5 },
        descontoDoPlanoPercentual: 8,
        valorNegociado: 413_250,
      }),
    ).toBe("acrescimo");
  });

  it("⚠️ plano sem desconto responde pelo sinal do ajuste, como antes", () => {
    expect(
      ajusteFrenteAoPlano({ ...base, ajuste: { modo: "percentual", valor: -0.0001 }, descontoDoPlanoPercentual: 0, valorNegociado: 435_000 }),
    ).toBe("desconto");
    expect(
      ajusteFrenteAoPlano({ ...base, ajuste: { modo: "reais", valor: 500 }, descontoDoPlanoPercentual: null, valorNegociado: 435_500 }),
    ).toBe("acrescimo");
    expect(
      ajusteFrenteAoPlano({ ...base, ajuste: null, descontoDoPlanoPercentual: 8, valorNegociado: 435_000 }),
    ).toBe("nenhum");
    expect(
      ajusteFrenteAoPlano({ ...base, ajuste: SEM_AJUSTE, descontoDoPlanoPercentual: 0, valorNegociado: 435_000 }),
    ).toBe("nenhum");
  });
});

// ── AS OUTRAS COMPOSIÇÕES NO GARDEN ─────────────────────────────────────────
describe("composicoesQueFecham com desconto e anuais de plano", () => {
  const busca = (
    parcelaAlvo: number,
    extra: Partial<Parameters<typeof composicoesQueFecham>[0]> = {},
  ) =>
    composicoesQueFecham({
      entradaMinimaPercentual: PISO_DO_GARDEN,
      parcelaAlvo,
      planos: GARDEN,
      precoDeTabela: 435_000,
      valor: 435_000,
      ...extra,
    });

  it("cada plano compõe sobre o preço dele: a varredura livre E o arranjo do plano", () => {
    const r = busca(3_000);

    // O arranjo cadastrado (4 × R$ 25.000) tem a SUA linha, marcada como do plano…
    const doPlano = r.filter((c) => c.plano === "INVESTIDOR PARCELADO" && c.arranjoDoPlano);
    expect(doPlano).toHaveLength(1);
    expect(doPlano[0]?.anuais).toEqual({ quantidade: 4, valor: 25_000 });
    expect(doPlano[0]?.valor).toBe(400_200);
    expect(doPlano[0]?.descontoPercentual).toBe(8);
    // …e a varredura de sempre continua lá, sobre o mesmo preço do plano (18/09/2026: numa versão
    // anterior o plano com anual cadastrada compunha SÓ com as dele).
    const livres = r.filter((c) => c.plano === "INVESTIDOR PARCELADO" && !c.arranjoDoPlano);
    expect(livres.length).toBeGreaterThan(0);
    expect(livres.every((c) => c.valor === 400_200)).toBe(true);
    // A entrada respeita os 8% DO PREÇO DO PLANO (32.016 → 33.000 na conversa de mesa).
    for (const c of [...doPlano, ...livres]) expect(c.entrada).toBeGreaterThanOrEqual(33_000);

    for (const c of r.filter((x) => x.plano === "INVESTIDOR")) {
      expect(c.valor).toBe(382_800);
      // 40% de 382.800 = 153.120, arredondado no milhar.
      expect(c.entrada).toBeGreaterThanOrEqual(154_000);
    }
    for (const c of r.filter((x) => x.plano === "NORMAL")) expect(c.valor).toBe(435_000);

    // A parcela de cada composição é a conta do plano com a entrada dela, e nada além disso. Os três
    // planos do Garden têm anuais cadastradas: o reforço abate pelo valor de face (`temAnuaisCadastradas`).
    for (const c of r) {
      const plano = GARDEN.find((p) => p.nome === c.plano)!;
      expect(temAnuaisCadastradas(plano)).toBe(true);
      expect(
        montarProposta({
          anuaisCadastradasNoPlano: true,
          baloesQuantidade: c.anuais.quantidade,
          baloesValor: c.anuais.valor,
          entrada: c.entrada,
          parcelas: plano.parcelas,
          sistemaAmortizacao: plano.sistemaAmortizacao,
          taxaAoMes: plano.taxaAoMes,
          valor: c.valor,
        }).parcela,
      ).toBe(c.parcela);
    }
  });

  it("⚠️ o INVESTIDOR PARCELADO não some da busca por R$ 4.000 (a MMendes o recomenda ali)", () => {
    // 4 anuais de R$ 25.000 mais 84 × 4.000 já pagariam o lote: o arranjo do plano não fecha, e a
    // varredura livre é o que o mantém na lista, com a menor entrada.
    const r = busca(4_000);
    expect(r[0]?.plano).toBe("INVESTIDOR PARCELADO");
    expect(r[0]?.valor).toBe(400_200);
    expect(r.some((c) => c.plano === "INVESTIDOR PARCELADO" && c.arranjoDoPlano)).toBe(false);
  });

  it("o preço de cada plano pode vir da tela (o plano ativo com desconto à mão compõe no campo)", () => {
    // Investidor Parcelado com 10% no campo (R$ 391.500) em vez dos 8% do plano.
    const r = busca(3_000, { precos: [435_000, 391_500, 382_800] });
    const ip = r.filter((c) => c.plano === "INVESTIDOR PARCELADO");
    expect(ip.length).toBeGreaterThan(0);
    expect(ip.every((c) => c.valor === 391_500)).toBe(true);
    // O piso de 8% é do preço que foi negociado: 8% de 391.500 = 31.320 → 32.000.
    expect(ip.every((c) => c.entrada >= 32_000)).toBe(true);
    // Posição sem preço cai na regra de sempre.
    expect(busca(3_000, { precos: [null, undefined, 0] })).toEqual(busca(3_000));
  });
});

// ── AS REGRAS NOVAS DE 18/09/2026 ───────────────────────────────────────────
describe("descontoDoPlanoNoPrazo: o desconto só é do plano no prazo do plano", () => {
  it("no prazo do plano é o desconto dele; fora, é zero (exceção, pede nota)", () => {
    const d = (descontoDoPlano: unknown, parcelasDoPlano: number, parcelasEfetivas: number) =>
      descontoDoPlanoNoPrazo({ descontoDoPlano, parcelasDoPlano, parcelasEfetivas });
    expect(d(12, 36, 36)).toBe(12);
    expect(d(12, 36, 84)).toBe(0);
    expect(d(8, 84, 83)).toBe(0);
    expect(d(0, 60, 60)).toBe(0);
    expect(d(null, 60, 60)).toBe(0);
  });

  it("⚠️ fora do prazo, o desconto que ficou no campo pede nota como qualquer desconto à mão", () => {
    // O cenário da revisão: INVESTIDOR (12%) escolhido e levado a 84 parcelas.
    const foraDoPrazo = descontoDoPlanoNoPrazo({
      descontoDoPlano: 12,
      parcelasDoPlano: 36,
      parcelasEfetivas: 84,
    });
    const doze = { modo: "percentual" as const, valor: -12 };
    expect(
      ajusteFrenteAoPlano({
        ajuste: doze,
        descontoDoPlanoPercentual: foraDoPrazo,
        precoDeTabela: 435_000,
        valorNegociado: 382_800,
      }),
    ).toBe("desconto");
    // No prazo do plano, os mesmos 12% são a tabela.
    expect(
      ajusteFrenteAoPlano({
        ajuste: doze,
        descontoDoPlanoPercentual: 12,
        precoDeTabela: 435_000,
        valorNegociado: 382_800,
      }),
    ).toBe("do-plano");
  });
});

// `menorPrecoDePlano` (a tabela com o MAIOR desconto de qualquer plano) saiu na rodada 3 de
// 18/09/2026: era o piso do espelho público, e deixava o NORMAL sair com os 12% do INVESTIDOR. O piso
// agora é o do plano escolhido, no prazo (`valoresDaSimulacaoPublica`, lib/hercules/espelho).
describe("mesmoAjuste", () => {
  it("compara por valor, e zero é zero em qualquer moeda", () => {
    expect(mesmoAjuste({ modo: "percentual", valor: -8 }, { modo: "percentual", valor: -8 })).toBe(
      true,
    );
    expect(mesmoAjuste({ modo: "percentual", valor: -8 }, { modo: "reais", valor: -8 })).toBe(false);
    expect(mesmoAjuste(SEM_AJUSTE, { modo: "reais", valor: 0 })).toBe(true);
    expect(mesmoAjuste(SEM_AJUSTE, { modo: "percentual", valor: -0.5 })).toBe(false);
  });
});

describe("conferenciaDoPlano: a aba de planos do Apolo com a conta da Mesa", () => {
  it("INVESTIDOR PARCELADO do Garden, R$ 435.000: o número da Mesa e da MMendes", () => {
    const plano = {
      anuaisQuantidade: 4,
      anuaisValor: 25_000,
      descontoPercentual: 8,
      entradaPercentual: 8,
      indiceCorrecao: "IPCA_ANUAL",
      jurosConvencao: "equivalente",
      jurosPeriodicidade: "anual",
      jurosTaxa: 6,
      nome: "INVESTIDOR PARCELADO",
      parcelas: 84,
      sistemaAmortizacao: "sacoc",
      slot: null,
    } as PlanoComercial & {
      anuaisQuantidade: number;
      anuaisValor: number;
      descontoPercentual: number;
    };
    const c = conferenciaDoPlano({
      entradaMinimaPercentual: PISO_DO_GARDEN,
      plano,
      precoDeTabela: 435_000,
    });
    expect(c.precoDoPlano).toBe(400_200);
    expect(c.entrada).toBe(32_016);
    expect(c.anuais).toEqual({ quantidade: 4, valor: 25_000 });
    expect(Math.round(c.parcela * 100) / 100).toBe(3_192.67);
    expect(c.parcelas).toBe(84);
    expect(c.naturezaDaParcela).toBe("inicial");
    expect(c.parcela).toBe(aplicado(435_000, INVESTIDOR_PARCELADO).parcela);
  });

  it("⚠️ plano sem anual e sem desconto: o mesmo número do cartão da Mesa", () => {
    for (const { piso, planos } of REAIS) {
      for (const real of planos) {
        const cadastro = {
          entradaPercentual: real.entradaPercentual,
          indiceCorrecao: "IPCA_ANUAL",
          jurosConvencao: "equivalente",
          jurosPeriodicidade: real.jurosPeriodicidade,
          jurosTaxa: real.jurosTaxa,
          nome: real.nome,
          parcelas: real.parcelas,
          sistemaAmortizacao: real.sistema,
          slot: null,
        } as PlanoComercial;
        for (const preco of PRECOS) {
          const c = conferenciaDoPlano({
            entradaMinimaPercentual: piso,
            plano: cadastro,
            precoDeTabela: preco,
          });
          expect(c.parcela).toBe(
            condicaoDoPlano({
              entradaMinimaPercentual: piso,
              plano: paraAConta(real),
              precoDeTabela: preco,
            }).parcela,
          );
        }
      }
    }
  });
});
