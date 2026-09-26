import { describe, expect, it } from "vitest";

import { lerProponente } from "./proponente";

describe("lerProponente", () => {
  it("⚠️ lê a forma das 30 reservas vivas, que só tem cpf, nome e telefone", () => {
    // Medido em 26/09/2026: `hercules_reservas.proponentes` tem SÓ TRÊS CHAVES em 30 de 30 linhas.
    // Nenhuma delas pode parar de funcionar por causa da chave nova.
    expect(
      lerProponente({ cpf: "529.982.247-25", nome: "Maria da Silva", telefone: "62991234567" }),
    ).toEqual({
      documento: "529.982.247-25",
      nome: "Maria da Silva",
      telefone: "62991234567",
      tipoPessoa: "pf",
    });
  });

  it("lê a chave nova `documento` e reconhece a empresa", () => {
    expect(
      lerProponente({
        documento: "12.345.678/0001-95",
        nome: "ACME Construtora",
        telefone: "62991234567",
      }),
    ).toEqual({
      documento: "12.345.678/0001-95",
      nome: "ACME Construtora",
      telefone: "62991234567",
      tipoPessoa: "pj",
    });
  });

  it("⚠️ `documento` ganha de `cpf` quando os dois vierem", () => {
    const lido = lerProponente({
      cpf: "",
      documento: "12.345.678/0001-95",
      nome: "ACME",
      telefone: "",
    });
    expect(lido?.documento).toBe("12.345.678/0001-95");
    expect(lido?.tipoPessoa).toBe("pj");
  });

  it("⚠️ proponente só com nome NÃO vira null", () => {
    // A rota da proposta usa `null` para dizer "reserva sem cliente titular" e responder 409.
    // Uma reserva antiga gravada sem CPF (existe: `proponentes: [{ nome: "Ana" }]`) passaria a
    // receber outra mensagem, e a unidade ficaria travada por uma linha que ninguém destrava.
    expect(lerProponente({ nome: "Ana" })).toEqual({
      documento: "",
      nome: "Ana",
      telefone: "",
      tipoPessoa: "pf",
    });
  });

  it("sem objeto, sem proponente", () => {
    expect(lerProponente(null)).toBeNull();
    expect(lerProponente({})).toBeNull();
    expect(lerProponente("Maria")).toBeNull();
  });
});
