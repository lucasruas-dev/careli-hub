import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA DE ETAPA DO PORTAL: quem pode gravar as etapas de decisão, com COOKIE ASSINADO DE VERDADE.
//
// Decisão do Lucas (16/09/2026): a Cecílio faz crédito e credenciamento no portal. O que muda e o
// que NÃO muda, travado aqui:
//   • comercial (Gurgel): pré-venda, credenciado e indeferido continuam no 403 de hoje, com a mesma
//     frase, sem revalidar conta; as quatro etapas do coordenador seguem como eram, em qualquer
//     produto do escopo e sem ler o cadastro de quem opera;
//   • incorporador padrão (cer): 404 antes de tudo;
//   • Cecílio: as etapas de decisão passam pela conta revalidada, pelo recorte refeito com a sessão
//     vigente, pelo escopo da CAD e pela régua (`conferirEtapaDeDecisao`), e só então gravam, com a
//     origem "portal-incorporador". Recusa da régua não grava nada.
//   • (D1) Cecílio só grava na CAD do produto que ela opera (`operado_por`): a CAD do VOC (37) é só
//     consulta (403 `soConsulta`), em qualquer etapa; sem conseguir conferir quem opera, 503.
// A régua em si (crédito aprovado, PIX, motivo) é testada em lib/apolo/board-do-servidor.decisao.test.ts,
// e a de quem opera em lib/apolo/incorporador/operacao-do-produto*.test.ts.

const m = vi.hoisted(() => ({
  cadNoEscopo: vi.fn(),
  cadastro: vi.fn(),
  conferir: vi.fn(),
  mover: vi.fn(),
  recorte: vi.fn(),
  temis: vi.fn(),
}));

vi.mock("@/lib/temis/portao-do-portal", () => ({ autorizarTemisDoPortal: m.temis }));
vi.mock("@/lib/apolo/board-do-servidor", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/board-do-servidor")>()),
  conferirEtapaDeDecisao: m.conferir,
  moverEtapaDoBoard: m.mover,
}));
vi.mock("@/lib/apolo/incorporador/board-do-portal", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/incorporador/board-do-portal")>()),
  adminOu503: () => ({ client: { cliente: "admin" }, ok: true }),
  cadNoEscopo: m.cadNoEscopo,
  recorteDoProduto: m.recorte,
}));
// Quem opera cada produto (hercules_empreendimentos.operado_por, 0170) e o catálogo do C2X (sem ele,
// o escopo vigente é o da sessão).
vi.mock("@/lib/hercules/cadastro", async (original) => ({
  ...(await original<typeof import("@/lib/hercules/cadastro")>()),
  lerCadastroDeEmpreendimentos: m.cadastro,
}));
vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({ catalogoDeEmpreendimentos: async () => [] }));

import { foraDoEscopo } from "@/lib/apolo/incorporador/escopo";
import { MENSAGEM_PRODUTO_SO_CONSULTA } from "@/lib/apolo/incorporador/operacao-do-produto";
import {
  criarSessaoIncorporador,
  INCORPORADOR_COOKIE,
  type SessaoIncorporador,
} from "@/lib/apolo/incorporador/sessao";

import { PATCH } from "./route";

const ENTIDADE = "11111111-2222-4333-8444-555555555555";
const USUARIO = "7b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

type Perfil = Pick<SessaoIncorporador, "slug" | "tipo">;
const CECILIO: Perfil = { slug: "cecilio-rocha", tipo: "incorporador" };
const GURGEL: Perfil = { slug: "gurgel", tipo: "comercial" };
const CER: Perfil = { slug: "cer", tipo: "incorporador" };

const ID_DA_CECILIO = "inc-cecilio-rocha";

const SESSAO_VIGENTE = {
  enterpriseIds: ["37", "39"],
  incorporadorId: ID_DA_CECILIO,
  slug: "cecilio-rocha",
  tipo: "incorporador",
  usuarioId: USUARIO,
  usuarioNome: "Maria",
};

// O cadastro do Panteon: o Garden (39) é da Cecílio; o VOC (37) é da Careli (operado_por nulo).
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
const CADASTRO = { com0170: true, linhas: [linha("39", ID_DA_CECILIO), linha("37", null)] };

const FRASE_DA_CARELI =
  "Esta etapa é decidida pela Careli (pré-venda, credenciamento e indeferimento). Leve a CAD até a análise de crédito: a Careli conclui o credenciamento.";

function pedido(perfil: null | Perfil, corpo: Record<string, unknown>) {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste-da-etapa");
  const headers = new Headers({ "content-type": "application/json" });
  if (perfil) {
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
    headers.set("cookie", `${INCORPORADOR_COOKIE}=${token}`);
  }
  return new Request(`https://c2x.app.br/api/incorporador/board/${ENTIDADE}/etapa?emp=39`, {
    body: JSON.stringify(corpo),
    headers,
    method: "PATCH",
  });
}

