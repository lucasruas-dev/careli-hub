import { beforeEach, describe, expect, it, vi } from "vitest";

import { idsDoC2xDasSiglas } from "@/lib/apolo/c2x-pelo-id";
import {
  empreendimentosDoWhere,
  type EmpreendimentoFalso,
  filtraPelaSigla,
} from "@/lib/apolo/c2x-pelo-id.where-falso";
import type { EmpreendimentoDoCatalogo } from "@/lib/apolo/catalogo-empreendimentos";
import type { SessaoIncorporador } from "@/lib/apolo/incorporador/sessao";

// A CARTEIRA DO PORTAL PELO ID DO C2X (PAN-124, lote 3): a leitura de Ato e Sinal que mora NESTA rota
// e o catálogo que a rota entrega à carteira líquida.
//
// O caso real: em 24/09/2026 a Nívea renomeou o 43 de RDV para PDI. O catálogo guarda a sigla por 10
// minutos, e é dele que `codigosDaSessao` tira os codes: nesses minutos a sessão comercial pedia "RDV"
// a um C2X que já dizia PDI, e com `e.code in (...)` a lista de Ato e Sinal do coordenador saía vazia,
// sem erro. O C2X de mentira responde ao WHERE que recebe (lib/apolo/c2x-pelo-id.where-falso.ts), então
// a consulta pela sigla recebe o que o MySQL daria a ela.

const m = vi.hoisted(() => ({
  bruta: vi.fn(),
  cadastro: vi.fn(),
  catalogo: vi.fn(),
  codigos: vi.fn(),
  idsDaSessao: vi.fn(),
  liquida: vi.fn(),
  pool: { query: vi.fn() },
  traduzir: vi.fn(),
}));

vi.mock("@/lib/apolo/incorporador/escopo", () => ({
  autorizar: () => ({ ok: true, sessao: SESSAO }),
  codigosDaSessao: m.codigos,
  idsDaSessao: m.idsDaSessao,
}));
vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({ catalogoDeEmpreendimentos: m.catalogo }));
vi.mock("@/lib/hercules/cadastro", () => ({ carregarCadastroDeEmpreendimentos: m.cadastro }));
vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => null }));
// O bruto é pedido PELO ID (PAN-124): a versão pela sigla não pode mais ser chamada por esta rota.
vi.mock("@/lib/apolo/carteira", () => ({
  loadApoloEnterpriseCarteira: () => {
    throw new Error("a rota não deve mais pedir o bruto pela sigla");
  },
  loadApoloEnterpriseCarteiraPorIds: m.bruta,
}));
// Só a leitura da carteira líquida é trocada: a régua do perfil da parcela (que Ato e Sinal usa) é a
// de verdade.
vi.mock("@/lib/apolo/incorporador/carteira-liquida", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/incorporador/carteira-liquida")>()),
  carteiraLiquidaDoIncorporador: m.liquida,
}));
vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ ok: true, pool: { query: m.pool.query } }),
}));
vi.mock("@/lib/apolo/c2x-pelo-id-servidor", () => ({ idsDoC2xDasSiglasAoVivo: m.traduzir }));

const SESSAO: SessaoIncorporador = {
  enterpriseIds: ["43"],
  enterpriseIdsComCarteira: ["43"],
  exp: Date.now() + 60_000,
  incorporadorId: "inc-1",
  incorporadorNome: "Gurgel",
  slug: "gurgel",
  tipo: "comercial",
  usuarioId: "u-1",
  usuarioNome: "Coordenadora",
};

const { GET } = await import("./route");

/** O C2X depois do renome: o 43 já se chama PDI. */
const C2X: EmpreendimentoFalso[] = [
  { code: "VOC", id: 37, name: "VALE DO OURO - CHACARAS" },
  { code: "PDI", id: 43, name: "PORTAL DO IBITURUNA" },
];

