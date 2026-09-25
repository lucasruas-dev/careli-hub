import { describe, expect, it } from "vitest";

import { agrupar } from "@/lib/apolo/catalogo-empreendimentos";
import {
  ANALYTICS_EXCLUDED_ENTERPRISE_IDS,
  EXCLUDED_ENTERPRISE_CODES,
  EXCLUDED_ENTERPRISE_IDS,
} from "@/lib/guardian/c2x-analytics";

import {
  divisoesDoGrupo,
  filtroPorIds,
  filtroSemExcluidos,
  idDoC2x,
  idsDoC2xDasSiglas,
  idsDoC2xDosPedidos,
  semExcluidos,
} from "./c2x-pelo-id";
import {
  ENTERPRISES_DO_C2X_EM_25_09_2026 as C2X,
  PAIS_E_DIVISOES_DO_PANTEON_EM_25_09_2026 as CADASTRO,
} from "./c2x-pelo-id.fixture";

// O PAN-124 troca `e.code in (...)` por `e.id in (...)` em ~29 consultas ao C2X. A regra é resultado
// IDÊNTICO ao de hoje para quem não foi renomeado. Estes testes provam a tradução contra o retrato do
// C2X de 25/09/2026 (a fixture), e travam os casos que motivaram a troca: o 43 (RDV -> PDI) e o 30
// (LAG -> ADT -> ACT).

// O catálogo EXATO que a produção monta hoje: o mesmo `select ... where e.code not in (EXCLUDED)` e o
// mesmo `agrupar`, sobre a tabela medida.
const CATALOGO = agrupar(
  C2X.filter((linha) => !EXCLUDED_ENTERPRISE_CODES.includes(linha.code)).map((linha) => ({
    code: linha.code,
    id: linha.id,
    name: linha.code,
  })),
);

/** O que `e.code in (codes)` devolveria na tabela medida: os ids das linhas com aquelas siglas. */
function idsPelaSiglaHoje(codes: readonly string[]): number[] {
  const alvo = new Set(codes.map((c) => c.trim().toUpperCase()));
  return C2X.filter((linha) => alvo.has(linha.code))
    .map((linha) => linha.id)
    .sort((a, b) => a - b);
}

describe("idDoC2x", () => {
  it("aceita o número do C2X como texto ou número, aparado", () => {
    expect(idDoC2x("37")).toBe(37);
    expect(idDoC2x(" 37 ")).toBe(37);
    expect(idDoC2x(37)).toBe(37);
  });

  it("recusa o que não é id do C2X: produto do Panteon, grupo, pai, uuid, zero, negativo, fração", () => {
    expect(idDoC2x("100000")).toBeNull();
    expect(idDoC2x("100123")).toBeNull();
    expect(idDoC2x("group:Lagoa Bonita")).toBeNull();
    expect(idDoC2x("pai:6204a86b-26e4-5385-a888-2f4cfbf1bac2")).toBeNull();
    expect(idDoC2x("6204a86b-26e4-5385-a888-2f4cfbf1bac2")).toBeNull();
    expect(idDoC2x("0")).toBeNull();
    expect(idDoC2x("-3")).toBeNull();
    expect(idDoC2x("3.5")).toBeNull();
    expect(idDoC2x("")).toBeNull();
    expect(idDoC2x(null)).toBeNull();
    expect(idDoC2x(undefined)).toBeNull();
  });

  it("o ZZ TESTE (9001) passa: está abaixo do corte do Panteon e o C2X não tem esse id", () => {
    expect(idDoC2x("9001")).toBe(9001);
    expect(C2X.some((linha) => linha.id === 9001)).toBe(false);
  });
});

describe("a exclusão pelo id", () => {
  it("🔴 o id devolve as MESMAS linhas que a sigla devolvia em 25/09/2026", () => {
    // `e.code not in ('TSC','SDT','LAB','LAG')` × `e.id not in (2, 31, 34)`, na tabela medida.
    const pelaSigla = C2X.filter((l) => !EXCLUDED_ENTERPRISE_CODES.includes(l.code)).map((l) => l.id);
    const peloId = C2X.filter((l) => !EXCLUDED_ENTERPRISE_IDS.includes(l.id)).map((l) => l.id);
    expect(peloId).toEqual(pelaSigla);
  });

  it("🔴 o 30 NÃO é excluído: a sigla LAG não casa com nada desde 16/07/2026, e hoje ele aparece", () => {
    expect(C2X.find((l) => l.id === 30)?.code).toBe("ACT");
    expect(C2X.some((l) => l.code === "LAG")).toBe(false);
    expect(EXCLUDED_ENTERPRISE_IDS).not.toContain(30);
    expect(semExcluidos([30, 31])).toEqual([30]);
  });

  it("semExcluidos tira os excluídos, sem repetir, em ordem crescente", () => {
    expect(semExcluidos([37, 2, 36, 37, 34, 31])).toEqual([36, 37]);
    expect(semExcluidos([31, 35], [])).toEqual([31, 35]);
    expect(semExcluidos([31, 35, 36], ANALYTICS_EXCLUDED_ENTERPRISE_IDS)).toEqual([36]);
  });

  it("filtroSemExcluidos monta o `not in` com os parâmetros", () => {
    expect(filtroSemExcluidos()).toEqual({ params: [2, 31, 34], sql: "e.id not in (?, ?, ?)" });
    expect(filtroSemExcluidos("eu.enterprise_id", ANALYTICS_EXCLUDED_ENTERPRISE_IDS)).toEqual({
      params: [2, 31, 34, 35],
      sql: "eu.enterprise_id not in (?, ?, ?, ?)",
    });
    // Sem nada a excluir, o WHERE continua válido.
    expect(filtroSemExcluidos("e.id", [])).toEqual({ params: [], sql: "1 = 1" });
  });

  it("recusa coluna que não é nome de coluna: o texto vai colado no SQL", () => {
    expect(() => filtroSemExcluidos("e.id; drop table x")).toThrow();
    expect(() => filtroPorIds("e.id) or (1=1", [1])).toThrow();
  });
});

