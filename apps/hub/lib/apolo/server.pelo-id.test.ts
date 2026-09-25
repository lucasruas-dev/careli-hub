import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { empreendimentosDoWhere } from "./c2x-pelo-id.where-falso";

// O GRAFO E A CARTEIRA DOS COMPRADORES NO SERVIDOR DO APOLO: A EXCLUSÃO PELO ID DO C2X (PAN-124).
//
// Duas leituras de lib/apolo/server.ts tiravam o teste e o masterplan pela SIGLA: o grafo da
// imobiliária ("empreendimentos onde ela vendeu") e a carteira dos compradores que alimenta os cards e
// o filtro de comprador. Sigla muda quando alguém renomeia no C2X (o "LAG" da lista não casa com nada
// desde 16/07/2026); o id, não.

const m = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ ok: true, pool: { query: m.query } }),
  sanitizeHadesDbError: (erro: unknown) => erro,
}));

import { fetchC2xCadastroByEntity } from "./server";

// Supabase de mentira: toda cadeia (`from().select().in()...`) termina em lista vazia.
function supabaseVazio() {
  const cadeia: Record<string, unknown> = {};
  for (const metodo of ["eq", "in", "is", "limit", "not", "order", "returns", "select"]) {
    cadeia[metodo] = () => cadeia;
  }
  cadeia.then = (resolver: (valor: unknown) => unknown) => resolver({ data: [], error: null });
  return { from: () => cadeia } as never;
}

beforeEach(() => {
  m.query.mockReset();
  m.query.mockImplementation(async (sql: string, params: unknown[]) => {
    // A imobiliária 700 vendeu em todo empreendimento que passa no WHERE.
    if (sql.includes("as ent_name")) {
      return [empreendimentosDoWhere(sql, params).map((emp) => ({ ent_name: emp.name, imob_id: 700 }))];
    }
    return [[]];
  });
});

describe("fetchC2xCadastroByEntity: grafo da imobiliária", () => {
  it("🔴 o teste renomeado (TSC -> TSX) continua fora dos empreendimentos onde ela vendeu", async () => {
    const { relationships } = await fetchC2xCadastroByEntity(
      supabaseVazio(),
      [{ entity_id: "ent-imob", source_id: "700", source_system: "c2x", source_table: "users" }] as never,
      new Set(),
      new Set(),
    );

    const consulta = m.query.mock.calls.find(([sql]) => String(sql).includes("as ent_name"));
    expect(consulta?.[0]).toContain("and e.id not in (?, ?, ?)");
    expect(consulta?.[1]).toEqual(["700", 2, 31, 34]);

    // Pela sigla, `e.code not in ('TSC', 'SDT', 'LAB', 'LAG')` deixaria o TESTE SPLIT CARELI entrar.
    const empreendimentos = (relationships.get("ent-imob") ?? [])
      .filter((rel) => rel.relation === "Empreendimento")
      .map((rel) => rel.label);
    expect(empreendimentos).toEqual([
      "VALE DO OURO - LOTES",
      "VALE DO OURO - CHACARAS",
      "PORTAL DO IBITURUNA",
    ]);
  });
});

// ⚠️ A CARTEIRA DOS COMPRADORES (`loadC2xCarteiraData`) é interna e só é alcançada pelo painel inteiro
// do Apolo. A trava é no fonte: nenhuma leitura deste arquivo volta a excluir pela sigla.
describe("lib/apolo/server.ts não exclui mais pela sigla", () => {
  it("🔴 sem `e.code not in` e sem a lista por sigla", () => {
    const fonte = readFileSync(join(__dirname, "server.ts"), "utf8");
    expect(fonte).not.toMatch(/e\.code\s+not\s+in/);
    expect(fonte).not.toContain("EXCLUDED_ENTERPRISE_CODES");
    // As duas leituras usam a régua pura (e não a casca do servidor, que fecharia um ciclo de import).
    expect(fonte.match(/filtroSemExcluidos\(\)/g)).toHaveLength(2);
    expect(fonte).not.toContain("c2x-pelo-id-servidor");
  });
});
