import { describe, expect, it } from "vitest";

import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import { cardsDoPanteon, cardsSaemSemOC2x, juntarCards, type ProdutoDoIncorporador } from "./cards-do-panteon";
import { cenarioVazio } from "./painel-de-produtos";

// OS CARDS DE /api/incorporador/produtos PARA O PRODUTO QUE SÓ EXISTE NO PANTEON.
//
// ⚠️ O DEFEITO: a rota montava os cards 100% pelo C2X, e os prédios da Cecílio (id a partir de
// 100000) não tinham card. Aqui: o produto do Panteon da sessão aparece com a moldura do cadastro e
// o estoque do Panteon; o de fora da sessão não aparece; o que o C2X conhece não vira card repetido.

const linha = (
  p: Partial<LinhaDoCadastro> & { codigo: string; id: string },
): LinhaDoCadastro => ({
  c2xEnterpriseId: null,
  cidade: null,
  nome: p.codigo,
  operadoPor: null,
  ordem: 0,
  paiId: null,
  tipoProduto: "loteamento",
  uf: null,
  vendendo: true,
  ...p,
});

const CADASTRO: LinhaDoCadastro[] = [
  linha({ c2xEnterpriseId: "37", codigo: "VOC", id: "voc", nome: "Vale do Ouro · VOC" }),
  linha({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden" }),
  linha({ c2xEnterpriseId: "31", codigo: "LAB", id: "lab", nome: "Lagoa Bonita" }),
  linha({
    c2xEnterpriseId: "100000",
    cidade: "Ipatinga",
    codigo: "JAD",
    id: "jad",
    nome: "ED. JADE",
    tipoProduto: "vertical",
    uf: "MG",
  }),
  linha({ c2xEnterpriseId: "100001", cidade: "Ipatinga", codigo: "RUB", id: "rub", nome: "Ed. Rubi", uf: "MG" }),
  // Um produto do Panteon com etapas: o pai e duas torres.
  linha({ c2xEnterpriseId: "100010", codigo: "GTW", id: "gtw", nome: "Giant Towers" }),
  linha({ c2xEnterpriseId: "100011", codigo: "GT1", id: "gt1", nome: "Giant Towers · Torre 1", paiId: "gtw" }),
  linha({ c2xEnterpriseId: "100012", codigo: "GT2", id: "gt2", nome: "Giant Towers · Torre 2", paiId: "gtw" }),
];

// O C2X conhece o VOC e o Garden (o LAB está fora do catálogo por EXCLUDED_ENTERPRISE_CODES).
const NO_C2X = [{ stageIds: ["37", "39"] }];

const ESTOQUE = new Map([
  ["100000", { ...cenarioVazio(), disponivel: { units: 30, value: 9_000_000 }, total: { units: 40, value: 12_000_000 } }],
]);

function montar(permitidos: string[], extra: Partial<Parameters<typeof cardsDoPanteon>[0]> = {}) {
  return cardsDoPanteon({
    cadastro: CADASTRO,
    comCarteira: new Set(),
    estoque: ESTOQUE,
    idsNoC2x: NO_C2X,
    logos: {},
    masterplans: {},
    permitidos,
    ...extra,
  });
}

describe("cardsDoPanteon", () => {
  it("⚠️ sessão SÓ com produto do Panteon: o card sai com nome, cidade, UF e estoque", () => {
    const cards = montar(["100000"], {
      comCarteira: new Set(["100000"]),
      logos: { "100000": "https://logo/jade.png" },
      masterplans: { "100000": "https://mapa/jade" },
    });
    expect(cards).toEqual([
      {
        carteiraAdministrada: true,
        cidade: "Ipatinga",
        code: "JAD",
        enterpriseIds: ["100000"],
        estoque: ESTOQUE.get("100000"),
        id: "100000",
        logoUrl: "https://logo/jade.png",
        masterplanInterno: null,
        masterplanUrl: "https://mapa/jade",
        // O nome em caixa alta ganha a mesma apresentação dos cards do C2X.
        nome: "Ed. Jade",
        origem: "panteon",
        tipoProduto: "vertical",
        uf: "MG",
      },
    ]);
  });

  it("sessão mista: só o do Panteon vira card aqui (o do C2X já vem da outra fonte)", () => {
    expect(montar(["37", "39", "100000"]).map((c) => c.code)).toEqual(["JAD"]);
  });

  it("⚠️ não amplia: prédio que a sessão não traz não vira card", () => {
    expect(montar(["100000"]).some((c) => c.code === "RUB")).toBe(false);
  });

  it("produto sem unidade no Panteon: card com estoque nulo, e não some", () => {
    expect(montar(["100001"])[0]?.estoque).toBeNull();
  });

  it("⚠️ o pai com filho autorizado não vira segundo card; o pai sozinho vira", () => {
    expect(montar(["100010", "100011", "100012"]).map((c) => c.code)).toEqual(["GT1", "GT2"]);
    expect(montar(["100010"]).map((c) => c.code)).toEqual(["GTW"]);
  });

  it("⚠️ C2X fora do ar (ninguém conhecido): o cadastro responde pelo que a sessão traz, menos o LAB", () => {
    const cards = montar(["37", "31", "100000"], { idsNoC2x: [] });
    expect(cards.map((c) => c.code).sort()).toEqual(["JAD", "VOC"]);
  });

  it("cadastro fora do ar: nenhum card do Panteon", () => {
    expect(montar(["100000"], { cadastro: null })).toEqual([]);
  });
});

describe("juntarCards", () => {
  const card = (id: string, nome: string, origem: "c2x" | "panteon"): ProdutoDoIncorporador => ({
    carteiraAdministrada: false,
    cidade: null,
    code: id,
    enterpriseIds: [id],
    estoque: null,
    id,
    logoUrl: null,
    masterplanInterno: null,
    masterplanUrl: null,
    nome,
    origem,
    uf: null,
  });

  it("em ordem alfabética e sem repetir id (o do C2X ganha)", () => {
    const juntos = juntarCards(
      [card("39", "Garden", "c2x"), card("37", "Vale do Ouro", "c2x")],
      [card("100000", "Ed. Jade", "panteon"), card("39", "Garden (cadastro)", "panteon")],
    );
    expect(juntos.map((c) => [c.nome, c.origem])).toEqual([
      ["Ed. Jade", "panteon"],
      ["Garden", "c2x"],
      ["Vale do Ouro", "c2x"],
    ]);
  });
});

describe("cardsSaemSemOC2x", () => {
  it("⚠️ C2X fora: só a sessão 100% do Panteon sai pelo cadastro; com legado na sessão, 503", () => {
    const linha = [{}];
    expect(cardsSaemSemOC2x({ linhasDoPanteon: linha, permitidos: ["100000", "100001"] })).toBe(true);
    for (const permitidos of [["37", "100000"], ["group:Lagoa Bonita", "100000"], ["9001", "100000"]]) {
      expect(cardsSaemSemOC2x({ linhasDoPanteon: linha, permitidos })).toBe(false);
    }
    // Sem card do Panteon para mostrar, "nenhum produto" seria afirmação errada.
    expect(cardsSaemSemOC2x({ linhasDoPanteon: [], permitidos: ["100000"] })).toBe(false);
    expect(cardsSaemSemOC2x({ linhasDoPanteon: linha, permitidos: [] })).toBe(false);
  });
});
