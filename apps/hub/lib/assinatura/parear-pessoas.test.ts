import { describe, expect, it } from "vitest";

import { chaveDeNome, parearPessoas } from "./parear-pessoas";

// A RÉGUA DO PAREAMENTO 1-PARA-1, extraída de `casarAssinantes` (F3 da fonte única). Pessoas fictícias.

describe("parearPessoas", () => {
  it("e-mail primeiro, depois nome sem acento; cada índice num par só", () => {
    const r = parearPessoas(
      [
        { email: "a@exemplo.test", nome: "Ana" },
        { email: null, nome: "JOSÉ  DA SILVA" },
      ],
      [
        { email: "jose@exemplo.test", nome: "Jose da Silva" },
        { email: "A@Exemplo.test", nome: "Outra grafia" },
      ],
    );
    expect([...r.pares.entries()].sort()).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(r.paresPorPosicao).toEqual([]);
  });

  it("e-mail repetido não pinta duas linhas com um par (consome o par)", () => {
    const r = parearPessoas(
      [
        { email: "c@exemplo.test", nome: "C1" },
        { email: "c@exemplo.test", nome: "C2" },
      ],
      [{ email: "c@exemplo.test", nome: "zzz" }],
    );
    expect(r.pares.size).toBe(1);
    expect(r.pares.get(0)).toBe(0);
    expect(r.soNoA).toEqual([1]);
  });

  it("sobra única de cada lado vira par por posição (palpite, contado); N × N não", () => {
    const um = parearPessoas([{ email: "x@exemplo.test", nome: "X" }], [{ email: "y@exemplo.test", nome: "Y" }]);
    expect(um.paresPorPosicao).toEqual([0]);
    const dois = parearPessoas(
      [
        { email: "x@exemplo.test", nome: "X" },
        { email: "w@exemplo.test", nome: "W" },
      ],
      [
        { email: "y@exemplo.test", nome: "Y" },
        { email: "z@exemplo.test", nome: "Z" },
      ],
    );
    expect(dois.pares.size).toBe(0);
    expect(dois.soNoA).toEqual([0, 1]);
    expect(dois.soNoB).toEqual([0, 1]);
  });

  it("chaveDeNome tira acento, caixa e espaço dobrado", () => {
    expect(chaveDeNome("  José   da Silva ")).toBe("JOSE DA SILVA");
  });
});
