import { describe, expect, it } from "vitest";

import {
  entradaParaAParcela,
  fatorDeAnuidade,
  montarProposta,
  valorPresenteDosBaloes,
} from "./simulacao";

describe("fatorDeAnuidade", () => {
  it("sem juros, é o próprio número de parcelas", () => {
    expect(fatorDeAnuidade(120, 0)).toBe(120);
  });

  it("com juros, vale menos que o número de parcelas", () => {
    // 1% ao mês em 120 meses: o fator é ~69,7 — cada real futuro vale menos que um real hoje.
    expect(fatorDeAnuidade(120, 0.01)).toBeCloseTo(69.7005, 3);
  });
});

describe("valorPresenteDosBaloes", () => {
  it("sem juros, é o valor de face", () => {
    expect(valorPresenteDosBaloes(3, 20_000, 0)).toBe(60_000);
  });

  it("⚠️ com juros, o balão vale MENOS do que o valor de face", () => {
    // Três balões anuais de 20 mil a 1% a.m.: o terceiro cai daqui a 36 meses. Somá-los pelo valor
    // de face reduziria a parcela além do que a conta permite, e a proposta sairia mais barata do
    // que o contrato consegue cumprir.
    const vp = valorPresenteDosBaloes(3, 20_000, 0.01);
    expect(vp).toBeLessThan(60_000);
    expect(vp).toBeCloseTo(47_478.81, 1);
  });

  it("zero balão é zero", () => {
    expect(valorPresenteDosBaloes(0, 20_000, 0.01)).toBe(0);
    expect(valorPresenteDosBaloes(3, 0, 0.01)).toBe(0);
  });
});

describe("montarProposta", () => {
  it("sem juros e sem balão, é divisão simples", () => {
    const r = montarProposta({
      baloesQuantidade: 0,
      baloesValor: 0,
      entrada: 20_000,
      parcelas: 100,
      taxaAoMes: 0,
      valor: 120_000,
    });
    expect(r.financiado).toBe(100_000);
    expect(r.parcela).toBe(1_000);
    expect(r.total).toBe(120_000);
  });

  it("com juros, a parcela cobre o custo do financiamento", () => {
    const r = montarProposta({
      baloesQuantidade: 0,
      baloesValor: 0,
      entrada: 20_000,
      parcelas: 100,
      taxaAoMes: 0.01,
      valor: 120_000,
    });
    // 100 mil financiados a 1% em 100 meses: a parcela passa de 1.000 e o total supera o preço.
    expect(r.parcela).toBeGreaterThan(1_000);
    expect(r.total).toBeGreaterThan(120_000);
  });

  it("o balão reduz a parcela, e o total continua fechando", () => {
    const sem = montarProposta({
      baloesQuantidade: 0,
      baloesValor: 0,
      entrada: 20_000,
      parcelas: 120,
      taxaAoMes: 0.007,
      valor: 200_000,
    });
    const com = montarProposta({
      baloesQuantidade: 3,
      baloesValor: 20_000,
      entrada: 20_000,
      parcelas: 120,
      taxaAoMes: 0.007,
      valor: 200_000,
    });

    expect(com.parcela).toBeLessThan(sem.parcela);
    // O que sai do bolso é entrada + 120 parcelas + os três balões.
    expect(com.total).toBeCloseTo(20_000 + com.parcela * 120 + 60_000, 2);
  });

  it("entrada maior que o valor não deixa o financiado negativo", () => {
    const r = montarProposta({
      baloesQuantidade: 0,
      baloesValor: 0,
      entrada: 300_000,
      parcelas: 60,
      taxaAoMes: 0.01,
      valor: 200_000,
    });
    expect(r.financiado).toBe(0);
    expect(r.parcela).toBe(0);
  });
});

describe("entradaParaAParcela", () => {
  it("⚠️ é o caminho inverso, e fecha com montarProposta", () => {
    // "Consigo pagar 1.500" é como o comprador fala. Sair disso para a entrada, na mão, é tentativa
    // e erro — e as duas contas têm de dar no mesmo ponto.
    const alvo = 1_500;
    const { entrada } = entradaParaAParcela({
      baloesQuantidade: 2,
      baloesValor: 15_000,
      parcela: alvo,
      parcelas: 120,
      taxaAoMes: 0.007,
      valor: 250_000,
    });

    const volta = montarProposta({
      baloesQuantidade: 2,
      baloesValor: 15_000,
      entrada,
      parcelas: 120,
      taxaAoMes: 0.007,
      valor: 250_000,
    });

    expect(volta.parcela).toBeCloseTo(alvo, 6);
  });

  it("parcela alta demais devolve entrada zero e diz quanto sobra", () => {
    const r = entradaParaAParcela({
      baloesQuantidade: 0,
      baloesValor: 0,
      parcela: 10_000,
      parcelas: 120,
      taxaAoMes: 0,
      valor: 200_000,
    });
    expect(r.entrada).toBe(0);
    // 120 × 10.000 = 1,2 mi para um lote de 200 mil: sobra 1 milhão.
    expect(r.sobra).toBe(1_000_000);
  });
});
