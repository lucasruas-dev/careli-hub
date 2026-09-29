import { describe, expect, it } from "vitest";

import { diaEmBrasilia, emBrasilia } from "./instante";

// ⚠️ O QUE ESTES TESTES PROTEGEM: o DIA da assinatura que vai para `hercules_propostas.
// data_assinatura` (DATE) e o começo do prazo de 7 dias. A Clicksign manda o mesmo instante em dois
// fusos no mesmo payload; um `slice(0, 10)` sobre o `Z` grava o dia seguinte para toda assinatura
// feita depois das 21h em Brasília.

describe("diaEmBrasilia", () => {
  it("23:30 em Brasília é o dia do próprio dia", () => {
    expect(diaEmBrasilia("2026-09-11T23:30:00-03:00")).toBe("2026-09-11");
  });

  it("02:30Z é o dia ANTERIOR em Brasília (o slice diria o dia seguinte)", () => {
    expect(diaEmBrasilia("2026-09-12T02:30:00Z")).toBe("2026-09-11");
    expect("2026-09-12T02:30:00Z".slice(0, 10)).toBe("2026-09-12");
  });

  it("o que não se lê é nulo, nunca um dia inventado", () => {
    expect(diaEmBrasilia("ontem")).toBeNull();
    expect(diaEmBrasilia("")).toBeNull();
    expect(diaEmBrasilia(null)).toBeNull();
  });
});

describe("emBrasilia", () => {
  it("escreve o mesmo instante com -03:00", () => {
    const texto = emBrasilia("2026-09-12T02:24:44.972Z");
    expect(texto).toBe("2026-09-11T23:24:44.972-03:00");
    // O instante é o mesmo: só o jeito de escrever mudou.
    expect(Date.parse(texto ?? "")).toBe(Date.parse("2026-09-12T02:24:44.972Z"));
  });

  it("23:30-03:00 é guardado como veio", () => {
    expect(emBrasilia("2026-09-11T23:30:00.000-03:00")).toBe("2026-09-11T23:30:00.000-03:00");
  });

  it("o que não se lê é nulo", () => {
    expect(emBrasilia("sem data")).toBeNull();
    expect(emBrasilia(undefined)).toBeNull();
  });
});
