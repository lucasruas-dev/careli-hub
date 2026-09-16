import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  type ConsultaDaFicha,
  conferirTrocaDeDocumentoConsultado,
  FINALIDADE_DA_CONSULTA_DO_CONJUGE,
  idsDaEscritaNoBoard,
  MENSAGEM_CNPJ_JA_CONSULTADO,
  MENSAGEM_CPF_JA_CONSULTADO,
  RESERVA_QUE_NAO_CONSULTOU,
  trocaDeDocumentoConsultado,
} from "./escrita-no-board";

// AS ESCRITAS DO BOARD PELO PORTAL (16/09/2026).
//   • D1: de quais enterprises é a escrita (a CAD do escopo, ou o recorte inteiro sem CAD);
//   • a trava do documento já consultado no Serasa: no portal que opera sozinho, trocar o CPF do
//     cônjuge (ficha) ou o documento do titular (identidade) depois da consulta é 409, e a leitura que
//     falha é 503.

const HUB = join(__dirname, "..", "..", "..");
const ler = (caminho: string) => readFileSync(join(HUB, caminho), "utf8");

const consulta = (over: Partial<ConsultaDaFicha>): ConsultaDaFicha => ({
  created_at: "2026-09-10T12:00:00Z",
  documento: "52998224725",
  erro: null,
  finalidade: "analise-credito-cad",
  ...over,
});

describe("idsDaEscritaNoBoard", () => {
  it("com CAD: só o empreendimento da CAD", () => {
    expect(idsDaEscritaNoBoard({ enterpriseId: "39" }, { ids: new Set(["37", "39"]) })).toEqual(["39"]);
  });

  it("sem CAD (imobiliária): o recorte inteiro, para a régua recusar se um id for de fora", () => {
    expect(idsDaEscritaNoBoard({ enterpriseId: null }, { ids: new Set(["37", "39"]) })).toEqual(["37", "39"]);
  });
});

describe("trocaDeDocumentoConsultado", () => {
  it("sem consulta do alvo: não trava", () => {
    expect(trocaDeDocumentoConsultado([], "titular", "111.444.777-35")).toBe(false);
    // A do cônjuge não trava o titular, e a do titular não trava o cônjuge.
    expect(
      trocaDeDocumentoConsultado(
        [consulta({ finalidade: FINALIDADE_DA_CONSULTA_DO_CONJUGE })],
        "titular",
        "111.444.777-35",
      ),
    ).toBe(false);
    expect(trocaDeDocumentoConsultado([consulta({})], "conjuge", "111.444.777-35")).toBe(false);
  });

  it("titular consultado: outro documento trava; o mesmo (com máscara ou não) passa", () => {
    const consultas = [consulta({})];
    expect(trocaDeDocumentoConsultado(consultas, "titular", "111.444.777-35")).toBe(true);
    expect(trocaDeDocumentoConsultado(consultas, "titular", "529.982.247-25")).toBe(false);
    expect(trocaDeDocumentoConsultado(consultas, "titular", "52998224725")).toBe(false);
  });

  it("cônjuge consultado: trocar trava, apagar trava, mandar o mesmo passa", () => {
    const consultas = [consulta({ documento: "11144477735", finalidade: FINALIDADE_DA_CONSULTA_DO_CONJUGE })];
    expect(trocaDeDocumentoConsultado(consultas, "conjuge", "529.982.247-25")).toBe(true);
    expect(trocaDeDocumentoConsultado(consultas, "conjuge", "")).toBe(true);
    expect(trocaDeDocumentoConsultado(consultas, "conjuge", null)).toBe(true);
    expect(trocaDeDocumentoConsultado(consultas, "conjuge", "111.444.777-35")).toBe(false);
  });

  it("vale o documento da consulta MAIS RECENTE do alvo", () => {
    const consultas = [
      consulta({ created_at: "2026-09-01T00:00:00Z", documento: "11144477735" }),
      consulta({ created_at: "2026-09-12T00:00:00Z", documento: "52998224725" }),
    ];
    expect(trocaDeDocumentoConsultado(consultas, "titular", "529.982.247-25")).toBe(false);
    expect(trocaDeDocumentoConsultado(consultas, "titular", "111.444.777-35")).toBe(true);
  });

  it("consulta com erro conta (pode ter sido cobrada); a reserva que desistiu sem chamar, não", () => {
    expect(
      trocaDeDocumentoConsultado([consulta({ erro: "timeout do Serasa" })], "titular", "111.444.777-35"),
    ).toBe(true);
    expect(
      trocaDeDocumentoConsultado([consulta({ erro: RESERVA_QUE_NAO_CONSULTOU })], "titular", "111.444.777-35"),
    ).toBe(false);
  });

  it("consulta sem finalidade gravada é do titular", () => {
    expect(
      trocaDeDocumentoConsultado([consulta({ finalidade: null })], "titular", "111.444.777-35"),
    ).toBe(true);
  });
});

