import { beforeEach, describe, expect, it, vi } from "vitest";

import { empreendimentosDoWhere, filtraPelaSigla } from "@/lib/apolo/c2x-pelo-id.where-falso";

// A DEFASAGEM DA CARTEIRA PELO ID DO C2X (PAN-124).
//
// A tela lê a carteira inteira (sem `?codes=`); a rota aceita siglas. As duas travas: a exclusão vai
// pelo id, e sigla pedida vira id antes de ir ao C2X. E a armadilha nova que a tradução cria: sigla
// sem id NÃO pode virar "sem filtro", senão quem pediu um empreendimento recebe a carteira inteira.

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

import { carregarDefasagem } from "./defasagem-c2x";

beforeEach(() => {
  m.pool.ok = true;
  m.pool.query.mockReset();
  m.traduzir.mockReset();
  // Uma mensal por empreendimento que passa no WHERE (contrato = id*100). Menos que o lote: uma volta só.
  m.pool.query.mockImplementation(async (sql: string, params: unknown[]) => [
    empreendimentosDoWhere(sql, params).map((emp) => ({
      ar: emp.id * 100,
      code: emp.code,
      id: emp.id * 1000,
      parcelaAtual: 1,
      parcelaTotal: 120,
      statusId: 6,
      tipoId: 3,
      unidade: "A 1",
      valorInicial: 500,
      vencimento: "2026-10-10",
    })),
  ]);
});

const codigosDasLinhas = (r: Awaited<ReturnType<typeof carregarDefasagem>>) =>
  r.ok ? r.data.linhas.map((l) => l.code).sort() : null;

describe("carregarDefasagem", () => {
  it("🔴 a carteira inteira exclui pelo id: o teste renomeado (TSC -> TSX) continua fora", async () => {
    const r = await carregarDefasagem();

    expect(m.traduzir).not.toHaveBeenCalled();
    const [sql, params] = m.pool.query.mock.calls[0] ?? [];
    expect(sql).toContain("and e.id not in (?, ?, ?)");
    expect(sql).not.toContain("e.id in (");
    expect(filtraPelaSigla(String(sql))).toBe(false);
    expect(params).toEqual([2, 31, 34, 0]);
    // Pela sigla, `e.code not in ('TSC', 'SDT', 'LAB', 'LAG')` deixaria o TSX entrar.
    expect(codigosDasLinhas(r)).toEqual(["PDI", "VOC", "VOL"]);
  });

  it("🔴 as siglas pedidas viram id: `e.id in`, e nunca `e.code in`", async () => {
    m.traduzir.mockResolvedValue({ ids: [36, 37], ok: true, semId: [] });

    const r = await carregarDefasagem(["voc", "VOL", "VOL"]);

    // As siglas vêm da tela, que as leu ao vivo: são conferidas no C2X no mesmo instante.
    expect(m.traduzir).toHaveBeenCalledWith(["VOC", "VOL"], { conferirNoC2x: true });
    const [sql, params] = m.pool.query.mock.calls[0] ?? [];
    expect(sql).toContain("and e.id in (?, ?)");
    expect(filtraPelaSigla(String(sql))).toBe(false);
    expect(params).toEqual([2, 31, 34, 36, 37, 0]);
    expect(codigosDasLinhas(r)).toEqual(["VOC", "VOL"]);
  });

  // ⚠️ SÓ ENQUANTO O CATÁLOGO EM CACHE FOR DE ANTES DO RENOME (ver "O LIMITE" em
  // c2x-pelo-id-servidor.test.ts): relido, RDV volta vazio, como `e.code in` voltava.
  it("🔴 renome, com o catálogo em cache ainda de antes dele: RDV acha a carteira que o C2X já chama de PDI", async () => {
    m.traduzir.mockResolvedValue({ ids: [43], ok: true, semId: [] });

    const r = await carregarDefasagem(["RDV"]);

    expect(codigosDasLinhas(r)).toEqual(["PDI"]);
  });

  it("🔴 sigla sem id devolve VAZIO, e nunca a carteira inteira", async () => {
    m.traduzir.mockResolvedValue({ ids: [], ok: true, semId: ["XYZ"] });

    const r = await carregarDefasagem(["XYZ"]);

    expect(r.ok && r.data.linhas).toEqual([]);
    expect(r.ok && r.data.parcial).toBe(false);
    expect(m.pool.query).not.toHaveBeenCalled();
  });

  it("🔴 catálogo fora (C2X fora) é o mesmo erro de quando a leitura caía", async () => {
    m.traduzir.mockResolvedValue({ erro: "Catálogo indisponível.", ok: false });
    const silencio = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const r = await carregarDefasagem(["VOC"]);

    expect(r).toEqual({ error: "Não foi possível ler a carteira agora.", ok: false });
    expect(m.pool.query).not.toHaveBeenCalled();
    silencio.mockRestore();
  });
});
