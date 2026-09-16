import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA DO PORTAL QUE CADASTRA PRODUTO. O que se trava aqui:
//   1. portal que não opera a venda recebe 404, sem ler nem gravar nada;
//   2. quem opera o produto sai da SESSÃO conferida no banco, nunca do corpo;
//   3. sessão velha (conta desativada, portal de outro id, portal que deixou de operar) não grava: a
//      revalidação é a ÚNICA do portal que opera sozinho (`autorizarPortalQueOperaSozinho`), e a
//      recusa dela sai como veio;
//   4. a resposta manda a tela recarregar a sessão, porque o escopo do cookie ainda não tem o produto.
//
// ⚠️ `cadastrarProduto` é trocado por um espião: a régua e as gravações têm teste próprio
// (lib/hercules/cadastrar-produto-server.test.ts). Aqui o que importa é o que a rota MANDA para ela.
const estado = vi.hoisted(() => ({
  pedidos: [] as unknown[],
  resultado: null as unknown,
  revalidacao: "ok" as "fora" | "indisponivel" | "ok",
  revalidacoes: 0,
  sessao: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/apolo/incorporador/sessao", () => ({
  empreendimentosPermitidos: () => [],
  sessaoDoRequest: () => estado.sessao,
}));

// A revalidação de verdade (portal, conta e escopo no banco) tem teste próprio. Aqui ela é a porta que
// `autorizarPortalQueOperaSozinho` chama, com as três respostas possíveis.
vi.mock("@/lib/temis/portao-do-portal", async () => {
  const { NextResponse } = await import("next/server");
  return {
    autorizarTemisDoPortal: async () => {
      estado.revalidacoes += 1;
      if (estado.revalidacao === "fora") {
        return { ok: false, response: NextResponse.json({ error: "Nao encontrado." }, { status: 404 }) };
      }
      if (estado.revalidacao === "indisponivel") {
        return {
          ok: false,
          response: NextResponse.json({ error: "Não foi possível conferir o acesso agora." }, { status: 503 }),
        };
      }
      return { ok: true, sessao: estado.sessao };
    },
  };
});

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [],
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({ from: () => null }),
}));

vi.mock("@/lib/hercules/cadastrar-produto-server", async (original) => ({
  ...(await original<typeof import("@/lib/hercules/cadastrar-produto-server")>()),
  cadastrarProduto: async (_admin: unknown, pedido: unknown) => {
    estado.pedidos.push(pedido);
    return estado.resultado;
  },
}));

import { POST } from "./route";

const CECILIO = "5d1c7a8e-1111-4222-8333-444455556666";
const CONTA = "c0c0c0c0-1111-4222-8333-444455556666";

function sessaoDoCecilio(extra: Record<string, unknown> = {}) {
  return {
    enterpriseIds: ["37", "39"],
    enterpriseIdsComCarteira: ["37", "39"],
    exp: Date.now() + 60_000,
    incorporadorId: CECILIO,
    incorporadorNome: "Cecílio Rocha",
    slug: "cecilio-rocha",
    tipo: "incorporador",
    usuarioId: CONTA,
    usuarioNome: "Ana",
    ...extra,
  };
}