function clienteFalso(resposta: { data?: unknown; error?: { message: string } | null }) {
  const filtros: Array<[string, unknown]> = [];
  const cadeia: Record<string, unknown> = {};
  Object.assign(cadeia, {
    eq: (coluna: string, valor: unknown) => {
      filtros.push([coluna, valor]);
      return cadeia;
    },
    limit: () => Promise.resolve({ data: resposta.data ?? null, error: resposta.error ?? null }),
    order: () => cadeia,
    select: () => cadeia,
  });
  const tabelas: string[] = [];
  const client = {
    from: (tabela: string) => {
      tabelas.push(tabela);
      return cadeia;
    },
  } as unknown as Parameters<typeof conferirTrocaDeDocumentoConsultado>[0];
  return { client, filtros, tabelas };
}

describe("conferirTrocaDeDocumentoConsultado (no servidor)", () => {
  it("lê as consultas DESTA ficha e deixa seguir quando não é troca", async () => {
    const { client, filtros, tabelas } = clienteFalso({ data: [consulta({})] });
    const r = await conferirTrocaDeDocumentoConsultado(client, {
      alvo: "titular",
      documentoNovo: "529.982.247-25",
      entityId: "e1",
    });
    expect(r).toBeNull();
    expect(tabelas).toEqual(["serasa_consultas"]);
    expect(filtros).toContainEqual(["entity_id", "e1"]);
  });

  it("troca do CPF consultado: 409 com a frase", async () => {
    const { client } = clienteFalso({ data: [consulta({})] });
    const r = await conferirTrocaDeDocumentoConsultado(client, {
      alvo: "titular",
      documentoNovo: "111.444.777-35",
      entityId: "e1",
    });
    expect(r?.status).toBe(409);
    expect(await r?.json()).toEqual({ error: MENSAGEM_CPF_JA_CONSULTADO, motivo: "documento_consultado" });
    expect(MENSAGEM_CPF_JA_CONSULTADO).toBe(
      "Este CPF já foi consultado na análise de crédito. Peça a correção à Careli.",
    );
  });

  it("troca do CNPJ consultado: a frase fala de CNPJ", async () => {
    const { client } = clienteFalso({ data: [consulta({ documento: "11222333000181" })] });
    const r = await conferirTrocaDeDocumentoConsultado(client, {
      alvo: "titular",
      documentoNovo: "11.444.777/0001-61",
      entityId: "e1",
    });
    expect(r?.status).toBe(409);
    expect(((await r?.json()) as { error: string }).error).toBe(MENSAGEM_CNPJ_JA_CONSULTADO);
  });

  it("leitura que falha: 503, nunca 'pode trocar'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = clienteFalso({ error: { message: "timeout" } });
    const r = await conferirTrocaDeDocumentoConsultado(client, {
      alvo: "conjuge",
      documentoNovo: "111.444.777-35",
      entityId: "e1",
    });
    expect(r?.status).toBe(503);
  });
});

