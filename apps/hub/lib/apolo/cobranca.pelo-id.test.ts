import { beforeEach, describe, expect, it, vi } from "vitest";

import { empreendimentosDoWhere, filtraPelaSigla } from "./c2x-pelo-id.where-falso";

// A COBRANÇA DO EMPREENDIMENTO PELO ID DO C2X (PAN-124).
//
// O mapa unidade <-> pedido <-> cliente é o que liga o compromisso do Hades à unidade da carteira. Ia
// ao C2X por `e.code in (...)`; um renome (o 43, de RDV para PDI, em 24/09/2026) deixava o mapa vazio
// e a aba mostrava "nenhuma negociação" para um empreendimento com acordo ativo. Agora vai pelo id.

const m = vi.hoisted(() => ({
  compromissos: [] as Array<Record<string, unknown>>,
  motorOk: true,
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

// O motor do Hades (Supabase) de mentira: `from().select().in().limit().returns()`.
vi.mock("@/lib/guardian/compromissos", () => ({
  createGuardianMotorClient: () => {
    if (!m.motorOk) return null;
    return {
      from: (tabela: string) => {
        const cadeia = {
          in: () => cadeia,
          limit: () => cadeia,
          returns: async () => ({
            data: tabela === "guardian_compromissos" ? m.compromissos : [],
            error: null,
          }),
          select: () => cadeia,
        };
        return cadeia;
      },
    };
  },
  listGuardianCompromissosByClient: vi.fn(),
}));

import { loadApoloEnterpriseCobranca, loadApoloEnterpriseCobrancaPorIds } from "./cobranca";

beforeEach(() => {
  m.pool.ok = true;
  m.motorOk = true;
  m.compromissos = [];
  m.pool.query.mockReset();
  m.traduzir.mockReset();
  // Uma unidade por empreendimento que passa no WHERE: unidade = id*10, pedido = id*100, cliente = id*1000.
  m.pool.query.mockImplementation(async (sql: string, params: unknown[]) => [
    empreendimentosDoWhere(sql, params).map((emp) => ({
      ar_id: emp.id * 100,
      client_id: emp.id * 1000,
      unit_id: emp.id * 10,
    })),
  ]);
});

const acordoDoPedido = (arId: number, clientId: number) => ({
  acquisition_request_c2x_id: arId,
  approval_status: "aprovado",
  broken_at: null,
  client_c2x_id: clientId,
  first_due_date: "2026-10-10",
  id: `c-${arId}`,
  kind: "acordo",
  promised_date: null,
  protocol: `AC-${arId}`,
  status: "ativo",
  total_amount: "1500",
});

describe("loadApoloEnterpriseCobranca (pelas siglas da tela)", () => {
  it("🔴 o mapa unidade <-> pedido vai pelo id, e nunca pela sigla", async () => {
    m.traduzir.mockResolvedValue({ ids: [36, 37], ok: true, semId: [] });

    await loadApoloEnterpriseCobranca(["VOC", "VOL"]);

    expect(m.traduzir).toHaveBeenCalledWith(["VOC", "VOL"], {});
    const [sql, params] = m.pool.query.mock.calls[0] ?? [];
    expect(sql).toContain("where e.id in (?, ?)");
    expect(filtraPelaSigla(String(sql))).toBe(false);
    expect(params).toEqual([36, 37]);
  });

  // ⚠️ SÓ DENTRO DA JANELA DO CATÁLOGO: a tradução (trocada aqui) ainda diz RDV -> 43 porque o
  // catálogo em cache é de antes do renome. Relido, RDV não acha nada (c2x-pelo-id-servidor.test.ts,
  // "O LIMITE"); só a versão por id atravessa qualquer renome.
  it("🔴 renome, com o catálogo em cache ainda de antes dele: o acordo do 43 continua na unidade dele depois de RDV virar PDI", async () => {
    m.traduzir.mockResolvedValue({ ids: [43], ok: true, semId: [] });
    m.compromissos = [acordoDoPedido(4300, 43000)];

    const r = await loadApoloEnterpriseCobranca(["RDV"]);

    // Pela sigla, `e.code in ('RDV')` não acharia a unidade 430 e o selo sumiria.
    expect(r.ok && r.data.byUnitId["430"]).toMatchObject({ protocol: "AC-4300", stage: "acordo" });
    expect(r.ok && r.data.funnel.acordosAtivos).toEqual({ count: 1, value: 1500 });
  });

  it("🔴 catálogo fora (C2X fora) é erro, e não funil zerado", async () => {
    m.traduzir.mockResolvedValue({ erro: "Catálogo indisponível.", ok: false });

    const r = await loadApoloEnterpriseCobranca(["VOC"]);

    expect(r).toEqual({ error: "Catálogo indisponível.", ok: false });
    expect(m.pool.query).not.toHaveBeenCalled();
  });

  it("sigla sem id devolve o vazio de sempre, sem ir ao C2X", async () => {
    m.traduzir.mockResolvedValue({ ids: [], ok: true, semId: ["XYZ"] });

    const r = await loadApoloEnterpriseCobranca(["XYZ"]);

    expect(r.ok && r.data.byUnitId).toEqual({});
    expect(m.pool.query).not.toHaveBeenCalled();
  });

  it("sem motor ou sem C2X devolve vazio, como sempre (a cobrança não derruba a carteira)", async () => {
    m.motorOk = false;

    const r = await loadApoloEnterpriseCobranca(["VOC"]);

    expect(r.ok && r.data.byUnitId).toEqual({});
    expect(m.traduzir).not.toHaveBeenCalled();
  });
});

describe("loadApoloEnterpriseCobrancaPorIds", () => {
  it("🔴 o empreendimento de teste nunca entra, mesmo pedido pelo id", async () => {
    await loadApoloEnterpriseCobrancaPorIds([34, 37]);

    expect(m.pool.query.mock.calls[0]?.[1]).toEqual([37]);
  });

  it("só excluídos não vai ao C2X", async () => {
    await loadApoloEnterpriseCobrancaPorIds([34]);

    expect(m.pool.query).not.toHaveBeenCalled();
  });
});
