import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SituacaoDasUnidades } from "@/lib/hercules/situacao-da-unidade";

// O FUNIL DE VENDAS PERGUNTA AO C2X PELO ID, E NUNCA PELA SIGLA (PAN-124).
//
// A sigla muda quando alguém renomeia no legado (o 43 de RDV para PDI em 24/09/2026; o 30 de LAG para
// ADT e para ACT), e as quatro consultas desta leitura filtravam por `e.code in (...)`. Estes testes
// travam que a sigla só entra na tradução (pelo catálogo) e que o C2X recebe o `enterprises.id`.
//
// ⚠️ O C2X FALSO RESPONDE PELO ID: devolve as linhas do empreendimento cujo id veio nos parâmetros.
// Uma consulta que voltasse a mandar a sigla receberia zero linhas, e o teste do renome cairia.

const estado = vi.hoisted(() => ({
  catalogoFora: false,
  chamadas: [] as Array<{ params: unknown[]; sql: string }>,
  renomes: new Map<string, string>(),
}));

vi.mock("@/lib/apolo/c2x-pelo-id-servidor", async () => {
  const { idsDoC2xDasSiglas } =
    await vi.importActual<typeof import("@/lib/apolo/c2x-pelo-id")>("@/lib/apolo/c2x-pelo-id");
  const { ENTERPRISES_DO_C2X_EM_25_09_2026 } = await vi.importActual<
    typeof import("@/lib/apolo/c2x-pelo-id.fixture")
  >("@/lib/apolo/c2x-pelo-id.fixture");
  return {
    idsDoC2xDasSiglasAoVivo: vi.fn(async (siglas: Iterable<unknown>, opcoes = {}) => {
      if (estado.catalogoFora) return { erro: "Catálogo indisponível.", ok: false };
      // O catálogo de verdade já sai sem TSC, SDT e LAB (a consulta dele exclui pelo id).
      const catalogo = ENTERPRISES_DO_C2X_EM_25_09_2026.filter(({ id }) => ![2, 31, 34].includes(id)).map(
        ({ code, id }) => ({
          codes: [estado.renomes.get(code) ?? code],
          id: String(id),
          stageIds: [String(id)],
        }),
      );
      return { ok: true, ...idsDoC2xDasSiglas(siglas, { catalogo }, opcoes) };
    }),
  };
});

/** Uma unidade do 43, com a proposta mais recente finalizada (6). */
const UNIDADE_DO_43 = {
  ar_id: 900,
  block: "01",
  client_code: "CLI1",
  client_id: 1,
  client_name: "Comprador",
  enterprise_code: "PDI",
  enterprise_id: 43,
  id: 5001,
  imobiliaria_code: null,
  imobiliaria_id: null,
  imobiliaria_name: null,
  lot: "01",
  price: 150000,
  stage_id: 6,
  stage_since: "2026-09-20T10:00:00Z",
  unit_name: "PDI0101",
};

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: vi.fn(() => ({
    ok: true,
    pool: {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        estado.chamadas.push({ params, sql });
        const pediuO43 = params.includes(43);
        if (/as stage_since/.test(sql)) return [pediuO43 ? [UNIDADE_DO_43] : []];
        if (/group by ar\.acquisition_request_stage_id/.test(sql)) {
          return [pediuO43 ? [{ n: 2, stage_id: 7, vgv: 300000 }] : []];
        }
        if (/limit 40/.test(sql)) {
          return [
            pediuO43
              ? [{ at: "2026-09-20T10:00:00Z", block: "01", enterprise_code: "PDI", from_stage: 5, lot: "01", price: 150000, to_stage: 6 }]
              : [],
          ];
        }
        return [[]];
      }),
    },
  })),
  sanitizeHadesDbError: (erro: unknown) => String(erro),
}));

vi.mock("@/lib/apolo/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/server")>()),
  createApoloAdminClient: vi.fn(() => ({ cliente: "admin" })),
}));

