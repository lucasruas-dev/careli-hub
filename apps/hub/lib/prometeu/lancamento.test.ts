import { describe, expect, it } from "vitest";

import {
  dataDoLancamento,
  lancamentoSemEmpreendimento,
  nomeDoLancamento,
  rotuloDoLancamento,
} from "./lancamento";

const configurado = {
  config: { enterpriseNome: "Vale do Ouro" },
  dataEvento: "2026-08-01T00:00:00+00:00",
  enterpriseCode: "VDO",
  enterpriseId: "abc",
  nome: "Lançamento",
};

describe("nomeDoLancamento", () => {
  it("prefere o nome por extenso", () => {
    expect(nomeDoLancamento(configurado)).toBe("Vale do Ouro");
  });

  it("cai para a sigla quando o nome nao foi gravado", () => {
    expect(nomeDoLancamento({ ...configurado, config: {} })).toBe("VDO");
  });

  it("cai para o nome do evento quando nada foi configurado", () => {
    expect(
      nomeDoLancamento({ ...configurado, config: {}, enterpriseCode: null }),
    ).toBe("Lançamento");
  });
});

describe("lancamentoSemEmpreendimento", () => {
  it("acusa o evento que ninguem amarrou a um empreendimento", () => {
    // E o estado real do evento em 24/07/2026: os tres campos nulos.
    expect(
      lancamentoSemEmpreendimento({
        config: {},
        enterpriseCode: null,
        enterpriseId: null,
      }),
    ).toBe(true);
  });

  it("nao acusa quando ha vinculo", () => {
    expect(lancamentoSemEmpreendimento(configurado)).toBe(false);
  });
});

describe("dataDoLancamento", () => {
  it("NAO volta um dia por causa do fuso", () => {
    // timestamptz de meia-noite UTC formatado em Brasilia daria 31/07. O evento e dia 1.
    expect(dataDoLancamento("2026-08-01T00:00:00+00:00")).toBe("01/08/2026");
  });

  it("aceita data pura", () => {
    expect(dataDoLancamento("2026-08-01")).toBe("01/08/2026");
  });

  it("devolve vazio quando nao ha data", () => {
    expect(dataDoLancamento(null)).toBe("");
    expect(dataDoLancamento("")).toBe("");
    expect(dataDoLancamento("data invalida")).toBe("");
  });
});

describe("rotuloDoLancamento", () => {
  it("junta nome e data", () => {
    expect(rotuloDoLancamento(configurado)).toBe("Vale do Ouro · 01/08/2026");
  });

  it("mostra so o que existe", () => {
    expect(rotuloDoLancamento({ ...configurado, dataEvento: null })).toBe(
      "Vale do Ouro",
    );
  });
});
