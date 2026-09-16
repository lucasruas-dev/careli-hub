import { beforeEach, describe, expect, it, vi } from "vitest";

// O PRODUTO QUE SÓ EXISTE NO PANTEON, NAS ROTAS DA FICHA — produto/resumo, produto/unidades,
// produto/links, produto/imobiliarias e vendas/assinaturas.
//
// ⚠️ O DEFEITO: a tradução id → código passa pelo catálogo do C2X, e o empreendimento nascido no
// Panteon (ZZ TESTE, id 9001) não está lá. Só a rota /venda somava os próprios (`soDoPanteon`); as
// da ficha respondiam "Nao encontrado." para um produto que É da sessão. Aqui cada rota é chamada
// de verdade, com as fontes mockadas, nos três lados da regra:
//   • o produto do Panteon da sessão RESPONDE (pelo id numérico e pelo pai do cadastro), e o
//     código dele chega à leitura;
//   • o produto do Panteon de OUTRA sessão continua 404 (é tradução, não permissão);
//   • com o cadastro fora do ar, o produto do C2X segue respondendo e o do Panteon dá 503 — nunca
//     um 404 que diria "não é seu";
//   • (16/09/2026) o produto só do Panteon não vai ao C2X nem nas Imobiliárias nem nos Contratos, e o
//     produto COM DONO marcado (o Garden da Cecílio, D2) lê Unidades e Resumo do Panteon.

const estado = vi.hoisted(() => ({
  cadastroFora: false,
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // `after` exige o escopo de uma requisição do Next; aqui só importa que a rota responda.
  after: vi.fn(),
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ missing: ["C2X_DB"], ok: false }),
}));

vi.mock("@/lib/guardian/d4sign-consulta", () => ({
  aquecerD4SignEmSegundoPlano: vi.fn(),
}));

vi.mock("@/lib/apolo/server", () => ({
  // Um cliente qualquer: as leituras que o usariam estão mockadas abaixo.
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
    { codes: ["GDN"], id: "39", name: "GARDEN", stageIds: ["39"] },
  ],
}));

vi.mock("@/lib/hercules/cadastro", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/hercules/cadastro")>();
  const linha = (c2x: string, codigo: string, operadoPor: null | string = null) => ({
    c2xEnterpriseId: c2x,
    cidade: null,
    codigo,
    id: codigo.toLowerCase(),
    nome: codigo,
    operadoPor,
    ordem: 0,
    paiId: null,
    uf: null,
    vendendo: true,
  });
  return {
    ...original,
    carregarCadastroDeEmpreendimentos: async () => {
      if (estado.cadastroFora) throw new Error("supabase fora");
      // O Garden tem dono marcado (D2): o estoque dele é mantido no Panteon.
      return [linha("37", "VOC"), linha("39", "GDN", "inc-1"), linha("9001", "TST"), linha("9002", "OUT")];
    },
  };
});

vi.mock("@/lib/apolo/vendas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/vendas")>()),
  loadApoloEnterpriseVendas: vi.fn(async () => ({ data: { units: [] }, ok: true })),
}));

vi.mock("@/lib/apolo/empreendimentos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/empreendimentos")>()),
  loadApoloEnterpriseUnits: vi.fn(async () => ({ ok: true, units: [] })),
}));

vi.mock("@/lib/apolo/incorporador/crm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/incorporador/crm")>()),
  lerEsteiraDoEscopo: vi.fn(async () => ({ linhas: [], ok: true })),
  lerImobiliariasVinculadas: vi.fn(async () => ({ credenciadas: [], ok: true })),
}));

vi.mock("@/lib/apolo/incorporador/imobiliarias-do-produto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/incorporador/imobiliarias-do-produto")>()),
  lerNomesDasEntidades: vi.fn(async () => new Map()),
  lerPropostasVivasDoPanteon: vi.fn(async () => ({ ok: true, propostas: [] })),
}));

vi.mock("@/lib/hercules/masterplan-do-empreendimento", () => ({
  topoDaArvoreDeAlgum: vi.fn(async () => null),
}));

// (16/09/2026, revisão) O produto do Panteon lê as unidades do Panteon. A leitura é mockada; o
// conversor (`unidadeDoPanteonNaTela`) é o de verdade.
vi.mock("@/lib/apolo/incorporador/unidades-do-panteon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/incorporador/unidades-do-panteon")>()),
  lerUnidadesDoPanteon: vi.fn(async (_admin: unknown, ids: readonly string[]) => [
    ...(ids.includes("9001")
      ? [
          {
            area: "300",
            codigo: "TST0101",
            enterprise_id: "9001",
            espelho_de: null,
            id: "u-tst-1",
            lote: "01",
            preco_tabela: "150000",
            quadra: "01",
            situacao: "reservada",
          },
        ]
      : []),
    ...(ids.includes("39")
      ? [
          {
            area: "360",
            codigo: "GDN0101",
            enterprise_id: "39",
            espelho_de: null,
            id: "u-gdn-1",
            lote: "01",
            matricula: "45.678",
            preco_tabela: "210000",
            quadra: "01",
            situacao: "disponivel",
          },
        ]
      : []),
  ]),
}));

