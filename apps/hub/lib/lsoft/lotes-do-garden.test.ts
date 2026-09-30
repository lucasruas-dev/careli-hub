import { describe, expect, it } from "vitest";

// O LOTE ANTIGO E O NOVO DO GARDEN (29/09/2026). O mapa é o real (143 lotes, sem nome nem CPF); os
// textos de `observacoes` abaixo são os FORMATOS medidos no LSoft, sem cliente nenhum junto.

import {
  conversaoDoLoteAntigo,
  loteAntigoDoNovo,
  loteNovoDoAntigo,
  lotesCitadosNoTexto,
  lotesDoMapaDoGarden,
  partesDoLoteNovo,
  rotuloDoLoteNovo,
} from "./lotes-do-garden";

describe("o mapa", () => {
  it("tem os 143 lotes conferidos, sem número antigo nem lote novo repetido", () => {
    const lotes = lotesDoMapaDoGarden();
    expect(lotes).toHaveLength(143);
    expect(new Set(lotes.map((l) => l.antigo)).size).toBe(143);
    expect(new Set(lotes.map((l) => l.novo)).size).toBe(143);
    for (const lote of lotes) expect(lote.novo).toMatch(/^Q\d{2} L\d{2}$/);
  });
});

describe("loteNovoDoAntigo", () => {
  it("converte pelo número corrido: os dois lotes do caso de 29/09 (397 e 400 da quadra 12)", () => {
    expect(loteNovoDoAntigo("12", "397")).toBe("Q12 L26");
    expect(loteNovoDoAntigo("12", "400")).toBe("Q12 L29");
    expect(loteNovoDoAntigo(12, 400)).toBe("Q12 L29");
    // O exemplo do cabeçalho da carteira: o "Q13 L365" do LSoft é o "Q13 L20" do boleto.
    expect(loteNovoDoAntigo("13", "365")).toBe("Q13 L20");
  });

  it("zero à esquerda não muda o lote", () => {
    expect(loteNovoDoAntigo("012", "0397")).toBe("Q12 L26");
  });

  it("fora do mapa, ou sem número: nulo (quem chama decide o aviso)", () => {
    expect(loteNovoDoAntigo("13", "383")).toBeNull();
    expect(loteNovoDoAntigo("12", "")).toBeNull();
    expect(loteNovoDoAntigo("12", null)).toBeNull();
    expect(loteNovoDoAntigo("12", "397/400")).toBeNull();
  });

  it("⚠️ a quadra do LSoft não veta: o número corrido decide, e a divergência vem marcada", () => {
    // Medido em 29/09/2026: o LSoft gravou o 107 na quadra 16, e o boleto do mesmo CPF é o Q08 L25,
    // que é o que o mapa dá para o 107 (quadra 8).
    expect(loteNovoDoAntigo("16", "107")).toBe("Q08 L25");
    expect(conversaoDoLoteAntigo("16", "107")).toEqual({ novo: "Q08 L25", quadraDiverge: true, quadraDoMapa: "8" });
    expect(conversaoDoLoteAntigo("8", "107")?.quadraDiverge).toBe(false);
    expect(conversaoDoLoteAntigo(null, "107")?.quadraDiverge).toBe(false);
    // O 284 veio com a quadra em branco no mapa: não há o que divergir.
    expect(conversaoDoLoteAntigo("12", "284")).toEqual({ novo: "Q17 L02", quadraDiverge: false, quadraDoMapa: null });
  });
});

describe("loteAntigoDoNovo", () => {
  it("volta do boleto para o LSoft, com ou sem hífen no rótulo", () => {
    expect(loteAntigoDoNovo("Q12 L26")).toEqual({ lote: "397", quadra: "12" });
    expect(loteAntigoDoNovo("Q12-L29")).toEqual({ lote: "400", quadra: "12" });
    expect(loteAntigoDoNovo("q12 l29")).toEqual({ lote: "400", quadra: "12" });
    expect(loteAntigoDoNovo("Q17 L02")).toEqual({ lote: "284", quadra: null });
  });

  it("lote novo fora do mapa, ou texto que não é lote: nulo", () => {
    expect(loteAntigoDoNovo("Q01 L01")).toBeNull();
    expect(loteAntigoDoNovo("00000487")).toBeNull();
    expect(loteAntigoDoNovo(null)).toBeNull();
  });

  it("ida e volta fecham para os 143", () => {
    for (const lote of lotesDoMapaDoGarden()) {
      expect(loteAntigoDoNovo(loteNovoDoAntigo(lote.quadra, lote.antigo))?.lote).toBe(lote.antigo);
    }
  });
});

describe("partesDoLoteNovo e rotuloDoLoteNovo", () => {
  it("normalizam as grafias do boleto para 'Qxx Lyy'", () => {
    expect(partesDoLoteNovo("Q6-L4")).toEqual({ lote: "04", quadra: "06" });
    expect(rotuloDoLoteNovo(" Q 12 L 26 ")).toBe("Q12 L26");
    expect(rotuloDoLoteNovo("APTO 205")).toBeNull();
  });
});

describe("lotesCitadosNoTexto", () => {
  it("lê os formatos medidos no LSoft do Garden", () => {
    expect(lotesCitadosNoTexto("LOTE: 76 - QUADRA: 09")).toEqual(["76"]);
    expect(lotesCitadosNoTexto("PARC. ANUAL LOTE: 397 - QUADRA: 12")).toEqual(["397"]);
    expect(lotesCitadosNoTexto("LOTE:138 QUADRA:07")).toEqual(["138"]);
    expect(lotesCitadosNoTexto("LOTE 333- QUADRA 15 - PARCELA ANUAL")).toEqual(["333"]);
    expect(lotesCitadosNoTexto("LOTE: 216 E 217\r\nQUADRA: 04")).toEqual(["216", "217"]);
    expect(lotesCitadosNoTexto("LOTE: 122 E 93 QUADRA: 07 E 08")).toEqual(["122", "93"]);
    expect(lotesCitadosNoTexto("ENTRADA | LOTES: 287/288/289 - QUADRA: 17")).toEqual(["287", "288", "289"]);
    expect(lotesCitadosNoTexto("LOTE:74/75  QUADRA:09")).toEqual(["74", "75"]);
    expect(lotesCitadosNoTexto("ENTRADA LOTES 324 E 325 QUADRA 15")).toEqual(["324", "325"]);
    // O "V" é erro de digitação do LSoft; o lote é o 179.
    expect(lotesCitadosNoTexto("ENTRADA LOTEV 179 - QUADRA 06 - PARCELA ANUAL")).toEqual(["179"]);
  });

  it("o número que não está colado ao LOTE não é lote (valor, parcela, quadra)", () => {
    expect(lotesCitadosNoTexto("LOTE 56 QUADRA 9 84 PARC 2119,05")).toEqual(["56"]);
    expect(lotesCitadosNoTexto("LOTE: 247 QUADRA: 04 ENTRADA 1/2")).toEqual(["247"]);
    expect(lotesCitadosNoTexto("LOTEAMENTO 12 QUADRA 3")).toEqual([]);
    expect(lotesCitadosNoTexto("PARC. OBRA")).toEqual([]);
    expect(lotesCitadosNoTexto(null)).toEqual([]);
  });

  it("citação repetida no mesmo texto conta uma vez", () => {
    expect(lotesCitadosNoTexto("LOTE: 84 E 85 QUADRA: 08 | LOTE: 84 E 85 QUADRA: 08")).toEqual(["84", "85"]);
  });
});
