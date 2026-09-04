import { describe, expect, it } from "vitest";

import { faseDoCodigo, numeroDoCodigo, codigoDaVenda } from "./codigo-da-venda";

describe("codigoDaVenda", () => {
  it("⚠️ é o MESMO número em todas as fases — só a letra muda", () => {
    // Lucas, 04/09/2026: *"código de reserva, que vira depois código de proposta, que vira depois
    // código de contrato"*. Três números independentes dariam ao corretor três protocolos para a
    // mesma negociação.
    expect(codigoDaVenda(123, "reservado")).toBe("RS-000123");
    expect(codigoDaVenda(123, "proposta")).toBe("PR-000123");
    expect(codigoDaVenda(123, "contrato")).toBe("CT-000123");
  });

  it("⚠️ assinatura e faturamento continuam CT", () => {
    // Depois que o contrato existe, o documento é ele: assinar e faturar são atos SOBRE o
    // contrato, e um prefixo novo faria parecer que a venda virou outra coisa.
    expect(codigoDaVenda(123, "assinatura")).toBe("CT-000123");
    expect(codigoDaVenda(123, "faturado")).toBe("CT-000123");
  });

  it("etapa desconhecida volta para a reserva, que é onde o número nasceu", () => {
    expect(codigoDaVenda(123, "cancelado")).toBe("RS-000123");
    expect(codigoDaVenda(123)).toBe("RS-000123");
    expect(codigoDaVenda(123, "")).toBe("RS-000123");
  });

  it("enche com zeros até seis dígitos, e não corta o que passa disso", () => {
    expect(codigoDaVenda(1, "reservado")).toBe("RS-000001");
    expect(codigoDaVenda(1_234_567, "reservado")).toBe("RS-1234567");
  });

  it("sem número não inventa protocolo", () => {
    expect(codigoDaVenda(null)).toBe("");
    expect(codigoDaVenda(undefined)).toBe("");
    expect(codigoDaVenda(Number.NaN)).toBe("");
  });
});

describe("faseDoCodigo", () => {
  it("diz o que o prefixo significa", () => {
    expect(faseDoCodigo("RS-000123")).toBe("reserva");
    expect(faseDoCodigo("PR-000123")).toBe("proposta");
    expect(faseDoCodigo("CT-000123")).toBe("contrato");
  });

  it("prefixo que não conhecemos não vira palpite", () => {
    expect(faseDoCodigo("XX-000123")).toBeNull();
    expect(faseDoCodigo("")).toBeNull();
  });
});

describe("numeroDoCodigo", () => {
  it("⚠️ aceita as três formas que a pessoa tem na mão", () => {
    // Quem procura digita o que anotou: o protocolo de qualquer fase, sem prefixo, ou só o número.
    // Exigir o formato exato transformaria a busca num quiz sobre a nossa convenção.
    expect(numeroDoCodigo("CT-000123")).toBe(123);
    expect(numeroDoCodigo("rs-000123")).toBe(123);
    expect(numeroDoCodigo("RS 000123")).toBe(123);
    expect(numeroDoCodigo("000123")).toBe(123);
    expect(numeroDoCodigo("123")).toBe(123);
  });

  it("o protocolo volta ao número que o gerou, ida e volta", () => {
    for (const n of [1, 42, 999_999]) {
      expect(numeroDoCodigo(codigoDaVenda(n, "contrato"))).toBe(n);
    }
  });

  it("texto sem número não vira busca", () => {
    expect(numeroDoCodigo("")).toBeNull();
    expect(numeroDoCodigo("   ")).toBeNull();
    expect(numeroDoCodigo("contrato")).toBeNull();
    expect(numeroDoCodigo(null)).toBeNull();
  });
});