vi.mock("@/lib/apolo/incorporador/assinaturas", () => ({
  lerAssinaturasDoPanteon: vi.fn(async () => ({ linhas: [], ok: true })),
  lerAssinaturasDoPortal: vi.fn(async () => ({
    data: { avisoDaFonte: null, cancelados: [], resumoDaFonte: null, unidades: [] },
    ok: true,
    uuids: [],
  })),
  somarAssinaturasDoPanteon: (quadro: unknown) => quadro,
}));

import { loadApoloEnterpriseUnits } from "@/lib/apolo/empreendimentos";
import { lerAssinaturasDoPanteon, lerAssinaturasDoPortal } from "@/lib/apolo/incorporador/assinaturas";
import { lerEsteiraDoEscopo } from "@/lib/apolo/incorporador/crm";
import { lerPropostasVivasDoPanteon } from "@/lib/apolo/incorporador/imobiliarias-do-produto";
import { lerUnidadesDoPanteon } from "@/lib/apolo/incorporador/unidades-do-panteon";
import { criarSessaoIncorporador, INCORPORADOR_COOKIE } from "@/lib/apolo/incorporador/sessao";
import { loadApoloEnterpriseVendas } from "@/lib/apolo/vendas";
import { topoDaArvoreDeAlgum } from "@/lib/hercules/masterplan-do-empreendimento";

import { GET as getAssinaturas } from "../vendas/assinaturas/route";
import { GET as getImobiliarias } from "./imobiliarias/route";
import { GET as getLinks } from "./links/route";
import { GET as getResumo } from "./resumo/route";
import { GET as getUnidades } from "./unidades/route";

function requisicao(caminho: string, emp: string, enterpriseIds: string[] = ["37", "9001"]): Request {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste");
  const token = criarSessaoIncorporador(
    {
      // Por padrão, o VOC do C2X e o ZZ TESTE, que só existe no Panteon.
      enterpriseIds,
      enterpriseIdsComCarteira: ["37"],
      incorporadorId: "inc-1",
      incorporadorNome: "Cecílio Rocha",
      slug: "cecilio-rocha",
      usuarioId: "user-1",
      usuarioNome: "Time Cecílio",
    },
    Date.now(),
  );
  const headers = new Headers({ cookie: `${INCORPORADOR_COOKIE}=${token}` });
  return new Request(
    `https://c2x.app.br/api/incorporador/${caminho}?emp=${encodeURIComponent(emp)}`,
    { headers },
  );
}

/** O produto do Panteon é lido por ID em `hercules_unidades`; o teste fala em código. */
const CODIGO_DO_ID: Record<string, string> = { "9001": "TST" };
const lidosDoPanteon = (): string[] =>
  [...(vi.mocked(lerUnidadesDoPanteon).mock.calls.at(-1)?.[1] ?? [])].map(
    (id) => CODIGO_DO_ID[id] ?? id,
  );

/**
 * Os códigos que a leitura de cada rota recebeu na última chamada. Em Resumo e Unidades, a soma do
 * que foi ao C2X com o que foi ao Panteon (desde 16/09/2026 o produto próprio não vai ao C2X).
 */
const ROTAS = [
  {
    caminho: "produto/resumo",
    get: getResumo,
    lidos: () => [
      ...(vi.mocked(loadApoloEnterpriseVendas).mock.calls.at(-1)?.[0] ?? []),
      ...lidosDoPanteon(),
    ],
  },
  {
    caminho: "produto/unidades",
    get: getUnidades,
    lidos: () => [
      ...(vi.mocked(loadApoloEnterpriseUnits).mock.calls.at(-1)?.[0] ?? []),
      ...lidosDoPanteon(),
    ],
  },
  {
    caminho: "produto/links",
    get: getLinks,
    lidos: () => vi.mocked(topoDaArvoreDeAlgum).mock.calls.at(-1)?.[1],
  },
  {
    caminho: "produto/imobiliarias",
    get: getImobiliarias,
    // Desde 16/09/2026 o código só do Panteon conta as vendas em `hercules_propostas`, não no C2X.
    lidos: () => [
      ...(vi.mocked(loadApoloEnterpriseVendas).mock.calls.at(-1)?.[0] ?? []),
      ...(vi.mocked(lerPropostasVivasDoPanteon).mock.calls.at(-1)?.[1] ?? []),
    ],
  },
  {
    caminho: "vendas/assinaturas",
    get: getAssinaturas,
    // E os contratos dele saem de `hercules_propostas` + `temis_envelopes`, não do C2X/D4Sign.
    lidos: () => [
      ...(vi.mocked(lerAssinaturasDoPortal).mock.calls.at(-1)?.[0] ?? []),
      ...(vi.mocked(lerAssinaturasDoPanteon).mock.calls.at(-1)?.[1] ?? []),
    ],
  },
] as const;

