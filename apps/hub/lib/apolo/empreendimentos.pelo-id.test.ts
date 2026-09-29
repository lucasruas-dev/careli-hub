import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SituacaoDasUnidades } from "@/lib/hercules/situacao-da-unidade";

// A LISTA, O CADASTRO E AS UNIDADES DO EMPREENDIMENTO PERGUNTAM AO C2X PELO ID (PAN-124).
//
// A sigla muda quando alguém renomeia no legado (o 43 de RDV para PDI em 24/09/2026; o 30 de LAG para
// ADT, que fez a exclusão por sigla parar de excluir). Estes testes travam que a exclusão é pelo id e
// que as buscas por sigla só usam a sigla para achar o id.
//
// ⚠️ O C2X FALSO ENTENDE OS DOIS FILTROS, e responde como o MySQL: `e.code` compara sigla e `e.id`
// compara id. Uma consulta que voltasse a filtrar pela sigla receberia outra resposta, e o teste cai.

const estado = vi.hoisted(() => ({
  /** O catálogo em cache (até 10 minutos): pode estar atrás do C2X logo depois de um renome. */
  catalogo: [] as Array<{ code: string; id: number }>,
  catalogoFora: false,
  chamadas: [] as Array<{ params: unknown[]; sql: string }>,
  /** O C2X de agora: id e sigla. */
  enterprises: [] as Array<{ code: string; id: number }>,
}));

vi.mock("@/lib/apolo/c2x-pelo-id-servidor", async () => {
  const { idsDoC2xDasSiglas } =
    await vi.importActual<typeof import("@/lib/apolo/c2x-pelo-id")>("@/lib/apolo/c2x-pelo-id");
  return {
    idsDoC2xDasSiglasAoVivo: vi.fn(async (siglas: Iterable<unknown>, opcoes = {}) => {
      if (estado.catalogoFora) return { erro: "Catálogo indisponível.", ok: false };
      const catalogo = estado.catalogo
        .filter(({ id }) => ![2, 31, 34].includes(id))
        .map(({ code, id }) => ({ codes: [code], id: String(id), stageIds: [String(id)] }));
      return { ok: true, ...idsDoC2xDasSiglas(siglas, { catalogo }, opcoes) };
    }),
  };
});

/** Os empreendimentos que passam no WHERE, lido como o MySQL leria (sigla ou id, `in` ou `not in`). */
function passamNoFiltro(sql: string, params: unknown[]) {
  const [, coluna, nao, marcadores] = /e\.(code|id) (not )?in \(([?, ]+)\)/.exec(sql) ?? [];
  if (!coluna) return estado.enterprises;
  const n = (marcadores?.match(/\?/g) ?? []).length;
  // O filtro vem por último nos parâmetros de todas as consultas deste arquivo.
  const valores = params.slice(params.length - n);
  return estado.enterprises.filter((emp) => {
    const dentro = valores.includes(coluna === "id" ? emp.id : emp.code);
    return nao ? !dentro : dentro;
  });
}

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: vi.fn(() => ({
    ok: true,
    pool: {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        estado.chamadas.push({ params, sql });
        const emps = passamNoFiltro(sql, params);
        // A ficha do cadastro.
        if (/focal_name/.test(sql)) {
          return [emps.map((e) => ({ code: e.code, enterprise_id: e.id, name: `EMP ${e.id}` }))];
        }
        // As unidades (a aba Unidades e as dos cards): uma por empreendimento.
        if (/from enterprise_unities u/.test(sql)) {
          return [
            emps.map((e) => ({
              block: "01",
              enterprise_code: e.code,
              enterprise_id: e.id,
              id: e.id * 100,
              lot: "01",
              price: 1000,
              unit_name: `${e.code}0101`,
            })),
          ];
        }
        // A lista de empreendimentos.
        return [emps.map((e) => ({ city: null, code: e.code, id: e.id, incorporador: null, name: `EMP ${e.id}`, state: null }))];
      }),
    },
  })),
  sanitizeHadesDbError: (erro: unknown) => String(erro),
}));

