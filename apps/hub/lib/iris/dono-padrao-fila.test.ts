import { describe, expect, it } from "vitest";

import { donoPadraoDaFila } from "./evolution-inbound-processor";

// A fila Direct passou a nascer com dono (pedido do Lucas em 26/07). O UUID vem do metadata da
// fila, que e' um jsonb livre e pode chegar em qualquer formato — inclusive nulo, vazio ou
// preenchido a mao por SQL. Uma leitura frouxa aqui atribuiria lixo como dono do ticket, e o
// ticket nasceria travado no modo sussurro em nome de um usuario que nao existe.

describe("donoPadraoDaFila", () => {
  it("le o UUID quando esta configurado", () => {
    expect(
      donoPadraoDaFila({
        channelId: "7b269865-1f7c-4398-9975-5c863c2d7fc1",
        defaultAssigneeUserId: "d69188cb-934e-4f32-8c7e-33e70eb31d48",
      }),
    ).toBe("d69188cb-934e-4f32-8c7e-33e70eb31d48");
  });

  it("tira espaco em volta (valor colado a mao no banco)", () => {
    expect(
      donoPadraoDaFila({ defaultAssigneeUserId: "  d69188cb-934e  " }),
    ).toBe("d69188cb-934e");
  });

  // Sem dono configurado o ticket tem que nascer orfao, exatamente como era antes. Este e' o
  // comportamento de seguranca: fila nova, ou metadata que so' tem channelId, nao inventa dono.
  it("devolve null quando nao ha nada configurado", () => {
    expect(donoPadraoDaFila({ channelId: "abc" })).toBeNull();
    expect(donoPadraoDaFila({})).toBeNull();
    expect(donoPadraoDaFila(null)).toBeNull();
    expect(donoPadraoDaFila(undefined)).toBeNull();
  });

  it("nao aceita string vazia nem so espaco", () => {
    expect(donoPadraoDaFila({ defaultAssigneeUserId: "" })).toBeNull();
    expect(donoPadraoDaFila({ defaultAssigneeUserId: "   " })).toBeNull();
  });

  it("nao aceita valor que nao seja texto", () => {
    expect(donoPadraoDaFila({ defaultAssigneeUserId: 42 })).toBeNull();
    expect(donoPadraoDaFila({ defaultAssigneeUserId: true })).toBeNull();
    expect(donoPadraoDaFila({ defaultAssigneeUserId: null })).toBeNull();
    expect(donoPadraoDaFila({ defaultAssigneeUserId: ["a"] })).toBeNull();
  });

  it("metadata que nao e objeto nao quebra", () => {
    expect(donoPadraoDaFila("texto solto")).toBeNull();
    expect(donoPadraoDaFila(123)).toBeNull();
    expect(donoPadraoDaFila([{ defaultAssigneeUserId: "x" }])).toBeNull();
  });
});
