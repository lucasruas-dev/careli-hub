import { describe, expect, it } from "vitest";

import { unidadeDaObservacao, unidadeParaExibir } from "./unidade";

// Os casos abaixo são TEXTOS REAIS medidos nas 6.776 parcelas do Vale do Sol e nas 13.212 do
// Garden. Se um formato novo aparecer numa carga futura, ele entra aqui antes da correção.
describe("unidadeDaObservacao", () => {
  it("le o formato mais comum do Vale do Sol", () => {
    expect(unidadeDaObservacao("APTO 205 BL 04 VALE DO SOL (643,87 72X)")).toBe("APTO 205 · BL 04");
  });

  it("aceita AP abreviado e BLOCO por extenso", () => {
    expect(unidadeDaObservacao("VENDA AP 06 BLOCO 04.")).toBe("APTO 6 · BL 04");
  });

  it("aceita dois-pontos e hifen no meio", () => {
    expect(unidadeDaObservacao("PARC. MENSAL | AP: 08 - BL: 04")).toBe("APTO 8 · BL 04");
  });

  it("aceita BLC e bloco de um digito", () => {
    expect(unidadeDaObservacao("APTO 06 BLC 1")).toBe("APTO 6 · BL 01");
  });

  it("aceita bloco colado no numero", () => {
    expect(unidadeDaObservacao("APTO 207 BL01")).toBe("APTO 207 · BL 01");
  });

  it("le apartamento mesmo sem bloco", () => {
    expect(unidadeDaObservacao("SINAL APTO 110")).toBe("APTO 110");
  });

  it("le lote e quadra do Garden", () => {
    expect(unidadeDaObservacao("LOTE: 109 QUADRA: 08")).toBe("Q8 L109");
    expect(unidadeDaObservacao("LOTE 3 QUADRA 8 70.000 PERMUTA")).toBe("Q8 L3");
  });

  it("⚠️ NAO devolve a observacao crua quando nao ha unidade — a coluna nao pode virar paragrafo", () => {
    expect(
      unidadeDaObservacao(
        "PARCELA COM VALOR DE R$ 524,55 AMORTIZADOS, DEVIDO A SALDO REMANESCENTE, CONFORME ADITIVO",
      ),
    ).toBeNull();
    expect(unidadeDaObservacao("")).toBeNull();
    expect(unidadeDaObservacao(null)).toBeNull();
  });

  it("nao confunde numero solto com apartamento", () => {
    expect(unidadeDaObservacao("PARCELA ANUAL 2026 R$ 2.000,00")).toBeNull();
  });
});

describe("unidadeParaExibir", () => {
  it("prefere as colunas do banco quando elas existem (Garden)", () => {
    expect(
      unidadeParaExibir({ lote: "109", observacoes: "APTO 205 BL 04", quadra: "8" }),
    ).toBe("Q8 L109");
  });

  it("cai no texto livre quando quadra e lote estao vazios (Vale do Sol)", () => {
    expect(
      unidadeParaExibir({ lote: null, observacoes: "APTO 205 BL 04 VALE DO SOL", quadra: null }),
    ).toBe("APTO 205 · BL 04");
  });

  it("devolve nulo quando nao ha nada reconhecivel", () => {
    expect(unidadeParaExibir({ lote: null, observacoes: "AJUSTE DE SALDO", quadra: null })).toBeNull();
  });
});
