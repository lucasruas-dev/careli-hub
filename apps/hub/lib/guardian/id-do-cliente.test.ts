import { describe, expect, it } from "vitest";

import { idDoClienteDaCobranca } from "./id-do-cliente";

describe("o id do cliente da cobrança", () => {
  it("⚠️ aceita o formato que a TELA manda, que é texto e não número", () => {
    // `read-model.ts` monta `c2x-client-<id>`; a rota fazia Number() disso e recebia NaN, então
    // respondia 400 em toda tentativa de salvar a etapa do workflow (TI-000138).
    expect(idDoClienteDaCobranca("c2x-client-3757")).toBe(3757);
  });

  // ⚠️ OS DÍGITOS SÃO OS DO FIM. Tirar tudo que não é dígito traz o "2" de "c2x" junto, e o
  // atendimento seria gravado em cima de OUTRO cliente. Já aconteceu no Apolo.
  it("não deixa o '2' de 'c2x' entrar no número", () => {
    expect(idDoClienteDaCobranca("c2x-client-3789")).toBe(3789);
    expect(idDoClienteDaCobranca("c2x-client-3789")).not.toBe(23789);
  });

  it("número puro continua valendo", () => {
    expect(idDoClienteDaCobranca(3757)).toBe(3757);
    expect(idDoClienteDaCobranca("3757")).toBe(3757);
    expect(idDoClienteDaCobranca(" 3757 ")).toBe(3757);
  });

  it("sem número plausível, devolve nulo em vez de chutar", () => {
    expect(idDoClienteDaCobranca(null)).toBeNull();
    expect(idDoClienteDaCobranca(undefined)).toBeNull();
    expect(idDoClienteDaCobranca("")).toBeNull();
    expect(idDoClienteDaCobranca("c2x-client-")).toBeNull();
    expect(idDoClienteDaCobranca("sem digito nenhum")).toBeNull();
    expect(idDoClienteDaCobranca(0)).toBeNull();
    expect(idDoClienteDaCobranca(-5)).toBeNull();
    expect(idDoClienteDaCobranca(Number.NaN)).toBeNull();
  });

  it("id de outro formato com número no fim também resolve", () => {
    expect(idDoClienteDaCobranca("cliente/991")).toBe(991);
  });
});
