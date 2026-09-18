import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SituacaoDaUnidade,
  SituacaoDasUnidades,
  UnidadeComSituacao,
} from "@/lib/hercules/situacao-da-unidade";

// A ABA UNIDADES DO APOLO PINTA PELA RÉGUA ÚNICA (Lucas, 18/09/2026: *"esses status tem que morar
// em um so lugar"* · *"no c2x não precisa olhar"*).
//
// Até aqui a aba lia `sale_status_id` / `sale_blocked` do C2X, e medido em 18/09/2026: 93 lotes do
// LBP bloqueados no Panteon apareciam "Disponível", e 5 em contrato e 6 em assinatura também. Estes
// testes provam que o C2X continua dando a LINHA (quadra, lote, preço, comprador) e que a SITUAÇÃO
// sai de lib/hercules/situacao-da-unidade.ts, casada pela unidade do legado.

const estado = vi.hoisted(() => ({
  linhasDoC2x: [] as Record<string, unknown>[],
  query: null as null | ((sql: string, params: unknown[]) => Promise<unknown>),
  semSupabase: false,
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: vi.fn(() => ({
    ok: true,
    pool: {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        await estado.query?.(sql, params);
        return [estado.linhasDoC2x];
      }),
    },
  })),
  sanitizeHadesDbError: (erro: unknown) => String(erro),
}));

vi.mock("@/lib/apolo/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/server")>()),
  createApoloAdminClient: vi.fn(() => (estado.semSupabase ? null : { cliente: "admin" })),
}));

vi.mock("@/lib/prometeu/data", () => ({
  createPrometeuClient: vi.fn(() => ({ cliente: "prometeu" })),
}));

vi.mock("@/lib/prometeu/reservas-vivas", () => ({
  reservasVivasPorCodigo: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/hercules/situacao-da-unidade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/situacao-da-unidade")>()),
  lerSituacaoDasUnidades: vi.fn(),
}));

import { lerSituacaoDasUnidades } from "@/lib/hercules/situacao-da-unidade";
import { reservasVivasPorCodigo } from "@/lib/prometeu/reservas-vivas";

import {
  loadApoloEnterpriseUnits,
  situacaoDaLinhaDoC2x,
  situacaoDaLinhaDoPanteon,
  situacaoNaAbaUnidades,
} from "./empreendimentos";

const lerSituacao = vi.mocked(lerSituacaoDasUnidades);

// ── Fixtures ────────────────────────────────────────────────────────────────

type Terreno = {
  /** Códigos de QUALQUER linha do terreno (a viva e a antiga do pai). */
  codigos: string[];
  id: string;
  /** Ids do legado de qualquer linha do terreno. */
  origens: string[];
  /** Ids de linha do Panteon (a viva e as antigas). */
  linhas?: string[];
  situacao: SituacaoDaUnidade;
};

/** O que `lerSituacaoDasUnidades` devolveria, montado à mão. */
function situacoes(terrenos: Terreno[]): SituacaoDasUnidades {
  const saida: SituacaoDasUnidades = {
    porCodigo: new Map(),
    porLinha: new Map(),
    porOrigemC2x: new Map(),
    unidades: [],
  };
  for (const t of terrenos) {
    const unidade: UnidadeComSituacao = {
      codigo: t.codigos[0] ?? t.id,
      enterpriseId: "44",
      id: t.id,
      lote: null,
      origemC2xId: t.origens[0] ?? null,
      quadra: null,
      situacao: t.situacao,
    };
    saida.unidades.push(unidade);
    for (const linha of t.linhas ?? [t.id]) saida.porLinha.set(linha, unidade);
    for (const codigo of t.codigos) saida.porCodigo.set(codigo.toUpperCase(), unidade);
    for (const origem of t.origens) saida.porOrigemC2x.set(origem, unidade);
  }
  return saida;
}

