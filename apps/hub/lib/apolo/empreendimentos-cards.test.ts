import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SituacaoDaUnidade,
  SituacaoDasUnidades,
  UnidadeComSituacao,
} from "@/lib/hercules/situacao-da-unidade";

// OS CARDS DA LISTA DE EMPREENDIMENTOS DO APOLO PELA RÉGUA ÚNICA (Lucas, 18/09/2026: *"esses
// status tem que morar em um so lugar"* · *"no c2x não precisa olhar"*).
//
// Até aqui o SELECT do C2X somava os baldes pelo `sale_status_id` / `sale_blocked` do legado, e o
// card dizia "Disponível" para o lote que o Panteon já tinha bloqueado, reservado ou posto em
// contrato. Estes testes provam: o C2X dá as unidades e o preço; a situação sai de UMA chamada à
// régua com todos os empreendimentos; a unidade que o Panteon não conhece conta ocupada; e falha de
// leitura vira erro, nunca card chutado.

const estado = vi.hoisted(() => ({
  empreendimentos: [] as Record<string, unknown>[],
  sqls: [] as string[],
  unidades: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: vi.fn(() => ({
    ok: true,
    pool: {
      query: vi.fn(async (sql: string) => {
        estado.sqls.push(sql);
        return [/enterprise_unities u/.test(sql) ? estado.unidades : estado.empreendimentos];
      }),
    },
  })),
  sanitizeHadesDbError: (erro: unknown) => String(erro),
}));

vi.mock("@/lib/apolo/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/server")>()),
  createApoloAdminClient: vi.fn(() => ({ cliente: "admin" })),
}));

vi.mock("@/lib/hercules/situacao-da-unidade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/situacao-da-unidade")>()),
  lerSituacaoDasUnidades: vi.fn(),
}));

import { lerSituacaoDasUnidades } from "@/lib/hercules/situacao-da-unidade";

import { cenariosPelaRegua, loadApoloEnterprises } from "./empreendimentos";

const lerSituacao = vi.mocked(lerSituacaoDasUnidades);

/** A régua, montada à mão: cada unidade casa pelo id do legado e pelo código. */
function situacoes(pares: Array<[origem: string, codigo: string, situacao: SituacaoDaUnidade]>): SituacaoDasUnidades {
  const saida: SituacaoDasUnidades = {
    porCodigo: new Map(),
    porLinha: new Map(),
    porOrigemC2x: new Map(),
    terreno: () => undefined,
    unidades: [],
  };
  for (const [origem, codigo, situacao] of pares) {
    const unidade: UnidadeComSituacao = {
      codigo,
      enterpriseId: "44",
      id: `viva-${origem}`,
      lote: null,
      origemC2xId: origem,
      quadra: null,
      situacao,
    };
    saida.unidades.push(unidade);
    saida.porLinha.set(unidade.id, unidade);
    saida.porCodigo.set(codigo, unidade);
    saida.porOrigemC2x.set(origem, unidade);
  }
  return saida;
}

function unidade(id: number, nome: string, preco: number, empreendimento = 44, codigo = "LBP") {
  return { block: nome.slice(3, 5), enterprise_code: codigo, enterprise_id: empreendimento, id, lot: nome.slice(5), price: preco, unit_name: nome };
}

function empreendimento(id: number, code: string) {
  return { city: "Bom Despacho", code, id, incorporador: null, name: code, state: "MG" };
}

