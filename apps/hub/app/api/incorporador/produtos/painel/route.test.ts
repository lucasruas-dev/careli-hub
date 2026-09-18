import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApoloEnterpriseRow, ApoloEnterpriseScenario } from "@/lib/apolo/empreendimentos";
import type { SituacaoDasUnidades, SituacaoDaUnidade } from "@/lib/hercules/situacao-da-unidade";

// OS CARDS DE ESTOQUE DO PAINEL DE PRODUTOS PELA RÉGUA ÚNICA DA SITUAÇÃO (18/09/2026).
//
// Lucas: *"estou tendo status de unidades diferentes dentro do panteon"* · *"esses status tem que
// morar em um so lugar"* · *"no c2x não precisa olhar"*. O que se trava aqui:
//   1. o balde de cada unidade sai de `lerSituacaoDasUnidades` (a reserva do Hércules conta como
//      reservado, mesmo com o cadastro dizendo disponível); quantidade e preço saem da linha;
//   2. a régua é chamada UMA vez, com todos os empreendimentos da sessão;
//   3. a linha que só o C2X conhece NÃO usa mais o `scenario` do legado (`sale_status_id`);
//   4. falha da régua zera e avisa, nunca pinta de livre.

type Linha = { enterprise_id: string; id: string; preco_tabela: number | string };

const estado = vi.hoisted(() => ({
  c2x: null as null | { data: { rows: unknown[]; totals: unknown }; ok: true },
  cadastro: null as null | { com0170: boolean; linhas: unknown[] },
  idsDaSessao: [] as string[],
  linhas: [] as Array<{ enterprise_id: string; id: string; preco_tabela: number | string }>,
  situacaoFalha: false,
  situacoes: new Map<string, string>(),
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ missing: ["C2X_DB"], ok: false }),
}));

// Um PostgREST de mentira, só para a leitura de `hercules_unidades` que a rota faz (quantidade e
// preço). Respeita o `.in("enterprise_id")` e o `.range()`, que é o que a rota usa para paginar.
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
        select: () => consulta,
      };
      return consulta;
    },
  }),
  deterministicUuid: (semente: string) => `uuid:${semente}`,
}));

vi.mock("@/lib/apolo/empreendimentos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/empreendimentos")>()),
  loadApoloEnterprises: vi.fn(async () => estado.c2x ?? { error: "fora", ok: false }),
}));

vi.mock("@/lib/apolo/incorporador/escopo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/incorporador/escopo")>()),
  idsDaSessao: vi.fn(async () => estado.idsDaSessao),
}));

vi.mock("@/lib/hercules/cadastro", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/cadastro")>()),
  lerCadastroDeEmpreendimentos: vi.fn(async () => {
    if (!estado.cadastro) throw new Error("cadastro fora");
    return estado.cadastro;
  }),
}));

