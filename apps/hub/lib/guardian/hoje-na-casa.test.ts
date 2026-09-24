import { describe, expect, it } from "vitest";

import { todayDateOnly } from "./compromissos";
import { hojeNaCasa } from "./hoje-na-casa";

// O QUE ESTES TESTES TRAVAM: o Hades roda em servidor UTC e é lido de São Paulo. Das 21h à
// meia-noite de Brasília o dia em UTC já é o seguinte, e era esse o "hoje" de todo o motor.

// 23h30 de Brasília em 24/09/2026 = 02h30 UTC de 25/09/2026.
const VINTE_E_TRES_E_MEIA = new Date("2026-09-25T02:30:00.000Z");

describe("hojeNaCasa", () => {
  it("às 23h30 de Brasília ainda é o dia de Brasília, não o de Greenwich", () => {
    expect(hojeNaCasa(VINTE_E_TRES_E_MEIA)).toBe("2026-09-24");
    expect(VINTE_E_TRES_E_MEIA.toISOString().slice(0, 10)).toBe("2026-09-25");
  });

  it("à meia-noite e cinco de Brasília o dia virou", () => {
    expect(hojeNaCasa(new Date("2026-09-25T03:05:00.000Z"))).toBe("2026-09-25");
  });

  it("no meio da tarde o dia é o mesmo dos dois lados", () => {
    expect(hojeNaCasa(new Date("2026-09-24T15:00:00.000Z"))).toBe("2026-09-24");
  });
});

describe("uma régua só de hoje", () => {
  it("todayDateOnly e hojeNaCasa respondem a mesma coisa às 23h30 de Brasília", () => {
    // ⚠️ ESTE É O TESTE QUE IMPEDE A SEGUNDA RÉGUA DE VOLTAR. A etapa do workflow e a régua de
    // lembretes discordarem sobre que dia é hoje é o defeito que este lote veio eliminar.
    expect(todayDateOnly(VINTE_E_TRES_E_MEIA)).toBe(hojeNaCasa(VINTE_E_TRES_E_MEIA));
    expect(todayDateOnly(VINTE_E_TRES_E_MEIA)).toBe("2026-09-24");
  });
});
