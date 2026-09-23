// O "TOTAL PAGO" DA SIMULAÇÃO É A SOMA DO QUE ESTÁ NA TELA — sem juros embutidos.
//
// Lucas (22/09/2026), nos dois prints do espelho público do Garden: *"o valor pago tem que ser o
// valor do lote, está cobrando juros errado. não calculamos juros nessa etapa, é somente
// informativo."*
//
// O que ele viu, medido aqui: a PARCELA já saía certa (amortização pura do SACOC) e era o TOTAL que
// somava outra coisa — `somaDasMensais`, que reconstrói o degrau do aniversário. R$ 43.217,43 a mais
// na Quadra 04 Lote 16 e R$ 55.268,50 na Quadra 03 Lote 07, num cartão que anuncia
// "R$ 3.001,21 por mês, 84 vezes" logo acima.

import { describe, expect, it } from "vitest";

import { composicoesQueFecham, type PlanoDaComposicao } from "./composicoes";
import { montarProposta, somaDasMensais } from "./simulacao";
import { condicaoDoPlano } from "./tabela-do-lote";

/** 6% ao ano na convenção equivalente, que é a do cadastro do Garden (`temis_planos`, emp. 39). */
const I_GARDEN = 1.06 ** (1 / 12) - 1;

/** INVESTIDOR PARCELADO do Garden: 84x, entrada 8%, desconto 8%, 4 anuais de R$ 25.000, SACOC. */
const INVESTIDOR_PARCELADO = {
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  descontoPercentual: 8,
  entradaPercentual: 8,
  nome: "INVESTIDOR PARCELADO",
  parcelas: 84,
  sistemaAmortizacao: "sacoc",
  taxaAoMes: I_GARDEN,
} as const satisfies PlanoDaComposicao;

describe("o print do Lucas: Quadra 04 Lote 16 do Garden", () => {
  // Tabela R$ 416.000, desconto de 8% do plano → R$ 382.720. A entrada do plano é 8% desse preço
  // (R$ 30.618) e as 4 anuais de R$ 25.000 abatem o saldo pelo valor de face: sobram R$ 252.102,
  // que em 84 meses de SACOC dão exatamente os R$ 3.001,21 do cartão.
  const condicao = condicaoDoPlano({
    entradaMinimaPercentual: 8,
    plano: INVESTIDOR_PARCELADO,
    precoDeTabela: 416_000,
  });

  it("a parcela, a entrada e o financiado são os do print", () => {
    expect(condicao.precoDoPlano).toBe(382_720);
    expect(condicao.entrada).toBe(30_618);
    expect(condicao.anuais).toEqual({ quantidade: 4, valor: 25_000 });
    expect(condicao.financiado).toBe(252_102);
    expect(Math.round(condicao.parcela * 100) / 100).toBe(3_001.21);
  });

  it("⚠️ o TOTAL PAGO é entrada + anuais + as 84 mensais anunciadas, e fecha com o valor do lote", () => {
    expect(condicao.entrada + 4 * 25_000 + condicao.parcela * 84).toBeCloseTo(382_720, 6);
    expect(condicao.total).toBeCloseTo(382_720, 6);
  });

  it("medição do defeito: o degrau do SACOC punha R$ 43.217,43 a mais no total", () => {
    const comODegrau =
      condicao.entrada +
      4 * 25_000 +
      somaDasMensais({
        financiado: condicao.financiado,
        parcelas: 84,
        sistemaAmortizacao: "sacoc",
        taxaAoMes: I_GARDEN,
      });
    expect(comODegrau).toBeCloseTo(425_937.43, 2);
    expect(comODegrau - condicao.total).toBeCloseTo(43_217.43, 2);
  });
});

describe("o print do Lucas: Quadra 03 Lote 07 do Garden, com entrada digitada à mão", () => {
  // Tabela R$ 470.000, desconto de 8% → R$ 432.400. A entrada é R$ 10.000, digitada na mesa (o
  // plano pediria R$ 34.592): a financiar R$ 322.400 e parcela de R$ 3.838,10 em 84 vezes.
  const montada = montarProposta({
    anuaisCadastradasNoPlano: true,
    baloesQuantidade: 4,
    baloesValor: 25_000,
    entrada: 10_000,
    parcelas: 84,
    sistemaAmortizacao: "sacoc",
    taxaAoMes: I_GARDEN,
    valor: 432_400,
  });

  it("a parcela e o financiado são os do print", () => {
    expect(montada.financiado).toBe(322_400);
    expect(Math.round(montada.parcela * 100) / 100).toBe(3_838.1);
  });

  it("⚠️ o TOTAL PAGO fecha com o valor do lote, e não com os R$ 487.668 que a tela imprimia", () => {
    expect(montada.total).toBeCloseTo(432_400, 6);
    expect(10_000 + 4 * 25_000 + montada.parcela * 84).toBeCloseTo(montada.total, 6);
  });
});

describe("⚠️ a régua é UMA SÓ: a lista de composições soma o mesmo que o cartão", () => {
  // O cartão grande e cada linha de "OUTRAS COMPOSIÇÕES COM R$ X POR MÊS" leem o mesmo `total`, que
  // nasce em `montarProposta`. Sem esta varredura, corrigir o cartão deixaria a lista logo abaixo
  // dele anunciando outro número para a mesma composição.
  const PLANOS: PlanoDaComposicao[] = [
    { ...INVESTIDOR_PARCELADO },
    {
      anuaisQuantidade: 5,
      anuaisValor: 25_000,
      entradaPercentual: 10,
      nome: "NORMAL",
      parcelas: 60,
      sistemaAmortizacao: "sacoc",
      taxaAoMes: I_GARDEN,
    },
    {
      entradaPercentual: 10,
      nome: "PRICE DA CASA",
      parcelas: 120,
      sistemaAmortizacao: "price",
      taxaAoMes: I_GARDEN,
    },
  ];

  it("todas as composições: total = entrada + anuais + parcela × parcelas", () => {
    let conferidas = 0;
    for (const parcelaAlvo of [1_500, 2_400, 3_000, 4_000, 6_000]) {
      for (const preco of [382_720, 416_000, 432_400, 470_000]) {
        for (const c of composicoesQueFecham({
          entradaMinimaPercentual: 8,
          parcelaAlvo,
          planos: PLANOS,
          precoDeTabela: preco,
          valor: preco,
        })) {
          expect(c.total).toBeCloseTo(
            c.entrada + c.anuais.quantidade * c.anuais.valor + c.parcela * c.parcelas,
            6,
          );
          conferidas += 1;
        }
      }
    }
    expect(conferidas).toBeGreaterThan(20);
  });
});