function catalogoCom(code: string): EmpreendimentoDoCatalogo[] {
  return [{ codes: [code], id: "43", name: "PORTAL DO IBITURUNA", stageIds: ["43"] }];
}

function c2xFalso(): void {
  m.pool.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const passam = empreendimentosDoWhere(sql, params, C2X);
    return [
      passam.map((emp) => ({
        ar_id: emp.id * 100,
        dias_atraso: 0,
        due_date: "2026-09-01",
        invoice_url: null,
        ja_venceu: 1,
        pago_no_mes: 1,
        parcel_type: "Ato",
        parcela_n: null,
        parcela_total: null,
        payment_date: "2026-09-01",
        payment_id: emp.id * 1000,
        payment_url: null,
        sinal_n: null,
        sinal_total: null,
        situacao: "paga",
        unit_id: emp.id * 10,
        valor_em_aberto: 0,
        valor_pago: 500,
        valor_previsto: 500,
      })),
    ];
  });
}

const UNIDADE = {
  block: "A",
  client: { entityId: "e-1", name: "Comprador" },
  code: "PDIA1",
  contractCode: null,
  contractDocumentId: null,
  enterpriseCode: "PDI",
  enterpriseName: "PORTAL DO IBITURUNA",
  faturadoAt: null,
  id: "430",
  imobiliaria: null,
  lot: "1",
  maxOverdueDays: 0,
  overdueAmount: 0,
  overdueInstallments: 0,
  paidAmount: 500,
  pedidoId: "4300",
  toReceiveAmount: 0,
  totalContract: 1000,
};

/** Só o pedaço da resposta que estes testes leem. */
type CorpoDaCarteira = {
  data: {
    atoESinalParcial?: unknown;
    units: Array<{ atoESinal: { parcelas: unknown[] } }>;
  };
};

async function carteira(): Promise<{ corpo: CorpoDaCarteira; status: number }> {
  const resposta = await GET(new Request("https://c2x.app.br/api/incorporador/carteira"));
  return { corpo: (await resposta.json()) as CorpoDaCarteira, status: resposta.status };
}

/** A sessão que pede `code`, com o catálogo em cache dizendo `siglaDo43` para o 43. */
function sessaoPedindo(code: string, siglaDo43 = code): void {
  m.codigos.mockResolvedValue([code]);
  m.catalogo.mockResolvedValue(catalogoCom(siglaDo43));
}

/** O que a leitura de Ato e Sinal pôs na resposta: a lista por unidade e o aviso de teto. */
function atoESinalDa(resposta: { corpo: CorpoDaCarteira; status: number }) {
  return {
    parcial: resposta.corpo.data.atoESinalParcial,
    porUnidade: resposta.corpo.data.units.map((u) => u.atoESinal),
    status: resposta.status,
  };
}

beforeEach(() => {
  for (const mock of [
    m.bruta,
    m.cadastro,
    m.catalogo,
    m.codigos,
    m.idsDaSessao,
    m.liquida,
    m.pool.query,
    m.traduzir,
  ]) {
    mock.mockReset();
  }
  c2xFalso();
  m.cadastro.mockResolvedValue([]);
  m.idsDaSessao.mockResolvedValue(["43"]);
  m.bruta.mockResolvedValue({ data: { summary: {}, units: [UNIDADE] }, ok: true });
  m.liquida.mockResolvedValue({ error: "fora do teste", ok: false });
  m.traduzir.mockImplementation(
    async (
      siglas: Iterable<unknown>,
      opcoes: { catalogo?: EmpreendimentoDoCatalogo[]; excluir?: readonly number[] } = {},
    ) => ({
      ok: true,
      ...idsDoC2xDasSiglas(siglas, { catalogo: opcoes.catalogo ?? [] }, opcoes),
    }),
  );
});

