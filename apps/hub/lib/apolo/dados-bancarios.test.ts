import { describe, expect, it } from "vitest";

import {
  chavePixNormalizada,
  linhaDaContaDoFornecedor,
  separarBanco,
  validarDadosBancarios,
} from "./dados-bancarios";

// OS DADOS BANCÁRIOS DO FORNECEDOR — decisão do Lucas (02/10/2026): é obrigatório ter UMA forma de
// pagar, a conta completa (banco, agência, conta) OU uma chave PIX. As duas juntas também valem.
//
// O que está travado aqui:
//   • nada informado é recusado, com a frase que diz as duas saídas;
//   • conta começada e não terminada é recusada (não vira "sem conta" em silêncio);
//   • chave PIX que não combina com o tipo é recusada;
//   • o que passa sai limpo: dígitos, +55 no celular, e-mail minúsculo, código do banco separado.

describe("validarDadosBancarios", () => {
  it("nada informado: recusa dizendo as duas saídas", () => {
    const r = validarDadosBancarios({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mensagem).toBe(
      "Dados bancários: informe a conta (banco, agência e conta) ou uma chave PIX do fornecedor.",
    );
  });

  it("nulo também é 'nada informado'", () => {
    expect(validarDadosBancarios(null).ok).toBe(false);
  });

  it("só a conta completa basta", () => {
    const r = validarDadosBancarios({
      agencia: "1234",
      banco: "341 - Itaú Unibanco",
      conta: "12345-6",
      tipoConta: "corrente",
    });
    expect(r).toEqual({
      dados: {
        conta: {
          agencia: "1234",
          bancoCodigo: "341",
          bancoNome: "Itaú Unibanco",
          numero: "12345-6",
          tipo: "corrente",
        },
        pix: null,
        titular: null,
      },
      ok: true,
    });
  });

  it("só a chave PIX basta", () => {
    const r = validarDadosBancarios({ pixChave: "529.982.247-25", pixTipo: "cpf" });
    expect(r).toMatchObject({ dados: { conta: null, pix: { chave: "52998224725", tipo: "cpf" } }, ok: true });
  });

  it("conta pela metade é recusada, nomeando o que falta", () => {
    const r = validarDadosBancarios({ agencia: "1234", banco: "Bradesco", pixChave: "a@b.com", pixTipo: "email" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.faltando).toEqual(["o número da conta"]);
  });

  it("tipo de conta não informado vira conta corrente", () => {
    const r = validarDadosBancarios({ agencia: "1", banco: "Caixa", conta: "2" });
    expect(r).toMatchObject({ dados: { conta: { tipo: "corrente" } }, ok: true });
  });

  it("chave PIX sem tipo é recusada", () => {
    const r = validarDadosBancarios({ pixChave: "a@b.com" });
    expect(r).toMatchObject({ faltando: ["o tipo da chave PIX"], ok: false });
  });

  it("chave que não combina com o tipo é recusada", () => {
    const r = validarDadosBancarios({ pixChave: "111.111.111-11", pixTipo: "cpf" });
    expect(r).toMatchObject({ faltando: ["um CPF válido como chave PIX"], ok: false });
  });

  it("titular com documento inválido é recusado", () => {
    const r = validarDadosBancarios({
      documentoTitular: "123",
      pixChave: "a@b.com",
      pixTipo: "email",
      titular: "Maria",
    });
    expect(r).toMatchObject({ ok: false });
  });

  it("titular informado sai junto, com o documento só em dígitos", () => {
    const r = validarDadosBancarios({
      documentoTitular: "529.982.247-25",
      pixChave: "a@b.com",
      pixTipo: "email",
      titular: "Maria Silva",
    });
    expect(r).toMatchObject({
      dados: { titular: { documento: "52998224725", nome: "Maria Silva" } },
      ok: true,
    });
  });
});

describe("chavePixNormalizada", () => {
  it("celular ganha o +55, com ou sem o 55 digitado", () => {
    expect(chavePixNormalizada("telefone", "(62) 99999-8888")).toBe("+5562999998888");
    expect(chavePixNormalizada("telefone", "+55 62 99999-8888")).toBe("+5562999998888");
    expect(chavePixNormalizada("telefone", "9999")).toBeNull();
  });

  it("e-mail sai minúsculo; e-mail inválido não passa", () => {
    expect(chavePixNormalizada("email", "Nome@Empresa.com.BR")).toBe("nome@empresa.com.br");
    expect(chavePixNormalizada("email", "nome@empresa")).toBeNull();
  });

  it("CNPJ confere o dígito", () => {
    expect(chavePixNormalizada("cnpj", "11.222.333/0001-81")).toBe("11222333000181");
    expect(chavePixNormalizada("cnpj", "11.222.333/0001-00")).toBeNull();
  });

  it("chave aleatória é um UUID", () => {
    expect(chavePixNormalizada("aleatoria", "123E4567-E89B-12D3-A456-426614174000")).toBe(
      "123e4567-e89b-12d3-a456-426614174000",
    );
    expect(chavePixNormalizada("aleatoria", "qualquer-coisa")).toBeNull();
  });
});

describe("separarBanco", () => {
  it("separa o código da frente", () => {
    expect(separarBanco("237 - Bradesco")).toEqual({ codigo: "237", nome: "Bradesco" });
    expect(separarBanco("001")).toEqual({ codigo: "001", nome: "001" });
  });

  it("sem código, só o nome", () => {
    expect(separarBanco("Cooperativa Local")).toEqual({ codigo: null, nome: "Cooperativa Local" });
  });
});

describe("linhaDaContaDoFornecedor", () => {
  it("monta a linha da 0211 com nulo no que não foi informado", () => {
    const r = validarDadosBancarios({ pixChave: "a@b.com", pixTipo: "email" });
    if (!r.ok) throw new Error("devia passar");
    expect(linhaDaContaDoFornecedor("ent-1", r.dados, null)).toEqual({
      account_number: null,
      account_type: null,
      agency: null,
      bank_code: null,
      bank_name: null,
      created_by: null,
      entity_id: "ent-1",
      holder_document: null,
      holder_name: null,
      pix_key: "a@b.com",
      pix_key_type: "email",
    });
  });
});
