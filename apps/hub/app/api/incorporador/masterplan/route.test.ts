import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessaoIncorporador } from "@/lib/apolo/incorporador/sessao";

// OS MAPAS ANTIGOS APOSENTADOS NO PORTAL QUE CONFECCIONA (decisão do Lucas, 16/09/2026).
//
// No Cecílio, o Espelho da aba Venda substitui o garden.html e o vale-do-ouro.html. A tela já não tem
// caminho para eles; a rota fecha também, e ANTES de ir ao C2X (nenhuma consulta para quem vai
// ouvir 404). Os outros portais seguem: a MMendes abre o Garden por aqui, e os arquivos ficam.

const mocks = vi.hoisted(() => ({
  codigosDaSessao: vi.fn(),
  loadApoloEnterprises: vi.fn(),
  sessaoDoRequest: vi.fn(),
}));

vi.mock("@/lib/apolo/incorporador/sessao", () => ({ sessaoDoRequest: mocks.sessaoDoRequest }));
vi.mock("@/lib/apolo/empreendimentos", () => ({ loadApoloEnterprises: mocks.loadApoloEnterprises }));
vi.mock("@/lib/apolo/incorporador/escopo", () => ({ codigosDaSessao: mocks.codigosDaSessao }));
vi.mock("@/lib/apolo/incorporador/masterplan-estado", () => ({
  aplicarEstadoAtual: vi.fn(),
  lerEstadoDosLotes: vi.fn(),
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
  mocks.codigosDaSessao.mockReset();
  mocks.loadApoloEnterprises.mockReset();
  mocks.sessaoDoRequest.mockReset();
  // C2X "fora": o que se prova no portal que segue é só que ele CHEGOU a consultar.
  mocks.loadApoloEnterprises.mockResolvedValue({ error: "fora", ok: false });
});

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
