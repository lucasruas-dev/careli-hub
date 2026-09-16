import { describe, expect, it } from "vitest";

import { contadorDaGaleria, indiceVizinho, passoDoArrasto } from "./navegacao-da-galeria";

describe("indiceVizinho", () => {
  it("anda para os dois lados", () => {
    expect(indiceVizinho(2, 12, 1)).toBe(3);
    expect(indiceVizinho(2, 12, -1)).toBe(1);
  });

  it("dá a volta nas pontas", () => {
    expect(indiceVizinho(11, 12, 1)).toBe(0);
    expect(indiceVizinho(0, 12, -1)).toBe(11);
    expect(indiceVizinho(0, 3, -4)).toBe(2);
  });

  it("galeria de um item fica parada; vazia ou índice inválido volta a zero", () => {
    expect(indiceVizinho(0, 1, 1)).toBe(0);
    expect(indiceVizinho(3, 0, 1)).toBe(0);
    expect(indiceVizinho(Number.NaN, 5, 1)).toBe(1);
  });
});

describe("contadorDaGaleria", () => {
  it("conta em base 1", () => {
    expect(contadorDaGaleria(2, 12)).toBe("3 de 12");
    expect(contadorDaGaleria(0, 1)).toBe("1 de 1");
  });

  it("prende o índice dentro da galeria e some quando não há itens", () => {
    expect(contadorDaGaleria(40, 12)).toBe("12 de 12");
    expect(contadorDaGaleria(-3, 12)).toBe("1 de 12");
    expect(contadorDaGaleria(0, 0)).toBe("");
  });
});

describe("passoDoArrasto", () => {
  it("arrastar para a esquerda traz a próxima; para a direita, a anterior", () => {
    expect(passoDoArrasto(-80, 5)).toBe(1);
    expect(passoDoArrasto(90, -10)).toBe(-1);
  });

  it("arrasto curto ou mais vertical que horizontal não troca a foto", () => {
    expect(passoDoArrasto(-30, 0)).toBe(0);
    expect(passoDoArrasto(-80, 70)).toBe(0);
    expect(passoDoArrasto(Number.NaN, 0)).toBe(0);
  });
});
