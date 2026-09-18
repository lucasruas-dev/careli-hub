import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SituacaoDasUnidades, SituacaoDaUnidade } from "@/lib/hercules/situacao-da-unidade";

// O FUNIL DO RESUMO PELA RÉGUA ÚNICA DA SITUAÇÃO (18/09/2026).
//
// Lucas: *"esses status tem que morar em um so lugar"* · *"no c2x não precisa olhar"*. O funil da
// ficha (reservas, propostas, em contrato, em assinatura, vendidas) contava o estágio da última
// proposta do C2X; a reserva do Hércules e a do evento não entravam. O que se trava aqui:
//   1. cada unidade entra no estágio da situação que `lerSituacaoDasUnidades` deu a ela;
//   2. o C2X não é consultado para o funil;
//   3. o recorte continua sendo o dos CÓDIGOS (a gleba aberta pela linha do grupo conta);
//   4. falha da régua é 503, nunca um funil zerado.

const estado = vi.hoisted(() => ({
  situacoes: [] as Array<{ id: string; situacao: string }>,
  situacaoFalha: false,
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: vi.fn(() => ({ missing: ["C2X_DB"], ok: false })),
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({}),
  deterministicUuid: (semente: string) => `uuid:${semente}`,
  fetchC2xCadastroByEntity: vi.fn(),
}));

vi.mock("@/lib/prometeu/data", () => ({
  createPrometeuClient: () => null,
  eventoOperavelId: vi.fn(),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { codes: ["VOC"], id: "37", name: "VALE DO OURO", stageIds: ["37"] },
    { codes: ["LBF", "LBR", "LBP"], id: "group:Lagoa Bonita", name: "LAGOA BONITA", stageIds: ["33", "34", "38"] },
  ],
}));

vi.mock("@/lib/hercules/cadastro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/cadastro")>()),
  carregarCadastroDeEmpreendimentos: async () => [],
}));

vi.mock("@/lib/apolo/vendas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/vendas")>()),
  loadApoloEnterpriseVendas: vi.fn(async () => ({ data: { units: [] }, ok: true })),
}));

vi.mock("@/lib/apolo/incorporador/crm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/incorporador/crm")>()),
  lerEsteiraDoEscopo: vi.fn(async () => ({ linhas: [], ok: true })),
  lerImobiliariasVinculadas: vi.fn(async () => ({ credenciadas: [], ok: true })),
}));

vi.mock("@/lib/hercules/situacao-da-unidade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/situacao-da-unidade")>()),
  lerSituacaoDasUnidades: vi.fn(async (): Promise<SituacaoDasUnidades> => {
    if (estado.situacaoFalha) throw new Error("supabase fora");
    const unidades = estado.situacoes.map((u) => ({
      codigo: u.id.toUpperCase(),
      enterpriseId: "37",
      id: u.id,
      lote: null,
      origemC2xId: null,
      quadra: null,
      situacao: u.situacao as SituacaoDaUnidade,
    }));
    return {
      porCodigo: new Map(unidades.map((u) => [u.codigo, u])),
      porLinha: new Map(unidades.map((u) => [u.id, u])),
      porOrigemC2x: new Map(),
      terreno: () => undefined,
      unidades,
    };
  }),
}));

import { criarSessaoIncorporador, INCORPORADOR_COOKIE } from "@/lib/apolo/incorporador/sessao";
import { loadApoloEnterpriseVendas } from "@/lib/apolo/vendas";
import { getHadesDbPool } from "@/lib/guardian/db";
import { lerSituacaoDasUnidades } from "@/lib/hercules/situacao-da-unidade";

import { GET } from "./route";

function requisicao(emp: null | string, enterpriseIds: string[] = ["37"]): Request {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste");
  const token = criarSessaoIncorporador(
    {
      enterpriseIds,
      enterpriseIdsComCarteira: [],
      incorporadorId: "inc-1",
      incorporadorNome: "Gurgel",
      slug: "gurgel",
      usuarioId: "user-1",
      usuarioNome: "Coordenação",
    },
    Date.now(),
  );
  const consulta = emp === null ? "" : `?emp=${encodeURIComponent(emp)}`;
  return new Request(`https://c2x.app.br/api/incorporador/produto/resumo${consulta}`, {
    headers: new Headers({ cookie: `${INCORPORADOR_COOKIE}=${token}` }),
  });
}

type Processo = {
  emAssinatura: number;
  emContrato: number;
  propostas: number;
  reservas: number;
  vendidas: number;
};

beforeEach(() => {
  estado.situacoes = [];
  estado.situacaoFalha = false;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/incorporador/produto/resumo: o funil pela régua única", () => {
  it("⚠️ cada unidade entra no estágio da situação da régua, e o C2X não é consultado", async () => {
    estado.situacoes = [
      { id: "u1", situacao: "disponivel" },
      // A reserva do Hércules ou do evento: o C2X não a conhecia, e o funil a perdia.
      { id: "u2", situacao: "reservado" },
      { id: "u3", situacao: "reservada" },
      { id: "u4", situacao: "proposta" },
      { id: "u5", situacao: "contrato" },
      { id: "u6", situacao: "assinatura" },
      { id: "u7", situacao: "faturado" },
      // Vendida sem proposta viva é venda que acabou.
      { id: "u8", situacao: "vendida" },
      // Bloqueada não é venda, e não aparece em lugar nenhum da faixa.
      { id: "u9", situacao: "bloqueada" },
    ];

    const resposta = await GET(requisicao("37"));

    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as { data: { processo: Processo } };
    expect(corpo.data.processo).toMatchObject({
      emAssinatura: 1,
      emContrato: 1,
      propostas: 1,
      reservas: 2,
      vendidas: 2,
    });
    expect(vi.mocked(lerSituacaoDasUnidades)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(lerSituacaoDasUnidades).mock.calls[0]?.[1]).toEqual(["37"]);
    expect(vi.mocked(loadApoloEnterpriseVendas)).not.toHaveBeenCalled();
    expect(vi.mocked(getHadesDbPool)).not.toHaveBeenCalled();
  });

  it("⚠️ a gleba aberta pela linha do GRUPO conta pelo código dela, mesmo sem o grupo na sessão", async () => {
    // Sessão só com o LBF ("33"): `enterpriseIds` sai vazio para o pedido "group:…", mas o funil
    // é o do código LBF, como sempre foi.
    const resposta = await GET(requisicao("group:Lagoa Bonita", ["33"]));

    expect(resposta.status).toBe(200);
    expect(vi.mocked(lerSituacaoDasUnidades).mock.calls.at(-1)?.[1]).toEqual(["33"]);
  });

  it("a visão consolidada chama a régua uma vez só, com todos os produtos", async () => {
    const resposta = await GET(requisicao(null, ["37", "33"]));

    expect(resposta.status).toBe(200);
    expect(vi.mocked(lerSituacaoDasUnidades)).toHaveBeenCalledTimes(1);
    expect([...(vi.mocked(lerSituacaoDasUnidades).mock.calls[0]?.[1] ?? [])].sort()).toEqual(["33", "37"]);
  });

  it("⚠️ falha da régua é 503, nunca um funil zerado", async () => {
    estado.situacaoFalha = true;

    const resposta = await GET(requisicao("37"));

    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual({ error: "Não foi possível carregar o resumo agora." });
  });
});
