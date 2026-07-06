import { describe, expect, it } from "vitest";

import {
  buildC2xWhatsAppNumber,
  fixLegacyBrazilianMobileNumber,
} from "./phone-country";

describe("buildC2xWhatsAppNumber", () => {
  it("celular BR moderno passa intacto (com e sem 55 no cadastro)", () => {
    expect(buildC2xWhatsAppNumber("+55", "(37) 9 9938-4413")).toBe(
      "5537999384413",
    );
    expect(buildC2xWhatsAppNumber("", "5537999384413")).toBe("5537999384413");
  });

  it("regressão AT-000229: celular BR no formato ANTIGO ganha o 9º dígito", () => {
    // C2X guardava (37) 9938-4413 — o envio saía 553799384413 e a Meta devolvia
    // 131026 Message Undeliverable.
    expect(buildC2xWhatsAppNumber("+55", "(37) 9938-4413")).toBe(
      "5537999384413",
    );
    expect(buildC2xWhatsAppNumber(null, "3799384413")).toBe("5537999384413");
  });

  it("fixo BR (assinante 2-5) NÃO ganha 9", () => {
    expect(buildC2xWhatsAppNumber("+55", "(37) 3221-4455")).toBe(
      "553732214455",
    );
  });

  it("regressão AT-000214: estrangeiro respeita o Código País (+1 Canadá)", () => {
    // Cadastro C2X: +1 (CANADÁ) / (267) 909-4978 — o disparo antigo virava
    // 55 + 2679094978 = DDD 26 inexistente.
    expect(buildC2xWhatsAppNumber("+1", "(267) 909-4978")).toBe("12679094978");
  });

  it("estrangeiro com zero de tronco perde o zero", () => {
    expect(buildC2xWhatsAppNumber("+44", "07911 123456")).toBe("447911123456");
  });

  it("celular BR válido com phone_code errado é tratado como BR", () => {
    expect(buildC2xWhatsAppNumber("+86", "31988887777")).toBe("5531988887777");
  });

  it("sem dígitos retorna null", () => {
    expect(buildC2xWhatsAppNumber("+55", "")).toBeNull();
    expect(buildC2xWhatsAppNumber(null, null)).toBeNull();
  });
});

describe("fixLegacyBrazilianMobileNumber", () => {
  it("insere o 9 no formato antigo e é idempotente", () => {
    expect(fixLegacyBrazilianMobileNumber("553799384413")).toBe(
      "5537999384413",
    );
    expect(fixLegacyBrazilianMobileNumber("5537999384413")).toBe(
      "5537999384413",
    );
  });

  it("não mexe em fixo nem em estrangeiro", () => {
    expect(fixLegacyBrazilianMobileNumber("553732214455")).toBe(
      "553732214455",
    );
    expect(fixLegacyBrazilianMobileNumber("12679094978")).toBe("12679094978");
  });
});
