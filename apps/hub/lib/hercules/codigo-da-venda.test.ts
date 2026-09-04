import { describe, expect, it } from "vitest";

import { codigoDaVenda, numeroDoCodigo } from "./codigo-da-venda";

describe("codigoDaVenda", () => {
  it("⚠️ é UM código, e ele não muda de estágio", () => {
    // Lucas, 04/09/2026, desfazendo o prefixo por fase que eu tinha proposto: *"eu não gosto do RS,
    // acho que tem que ser um código somente, aí ele vai existir unicamente independente do
    // estágio"*. Um código que muda de cara não é o mesmo código.
    expect(codigoDaVenda(123)).toBe("000123");
    expect(codigoDaVenda(1)).toBe("000001");
  });

  it("não corta o número quando ele passa de seis dígitos", () => {
    expect(codigoDaVenda(1_234_567)).toBe("1234567");
  });

  it("sem número não inventa código", () => {
    expect(codigoDaVenda(null)).toBe("");
    expect(codigoDaVenda(undefined)).toBe("");
    expect(codigoDaVenda(Number.NaN)).toBe("");
  });
});

describe("numeroDoCodigo", () => {
  it("⚠️ aceita as formas que a pessoa tem na mão", () => {
    // Quem procura digita o que anotou. Exigir o formato exato transformaria a busca num quiz
    // sobre a nossa convenção.
    expect(numeroDoCodigo("000123")).toBe(123);
    expect(numeroDoCodigo("123")).toBe(123);
    expect(numeroDoCodigo(" 000123 ")).toBe(123);
  });

  it("ignora prefixo de letras, inclusive o RS- que existiu por algumas horas", () => {
    expect(numeroDoCodigo("RS-000123")).toBe(123);
    expect(numeroDoCodigo("ct-000123")).toBe(123);
  });

  it("o código volta ao número que o gerou, ida e volta", () => {
    for (const n of [1, 42, 999_999]) {
      expect(numeroDoCodigo(codigoDaVenda(n))).toBe(n);
    }
  });

  it("texto sem número não vira busca", () => {
    expect(numeroDoCodigo("")).toBeNull();
    expect(numeroDoCodigo("   ")).toBeNull();
    expect(numeroDoCodigo("contrato")).toBeNull();
    expect(numeroDoCodigo(null)).toBeNull();
  });
});
