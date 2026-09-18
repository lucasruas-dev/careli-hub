import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SituacaoDaUnidade,
  SituacaoDasUnidades,
  UnidadeComSituacao,
} from "@/lib/hercules/situacao-da-unidade";

// A LISTA DE VENDAS DO APOLO: A SITUAÇÃO É A DA RÉGUA ÚNICA (Lucas, 18/09/2026: *"esses status tem
// que morar em um so lugar"*).
//
// Até aqui a coluna de cada unidade no funil vinha do estágio da última proposta do C2X, e o
// "bloqueada" do `sale_blocked` do legado: o lote bloqueado, reservado ou em contrato no Hércules
// aparecia "Disponível" aqui. Estes testes provam que a COLUNA vem do Panteon e que a LISTA de
// vendas (quais unidades, qual comprador, qual imobiliária) continua a do C2X.

const estado = vi.hoisted(() => ({
  sqls: [] as string[],
  unidades: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: vi.fn(() => ({
    ok: true,
    pool: {
      query: vi.fn(async (sql: string) => {
        estado.sqls.push(sql);
        // Só a primeira leitura (a das unidades) interessa aqui; terminais e movimentação vazios.
        return [/as stage_since/.test(sql) ? estado.unidades : []];
      }),
    },
  })),
  sanitizeHadesDbError: (erro: unknown) => String(erro),
}));

vi.mock("@/lib/apolo/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/server")>()),
  createApoloAdminClient: vi.fn(() => ({ cliente: "admin" })),
}));

vi.mock("@/lib/apolo/carteira", () => ({
  loadApoloUnitInstallments: vi.fn(async () => ({ installments: [], ok: true })),
}));

vi.mock("@/lib/hercules/situacao-da-unidade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/situacao-da-unidade")>()),
  lerSituacaoDasUnidades: vi.fn(),
}));

import { lerSituacaoDasUnidades } from "@/lib/hercules/situacao-da-unidade";

import { estagioPelaSituacao, loadApoloEnterpriseVendas } from "./vendas";

const lerSituacao = vi.mocked(lerSituacaoDasUnidades);

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

