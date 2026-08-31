import { describe, expect, it } from "vitest";

import { valorDaCelula } from "./celula-do-excel";

// ⚠️ CADA CASO AQUI É UM BOLETO INDEVIDO EVITADO. Os embrulhos do ExcelJS chegam do arquivo real
// de 31/08/2026: os valores do mês são fórmula, e as observações que impedem a emissão vêm
// formatadas — que é como o Excel guarda `richText`.

describe("o que não é embrulho passa direto", () => {
  it("número, texto e data", () => {
    expect(valorDaCelula({ value: 1116.5 })).toBe(1116.5);
    expect(valorDaCelula({ value: "Não fazer" })).toBe("Não fazer");
    const d = new Date(2026, 8, 1);
    expect(valorDaCelula({ value: d })).toBe(d);
  });

  it("célula vazia é nula, não string vazia", () => {
    expect(valorDaCelula({ value: null })).toBeNull();
    expect(valorDaCelula(null)).toBeNull();
    expect(valorDaCelula({ text: "   ", value: null })).toBeNull();
  });
});

describe("fórmula devolve o RESULTADO", () => {
  it("o valor do mês, que na planilha é sempre calculado", () => {
    // `=H3*(1+$H$1/100)` — o reajuste aplicado célula a célula.
    expect(valorDaCelula({ result: 1116.4972, value: { formula: "H3*(1+0.61/100)", result: 1116.4972 } }))
      .toBe(1116.4972);
  });

  it("fórmula sem resultado cai no texto já renderizado", () => {
    expect(valorDaCelula({ text: "1.116,50", value: { formula: "H3*1.0061" } })).toBe("1.116,50");
  });

  it("#REF! NÃO vira número nem lixo — a linha cai em “sem valor”", () => {
    expect(valorDaCelula({ value: { error: "#REF!" } })).toBeNull();
    expect(valorDaCelula({ value: { formula: "X1/0", result: { error: "#DIV/0!" } } })).toBeNull();
  });
});

describe("texto formatado — o caso que quebraria a regra de emissão", () => {
  it("“PAGO ATÉ DEZ/26” em negrito continua sendo texto", () => {
    const celula = {
      text: "PAGO ATÉ DEZ/26 RETOMA JAN/27",
      value: {
        richText: [
          { font: { bold: true }, text: "PAGO ATÉ DEZ/26 " },
          { text: "RETOMA JAN/27" },
        ],
      },
    };
    // Sem este desembrulho seria "[object Object]", a regra não veria "pago",
    // e um cliente adiantado receberia boleto.
    expect(valorDaCelula(celula)).toBe("PAGO ATÉ DEZ/26 RETOMA JAN/27");
  });

  it("pedaço sem texto não estraga a junção", () => {
    expect(
      valorDaCelula({ value: { richText: [{ text: "Não " }, { font: {} }, { text: "fazer" }] } }),
    ).toBe("Não fazer");
  });

  it("richText vazio cai no texto da célula", () => {
    expect(valorDaCelula({ text: "Não fazer", value: { richText: [] } })).toBe("Não fazer");
  });
});

describe("célula mesclada vazia — o que derrubava o arquivo inteiro", () => {
  // ⚠️ CASO REAL, medido no arquivo de 31/08/2026. `celula.text` é um GETTER: numa célula
  // mesclada sem valor o ExcelJS estoura com "Cannot read properties of null (reading
  // 'toString')". Como todas as abas têm o título mesclado na primeira linha, ler `.text` de
  // entrada matava a leitura antes do primeiro cliente.
  const explosiva = (value: unknown) => ({
    get text(): string {
      throw new TypeError("Cannot read properties of null (reading 'toString')");
    },
    value,
  });

  it("o getter que explode não derruba a leitura", () => {
    expect(valorDaCelula(explosiva(null))).toBeNull();
    expect(valorDaCelula(explosiva({ algo: "estranho" }))).toBeNull();
  });

  it("e o valor cru continua chegando sem tocar no getter", () => {
    expect(valorDaCelula(explosiva(1116.5))).toBe(1116.5);
    expect(valorDaCelula(explosiva("Não fazer"))).toBe("Não fazer");
  });
});

describe("outros embrulhos", () => {
  it("link devolve o rótulo visível", () => {
    expect(valorDaCelula({ value: { hyperlink: "mailto:x@y.com", text: "x@y.com" } })).toBe("x@y.com");
  });

  it("objeto desconhecido NUNCA vira “[object Object]”", () => {
    const v = valorDaCelula({ value: { algo: "estranho" } });
    expect(v).not.toBe("[object Object]");
    expect(v).toBeNull();
  });

  it("fórmula encadeada demais não roda para sempre", () => {
    const fundo = { result: { result: { result: { result: { result: 1 } } } } };
    expect(valorDaCelula({ text: "1", value: fundo })).toBe("1");
  });
});
