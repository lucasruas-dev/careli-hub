import { describe, expect, it } from "vitest";

import { valorDigitado, valorParaOCampo } from "./valor-digitado";

describe("valorDigitado", () => {
  it("lê o formato brasileiro completo", () => {
    expect(valorDigitado("2.102,58")).toBe(2102.58);
    expect(valorDigitado("15.553,45")).toBe(15553.45);
    expect(valorDigitado("1.850.000,00")).toBe(1850000);
  });

  // ⚠️ O CASO QUE COBRAVA R$ 1,85. `Number("1.850".replace(",", "."))` devolve 1.85, e a edição
  // não falhava: o boleto saía com um real e oitenta e cinco no lugar de mil oitocentos e cinquenta.
  it("trata ponto com três dígitos como milhar, e não como decimal", () => {
    expect(valorDigitado("1.850")).toBe(1850);
    expect(valorDigitado("2.102")).toBe(2102);
    expect(valorDigitado("1.850.000")).toBe(1850000);
  });

  it("aceita o ponto decimal quando não pode ser milhar", () => {
    expect(valorDigitado("1850.5")).toBe(1850.5);
    expect(valorDigitado("1850.55")).toBe(1850.55);
  });

  it("aceita número simples e vírgula decimal", () => {
    expect(valorDigitado("1850")).toBe(1850);
    expect(valorDigitado("1850,5")).toBe(1850.5);
    expect(valorDigitado("0,01")).toBe(0.01);
  });

  it("aceita o cifrão e os espaços que vêm de copiar e colar", () => {
    expect(valorDigitado("R$ 2.102,58")).toBe(2102.58);
    expect(valorDigitado(" 1.850 ")).toBe(1850);
  });

  // ⚠️ RECUSAR É MELHOR DO QUE ADIVINHAR: antes, texto ilegível virava NaN, era descartado por um
  // `Number.isFinite`, e a tela fechava o editor como se tivesse salvado.
  it("recusa o que não é número", () => {
    expect(valorDigitado("abc")).toBeNull();
    expect(valorDigitado("")).toBeNull();
    expect(valorDigitado(null)).toBeNull();
    expect(valorDigitado("1,2,3")).toBeNull();
    expect(valorDigitado("-50")).toBeNull();
  });

  it("recusa zero e negativo, que não são cobrança", () => {
    expect(valorDigitado("0")).toBeNull();
    expect(valorDigitado("0,00")).toBeNull();
  });

  it("para nos centavos", () => {
    expect(valorDigitado("1850,555")).toBe(1850.56);
  });
});

describe("valorParaOCampo", () => {
  it("abre o campo no mesmo formato que ele aceita", () => {
    expect(valorParaOCampo(2102.58)).toBe("2.102,58");
    expect(valorParaOCampo(1850)).toBe("1.850,00");
  });

  it("ida e volta não muda o valor", () => {
    for (const v of [2102.58, 1850, 15553.45, 0.01, 382490.38]) {
      expect(valorDigitado(valorParaOCampo(v))).toBe(v);
    }
  });

  it("valor ausente devolve campo vazio", () => {
    expect(valorParaOCampo(null)).toBe("");
    expect(valorParaOCampo(Number.NaN)).toBe("");
  });
});
