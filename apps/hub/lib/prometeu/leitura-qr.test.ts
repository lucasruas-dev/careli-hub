import { describe, expect, it } from "vitest";

import { normalizarLeituraDoQr } from "./leitura-qr";

// O caso REAL do primeiro teste com o leitor (28/08/2026, Villa Paris): o QR da FLAVIA
// CALDEIRA ANDRADE chegou com ponto e vírgula no lugar do hífen, porque o leitor estava em
// layout de teclado diferente do Windows da máquina.
const ID_DA_FLAVIA = "b61427ca-3d5b-407b-937e-7c47769531f5";

describe("conserta o separador que o layout do teclado trocou", () => {
  it("ponto e vírgula — o caso que aconteceu de verdade", () => {
    expect(normalizarLeituraDoQr("b61427ca;3d5b;407b;937e;7c47769531f5")).toBe(ID_DA_FLAVIA);
  });

  it("as outras trocas comuns de layout", () => {
    for (const sep of ["/", "'", "?", "_", "=", ":", ","]) {
      const lido = ID_DA_FLAVIA.replace(/-/g, sep);
      expect(normalizarLeituraDoQr(lido)).toBe(ID_DA_FLAVIA);
    }
  });

  it("leitor que come o separador (32 hex corridos)", () => {
    expect(normalizarLeituraDoQr(ID_DA_FLAVIA.replace(/-/g, ""))).toBe(ID_DA_FLAVIA);
  });

  it("deixa o UUID certo como está, e normaliza a caixa", () => {
    expect(normalizarLeituraDoQr(ID_DA_FLAVIA)).toBe(ID_DA_FLAVIA);
    expect(normalizarLeituraDoQr(ID_DA_FLAVIA.toUpperCase())).toBe(ID_DA_FLAVIA);
  });

  it("apara espaço em volta (o leitor às vezes manda um a mais)", () => {
    expect(normalizarLeituraDoQr(`  ${ID_DA_FLAVIA}  `)).toBe(ID_DA_FLAVIA);
  });
});

describe("não estraga o que não é UUID", () => {
  it("código de unidade passa intacto", () => {
    expect(normalizarLeituraDoQr("VLO-0212")).toBe("VLO-0212");
    expect(normalizarLeituraDoQr("RSV-A1B2C3")).toBe("RSV-A1B2C3");
  });

  it("nome digitado à mão passa intacto", () => {
    expect(normalizarLeituraDoQr("Maria; Jose")).toBe("Maria; Jose");
  });

  it("texto com separadores MISTURADOS não vira UUID — seria adivinhação", () => {
    expect(normalizarLeituraDoQr("b61427ca;3d5b-407b;937e;7c47769531f5")).toBe(
      "b61427ca;3d5b-407b;937e;7c47769531f5",
    );
  });

  it("hex com tamanho errado passa intacto", () => {
    expect(normalizarLeituraDoQr("b61427ca;3d5b;407b;937e;7c4776953")).toBe(
      "b61427ca;3d5b;407b;937e;7c4776953",
    );
    expect(normalizarLeituraDoQr("abc123")).toBe("abc123");
  });

  it("vazio continua vazio", () => {
    expect(normalizarLeituraDoQr("")).toBe("");
    expect(normalizarLeituraDoQr("   ")).toBe("");
  });
});
