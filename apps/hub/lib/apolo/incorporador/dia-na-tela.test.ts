import { describe, expect, it } from "vitest";

import { diaNaTela, mesNaTela } from "./dia-na-tela";

// O QUE ESTE ARQUIVO PROTEGE: que o vencimento mostrado seja o vencimento do C2X, e não o dia
// anterior. O bug real (18/08/2026): a Carteira do portal mostrava 31/07 para uma parcela que
// vence em 01/08, porque `2026-08-01T00:00:00.000Z` formatado no fuso de São Paulo volta três
// horas. Quem lê a tela decide cobrança por essa data.
describe("diaNaTela", () => {
  it("⚠️ meia-noite em UTC é DIA, não instante: 01/08 continua 01/08 (era o bug)", () => {
    expect(diaNaTela("2026-08-01T00:00:00.000Z")).toBe("01/08/2026");
    expect(diaNaTela("2026-08-01T00:00:00Z")).toBe("01/08/2026");
  });

  it("data pura sem hora atravessa igual", () => {
    expect(diaNaTela("2026-08-19")).toBe("19/08/2026");
  });

  it("⚠️ instante de verdade continua no fuso da casa: 22h de terça não vira quarta", () => {
    // 2026-08-19T01:30:00Z é 18/08 às 22h30 em São Paulo.
    expect(diaNaTela("2026-08-19T01:30:00.000Z")).toBe("18/08/2026");
  });

  it("vazio e lixo viram o traço, sem explodir", () => {
    expect(diaNaTela(null)).toBe("-");
    expect(diaNaTela("")).toBe("-");
    expect(diaNaTela("nem data")).toBe("-");
    expect(diaNaTela(null, "")).toBe("");
  });
});

describe("mesNaTela", () => {
  it("competência é mês: 08/2026 em qualquer fuso", () => {
    expect(mesNaTela("2026-08-01T00:00:00.000Z")).toBe("08/2026");
    expect(mesNaTela("2026-08-01")).toBe("08/2026");
  });
});
