import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// AS ESCRITAS DO BOARD PELO PORTAL, com COOKIE ASSINADO DE VERDADE (16/09/2026).
//
// O que se trava aqui, em PATCH da ficha, POST da identidade e POST do habilitar:
//   • D1: no portal que confecciona (Cecílio), só grava no produto que opera (`operado_por`). A CAD
//     ou o recorte do VOC (37) é 403 `soConsulta`; o Garden (39) segue. O comercial (Gurgel) segue
//     em qualquer produto do escopo, sem ler o cadastro;
//   • a trava do documento já consultado no Serasa, só no portal que opera sozinho: o CPF do cônjuge
//     (ficha) e o documento do titular (identidade) não mudam depois da consulta (409); sem conseguir
//     ler as consultas, 503; o mesmo documento segue.
// A régua de quem opera é testada em lib/apolo/incorporador/operacao-do-produto*.test.ts, e a trava
// em lib/apolo/incorporador/escrita-no-board.test.ts.

const m = vi.hoisted(() => ({
  cadNoEscopo: vi.fn(),
  cadastro: vi.fn(),
  catalogo: vi.fn(),
  consultas: vi.fn(),
  papel: vi.fn(),
  pessoa: vi.fn(),
  vinculos: vi.fn(),
  decidir: vi.fn(),
  identidade: vi.fn(),
  recorte: vi.fn(),
  salvar: vi.fn(),
  temis: vi.fn(),
}));

vi.mock("@/lib/temis/portao-do-portal", () => ({ autorizarTemisDoPortal: m.temis }));
vi.mock("@/lib/apolo/board-do-servidor", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/board-do-servidor")>()),
  decidirCredenciamento: m.decidir,
  salvarFichaDoBoard: m.salvar,
}));
vi.mock("@/lib/apolo/incorporador/board-do-portal", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/incorporador/board-do-portal")>()),
  adminOu503: () => ({
    client: {
      from: (tabela: string) => {
        const cadeia: Record<string, unknown> = {};
        Object.assign(cadeia, {
          eq: () => cadeia,
          limit: () =>
            tabela === "serasa_consultas"
              ? m.consultas()
              : tabela === "apolo_relationships"
                ? m.vinculos()
                : Promise.resolve({ data: [], error: null }),
          maybeSingle: () =>
            tabela === "apolo_entity_profiles" ? m.papel() : Promise.resolve({ data: null, error: null }),
          order: () => cadeia,
          select: () => cadeia,
        });
        return cadeia;
      },
    },
    ok: true,
  }),
  cadNoEscopo: m.cadNoEscopo,
  recorteDoProduto: m.recorte,
}));
vi.mock("@/lib/apolo/incorporador/documentos-do-portal", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/incorporador/documentos-do-portal")>()),
  lerEmpreendimentosDaPessoa: () => m.pessoa(),
}));
vi.mock("@/lib/apolo/identidade-persist", () => ({ atualizarIdentidade: m.identidade }));
vi.mock("@/lib/hercules/cadastro", async (original) => ({
  ...(await original<typeof import("@/lib/hercules/cadastro")>()),
  lerCadastroDeEmpreendimentos: m.cadastro,
}));
vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({ catalogoDeEmpreendimentos: () => m.catalogo() }));

import {
  criarSessaoIncorporador,
  INCORPORADOR_COOKIE,
  type SessaoIncorporador,
} from "@/lib/apolo/incorporador/sessao";

import { POST as habilitar } from "./habilitar/route";
import { POST as identidade } from "./identidade/route";
import { PATCH as ficha } from "./route";

const ENTIDADE = "11111111-2222-4333-8444-555555555555";
const USUARIO = "7b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

type Perfil = Pick<SessaoIncorporador, "slug" | "tipo">;
const CECILIO: Perfil = { slug: "cecilio-rocha", tipo: "incorporador" };
const GURGEL: Perfil = { slug: "gurgel", tipo: "comercial" };

const ID_DA_CECILIO = "inc-cecilio-rocha";
const SESSAO_VIGENTE = {
  enterpriseIds: ["37", "39"],
  enterpriseIdsComCarteira: [],
  incorporadorId: ID_DA_CECILIO,
  slug: "cecilio-rocha",
  tipo: "incorporador",
  usuarioId: USUARIO,
  usuarioNome: "Maria",
};

const linha = (c2x: string, operadoPor: null | string) => ({
  c2xEnterpriseId: c2x,
  cidade: null,
  codigo: `P${c2x}`,
  id: `uuid-${c2x}`,
  nome: `Produto ${c2x}`,
  operadoPor,
  ordem: 0,
  paiId: null,
  uf: null,
  vendendo: true,
});
const CADASTRO = {
  com0170: true,
  linhas: [linha("39", ID_DA_CECILIO), linha("37", null), linha("41", null)],
};

