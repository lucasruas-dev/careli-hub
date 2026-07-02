import { describe, expect, it } from "vitest";

import {
  buildBrazilianPhoneVariants,
  toWhatsAppFormatting,
} from "./meta-whatsapp";

describe("toWhatsAppFormatting", () => {
  it("converte **negrito** Markdown para *negrito* do WhatsApp", () => {
    expect(toWhatsAppFormatting("Olá **Lucas**, tudo bem?")).toBe(
      "Olá *Lucas*, tudo bem?",
    );
  });

  it("converte __negrito__ para *negrito*", () => {
    expect(toWhatsAppFormatting("valor __R$ 100,00__")).toBe(
      "valor *R$ 100,00*",
    );
  });

  it("converte cabeçalho Markdown em negrito sem o #", () => {
    expect(toWhatsAppFormatting("## Resumo da carteira")).toBe(
      "*Resumo da carteira*",
    );
  });

  it("trata múltiplos trechos e linhas de uma vez", () => {
    const input = "# Boleto\nSegue o **link** do boleto.\nVence __hoje__.";

    expect(toWhatsAppFormatting(input)).toBe(
      "*Boleto*\nSegue o *link* do boleto.\nVence *hoje*.",
    );
  });

  it("não altera texto que já está no formato do WhatsApp", () => {
    const alreadyFormatted = "Olá *Lucas*, _tudo bem_?";

    expect(toWhatsAppFormatting(alreadyFormatted)).toBe(alreadyFormatted);
  });
});

describe("buildBrazilianPhoneVariants", () => {
  it("gotcha do 9º dígito: casa as formas com e sem 9 (com e sem DDI)", () => {
    // Apolo grava COM 9, o inbound da Meta chega SEM 9 — sem casar as
    // variantes nascem contato e ticket duplicados (incidente 30/jun).
    const variants = buildBrazilianPhoneVariants("5531999998888");

    expect(variants).toContain("5531999998888");
    expect(variants).toContain("553199998888");
    expect(variants).toContain("31999998888");
    expect(variants).toContain("3199998888");
  });

  it("nacional sem DDI (11 dígitos) gera a forma com 55", () => {
    const variants = buildBrazilianPhoneVariants("31999998888");

    expect(variants).toContain("5531999998888");
    expect(variants).toContain("553199998888");
  });

  it("ignora máscara/formatação na entrada", () => {
    const variants = buildBrazilianPhoneVariants("+55 (31) 99999-8888");

    expect(variants).toContain("5531999998888");
    expect(variants).toContain("553199998888");
  });

  it("entrada curta ou vazia devolve lista vazia", () => {
    expect(buildBrazilianPhoneVariants("1234567")).toEqual([]);
    expect(buildBrazilianPhoneVariants("")).toEqual([]);
    expect(buildBrazilianPhoneVariants(null)).toEqual([]);
    expect(buildBrazilianPhoneVariants(undefined)).toEqual([]);
  });
});
