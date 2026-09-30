import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApoloCarteiraSummary } from "@/lib/apolo/carteira";
import { idsDoC2xDasSiglas } from "@/lib/apolo/c2x-pelo-id";
import type { EmpreendimentoDoCatalogo } from "@/lib/apolo/catalogo-empreendimentos";
import type { SessaoIncorporador } from "@/lib/apolo/incorporador/sessao";
import type { LsoftDoRecorte } from "@/lib/lsoft/carteira-no-financeiro";

// O GARDEN DO LSOFT NA CARTEIRA DO PORTAL (29/09/2026), NA ROTA DE VERDADE.
//
// Lucas: *"é só copiar e colar na carteira"* e *"esquece o c2x, cecilio não tem nenhum vinculo com o
// legado c2x"*. O que se trava aqui é a fiação da rota (a régua dos números tem teste próprio em
// lib/lsoft/carteira-no-financeiro.test.ts):
//   • no portal que vê o LSoft, com o Garden no recorte, o 39 não vai ao C2X (nem o bruto, nem o
//     líquido), o resumo soma as duas fontes e a inadimplência é recalculada sobre a soma;
//   • todo outro portal, o modo coordenador e o `?indicadores=1` ficam exatamente como eram;
//   • a falha do LSoft não derruba a carteira do C2X.
// Tudo sintético.

const m = vi.hoisted(() => ({
  bruta: vi.fn(),
  catalogo: vi.fn(),
  codigos: vi.fn(),
  idsDaSessao: vi.fn(),
  liquida: vi.fn(),
  lsoft: vi.fn(),
  sessao: null as unknown,
  traduzir: vi.fn(),
}));

vi.mock("@/lib/apolo/incorporador/escopo", () => ({
  autorizar: () => ({ ok: true, sessao: m.sessao }),
  codigosDaSessao: m.codigos,
  idsDaSessao: m.idsDaSessao,
}));
vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({ catalogoDeEmpreendimentos: m.catalogo }));
vi.mock("@/lib/hercules/cadastro", () => ({ carregarCadastroDeEmpreendimentos: async () => [] }));
vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => null }));
vi.mock("@/lib/apolo/carteira", () => ({ loadApoloEnterpriseCarteiraPorIds: m.bruta }));
vi.mock("@/lib/apolo/incorporador/carteira-liquida", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/incorporador/carteira-liquida")>()),
  carteiraLiquidaDoIncorporador: m.liquida,
}));
vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ ok: true, pool: { query: async () => [[]] } }),
}));
vi.mock("@/lib/apolo/c2x-pelo-id-servidor", () => ({ idsDoC2xDasSiglasAoVivo: m.traduzir }));
// Só a LEITURA do LSoft é trocada: o recorte (`recorteDoLsoft`) e a soma (`juntarNaCarteira`) são os
// de verdade, que é o que esta rota precisa provar que usa.
vi.mock("@/lib/lsoft/carteira-no-financeiro", async (original) => ({
  ...(await original<typeof import("@/lib/lsoft/carteira-no-financeiro")>()),
  carteiraDoLsoftNoRecorte: m.lsoft,
}));

const { GET } = await import("./route");

const CATALOGO: EmpreendimentoDoCatalogo[] = [
  { codes: ["GDN"], id: "39", name: "GARDEN", stageIds: ["39"] },
  { codes: ["VOC"], id: "37", name: "VALE DO OURO", stageIds: ["37"] },
];

// ⚠️ O SLUG É O `cecilio-rocha`, o caso real: é o único portal com o Garden (39) no escopo. O `cer`
// também vê a base do LSoft, mas tem só o VOC (medido em 29/09/2026).
const sessao = (parcial: Partial<SessaoIncorporador> = {}): SessaoIncorporador => ({
  enterpriseIds: ["37", "39"],
  enterpriseIdsComCarteira: ["37", "39"],
  exp: Date.now() + 60_000,
  incorporadorId: "inc-1",
  incorporadorNome: "Loteadora Teste",
  slug: "cecilio-rocha",
  tipo: "incorporador",
  usuarioId: "u-1",
  usuarioNome: "Usuária Teste",
  ...parcial,
});

const resumo = (parcial: Partial<ApoloCarteiraSummary>): ApoloCarteiraSummary => ({
  clients: 0,
  contracts: 0,
  criticalContracts: 0,
  delinquencyRate: 0,
  expectedToDate: 0,
  overdueAmount: 0,
  overdueClients: 0,
  overdueInstallments: 0,
  paidAmount: 0,
  recoveryAmount: 0,
  toReceiveAmount: 0,
  totalPortfolio: 0,
  ...parcial,
});

// O C2X: 100 vencidos sobre 1.000 previstos (10%).
const RESUMO_C2X = resumo({
  clients: 1,
  contracts: 1,
  delinquencyRate: 0.1,
  expectedToDate: 1000,
  overdueAmount: 100,
  overdueClients: 1,
  overdueInstallments: 1,
  paidAmount: 900,
  totalPortfolio: 5000,
});