const contexto = { params: Promise.resolve({ id: ENTIDADE }) };

/** A CAD que o escopo resolve. */
const cadDo = (enterpriseId: string) => {
  m.cadNoEscopo.mockImplementation(async () => ({
    escopo: { enterpriseId, imobiliaria: false },
    ok: true,
  }));
};

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  m.temis.mockImplementation(async () => ({ ator: {}, ok: true, sessao: SESSAO_VIGENTE }));
  m.recorte.mockImplementation(async (_request: Request, sessao: unknown) => ({
    ok: true,
    recorte: { ids: new Set(["37", "39"]), nomes: ["Garden", "Vale do Ouro"], sessao },
  }));
  cadDo("39");
  m.cadastro.mockImplementation(async () => CADASTRO);
  m.conferir.mockImplementation(async () => null);
  m.mover.mockImplementation(async () => NextResponse.json({ data: { etapa: "x", ok: true } }));
});

describe("comercial (Gurgel): nada muda", () => {
  for (const etapa of ["prevenda", "credenciado", "indeferido"]) {
    it(`${etapa}: o 403 de hoje, com a mesma frase, sem revalidar conta nem gravar`, async () => {
      const r = await PATCH(pedido(GURGEL, { etapa, motivo: "x" }), contexto);
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: FRASE_DA_CARELI });
      expect(m.temis).not.toHaveBeenCalled();
      expect(m.cadNoEscopo).not.toHaveBeenCalled();
      expect(m.conferir).not.toHaveBeenCalled();
      expect(m.mover).not.toHaveBeenCalled();
    });
  }

  it("credito: grava como sempre, com a origem do comercial e sem a régua de decisão", async () => {
    const r = await PATCH(pedido(GURGEL, { enterpriseId: "39", etapa: "credito" }), contexto);
    expect(r.status).toBe(200);
    expect(m.conferir).not.toHaveBeenCalled();
    expect(m.temis).not.toHaveBeenCalled();
    expect(m.mover.mock.calls[0]?.[3]).toMatchObject({ origem: "portal-comercial" });
  });

  it("(D1) CAD do VOC (37): segue gravando, sem ler o cadastro de quem opera", async () => {
    cadDo("37");
    const r = await PATCH(
      pedido(GURGEL, { enterpriseId: "37", etapa: "correcao", motivo: "Falta RG" }),
      contexto,
    );
    expect(r.status).toBe(200);
    expect(m.cadastro).not.toHaveBeenCalled();
    expect(m.temis).not.toHaveBeenCalled();
    expect(m.mover).toHaveBeenCalledTimes(1);
  });
});

describe("incorporador padrão (cer)", () => {
  it("credenciado: 404 antes de tudo", async () => {
    const r = await PATCH(pedido(CER, { etapa: "credenciado" }), contexto);
    expect(r.status).toBe(404);
    expect(m.recorte).not.toHaveBeenCalled();
    expect(m.mover).not.toHaveBeenCalled();
  });
});

