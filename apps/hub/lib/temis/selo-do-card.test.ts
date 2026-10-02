import { describe, expect, it } from "vitest";

import { seloDeAssinaturaDoCard } from "./selo-do-card";

// O SELO DO CARD POR ETAPA (02/10/2026). Lucas: *"vamos mudar esse 3/11 eu preciso ver somente dos
// compradores. se tiver um comprador 1/1 ou 0/1 se tiver mais a mesma logica"* e *"quando mover para o
// pre-faturamento mostrar o quadro real de assinatura, ae vale trazer a visao que temos hoje do 3/11"*.

describe("seloDeAssinaturaDoCard", () => {
  it("Em assinatura, um comprador: '0/1 comprador', e o title diz o contrato inteiro", () => {
    expect(
      seloDeAssinaturaDoCard("assinatura", { assinaram: 3, compradores: { assinaram: 0, total: 1 }, total: 11 }),
    ).toEqual({
      numero: "0/1",
      palavra: "comprador",
      titulo: "0 de 1 comprador assinou · 3 de 11 no contrato",
    });
  });

  it("Em assinatura, mais de um comprador: '1/2 compradores'", () => {
    expect(
      seloDeAssinaturaDoCard("assinatura", { assinaram: 4, compradores: { assinaram: 1, total: 2 }, total: 11 }),
    ).toEqual({
      numero: "1/2",
      palavra: "compradores",
      titulo: "1 de 2 compradores assinaram · 4 de 11 no contrato",
    });
  });

  it("⚠️ Pré-faturamento: o contrato inteiro, como era ('3/11 assinaram'), mesmo com os compradores na contagem", () => {
    expect(
      seloDeAssinaturaDoCard("prazo_legal", { assinaram: 3, compradores: { assinaram: 1, total: 1 }, total: 11 }),
    ).toEqual({ numero: "3/11", palavra: "assinaram", titulo: "3 de 11 assinaram." });
  });

  it("Em assinatura sem comprador marcado no quadro (ou rota antiga, sem o campo): o total", () => {
    expect(seloDeAssinaturaDoCard("assinatura", { assinaram: 2, compradores: null, total: 5 })).toEqual({
      numero: "2/5",
      palavra: "assinaram",
      titulo: "2 de 5 assinaram.",
    });
    expect(seloDeAssinaturaDoCard("assinatura", { assinaram: 2, total: 5 })?.numero).toBe("2/5");
  });

  it("sem contagem: sem selo", () => {
    expect(seloDeAssinaturaDoCard("assinatura", null)).toBeNull();
    expect(seloDeAssinaturaDoCard("prazo_legal", undefined)).toBeNull();
  });
});
