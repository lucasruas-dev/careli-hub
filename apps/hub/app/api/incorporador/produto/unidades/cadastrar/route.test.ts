import { beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA DO PORTAL PARA CADASTRAR UNIDADES: quem entra e em qual produto.
//
// A regra do cadastro (tipo do cadastro, duplicados, tudo ou nada, situação intocável) está provada
// em lib/hercules/cadastrar-unidades-panteon-server.test.ts, com o banco simulado. Aqui a peça é
// trocada por um espião, e o que se prova é a PORTA:
//   • portal que não opera a venda, e o portal COMERCIAL: 404, e a peça nem é chamada;
//   • ações que gravam passam pela revalidação ÚNICA do portal que opera sozinho
//     (`autorizarPortalQueOperaSozinho`), e o recorte passa a ser o da sessão VIGENTE;
//   • id fora da sessão: 404 antes de qualquer leitura; "group:" também;
//   • dentro da sessão: a peça recebe o pedido, o autor DO COOKIE e a guarda de escopo, que é a régua
//     `podeCadastrarNoProduto` (produto fora da sessão, sem dono, de outro dono ou sem a 0170: recusa);
//   • o detalhe técnico da falha não sai para o navegador do cliente.

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { codes: ["VOC"], id: "37", name: "VALE DO OURO", stageIds: ["37"] },
    { codes: ["GDN"], id: "39", name: "GARDEN", stageIds: ["39"] },
    { codes: ["LBF", "LBR"], id: "group:Lagoa Bonita", name: "LAGOA BONITA", stageIds: ["33", "27"] },
  ],
}));

const banco = vi.hoisted(() => ({
  /** O escopo da conta AGORA; `null` = o mesmo do cookie. */
  escopoVigente: null as null | string[],
  leituras: 0,
  revalidacao: "ok" as "fora" | "indisponivel" | "ok",
}));

vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => ({ from: () => null }) }));

// A revalidação de verdade (conta, portal e escopo no banco) tem teste próprio; aqui ela é a porta
// que `autorizarPortalQueOperaSozinho` chama, com as três respostas possíveis.
vi.mock("@/lib/temis/portao-do-portal", async () => {
  const { NextResponse } = await import("next/server");
  const { sessaoDoRequest } = await import("@/lib/apolo/incorporador/sessao");
  return {
    autorizarTemisDoPortal: async (request: Request) => {
      banco.leituras += 1;
      if (banco.revalidacao === "fora") {
        return { ok: false, response: NextResponse.json({ error: "Nao encontrado." }, { status: 404 }) };
      }
      if (banco.revalidacao === "indisponivel") {
        return {
          ok: false,
          response: NextResponse.json({ error: "Não foi possível conferir o acesso agora." }, { status: 503 }),
        };
      }
      const sessao = sessaoDoRequest(request);
      if (!sessao) throw new Error("teste sem sessão");
      return { ok: true, sessao: { ...sessao, enterpriseIds: banco.escopoVigente ?? sessao.enterpriseIds } };
    },
  };
});

vi.mock("@/lib/hercules/cadastrar-unidades-panteon-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hercules/cadastrar-unidades-panteon-server")>()),
  executarCadastroDeUnidades: vi.fn(async () => ({ data: { criadas: 1 }, ok: true })),
}));

import { criarSessaoIncorporador, INCORPORADOR_COOKIE } from "@/lib/apolo/incorporador/sessao";
import {
  executarCadastroDeUnidades,
  PRODUTO_NAO_ENCONTRADO,
  type ProdutoDoCadastro,
} from "@/lib/hercules/cadastrar-unidades-panteon-server";

import { POST } from "./route";

type Perfil = { enterpriseIds?: string[]; slug?: string; tipo?: "comercial" | "incorporador" };