vi.mock("@/lib/apolo/carteira", () => ({
  loadApoloUnitInstallments: vi.fn(async () => ({ installments: [], ok: true })),
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

import { loadApoloEnterpriseVendas, loadApoloEnterpriseVendasPorIds } from "./vendas";

beforeEach(() => {
  estado.catalogoFora = false;
  estado.chamadas = [];
  estado.renomes = new Map();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadApoloEnterpriseVendas: a sigla vira id antes de ir ao C2X (PAN-124)", () => {
  it("🔴 as QUATRO consultas filtram por `e.id in`, nenhuma por `e.code in`", async () => {
    const r = await loadApoloEnterpriseVendas(["PDI"]);
    expect(r.ok).toBe(true);

    expect(estado.chamadas).toHaveLength(4);
    for (const { params, sql } of estado.chamadas) {
      expect(sql).toContain("e.id in (?)");
      expect(sql).not.toMatch(/e\.code in/);
      expect(params).toEqual([43]);
    }
  });

  it("🔴 renome no C2X (RDV → PDI) não muda o funil: o id é o mesmo", async () => {
    estado.renomes.set("PDI", "RDV");
    const antes = await loadApoloEnterpriseVendas(["RDV"]);
    estado.renomes.clear();
    const depois = await loadApoloEnterpriseVendas(["PDI"]);

    if (!antes.ok || !depois.ok) throw new Error("leitura falhou");
    expect(antes.data.totalUnits).toBe(1);
    expect(antes.data.terminals.find((t) => t.terminal === "cancelado")?.proposals).toBe(2);
    expect(antes.data.movements).toHaveLength(1);
    expect(depois.data).toEqual(antes.data);
  });

  it("grupo (as siglas das divisões) vai num `in` só, com os ids em ordem", async () => {
    await loadApoloEnterpriseVendas(["LBF", "LBR", "LBP"]);
    expect(estado.chamadas[0]?.sql).toContain("e.id in (?, ?, ?)");
    expect(estado.chamadas[0]?.params).toEqual([27, 32, 33]);
  });

  it("⚠️ TSC, SDT e LAB continuam fora, agora pelo id: não há consulta", async () => {
    const r = await loadApoloEnterpriseVendas(["TSC", "SDT", "LAB"]);
    expect(r.ok).toBe(true);
    expect(estado.chamadas).toHaveLength(0);
  });

  it("🔴 catálogo ilegível (C2X fora) é ERRO, e não um funil zerado", async () => {
    estado.catalogoFora = true;
    const r = await loadApoloEnterpriseVendas(["PDI"]);
    expect(r).toEqual({ error: "Catálogo indisponível.", ok: false });
    expect(estado.chamadas).toHaveLength(0);
  });

  it("sigla que o C2X não conhece (produto do Panteon) devolve o funil vazio, sem ir ao C2X", async () => {
    const r = await loadApoloEnterpriseVendas(["CEC"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.totalUnits).toBe(0);
    expect(estado.chamadas).toHaveLength(0);
  });
});

describe("loadApoloEnterpriseVendasPorIds", () => {
  it("aceita o id como texto ou número, e pergunta pelo id", async () => {
    await loadApoloEnterpriseVendasPorIds(["43"]);
    expect(estado.chamadas[0]?.params).toEqual([43]);
    estado.chamadas = [];
    await loadApoloEnterpriseVendasPorIds([43]);
    expect(estado.chamadas[0]?.params).toEqual([43]);
  });

  it("⚠️ os excluídos nunca entram, como na busca pela sigla", async () => {
    await loadApoloEnterpriseVendasPorIds([34, 43]);
    expect(estado.chamadas[0]?.params).toEqual([43]);
    estado.chamadas = [];
    await loadApoloEnterpriseVendasPorIds([34]);
    expect(estado.chamadas).toHaveLength(0);
  });

  it("id do Panteon (>= 100000), `group:` e uuid não vão ao C2X", async () => {
    const r = await loadApoloEnterpriseVendasPorIds([
      "100003",
      "group:Lagoa Bonita",
      "3a2696a7-144e-4b17-9d0e-000000000000",
    ]);
    expect(r.ok).toBe(true);
    expect(estado.chamadas).toHaveLength(0);
  });
});