function pedido(perfil: Perfil, caminho: string, corpo: Record<string, unknown>, metodo = "POST") {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste-das-escritas");
  const token = criarSessaoIncorporador(
    {
      enterpriseIds: ["37", "39"],
      enterpriseIdsComCarteira: [],
      incorporadorId: `inc-${perfil.slug}`,
      incorporadorNome: "Portal",
      usuarioId: USUARIO,
      usuarioNome: "Maria",
      ...perfil,
    },
    Date.now(),
  );
  return new Request(`https://c2x.app.br/api/incorporador/board/${ENTIDADE}${caminho}?emp=39`, {
    body: JSON.stringify(corpo),
    headers: new Headers({
      "content-type": "application/json",
      cookie: `${INCORPORADOR_COOKIE}=${token}`,
    }),
    method: metodo,
  });
}

const contexto = { params: Promise.resolve({ id: ENTIDADE }) };

/** O escopo: a CAD do produto pedido, ou a imobiliária (sem CAD) com o recorte do produto. */
function noProduto(enterpriseId: string, imobiliaria = false, recorte: string[] = [enterpriseId]) {
  m.recorte.mockImplementation(async (_request: Request, sessao: unknown) => ({
    ok: true,
    recorte: { ids: new Set(recorte), nomes: ["Produto"], sessao },
  }));
  m.cadNoEscopo.mockImplementation(async () => ({
    escopo: { enterpriseId: imobiliaria ? null : enterpriseId, imobiliaria },
    ok: true,
  }));
}

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  m.temis.mockImplementation(async () => ({ ator: {}, ok: true, sessao: SESSAO_VIGENTE }));
  noProduto("39");
  m.cadastro.mockImplementation(async () => CADASTRO);
  m.catalogo.mockImplementation(async () => []);
  m.papel.mockImplementation(async () => ({ data: { status: "active" }, error: null }));
  m.pessoa.mockImplementation(async () => ({ esteira: ["39"], vinculos: ["39"] }));
  m.vinculos.mockImplementation(async () => ({ data: [], error: null }));
  m.consultas.mockImplementation(async () => ({ data: [], error: null }));
  m.salvar.mockImplementation(async () => NextResponse.json({ data: { ok: true } }));
  m.decidir.mockImplementation(async () => NextResponse.json({ data: { ok: true } }));
  m.identidade.mockImplementation(async () => ({ ok: true }));
});

const consultaDoConjuge = { created_at: "2026-09-10T12:00:00Z", documento: "11144477735", erro: null, finalidade: "analise-credito-conjuge" };
const consultaDoTitular = { created_at: "2026-09-10T12:00:00Z", documento: "52998224725", erro: null, finalidade: "analise-credito-cad" };