function requisicao(emp: null | string, corpo: unknown = { acao: "conferir" }, perfil: Perfil = {}, comCookie = true): Request {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste");
  const token = criarSessaoIncorporador(
    {
      enterpriseIds: perfil.enterpriseIds ?? ["37", "39", "100001", "group:Lagoa Bonita"],
      enterpriseIdsComCarteira: [],
      incorporadorId: "inc-cecilio",
      incorporadorNome: "Cecílio Rocha",
      slug: perfil.slug ?? "cecilio-rocha",
      tipo: perfil.tipo ?? "incorporador",
      usuarioId: "22222222-2222-4222-8222-222222222222",
      usuarioNome: "Time Cecílio",
    },
    Date.now(),
  );
  const url = `https://c2x.app.br/api/incorporador/produto/unidades/cadastrar${emp === null ? "" : `?emp=${encodeURIComponent(emp)}`}`;
  return new Request(url, {
    body: JSON.stringify(corpo),
    headers: comCookie ? { cookie: `${INCORPORADOR_COOKIE}=${token}` } : {},
    method: "POST",
  });
}

const executar = vi.mocked(executarCadastroDeUnidades);

function produto(sobre: Partial<ProdutoDoCadastro>): ProdutoDoCadastro {
  return { codigo: "X", enterpriseId: "37", id: "uuid", nome: "X", operadoPor: null, tipoProduto: "loteamento", ...sobre };
}

beforeEach(() => {
  vi.clearAllMocks();
  banco.escopoVigente = null;
  banco.leituras = 0;
  banco.revalidacao = "ok";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/incorporador/produto/unidades/cadastrar: a porta", () => {
  it("sem cookie é 401", async () => {
    const resposta = await POST(requisicao("37", { acao: "conferir" }, {}, false));
    expect(resposta.status).toBe(401);
    expect(executar).not.toHaveBeenCalled();
  });

  it("⚠️ portal de incorporador que não opera a venda é 404, e a regra nem é chamada", async () => {
    const resposta = await POST(requisicao("37", { acao: "importar" }, { slug: "cer" }));
    expect(resposta.status).toBe(404);
    expect(executar).not.toHaveBeenCalled();
  });

  it("⚠️ o portal comercial VENDE, mas não cadastra estoque: 404, e a regra nem é chamada", async () => {
    for (const acao of ["conferir", "importar", "atualizar"]) {
      const resposta = await POST(requisicao("37", { acao }, { slug: "gurgel", tipo: "comercial" }));
      expect(resposta.status).toBe(404);
    }
    expect(executar).not.toHaveBeenCalled();
    expect(banco.leituras).toBe(0);
  });

  it("sem emp é 400", async () => {
    const resposta = await POST(requisicao(null));
    expect(resposta.status).toBe(400);
    expect(executar).not.toHaveBeenCalled();
  });

  it("⚠️ emp fora da sessão é 404 com o texto de produto inexistente, sem chamar a regra", async () => {
    for (const emp of ["36", "100002", "group:Lagoa Bonita", "LBF"]) {
      const resposta = await POST(requisicao(emp));
      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual({ error: PRODUTO_NAO_ENCONTRADO });
    }
    expect(executar).not.toHaveBeenCalled();
  });

  it("a divisão de um grupo da sessão está no escopo (o grupo abre as divisões)", async () => {
    const resposta = await POST(requisicao("33"));
    expect(resposta.status).toBe(200);
  });
});

