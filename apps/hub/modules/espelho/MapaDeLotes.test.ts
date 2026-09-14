import { describe, expect, it } from "vitest";

import { areaDeToque } from "./MapaDeLotes";

// A ÁREA DE TOQUE — a função que devolveu o clique ao miolo do lote.
//
// ⚠️ O MOTOR DO MAPA NÃO TINHA UM ÚNICO TESTE, e foi ele que carregou o conserto de 14/09/2026
// para as duas telas. `areaDeToque` é a peça pura ali dentro: recebe o `d` do lote e devolve só o
// contorno do terreno, sem os sub-caminhos do balão do número — que com `fillRule="evenodd"`
// viram buraco, e buraco em SVG não recebe clique.
//
// ⚠️ OS `d` ABAIXO SÃO REAIS, lidos da geometria publicada em `hercules_masterplans` (bucket
// apolo-documents, prefixo hercules-masterplans) em 14/09/2026. Inventar caminho aqui testaria a
// minha ideia do formato, e o formato é do importador, não minha.

describe("areaDeToque", () => {
  it("corta no primeiro Z: sobra o terreno, sai o balão do número", () => {
    // JDG, lote com DOIS sub-caminhos. O segundo (depois do `z`) é o balão poligonizado.
    const d =
      "m 1010.3,682.9 -1.3,7.3 -1.7,11 -0.8,3.9 -1.3,5.4 -3.9,23.3 -1.3,9.4 15.5,-0.9 16.2,-0.8 0.6,-3.8 8.5,-51.2 z m -5.8,30.1 a 16,16 0 1 0 32,0 16,16 0 1 0 -32,0 z";

    const so = areaDeToque(d);

    expect(so).toBe(
      "m 1010.3,682.9 -1.3,7.3 -1.7,11 -0.8,3.9 -1.3,5.4 -3.9,23.3 -1.3,9.4 15.5,-0.9 16.2,-0.8 0.6,-3.8 8.5,-51.2 Z",
    );
    // O arco do balão não sobrou: é ele que abria o buraco.
    expect(so).not.toContain("a 16,16");
  });

  it("fecha o caminho mesmo quando o corte cai antes do fecho", () => {
    // Sem o `Z` no fim, `fillRule="nonzero"` ainda preencheria (o browser fecha sozinho), mas o
    // caminho explícito é o que garante a área maciça em qualquer motor de render.
    expect(areaDeToque("M 0,0 L 10,0 L 10,10 z m 2,2 h 4 v 4 h -4 z")).toBe(
      "M 0,0 L 10,0 L 10,10 Z",
    );
  });

  it("aceita o z minúsculo, que é o que o importador escreve", () => {
    // ⚠️ O INKSCAPE ESCREVE `z` MINÚSCULO, e um regex só com `Z` devolveria o caminho inteiro —
    // o buraco voltaria, calado, e ninguém notaria até alguém clicar.
    expect(areaDeToque("m 1,1 h 5 v 5 z m 2,2 h 1 z")).toBe("m 1,1 h 5 v 5 Z");
  });

  it("sem Z nenhum, devolve o caminho inteiro", () => {
    // ⚠️ DE PROPÓSITO, E É A DECISÃO QUE IMPORTA. Um `d` de figura só, ou um formato que o
    // importador mude amanhã, continua CLICÁVEL. Área de toque um pouco maior do que o desenho é
    // muito melhor do que clique perdido — que é o defeito que esta função existe para consertar.
    const semFecho = "M 0,0 L 10,0 L 10,10 L 0,10";
    expect(areaDeToque(semFecho)).toBe(semFecho);
  });

  it("o caminho de uma figura só atravessa sem perder nada", () => {
    // REP e VDO têm lotes assim: contorno e nada mais.
    expect(areaDeToque("m 100,200 h 30 v 40 h -30 z")).toBe("m 100,200 h 30 v 40 h -30 Z");
  });

  it("vazio e nulo não derrubam o render", () => {
    expect(areaDeToque("")).toBe("");
    // O componente recebe `c.d` de JSON baixado do storage: campo ausente chega como undefined, e
    // um throw aqui apagaria o mapa inteiro em vez de um lote.
    expect(areaDeToque(undefined as unknown as string)).toBe(undefined);
    expect(areaDeToque(null as unknown as string)).toBe(null);
  });

  it("três sub-caminhos: corta no primeiro, não no último", () => {
    // RVP: D04, D05, D12 e D13 têm DOIS balões cada — três sub-caminhos no total.
    const tres = "m 0,0 h 9 v 9 z m 2,2 h 2 z m 5,5 h 2 z";
    expect(areaDeToque(tres)).toBe("m 0,0 h 9 v 9 Z");
  });
});