const UNIDADE_C2X = {
  block: "01",
  client: { entityId: "e-1", name: "Comprador C2X" },
  code: "VOC0101",
  contractCode: "10",
  contractDocumentId: null,
  enterpriseCode: "VOC",
  enterpriseName: "VALE DO OURO",
  faturadoAt: null,
  id: "501",
  imobiliaria: null,
  lot: "01",
  maxOverdueDays: 5,
  overdueAmount: 100,
  overdueInstallments: 1,
  paidAmount: 900,
  pedidoId: "5001",
  toReceiveAmount: 4000,
  totalContract: 5000,
};

// O LSoft: 0 vencido sobre 9.000 previstos (0%). Somado, o certo é 100 / 10.000 = 1%.
const DO_LSOFT: LsoftDoRecorte = {
  aviso: null,
  carteira: {
    summary: resumo({
      clients: 1,
      contracts: 1,
      expectedToDate: 9000,
      paidAmount: 9000,
      toReceiveAmount: 21_000,
      totalPortfolio: 30_000,
    }),
    units: [
      {
        avisos: [],
        block: "06",
        client: "Comprador LSoft",
        code: "GDN0614",
        contractCode: null,
        empreendimento: "Garden",
        faturadoAt: null,
        id: "lsoft:C1",
        imobiliaria: null,
        liquido: null,
        lot: "14",
        lsoftCodigo: "C1",
        maxOverdueDays: 0,
        origem: "lsoft",
        overdueAmount: 0,
        overdueInstallments: 0,
        paidAmount: 9000,
        temContrato: false,
        toReceiveAmount: 21_000,
        totalContract: 30_000,
      },
    ],
  },
  empreendimentos: ["Garden"],
};

type Corpo = {
  data: {
    avisoDoC2x?: string;
    bruto: ApoloCarteiraSummary;
    lsoft?: { aviso: null | string; empreendimentos: string[]; unidades: number };
    unidades: number;
    units: Array<{ code: string; lsoftCodigo?: string; origem?: string }>;
  };
};

async function carteira(consulta = ""): Promise<{ corpo: Corpo; status: number }> {
  const resposta = await GET(new Request(`https://c2x.app.br/api/incorporador/carteira${consulta}`));
  return { corpo: (await resposta.json()) as Corpo, status: resposta.status };
}

beforeEach(() => {
  for (const mock of [m.bruta, m.catalogo, m.codigos, m.idsDaSessao, m.liquida, m.lsoft, m.traduzir]) {
    mock.mockReset();
  }
  m.sessao = sessao();
  m.catalogo.mockResolvedValue(CATALOGO);
  m.codigos.mockResolvedValue(["GDN", "VOC"]);
  m.idsDaSessao.mockResolvedValue(["37", "39"]);
  m.bruta.mockResolvedValue({ data: { summary: RESUMO_C2X, units: [UNIDADE_C2X] }, ok: true });
  m.liquida.mockResolvedValue({ error: "fora do teste", ok: false });
  m.lsoft.mockResolvedValue(DO_LSOFT);
  m.traduzir.mockImplementation(
    async (
      siglas: Iterable<unknown>,
      opcoes: { catalogo?: EmpreendimentoDoCatalogo[]; excluir?: readonly number[] } = {},
    ) => ({ ok: true, ...idsDoC2xDasSiglas(siglas, { catalogo: opcoes.catalogo ?? [] }, opcoes) }),
  );
});

