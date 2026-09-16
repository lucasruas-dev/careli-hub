import { describe, expect, it } from "vitest";

import type { ApoloEnterpriseRow } from "@/lib/apolo/empreendimentos";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import { vitrineDoCredenciamento } from "./credenciamento";

// A VITRINE DO CREDENCIAMENTO E O PRODUTO QUE NASCEU NO PANTEON (onda 2, achado 27).
//
// ⚠️ O DEFEITO TRAVADO AQUI: com o catálogo do C2X na mão, todo id que ele não conhece era descartado
// como resíduo. O prédio cadastrado no Panteon (id a partir de 100000) é desconhecido do C2X por
// definição, e sumia da vitrine mesmo com o credenciamento ligado. O órfão de verdade (id antigo
// abaixo de 100000, como o `group:Vale do Ouro` de 14/09) continua fora.

const zero = { units: 0, value: 0 };

const doC2x = (p: Partial<ApoloEnterpriseRow> & { code: string; id: string }): ApoloEnterpriseRow => ({
  city: null,
  codes: [p.code],
  incorporador: null,
  mirror: false,
  mirrorLabel: null,
  mirrorNote: null,
  name: p.code,
  scenario: { bloqueado: zero, disponivel: zero, negociacao: zero, reservado: zero, total: zero, vendido: zero },
  state: null,
  stages: [],
  ...p,
});

const linha = (p: Partial<LinhaDoCadastro> & { codigo: string; id: string }): LinhaDoCadastro => ({
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

const CATALOGO: ApoloEnterpriseRow[] = [
  doC2x({ code: "GDN", id: "39", incorporador: "Cecílio Rocha", name: "GARDEN" }),
];

const CADASTRO: LinhaDoCadastro[] = [
  linha({ c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden" }),
  linha({ c2xEnterpriseId: "100000", codigo: "JAD", id: "jad", nome: "Ed. Jade", operadoPor: "inc-cecilio" }),
];

const CODE_BY_ID = new Map([
  ["39", "GDN"],
  ["100000", "JDX"],
  ["100001", "RUB"],
  ["36", "VOL"],
  ["group:Vale do Ouro", "VOC + VOL + VOR"],
]);

describe("vitrineDoCredenciamento", () => {
  it("⚠️ o id do Panteon (>= 100000) NÃO é descartado, e o nome e a sigla vêm do cadastro", () => {
    const vitrine = vitrineDoCredenciamento({
      ativos: ["39", "100000"],
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      codeById: CODE_BY_ID,
      logos: { "100000": "https://logo/jade.png" },
    });

    expect(vitrine).toEqual([
      {
        code: "JAD",
        codes: [],
        id: "100000",
        incorporador: null,
        logoUrl: "https://logo/jade.png",
        name: "ED. JADE",
        stageIds: [],
      },
      {
        code: "GDN",
        codes: ["GDN"],
        id: "39",
        incorporador: "Cecílio Rocha",
        logoUrl: null,
        name: "GARDEN",
        stageIds: [],
      },
    ]);
  });

  it("⚠️ id desconhecido ABAIXO de 100000 continua descartado com o catálogo na mão (o órfão de 14/09)", () => {
    const vitrine = vitrineDoCredenciamento({
      ativos: ["39", "36", "group:Vale do Ouro"],
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      codeById: CODE_BY_ID,
      logos: {},
    });

    expect(vitrine.map((card) => card.id)).toEqual(["39"]);
  });

  it("produto do Panteon sem o cadastro lido: fica na vitrine com a sigla do settings", () => {
    const vitrine = vitrineDoCredenciamento({
      ativos: ["100001"],
      cadastro: null,
      catalogo: CATALOGO,
      codeById: CODE_BY_ID,
      logos: {},
    });

    expect(vitrine).toEqual([
      { code: "RUB", codes: [], id: "100001", incorporador: null, logoUrl: null, name: "RUB", stageIds: [] },
    ]);
  });

  it("C2X fora do ar: nada é descartado (a regra antiga da sigla do settings continua valendo)", () => {
    const vitrine = vitrineDoCredenciamento({
      ativos: ["36", "100000"],
      cadastro: CADASTRO,
      catalogo: null,
      codeById: CODE_BY_ID,
      logos: {},
    });

    expect(vitrine.map((card) => [card.id, card.code, card.name])).toEqual([
      ["100000", "JAD", "ED. JADE"],
      ["36", "VOL", "VOL"],
    ]);
  });

  it("o C2X vence o cadastro quando os dois conhecem o id", () => {
    const vitrine = vitrineDoCredenciamento({
      ativos: ["100000"],
      cadastro: CADASTRO,
      catalogo: [doC2x({ code: "JDC", id: "100000", name: "JADE NO C2X" })],
      codeById: CODE_BY_ID,
      logos: {},
    });

    expect(vitrine[0]).toMatchObject({ code: "JDC", name: "JADE NO C2X" });
  });
});
