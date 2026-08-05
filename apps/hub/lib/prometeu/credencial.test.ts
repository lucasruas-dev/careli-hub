import { describe, expect, it } from "vitest";

import {
  codigoDaCredencial,
  conteudoDoQrCredencial,
  credencialCasaComCodigo,
  ehIdDeCredencial,
  normalizarCodigoDigitado,
} from "./credencial";

// Id real de credenciado do evento ativo (Vicentina), pra os testes baterem com a base.
const ID = "870399a0-e747-401a-bec0-2b4a4f55786b";
const OUTRO = "3f2a9c7b-1111-2222-3333-444455556666";

describe("codigoDaCredencial", () => {
  it("imprime o codigo curto do cracha", () => {
    expect(codigoDaCredencial(ID)).toBe("APL-870399");
  });

  it("nao inventa codigo a partir de id vazio ou quebrado", () => {
    expect(codigoDaCredencial("")).toBe("");
    expect(codigoDaCredencial("xx")).toBe("");
  });
});

describe("conteudoDoQrCredencial", () => {
  it("grava o id COMPLETO no QR (curto confundiria pessoa)", () => {
    expect(conteudoDoQrCredencial(ID)).toBe(ID);
  });

  it("nao grava URL: o cracha fica exposto o evento inteiro", () => {
    expect(conteudoDoQrCredencial(ID)).not.toContain("http");
  });
});

describe("normalizarCodigoDigitado", () => {
  it("aceita o jeito que o organizador digitar, com pressa", () => {
    for (const digitado of [
      "APL-870399",
      "apl-870399",
      "APL870399",
      "870399",
      " apl - 870399 ",
      "870399",
    ]) {
      expect(normalizarCodigoDigitado(digitado)).toBe("870399");
    }
  });

  it("descarta o que nao e hexadecimal", () => {
    expect(normalizarCodigoDigitado("APL-8703ZZ")).toBe("8703");
  });
});

describe("credencialCasaComCodigo", () => {
  it("casa o credenciado certo", () => {
    expect(credencialCasaComCodigo(ID, "APL-870399")).toBe(true);
    expect(credencialCasaComCodigo(ID, "870399")).toBe(true);
  });

  it("nao casa outro credenciado", () => {
    expect(credencialCasaComCodigo(OUTRO, "APL-870399")).toBe(false);
  });

  it("NAO casa com codigo incompleto: meio codigo pegaria varias pessoas", () => {
    expect(credencialCasaComCodigo(ID, "8703")).toBe(false);
    expect(credencialCasaComCodigo(ID, "")).toBe(false);
  });
});

describe("ehIdDeCredencial", () => {
  it("reconhece o QR da credencial", () => {
    expect(ehIdDeCredencial(ID)).toBe(true);
    expect(ehIdDeCredencial(` ${ID.toUpperCase()} `)).toBe(true);
  });

  it("rejeita QR de outra coisa (nota fiscal, wifi, link)", () => {
    expect(ehIdDeCredencial("https://c2x.app.br")).toBe(false);
    expect(ehIdDeCredencial("APL-870399")).toBe(false);
    expect(ehIdDeCredencial("")).toBe(false);
  });
});
