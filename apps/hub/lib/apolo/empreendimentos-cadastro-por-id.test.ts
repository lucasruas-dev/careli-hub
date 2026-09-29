import { beforeEach, describe, expect, it, vi } from "vitest";

// O CADASTRO DO EMPREENDIMENTO NO C2X PELO ID (Lucas, 24/09/2026).
//
// A busca por sigla (`e.code in (...)`) voltou vazia quando a Nivea renomeou o 43 no C2X de RDV para
// PDI: medido, `loadApoloEnterpriseCadastro(['RDV'])` devolvia 0 cadastros. Estes testes travam que a
// busca nova pergunta ao legado pelo `enterprises.id`, que não muda num renome.

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ params: unknown[]; sql: string }>,
  linhas: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: vi.fn(() => ({
    ok: true,
    pool: {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        estado.chamadas.push({ params, sql });
        return [estado.linhas];
      }),
    },
  })),
  sanitizeHadesDbError: (erro: unknown) => String(erro),
}));

import { loadApoloEnterpriseCadastroPorId } from "./empreendimentos";

beforeEach(() => {
  estado.chamadas = [];
  estado.linhas = [];
});

describe("loadApoloEnterpriseCadastroPorId", () => {
  it("⚠️ pergunta ao C2X pelo id, nunca pela sigla, e devolve o id em cada ficha", async () => {
    estado.linhas = [
      {
        code: "PDI",
        enterprise_id: 43,
        gerente: "LUNA NEGOCIOS IMOBILIARIOS",
        gerente_phone: "(31) 99596-0000",
        gerente_user_id: 1628,
        name: "PORTAL DO IBITURUNA",
      },
    ];

    const r = await loadApoloEnterpriseCadastroPorId(["43"]);

    expect(estado.chamadas).toHaveLength(1);
    expect(estado.chamadas[0]?.sql).toContain("e.id in (?)");
    expect(estado.chamadas[0]?.sql).not.toContain("e.code in");
    expect(estado.chamadas[0]?.params).toEqual([43]);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cadastros[0]?.enterpriseId).toBe("43");
    expect(r.cadastros[0]?.code).toBe("PDI");
    expect(r.cadastros[0]?.players).toEqual([
      expect.objectContaining({
        name: "LUNA NEGOCIOS IMOBILIARIOS",
        phone: "(31) 99596-0000",
        relation: "coordenador_vendas",
      }),
    ]);
  });

  it("id que não é do C2X (grupo, uuid, vazio) fica de fora, e sem id nenhum não há consulta", async () => {
    const r = await loadApoloEnterpriseCadastroPorId(["group:Lagoa Bonita", "  ", "3a2696a7-144e-4b17"]);
    expect(r).toEqual({ cadastros: [], ok: true });
    expect(estado.chamadas).toHaveLength(0);
  });

  it("repetido vai uma vez só", async () => {
    await loadApoloEnterpriseCadastroPorId(["33", " 33", "27"]);
    expect(estado.chamadas[0]?.params).toEqual([33, 27]);
  });
});
