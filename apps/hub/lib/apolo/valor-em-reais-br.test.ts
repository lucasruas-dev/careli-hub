import { describe, expect, it } from "vitest";

import {
  descreverConferencia,
  FRASE_DO_FORMATO_DO_VALOR,
  LIMITE_DA_OBSERVACAO_DA_CONFERENCIA,
  lerValorEmReaisBr,
} from "./valor-em-reais-br";

// ⚠️ O ACHADO DE 01/10/2026: "7.000" gravava R$ 7,00, "R$ 12.500" gravava R$ 12,50 e "3.500" gravava
// R$ 3,50, todos com 200. Ponto é SEMPRE milhar e vírgula é SEMPRE decimal; o que foge disso é
// recusado, e não adivinhado.
describe("lerValorEmReaisBr", () => {
  it.each([
    ["7.000", 7000],
    ["12.500", 12500],
    ["3.500", 3500],
    ["7.000,50", 7000.5],
    ["7000", 7000],
    ["7000,5", 7000.5],
    ["7000,50", 7000.5],
    ["1.000.000,00", 1000000],
    ["R$ 7.000,00", 7000],
    ["  R$7.000  ", 7000],
    ["r$ 12.500", 12500],
    ["0,50", 0.5],
    ["999", 999],
    ["1.234,56", 1234.56],
  ])("texto %j vira %d", (texto, esperado) => {
    expect(lerValorEmReaisBr(texto)).toBe(esperado);
  });

  it.each([
    "7.5",
    "7.00",
    "7000.50",
    "7,000.50",
    "7.000.5",
    "7,",
    ",50",
    "7.00,00",
    "1.0000",
    "",
    "   ",
    "R$",
    "-7.000",
    "-7000",
    "7000,505",
    "7.000,505",
    "0",
    "0,00",
    "abc",
    "7 000",
    "7.000,50,00",
    "10.000.000.000",
  ])("texto %j é recusado", (texto) => {
    expect(lerValorEmReaisBr(texto)).toBeNull();
  });

  it("número JSON: finito, positivo e com no máximo 2 casas", () => {
    expect(lerValorEmReaisBr(7000)).toBe(7000);
    expect(lerValorEmReaisBr(7000.5)).toBe(7000.5);
    expect(lerValorEmReaisBr(1234.56)).toBe(1234.56);
    expect(lerValorEmReaisBr(0.01)).toBe(0.01);
  });

  it.each([0, -1, -7000, 7.005, 7000.123, Number.NaN, Number.POSITIVE_INFINITY, 1e10, 1e12])(
    "número JSON %d é recusado",
    (numero) => {
      expect(lerValorEmReaisBr(numero)).toBeNull();
    },
  );

  it("o que não é texto nem número é recusado", () => {
    for (const torto of [null, undefined, true, {}, [], ["7.000"]]) {
      expect(lerValorEmReaisBr(torto)).toBeNull();
    }
  });

  it("o limite do numeric(12,2): 9.999.999.999,99 passa e 10 bilhões não", () => {
    expect(lerValorEmReaisBr("9.999.999.999,99")).toBe(9999999999.99);
    expect(lerValorEmReaisBr("10.000.000.000,00")).toBeNull();
  });

  it("a frase do formato dá o exemplo", () => {
    expect(FRASE_DO_FORMATO_DO_VALOR).toContain("7.000,50");
  });
});

// ⚠️ O TEXTO DA CONFIRMAÇÃO E DA MENSAGEM DE SUCESSO: o valor por extenso é o que deixa a coordenação
// ver que "7.000" é sete mil e não setenta mil.
describe("descreverConferencia", () => {
  it("'houve' escreve o valor formatado e por extenso", () => {
    expect(descreverConferencia("com_corretagem", 7000)).toBe("houve corretagem de R$ 7.000,00 (sete mil reais)");
  });

  it("com centavos", () => {
    expect(descreverConferencia("com_corretagem", 1234.5)).toBe(
      "houve corretagem de R$ 1.234,50 (um mil duzentos e trinta e quatro reais e cinquenta centavos)",
    );
  });

  it("'não houve' não tem valor", () => {
    expect(descreverConferencia("sem_corretagem", null)).toBe("não houve corretagem");
    expect(descreverConferencia("sem_corretagem", 5000)).toBe("não houve corretagem");
  });

  it("'houve' sem valor legível não inventa número, e nunca vira 'não houve'", () => {
    expect(descreverConferencia("com_corretagem", null)).toBe("houve corretagem (valor não informado)");
  });

  it("o espaço depois do R$ é comum, e não o sem quebra do Intl", () => {
    expect(descreverConferencia("com_corretagem", 7000)).not.toContain("\u00a0");
  });

  it("o teto da observação é 1000, o mesmo do CHECK da 0202", () => {
    expect(LIMITE_DA_OBSERVACAO_DA_CONFERENCIA).toBe(1000);
  });
});