/** Uma linha do SELECT de unidades da lista de vendas. `stage_id` = estágio da última proposta do C2X. */
function linha(id: number, nome: string, stageId: null | number, extra: Record<string, unknown> = {}) {
  return {
    ar_id: stageId ? id * 10 : null,
    block: nome.slice(3, 5),
    client_code: stageId ? `CLI${id}` : null,
    client_id: stageId ? id : null,
    client_name: stageId ? `Comprador ${id}` : null,
    enterprise_code: "LBP",
    enterprise_id: 44,
    id,
    imobiliaria_code: null,
    imobiliaria_id: null,
    imobiliaria_name: null,
    lot: nome.slice(5),
    price: 1000,
    stage_id: stageId,
    stage_since: stageId ? "2026-09-01T10:00:00Z" : null,
    unit_name: nome,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  estado.sqls = [];
  estado.unidades = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("estagioPelaSituacao: a régua no vocabulário do funil", () => {
  it("cada situação na sua coluna; bloqueada fora do funil", () => {
    const casos: Array<[SituacaoDaUnidade, string, boolean]> = [
      ["disponivel", "disponivel", false],
      ["reservado", "reservado", false],
      ["reservada", "reservado", false],
      ["proposta", "proposta", false],
      ["contrato", "contrato", false],
      ["assinatura", "assinatura", false],
      ["faturado", "faturado", false],
      ["vendida", "faturado", false],
      ["bloqueada", "disponivel", true],
    ];
    for (const [situacao, stage, blocked] of casos) {
      expect(estagioPelaSituacao(situacao)).toEqual({ blocked, stage });
    }
  });

  it("⚠️ sem cadastro no Panteon: ocupada (bloqueada), nunca livre", () => {
    expect(estagioPelaSituacao(null)).toEqual({ blocked: true, stage: "disponivel" });
  });
});

describe("loadApoloEnterpriseVendas: a coluna vem do Panteon", () => {
  it("⚠️ bloqueada NO PANTEON sai bloqueada, mesmo o C2X não sabendo (o sale_blocked nem é lido)", async () => {
    estado.unidades = [linha(1, "LBP0101", null)];
    lerSituacao.mockResolvedValue(situacoes([["1", "LBP0101", "bloqueada"]]));

    const resultado = await loadApoloEnterpriseVendas(["LBP"]);
    if (!resultado.ok) throw new Error(resultado.error);

    expect(resultado.data.units[0]).toMatchObject({ blocked: true, situacao: "Bloqueado", stage: "disponivel" });
    expect(resultado.data.bloqueadas.units).toBe(1);
    expect(resultado.data.funnel.find((f) => f.stage === "disponivel")?.units).toBe(0);
    expect(estado.sqls[0]).not.toMatch(/sale_blocked|sale_status_id/);
  });

  it("⚠️ contrato no Hércules com o C2X ainda em proposta: a coluna é Contrato", async () => {
    estado.unidades = [linha(2, "LBP0102", 9)];
    lerSituacao.mockResolvedValue(situacoes([["2", "LBP0102", "contrato"]]));

    const resultado = await loadApoloEnterpriseVendas(["LBP"]);
    if (!resultado.ok) throw new Error(resultado.error);

    expect(resultado.data.units[0]).toMatchObject({
      // A venda é a mesma do C2X (comprador vem dela)...
      client: { name: "Comprador 2" },
      // ...mas a coluna é a do Panteon, e a data do C2X (de outro estágio) não é usada.
      situacao: "Contrato",
      stage: "contrato",
      stageSince: null,
      vendaNoC2x: true,
    });
    expect(resultado.data.funnel.find((f) => f.stage === "contrato")?.units).toBe(1);
  });

  it("mesmo estágio nos dois lados: a data do C2X continua valendo", async () => {
    estado.unidades = [linha(3, "LBP0103", 9)];
    lerSituacao.mockResolvedValue(situacoes([["3", "LBP0103", "proposta"]]));

    const resultado = await loadApoloEnterpriseVendas(["LBP"]);
    if (!resultado.ok) throw new Error(resultado.error);

    expect(resultado.data.units[0]).toMatchObject({ stage: "proposta", stageSince: "2026-09-01T10:00:00.000Z" });
  });

  it("⚠️ reservada no Hércules SEM venda viva no C2X: coluna Reservado, e SEM o comprador antigo", async () => {
    // A última proposta do C2X está cancelada (7): o comprador dela é história, e mostrá-lo ao lado
    // da reserva de agora faria alguém atender o cliente errado.
    estado.unidades = [linha(4, "LBP0104", 7)];
    lerSituacao.mockResolvedValue(situacoes([["4", "LBP0104", "reservado"]]));

    const resultado = await loadApoloEnterpriseVendas(["LBP"]);
    if (!resultado.ok) throw new Error(resultado.error);

    expect(resultado.data.units[0]).toMatchObject({
      client: null,
      imobiliaria: null,
      stage: "reservado",
      vendaNoC2x: false,
    });
  });

  it("⚠️ unidade que o Panteon não conhece: ocupada, com o texto próprio, e contada à parte", async () => {
    estado.unidades = [linha(5, "LBP0105", null), linha(6, "LBP0106", null)];
    lerSituacao.mockResolvedValue(situacoes([["6", "LBP0106", "disponivel"]]));

    const resultado = await loadApoloEnterpriseVendas(["LBP"]);
    if (!resultado.ok) throw new Error(resultado.error);

    expect(resultado.data.units[0]).toMatchObject({
      blocked: true,
      semCadastroNoPanteon: true,
      situacao: "Sem cadastro no Panteon",
      stage: "disponivel",
    });
    expect(resultado.data.bloqueadas.units).toBe(1);
    expect(resultado.data.semCadastroNoPanteon?.units).toBe(1);
    // O funil mais as bloqueadas continuam somando o total.
    const noFunil = resultado.data.funnel.reduce((soma, f) => soma + f.units, 0);
    expect(noFunil + resultado.data.bloqueadas.units).toBe(resultado.data.totalUnits);
  });

  it("⚠️ falha ao ler a situação vira ERRO, e não a lista pelo C2X", async () => {
    estado.unidades = [linha(1, "LBP0101", null)];
    lerSituacao.mockRejectedValue(new Error("timeout"));

    const resultado = await loadApoloEnterpriseVendas(["LBP"]);

    expect(resultado.ok).toBe(false);
  });

  it("pede ao Panteon os empreendimentos das linhas, numa chamada só", async () => {
    estado.unidades = [linha(1, "LBP0101", null), linha(2, "LBR0101", null, { enterprise_code: "LBR", enterprise_id: 45 })];
    lerSituacao.mockResolvedValue(situacoes([]));

    await loadApoloEnterpriseVendas(["LBP", "LBR"]);

    expect(lerSituacao).toHaveBeenCalledTimes(1);
    expect(lerSituacao.mock.calls[0]?.[1]).toEqual(["44", "45"]);
  });
});
