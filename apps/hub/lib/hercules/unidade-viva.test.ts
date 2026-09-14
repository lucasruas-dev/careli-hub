import { describe, expect, it } from "vitest";

import {
  apenasVivas,
  ehEspelho,
  resolverUnidades,
  unidadeQueResponde,
} from "./unidade-viva";

type Linha = { codigo: string; espelho_de: null | string; id: string };

const viva = (id: string): Linha => ({ codigo: id, espelho_de: null, id });
const espelho = (id: string, aponta: string): Linha => ({ codigo: id, espelho_de: aponta, id });

describe("quem é espelho", () => {
  it("linha viva não é espelho; linha com ponteiro é", () => {
    expect(ehEspelho(viva("LBRC0101"))).toBe(false);
    expect(ehEspelho(espelho("LABC0101", "LBRC0101"))).toBe(true);
  });

  // ⚠️ `espelho_de` pode chegar ausente (select que não pediu a coluna) ou string vazia. Nos dois
  // casos a linha responde por si — tratar ausência como "é espelho" esconderia unidade viva.
  it("coluna ausente ou vazia não faz da linha um espelho", () => {
    expect(ehEspelho({ id: "x" })).toBe(false);
    expect(ehEspelho({ espelho_de: "", id: "x" })).toBe(false);
  });
});

describe("o que se conta e se oferece", () => {
  it("tira os espelhos e mantém as vivas", () => {
    const lista = [viva("LBRC0101"), espelho("LABC0101", "LBRC0101"), viva("LBRC0102")];
    expect(apenasVivas(lista).map((l) => l.id)).toEqual(["LBRC0101", "LBRC0102"]);
  });

  // ⚠️ OS 83 DA LAGOA BONITA. Lote que existe só no pai não é duplicata: nenhuma gleba o assumiu.
  // Escondê-lo seria perder venda, e foi por isso que a marcação os deixou com `espelho_de` nulo.
  it("mantém o lote que só existe no pai", () => {
    const semGleba = viva("LABC0999");
    expect(apenasVivas([semGleba]).map((l) => l.id)).toEqual(["LABC0999"]);
  });
});

describe("quem responde pelo terreno", () => {
  it("o espelho devolve a linha viva que ele aponta", () => {
    const alvo = viva("LBRC0101");
    const porId = new Map([[alvo.id, alvo]]);
    expect(unidadeQueResponde(espelho("LABC0101", "LBRC0101"), porId).id).toBe("LBRC0101");
  });

  // ⚠️ RESPONDER COM A LINHA QUE SE TEM É MELHOR DO QUE RESPONDER ERRADO. Quando o alvo não veio no
  // conjunto carregado (um select que trouxe só o pai), devolver `null` obrigaria cada chamador a
  // inventar um caminho de exceção — e o caminho inventado é onde o defeito nasce.
  it("sem o alvo no conjunto, devolve a própria linha", () => {
    const orfao = espelho("LABC0101", "sumiu");
    expect(unidadeQueResponde(orfao, new Map()).id).toBe("LABC0101");
  });

  it("linha viva devolve ela mesma", () => {
    const v = viva("LBRC0101");
    expect(unidadeQueResponde(v, new Map([[v.id, v]])).id).toBe("LBRC0101");
  });
});

describe("resolver a lista inteira", () => {
  // ⚠️ O CASO QUE MAIS IMPORTA: pai e filhos carregados juntos. Sem a deduplicação, trocar o espelho
  // pela viva devolveria a mesma linha duas vezes — e a contagem dobrada, que esta lib existe para
  // matar, voltaria por outro caminho.
  it("pai e filho juntos devolvem UMA linha", () => {
    const lista = [espelho("LABC0101", "LBRC0101"), viva("LBRC0101")];
    expect(resolverUnidades(lista).map((l) => l.id)).toEqual(["LBRC0101"]);
  });

  it("espelho sozinho vira a viva, na posição dele", () => {
    const lista = [viva("LBRC0100"), espelho("LABC0101", "LBRC0101"), viva("LBRC0101")];
    expect(resolverUnidades(lista).map((l) => l.id)).toEqual(["LBRC0100", "LBRC0101"]);
  });

  it("lista só de vivas sai igual", () => {
    const lista = [viva("A"), viva("B"), viva("C")];
    expect(resolverUnidades(lista).map((l) => l.id)).toEqual(["A", "B", "C"]);
  });

  it("lista vazia não quebra", () => {
    expect(resolverUnidades([])).toEqual([]);
  });
});
