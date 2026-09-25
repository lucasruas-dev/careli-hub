import { beforeEach, describe, expect, it, vi } from "vitest";

// O PAINEL DO HADES: A EXCLUSÃO PELO ID DO C2X (PAN-124).
//
// Decisão do Lucas (25/08): o dashboard segue o universo da fila, menos o que é teste. A lista de
// teste comparava SIGLA, e sigla muda quando alguém renomeia no C2X (o "LAG" dela não casa com nada
// desde 16/07/2026). Agora compara o id, em todas as leituras do painel.

const m = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ ok: true, pool: { query: m.query } }),
}));

import { loadHadesEnterpriseDistributions } from "./overview";

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue([[]]);
});

describe("loadHadesEnterpriseDistributions", () => {
  it("🔴 toda leitura do painel tira o teste pelo id (2, 31, 34), e não pela sigla", async () => {
    await loadHadesEnterpriseDistributions("Vale do Ouro");

    expect(m.query).toHaveBeenCalledTimes(4);
    for (const [sql] of m.query.mock.calls) {
      expect(sql).toContain("e.id not in (2, 31, 34)");
      expect(sql).not.toMatch(/e\.code, ''\)\)\)\s+not in/);
      expect(sql).not.toContain("'TSC'");
    }
  });
});
