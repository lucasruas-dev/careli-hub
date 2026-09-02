import { describe, expect, it } from "vitest";

import { classificarCancelamento } from "./cancelamento";

// A matriz inteira, nas quatro combinações. É a regra que decide se existe distrato — e distrato
// é instrumento jurídico, não etiqueta de board.
describe("classificar o cancelamento", () => {
  it("sem assinatura e sem pagamento: cancelamento simples", () => {
    const r = classificarCancelamento({ assinaturaCompleta: false, houvePagamento: false });
    expect(r.tipo).toBe("cancelamento");
    expect(r.devolveValores).toBe(false);
  });

  it("assinado, nada pago: distrato sem devolução", () => {
    const r = classificarCancelamento({ assinaturaCompleta: true, houvePagamento: false });
    expect(r.tipo).toBe("distrato");
    expect(r.devolveValores).toBe(false);
  });

  it("assinado e pago: distrato com devolução", () => {
    const r = classificarCancelamento({ assinaturaCompleta: true, houvePagamento: true });
    expect(r.tipo).toBe("distrato");
    expect(r.devolveValores).toBe(true);
  });

  // ⚠️ O CASO QUE PARECE CONTRAINTUITIVO: sem assinatura não há contrato formado, mas o dinheiro
  // entrou — e desfazer o que envolve dinheiro do cliente precisa do instrumento.
  it("pago sem assinar: distrato com devolução", () => {
    const r = classificarCancelamento({ assinaturaCompleta: false, houvePagamento: true });
    expect(r.tipo).toBe("distrato");
    expect(r.devolveValores).toBe(true);
  });

  // ⚠️ QUALQUER PAGAMENTO ABRE A DEVOLUÇÃO, em qualquer combinação. Cancelar um contrato pago sem
  // devolver é reter dinheiro de quem saiu.
  it("todo cenário com pagamento devolve valores", () => {
    for (const assinaturaCompleta of [true, false]) {
      expect(
        classificarCancelamento({ assinaturaCompleta, houvePagamento: true }).devolveValores,
      ).toBe(true);
    }
  });

  it("sem pagamento, nunca devolve", () => {
    for (const assinaturaCompleta of [true, false]) {
      expect(
        classificarCancelamento({ assinaturaCompleta, houvePagamento: false }).devolveValores,
      ).toBe(false);
    }
  });

  it("sempre explica o porquê, para aparecer na tela de quem abriu", () => {
    for (const assinaturaCompleta of [true, false]) {
      for (const houvePagamento of [true, false]) {
        const r = classificarCancelamento({ assinaturaCompleta, houvePagamento });
        expect(r.porque.length).toBeGreaterThan(20);
      }
    }
  });
});
