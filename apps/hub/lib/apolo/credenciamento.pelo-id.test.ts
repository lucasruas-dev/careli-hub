import { beforeEach, describe, expect, it, vi } from "vitest";

// ONDE A IMOBILIÁRIA JÁ VENDEU: A EXCLUSÃO É PELO ID (PAN-124).
//
// `consultarImobiliariaPorCnpj` pergunta ao C2X em quais empreendimentos a imobiliária já vendeu, sem
// os de teste e o masterplan. A exclusão era por sigla (`e.code not in`), e a sigla muda num renome
// no legado: foi assim que o 30 deixou de ser excluído quando o LAG virou ADT (16/07/2026).
//
// ⚠️ O C2X FALSO RESPONDE COMO O MYSQL: `e.code not in` compara sigla, `e.id not in` compara id.

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ params: unknown[]; sql: string }>,
  /** Os empreendimentos em que a imobiliária 1234 tem venda, com a sigla de agora. */
  vendeuEm: [] as Array<{ code: string; id: number }>,
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: vi.fn(() => ({
    ok: true,
    pool: {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        estado.chamadas.push({ params, sql });
        const [, coluna] = /e\.(code|id) not in/.exec(sql) ?? [];
        const fora = params.slice(1);
        return [
          estado.vendeuEm
            .filter((e) => !coluna || !fora.includes(coluna === "id" ? e.id : e.code))
            .map((e) => ({ id: e.id })),
        ];
      }),
    },
  })),
}));

import { consultarImobiliariaPorCnpj } from "./credenciamento";

/** O Supabase falso: só as quatro leituras que a consulta pelo CNPJ faz. */
function clienteFalso() {
  const respostas: Record<string, unknown> = {
    apolo_entities: { data: { display_name: "IMOB", id: "ent-1", legal_name: "IMOB LTDA" }, error: null },
    apolo_entity_identifiers: { data: { entity_id: "ent-1" }, error: null },
    apolo_relationships: { data: [], error: null },
    apolo_source_links: { data: [{ source_id: "1234", source_table: "users" }], error: null },
  };
  return {
    from(tabela: string) {
      const resposta = respostas[tabela] ?? { data: null, error: null };
      const cadeia: Record<string, unknown> = {
        eq: () => cadeia,
        limit: () => cadeia,
        maybeSingle: async () => resposta,
        select: () => cadeia,
        then: (ok: (valor: unknown) => unknown) => Promise.resolve(resposta).then(ok),
      };
      return cadeia;
    },
  };
}

beforeEach(() => {
  estado.chamadas = [];
  estado.vendeuEm = [
    { code: "PDI", id: 43 },
    { code: "TSC", id: 34 },
    { code: "ACT", id: 30 },
  ];
});

describe("consultarImobiliariaPorCnpj: onde já vendeu, sem os excluídos pelo id", () => {
  it("🔴 a consulta ao C2X exclui `e.id not in (2, 31, 34)`, e não compara sigla", async () => {
    const r = await consultarImobiliariaPorCnpj(
      clienteFalso() as never,
      "12.345.678/0001-90",
    );
    expect(estado.chamadas).toHaveLength(1);
    expect(estado.chamadas[0]?.sql).toContain("e.id not in (?, ?, ?)");
    expect(estado.chamadas[0]?.sql).not.toMatch(/e\.code (not )?in/);
    expect(estado.chamadas[0]?.params).toEqual([1234, 2, 31, 34]);
    expect(r.jaTrabalha.sort()).toEqual(["30", "43"]);
  });

  it("🔴 o teste renomeado no C2X continua fora do `jaTrabalha`", async () => {
    estado.vendeuEm = estado.vendeuEm.map((e) => (e.id === 34 ? { ...e, code: "TSX" } : e));
    const r = await consultarImobiliariaPorCnpj(clienteFalso() as never, "12345678000190");
    expect(r.jaTrabalha).not.toContain("34");
  });
});