beforeEach(() => {
  vi.clearAllMocks();
  estado.sqls = [];
  estado.empreendimentos = [empreendimento(44, "LBP"), empreendimento(45, "RVP")];
  estado.unidades = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("cenariosPelaRegua: os cinco baldes pela situação do Panteon", () => {
  it("cada unidade cai no balde da régua; quantidade e preço são da linha do C2X", () => {
    const mapa = situacoes([
      ["1", "LBP0101", "disponivel"],
      ["2", "LBP0102", "reservado"],
      ["3", "LBP0103", "proposta"],
      ["4", "LBP0104", "contrato"],
      ["5", "LBP0105", "assinatura"],
      ["6", "LBP0106", "faturado"],
      ["7", "LBP0107", "vendida"],
      ["8", "LBP0108", "bloqueada"],
    ]);
    const linhas = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => unidade(n, `LBP010${n}`, 100 * n));

    const { cenarios, semCadastro } = cenariosPelaRegua(linhas, mapa);
    const cenario = cenarios.get("44");

    expect(semCadastro).toEqual([]);
    expect(cenario?.total).toEqual({ units: 8, value: 3600 });
    expect(cenario?.disponivel).toEqual({ units: 1, value: 100 });
    expect(cenario?.reservado).toEqual({ units: 1, value: 200 });
    // Proposta, contrato e assinatura: NEGOCIAÇÃO, o mesmo nome do filtro da aba e do Hércules.
    expect(cenario?.negociacao).toEqual({ units: 3, value: 300 + 400 + 500 });
    expect(cenario?.vendido).toEqual({ units: 2, value: 600 + 700 });
    expect(cenario?.bloqueado).toEqual({ units: 1, value: 800 });
  });

  it("⚠️ unidade que o Panteon não conhece conta OCUPADA (bloqueado) e entra no total", () => {
    const { cenarios, semCadastro } = cenariosPelaRegua([unidade(9, "LBP0909", 500)], situacoes([]));
    expect(cenarios.get("44")?.disponivel.units).toBe(0);
    expect(cenarios.get("44")?.bloqueado).toEqual({ units: 1, value: 500 });
    expect(cenarios.get("44")?.total.units).toBe(1);
    expect(semCadastro).toEqual(["LBP0909"]);
  });

  it("casa pela ordem única: id do legado primeiro, mesmo com o nome apontando para outra", () => {
    const mapa = situacoes([
      ["10", "LBP0110", "contrato"],
      ["11", "LBP0111", "disponivel"],
    ]);
    // A linha 10 do C2X tem o nome da 11: quem responde é o id do legado (contrato), e não o nome.
    const { cenarios } = cenariosPelaRegua([unidade(10, "LBP0111", 100)], mapa);
    expect(cenarios.get("44")?.negociacao.units).toBe(1);
    expect(cenarios.get("44")?.disponivel.units).toBe(0);
  });

  it("sem a régua (comSituacao: false) sai só o total, com os baldes zerados, nunca um disponível chutado", () => {
    const { cenarios } = cenariosPelaRegua([unidade(1, "LBP0101", 100)], null);
    expect(cenarios.get("44")?.total).toEqual({ units: 1, value: 100 });
    expect(cenarios.get("44")?.disponivel).toEqual({ units: 0, value: 0 });
  });
});

describe("loadApoloEnterprises: os cards pela régua única", () => {
  it("⚠️ UMA chamada à régua com todos os empreendimentos, e nunca uma por produto", async () => {
    estado.unidades = [unidade(1, "LBP0101", 100), unidade(2, "RVPA01", 200, 45, "RVP"), unidade(3, "LBP0102", 100)];
    lerSituacao.mockResolvedValue(situacoes([]));

    await loadApoloEnterprises();

    expect(lerSituacao).toHaveBeenCalledTimes(1);
    expect(lerSituacao.mock.calls[0]?.[1]).toEqual(["44", "45"]);
  });

  it("⚠️ o SELECT do legado nem traz mais as colunas de status", async () => {
    lerSituacao.mockResolvedValue(situacoes([]));
    await loadApoloEnterprises();
    for (const sql of estado.sqls) expect(sql).not.toMatch(/sale_status_id|sale_blocked|sale_statuses/);
  });

  it("o card do empreendimento sai com os baldes da régua", async () => {
    estado.unidades = [unidade(1, "LBP0101", 100), unidade(2, "LBP0102", 300), unidade(3, "LBP0103", 50)];
    lerSituacao.mockResolvedValue(
      situacoes([
        ["1", "LBP0101", "disponivel"],
        ["2", "LBP0102", "contrato"],
        ["3", "LBP0103", "bloqueada"],
      ]),
    );

    const resultado = await loadApoloEnterprises();
    if (!resultado.ok) throw new Error(resultado.error);

    const lbp = resultado.data.rows.find((row) => row.code === "LBP");
    expect(lbp?.scenario).toMatchObject({
      bloqueado: { units: 1, value: 50 },
      disponivel: { units: 1, value: 100 },
      negociacao: { units: 1, value: 300 },
      total: { units: 3, value: 450 },
    });
    // O empreendimento sem unidade continua na lista, zerado.
    expect(resultado.data.rows.find((row) => row.code === "RVP")?.scenario.total.units).toBe(0);
  });

  it("⚠️ falha ao ler a situação vira ERRO, e não card pintado de livre", async () => {
    estado.unidades = [unidade(1, "LBP0101", 100)];
    lerSituacao.mockRejectedValue(new Error("timeout do PostgREST"));

    const resultado = await loadApoloEnterprises();

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toContain("situação das unidades");
    expect(resultado.error).not.toContain("PostgREST");
  });

  it("comSituacao: false não vai à régua (para quem só quer a lista)", async () => {
    estado.unidades = [unidade(1, "LBP0101", 100)];

    const resultado = await loadApoloEnterprises({ comSituacao: false });

    expect(lerSituacao).not.toHaveBeenCalled();
    expect(resultado.ok).toBe(true);
  });
});
