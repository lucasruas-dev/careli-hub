import { describe, expect, it } from "vitest";

import { acumularLiberacoes } from "./subsidio-acumulado";

// O ACUMULADO DAS MEDIÇÕES DA CAIXA.
//
// ⚠️ A LISTA CHEGA DO MAIS NOVO PARA O MAIS ANTIGO (é o que interessa ver primeiro na tela), mas
// "acumulado" só faz sentido somando na ordem cronológica. Somar na ordem de exibição daria o
// acumulado ao contrário — a primeira medição da obra apareceria com o total inteiro, e a última
// com o próprio valor. Passaria despercebido: os dois extremos batem com o total.

const liberacao = (data: string, valor: number, ehPrincipal = true) => ({
  data,
  ehPrincipal,
  ehTerreno: false,
  historico: "CR DESBLOQ",
  valor,
});

describe("acumularLiberacoes", () => {
  it("soma na ordem cronológica, não na ordem de exibição", () => {
    // Chega do mais novo para o mais antigo, como a tela recebe.
    const resultado = acumularLiberacoes([
      liberacao("2026-07-16", 30),
      liberacao("2026-05-10", 20),
      liberacao("2026-03-01", 10),
    ]);

    // A ordem de exibição não muda...
    expect(resultado.map((l) => l.data)).toEqual(["2026-07-16", "2026-05-10", "2026-03-01"]);
    // ...mas o acumulado cresce do fim (primeira medição) para o começo (última).
    expect(resultado.map((l) => l.acumulado)).toEqual([60, 30, 10]);
  });

  it("o acumulado da linha mais nova é o total liberado", () => {
    const resultado = acumularLiberacoes([
      liberacao("2026-07-16", 124_673.69),
      liberacao("2026-06-10", 1_000),
    ]);
    expect(resultado[0]?.acumulado).toBeCloseTo(125_673.69, 2);
  });

  it("inclui o rateio (crédito menor) na soma", () => {
    // O crédito secundário SOMA no total — a tela o mostra à parte, mas ele é dinheiro liberado.
    const resultado = acumularLiberacoes([
      liberacao("2026-07-16", 100, false),
      liberacao("2026-07-16", 3_000),
    ]);
    expect(resultado[0]?.acumulado).toBe(3_100);
  });

  it("não quebra com lista vazia", () => {
    expect(acumularLiberacoes([])).toEqual([]);
  });

  it("aguenta data nula sem inverter a ordem recebida", () => {
    const resultado = acumularLiberacoes([
      { ...liberacao("2026-07-16", 50), data: null },
      liberacao("2026-01-01", 10),
    ]);
    expect(resultado.map((l) => l.acumulado)).toEqual([60, 10]);
  });
});