describe("portal que opera sozinho (Cecílio)", () => {
  it("credenciado sem crédito aprovado: a recusa da régua volta e NADA é gravado", async () => {
    m.conferir.mockImplementation(async () => ({
      error: "O crédito desta CAD não está aprovado.",
      status: 409,
    }));
    const r = await PATCH(pedido(CECILIO, { etapa: "credenciado" }), contexto);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "O crédito desta CAD não está aprovado." });
    expect(m.mover).not.toHaveBeenCalled();
  });

  it("credenciado aprovado: revalida, refaz o recorte com a sessão vigente, confere e grava como portal-incorporador", async () => {
    const r = await PATCH(pedido(CECILIO, { enterpriseId: "39", etapa: "credenciado" }), contexto);
    expect(r.status).toBe(200);

    // Uma revalidação só: a régua de quem opera roda sobre a sessão que a decisão já revalidou.
    expect(m.temis).toHaveBeenCalledTimes(1);
    expect(m.recorte).toHaveBeenCalledTimes(2);
    expect(m.recorte.mock.calls[1]?.[1]).toBe(SESSAO_VIGENTE);
    expect(m.cadastro).toHaveBeenCalledTimes(1);
    expect(m.conferir).toHaveBeenCalledWith(expect.anything(), ENTIDADE, {
      enterpriseId: "39",
      etapa: "credenciado",
      incorporadorId: ID_DA_CECILIO,
      motivo: undefined,
    });

    const [, id, corpo, autor] = m.mover.mock.calls[0] as [
      unknown,
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(id).toBe(ENTIDADE);
    expect(corpo).toMatchObject({ enterpriseId: "39", etapa: "credenciado" });
    expect(autor).toMatchObject({ nome: "Maria", origem: "portal-incorporador", userId: USUARIO });
  });

  it("indeferido: a régua recebe o motivo", async () => {
    await PATCH(pedido(CECILIO, { etapa: "indeferido", motivo: "Renda não comprovada" }), contexto);
    expect(m.conferir).toHaveBeenCalledWith(expect.anything(), ENTIDADE, {
      enterpriseId: "39",
      etapa: "indeferido",
      incorporadorId: ID_DA_CECILIO,
      motivo: "Renda não comprovada",
    });
  });

  it("CAD fora do escopo: 404, sem régua e sem gravar", async () => {
    m.cadNoEscopo.mockImplementation(async () => ({ ok: false, response: foraDoEscopo() }));
    const r = await PATCH(pedido(CECILIO, { etapa: "credenciado" }), contexto);
    expect(r.status).toBe(404);
    expect(m.conferir).not.toHaveBeenCalled();
    expect(m.mover).not.toHaveBeenCalled();
  });

  it("conta que caiu (revalidação 404): 404, sem escopo nem gravação", async () => {
    m.temis.mockImplementation(async () => ({ ok: false, response: foraDoEscopo() }));
    const r = await PATCH(pedido(CECILIO, { etapa: "prevenda" }), contexto);
    expect(r.status).toBe(404);
    expect(m.cadNoEscopo).not.toHaveBeenCalled();
    expect(m.mover).not.toHaveBeenCalled();
  });

  it("etapa que não existe: 400, sem revalidar", async () => {
    const r = await PATCH(pedido(CECILIO, { etapa: "aprovado" }), contexto);
    expect(r.status).toBe(400);
    expect(m.temis).not.toHaveBeenCalled();
    expect(m.mover).not.toHaveBeenCalled();
  });

  it("etapas do coordenador na CAD do Garden: revalida pela porta de escrita e grava, sem a régua de decisão", async () => {
    const r = await PATCH(pedido(CECILIO, { etapa: "correcao", motivo: "Falta RG" }), contexto);
    expect(r.status).toBe(200);
    expect(m.temis).toHaveBeenCalledTimes(1);
    expect(m.conferir).not.toHaveBeenCalled();
    expect(m.mover.mock.calls[0]?.[3]).toMatchObject({ origem: "portal-incorporador" });
  });
});

// (16/09/2026, D1) Decisão do Lucas: escrita só no que a Cecílio opera. O VOC (37) está no escopo
// dela, mas é da Gurgel/Careli.
describe("(D1) Cecílio só grava no produto que opera", () => {
  it("CAD do VOC (37), etapa do coordenador: 403 soConsulta, nada gravado", async () => {
    cadDo("37");
    const r = await PATCH(
      pedido(CECILIO, { enterpriseId: "37", etapa: "correcao", motivo: "Falta RG" }),
      contexto,
    );
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: MENSAGEM_PRODUTO_SO_CONSULTA, soConsulta: true });
    expect(m.mover).not.toHaveBeenCalled();
  });

  it("CAD do VOC (37), etapa de decisão: 403 soConsulta antes da régua de decisão, uma revalidação só", async () => {
    cadDo("37");
    const r = await PATCH(pedido(CECILIO, { enterpriseId: "37", etapa: "credenciado" }), contexto);
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ soConsulta: true });
    expect(m.temis).toHaveBeenCalledTimes(1);
    expect(m.conferir).not.toHaveBeenCalled();
    expect(m.mover).not.toHaveBeenCalled();
  });

  it("CAD do Garden (39), operado por ela: segue", async () => {
    const r = await PATCH(pedido(CECILIO, { enterpriseId: "39", etapa: "revisao" }), contexto);
    expect(r.status).toBe(200);
    expect(m.cadastro).toHaveBeenCalledTimes(1);
    expect(m.mover).toHaveBeenCalledTimes(1);
  });

  it("sem a 0170 aplicada: 503, nada gravado (sem provar quem opera, ninguém escreve)", async () => {
    m.cadastro.mockImplementation(async () => ({ ...CADASTRO, com0170: false }));
    const r = await PATCH(pedido(CECILIO, { enterpriseId: "39", etapa: "revisao" }), contexto);
    expect(r.status).toBe(503);
    expect(m.mover).not.toHaveBeenCalled();
  });

  it("cadastro fora do ar na decisão: 503, sem régua de decisão nem gravação", async () => {
    m.cadastro.mockImplementation(async () => {
      throw new Error("hercules_empreendimentos fora do ar");
    });
    const r = await PATCH(pedido(CECILIO, { enterpriseId: "39", etapa: "credenciado" }), contexto);
    expect(r.status).toBe(503);
    expect(m.conferir).not.toHaveBeenCalled();
    expect(m.mover).not.toHaveBeenCalled();
  });
});
