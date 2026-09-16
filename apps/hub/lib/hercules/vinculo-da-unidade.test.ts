import { describe, expect, it } from "vitest";

import {
  categoriaPorNome,
  chaveDoTerreno,
  comparavel,
  type LinhaParaVincular,
  planoDeVinculo,
} from "./vinculo-da-unidade";

const linha = (
  id: string,
  quadra: string,
  lote: string,
  enterprise: string,
): LinhaParaVincular => ({ enterprise_id: enterprise, id, lote, quadra });

// O caso REAL do Lagoa Bonita: o mesmo terreno existe no pai (31) e na gleba (27).
const PAI = "31";
const LBR = "27";

describe("chaveDoTerreno", () => {
  it("quadra e lote identificam o terreno", () => {
    expect(chaveDoTerreno({ lote: "05", quadra: "C" })).toBe("C|5");
  });

  // ⚠️ O ZERO À ESQUERDA NÃO DISTINGUE LOTE. O pai grava "0101" onde a gleba grava "101" — sem
  // normalizar, o gêmeo não é encontrado e a categoria fica só de um lado.
  it("ignora zero à esquerda", () => {
    expect(chaveDoTerreno({ lote: "0101", quadra: "C" })).toBe(
      chaveDoTerreno({ lote: "101", quadra: "C" }),
    );
  });

  it("ignora caixa e espaço", () => {
    expect(chaveDoTerreno({ lote: " 7 ", quadra: " c " })).toBe("C|7");
  });

  it("vazio não vira coringa", () => {
    // Duas linhas sem quadra e sem lote têm a MESMA chave — e isso é correto: elas são
    // indistinguíveis. Quem chamar precisa saber que não dá para casar terreno sem quadra/lote.
    expect(chaveDoTerreno({ lote: null, quadra: null })).toBe("|");
  });
});

describe("planoDeVinculo", () => {
  const universo = [
    linha("pai-c101", "C", "0101", PAI),
    linha("lbr-c101", "C", "101", LBR),
    linha("pai-c102", "C", "0102", PAI),
    linha("lbr-c102", "C", "102", LBR),
  ];

  // ⚠️ O ALCANCE É POR TERRENO. Carimbar só a linha clicada recriaria a divergência pai × filho
  // numa coluna nova — o mapa do pai diria "Condomínio" e a Mesa, que lê a gleba, diria "sem".
  it("escolher a linha da gleba alcança também a do pai", () => {
    const r = planoDeVinculo(["lbr-c101"], universo);
    expect(r.ids.sort()).toEqual(["lbr-c101", "pai-c101"]);
    expect(r.terrenos).toBe(1);
    expect(r.porParentesco).toBe(1);
  });

  it("e escolher a do pai alcança a da gleba", () => {
    const r = planoDeVinculo(["pai-c102"], universo);
    expect(r.ids.sort()).toEqual(["lbr-c102", "pai-c102"]);
  });

  it("escolher as duas do mesmo terreno não duplica", () => {
    const r = planoDeVinculo(["pai-c101", "lbr-c101"], universo);
    expect(r.ids).toHaveLength(2);
    expect(r.terrenos).toBe(1);
    expect(r.porParentesco).toBe(0);
  });

  it("em massa: dois terrenos, quatro linhas", () => {
    const r = planoDeVinculo(["lbr-c101", "lbr-c102"], universo);
    expect(r.ids).toHaveLength(4);
    expect(r.terrenos).toBe(2);
    expect(r.porParentesco).toBe(2);
  });

  it("nada escolhido, nada a fazer", () => {
    expect(planoDeVinculo([], universo).ids).toEqual([]);
    expect(planoDeVinculo(["  "], universo).ids).toEqual([]);
  });

  it("id que não está no universo não carimba nada", () => {
    expect(planoDeVinculo(["nao-existe"], universo).ids).toEqual([]);
  });

  // ⚠️ O UNIVERSO É RESPONSABILIDADE DE QUEM CHAMA. Se a rota trouxer só a gleba, só a gleba é
  // carimbada — e o teste registra isso para ninguém achar que a função busca sozinha.
  it("universo sem o gêmeo carimba só o que veio", () => {
    const soAGleba = universo.filter((l) => l.enterprise_id === LBR);
    const r = planoDeVinculo(["lbr-c101"], soAGleba);
    expect(r.ids).toEqual(["lbr-c101"]);
    expect(r.porParentesco).toBe(0);
  });

  it("lote sem quadra nem lote não arrasta os outros iguais por engano", () => {
    // Duas linhas órfãs têm a mesma chave "|", então escolher uma alcança a outra. É o preço de
    // não ter chave — e o teste existe para que a rota AVISE em vez de o operador descobrir depois.
    const orfas = [linha("a", "", "", PAI), linha("b", "", "", LBR)];
    expect(planoDeVinculo(["a"], orfas).ids.sort()).toEqual(["a", "b"]);
  });
});