describe("filtroPorIds", () => {
  it("monta o `in` com os ids sem repetir, em ordem crescente", () => {
    expect(filtroPorIds("e.id", [37, 36, 37])).toEqual({ params: [36, 37], sql: "e.id in (?, ?)" });
  });

  it("🔴 lista vazia é `null`: nem `in ()` (erro de sintaxe) nem o C2X inteiro", () => {
    expect(filtroPorIds("e.id", [])).toBeNull();
    expect(filtroPorIds("e.id", [0, -1, Number.NaN])).toBeNull();
  });
});

describe("divisoesDoGrupo", () => {
  it("as três fontes dão as mesmas divisões para os cinco grupos (medido em 25/09/2026)", () => {
    const esperado: Record<string, number[]> = {
      "group:Lagoa Bonita": [27, 32, 33],
      "group:Lavra do Ouro": [1, 4],
      "group:Portal dos Vales": [7, 10],
      "group:Rio de Pedras": [13, 14, 15],
      "group:Vale do Ouro": [36, 37, 41],
    };
    for (const [grupo, ids] of Object.entries(esperado)) {
      expect(divisoesDoGrupo(grupo, { catalogo: CATALOGO })).toEqual(ids);
      expect(divisoesDoGrupo(grupo, { cadastro: CADASTRO })).toEqual(ids);
      expect(divisoesDoGrupo(grupo, {})).toEqual(ids);
      expect(divisoesDoGrupo(grupo, { cadastro: CADASTRO, catalogo: CATALOGO })).toEqual(ids);
    }
  });

  it("🔴 o pai não entra: nem o LAB (31) na Lagoa Bonita, nem o espelho VLO (35) no Vale do Ouro", () => {
    const fontes = { cadastro: CADASTRO, catalogo: CATALOGO };
    expect(divisoesDoGrupo("group:Lagoa Bonita", fontes)).not.toContain(31);
    expect(divisoesDoGrupo("group:Vale do Ouro", fontes)).not.toContain(35);
  });

  it("🔴 renome de uma divisão no C2X não tira a divisão do grupo", () => {
    // O LBR renomeado no legado: o `agrupar` casa as divisões pela sigla e deixa a gleba de fora.
    const renomeado = agrupar(
      C2X.filter((l) => !EXCLUDED_ENTERPRISE_CODES.includes(l.code)).map((l) => ({
        code: l.code === "LBR" ? "LBX" : l.code,
        id: l.id,
        name: l.code,
      })),
    );
    expect(renomeado.find((e) => e.id === "group:Lagoa Bonita")?.stageIds).toEqual(["33", "32"]);
    // O cadastro do Panteon e os ids fixos seguram o 27.
    expect(divisoesDoGrupo("group:Lagoa Bonita", { cadastro: CADASTRO, catalogo: renomeado })).toEqual([
      27, 32, 33,
    ]);
  });

  it("aceita o nome em outra caixa e sem acento; grupo desconhecido não tem divisão", () => {
    expect(divisoesDoGrupo("GROUP:lagoa bonita", { catalogo: CATALOGO })).toEqual([27, 32, 33]);
    expect(divisoesDoGrupo("group:Nao Existe", { cadastro: CADASTRO, catalogo: CATALOGO })).toEqual([]);
    expect(divisoesDoGrupo("37", { catalogo: CATALOGO })).toEqual([]);
  });
});