function pedir(corpo: unknown) {
  return new Request("http://localhost/api/incorporador/produtos/novo", {
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

const CORPO = {
  cidade: "Ipatinga",
  codigo: "JAD",
  incorporadorId: "9a9a9a9a-1111-4222-8333-444455556666",
  nome: "Ed. Jade",
  operadoPor: "9a9a9a9a-1111-4222-8333-444455556666",
  tipoProduto: "vertical",
  uf: "MG",
};

beforeEach(() => {
  estado.pedidos = [];
  estado.revalidacao = "ok";
  estado.revalidacoes = 0;
  estado.resultado = {
    ok: true,
    produto: {
      codigo: "JAD",
      enterpriseId: "100000",
      nome: "Ed. Jade",
      operadoPor: CECILIO,
      paiId: null,
      produtoId: "0b8f9f5e-0000-4000-8000-000000000001",
      tipoProduto: "vertical",
      vinculadoAConta: false,
      vinculadoAoPortal: true,
    },
  };
  estado.sessao = sessaoDoCecilio();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("quem pode cadastrar", () => {
  it("sem sessão: 401", async () => {
    estado.sessao = null;
    const resposta = await POST(pedir(CORPO));
    expect(resposta.status).toBe(401);
    expect(estado.pedidos).toHaveLength(0);
  });

  it("⚠️ portal que não opera a venda: 404, e nada chega ao cadastro", async () => {
    estado.sessao = sessaoDoCecilio({ incorporadorId: "11111111-1111-4111-8111-111111111111", slug: "lino", tipo: "incorporador" });
    const resposta = await POST(pedir(CORPO));
    expect(resposta.status).toBe(404);
    expect(estado.pedidos).toHaveLength(0);
  });

  it("⚠️ portal COMERCIAL opera a venda, mas não cadastra produto: 404, e nada chega ao cadastro", async () => {
    estado.sessao = sessaoDoCecilio({ slug: "gurgel", tipo: "comercial" });
    expect((await POST(pedir(CORPO))).status).toBe(404);
    expect(estado.pedidos).toHaveLength(0);
    // O comercial morre antes da revalidação: não paga ida ao banco.
    expect(estado.revalidacoes).toBe(0);
  });

  it("⚠️ a revalidação do portal recusa (conta desativada, portal desligado, de outro id ou que virou comercial): 404", async () => {
    estado.revalidacao = "fora";
    expect((await POST(pedir(CORPO))).status).toBe(404);
    expect(estado.revalidacoes).toBe(1);
    expect(estado.pedidos).toHaveLength(0);
  });

  it("não deu para conferir a conta ou o portal: 503", async () => {
    estado.revalidacao = "indisponivel";
    expect((await POST(pedir(CORPO))).status).toBe(503);
    expect(estado.pedidos).toHaveLength(0);
  });

  it("corpo que não é JSON: 400", async () => {
    expect((await POST(pedir("{quebrado"))).status).toBe(400);
  });
});

describe("o que a rota manda para o cadastro", () => {
  it("⚠️ operador e autor saem da sessão; `operadoPor` e `incorporadorId` do corpo são ignorados", async () => {
    await POST(pedir(CORPO));
    expect(estado.pedidos).toEqual([
      {
        autor: { id: CONTA, nome: "Ana" },
        entrada: { cidade: "Ipatinga", codigo: "JAD", nome: "Ed. Jade", paiCodigo: null, tipoProduto: "vertical", uf: "MG" },
        incorporadorId: CECILIO,
        origem: "portal",
        // O portal vai junto: é com ele que o pai possível passa pela régua única do portal.
        portal: { slug: "cecilio-rocha", tipo: "incorporador" },
      },
    ]);
  });
});

describe("a resposta", () => {
  it("⚠️ 201 com o id gerado e o aviso para recarregar a sessão", async () => {
    const resposta = await POST(pedir(CORPO));
    expect(resposta.status).toBe(201);
    expect(await resposta.json()).toEqual({
      data: {
        codigo: "JAD",
        enterpriseId: "100000",
        nome: "Ed. Jade",
        produtoId: "0b8f9f5e-0000-4000-8000-000000000001",
        recarregarSessao: true,
        tipoProduto: "vertical",
      },
    });
  });

  it("erro de campo (inclusive o 23505 da corrida) sai como 422 com `erros`", async () => {
    estado.resultado = {
      erro: "Confira os campos destacados.",
      erros: { codigo: "O código JAD acabou de ser usado por outro cadastro. Escolha outro." },
      ok: false,
      status: 422,
    };
    const resposta = await POST(pedir(CORPO));
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual({
      error: "Confira os campos destacados.",
      erros: { codigo: "O código JAD acabou de ser usado por outro cadastro. Escolha outro." },
    });
  });
});
