import { describe, expect, it } from "vitest";

import { conferirEntradaMontada, partesIguais, redistribuirDemais } from "./entrada-montada";

describe("conferirEntradaMontada — menor não pode, maior pode", () => {
  it("fecha exatamente: a entrada continua a combinada", () => {
    const r = conferirEntradaMontada(28_000, [7_000, 7_000, 7_000, 7_000]);
    expect(r.ok).toBe(true);
    expect(r.entrada).toBe(28_000);
    expect(r.excedente).toBe(0);
    expect(r.falta).toBe(0);
  });

  it("⚠️ somando MENOS, recusa — e diz quanto falta", () => {
    // Vender por menos do que foi negociado: o financiado cresce, a parcela sobe e o papel deixa
    // de bater com a conta que a mesa fez.
    const r = conferirEntradaMontada(28_000, [7_000, 7_000, 7_000, 5_000]);
    expect(r.ok).toBe(false);
    expect(r.falta).toBe(2_000);
    expect(r.entrada).toBe(28_000);
  });

  it("⚠️ somando MAIS, aceita e a ENTRADA ACOMPANHA", () => {
    // Lucas: *"o que não pode é ser menor; maior pode, e ao ser maior, atualizar o valor de
    // entrada"*. É o cliente pagando mais no ato — o financiado cai junto.
    const r = conferirEntradaMontada(28_000, [10_000, 7_000, 7_000, 7_000]);
    expect(r.ok).toBe(true);
    expect(r.entrada).toBe(31_000);
    expect(r.excedente).toBe(3_000);
    expect(r.falta).toBe(0);
  });

  it("⚠️ soma em centavos: 3.333,33 × 3 fecha 10.000 quando a primeira leva o resto", () => {
    // Em ponto flutuante isso dá 9.999,989999999998 e a comparação ingênua recusaria a divisão
    // mais comum que existe entre três parcelas.
    const r = conferirEntradaMontada(10_000, [3_333.34, 3_333.33, 3_333.33]);
    expect(r.ok).toBe(true);
    expect(r.soma).toBe(10_000);
    expect(r.excedente).toBe(0);
  });

  it("um centavo a menos ainda é menos", () => {
    const r = conferirEntradaMontada(10_000, [3_333.33, 3_333.33, 3_333.33]);
    expect(r.ok).toBe(false);
    expect(r.falta).toBe(0.01);
  });

  it("parcela vazia ou meio digitada conta como zero, sem quebrar", () => {
    // É o estado normal enquanto a pessoa preenche: quem decide quando reclamar é a tela.
    const r = conferirEntradaMontada(28_000, [7_000, Number.NaN, 7_000, 7_000]);
    expect(r.ok).toBe(false);
    expect(r.soma).toBe(21_000);
  });

  it("lista vazia não fecha entrada nenhuma", () => {
    const r = conferirEntradaMontada(28_000, []);
    expect(r.ok).toBe(false);
    expect(r.falta).toBe(28_000);
  });
});

describe("partesIguais — o ponto de partida da montagem", () => {
  it("divide exato quando dá", () => {
    expect(partesIguais(28_000, 4)).toEqual([7_000, 7_000, 7_000, 7_000]);
  });

  it("⚠️ o resto vai na PRIMEIRA, como no cronograma", () => {
    // A montagem começa exatamente do que a proposta faria sozinha: quem não mexer em nada tem o
    // mesmo resultado de antes.
    expect(partesIguais(10_000, 3)).toEqual([3_333.34, 3_333.33, 3_333.33]);
  });

  it("o que ela devolve sempre fecha o total", () => {
    for (const [total, vezes] of [
      [10_000, 3],
      [28_000, 4],
      [13_652.1, 7],
      [145_451, 6],
    ] as Array<[number, number]>) {
      const r = conferirEntradaMontada(total, partesIguais(total, vezes));
      expect(r.ok, `${total} em ${vezes}x`).toBe(true);
      expect(r.excedente, `${total} em ${vezes}x`).toBe(0);
    }
  });

  it("uma vez só é o valor inteiro", () => {
    expect(partesIguais(13_500, 1)).toEqual([13_500]);
  });

  it("entrada inválida devolve lista vazia em vez de NaN", () => {
    expect(partesIguais(10_000, 0)).toEqual([]);
    expect(partesIguais(10_000, 1.5)).toEqual([]);
    expect(partesIguais(Number.NaN, 3)).toEqual([]);
  });
});

describe("redistribuirDemais — 'a primeira é 10 mil, divide o resto'", () => {
  it("mantém a fixada e reparte o que sobra", () => {
    const r = redistribuirDemais(28_000, [10_000, 6_000, 6_000, 6_000], 0);
    expect(r).toEqual([10_000, 6_000, 6_000, 6_000]);
    expect(conferirEntradaMontada(28_000, r).ok).toBe(true);
  });

  it("fixando no meio, as outras se ajustam e a soma fecha", () => {
    const r = redistribuirDemais(30_000, [0, 15_000, 0], 1);
    expect(r[1]).toBe(15_000);
    expect(conferirEntradaMontada(30_000, r).soma).toBe(30_000);
  });

  it("⚠️ fixado maior que o total não gera parcela negativa", () => {
    // Parcela negativa não existe. O excedente é tratado por `conferirEntradaMontada`, que sobe a
    // entrada.
    const r = redistribuirDemais(28_000, [40_000, 0, 0], 0);
    expect(r).toEqual([40_000, 0, 0]);
    expect(r.every((v) => v >= 0)).toBe(true);
    expect(conferirEntradaMontada(28_000, r).entrada).toBe(40_000);
  });

  it("com uma parcela só, ela é o total fixado", () => {
    expect(redistribuirDemais(13_500, [13_500], 0)).toEqual([13_500]);
  });

  it("lista vazia volta vazia", () => {
    expect(redistribuirDemais(10_000, [], 0)).toEqual([]);
  });
});