/** Uma linha do `select` de `loadApoloEnterpriseUnits`. */
function linhaDoC2x(
  p: { block: string; id: number; lot: string; unit_name: null | string } & Record<string, unknown>,
): Record<string, unknown> {
  return {
    area: 360,
    client_code: null,
    client_id: null,
    client_name: null,
    enterprise_code: "LBP",
    enterprise_id: 44,
    imobiliaria_code: null,
    imobiliaria_id: null,
    imobiliaria_name: null,
    kind: "LOTE",
    price: 120000,
    registration: null,
    stage: null,
    ...p,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  estado.linhasDoC2x = [];
  estado.query = null;
  estado.semSupabase = false;
  vi.mocked(reservasVivasPorCodigo).mockResolvedValue(new Map());
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// ── A aba inteira ───────────────────────────────────────────────────────────

describe("loadApoloEnterpriseUnits: a situação é a do Panteon", () => {
  it("⚠️ os 93 do LBP: bloqueado no Panteon sai Bloqueado, mesmo o C2X dizendo livre", async () => {
    // O `sale_status_id` 1 (Disponível) e o `sale_blocked` 0 viriam do legado; a aba não os usa mais.
    estado.linhasDoC2x = [
      linhaDoC2x({ block: "01", id: 1001, lot: "05", sale_blocked: 0, sale_status_id: 1, unit_name: "LBP0105" }),
    ];
    lerSituacao.mockResolvedValue(
      situacoes([{ codigos: ["LBP0105"], id: "u-1001", origens: ["1001"], situacao: "bloqueada" }]),
    );

    const resultado = await loadApoloEnterpriseUnits(["LBP"]);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.units[0]).toMatchObject({ bucket: "bloqueado", code: "LBP0105", status: "Bloqueado" });
  });

  it("contrato, assinatura e proposta saem ocupados, com a etapa escrita no selo", async () => {
    estado.linhasDoC2x = [
      linhaDoC2x({ block: "02", id: 1002, lot: "01", unit_name: "LBP0201" }),
      linhaDoC2x({ block: "02", id: 1003, lot: "02", unit_name: "LBP0202" }),
      linhaDoC2x({ block: "02", id: 1004, lot: "03", unit_name: "LBP0203" }),
      linhaDoC2x({ block: "02", id: 1005, lot: "04", unit_name: "LBP0204" }),
      linhaDoC2x({ block: "02", id: 1006, lot: "05", unit_name: "LBP0205" }),
    ];
    lerSituacao.mockResolvedValue(
      situacoes([
        { codigos: ["LBP0201"], id: "a", origens: ["1002"], situacao: "contrato" },
        { codigos: ["LBP0202"], id: "b", origens: ["1003"], situacao: "assinatura" },
        { codigos: ["LBP0203"], id: "c", origens: ["1004"], situacao: "proposta" },
        { codigos: ["LBP0204"], id: "d", origens: ["1005"], situacao: "reservado" },
        { codigos: ["LBP0205"], id: "e", origens: ["1006"], situacao: "disponivel" },
      ]),
    );

    const resultado = await loadApoloEnterpriseUnits(["LBP"]);
    if (!resultado.ok) throw new Error(resultado.error);

    expect(resultado.units.map((u) => [u.code, u.bucket, u.status])).toEqual([
      ["LBP0201", "vendido", "Contrato"],
      ["LBP0202", "vendido", "Assinatura"],
      ["LBP0203", "vendido", "Proposta"],
      ["LBP0204", "reservado", "Reservado"],
      ["LBP0205", "disponivel", "Disponível"],
    ]);
  });

  it("pede ao Panteon os empreendimentos do C2X das linhas, sem repetir", async () => {
    estado.linhasDoC2x = [
      linhaDoC2x({ block: "01", id: 1, lot: "01", unit_name: "LBP0101" }),
      linhaDoC2x({ block: "01", id: 2, lot: "02", unit_name: "LBP0102" }),
      linhaDoC2x({ block: "01", enterprise_code: "LBR", enterprise_id: 45, id: 3, lot: "01", unit_name: "LBR0101" }),
    ];
    lerSituacao.mockResolvedValue(situacoes([]));

    await loadApoloEnterpriseUnits(["LBP", "LBR"]);

    expect(lerSituacao).toHaveBeenCalledTimes(1);
    expect(lerSituacao.mock.calls[0]?.[0]).toEqual({ cliente: "admin" });
    expect(lerSituacao.mock.calls[0]?.[1]).toEqual(["44", "45"]);
  });

  it("⚠️ o SELECT do legado nem traz mais as colunas de status", async () => {
    let sqlLido = "";
    estado.query = async (sql) => {
      sqlLido = sql;
    };
    lerSituacao.mockResolvedValue(situacoes([]));

    await loadApoloEnterpriseUnits(["LBP"]);

    expect(sqlLido).not.toMatch(/sale_status_id|sale_blocked|sale_statuses/);
    expect(sqlLido).toMatch(/e\.id as enterprise_id/);
    expect(sqlLido).toMatch(/u\.name as unit_name/);
  });

  it("⚠️ unidade que o Panteon não conhece sai BLOQUEADA, nunca livre, e o buraco vai para o log", async () => {
    estado.linhasDoC2x = [linhaDoC2x({ block: "09", id: 9009, lot: "09", sale_status_id: 1, unit_name: "LBP0909" })];
    lerSituacao.mockResolvedValue(situacoes([]));

    const resultado = await loadApoloEnterpriseUnits(["LBP"]);
    if (!resultado.ok) throw new Error(resultado.error);

    expect(resultado.units[0]).toMatchObject({ bucket: "bloqueado", status: "Bloqueado" });
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain("1 unidade(s)");
  });

  it("⚠️ falha ao ler a situação vira ERRO, e não uma lista pintada de livre", async () => {
    estado.linhasDoC2x = [linhaDoC2x({ block: "01", id: 1001, lot: "05", unit_name: "LBP0105" })];
    lerSituacao.mockRejectedValue(new Error("timeout do PostgREST"));

    const resultado = await loadApoloEnterpriseUnits(["LBP"]);

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toContain("situação das unidades");
    // O detalhe técnico vai para o log, não para a tela.
    expect(resultado.error).not.toContain("PostgREST");
  });

  it("⚠️ sem Supabase, também é erro (e não o C2X de volta)", async () => {
    estado.semSupabase = true;
    estado.linhasDoC2x = [linhaDoC2x({ block: "01", id: 1001, lot: "05", unit_name: "LBP0105" })];

    const resultado = await loadApoloEnterpriseUnits(["LBP"]);

    expect(resultado.ok).toBe(false);
    expect(lerSituacao).not.toHaveBeenCalled();
  });

  it("a reserva do salão continua dando o NOME de quem reservou; a situação é a da régua", async () => {
    estado.linhasDoC2x = [
      linhaDoC2x({
        block: "B",
        client_code: "CLI1",
        client_id: 77,
        client_name: "Comprador Antigo do C2X",
        enterprise_code: "RVP",
        id: 501,
        lot: "03",
        stage: "Cancelada",
        unit_name: "RVPB03",
      }),
    ];
    vi.mocked(reservasVivasPorCodigo).mockResolvedValue(
      new Map([["RVPB03", { cliente: "Maria Reservante", entityId: "ent-1", origem: "IMOB X · Corretor Y" }]]),
    );
    lerSituacao.mockResolvedValue(
      situacoes([{ codigos: ["RVPB03"], id: "r", origens: ["501"], situacao: "reservado" }]),
    );

    const resultado = await loadApoloEnterpriseUnits(["RVP"]);
    if (!resultado.ok) throw new Error(resultado.error);

    expect(resultado.units[0]).toMatchObject({
      bucket: "reservado",
      movement: {
        client: { entityId: "ent-1", name: "Maria Reservante" },
        stage: "Reserva do lançamento",
      },
      status: "Reservado",
    });
  });

  it("os outros campos seguem vindo do C2X (preço, área, comprador da última proposta)", async () => {
    estado.linhasDoC2x = [
      linhaDoC2x({
        area: "451.5",
        block: "03",
        client_code: "CLI9",
        client_id: 9,
        client_name: "Fulano",
        id: 3003,
        lot: "07",
        price: "250000",
        registration: "12.345",
        stage: "Contrato gerado",
        unit_name: "LBP0307",
      }),
    ];
    lerSituacao.mockResolvedValue(
      situacoes([{ codigos: ["LBP0307"], id: "x", origens: ["3003"], situacao: "contrato" }]),
    );

    const resultado = await loadApoloEnterpriseUnits(["LBP"]);
    if (!resultado.ok) throw new Error(resultado.error);

    expect(resultado.units[0]).toMatchObject({
      area: 451.5,
      block: "03",
      id: "3003",
      lot: "07",
      movement: { client: { name: "Fulano" }, stage: "Contrato gerado" },
      price: 250000,
      registration: "12.345",
    });
  });
});

// ── O casamento linha do C2X -> unidade do Panteon ─────────────────────────

describe("situacaoDaLinhaDoC2x: qual unidade do Panteon responde", () => {
  const mapa = situacoes([
    { codigos: ["LBP0201"], id: "pelo-id", origens: ["2001"], situacao: "contrato" },
    { codigos: ["LBP0299"], id: "pelo-nome", origens: ["7777"], situacao: "assinatura" },
    { codigos: ["LBP0301"], id: "pelo-codigo", origens: [], situacao: "reservado" },
    // O terreno dividido: a linha viva (VOC) e a antiga do pai (VLO) respondem o mesmo.
    {
      codigos: ["VOC0305", "VLO0305"],
      id: "viva-voc",
      linhas: ["viva-voc", "antiga-vlo"],
      origens: ["3700", "3500"],
      situacao: "proposta",
    },
  ]);

  it("o id do legado manda, mesmo com o nome apontando para outra unidade", () => {
    expect(situacaoDaLinhaDoC2x({ codigo: "LBP0299", id: 2001, nomeNoC2x: "LBP0299" }, mapa)).toBe("contrato");
  });

  it("sem id, vale o `name` do legado (o `codigo` da carga)", () => {
    expect(situacaoDaLinhaDoC2x({ codigo: "XXX", id: 1, nomeNoC2x: " lbp0299 " }, mapa)).toBe("assinatura");
  });

  it("sem id nem nome, vale o código que a tela monta", () => {
    expect(situacaoDaLinhaDoC2x({ codigo: "LBP0301", id: 2, nomeNoC2x: "QD 3 LT 1" }, mapa)).toBe("reservado");
  });

  it("o terreno dividido responde o mesmo pela linha antiga do pai", () => {
    expect(situacaoDaLinhaDoC2x({ codigo: "VLO0305", id: 3500, nomeNoC2x: "VLO0305" }, mapa)).toBe("proposta");
    expect(situacaoDaLinhaDoC2x({ codigo: "VOC0305", id: 3700, nomeNoC2x: "VOC0305" }, mapa)).toBe("proposta");
  });

  it("⚠️ nenhuma chave casa: bloqueada, nunca disponível", () => {
    expect(situacaoDaLinhaDoC2x({ codigo: "", id: 999, nomeNoC2x: null }, mapa)).toBe("bloqueada");
  });

  it("a linha do produto nascido no Panteon casa pelo id da linha, viva ou antiga", () => {
    expect(situacaoDaLinhaDoPanteon("antiga-vlo", mapa)).toBe("proposta");
    expect(situacaoDaLinhaDoPanteon("nao-existe", mapa)).toBe("bloqueada");
  });
});

describe("situacaoNaAbaUnidades: cor e texto da mesma fonte", () => {
  it("quatro baldes na cor; a etapa por extenso no texto", () => {
    const casos: Array<[SituacaoDaUnidade, string, string]> = [
      ["disponivel", "disponivel", "Disponível"],
      ["reservado", "reservado", "Reservado"],
      ["reservada", "reservado", "Reservado"],
      ["proposta", "vendido", "Proposta"],
      ["contrato", "vendido", "Contrato"],
      ["assinatura", "vendido", "Assinatura"],
      ["faturado", "vendido", "Faturado"],
      ["vendida", "vendido", "Vendido"],
      ["bloqueada", "bloqueado", "Bloqueado"],
    ];
    for (const [situacao, bucket, status] of casos) {
      expect(situacaoNaAbaUnidades(situacao)).toEqual({ bucket, status });
    }
  });
});
