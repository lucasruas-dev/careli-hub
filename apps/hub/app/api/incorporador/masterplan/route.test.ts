import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessaoIncorporador } from "@/lib/apolo/incorporador/sessao";
import type { SituacaoDaUnidade, UnidadeComSituacao } from "@/lib/hercules/situacao-da-unidade";

// OS MAPAS ANTIGOS APOSENTADOS NO PORTAL QUE CONFECCIONA (decisão do Lucas, 16/09/2026).
//
// No Cecílio, o Espelho da aba Venda substitui o garden.html e o vale-do-ouro.html. A tela já não tem
// caminho para eles; a rota fecha também, e ANTES de ir ao C2X (nenhuma consulta para quem vai
// ouvir 404). Os outros portais seguem: a MMendes abre o Garden por aqui, e os arquivos ficam.

const mocks = vi.hoisted(() => ({
  codigosDaSessao: vi.fn(),
  createApoloAdminClient: vi.fn(),
  lerLotesDoEscopo: vi.fn(),
  lerSituacaoDasUnidades: vi.fn(),
  loadApoloEnterprises: vi.fn(),
  sessaoDoRequest: vi.fn(),
}));

vi.mock("@/lib/apolo/incorporador/sessao", () => ({ sessaoDoRequest: mocks.sessaoDoRequest }));
vi.mock("@/lib/apolo/empreendimentos", () => ({ loadApoloEnterprises: mocks.loadApoloEnterprises }));
vi.mock("@/lib/apolo/incorporador/escopo", () => ({ codigosDaSessao: mocks.codigosDaSessao }));
// Só a LEITURA do C2X é trocada: a junção com a situação e a reescrita do arquivo rodam de verdade.
vi.mock("@/lib/apolo/incorporador/masterplan-estado", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/incorporador/masterplan-estado")>()),
  lerLotesDoEscopo: mocks.lerLotesDoEscopo,
}));
vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: mocks.createApoloAdminClient }));
// Idem: a régua é a de verdade, só a leitura do Supabase é trocada.
vi.mock("@/lib/hercules/situacao-da-unidade", async (original) => ({
  ...(await original<typeof import("@/lib/hercules/situacao-da-unidade")>()),
  lerSituacaoDasUnidades: mocks.lerSituacaoDasUnidades,
}));
vi.mock("@/lib/guardian/db", () => ({ getHadesDbPool: vi.fn() }));

const { GET } = await import("./route");

function sessao(dados: Partial<SessaoIncorporador>): SessaoIncorporador {
  return {
    enterpriseIds: ["39"],
    enterpriseIdsComCarteira: [],
    exp: Date.now() + 60_000,
    incorporadorId: "inc-1",
    incorporadorNome: "Portal",
    slug: "mmendes",
    tipo: "incorporador",
    usuarioId: "u-1",
    usuarioNome: "Pessoa",
    ...dados,
  };
}

const PEDIDO = () => new Request("https://c2x.app.br/api/incorporador/masterplan?code=GDN");

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  // C2X "fora": o que se prova no portal que segue é só que ele CHEGOU a consultar.
  mocks.loadApoloEnterprises.mockResolvedValue({ error: "fora", ok: false });
});

// ── O Garden da MMendes com o C2X respondendo: o lote 1-01, e a situação dele no Panteon ──

const LOTE_1_01 = {
  atualizadoEm: 0,
  chave: "1-01",
  codigo: "GDN0101",
  comprador: "FULANO DE TAL",
  enterpriseId: "39",
  origemC2xId: "7001",
  preco: 410000,
};

function panteonDiz(situacao: SituacaoDaUnidade | null) {
  const unidade: UnidadeComSituacao | null = situacao
    ? {
        codigo: "GDN0101",
        enterpriseId: "39",
        id: "viva-1",
        lote: "01",
        origemC2xId: "7001",
        quadra: "1",
        situacao,
      }
    : null;
  mocks.lerSituacaoDasUnidades.mockResolvedValue({
    porCodigo: new Map(unidade ? [["GDN0101", unidade]] : []),
    porLinha: new Map(unidade ? [["viva-1", unidade]] : []),
    porOrigemC2x: new Map(unidade ? [["7001", unidade]] : []),
    unidades: unidade ? [unidade] : [],
  });
}

function gardenNoAr() {
  mocks.sessaoDoRequest.mockReturnValue(sessao({ slug: "mmendes" }));
  mocks.loadApoloEnterprises.mockResolvedValue({ data: { rows: [{ code: "GDN", id: 39 }] }, ok: true });
  mocks.codigosDaSessao.mockResolvedValue(["GDN"]);
  mocks.lerLotesDoEscopo.mockResolvedValue([LOTE_1_01]);
  mocks.createApoloAdminClient.mockReturnValue({ cliente: "supabase" });
}

