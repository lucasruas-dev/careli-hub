import { describe, expect, it } from "vitest";

import { acharCpfNoTexto, cpfValido, ehDocumentoLegivel } from "./asana-ocr";

// Estas funções decidem QUANTO SE GASTA e O QUE ENTRA como CPF na base. Errar aqui custa
// dinheiro (leitura desnecessária na MOST, R$ 0,506 por imagem) ou suja o cadastro.

describe("cpfValido", () => {
  // createApoloEntity só CONTA 11 dígitos, não valida o dígito verificador. Sem esta função,
  // qualquer número de 11 dígitos que o OCR pescasse viraria CPF.
  it("aceita CPF com dígito verificador correto", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("52998224725")).toBe(true);
  });

  it("recusa CPF com dígito verificador errado", () => {
    expect(cpfValido("529.982.247-26")).toBe(false);
    expect(cpfValido("111.111.111-12")).toBe(false);
  });

  it("recusa sequência repetida, que passa na conta mas não é CPF", () => {
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("00000000000")).toBe(false);
  });

  it("recusa tamanho errado e lixo", () => {
    expect(cpfValido("529.982.247")).toBe(false);
    expect(cpfValido("")).toBe(false);
    expect(cpfValido("abcdefghijk")).toBe(false);
  });
});

describe("acharCpfNoTexto", () => {
  // Cada CPF achado aqui é uma leitura de documento que NÃO precisa ser paga.
  it("acha CPF formatado na descrição da CAD", () => {
    expect(acharCpfNoTexto("Cliente novo, CPF 529.982.247-25, indicado pela imobiliária")).toBe(
      "52998224725",
    );
  });

  it("acha CPF sem formatação", () => {
    expect(acharCpfNoTexto("documento 52998224725 conferido")).toBe("52998224725");
  });

  it("ignora número de 11 dígitos que NÃO é CPF válido", () => {
    // Protocolo, telefone com DDD, número de contrato: tudo isso tem 11 dígitos.
    expect(acharCpfNoTexto("protocolo 12345678901")).toBeNull();
    expect(acharCpfNoTexto("telefone 31998887766")).toBeNull();
  });

  it("devolve nulo para texto vazio ou ausente", () => {
    expect(acharCpfNoTexto(null)).toBeNull();
    expect(acharCpfNoTexto(undefined)).toBeNull();
    expect(acharCpfNoTexto("sem documento aqui")).toBeNull();
  });

  it("pega o primeiro CPF VÁLIDO quando há vários números", () => {
    expect(acharCpfNoTexto("protocolo 12345678901 e cpf 529.982.247-25")).toBe("52998224725");
  });
});

describe("ehDocumentoLegivel", () => {
  // Mandar planilha ou zip para o iOCR é pagar por nada: ele não extrai CPF disso.
  it("aceita imagem e PDF", () => {
    expect(ehDocumentoLegivel("rg-frente.jpg")).toBe(true);
    expect(ehDocumentoLegivel("comprovante.PDF")).toBe(true);
    expect(ehDocumentoLegivel("foto.png")).toBe(true);
  });

  it("recusa o que o iOCR não lê (e economiza a consulta)", () => {
    expect(ehDocumentoLegivel("planilha.xlsx")).toBe(false);
    expect(ehDocumentoLegivel("contrato.docx")).toBe(false);
    expect(ehDocumentoLegivel("arquivos.zip")).toBe(false);
  });

  it("recusa arquivo sem extensão", () => {
    expect(ehDocumentoLegivel("documento")).toBe(false);
    expect(ehDocumentoLegivel(null)).toBe(false);
  });
});
