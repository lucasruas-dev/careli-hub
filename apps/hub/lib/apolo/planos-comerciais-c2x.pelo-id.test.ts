import { beforeEach, describe, expect, it, vi } from "vitest";

// OS PLANOS DO C2X PELO ID DO EMPREENDIMENTO (PAN-124).
//
// Os três blocos do `union` filtravam por `e.code in (...)`. Com a sigla guardada (a do evento do
// Prometeu), um renome no legado fazia a PA sair com os planos padrão da casa e o aviso de "sem plano
// cadastrado", sobre um empreendimento que tem plano. Estes testes travam que o C2X recebe o id.
//
// ⚠️ O C2X FALSO RESPONDE PELO ID: devolve os planos do empreendimento cujo id veio nos parâmetros.

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

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: vi.fn(() => ({
    ok: true,
    pool: {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        estado.chamadas.push({ params, sql });
        if (!params.includes(40)) return [[]];
        // O JARDIM DAS GERAIS (40): o NORMAL corrigido pela poupança, 120 parcelas.
        return [
          [
            {
              code: estado.renomes.get("JDG") ?? "JDG",
              contractual_interest: "0.5",
              enterprise_id: 40,
              indice: "POUPANÇA",
              initial_input_value: "10",
              parcels: 120,
              plano: "PLANO NORMAL",
              slot: "normal",
              tabela: "SACOOC",
            },
          ],
        ];
      }),
    },
  })),
}));

import { lerPlanosDoC2x, lerPlanosDoC2xPorIds } from "./planos-comerciais-c2x";

beforeEach(() => {
  estado.catalogoFora = false;
  estado.chamadas = [];
  estado.renomes = new Map();
});

describe("lerPlanosDoC2x: a sigla vira id antes de ir ao C2X", () => {
  it("🔴 os TRÊS blocos do union filtram por `e.id in`, nenhum por `e.code in`", async () => {
    await lerPlanosDoC2x(["JDG"]);
    expect(estado.chamadas).toHaveLength(1);
    const { params, sql } = estado.chamadas[0]!;
    expect(sql.match(/e\.id in \(\?\)/g)).toHaveLength(3);
    expect(sql).not.toMatch(/e\.code in/);
    expect(params).toEqual([40, 40, 40]);
  });

  it("🔴 renome (JDG → JDX) não muda os planos: o id é o mesmo", async () => {
    const antes = await lerPlanosDoC2x(["JDG"]);
    estado.renomes.set("JDG", "JDX");
    const depois = await lerPlanosDoC2x(["JDX"]);
    if (!antes.ok || !depois.ok) throw new Error("leitura falhou");
    expect(antes.empreendimentos[0]?.planos).toHaveLength(1);
    expect(depois.empreendimentos[0]?.planos).toEqual(antes.empreendimentos[0]?.planos);
    // O `code` da resposta é a sigla que o C2X devolve na linha: a de agora.
    expect(depois.empreendimentos[0]?.code).toBe("JDX");
  });

  it("🔴 catálogo ilegível é FALHA (a PA avisa que não leu), e não \"sem plano\"", async () => {
    estado.catalogoFora = true;
    const r = await lerPlanosDoC2x(["JDG"]);
    expect(r).toEqual({ error: "Catálogo indisponível.", ok: false });
    expect(estado.chamadas).toHaveLength(0);
  });

  it("sigla que o C2X não conhece: vazio com `ok: true`, sem consulta", async () => {
    expect(await lerPlanosDoC2x(["CEC"])).toEqual({ empreendimentos: [], ok: true });
    expect(estado.chamadas).toHaveLength(0);
  });
});

describe("lerPlanosDoC2xPorIds", () => {
  it("pergunta pelo id que recebeu, texto ou número", async () => {
    const r = await lerPlanosDoC2xPorIds(["40"]);
    expect(estado.chamadas[0]?.params).toEqual([40, 40, 40]);
    if (!r.ok) throw new Error(r.error);
    expect(r.empreendimentos[0]?.enterpriseId).toBe("40");
  });

  it("⚠️ não exclui ninguém, como a busca pela sigla nunca excluiu (o 34 vai ao C2X)", async () => {
    await lerPlanosDoC2xPorIds([34]);
    expect(estado.chamadas[0]?.params).toEqual([34, 34, 34]);
  });

  it("id do Panteon (>= 100000), `group:` e uuid não vão ao C2X", async () => {
    const r = await lerPlanosDoC2xPorIds(["100004", "group:Vale do Ouro", "3a2696a7-144e-4b17"]);
    expect(r).toEqual({ empreendimentos: [], ok: true });
    expect(estado.chamadas).toHaveLength(0);
  });
});