describe("GET /api/incorporador/carteira: o Garden do LSoft no portal que vê o LSoft", () => {
  it("🔴 o 39 não vai ao C2X: nem o bruto, nem o líquido", async () => {
    const { status } = await carteira();

    expect(status).toBe(200);
    expect(m.bruta).toHaveBeenCalledWith([37]);
    expect(m.liquida).toHaveBeenCalledWith(expect.objectContaining({ codes: ["VOC"] }));
    expect(m.lsoft).toHaveBeenCalledTimes(1);
    const [entrada] = m.lsoft.mock.calls[0] as [{ hoje: string; noRecorte: Array<{ codes: string[] }> }];
    expect(entrada.noRecorte.map((item) => item.codes)).toEqual([["GDN"]]);
    expect(entrada.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("🔴 o resumo soma as duas fontes e RECALCULA a inadimplência (1%, e não a média de 5%)", async () => {
    const { corpo } = await carteira();

    expect(corpo.data.bruto).toMatchObject({
      clients: 2,
      contracts: 2,
      expectedToDate: 10_000,
      overdueAmount: 100,
      paidAmount: 9900,
      totalPortfolio: 35_000,
    });
    expect(corpo.data.bruto.delinquencyRate).toBeCloseTo(0.01, 10);
  });

  it("as unidades do LSoft vêm depois das do C2X, com a origem e o código do cliente", async () => {
    const { corpo } = await carteira();

    expect(corpo.data.units.map((u) => u.code)).toEqual(["VOC0101", "GDN0614"]);
    expect(corpo.data.units[1]).toMatchObject({ lsoftCodigo: "C1", origem: "lsoft" });
    expect(corpo.data.units[0]).not.toHaveProperty("origem");
    expect(corpo.data.unidades).toBe(2);
    expect(corpo.data.lsoft).toEqual({ aviso: null, empreendimentos: ["Garden"], unidades: 1 });
  });

  it("🔴 a falha do LSoft não derruba a carteira do C2X: sai sem o Garden e com o aviso", async () => {
    m.lsoft.mockResolvedValue({
      aviso: "Não foi possível ler a carteira do Garden agora.",
      carteira: { summary: resumo({}), units: [] },
      empreendimentos: ["Garden"],
    } satisfies LsoftDoRecorte);

    const { corpo, status } = await carteira();

    expect(status).toBe(200);
    expect(corpo.data.units.map((u) => u.code)).toEqual(["VOC0101"]);
    expect(corpo.data.bruto).toMatchObject({ overdueAmount: 100, totalPortfolio: 5000 });
    expect(corpo.data.bruto.delinquencyRate).toBeCloseTo(0.1, 10);
    expect(corpo.data.lsoft?.aviso).toBe("Não foi possível ler a carteira do Garden agora.");
    expect(corpo.data).not.toHaveProperty("avisoDoC2x");
  });

  it("🔴 e o contrário: o C2X fora não joga fora o Garden já lido; sai só ele, com o aviso do C2X", async () => {
    m.bruta.mockRejectedValue(new Error("connect ETIMEDOUT"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { corpo, status } = await carteira();

    expect(status).toBe(200);
    expect(corpo.data.units.map((u) => u.code)).toEqual(["GDN0614"]);
    // O resumo é SÓ o do Garden: a parte do C2X não entra zerada calada, entra como aviso.
    expect(corpo.data.bruto).toMatchObject({ clients: 1, overdueAmount: 0, totalPortfolio: 30_000 });
    expect(corpo.data.avisoDoC2x).toBe(
      "Não foi possível ler a carteira do Vale do Ouro agora. Ela ficou fora desta tela; tente de novo em alguns minutos.",
    );
    // A mensagem do MySQL fica no log e não chega ao cliente externo.
    expect(JSON.stringify(corpo)).not.toContain("ETIMEDOUT");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("C2X fora e nenhuma unidade do LSoft (a 0199 ainda não aplicada): o 503 de sempre", async () => {
    m.bruta.mockResolvedValue({ error: "mysql fora", ok: false });
    m.lsoft.mockResolvedValue({
      aviso: null,
      carteira: { summary: resumo({}), units: [] },
      empreendimentos: ["Garden"],
    } satisfies LsoftDoRecorte);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { status } = await carteira();

    expect(status).toBe(503);
    log.mockRestore();
  });
});

describe("GET /api/incorporador/carteira: o que NÃO muda", () => {
  it("portal que não vê o LSoft: o 39 continua indo ao C2X e o LSoft nem é lido", async () => {
    m.sessao = sessao({ slug: "vista-alegre" });

    const { corpo } = await carteira();

    expect(m.bruta).toHaveBeenCalledWith([37, 39]);
    expect(m.liquida).toHaveBeenCalledWith(expect.objectContaining({ codes: ["GDN", "VOC"] }));
    expect(m.lsoft).not.toHaveBeenCalled();
    expect(corpo.data).not.toHaveProperty("lsoft");
    expect(corpo.data.bruto).toEqual(RESUMO_C2X);
  });

  it("portal que não vê o LSoft com o C2X fora: o 503 de sempre, sem LSoft nenhum", async () => {
    m.sessao = sessao({ slug: "vista-alegre" });
    m.bruta.mockResolvedValue({ error: "mysql fora", ok: false });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { status } = await carteira();

    expect(status).toBe(503);
    expect(m.lsoft).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("modo coordenador (sessão comercial), mesmo no slug do Cecílio: nada do LSoft", async () => {
    m.sessao = sessao({ tipo: "comercial" });

    const { corpo } = await carteira();

    expect(m.bruta).toHaveBeenCalledWith([37, 39]);
    expect(m.lsoft).not.toHaveBeenCalled();
    expect(corpo.data).not.toHaveProperty("lsoft");
  });

  it("`?indicadores=1`: os KPIs continuam só do C2X, e o LSoft nem é lido", async () => {
    await carteira("?indicadores=1");

    expect(m.bruta).toHaveBeenCalledWith([37, 39]);
    expect(m.liquida).toHaveBeenCalledWith(expect.objectContaining({ codes: ["GDN", "VOC"] }));
    expect(m.lsoft).not.toHaveBeenCalled();
  });

  it("recorte sem o Garden no portal que vê o LSoft: ids e siglas de sempre", async () => {
    m.codigos.mockResolvedValue(["VOC"]);
    m.idsDaSessao.mockResolvedValue(["37"]);

    const { corpo } = await carteira();

    expect(m.bruta).toHaveBeenCalledWith([37]);
    expect(m.lsoft).not.toHaveBeenCalled();
    expect(corpo.data).not.toHaveProperty("lsoft");
  });
});
