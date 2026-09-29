import { beforeEach, describe, expect, it, vi } from "vitest";

import { empreendimentosDoWhere, filtraPelaSigla } from "./c2x-pelo-id.where-falso";

// O EXTRATO DO CLIENTE COMPRADOR: A EXCLUSÃO PELO ID DO C2X (PAN-124).
//
// O extrato vai para a mão do cliente. O empreendimento de teste (34, TESTE SPLIT CARELI) não pode
// aparecer nele, e a lista por sigla não segura um renome: o "LAG" dela já não casa com nada desde
// 16/07/2026. Aqui o 34 aparece renomeado para TSX, e tem de continuar fora.

const m = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ ok: true, pool: { query: m.query } }),
}));

import { loadExtratoDoCliente } from "./extrato-cliente-c2x";

beforeEach(() => {
  m.query.mockReset();
  m.query.mockImplementation(async (sql: string, params: unknown[]) => {
    // Os contratos: um por empreendimento que passa no WHERE (pedido = id*100).
    if (sql.includes("from acquisition_requests ar")) {
      return [
        empreendimentosDoWhere(sql, params).map((emp) => ({
          client_1: 900,
          enterprise_code: emp.code,
          enterprise_name: emp.name,
          id: emp.id * 100,
          stage_id: 4,
        })),
      ];
    }
    // As parcelas e as pessoas: vazias. O que se confere é QUEM chegou até aqui.
    return [[]];
  });
});

describe("loadExtratoDoCliente", () => {
  it("🔴 a exclusão é pelo id, e o teste renomeado (TSC -> TSX) não chega às parcelas", async () => {
    await loadExtratoDoCliente({ c2xId: 900, hoje: "2026-09-25" });

    const [sql, params] = m.query.mock.calls[0] ?? [];
    expect(sql).toContain("and e.id not in (?, ?, ?)");
    expect(filtraPelaSigla(String(sql))).toBe(false);
    expect(params).toEqual([900, 2, 31, 34]);
    // O ORDER BY continua pela sigla (é ordem de leitura, não filtro).
    expect(sql).toContain("order by e.code, eu.name");

    // Pela sigla, `e.code not in ('TSC', 'SDT', 'LAB', 'LAG')` deixaria o pedido 3400 (TSX) passar.
    const parcelas = m.query.mock.calls.find(([s]) =>
      String(s).includes("where p.acquisition_request_id in"),
    );
    expect(parcelas?.[1]).toEqual([3600, 3700, 4300]);
  });
});
