import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  C2X_DEPOIS_DO_RENOME,
  empreendimentosDoWhere,
  filtraPelaSigla,
} from "./c2x-pelo-id.where-falso";

// A CARTEIRA DO EMPREENDIMENTO PELO ID DO C2X (PAN-124).
//
// O que trava: a sigla não vai mais ao C2X como filtro. Em 24/09/2026 a Nívea renomeou o 43 de RDV
// para PDI; o catálogo guarda a sigla por 10 minutos e o portal do incorporador pede a carteira pelo
// catálogo. Com `e.code in (...)`, quem pedisse "RDV" nesses minutos recebia a carteira VAZIA, sem
// erro. Pelo id, o 43 continua sendo o 43.
//
// ⚠️ O LIMITE: a tradução só salva a sigla de ANTES do renome enquanto o catálogo em cache for de
// antes dele. Relido o catálogo, RDV não acha mais nada (c2x-pelo-id-servidor.test.ts, "O LIMITE");
// só quem pede pelo id (`loadApoloEnterpriseCarteiraPorIds`) atravessa qualquer renome. A mesma coisa na exclusão: a lista por sigla não segura um renome
// do empreendimento de teste (o "LAG" já não casa com nada desde 16/07/2026).

const m = vi.hoisted(() => ({
  pool: { ok: true as boolean, query: vi.fn() },
  traduzir: vi.fn(),
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () =>
    m.pool.ok ? { ok: true, pool: { query: m.pool.query } } : { missing: ["C2X_DB_HOST"], ok: false },
}));

vi.mock("@/lib/apolo/c2x-pelo-id-servidor", () => ({
  idsDoC2xDasSiglasAoVivo: m.traduzir,
}));

vi.mock("@/lib/apolo/server", () => ({
  deterministicUuid: (texto: string) => `uuid:${texto}`,
}));

import {
  loadApoloCarteiraScoped,
  loadApoloEnterpriseCarteira,
  loadApoloEnterpriseCarteiraPorIds,
} from "./carteira";

// O C2X de mentira responde às três consultas da carteira (totais, críticos, unidades) com uma
// unidade de R$ 1.000 por empreendimento que passa no WHERE recebido.
function c2xFalso() {
  m.pool.query.mockImplementation(async (sql: string, params: unknown[]) => {
    const passam = empreendimentosDoWhere(sql, params);
    if (sql.includes("as total_portfolio")) {
      return [[{ clients: passam.length, contracts: passam.length, total_portfolio: 1000 * passam.length }]];
    }
    if (sql.includes("as critical")) return [[{ critical: 0 }]];
    if (sql.includes("as unit_id")) {
      return [
        passam.map((emp) => ({
          ar_id: emp.id * 100,
          block: "A",
          enterprise_code: emp.code,
          enterprise_name: emp.name,
          lot: "1",
          total_contract: 1000,
          unit_id: emp.id * 10,
        })),
      ];
    }
    return [[]];
  });
}

beforeEach(() => {
  m.pool.ok = true;
  m.pool.query.mockReset();
  m.traduzir.mockReset();
  c2xFalso();
});

