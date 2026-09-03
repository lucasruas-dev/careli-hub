import { describe, expect, it } from "vitest";

import {
  composicoesQueFecham,
  ENTRADA_MINIMA_PERCENTUAL,
  entradaMinima,
  type PlanoDaComposicao,
} from "./composicoes";
import { montarProposta } from "./simulacao";

const PLANOS: PlanoDaComposicao[] = [
  { entradaPercentual: 20, nome: "Investidor", parcelas: 24, taxaAoMes: 0.0072 },
  { entradaPercentual: 20, nome: "Curto", parcelas: 36, taxaAoMes: 0.0072 },
  { entradaPercentual: 10, nome: "Normal", parcelas: 156, taxaAoMes: 0.0072 },
];

describe("composicoesQueFecham", () => {
  it("devolve uma composição por plano, partindo da parcela", () => {
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });

    expect(r.length).toBeGreaterThan(0);
    expect(new Set(r.map((c) => c.plano)).size).toBeGreaterThan(1);
    // Toda composição devolvida entrega a parcela pedida, ou menos (a entrada foi arredondada
    // para cima, e isso só derruba a parcela).
    for (const c of r) expect(c.parcela).toBeLessThanOrEqual(3_450 + 0.01);
  });

  it("⚠️ ordena pela MENOR ENTRADA — é ela que trava a venda", () => {
    // O cliente já disse que a parcela cabe; o que falta é o dinheiro de agora. Ordenar por total
    // pago colocaria na frente a proposta com a maior entrada, que é justamente a que ele não tem.
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });
    const entradas = r.map((c) => c.entrada);
    expect([...entradas].sort((a, b) => a - b)).toEqual(entradas);
  });

  it("⚠️ parcela que já paga o lote não vira composição com entrada zero", () => {
    // 156 × 5.000 = 780 mil para um lote de 136 mil. Devolver "entrada zero" faria o corretor
    // prometer o que não existe; a resposta certa é não oferecer aquela composição.
    const r = composicoesQueFecham({ parcelaAlvo: 5_000, planos: PLANOS, valor: 136_521 });
    for (const c of r) expect(c.entrada).toBeGreaterThan(0);
  });

  it("⚠️ nenhuma composição fica abaixo do MÍNIMO de 10%", () => {
    // Lucas, 03/09/2026: *"lembrando que temos um valor mínimo de entrada, 10%"*. Antes disso a
    // varredura oferecia "entrada R$ 3.000" num lote de R$ 136.521 — 2%, que a casa não vende.
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });
    expect(r.length).toBeGreaterThan(0);
    for (const c of r) expect(c.entrada).toBeGreaterThanOrEqual(entradaMinima(136_521));
    expect(ENTRADA_MINIMA_PERCENTUAL).toBe(10);
  });

  it("⚠️ parcela alta ANCORA no piso em vez de sumir, e a parcela cai junto", () => {
    // Com entrada no mínimo, a parcela sai MENOR que a pedida — é notícia boa, não motivo para
    // esconder a composição.
    const r = composicoesQueFecham({ parcelaAlvo: 4_000, planos: PLANOS, valor: 136_521 });
    expect(r.length).toBeGreaterThan(0);
    for (const c of r) expect(c.parcela).toBeLessThanOrEqual(4_000 + 0.01);
  });

  it("⚠️ o mínimo do EMPREENDIMENTO manda sobre o padrão da casa", () => {
    // Lucas, 03/09/2026: *"vamos ter um campo dentro da parte que vamos cadastrar a política
    // comercial e lá vamos apontar a % mínima"*. O Garden vende a 8% onde os outros exigem 10%.
    const r = composicoesQueFecham({
      entradaMinimaPercentual: 8,
      parcelaAlvo: 3_450,
      planos: PLANOS,
      valor: 136_521,
    });
    expect(r.length).toBeGreaterThan(0);
    for (const c of r) expect(c.entrada).toBeGreaterThanOrEqual(entradaMinima(136_521, 8));
  });

  it("⚠️ mínimo ZERO é uma decisão, e não vira o padrão da casa", () => {
    // Empreendimento que aceita venda sem entrada é cadastrável; tratar 0 como "não cadastrado"
    // desfaria essa decisão em silêncio.
    expect(entradaMinima(136_521, 0)).toBe(0);
    const r = composicoesQueFecham({
      entradaMinimaPercentual: 0,
      parcelaAlvo: 3_450,
      planos: PLANOS,
      valor: 136_521,
    });
    const minimaDelas = Math.min(...r.map((c) => c.entrada));
    expect(minimaDelas).toBeLessThan(entradaMinima(136_521));
  });

  it("nulo cai no padrão da casa", () => {
    expect(entradaMinima(136_521, null)).toBe(entradaMinima(136_521));
    expect(entradaMinima(136_521, undefined)).toBe(entradaMinima(136_521));
  });

  it("respeita o teto de entrada do cliente", () => {
    const r = composicoesQueFecham({
      parcelaAlvo: 3_450,
      planos: PLANOS,
      tetoDaEntrada: 30_000,
      valor: 136_521,
    });
    expect(r.length).toBeGreaterThan(0);
    for (const c of r) expect(c.entrada).toBeLessThanOrEqual(30_000);
  });

  it("o reforço anual baixa a entrada, e aparece como alternativa", () => {
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });
    const comReforco = r.filter((c) => c.anuais.quantidade > 0);
    const semReforco = r.filter((c) => c.anuais.quantidade === 0);

    expect(comReforco.length).toBeGreaterThan(0);
    // Para o MESMO plano, a versão com reforço pede menos entrada.
    for (const c of comReforco) {
      const par = semReforco.find((s) => s.plano === c.plano);
      if (par) expect(c.entrada).toBeLessThanOrEqual(par.entrada);
    }
  });

  it("⚠️ a entrada sai arredondada para o milhar", () => {
    // "Entrada de R$ 27.304" é resultado de planilha; "R$ 28.000" é o que se fala numa mesa.
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });
    for (const c of r) expect(c.entrada % 1_000).toBe(0);
  });

  it("cada composição fecha a conta: entrada + parcelas + reforços = total", () => {
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });
    for (const c of r) {
      const conferida = montarProposta({
        baloesQuantidade: c.anuais.quantidade,
        baloesValor: c.anuais.valor,
        entrada: c.entrada,
        parcelas: c.parcelas,
        taxaAoMes: 0.0072,
        valor: 136_521,
      });
      expect(c.total).toBeCloseTo(conferida.total, 2);
    }
  });

  it("⚠️ o reforço anual não passa do PRAZO do plano", () => {
    // O k-ésimo reforço cai no mês 12k. Num plano de 24 meses cabem dois; oferecer cinco cobraria
    // dinheiro depois da última parcela, e a conta desconta esse dinheiro do saldo hoje.
    const r = composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 136_521 });
    for (const c of r) {
      expect(c.anuais.quantidade).toBeLessThanOrEqual(Math.floor(c.parcelas / 12));
    }
  });

  it("sem parcela ou sem valor, não inventa nada", () => {
    expect(composicoesQueFecham({ parcelaAlvo: 0, planos: PLANOS, valor: 136_521 })).toEqual([]);
    expect(composicoesQueFecham({ parcelaAlvo: 3_450, planos: PLANOS, valor: 0 })).toEqual([]);
    expect(composicoesQueFecham({ parcelaAlvo: 3_450, planos: [], valor: 136_521 })).toEqual([]);
  });
});
