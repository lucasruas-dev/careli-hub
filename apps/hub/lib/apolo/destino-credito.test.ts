import { describe, expect, it } from "vitest";

import { destinoAposCredito } from "./destino-credito";

// A regra que o Lucas cobrou em 04/08, isolada e pura. Os 3 problemas viram 3 asserts diretos.
describe("destinoAposCredito", () => {
  // PROBLEMA 1: pré-venda LIGADA -> aprovado vai para a cobrança PIX (prevenda).
  it("aprovado + pré-venda LIGADA -> prevenda", () => {
    expect(destinoAposCredito({ aprovado: true, prevendaHabilitada: true })).toBe("prevenda");
  });

  // PROBLEMA 1: pré-venda DESLIGADA -> aprovado pula a cobrança e vai direto para credenciado.
  it("aprovado + pré-venda DESLIGADA -> credenciado (pula a cobrança)", () => {
    expect(destinoAposCredito({ aprovado: true, prevendaHabilitada: false })).toBe("credenciado");
  });

  // PROBLEMA 2: reprovado NUNCA avança — trava em revisao, independente do toggle.
  it("reprovado -> revisao (com pré-venda ligada)", () => {
    expect(destinoAposCredito({ aprovado: false, prevendaHabilitada: true })).toBe("revisao");
  });

  it("reprovado -> revisao (com pré-venda desligada)", () => {
    expect(destinoAposCredito({ aprovado: false, prevendaHabilitada: false })).toBe("revisao");
  });

  // PROBLEMA 3: o override da coordenação REUSA esta mesma função com aprovado=true. Ou seja,
  // destrava exatamente conforme o toggle — prevenda se ligada, senão credenciado.
  it("override (aprovado=true) destrava conforme o toggle", () => {
    expect(destinoAposCredito({ aprovado: true, prevendaHabilitada: true })).toBe("prevenda");
    expect(destinoAposCredito({ aprovado: true, prevendaHabilitada: false })).toBe("credenciado");
  });
});
