import { describe, expect, it } from "vitest";

import { hashIdentifier } from "@/lib/apolo/server";

import {
  documentoDeCompradorValido,
  mascararDocumento,
  namespaceDoHash,
  rotuloDoDocumento,
  tipoDePessoa,
} from "./documento-do-comprador";
import { hashDoDocumentoDoComprador } from "./hash-do-documento";

const CPF = "529.982.247-25";
const CNPJ = "12.345.678/0001-95";

describe("tipoDePessoa", () => {
  it("decide pelo documento, e não por um campo declarado", () => {
    expect(tipoDePessoa(CNPJ)).toBe("pj");
    expect(tipoDePessoa(CPF)).toBe("pf");
  });

  it("cai para o TAMANHO quando o dígito verificador não fecha", () => {
    // ⚠️ O BANCO JÁ GUARDA DOCUMENTO QUE NÃO FECHA (as 136 propostas de 14 dígitos vieram da carga
    // do C2X). Devolver `null` para elas faria a tela escrever "CPF" em cima de um CNPJ.
    expect(tipoDePessoa("12.345.678/0001-96")).toBe("pj");
    expect(tipoDePessoa("529.982.247-26")).toBe("pf");
  });

  it("sem documento não há tipo", () => {
    expect(tipoDePessoa("")).toBeNull();
    expect(tipoDePessoa("123")).toBeNull();
  });
});

describe("documentoDeCompradorValido", () => {
  it("aceita CPF e CNPJ", () => {
    expect(documentoDeCompradorValido(CPF)).toBe(true);
    expect(documentoDeCompradorValido(CNPJ)).toBe(true);
  });

  it("⚠️ a porta não virou peneira: recusa CNPJ com dígito verificador errado", () => {
    expect(documentoDeCompradorValido("12.345.678/0001-96")).toBe(false);
    expect(documentoDeCompradorValido("529.982.247-26")).toBe(false);
    expect(documentoDeCompradorValido("")).toBe(false);
  });
});

describe("rotuloDoDocumento", () => {
  it("nomeia o documento pelo que ele é", () => {
    expect(rotuloDoDocumento(CPF)).toBe("CPF");
    expect(rotuloDoDocumento(CNPJ)).toBe("CNPJ");
    expect(rotuloDoDocumento("")).toBe("Documento");
  });
});

describe("mascararDocumento", () => {
  it("o CPF sai como sempre saiu", () => {
    expect(mascararDocumento(CPF)).toBe("***.982.247-**");
  });

  it("⚠️ o CNPJ sai mascarado no formato de CNPJ, e não pelos quatro últimos dígitos", () => {
    expect(mascararDocumento(CNPJ)).toBe("**.345.678/0001-**");
    expect(mascararDocumento(CNPJ)).not.toBe("***0195");
  });

  it("sem documento reconhecível, a palavra", () => {
    expect(mascararDocumento("")).toBe("documento");
  });
});

describe("namespaceDoHash", () => {
  it("⚠️ 14 dígitos hasheiam no namespace cnpj, 11 no de cpf", () => {
    // `hashIdentifier` concatena `apolo-identifier:TIPO:valor`: um CNPJ hasheado como "cpf" JAMAIS
    // casa com a CAD da empresa, e a ficha do cliente perde o documento sem erro nenhum.
    expect(namespaceDoHash(CNPJ)).toBe("cnpj");
    expect(namespaceDoHash(CPF)).toBe("cpf");
  });
});

describe("hashDoDocumentoDoComprador", () => {
  // ⚠️ É A CHAVE QUE LIGA DOCUMENTO E FICHA. `hashesDaPessoa`
  // (lib/apolo/incorporador/documentos.ts) devolve os hashes REAIS da entidade, e para uma CAD de PJ
  // eles estão no namespace `cnpj` (medido em 11 de 11 CADs de PJ, 26/09/2026). Hasheado como "cpf",
  // o documento anexado numa venda de PJ nunca aparece na ficha do cliente — e sem erro no log.
  it("⚠️ o CNPJ casa com o hash que a CAD da EMPRESA guarda, e não com o de CPF", () => {
    expect(hashDoDocumentoDoComprador(CNPJ)).toBe(hashIdentifier("cnpj", "12345678000195"));
    expect(hashDoDocumentoDoComprador(CNPJ)).not.toBe(hashIdentifier("cpf", "12345678000195"));
  });

  it("⚠️ o CPF continua no namespace cpf, byte por byte: o passado não se mexe", () => {
    expect(hashDoDocumentoDoComprador(CPF)).toBe(hashIdentifier("cpf", "52998224725"));
  });

  it("documento que não tem tamanho de documento não vira hash nenhum", () => {
    expect(hashDoDocumentoDoComprador("529.982")).toBeNull();
    expect(hashDoDocumentoDoComprador(null)).toBeNull();
  });

  it("aceita documento torto que JÁ está no banco, porque aqui não se valida, só se calcula", () => {
    // A carga do C2X tem documento que não fecha o dígito verificador; recusar aqui faria o anexo
    // dessas fichas perder a chave.
    expect(hashDoDocumentoDoComprador("12.345.678/0001-96")).toBe(
      hashIdentifier("cnpj", "12345678000196"),
    );
  });
});
