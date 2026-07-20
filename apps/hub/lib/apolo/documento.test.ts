import { describe, expect, it } from "vitest";

import {
  cnpjValido,
  cpfValido,
  documentoCombinaComTipo,
  formatarDocumento,
  tipoDoDocumento,
} from "./documento";

describe("cpfValido", () => {
  it("aceita CPFs reais das fichas", () => {
    // CPFs que já estão no banco de produção.
    expect(cpfValido("139.544.576-10")).toBe(true);
    expect(cpfValido("12043866680")).toBe(true);
    expect(cpfValido("093.866.226-02")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(cpfValido("139.544.576-11")).toBe(false);
  });

  // Passam no cálculo do módulo 11 e não são CPF de ninguém.
  it("recusa sequências repetidas", () => {
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("000.000.000-00")).toBe(false);
  });

  it("recusa tamanho errado", () => {
    expect(cpfValido("1234567890")).toBe(false);
    expect(cpfValido("")).toBe(false);
  });
});

describe("cnpjValido", () => {
  it("aceita CNPJ válido", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11222333000181")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(cnpjValido("11.222.333/0001-82")).toBe(false);
  });

  it("recusa sequências repetidas e tamanho errado", () => {
    expect(cnpjValido("11.111.111/1111-11")).toBe(false);
    expect(cnpjValido("112223330001")).toBe(false);
  });
});

describe("tipoDoDocumento", () => {
  it("distingue pelo que o documento é, não pelo tamanho", () => {
    expect(tipoDoDocumento("139.544.576-10")).toBe("cpf");
    expect(tipoDoDocumento("11.222.333/0001-81")).toBe("cnpj");
    expect(tipoDoDocumento("139.544.576-11")).toBeNull();
  });
});

describe("formatarDocumento", () => {
  // É o formato que o sync do C2X grava e que a busca indexa. Mascarar aqui faria a ficha
  // sumir das buscas do Apolo, Iris e CACÁ.
  it("formata completo, não mascarado", () => {
    expect(formatarDocumento("13954457610")).toBe("139.544.576-10");
    expect(formatarDocumento("11222333000181")).toBe("11.222.333/0001-81");
  });
});

describe("documentoCombinaComTipo", () => {
  // O defeito real da JFL: empresa cadastrada como pessoa física, com o CPF do representante.
  it("recusa pessoa jurídica com CPF", () => {
    const r = documentoCombinaComTipo("pj", "093.866.226-02");
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("CNPJ");
  });

  it("recusa pessoa física com CNPJ", () => {
    const r = documentoCombinaComTipo("pf", "11.222.333/0001-81");
    expect(r.ok).toBe(false);
  });

  it("aceita as combinações certas", () => {
    expect(documentoCombinaComTipo("pf", "139.544.576-10").ok).toBe(true);
    expect(documentoCombinaComTipo("pj", "11.222.333/0001-81").ok).toBe(true);
  });

  it("recusa documento inválido antes de olhar o tipo", () => {
    const r = documentoCombinaComTipo("pf", "123");
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("invalido");
  });
});