describe("POST /api/incorporador/produto/unidades/cadastrar: o que a regra recebe", () => {
  it("o pedido, o corpo e o autor DO COOKIE", async () => {
    const corpo = { acao: "importar", linhas: [{ lote: "1", quadra: "1" }] };
    const resposta = await POST(requisicao("37", corpo));
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ data: { criadas: 1 } });

    const entrada = executar.mock.calls[0]?.[0];
    expect(entrada?.pedido).toBe("37");
    expect(entrada?.corpo).toEqual(corpo);
    expect(entrada?.autor).toEqual({ id: "22222222-2222-4222-8222-222222222222", nome: "Time Cecílio" });
  });

  it("⚠️ a guarda é a régua do portal: fora da sessão, sem dono, de outro dono ou sem a 0170 recusa", async () => {
    // O pai do cadastro só vira id dentro da regra: é a guarda que decide por ele.
    await POST(requisicao("pai:qualquer-uuid"));
    const podeOperar = executar.mock.calls[0]?.[0].podeOperar;
    expect(podeOperar).toBeTypeOf("function");
    if (!podeOperar) return;

    const com = { com0170: true };
    expect(podeOperar(produto({ enterpriseId: "100001", operadoPor: "inc-cecilio" }), com)).toBe(true);
    // O Garden com a marca da Cecílio: é dela (D1), e a regra decide o que dá para fazer nele.
    expect(podeOperar(produto({ enterpriseId: "39", operadoPor: "inc-cecilio" }), com)).toBe(true);
    // Sem marca de operador é produto da Careli, mesmo com o id na sessão.
    expect(podeOperar(produto({ enterpriseId: "37" }), com)).toBe(false);
    expect(podeOperar(produto({ enterpriseId: "27" }), com)).toBe(false);
    expect(podeOperar(produto({ enterpriseId: "36", operadoPor: "inc-cecilio" }), com)).toBe(false);
    expect(podeOperar(produto({ enterpriseId: "100001", operadoPor: "inc-gurgel" }), com)).toBe(false);
    // Sem a 0170 a marca não é confiável: ninguém cadastra.
    expect(podeOperar(produto({ enterpriseId: "100001", operadoPor: "inc-cecilio" }), { com0170: false })).toBe(false);
  });

  it("⚠️ a falha sai com o status e o texto, SEM o detalhe técnico", async () => {
    executar.mockResolvedValueOnce({
      data: { linhas: [] },
      detalhe: "Migration 0171 não aplicada.",
      error: "O cadastro de apartamentos ainda não está liberado. Fale com a Careli.",
      ok: false,
      status: 503,
    });
    const resposta = await POST(requisicao("100001", { acao: "importar" }));
    expect(resposta.status).toBe(503);
    const json = await resposta.json();
    expect(json).toEqual({
      data: { linhas: [] },
      error: "O cadastro de apartamentos ainda não está liberado. Fale com a Careli.",
    });
    expect(JSON.stringify(json)).not.toContain("0171");
  });

  it("⚠️ só as ações que gravam passam pela revalidação do portal", async () => {
    await POST(requisicao("37", { acao: "conferir" }));
    await POST(requisicao("37", { acao: "modelo" }));
    expect(banco.leituras).toBe(0);

    for (const acao of ["criar", "importar", "atualizar"]) {
      banco.leituras = 0;
      const resposta = await POST(requisicao("37", { acao }));
      expect(resposta.status).toBe(200);
      expect(banco.leituras).toBe(1);
    }
  });

  it("⚠️ cookie velho não grava: a recusa da revalidação sai como veio (404 ou 503), e a regra não roda", async () => {
    banco.revalidacao = "fora";
    expect((await POST(requisicao("39", { acao: "atualizar" }))).status).toBe(404);

    banco.revalidacao = "indisponivel";
    expect((await POST(requisicao("39", { acao: "importar" }))).status).toBe(503);

    expect(executar).not.toHaveBeenCalled();
  });

  it("⚠️ o recorte que grava é o da sessão VIGENTE: produto revogado no Setup é 404", async () => {
    banco.escopoVigente = ["100001"];
    const revogado = await POST(requisicao("39", { acao: "atualizar" }));
    expect(revogado.status).toBe(404);
    expect(executar).not.toHaveBeenCalled();

    const mantido = await POST(requisicao("100001", { acao: "atualizar" }));
    expect(mantido.status).toBe(200);
    const podeOperar = executar.mock.calls[0]?.[0].podeOperar;
    // O Garden saiu do escopo vigente: nem com a marca a guarda o aceita.
    expect(podeOperar?.(produto({ enterpriseId: "39", operadoPor: "inc-cecilio" }), { com0170: true })).toBe(false);
  });

  it("corpo que não é JSON é 400", async () => {
    const req = requisicao("37");
    const quebrada = new Request(req.url, { body: "{nao-json", headers: req.headers, method: "POST" });
    const resposta = await POST(quebrada);
    expect(resposta.status).toBe(400);
    expect(executar).not.toHaveBeenCalled();
  });
});