vi.mock("@/lib/hercules/situacao-da-unidade", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/situacao-da-unidade")>()),
  lerSituacaoDasUnidades: vi.fn(async (): Promise<SituacaoDasUnidades> => {
    if (estado.situacaoFalha) throw new Error("supabase fora");
    const unidades = [...estado.situacoes].map(([id, situacao]) => ({
      codigo: id.toUpperCase(),
      enterpriseId: "37",
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
      enterpriseIds: estado.idsDaSessao,
      enterpriseIdsComCarteira: [],
      incorporadorId: "inc-1",
      incorporadorNome: "Gurgel",
      slug: "gurgel",
      usuarioId: "user-1",
      usuarioNome: "Coordenação",
    },
    Date.now(),
  );
  return new Request("https://c2x.app.br/api/incorporador/produtos/painel", {
    headers: new Headers({ cookie: `${INCORPORADOR_COOKIE}=${token}` }),
  });
}

function cenario(parcial: Partial<Record<keyof ApoloEnterpriseScenario, [number, number]>>): ApoloEnterpriseScenario {
  const baldes = ["total", "disponivel", "reservado", "negociacao", "vendido", "bloqueado"] as const;
  return Object.fromEntries(
    baldes.map((balde) => {
      const [units, value] = parcial[balde] ?? [0, 0];
      return [balde, { units, value }];
    }),
  ) as ApoloEnterpriseScenario;
}

/** Uma linha do C2X com o número que o LEGADO dá: tudo disponível. É o que não pode mais aparecer. */
function linhaDoC2x(id: string, code: string): ApoloEnterpriseRow {
  return {
    city: "Goiânia",
    code,
    codes: [code],
    id,
    incorporador: null,
    mirror: false,
    mirrorLabel: null,
    mirrorNote: null,
    name: `EMPREENDIMENTO ${code}`,
    scenario: cenario({ disponivel: [5, 1500], total: [5, 1500] }),
    stages: [],
    state: "GO",
  } as unknown as ApoloEnterpriseRow;
}

const linha = (id: string, enterprise_id: string, preco_tabela: number): Linha => ({ enterprise_id, id, preco_tabela });

type Corpo = {
  data: {
    avisoDaFonte: null | string;
    cards: ApoloEnterpriseScenario;
    linhas: Array<{ filhos: Array<{ id: string; scenario: ApoloEnterpriseScenario }>; id: string; scenario: ApoloEnterpriseScenario }>;
  };
};

beforeEach(() => {
  estado.c2x = null;
  estado.cadastro = null;
  estado.idsDaSessao = ["37"];
  estado.linhas = [];
  estado.situacaoFalha = false;
  estado.situacoes = new Map();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/incorporador/produtos/painel: o estoque pela régua única", () => {
  it("⚠️ o balde sai da régua, e a linha do C2X não usa mais o número do legado", async () => {
    estado.c2x = { data: { rows: [linhaDoC2x("37", "VOC")], totals: cenario({}) }, ok: true };
    estado.linhas = [
      linha("u1", "37", 100),
      linha("u2", "37", 200),
      linha("u3", "37", 300),
      linha("u4", "37", 400),
      linha("u5", "37", 500),
    ];
    estado.situacoes = new Map([
      // A reserva do Hércules: o cadastro diria disponível, a régua diz reservado.
      ["u1", "reservado"],
      ["u2", "contrato"],
      ["u3", "disponivel"],
      ["u4", "vendida"],
      // u5 ausente do mapa (nasceu entre as duas leituras): fora da oferta, nunca livre.
    ]);

    const resposta = await GET(requisicao());

    expect(resposta.status).toBe(200);
    const { data } = (await resposta.json()) as Corpo;
    const esperado = cenario({
      bloqueado: [1, 500],
      disponivel: [1, 300],
      negociacao: [1, 200],
      reservado: [1, 100],
      total: [5, 1500],
      vendido: [1, 400],
    });
    expect(data.linhas).toHaveLength(1);
    expect(data.linhas[0]?.scenario).toEqual(esperado);
    expect(data.cards).toEqual(esperado);
    expect(data.avisoDaFonte).toBeNull();
  });

  it("⚠️ a régua é chamada UMA vez, com todos os empreendimentos da sessão (o id de grupo fica de fora)", async () => {
    estado.idsDaSessao = ["37", "36", "41", "group:Lagoa Bonita", "33", "34"];

    await GET(requisicao());

    expect(vi.mocked(lerSituacaoDasUnidades)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(lerSituacaoDasUnidades).mock.calls[0]?.[1]).toEqual(["37", "36", "41", "33", "34"]);
  });

  it("pai com filhos: cada filho conta as linhas dele; o espelho antigo do pai não entra na soma", async () => {
    estado.idsDaSessao = ["35", "37", "36"];
    const doCadastro = (id: string, codigo: string, c2x: string, paiId: null | string) => ({
      c2xEnterpriseId: c2x,
      cidade: null,
      codigo,
      id,
      nome: codigo,
      operadoPor: null,
      ordem: 0,
      paiId,
      tipoProduto: "loteamento",
      uf: null,
      vendendo: true,
    });
    estado.cadastro = {
      com0170: true,
      linhas: [
        doCadastro("vo", "VLO", "35", null),
        doCadastro("voc", "VOC", "37", "vo"),
        doCadastro("vol", "VOL", "36", "vo"),
      ],
    };
    estado.linhas = [
      linha("voc-1", "37", 100),
      linha("vol-1", "36", 200),
      // A linha antiga do pai, que aponta para a viva do VOC: a régua dá a mesma situação às duas.
      linha("vlo-1", "35", 100),
    ];
    estado.situacoes = new Map([
      ["voc-1", "proposta"],
      ["vol-1", "reservado"],
      ["vlo-1", "proposta"],
    ]);

    const resposta = await GET(requisicao());

    expect(resposta.status).toBe(200);
    const { data } = (await resposta.json()) as Corpo;
    expect(data.linhas).toHaveLength(1);
    expect(data.linhas[0]?.scenario).toEqual(
      cenario({ negociacao: [1, 100], reservado: [1, 200], total: [2, 300] }),
    );
  });

  it("⚠️ régua fora do ar: números zerados e avisados, nunca o disponível do C2X", async () => {
    estado.c2x = { data: { rows: [linhaDoC2x("37", "VOC")], totals: cenario({}) }, ok: true };
    estado.linhas = [linha("u1", "37", 100)];
    estado.situacaoFalha = true;

    const resposta = await GET(requisicao());

    expect(resposta.status).toBe(200);
    const { data } = (await resposta.json()) as Corpo;
    expect(data.linhas[0]?.scenario).toEqual(cenario({}));
    expect(data.cards.disponivel.units).toBe(0);
    expect(data.avisoDaFonte).toBe(
      "Os números de estoque não carregaram agora e aparecem zerados. Tente de novo em instantes.",
    );
  });
});