describe("os literais batem com o serviço do crédito", () => {
  it("a finalidade do cônjuge e a marca da reserva que desistiu são as de consulta-servico.ts", () => {
    const servico = ler("lib/serasa/consulta-servico.ts");
    expect(servico).toContain(`export const FINALIDADE_CONJUGE = "${FINALIDADE_DA_CONSULTA_DO_CONJUGE}";`);
    expect(servico).toContain(`export const MARCA_DESISTIU = "${RESERVA_QUE_NAO_CONSULTOU}";`);
  });
});

// AS AMARRAS NAS ROTAS: a régua de quem opera (D1) e a trava do documento rodam ANTES de gravar.
describe("as rotas de escrita do board chamam a régua antes de gravar", () => {
  const antes = (texto: string, primeiro: string, depois: string) => {
    const a = texto.indexOf(primeiro);
    const b = texto.indexOf(depois);
    expect(a, `${primeiro} não está na rota`).toBeGreaterThan(-1);
    expect(b, `${depois} não está na rota`).toBeGreaterThan(a);
  };

  it("PATCH da ficha: escopo, régua de quem opera, trava do cônjuge, e só então salva", () => {
    const rota = ler("app/api/incorporador/board/[id]/route.ts");
    const patch = rota.slice(rota.indexOf("export async function PATCH"));
    antes(patch, "cadNoEscopo(", "autorizarEscritaNoProduto(");
    antes(patch, "autorizarEscritaNoProduto(", "conferirTrocaDeDocumentoConsultado(");
    antes(patch, "conferirTrocaDeDocumentoConsultado(", "salvarFichaDoBoard(");
    expect(patch).toMatch(/portalConfeccionaContrato\(auth\.sessao\.slug, auth\.sessao\.tipo\)/);
    expect(patch).toContain('alvo: "conjuge"');
    // O GET não passa pela régua: ler continua valendo.
    const get = rota.slice(rota.indexOf("export async function GET"), rota.indexOf("export async function PATCH"));
    expect(get).not.toContain("autorizarEscritaNoProduto(");
  });

  it("identidade: escopo, régua de quem opera, trava do titular, e só então grava", () => {
    const rota = ler("app/api/incorporador/board/[id]/identidade/route.ts");
    antes(rota, "cadNoEscopo(", "autorizarEscritaNoProduto(");
    antes(rota, "autorizarEscritaNoProduto(", "conferirTrocaDeDocumentoConsultado(");
    antes(rota, "conferirTrocaDeDocumentoConsultado(", "atualizarIdentidade({");
    expect(rota).toContain('alvo: "titular"');
  });

  it("habilitar: o POST passa pela régua com os ids do recorte antes de decidir; o GET não", () => {
    const rota = ler("app/api/incorporador/board/[id]/habilitar/route.ts");
    const post = rota.slice(rota.indexOf("export async function POST"));
    antes(post, "cadNoEscopo(", "autorizarEscritaNoProduto(request, auth.sessao, [...rec.recorte.ids])");
    antes(post, "autorizarEscritaNoProduto(", "decidirCredenciamento(");
    const get = rota.slice(rota.indexOf("export async function GET"), rota.indexOf("export async function POST"));
    expect(get).not.toContain("autorizarEscritaNoProduto(");
  });

  it("serasa: consultar (POST) e aprovar com restrição passam por escritaNoProduto antes do serviço", () => {
    const consultar = ler("app/api/incorporador/board/[id]/serasa/consultar/route.ts");
    const post = consultar.slice(consultar.indexOf("export async function POST"));
    antes(post, "escritaNoProduto(porta.sessao", "consultarCredito(");
    const get = consultar.slice(consultar.indexOf("export async function GET"), consultar.indexOf("export async function POST"));
    expect(get).not.toContain("escritaNoProduto(");

    const aprovar = ler("app/api/incorporador/board/[id]/serasa/aprovar-restricao/route.ts");
    antes(aprovar, "escritaNoProduto(sozinho.sessao", "aprovarComRestricao({");
  });
});