vi.mock("@/lib/apolo/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/server")>()),
  createApoloAdminClient: vi.fn(() => ({ cliente: "admin" })),
}));

vi.mock("@/lib/prometeu/data", () => ({
  createPrometeuClient: vi.fn(() => ({ cliente: "prometeu" })),
}));

vi.mock("@/lib/prometeu/reservas-vivas", () => ({
  reservasVivasPorCodigo: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/hercules/situacao-da-unidade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/situacao-da-unidade")>()),
  lerSituacaoDasUnidades: vi.fn(
    async (): Promise<SituacaoDasUnidades> => ({
      porCodigo: new Map(),
      porLinha: new Map(),
      porOrigemC2x: new Map(),
      terreno: () => undefined,
      unidades: [],
    }),
  ),
}));

import { ENTERPRISES_DO_C2X_EM_25_09_2026 } from "./c2x-pelo-id.fixture";
import {
  loadApoloEnterpriseCadastro,
  loadApoloEnterprises,
  loadApoloEnterpriseUnits,
  loadApoloEnterpriseUnitsPorIds,
} from "./empreendimentos";

/** A sigla trocada no C2X, como a Nívea faz no legado. O catálogo em cache ainda não viu. */
function renomearNoC2x(id: number, code: string) {
  estado.enterprises = estado.enterprises.map((e) => (e.id === id ? { ...e, code } : e));
}

/** O C2X e o catálogo com a mesma sigla (o cache já venceu). */
function renomear(id: number, code: string) {
  renomearNoC2x(id, code);
  estado.catalogo = estado.catalogo.map((e) => (e.id === id ? { ...e, code } : e));
}