beforeEach(() => {
  estado.cadastroFora = false;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe.each(ROTAS)("GET /api/incorporador/$caminho", ({ caminho, get, lidos }) => {
  it("⚠️ o produto que só existe no Panteon responde pelo id numérico, e o código chega à leitura", async () => {
    const resposta = await get(requisicao(caminho, "9001"));
    expect(resposta.status).toBe(200);
    expect(lidos()).toEqual(["TST"]);
  });

  it("⚠️ e pelo pai do cadastro", async () => {
    const resposta = await get(requisicao(caminho, "pai:tst"));
    expect(resposta.status).toBe(200);
    expect(lidos()).toEqual(["TST"]);
  });

  it("o produto do C2X segue como era", async () => {
    const resposta = await get(requisicao(caminho, "37"));
    expect(resposta.status).toBe(200);
    expect(lidos()).toEqual(["VOC"]);
  });

  it("⚠️ continua fail-closed: produto do Panteon de OUTRA sessão e do C2X fora do escopo são 404", async () => {
    for (const emp of ["9002", "pai:out", "39"]) {
      const resposta = await get(requisicao(caminho, emp));
      expect(resposta.status).toBe(404);
    }
  });

  it("cadastro fora do ar: o produto do C2X não cai junto", async () => {
    estado.cadastroFora = true;
    const resposta = await get(requisicao(caminho, "37"));
    expect(resposta.status).toBe(200);
  });

  it("⚠️ cadastro fora do ar: o do Panteon e o pai dão 503, nunca 404", async () => {
    estado.cadastroFora = true;
    for (const emp of ["9001", "pai:tst"]) {
      const resposta = await get(requisicao(caminho, emp));
      expect(resposta.status).toBe(503);
    }
  });
});

describe("os ids do Apolo acompanham o produto do Panteon", () => {
  it("o Resumo lê a esteira pelo id que o cadastro guarda", async () => {
    await getResumo(requisicao("produto/resumo", "9001"));
    expect(vi.mocked(lerEsteiraDoEscopo).mock.calls.at(-1)?.[1]).toEqual(["9001"]);
  });

  it("⚠️ e também quando o pedido é o CÓDIGO do produto (caminho do id do catálogo)", async () => {
    const resposta = await getImobiliarias(requisicao("produto/imobiliarias", "TST"));
    expect(resposta.status).toBe(200);
    expect(vi.mocked(lerEsteiraDoEscopo).mock.calls.at(-1)?.[1]).toEqual(["9001"]);
  });
});

describe("as unidades do produto do Panteon (revisão de 16/09/2026)", () => {
  it("⚠️ Unidades mostra o estoque de hercules_unidades, sem ir ao C2X", async () => {
    const resposta = await getUnidades(requisicao("produto/unidades", "9001"));
    expect(resposta.status).toBe(200);
    expect(vi.mocked(loadApoloEnterpriseUnits)).not.toHaveBeenCalled();
    const corpo = (await resposta.json()) as {
      data: { units: Array<{ bucket: string; code: string; enterpriseCode: string; price: number }> };
    };
    expect(corpo.data.units).toEqual([
      expect.objectContaining({ bucket: "reservado", code: "TST0101", enterpriseCode: "TST", price: 150000 }),
    ]);
  });

  it("o Resumo conta a reserva do Panteon no funil, sem ir ao C2X", async () => {
    const resposta = await getResumo(requisicao("produto/resumo", "9001"));
    expect(resposta.status).toBe(200);
    expect(vi.mocked(loadApoloEnterpriseVendas)).not.toHaveBeenCalled();
    const corpo = (await resposta.json()) as { data: { processo: { reservas: number } } };
    expect(corpo.data.processo.reservas).toBe(1);
  });

  it("produto do C2X não lê o Panteon", async () => {
    await getUnidades(requisicao("produto/unidades", "37"));
    expect(vi.mocked(lerUnidadesDoPanteon)).not.toHaveBeenCalled();
  });
});

describe("o produto só do Panteon não vai ao C2X nas Imobiliárias nem nos Contratos (16/09/2026)", () => {
  it("⚠️ Imobiliárias conta as vendas do código só do Panteon em hercules_propostas", async () => {
    const resposta = await getImobiliarias(requisicao("produto/imobiliarias", "9001"));
    expect(resposta.status).toBe(200);
    expect(vi.mocked(loadApoloEnterpriseVendas)).not.toHaveBeenCalled();
    expect(vi.mocked(lerPropostasVivasDoPanteon).mock.calls.at(-1)?.[1]).toEqual(["TST"]);
  });

  it("⚠️ Contratos não manda o código só do Panteon ao C2X/D4Sign", async () => {
    const resposta = await getAssinaturas(requisicao("vendas/assinaturas", "9001"));
    expect(resposta.status).toBe(200);
    expect(vi.mocked(lerAssinaturasDoPortal).mock.calls.at(-1)?.[0]).toEqual([]);
    expect(vi.mocked(lerAssinaturasDoPanteon).mock.calls.at(-1)?.[1]).toEqual(["TST"]);
  });

  it("o produto do C2X segue só no C2X", async () => {
    await getImobiliarias(requisicao("produto/imobiliarias", "37"));
    expect(vi.mocked(lerPropostasVivasDoPanteon)).not.toHaveBeenCalled();
    await getAssinaturas(requisicao("vendas/assinaturas", "37"));
    expect(vi.mocked(lerAssinaturasDoPanteon)).not.toHaveBeenCalled();
  });
});

describe("D2: o produto com dono marcado (o Garden da Cecílio) lê o estoque do Panteon", () => {
  const SESSAO_COM_GARDEN = ["37", "39"];

  it("⚠️ Unidades lê hercules_unidades do Garden, com a matrícula, sem ir ao C2X", async () => {
    const resposta = await getUnidades(requisicao("produto/unidades", "39", SESSAO_COM_GARDEN));
    expect(resposta.status).toBe(200);
    expect(vi.mocked(loadApoloEnterpriseUnits)).not.toHaveBeenCalled();
    expect(vi.mocked(lerUnidadesDoPanteon).mock.calls.at(-1)?.[1]).toEqual(["39"]);
    const corpo = (await resposta.json()) as {
      data: { units: Array<{ code: string; enterpriseCode: string; price: number; registration: null | string }> };
    };
    expect(corpo.data.units).toEqual([
      expect.objectContaining({ code: "GDN0101", enterpriseCode: "GDN", price: 210000, registration: "45.678" }),
    ]);
  });

  it("⚠️ o Resumo do Garden conta pelo Panteon, a mesma fonte da aba Unidades", async () => {
    const resposta = await getResumo(requisicao("produto/resumo", "39", SESSAO_COM_GARDEN));
    expect(resposta.status).toBe(200);
    expect(vi.mocked(loadApoloEnterpriseVendas)).not.toHaveBeenCalled();
    expect(vi.mocked(lerUnidadesDoPanteon).mock.calls.at(-1)?.[1]).toEqual(["39"]);
  });

  // (16/09/2026, revisão do conjunto) As vendas antigas do Garden estão no C2X; o contrato que a
  // Cecílio fecha agora nasce no Panteon. Imobiliárias e Contratos somam as duas fontes.
  it("⚠️ Imobiliárias e Contratos do Garden leem o C2X E o Panteon", async () => {
    await getImobiliarias(requisicao("produto/imobiliarias", "39", SESSAO_COM_GARDEN));
    expect(vi.mocked(loadApoloEnterpriseVendas).mock.calls.at(-1)?.[0]).toEqual(["GDN"]);
    expect(vi.mocked(lerPropostasVivasDoPanteon).mock.calls.at(-1)?.[1]).toEqual(["GDN"]);

    const resposta = await getAssinaturas(requisicao("vendas/assinaturas", "39", SESSAO_COM_GARDEN));
    expect(resposta.status).toBe(200);
    expect(vi.mocked(lerAssinaturasDoPortal).mock.calls.at(-1)?.[0]).toEqual(["GDN"]);
    expect(vi.mocked(lerAssinaturasDoPanteon).mock.calls.at(-1)?.[1]).toEqual(["GDN"]);
  });

  it("o VOC (sem dono) continua no C2X na mesma sessão", async () => {
    await getUnidades(requisicao("produto/unidades", "37", SESSAO_COM_GARDEN));
    expect(vi.mocked(loadApoloEnterpriseUnits).mock.calls.at(-1)?.[0]).toEqual(["VOC"]);
    expect(vi.mocked(lerUnidadesDoPanteon)).not.toHaveBeenCalled();
  });
});