/** A linha do lote 1-01 como saiu no `DADOS` servido: `[1,"01",situação,área,valor,"comprador",`. */
function linhaDo101(html: string): null | string {
  return html.match(/\[1,"01",\d+,[\d.]+,[\d.]+,"[^"]*",/)?.[0] ?? null;
}

describe("GET /api/incorporador/masterplan", () => {
  it("⚠️ cecilio-rocha: 404 'Masterplan não encontrado.' sem tocar no C2X", async () => {
    mocks.sessaoDoRequest.mockReturnValue(sessao({ slug: "cecilio-rocha" }));

    const resposta = await GET(PEDIDO());

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ error: "Masterplan não encontrado." });
    expect(mocks.loadApoloEnterprises).not.toHaveBeenCalled();
    expect(mocks.codigosDaSessao).not.toHaveBeenCalled();
  });

  it("mmendes segue para a conferência do escopo no C2X", async () => {
    mocks.sessaoDoRequest.mockReturnValue(sessao({ slug: "mmendes" }));

    const resposta = await GET(PEDIDO());

    expect(mocks.loadApoloEnterprises).toHaveBeenCalledTimes(1);
    expect(resposta.status).toBe(503);
  });

  it("o comercial não confecciona e também segue", async () => {
    mocks.sessaoDoRequest.mockReturnValue(sessao({ slug: "gurgel", tipo: "comercial" }));

    await GET(PEDIDO());

    expect(mocks.loadApoloEnterprises).toHaveBeenCalledTimes(1);
  });

  it("sem sessão continua 401", async () => {
    mocks.sessaoDoRequest.mockReturnValue(null);

    const resposta = await GET(PEDIDO());

    expect(resposta.status).toBe(401);
    expect(mocks.loadApoloEnterprises).not.toHaveBeenCalled();
  });
});

// A SITUAÇÃO DO LOTE VEM DA RÉGUA ÚNICA (Lucas, 18/09/2026: *"esses status tem que morar em um so
// lugar"*). O C2X segue dando o escopo, o comprador e o preço; a cor é a do Panteon.
describe("GET /api/incorporador/masterplan: a situação vem do Panteon", () => {
  it("lote reservado no Panteon sai reservado, com o nome do comprador", async () => {
    gardenNoAr();
    panteonDiz("reservado");

    const resposta = await GET(PEDIDO());

    expect(resposta.status).toBe(200);
    // O arquivo grava o 1-01 como disponível (`[1,"01",0,…]`): quem pinta agora é o Panteon.
    expect(linhaDo101(await resposta.text())).toBe('[1,"01",1,425.71,410000,"FULANO DE TAL",');
    // A régua lê pelo id do C2X do empreendimento dos lotes, que é o que `hercules_unidades` guarda.
    expect(mocks.lerSituacaoDasUnidades).toHaveBeenCalledWith({ cliente: "supabase" }, ["39"]);
  });

  it("lote livre no Panteon sai livre e sem nome, mesmo com proposta viva no legado", async () => {
    gardenNoAr();
    panteonDiz("disponivel");

    const resposta = await GET(PEDIDO());

    expect(resposta.status).toBe(200);
    expect(linhaDo101(await resposta.text())).toBe('[1,"01",0,425.71,410000,"",');
  });

  it("⚠️ lote que o Panteon não conhece NÃO sai livre (e no Garden, que não tem bloqueado, não some)", async () => {
    gardenNoAr();
    panteonDiz(null);

    const resposta = await GET(PEDIDO());

    expect(resposta.status).toBe(200);
    // O Garden tem três situações: o ocupado dele é o `2`, e sem preço nem nome.
    expect(linhaDo101(await resposta.text())).toBe('[1,"01",2,425.71,0,"",');
  });

  it("⚠️ falha ao ler a situação: 503, nunca o mapa (nem o do arquivo, nem tudo verde)", async () => {
    gardenNoAr();
    mocks.lerSituacaoDasUnidades.mockRejectedValue(new Error("supabase fora"));

    const resposta = await GET(PEDIDO());

    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual({ error: "Masterplan indisponível." });
  });

  it("sem cliente do Supabase: 503, e a régua nem é chamada", async () => {
    gardenNoAr();
    mocks.createApoloAdminClient.mockReturnValue(null);

    const resposta = await GET(PEDIDO());

    expect(resposta.status).toBe(503);
    expect(mocks.lerSituacaoDasUnidades).not.toHaveBeenCalled();
  });

  it("C2X sem lote do escopo: 503 antes de ir ao Panteon (o recorte continua fail-closed)", async () => {
    gardenNoAr();
    mocks.lerLotesDoEscopo.mockResolvedValue(null);

    const resposta = await GET(PEDIDO());

    expect(resposta.status).toBe(503);
    expect(mocks.lerSituacaoDasUnidades).not.toHaveBeenCalled();
  });
});