beforeEach(() => {
  estado.catalogoFora = false;
  estado.chamadas = [];
  estado.enterprises = ENTERPRISES_DO_C2X_EM_25_09_2026.map((e) => ({ ...e }));
  estado.catalogo = ENTERPRISES_DO_C2X_EM_25_09_2026.map((e) => ({ ...e }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("loadApoloEnterprises: a exclusão é pelo id (PAN-124)", () => {
  it("🔴 as duas consultas excluem `e.id not in (2, 31, 34)`, e nenhuma compara sigla", async () => {
    const r = await loadApoloEnterprises({ comSituacao: false });
    expect(r.ok).toBe(true);
    expect(estado.chamadas).toHaveLength(2);
    for (const { params, sql } of estado.chamadas) {
      expect(sql).toContain("e.id not in (?, ?, ?)");
      expect(sql).not.toMatch(/e\.code (not )?in/);
      expect(params).toEqual([2, 31, 34]);
    }
  });

  it("🔴 o teste renomeado continua fora (o LAG → ADT fez a lista por sigla deixar o 30 entrar)", async () => {
    renomear(34, "TSX");
    const r = await loadApoloEnterprises({ comSituacao: false });
    if (!r.ok) throw new Error(r.error);
    const ids = r.data.rows.flatMap((row) => [row.id, ...row.stages.map((s) => s.id)]);
    expect(ids).not.toContain("34");
    expect(ids).not.toContain("31");
    expect(ids).not.toContain("2");
    // O 30 (ACT) nunca foi excluído pelo id, e continua na lista, como hoje.
    expect(ids).toContain("30");
  });
});

describe("loadApoloEnterpriseCadastro: a sigla vira id (PAN-124)", () => {
  it("🔴 pergunta ao C2X por `e.id in`, e a resposta não ganha o `enterpriseId`", async () => {
    const r = await loadApoloEnterpriseCadastro(["PDI"]);
    expect(estado.chamadas).toHaveLength(1);
    expect(estado.chamadas[0]?.sql).toContain("e.id in (?)");
    expect(estado.chamadas[0]?.sql).not.toMatch(/e\.code in/);
    expect(estado.chamadas[0]?.params).toEqual([43]);

    if (!r.ok) throw new Error(r.error);
    expect(r.cadastros).toHaveLength(1);
    expect(r.cadastros[0]?.code).toBe("PDI");
    expect(r.cadastros[0]).not.toHaveProperty("enterpriseId");
  });

  it("renome (RDV → PDI): a sigla de antes e a de depois acham a mesma ficha", async () => {
    renomear(43, "RDV");
    const antes = await loadApoloEnterpriseCadastro(["RDV"]);
    renomear(43, "PDI");
    const depois = await loadApoloEnterpriseCadastro(["PDI"]);
    if (!antes.ok || !depois.ok) throw new Error("leitura falhou");
    expect(antes.cadastros.map((c) => c.name)).toEqual(["EMP 43"]);
    expect(depois.cadastros.map((c) => c.name)).toEqual(["EMP 43"]);
  });

  it("🔴 renomeado no C2X com o catálogo ainda no cache: a sigla de antes acha a ficha pelo id", async () => {
    // Pela sigla, `e.code in ('RDV')` não acharia nada: no C2X ela já é PDI.
    renomear(43, "RDV");
    renomearNoC2x(43, "PDI");
    const r = await loadApoloEnterpriseCadastro(["RDV"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.cadastros.map((c) => [c.name, c.code])).toEqual([["EMP 43", "PDI"]]);
  });

  it("⚠️ TSC, SDT e LAB continuam fora (a tradução exclui): não há consulta", async () => {
    const r = await loadApoloEnterpriseCadastro(["TSC", "SDT", "LAB"]);
    expect(r).toEqual({ cadastros: [], ok: true });
    expect(estado.chamadas).toHaveLength(0);
  });

  it("🔴 catálogo ilegível é ERRO, e não zero fichas", async () => {
    estado.catalogoFora = true;
    const r = await loadApoloEnterpriseCadastro(["PDI"]);
    expect(r).toEqual({ error: "Catálogo indisponível.", ok: false });
    expect(estado.chamadas).toHaveLength(0);
  });
});

describe("loadApoloEnterpriseUnits: a sigla vira id (PAN-124)", () => {
  it("🔴 pergunta ao C2X por `e.id in`, nunca por `e.code in`", async () => {
    await loadApoloEnterpriseUnits(["LBF", "LBR", "LBP"]);
    expect(estado.chamadas).toHaveLength(1);
    expect(estado.chamadas[0]?.sql).toContain("e.id in (?, ?, ?)");
    expect(estado.chamadas[0]?.sql).not.toMatch(/e\.code in/);
    expect(estado.chamadas[0]?.params).toEqual([27, 32, 33]);
  });

  it("🔴 renome (RDV → PDI) não muda as unidades, nem com o catálogo ainda no cache", async () => {
    renomear(43, "RDV");
    const antes = await loadApoloEnterpriseUnits(["RDV"]);
    // O C2X já é PDI; o catálogo ainda diz RDV. Pela sigla, `e.code in ('RDV')` voltaria vazio.
    renomearNoC2x(43, "PDI");
    const noCache = await loadApoloEnterpriseUnits(["RDV"]);
    renomear(43, "PDI");
    const depois = await loadApoloEnterpriseUnits(["PDI"]);
    if (!antes.ok || !noCache.ok || !depois.ok) throw new Error("leitura falhou");
    expect(antes.units).toHaveLength(1);
    expect(noCache.units.map((u) => u.id)).toEqual(antes.units.map((u) => u.id));
    expect(depois.units.map((u) => u.id)).toEqual(antes.units.map((u) => u.id));
  });

  it("⚠️ por id: os excluídos nunca entram, e id do Panteon ou `group:` não vão ao C2X", async () => {
    await loadApoloEnterpriseUnitsPorIds([34, "43"]);
    expect(estado.chamadas[0]?.params).toEqual([43]);
    estado.chamadas = [];
    const r = await loadApoloEnterpriseUnitsPorIds(["100002", "group:Vale do Ouro", 31]);
    expect(r).toEqual({ ok: true, units: [] });
    expect(estado.chamadas).toHaveLength(0);
  });

  it("🔴 catálogo ilegível é ERRO, e não a aba vazia", async () => {
    estado.catalogoFora = true;
    const r = await loadApoloEnterpriseUnits(["PDI"]);
    expect(r.ok).toBe(false);
    expect(estado.chamadas).toHaveLength(0);
  });
});
