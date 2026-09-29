import { beforeEach, describe, expect, it, vi } from "vitest";

// O CATÁLOGO EXCLUI PELO ID (PAN-124). É dele que sai a tradução sigla → id de toda leitura do C2X
// (lib/apolo/c2x-pelo-id-servidor.ts): um excluído que entrasse aqui por ter sido renomeado voltaria a
// aparecer em tudo o que traduz pelo catálogo. Foi o que a lista por sigla fez com o 30 quando o LAG
// virou ADT (16/07/2026).
//
// ⚠️ O C2X FALSO RESPONDE COMO O MYSQL: `e.code not in` compara sigla, `e.id not in` compara id.

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ params: unknown[]; sql: string }>,
  enterprises: [] as Array<{ code: string; id: number; name: string }>,
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: vi.fn(() => ({
    ok: true,
    pool: {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        estado.chamadas.push({ params, sql });
        const [, coluna] = /e\.(code|id) not in/.exec(sql) ?? [];
        const linhas = estado.enterprises.filter(
          (e) => !coluna || !params.includes(coluna === "id" ? e.id : e.code),
        );
        return [[...linhas].sort((a, b) => a.code.localeCompare(b.code))];
      }),
    },
  })),
}));

import { ENTERPRISES_DO_C2X_EM_25_09_2026 } from "./c2x-pelo-id.fixture";
import { catalogoDeEmpreendimentos, limparCacheDoCatalogo } from "./catalogo-empreendimentos";

beforeEach(() => {
  limparCacheDoCatalogo();
  estado.chamadas = [];
  estado.enterprises = ENTERPRISES_DO_C2X_EM_25_09_2026.map((e) => ({ ...e, name: `EMP ${e.id}` }));
});

describe("catalogoDeEmpreendimentos: a exclusão é pelo id", () => {
  it("🔴 filtra `e.id not in (2, 31, 34)`, e não compara sigla", async () => {
    await catalogoDeEmpreendimentos(1_000);
    expect(estado.chamadas).toHaveLength(1);
    expect(estado.chamadas[0]?.sql).toContain("e.id not in (?, ?, ?)");
    expect(estado.chamadas[0]?.sql).not.toMatch(/e\.code (not )?in/);
    expect(estado.chamadas[0]?.params).toEqual([2, 31, 34]);
    // O `order by e.code` continua: a ordem do catálogo é a de sempre.
    expect(estado.chamadas[0]?.sql).toMatch(/order by e\.code/);
  });

  it("🔴 o teste renomeado no C2X continua fora do catálogo", async () => {
    estado.enterprises = estado.enterprises.map((e) => (e.id === 34 ? { ...e, code: "TSX" } : e));
    const catalogo = await catalogoDeEmpreendimentos(1_000);
    const ids = catalogo.flatMap((emp) => emp.stageIds);
    expect(ids).not.toContain("34");
    expect(ids).not.toContain("31");
    expect(ids).not.toContain("2");
  });

  it("o resto sai como sempre saiu: o 30 (ACT) entra, e o Lagoa Bonita vira um grupo só", async () => {
    const catalogo = await catalogoDeEmpreendimentos(1_000);
    expect(catalogo.find((emp) => emp.id === "30")?.codes).toEqual(["ACT"]);
    const lagoa = catalogo.find((emp) => emp.id === "group:Lagoa Bonita");
    expect(lagoa?.codes).toEqual(["LBF", "LBR", "LBP"]);
    expect(lagoa?.stageIds).toEqual(["33", "27", "32"]);
    // 37 no C2X, menos os 3 excluídos: 34 siglas no catálogo (medido em 25/09/2026).
    expect(catalogo.flatMap((emp) => emp.codes)).toHaveLength(34);
  });
});