describe("PATCH da ficha", () => {
  it("(D1) Cecílio na CAD do VOC (37): 403 soConsulta, nada salvo", async () => {
    noProduto("37");
    const r = await ficha(pedido(CECILIO, "", { campos: { renda: "5000" }, enterpriseId: "37" }, "PATCH"), contexto);
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ soConsulta: true });
    expect(m.salvar).not.toHaveBeenCalled();
  });

  it("(D1) Cecílio na CAD do Garden (39): salva", async () => {
    const r = await ficha(pedido(CECILIO, "", { campos: { renda: "5000" }, enterpriseId: "39" }, "PATCH"), contexto);
    expect(r.status).toBe(200);
    expect(m.salvar).toHaveBeenCalledTimes(1);
    // Sem mexer no CPF do cônjuge, as consultas nem são lidas.
    expect(m.consultas).not.toHaveBeenCalled();
  });

  it("(D1) comercial na CAD do VOC (37): salva como hoje, sem ler o cadastro", async () => {
    noProduto("37");
    const r = await ficha(pedido(GURGEL, "", { campos: { renda: "5000" }, enterpriseId: "37" }, "PATCH"), contexto);
    expect(r.status).toBe(200);
    expect(m.cadastro).not.toHaveBeenCalled();
    expect(m.temis).not.toHaveBeenCalled();
  });

  it("Cecílio troca o CPF do cônjuge já consultado: 409 com a frase, nada salvo", async () => {
    m.consultas.mockImplementation(async () => ({ data: [consultaDoConjuge], error: null }));
    const r = await ficha(
      pedido(CECILIO, "", { campos: { conjugeCpf: "529.982.247-25" }, enterpriseId: "39" }, "PATCH"),
      contexto,
    );
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe(
      "Este CPF já foi consultado na análise de crédito. Peça a correção à Careli.",
    );
    expect(m.salvar).not.toHaveBeenCalled();
  });

  it("Cecílio manda o mesmo CPF do cônjuge consultado: salva", async () => {
    m.consultas.mockImplementation(async () => ({ data: [consultaDoConjuge], error: null }));
    const r = await ficha(
      pedido(CECILIO, "", { campos: { conjugeCpf: "111.444.777-35" }, enterpriseId: "39" }, "PATCH"),
      contexto,
    );
    expect(r.status).toBe(200);
    expect(m.salvar).toHaveBeenCalledTimes(1);
  });

  it("Cecílio, leitura das consultas falha: 503, nada salvo", async () => {
    m.consultas.mockImplementation(async () => ({ data: null, error: { message: "timeout" } }));
    const r = await ficha(
      pedido(CECILIO, "", { campos: { conjugeCpf: "529.982.247-25" }, enterpriseId: "39" }, "PATCH"),
      contexto,
    );
    expect(r.status).toBe(503);
    expect(m.salvar).not.toHaveBeenCalled();
  });

  // (16/09/2026, revisão do conjunto) ⚠️ Sem `?emp` o recorte cru da Cecílio é {37, 39, 41}; o VOC e o
  // VOR são só consulta para ela. A pessoa com CAD no VOC e a CAD do Garden acrescentada (D5) não tem
  // o telefone e o e-mail da entidade (a identidade da Iris) reescritos pelo portal.
  it("Cecílio sem emp, pessoa {37, 39}: telefone e e-mail são recusados (409), nada salvo", async () => {
    noProduto("39", false, ["37", "39", "41"]);
    m.pessoa.mockImplementation(async () => ({ esteira: ["37", "39"], vinculos: [] }));
    const r = await ficha(
      pedido(CECILIO, "", { campos: { telefone: "(37) 99999-0000" }, enterpriseId: "39" }, "PATCH"),
      contexto,
    );
    expect(r.status).toBe(409);
    expect(m.salvar).not.toHaveBeenCalled();
  });

  it("Cecílio sem emp, pessoa só no Garden: o telefone segue", async () => {
    noProduto("39", false, ["37", "39", "41"]);
    const r = await ficha(
      pedido(CECILIO, "", { campos: { telefone: "(37) 99999-0000" }, enterpriseId: "39" }, "PATCH"),
      contexto,
    );
    expect(r.status).toBe(200);
    expect(m.salvar).toHaveBeenCalledTimes(1);
  });

  it("comercial troca o CPF do cônjuge: a trava é só do portal que opera sozinho", async () => {
    m.consultas.mockImplementation(async () => ({ data: [consultaDoConjuge], error: null }));
    const r = await ficha(
      pedido(GURGEL, "", { campos: { conjugeCpf: "529.982.247-25" }, enterpriseId: "39" }, "PATCH"),
      contexto,
    );
    expect(r.status).toBe(200);
    expect(m.consultas).not.toHaveBeenCalled();
  });
});

describe("POST da identidade", () => {
  const corpo = (documento: string) => ({ documento, motivo: "Nome errado", nome: "Fulano", tipo: "pf" });

  it("(D1) Cecílio na CAD do VOC (37): 403 soConsulta, nada gravado", async () => {
    noProduto("37");
    const r = await identidade(pedido(CECILIO, "/identidade", corpo("529.982.247-25")), contexto);
    expect(r.status).toBe(403);
    expect(m.identidade).not.toHaveBeenCalled();
  });

  it("Cecílio troca o documento do titular já consultado: 409, nada gravado", async () => {
    m.consultas.mockImplementation(async () => ({ data: [consultaDoTitular], error: null }));
    const r = await identidade(pedido(CECILIO, "/identidade", corpo("111.444.777-35")), contexto);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe(
      "Este CPF já foi consultado na análise de crédito. Peça a correção à Careli.",
    );
    expect(m.identidade).not.toHaveBeenCalled();
  });

  it("Cecílio corrige só o nome, com o mesmo documento consultado: grava", async () => {
    m.consultas.mockImplementation(async () => ({ data: [consultaDoTitular], error: null }));
    const r = await identidade(pedido(CECILIO, "/identidade", corpo("529.982.247-25")), contexto);
    expect(r.status).toBe(200);
    expect(m.identidade).toHaveBeenCalledTimes(1);
  });

  it("Cecílio, leitura das consultas falha: 503, nada gravado", async () => {
    m.consultas.mockImplementation(async () => ({ data: null, error: { message: "timeout" } }));
    const r = await identidade(pedido(CECILIO, "/identidade", corpo("111.444.777-35")), contexto);
    expect(r.status).toBe(503);
    expect(m.identidade).not.toHaveBeenCalled();
  });

  it("Cecílio sem emp, pessoa {39, 41}: a correção de identidade é da Careli (409)", async () => {
    noProduto("39", false, ["37", "39", "41"]);
    m.pessoa.mockImplementation(async () => ({ esteira: ["39", "41"], vinculos: [] }));
    const r = await identidade(pedido(CECILIO, "/identidade", corpo("529.982.247-25")), contexto);
    expect(r.status).toBe(409);
    expect(m.identidade).not.toHaveBeenCalled();
  });

  it("comercial: sem a trava do documento (como hoje)", async () => {
    m.consultas.mockImplementation(async () => ({ data: [consultaDoTitular], error: null }));
    const r = await identidade(pedido(GURGEL, "/identidade", corpo("111.444.777-35")), contexto);
    expect(r.status).toBe(200);
    expect(m.consultas).not.toHaveBeenCalled();
  });
});

