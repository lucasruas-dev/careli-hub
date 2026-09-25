import { beforeEach, describe, expect, it, vi } from "vitest";

import { empreendimentosDoWhere, filtraPelaSigla } from "./c2x-pelo-id.where-falso";

// O EXTRATO POR PARTICIPANTE PELO ID DO C2X (PAN-124).
//
// Duas travas: a exclusão (teste e masterplan) vai pelo id, e o filtro do empreendimento que a tela
// manda (`?enterprise=`, a SIGLA que veio nas próprias linhas do extrato) vira o id antes de ir ao C2X.
// Com `e.code = ?`, a tela aberta antes do renome do 43 (RDV -> PDI, 24/09/2026) filtrava por RDV e o
// extrato voltava vazio.

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

import { loadApoloParticipantStatement } from "./extrato";

const ESCOPO = { c2xId: 900, end: "2026-09-30", start: "2026-09-01" };

beforeEach(() => {
  m.pool.ok = true;
  m.pool.query.mockReset();
  m.traduzir.mockReset();
  // Um pagamento pago por empreendimento que passa no WHERE.
  m.pool.query.mockImplementation(async (sql: string, params: unknown[]) => [
    empreendimentosDoWhere(sql, params).map((emp) => ({
      enterprise_code: emp.code,
      enterprise_name: emp.name,
      gross_value: 100,
      parcel_type: "Parcela",
      payment_date: "2026-09-10",
      payment_id: emp.id,
      profile_name: "Imobiliária",
      split_data: null,
      split_group_value_id: 1,
      unit_block: "A",
      unit_lot: "1",
    })),
  ]);
});

describe("loadApoloParticipantStatement", () => {
  it("🔴 a exclusão é pelo id: o teste renomeado (TSC -> TSX) continua fora", async () => {
    const r = await loadApoloParticipantStatement(ESCOPO);

    const [sql, params] = m.pool.query.mock.calls[0] ?? [];
    expect(sql).toContain("and e.id not in (?, ?, ?)");
    expect(filtraPelaSigla(String(sql))).toBe(false);
    expect(params).toEqual(["2026-09-01", "2026-09-30", 2, 31, 34, 900, 900]);
    expect(m.traduzir).not.toHaveBeenCalled();
    // Pela sigla, `e.code not in ('TSC', 'SDT', 'LAB', 'LAG')` deixaria o TSX entrar no extrato.
    expect(r.ok && r.data.enterprises.map((e) => e.code)).toEqual(["PDI", "VOC", "VOL"]);
  });

  it("🔴 o empreendimento escolhido na tela vira id: `e.id in`, e nunca `e.code = ?`", async () => {
    m.traduzir.mockResolvedValue({ ids: [37], ok: true, semId: [] });

    const r = await loadApoloParticipantStatement({ ...ESCOPO, enterpriseCode: "VOC" });

    // A sigla veio das linhas que a tela leu ao vivo: é conferida no C2X no mesmo instante.
    expect(m.traduzir).toHaveBeenCalledWith(["VOC"], { conferirNoC2x: true });
    const [sql, params] = m.pool.query.mock.calls[0] ?? [];
    expect(sql).toContain("and e.id in (?)");
    expect(filtraPelaSigla(String(sql))).toBe(false);
    expect(params).toEqual(["2026-09-01", "2026-09-30", 2, 31, 34, 900, 900, 37]);
    expect(r.ok && r.data.rows.map((row) => row.enterpriseCode)).toEqual(["VOC"]);
    // O SELECT e o ORDER BY não mudaram: a linha continua dizendo a sigla viva.
    expect(sql).toContain("e.code as enterprise_code");
    expect(sql).toContain("order by p.payment_date desc, e.code, p.id");
  });

  // ⚠️ SÓ ENQUANTO O CATÁLOGO EM CACHE FOR DE ANTES DO RENOME (a tradução, trocada aqui, diz RDV ->
  // 43). O C2X de agora não conhece RDV; relido o catálogo, RDV volta vazio (ver "O LIMITE" em
  // c2x-pelo-id-servidor.test.ts).
  it("🔴 renome, com o catálogo em cache ainda de antes dele: a tela que filtra por RDV acha o extrato do 43, que o C2X já chama de PDI", async () => {
    m.traduzir.mockResolvedValue({ ids: [43], ok: true, semId: [] });

    const r = await loadApoloParticipantStatement({ ...ESCOPO, enterpriseCode: "RDV" });

    expect(r.ok && r.data.rows.map((row) => row.unitCode)).toEqual(["PDIA1"]);
  });

  it("sigla sem id devolve o extrato vazio que `e.code = ?` já devolvia, sem ir ao C2X", async () => {
    m.traduzir.mockResolvedValue({ ids: [], ok: true, semId: ["TSC"] });

    const r = await loadApoloParticipantStatement({ ...ESCOPO, enterpriseCode: "TSC" });

    expect(r).toEqual({
      data: { enterprises: [], rows: [], summary: { count: 0, total: 0 } },
      ok: true,
    });
    expect(m.pool.query).not.toHaveBeenCalled();
  });

  it("🔴 catálogo fora (C2X fora) é o mesmo erro de quando a consulta caía", async () => {
    m.traduzir.mockResolvedValue({ erro: "Catálogo indisponível.", ok: false });
    const silencio = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const r = await loadApoloParticipantStatement({ ...ESCOPO, enterpriseCode: "VOC" });

    expect(r).toEqual({ error: "Nao foi possivel carregar o extrato.", ok: false });
    expect(m.pool.query).not.toHaveBeenCalled();
    silencio.mockRestore();
  });
});