describe("loadApoloEnterpriseCarteira (pelas siglas da tela e do portal)", () => {
  it("🔴 filtra pelo id: todo SQL tem `e.id in` e nenhum filtra pela sigla", async () => {
    m.traduzir.mockResolvedValue({ ids: [36, 37], ok: true, semId: [] });

    const r = await loadApoloEnterpriseCarteira(["VOC", "VOL"]);

    expect(m.traduzir).toHaveBeenCalledWith(["VOC", "VOL"], {});
    expect(m.pool.query).toHaveBeenCalledTimes(3);
    for (const [sql, params] of m.pool.query.mock.calls) {
      expect(sql).toContain("where e.id in (?, ?)");
      expect(filtraPelaSigla(sql)).toBe(false);
      expect(params).toEqual([36, 37]);
    }
    expect(r.ok && r.data.units.map((u) => u.enterpriseCode)).toEqual(["VOL", "VOC"]);
  });

  it("a tela do Apolo manda `conferirNoC2x`, e ele chega à tradução", async () => {
    m.traduzir.mockResolvedValue({ ids: [37], ok: true, semId: [] });
    await loadApoloEnterpriseCarteira(["VOC"], { conferirNoC2x: true });
    expect(m.traduzir).toHaveBeenCalledWith(["VOC"], { conferirNoC2x: true });
  });

  it("🔴 renome DENTRO da janela do catálogo: enquanto o cache ainda traduz RDV -> 43, acha a carteira do 43, que o C2X já chama de PDI", async () => {
    m.traduzir.mockResolvedValue({ ids: [43], ok: true, semId: [] });

    const r = await loadApoloEnterpriseCarteira(["RDV"]);

    // Pela sigla, `e.code in ('RDV')` não acharia nada: o C2X só conhece PDI.
    expect(r.ok).toBe(true);
    expect(r.ok && r.data.units).toHaveLength(1);
    expect(r.ok && r.data.units[0]).toMatchObject({ code: "PDIA1", enterpriseCode: "PDI" });
    expect(r.ok && r.data.summary.totalPortfolio).toBe(1000);
  });

  it("o SELECT continua devolvendo a sigla viva (enterpriseCode) e o ORDER BY é o de sempre", async () => {
    m.traduzir.mockResolvedValue({ ids: [37], ok: true, semId: [] });

    await loadApoloEnterpriseCarteira(["VOC"]);

    const unidades = m.pool.query.mock.calls.find(([sql]) => String(sql).includes("as unit_id"));
    expect(unidades?.[0]).toContain("e.code as enterprise_code");
    expect(unidades?.[0]).toContain("order by overdue_amount desc, eu.block, eu.lot");
  });

  it("🔴 catálogo fora (C2X fora) é erro, e não carteira zerada", async () => {
    m.traduzir.mockResolvedValue({ erro: "Catálogo indisponível.", ok: false });

    const r = await loadApoloEnterpriseCarteira(["VOC"]);

    expect(r).toEqual({ error: "Catálogo indisponível.", ok: false });
    expect(m.pool.query).not.toHaveBeenCalled();
  });

  it("sigla sem id (excluída, desconhecida ou nascida no Panteon) devolve o vazio de sempre, sem ir ao C2X", async () => {
    m.traduzir.mockResolvedValue({ ids: [], ok: true, semId: ["TSC"] });

    const r = await loadApoloEnterpriseCarteira(["TSC"]);

    expect(r.ok && r.data.units).toEqual([]);
    expect(r.ok && r.data.summary.totalPortfolio).toBe(0);
    expect(m.pool.query).not.toHaveBeenCalled();
  });

  it("sem configuração do C2X devolve o erro de sempre, sem traduzir", async () => {
    m.pool.ok = false;

    const r = await loadApoloEnterpriseCarteira(["VOC"]);

    expect(r).toEqual({ error: "Configuracao C2X ausente: C2X_DB_HOST.", ok: false });
    expect(m.traduzir).not.toHaveBeenCalled();
  });
});

describe("loadApoloEnterpriseCarteiraPorIds", () => {
  it("🔴 o empreendimento de teste nunca entra, mesmo pedido pelo id", async () => {
    const r = await loadApoloEnterpriseCarteiraPorIds([34, 37, 37]);

    for (const [, params] of m.pool.query.mock.calls) expect(params).toEqual([37]);
    expect(r.ok && r.data.units.map((u) => u.enterpriseCode)).toEqual(["VOC"]);
  });

  it("só excluídos (ou nada) não vai ao C2X", async () => {
    const r = await loadApoloEnterpriseCarteiraPorIds([2, 31, 34]);

    expect(r.ok && r.data.units).toEqual([]);
    expect(m.pool.query).not.toHaveBeenCalled();
  });
});

describe("loadApoloCarteiraScoped (carteira por papel)", () => {
  it("🔴 a exclusão é pelo id: o teste renomeado (TSC -> TSX) continua fora", async () => {
    const r = await loadApoloCarteiraScoped({ c2xId: 500, kind: "incorporador" });

    for (const [sql, params] of m.pool.query.mock.calls) {
      expect(sql).toContain("e.incorporador_id = ? and e.id not in (?, ?, ?)");
      expect(filtraPelaSigla(sql)).toBe(false);
      expect(params).toEqual([500, 2, 31, 34]);
    }
    // Pela sigla, `e.code not in ('TSC', 'SDT', 'LAB', 'LAG')` deixaria o TSX entrar.
    const codigos = r.ok ? r.data.units.map((u) => u.enterpriseCode) : [];
    expect(codigos).not.toContain("TSX");
    expect(codigos).toEqual(
      C2X_DEPOIS_DO_RENOME.filter((e) => ![2, 31, 34].includes(e.id)).map((e) => e.code),
    );
  });
});