describe("GET /api/incorporador/carteira: Ato e Sinal pelo id do C2X", () => {
  it("🔴 o SQL de Ato e Sinal vai pelo id (`e.id in`), traduzido pelo catálogo da rota", async () => {
    sessaoPedindo("PDI");

    const { status } = await carteira();

    expect(status).toBe(200);
    expect(m.traduzir).toHaveBeenCalledWith(["PDI"], { catalogo: catalogoCom("PDI") });
    expect(m.pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = m.pool.query.mock.calls[0] as [string, unknown[]];
    expect(filtraPelaSigla(sql)).toBe(false);
    expect(sql).toMatch(/e\.id in \(\?\)/);
    expect(params).toEqual([43]);
  });

  it("🔴 o renome não muda a lista: com o catálogo em cache ainda dizendo RDV, sai o mesmo que com PDI", async () => {
    sessaoPedindo("RDV");
    const comSiglaVelha = atoESinalDa(await carteira());
    sessaoPedindo("PDI");
    const comSiglaNova = atoESinalDa(await carteira());

    // Só o pedaço desta leitura: o rótulo da unidade vem do bruto (outra etapa do PAN-124).
    expect(comSiglaVelha).toEqual(comSiglaNova);
    expect(comSiglaNova.porUnidade[0]?.parcelas).toHaveLength(1);
  });

  it("🔴 o bruto vai pelo id, traduzido UMA vez pelo catálogo da rota (o mesmo do escopo)", async () => {
    sessaoPedindo("RDV");
    await carteira();
    // O catálogo desta rota ainda diz RDV = 43: o bruto é pedido pelo 43, e não pela sigla.
    expect(m.traduzir).toHaveBeenCalledWith(["RDV"], { catalogo: catalogoCom("RDV"), excluir: [] });
    expect(m.bruta).toHaveBeenCalledWith([43]);
  });

  it("catálogo ilegível: o bruto não é lido e a rota responde o 503 de sempre", async () => {
    sessaoPedindo("PDI");
    m.traduzir.mockResolvedValue({ erro: "catálogo fora", ok: false });
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { status } = await carteira();
    expect(status).toBe(503);
    expect(m.bruta).not.toHaveBeenCalled();
    erro.mockRestore();
  });

  it("a carteira líquida recebe o MESMO catálogo, para traduzir pelo id sem reler", async () => {
    sessaoPedindo("PDI");
    await carteira();
    expect(m.liquida).toHaveBeenCalledWith(
      expect.objectContaining({ catalogo: catalogoCom("PDI"), codes: ["PDI"] }),
    );
  });

  it("sigla sem id no C2X (produto nascido no Panteon) não vai ao legado e dá a lista vazia de hoje", async () => {
    // O ZZ TESTE (9001, TST): só o cadastro do Panteon o conhece, e é por ele que vira produto.
    sessaoPedindo("TST", "PDI");
    m.idsDaSessao.mockResolvedValue(["9001"]);
    m.cadastro.mockResolvedValue([
      { c2xEnterpriseId: "9001", codigo: "TST", id: "s-tst", nome: "ZZ TESTE", paiId: null },
    ]);
    const semId = await carteira();
    expect(m.pool.query).not.toHaveBeenCalled();

    // O vazio de hoje: o C2X respondendo sem linha à consulta pela sigla que não casa.
    m.pool.query.mockResolvedValue([[]]);
    m.traduzir.mockResolvedValue({ ids: [43], ok: true, semId: [] });
    const semLinha = await carteira();
    expect(semId).toEqual(semLinha);
    expect(semId.corpo.data.units[0]?.atoESinal.parcelas).toEqual([]);
  });

  it("catálogo indisponível (C2X fora) é o 503 de sempre, sem consulta", async () => {
    sessaoPedindo("PDI");
    m.traduzir.mockResolvedValue({ erro: "catálogo fora", ok: false });

    const { corpo, status } = await carteira();

    expect(status).toBe(503);
    expect(corpo).toEqual({ error: "Não foi possível carregar as parcelas agora." });
    expect(m.pool.query).not.toHaveBeenCalled();
  });
});