describe("comparavel", () => {
  it("acento e caixa não separam a mesma categoria", () => {
    expect(comparavel("CONDOMINIO")).toBe(comparavel("Condomínio"));
  });

  it("espaço duplo não separa", () => {
    expect(comparavel("Lotes  com  Infraestrutura")).toBe(
      comparavel("lotes com infraestrutura"),
    );
  });

  it("nulo vira vazio", () => {
    expect(comparavel(null)).toBe("");
    expect(comparavel(undefined)).toBe("");
  });
});

describe("categoriaPorNome", () => {
  // As categorias REAIS da Lagoa Bonita.
  const categorias = [
    { id: "cat-cond", nome: "Condomínio" },
    { id: "cat-lot", nome: "Loteamento" },
  ];

  it("acha pelo que o operador digita na planilha", () => {
    const mapa = categoriaPorNome(categorias);
    expect(mapa.get(comparavel("CONDOMINIO"))).toBe("cat-cond");
    expect(mapa.get(comparavel(" loteamento "))).toBe("cat-lot");
  });

  it("nome que não existe não casa", () => {
    expect(categoriaPorNome(categorias).get(comparavel("Chácara"))).toBeUndefined();
  });
});

describe("chaveDoTerreno no prédio (revisão de 16/09/2026)", () => {
  it("⚠️ apartamento preenchido: a chave é torre e apartamento, e dois apartamentos não colidem em '|'", () => {
    const a304 = chaveDoTerreno({ apartamento: "304", lote: null, quadra: null, torre: "A" });
    const a305 = chaveDoTerreno({ apartamento: "305", lote: null, quadra: null, torre: "A" });
    expect(a304).not.toBe("|");
    expect(a304).not.toBe(a305);
    // A mesma régua do cadastro: zero à esquerda e caixa não distinguem o apartamento.
    expect(chaveDoTerreno({ apartamento: "0304", lote: null, quadra: null, torre: " a " })).toBe(a304);
    // Torre diferente é outra unidade.
    expect(chaveDoTerreno({ apartamento: "304", lote: null, quadra: null, torre: "B" })).not.toBe(a304);
  });

  it("⚠️ o vínculo de um apartamento não carimba o prédio inteiro", () => {
    const universo: LinhaParaVincular[] = [
      { apartamento: "101", enterprise_id: "100000", id: "a101", lote: null, quadra: null, torre: "A" },
      { apartamento: "102", enterprise_id: "100000", id: "a102", lote: null, quadra: null, torre: "A" },
    ];
    expect(planoDeVinculo(["a101"], universo)).toEqual({ ids: ["a101"], porParentesco: 0, terrenos: 1 });
  });

  it("loteamento continua pela quadra e pelo lote (apartamento vazio não muda nada)", () => {
    expect(chaveDoTerreno({ apartamento: "  ", lote: "05", quadra: "C" })).toBe("C|5");
  });
});
