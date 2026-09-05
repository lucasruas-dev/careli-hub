import { describe, expect, it } from "vitest";

import { nomeDaUnidade } from "./nome-da-unidade";

describe("nomeDaUnidade", () => {
  it("quadra e lote preenchidos mandam", () => {
    expect(nomeDaUnidade({ codigo: "JDG0617", lote: "07", quadra: "03" })).toBe(
      "Quadra 03 · Lote 07",
    );
  });

  it("sem as colunas, decompõe o código do empreendimento", () => {
    expect(nomeDaUnidade({ codigo: "JDG0617", lote: null, quadra: null })).toBe(
      "Quadra 06 · Lote 17",
    );
    // Sigla de duas letras também: o C2X grava as duas formas.
    expect(nomeDaUnidade({ codigo: "VP0102", lote: null, quadra: null })).toBe(
      "Quadra 01 · Lote 02",
    );
  });

  it("⚠️ código fora do padrão sai como está, e não vira 'Quadra undefined'", () => {
    expect(nomeDaUnidade({ codigo: "APTO-101", lote: null, quadra: null })).toBe("APTO-101");
    expect(nomeDaUnidade({ codigo: "  A1  ", lote: null, quadra: null })).toBe("A1");
  });

  it("quadra sem lote não decide sozinha", () => {
    // Meia informação sairia como "Quadra 03 · Lote null" se a condição fosse por OU.
    expect(nomeDaUnidade({ codigo: "JDG0617", lote: null, quadra: "03" })).toBe(
      "Quadra 06 · Lote 17",
    );
  });
});