describe("idsDoC2xDosPedidos", () => {
  it("🔴 cada linha do catálogo de hoje: o id dela dá o MESMO conjunto que as siglas dela davam", () => {
    for (const emp of CATALOGO) {
      const peloId = idsDoC2xDosPedidos([emp.id], { cadastro: CADASTRO, catalogo: CATALOGO });
      expect(peloId.ids, emp.id).toEqual(idsPelaSiglaHoje(emp.codes));
      expect(peloId.semId).toEqual([]);
    }
  });

  it("🔴 id de divisão vale só por ela: quem tem o 33 (LBF) não lê o 27 (LBR)", () => {
    expect(idsDoC2xDosPedidos(["33"], { cadastro: CADASTRO, catalogo: CATALOGO }).ids).toEqual([33]);
  });

  it("id do Panteon não vai ao C2X e não é erro; lixo vai para `semId`", () => {
    const r = idsDoC2xDosPedidos(["100001", "37", "pai:abc", " ", "group:Nao Existe"], {
      catalogo: CATALOGO,
    });
    expect(r.ids).toEqual([37]);
    expect(r.semId).toEqual(["pai:abc", "group:Nao Existe"]);
  });

  it("tira os excluídos por padrão, e só eles", () => {
    expect(idsDoC2xDosPedidos(["31", "2", "34", "30", "35"]).ids).toEqual([30, 35]);
    expect(idsDoC2xDosPedidos(["31", "35"], {}, { excluir: [] }).ids).toEqual([31, 35]);
    expect(
      idsDoC2xDosPedidos(["35", "37"], {}, { excluir: ANALYTICS_EXCLUDED_ENTERPRISE_IDS }).ids,
    ).toEqual([37]);
  });

  it("🔴 o 43 renomeado (RDV -> PDI) continua achado: o id não depende da sigla", () => {
    expect(idsDoC2xDosPedidos(["43"]).ids).toEqual([43]);
  });

  it("aceita número e junta pedidos repetidos", () => {
    expect(idsDoC2xDosPedidos([37, "37", "group:Vale do Ouro"], { catalogo: CATALOGO }).ids).toEqual([
      36, 37, 41,
    ]);
  });
});

describe("idsDoC2xDasSiglas", () => {
  it("🔴 toda sigla do catálogo de hoje vira o id que `e.code = sigla` acharia", () => {
    for (const emp of CATALOGO) {
      for (const code of emp.codes) {
        const r = idsDoC2xDasSiglas([code], { catalogo: CATALOGO });
        expect(r.ids, code).toEqual(idsPelaSiglaHoje([code]));
        expect(r.semId).toEqual([]);
      }
    }
  });

  it("🔴 o conjunto de siglas do produto consolidado dá o conjunto de ids das divisões", () => {
    expect(idsDoC2xDasSiglas(["LBF", "LBR", "LBP"], { catalogo: CATALOGO }).ids).toEqual([27, 32, 33]);
    expect(idsDoC2xDasSiglas(["voc", " vol "], { catalogo: CATALOGO }).ids).toEqual([36, 37]);
  });

  it("sigla excluída não vira id: o catálogo não a tem, e pelo cadastro ela cai na exclusão", () => {
    const soCatalogo = idsDoC2xDasSiglas(["LAB", "VOC"], { catalogo: CATALOGO });
    expect(soCatalogo.ids).toEqual([37]);
    expect(soCatalogo.semId).toEqual(["LAB"]);
    const comCadastro = idsDoC2xDasSiglas(["LAB", "VOC"], { cadastro: CADASTRO, catalogo: CATALOGO });
    expect(comCadastro.ids).toEqual([37]);
    expect(comCadastro.semId).toEqual([]);
  });

  it("🔴 sigla guardada antes do renome: o catálogo não a conhece, o cadastro sim", () => {
    // O cenário de 24/09: o Panteon ainda guardava RDV para o 43, e o C2X já dizia PDI.
    const cadastroAntigo = [
      { c2xEnterpriseId: "43", codigo: "RDV", id: "s-rdv", nome: "Recanto do Vale", paiId: null },
    ];
    expect(idsDoC2xDasSiglas(["RDV"], { catalogo: CATALOGO }).semId).toEqual(["RDV"]);
    expect(idsDoC2xDasSiglas(["RDV"], { cadastro: cadastroAntigo, catalogo: CATALOGO }).ids).toEqual([
      43,
    ]);
  });

  it("o catálogo vence o cadastro quando os dois conhecem a sigla", () => {
    const cadastroErrado = [
      { c2xEnterpriseId: "99", codigo: "VOC", id: "x", nome: "Outro", paiId: null },
    ];
    expect(idsDoC2xDasSiglas(["VOC"], { cadastro: cadastroErrado, catalogo: CATALOGO }).ids).toEqual([
      37,
    ]);
  });

  it("o ZZ TESTE acha o 9001 pelo cadastro (inofensivo); catálogo vazio deixa tudo em `semId`", () => {
    // O C2X não tem id 9001: a consulta não acha nada, como `e.code in ('TST')` já não achava.
    expect(idsDoC2xDasSiglas(["TST"], { cadastro: CADASTRO, catalogo: CATALOGO }).ids).toEqual([9001]);
    const semCatalogo = idsDoC2xDasSiglas(["VOC", "VOL"], { catalogo: [] });
    expect(semCatalogo.ids).toEqual([]);
    expect(semCatalogo.semId).toEqual(["VOC", "VOL"]);
    expect(idsDoC2xDasSiglas([" ", ""], { catalogo: CATALOGO })).toEqual({ ids: [], semId: [] });
  });
});
