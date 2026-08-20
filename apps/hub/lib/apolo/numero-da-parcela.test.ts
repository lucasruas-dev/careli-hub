import { describe, expect, it } from "vitest";

import { numeroDaParcela } from "./numero-da-parcela";

// ⚠️ OS NÚMEROS DESTE TESTE SÃO OS DO C2X DE VERDADE, medidos no Vale do Ouro em 20/08/2026:
//
//   tipo    | current_signal_parcel | total_signal_parcels | current_total_parcel | total_parcels
//   Ato     |          0            |        1..4          |          0           |     156
//   Sinal   |        1..4           |        1..4          |          0           |     156
//   Parcela |          0            |        1..4          |        1..156        |     156
//
// O detalhe que importa: `total_parcels` vale 156 em TODAS as linhas, e o contador "atual" vem
// ZERADO no Ato e no Sinal. Ler o par errado produzia "0/156" — o número que o Lucas viu na tela.
describe("numeroDaParcela", () => {
  it("Ato é sempre 1/1, mesmo com os campos do saldo devedor preenchidos", () => {
    // Esta linha é literalmente o que o C2X devolve para um Ato do Vale do Ouro.
    expect(
      numeroDaParcela({
        parcelaAtual: 0,
        parcelaTotal: 156,
        sinalAtual: 0,
        sinalTotal: 3,
        tipo: "Ato",
      }),
    ).toBe("1/1");

    // O Ato não vira "0/156" nem "1/156" por mais tentador que o `total_parcels` seja.
    expect(
      numeroDaParcela({ parcelaAtual: 0, parcelaTotal: 48, sinalAtual: 0, sinalTotal: 1, tipo: "Ato" }),
    ).toBe("1/1");
  });

  it("Sinal conta SÓ o sinal, não o saldo devedor", () => {
    // Sinal parcelado em 3: as três linhas são 1/3, 2/3 e 3/3 — e nunca /156.
    for (const atual of [1, 2, 3]) {
      expect(
        numeroDaParcela({
          parcelaAtual: 0,
          parcelaTotal: 156,
          sinalAtual: atual,
          sinalTotal: 3,
          tipo: "Sinal",
        }),
      ).toBe(`${atual}/3`);
    }

    // Sinal à vista existe e é 1/1 pelo próprio dado, não por regra fixa.
    expect(
      numeroDaParcela({
        parcelaAtual: 0,
        parcelaTotal: 156,
        sinalAtual: 1,
        sinalTotal: 1,
        tipo: "Sinal",
      }),
    ).toBe("1/1");
  });

  it("Parcela conta o saldo devedor, ignorando quantas vezes o sinal foi dividido", () => {
    expect(
      numeroDaParcela({
        parcelaAtual: 7,
        parcelaTotal: 156,
        // O sinal foi em 4 vezes; isso não tem nada a ver com a numeração da parcela.
        sinalAtual: 0,
        sinalTotal: 4,
        tipo: "Parcela",
      }),
    ).toBe("7/156");

    expect(
      numeroDaParcela({
        parcelaAtual: 1,
        parcelaTotal: 48,
        sinalAtual: 0,
        sinalTotal: 1,
        tipo: "Parcela",
      }),
    ).toBe("1/48");
  });

  it("sem tipo, cai na régua da parcela — que é a esmagadora maioria das linhas", () => {
    expect(
      numeroDaParcela({
        parcelaAtual: 12,
        parcelaTotal: 156,
        sinalAtual: null,
        sinalTotal: null,
        tipo: null,
      }),
    ).toBe("12/156");
  });

  it("sem contador nenhum devolve '-', e não um número inventado", () => {
    expect(
      numeroDaParcela({
        parcelaAtual: 0,
        parcelaTotal: 0,
        sinalAtual: 0,
        sinalTotal: 0,
        tipo: "Avulso",
      }),
    ).toBe("-");

    expect(
      numeroDaParcela({
        parcelaAtual: null,
        parcelaTotal: null,
        sinalAtual: null,
        sinalTotal: null,
        tipo: "Parcela",
      }),
    ).toBe("-");
  });

  it("uma ponta faltando aparece como '-', sem esconder a outra", () => {
    expect(
      numeroDaParcela({
        parcelaAtual: 5,
        parcelaTotal: null,
        sinalAtual: null,
        sinalTotal: null,
        tipo: "Parcela",
      }),
    ).toBe("5/-");
  });

  it("o tipo é lido sem depender de caixa ou espaço em volta", () => {
    expect(
      numeroDaParcela({ parcelaAtual: 0, parcelaTotal: 156, sinalAtual: 0, sinalTotal: 1, tipo: "  ATO  " }),
    ).toBe("1/1");
    expect(
      numeroDaParcela({ parcelaAtual: 0, parcelaTotal: 156, sinalAtual: 2, sinalTotal: 4, tipo: "sinal" }),
    ).toBe("2/4");
  });
});
