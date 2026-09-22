import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SituacaoDasUnidades, SituacaoDaUnidade } from "@/lib/hercules/situacao-da-unidade";

// O ESTOQUE DOS CARDS DE PRODUTO DO PANTEON PELA RÉGUA ÚNICA DA SITUAÇÃO (18/09/2026).
//
// Lucas: *"esses status tem que morar em um so lugar"*. O card do produto do Panteon contava pela
// proposta da própria linha e, sem ela, pelo `hercules_unidades.situacao` cru; a reserva do Hércules
// e a do evento não entravam. O que se trava aqui:
//   1. o balde sai de `lerSituacaoDasUnidades`; quantidade e preço saem da linha;
//   2. a régua é chamada UMA vez, com todos os produtos do Panteon da lista;
//   3. falha da régua deixa o card sem estoque (nulo), nunca com tudo disponível.

const estado = vi.hoisted(() => ({
  linhas: [] as Array<{ enterprise_id: string; id: string; preco_tabela: number }>,
  situacaoFalha: false,
  situacoes: new Map<string, string>(),
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ missing: ["C2X_DB"], ok: false }),
}));

// Um PostgREST de mentira: `apolo_enterprise_settings` (masterplans) vazio e `hercules_unidades`
// respeitando o `.in("enterprise_id")` e o `.range()` da paginação.
vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from: (tabela: string) => {
      const filtro: { ids: null | string[] } = { ids: null };
      const consulta = {
        eq: () => consulta,
        in: (_coluna: string, ids: string[]) => {
          filtro.ids = ids;
          return consulta;
        },
        order: () => consulta,
        range: async (de: number, ate: number) => {
          if (tabela !== "hercules_unidades") return { data: [], error: null };
          const linhas = estado.linhas.filter((l) => !filtro.ids || filtro.ids.includes(l.enterprise_id));
          return { data: linhas.slice(de, ate + 1), error: null };
        },
        returns: async () => ({ data: [], error: null }),
        select: () => consulta,
      };
      return consulta;
    },
  }),
  deterministicUuid: (semente: string) => `uuid:${semente}`,
}));

vi.mock("@/lib/apolo/enterprise-logos", () => ({
  listEnterpriseLogos: async () => ({}),
}));

// C2X fora do ar, sem catálogo em cache: a sessão é 100% do Panteon, e a lista sai só com os cards
// do cadastro (a regra de `cardsSaemSemOC2x`).
vi.mock("@/lib/apolo/empreendimentos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/empreendimentos")>()),
  loadApoloEnterprises: vi.fn(async () => ({ error: "fora", ok: false })),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [],
}));

vi.mock("@/lib/hercules/cadastro", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/hercules/cadastro")>();
  const linha = (c2x: string, codigo: string) => ({
    c2xEnterpriseId: c2x,
    cidade: "Goiânia",
    codigo,
    id: codigo.toLowerCase(),
    nome: `Ed. ${codigo}`,
    operadoPor: "inc-1",
    ordem: 0,
    paiId: null,
    tipoProduto: "predio" as const,
    uf: "GO",
    vendendo: true,
  });
  return {
    ...original,
    carregarCadastroDeEmpreendimentos: async () => [linha("100001", "JAD"), linha("100002", "RUB")],
  };
});

vi.mock("@/lib/hercules/situacao-da-unidade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/situacao-da-unidade")>()),
  lerSituacaoDasUnidades: vi.fn(async (): Promise<SituacaoDasUnidades> => {
    if (estado.situacaoFalha) throw new Error("supabase fora");
    const unidades = [...estado.situacoes].map(([id, situacao]) => ({
      codigo: id.toUpperCase(),
      enterpriseId: "100001",
      id,
      lote: null,
      origemC2xId: null,
      quadra: null,
      situacao: situacao as SituacaoDaUnidade,
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
import { lerSituacaoDasUnidades } from "@/lib/hercules/situacao-da-unidade";

import { GET } from "./route";

function requisicao(): Request {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste");
  const token = criarSessaoIncorporador(
    {
      enterpriseIds: ["100001", "100002"],
      enterpriseIdsComCarteira: [],
      incorporadorId: "inc-1",
      incorporadorNome: "Cecílio Rocha",
      slug: "cecilio-rocha",
      usuarioId: "user-1",
      usuarioNome: "Time Cecílio",
    },
    Date.now(),
  );
  return new Request("https://c2x.app.br/api/incorporador/produtos", {
    headers: new Headers({ cookie: `${INCORPORADOR_COOKIE}=${token}` }),
  });
}

type Tally = { units: number; value: number };
type Corpo = {
  data: {
    produtos: Array<{ estoque: null | Record<string, Tally>; id: string }>;
  };
};

const doCard = (corpo: Corpo, id: string) => corpo.data.produtos.find((p) => p.id === id);

beforeEach(() => {
  estado.linhas = [];
  estado.situacaoFalha = false;
  estado.situacoes = new Map();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/incorporador/produtos: o estoque do card do Panteon pela régua única", () => {
  it("⚠️ o balde sai da régua, e quantidade e preço saem da linha", async () => {
    estado.linhas = [
      { enterprise_id: "100001", id: "j1", preco_tabela: 100 },
      { enterprise_id: "100001", id: "j2", preco_tabela: 200 },
      { enterprise_id: "100001", id: "j3", preco_tabela: 300 },
      { enterprise_id: "100001", id: "j4", preco_tabela: 400 },
    ];
    estado.situacoes = new Map([
      // A reserva do Hércules: o cadastro diria disponível, a régua diz reservado.
      ["j1", "reservado"],
      ["j2", "assinatura"],
      ["j3", "disponivel"],
      ["j4", "faturado"],
    ]);

    const resposta = await GET(requisicao());

    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as Corpo;
    expect(doCard(corpo, "100001")?.estoque).toEqual({
      bloqueado: { units: 0, value: 0 },
      disponivel: { units: 1, value: 300 },
      em_cancelamento: { units: 0, value: 0 },
      negociacao: { units: 1, value: 200 },
      reservado: { units: 1, value: 100 },
      total: { units: 4, value: 1000 },
      vendido: { units: 1, value: 400 },
    });
  });

  it("⚠️ a régua é chamada UMA vez, com todos os produtos do Panteon da lista", async () => {
    await GET(requisicao());

    expect(vi.mocked(lerSituacaoDasUnidades)).toHaveBeenCalledTimes(1);
    expect([...(vi.mocked(lerSituacaoDasUnidades).mock.calls[0]?.[1] ?? [])].sort()).toEqual([
      "100001",
      "100002",
    ]);
  });

  it("unidade que a régua não devolveu fica fora da oferta, nunca livre", async () => {
    estado.linhas = [{ enterprise_id: "100001", id: "j9", preco_tabela: 50 }];

    const corpo = (await (await GET(requisicao())).json()) as Corpo;

    expect(doCard(corpo, "100001")?.estoque?.bloqueado).toEqual({ units: 1, value: 50 });
    expect(doCard(corpo, "100001")?.estoque?.disponivel).toEqual({ units: 0, value: 0 });
  });

  it("⚠️ régua fora do ar: o card sai sem estoque, nunca com tudo disponível", async () => {
    estado.linhas = [{ enterprise_id: "100001", id: "j1", preco_tabela: 100 }];
    estado.situacaoFalha = true;

    const resposta = await GET(requisicao());

    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as Corpo;
    expect(doCard(corpo, "100001")?.estoque).toBeNull();
  });
});
