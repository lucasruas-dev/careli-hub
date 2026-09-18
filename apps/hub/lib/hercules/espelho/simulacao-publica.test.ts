import { describe, expect, it } from "vitest";

import { valoresDaSimulacaoPublica } from "./simulacao-publica";

// O que a rota pública do PDF da simulação aceita (18/09/2026): o valor entre o menor preço de plano
// do lote e a tabela, e a entrada entre o piso do empreendimento e o valor.

const GARDEN = [{ descontoPercentual: 0 }, { descontoPercentual: 8 }, { descontoPercentual: 12 }];

const aceito = (valorPedido: unknown, entradaPedida: unknown, piso: null | number = 8) =>
  valoresDaSimulacaoPublica({
    entradaMinimaPercentual: piso,
    entradaPedida,
    planos: GARDEN,
    precoDeTabela: 421_500,
    valorPedido,
  });

describe("valoresDaSimulacaoPublica", () => {
  it("o preço de um plano passa intacto, com os centavos", () => {
    // INVESTIDOR PARCELADO: 421.500 × 0,92 = 387.780; a entrada do plano arredondada para cima.
    expect(aceito(387_780, 31_023)).toEqual({ entrada: 31_023, valor: 387_780 });
    expect(aceito(387_779.99, 31_022.4)).toEqual({ entrada: 31_022.4, valor: 387_779.99 });
  });

  it("⚠️ abaixo do menor preço de plano sobe para ele; acima da tabela desce para ela", () => {
    // 12% do INVESTIDOR: 421.500 × 0,88 = 370.920.
    expect(aceito(210_750, 200_000).valor).toBe(370_920);
    expect(aceito(1_000_000, 200_000).valor).toBe(421_500);
    // Sem valor (ou lixo, inclusive negativo), a tabela: na dúvida, o preço mais alto.
    expect(aceito(undefined, 50_000).valor).toBe(421_500);
    expect(aceito("abc", 50_000).valor).toBe(421_500);
    expect(aceito(-5, 50_000).valor).toBe(421_500);
    expect(aceito(0, 50_000).valor).toBe(421_500);
  });

  it("⚠️ a entrada nunca fica abaixo do piso nem acima do valor", () => {
    // 8% de 387.780 = 31.022,40: o piso é o mínimo, em centavos.
    expect(aceito(387_780, 0).entrada).toBe(31_022.4);
    expect(aceito(387_780, 999_999).entrada).toBe(387_780);
    // Piso não cadastrado: o padrão da casa (10%). Zero é decisão: zero.
    expect(aceito(387_780, 0, null).entrada).toBe(38_778);
    expect(aceito(387_780, 0, 0).entrada).toBe(0);
  });

  it("sem plano com desconto, o valor é a tabela", () => {
    expect(
      valoresDaSimulacaoPublica({
        entradaMinimaPercentual: 10,
        entradaPedida: 20_000,
        planos: [{ descontoPercentual: 0 }, {}],
        precoDeTabela: 185_400.5,
        valorPedido: 100_000,
      }),
    ).toEqual({ entrada: 20_000, valor: 185_400.5 });
  });
});
