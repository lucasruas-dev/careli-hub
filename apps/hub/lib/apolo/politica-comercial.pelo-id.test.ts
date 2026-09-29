import { beforeEach, describe, expect, it, vi } from "vitest";

// A POLÍTICA COMERCIAL PELO ID DO EMPREENDIMENTO (PAN-124).
//
// A política e o split cadastrado filtravam por `e.code in (...)`, e a sigla muda num renome no
// legado (o 43 de RDV para PDI em 24/09/2026). Estes testes travam que as duas consultas recebem o
// `enterprises.id`, e que o split continua casado com a política pela sigla que o C2X devolve na linha.
//
// ⚠️ O C2X FALSO RESPONDE PELO ID: devolve as linhas do empreendimento cujo id veio nos parâmetros.

const estado = vi.hoisted(() => ({
  catalogoFora: false,
  chamadas: [] as Array<{ params: unknown[]; sql: string }>,
  /** A sigla do 43 no C2X agora. */
  siglaDo43: "PDI",
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
      const catalogo = ENTERPRISES_DO_C2X_EM_25_09_2026.filter(({ id }) => ![2, 31, 34].includes(id)).map(
        ({ code, id }) => ({
          codes: [id === 43 ? estado.siglaDo43 : code],
          id: String(id),
          stageIds: [String(id)],
        }),
      );
      return { ok: true, ...idsDoC2xDasSiglas(siglas, { catalogo }, opcoes) };
    }),
  };
});

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: vi.fn(() => ({
    ok: true,
    pool: {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        estado.chamadas.push({ params, sql });
        if (!params.includes(43)) return [[]];
        if (/split_enterprises/.test(sql)) {
          return [
            [
              { code: estado.siglaDo43, grupo: "Mensal", grupo_id: 4, percent: "97", perfil: "Incorporador", quem_recebe: "", split_nome: "PADRAO" },
              { code: estado.siglaDo43, grupo: "Mensal", grupo_id: 4, percent: "3", perfil: "Gestora de recebíveis", quem_recebe: "", split_nome: "PADRAO" },
            ],
          ];
        }
        return [
          [
            {
              code: estado.siglaDo43,
              commissioning_corretor: 4,
              enterprise_id: 43,
              initial_input_value: 10,
              loteador_percentage: 97,
              name: "PORTAL DO IBITURUNA",
              total_value_commission: 8,
            },
          ],
        ];
      }),
    },
  })),
}));

import { loadPoliticaComercial, loadPoliticaComercialPorIds } from "./politica-comercial";

beforeEach(() => {
  estado.catalogoFora = false;
  estado.chamadas = [];
  estado.siglaDo43 = "PDI";
});

describe("loadPoliticaComercial: a sigla vira id antes de ir ao C2X", () => {
  it("🔴 a política e o split filtram por `e.id in`, nenhuma por `e.code in`", async () => {
    const r = await loadPoliticaComercial(["PDI"]);
    expect(estado.chamadas).toHaveLength(2);
    for (const { params, sql } of estado.chamadas) {
      expect(sql).toContain("e.id in (?)");
      expect(sql).not.toMatch(/e\.code in/);
      expect(params).toEqual([43]);
    }
    if (!r.ok) throw new Error(r.error);
    // O split continua casado com a política pela sigla da linha: a gestão sai do Mensal.
    expect(r.politicas[0]).toMatchObject({ code: "PDI", enterpriseId: "43", gestaoCarteiraSplit: 97 });
  });

  it("🔴 renome (RDV → PDI) não muda a política: o id é o mesmo", async () => {
    estado.siglaDo43 = "RDV";
    const antes = await loadPoliticaComercial(["RDV"]);
    estado.siglaDo43 = "PDI";
    const depois = await loadPoliticaComercial(["PDI"]);
    if (!antes.ok || !depois.ok) throw new Error("leitura falhou");
    expect(antes.politicas).toHaveLength(1);
    expect({ ...depois.politicas[0], code: "RDV" }).toEqual(antes.politicas[0]);
  });

  it("🔴 catálogo ilegível devolve o erro de sempre do C2X fora, e não política vazia", async () => {
    estado.catalogoFora = true;
    const r = await loadPoliticaComercial(["PDI"]);
    expect(r).toEqual({ error: "Nao foi possivel ler a politica comercial no C2X.", ok: false });
    expect(estado.chamadas).toHaveLength(0);
  });
});

describe("loadPoliticaComercialPorIds", () => {
  it("usa o que o Apolo guarda pelo id, como a busca pela sigla", async () => {
    const r = await loadPoliticaComercialPorIds(
      ["43"],
      new Map([
        [
          "43",
          {
            comissaoCoordenadoraPercentual: null,
            comissaoImobiliariaPercentual: null,
            coordenadoraEntityId: null,
            entradaMinimaPercentual: 15,
            gestaoCarteiraPercentual: 97,
          },
        ],
      ]),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.politicas[0]).toMatchObject({ entradaMinimaApolo: 15, gestaoCarteiraApolo: 97 });
  });

  it("id do Panteon (>= 100000), `group:` e uuid não vão ao C2X", async () => {
    const r = await loadPoliticaComercialPorIds(["100001", "group:Lagoa Bonita", "pai:3a2696a7"]);
    expect(r).toEqual({ ok: true, politicas: [] });
    expect(estado.chamadas).toHaveLength(0);
  });
});
