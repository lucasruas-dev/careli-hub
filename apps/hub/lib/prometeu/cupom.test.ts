import { describe, expect, it } from "vitest";

import {
  codigoDoCupom,
  ehIdDeCupom,
  normalizarCodigoDeUnidade,
  validarProponentes,
} from "./cupom";

// A RESERVA DO LANÇAMENTO (24/08): a trava única depende do código normalizado, o cupom segue
// o desenho da credencial, e os proponentes têm as regras do C2X (máx. 5, soma 100%).
describe("normalizarCodigoDeUnidade", () => {
  it("upper + trim — 'vlo0212 ' e 'VLO0212' têm que colidir na trava", () => {
    expect(normalizarCodigoDeUnidade(" vlo0212 ")).toBe("VLO0212");
    expect(normalizarCodigoDeUnidade("rvpA23")).toBe("RVPA23");
  });
});

describe("cupom", () => {
  it("código curto no padrão RSV- + 6 do id", () => {
    expect(codigoDoCupom("a1b2c3d4-0000-0000-0000-000000000000")).toBe("RSV-A1B2C3");
  });

  it("só uuid é cupom — código digitado errado não busca nada", () => {
    expect(ehIdDeCupom("a1b2c3d4-0000-4000-8000-000000000000")).toBe(true);
    expect(ehIdDeCupom("RSV-A1B2C3")).toBe(false);
    expect(ehIdDeCupom("")).toBe(false);
  });
});

describe("validarProponentes", () => {
  const p = (credenciadoId: string, percentual: number) => ({
    credenciadoId,
    documento: null,
    nome: credenciadoId,
    percentual,
  });

  it("um titular a 100% passa", () => {
    expect(validarProponentes([p("a", 100)])).toBeNull();
  });

  it("divisão que fecha 100 passa, inclusive com dízima de 3", () => {
    expect(validarProponentes([p("a", 33.34), p("b", 33.33), p("c", 33.33)])).toBeNull();
  });

  it("soma diferente de 100 é recusada", () => {
    expect(validarProponentes([p("a", 60), p("b", 30)])).toMatch(/somar 100/);
  });

  it("mais de 5 é recusado (limite do C2X)", () => {
    const seis = ["a", "b", "c", "d", "e", "f"].map((id) => p(id, 100 / 6));
    expect(validarProponentes(seis)).toMatch(/5 proponentes/);
  });

  it("proponente repetido e percentual zero são recusados", () => {
    expect(validarProponentes([p("a", 50), p("a", 50)])).toMatch(/repetido/);
    expect(validarProponentes([p("a", 100), p("b", 0)])).toMatch(/maior que zero/);
  });
});
