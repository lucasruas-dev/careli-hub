import { beforeEach, describe, expect, it, vi } from "vitest";

// A FILA DE COBRANÇA DO HADES: A EXCLUSÃO PELO ID DO C2X (PAN-124).
//
// Teste na fila de produção já aconteceu (27/06: SDT e TSC apareceram para quem atende, 9 parcelas
// vencidas de R$ 385,00). A lista que impedia isso comparava SIGLA, e sigla muda: o "LAG" dela não
// casa com nada desde que o 30 foi renomeado em 16/07/2026. Agora compara o id, que não muda.

const m = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ ok: true, pool: { query: m.query } }),
  sanitizeHadesDbError: (erro: unknown) => erro,
  withHadesDbRetry: (fn: () => unknown) => fn(),
}));

import { loadHadesAttendanceQueueSummary } from "./attendance";

beforeEach(() => {
  m.query.mockReset();
  m.query.mockResolvedValue([[]]);
});

describe("loadHadesAttendanceQueueSummary", () => {
  it("🔴 tira o teste da fila pelo id (2, 31, 34), e não pela sigla", async () => {
    await loadHadesAttendanceQueueSummary({ strict: true });

    const sql = String(m.query.mock.calls[0]?.[0] ?? "");
    expect(sql).toContain("e.id is not null");
    expect(sql).toContain("e.id not in (2, 31, 34)");
    // A lista antiga ia escrita no SQL: `upper(trim(coalesce(e.code, ''))) not in ('TSC', ...)`.
    expect(sql).not.toMatch(/e\.code, ''\)\)\)\s+not in/);
    expect(sql).not.toContain("'TSC'");
    expect(sql).not.toContain("'LAG'");
  });
});