describe("POST do habilitar (imobiliária)", () => {
  it("(D1) Cecílio no recorte do VOC (37): 403 soConsulta, nada decidido", async () => {
    noProduto("37", true);
    const r = await habilitar(pedido(CECILIO, "/habilitar", { acao: "habilitar", empreendimentos: ["37"] }), contexto);
    expect(r.status).toBe(403);
    expect(m.decidir).not.toHaveBeenCalled();
  });

  it("(D1) Cecílio no recorte do Garden (39): decide", async () => {
    noProduto("39", true);
    const r = await habilitar(pedido(CECILIO, "/habilitar", { acao: "habilitar", empreendimentos: ["39"] }), contexto);
    expect(r.status).toBe(200);
    expect(m.decidir).toHaveBeenCalledTimes(1);
  });

  it("(D1) comercial no recorte do VOC (37): decide como hoje, sem ler o cadastro", async () => {
    noProduto("37", true);
    const r = await habilitar(pedido(GURGEL, "/habilitar", { acao: "habilitar", empreendimentos: ["37"] }), contexto);
    expect(r.status).toBe(200);
    expect(m.cadastro).not.toHaveBeenCalled();
    expect(m.decidir).toHaveBeenCalledTimes(1);
  });

  // (16/09/2026, revisão do conjunto) Habilitar promove o papel e a entidade (decisão GLOBAL).
  it("⚠️ Cecílio habilita imobiliária INDEFERIDA pela Careli com pedido em outro produto: 409, nada decidido", async () => {
    noProduto("39", true);
    m.papel.mockImplementation(async () => ({ data: { status: "blocked" }, error: null }));
    m.vinculos.mockImplementation(async () => ({
      data: [
        { metadata: { enterpriseId: "12" }, status: "rejected" },
        { metadata: { enterpriseId: "39" }, status: "pending" },
      ],
      error: null,
    }));
    const r = await habilitar(pedido(CECILIO, "/habilitar", { acao: "habilitar", empreendimentos: ["39"] }), contexto);
    expect(r.status).toBe(409);
    expect(m.decidir).not.toHaveBeenCalled();
  });

  it("Cecílio habilita imobiliária em análise que só pediu o Garden: decide", async () => {
    noProduto("39", true);
    m.papel.mockImplementation(async () => ({ data: { status: "review" }, error: null }));
    m.vinculos.mockImplementation(async () => ({
      data: [{ metadata: { enterpriseId: "39" }, status: "pending" }],
      error: null,
    }));
    const r = await habilitar(pedido(CECILIO, "/habilitar", { acao: "habilitar", empreendimentos: ["39"] }), contexto);
    expect(r.status).toBe(200);
    expect(m.decidir).toHaveBeenCalledTimes(1);
  });

  it("Cecílio indefere imobiliária com vínculo no VOC (só consulta para ela): 409", async () => {
    noProduto("39", true);
    m.vinculos.mockImplementation(async () => ({
      data: [
        { metadata: { enterpriseId: "37" }, status: "verified" },
        { metadata: { enterpriseId: "39" }, status: "pending" },
      ],
      error: null,
    }));
    const r = await habilitar(pedido(CECILIO, "/habilitar", { acao: "indeferir" }), contexto);
    expect(r.status).toBe(409);
    expect(m.decidir).not.toHaveBeenCalled();
  });

  it("comercial numa gleba (33) decide sobre a imobiliária credenciada no grupo, como antes da onda 1", async () => {
    noProduto("33", true);
    m.catalogo.mockImplementation(async () => [
      { id: "group:Lagoa Bonita", name: "Lagoa Bonita", stageIds: ["33", "34"] },
    ]);
    m.vinculos.mockImplementation(async () => ({
      data: [{ metadata: { enterpriseId: "group:Lagoa Bonita" }, status: "verified" }],
      error: null,
    }));
    const r = await habilitar(pedido(GURGEL, "/habilitar", { acao: "correcao" }), contexto);
    expect(r.status).toBe(200);
    expect(m.decidir).toHaveBeenCalledTimes(1);
  });
});
