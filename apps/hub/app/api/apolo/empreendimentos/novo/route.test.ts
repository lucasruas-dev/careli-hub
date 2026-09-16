import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA DO HUB QUE CADASTRA PRODUTO. O que se trava aqui:
//   1. o portão é o de ESCRITA do Apolo (viewer não cadastra produto);
//   2. sem `operadoPorIncorporadorSlug`, a Careli opera; com ele, o id vem do BANCO;
//   3. portal inexistente ou desativado é recusado ANTES de chegar ao cadastro.
//
// ⚠️ `cadastrarProduto` é trocado por um espião, como na rota do portal: a régua e as gravações têm
// teste próprio (lib/hercules/cadastrar-produto-server.test.ts).
const estado = vi.hoisted(() => ({
  incorporador: null as null | Record<string, unknown>,
  leituraFalha: false,
  papel: "operator" as "admin" | "leader" | "operator" | "viewer",
  pedidos: [] as unknown[],
  portoes: [] as string[],
  slugsLidos: [] as unknown[],
}));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloWrite: async (request: Request) => {
    estado.portoes.push("write");
    if (!/^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "")) {
      return { ok: false, response: Response.json({ error: "Sessao do Apolo ausente." }, { status: 401 }) };
    }
    if (!["admin", "leader", "operator"].includes(estado.papel)) {
      return { ok: false, response: Response.json({ error: "Usuario sem acesso ao Apolo." }, { status: 403 }) };
    }
    return { nome: "Lucas", ok: true, userId: "a1a1a1a1-1111-4222-8333-444455556666" };
  },
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [],
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from: () => {
      const builder = {
        eq: () => builder,
        ilike: (_coluna: string, valor: unknown) => {
          estado.slugsLidos.push(valor);
          return builder;
        },
        maybeSingle: async () =>
          estado.leituraFalha
            ? { data: null, error: { message: "timeout" } }
            : { data: estado.incorporador, error: null },
        select: () => builder,
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/hercules/cadastrar-produto-server", async (original) => ({
  ...(await original<typeof import("@/lib/hercules/cadastrar-produto-server")>()),
  cadastrarProduto: async (_admin: unknown, pedido: { incorporadorId: null | string }) => {
    estado.pedidos.push(pedido);
    return {
      ok: true,
      produto: {
        codigo: "VDS",
        enterpriseId: "100001",
        nome: "Vale do Sol",
        operadoPor: pedido.incorporadorId,
        paiId: null,
        produtoId: "0b8f9f5e-0000-4000-8000-000000000002",
        tipoProduto: "loteamento",
        vinculadoAConta: false,
        vinculadoAoPortal: Boolean(pedido.incorporadorId),
      },
    };
  },
}));

import { POST } from "./route";

const CECILIO = "5d1c7a8e-1111-4222-8333-444455556666";

function pedir(corpo: unknown, autenticado = true) {
  return new Request("http://localhost/api/apolo/empreendimentos/novo", {
    body: JSON.stringify(corpo),
    headers: {
      "content-type": "application/json",
      ...(autenticado ? { authorization: "Bearer token-do-hub" } : {}),
    },
    method: "POST",
  });
}

const CORPO = { cidade: "Ipatinga", codigo: "VDS", nome: "Vale do Sol", tipoProduto: "loteamento", uf: "MG" };

beforeEach(() => {
  estado.incorporador = { ativo: true, id: CECILIO, slug: "cecilio-rocha", tipo: "incorporador" };
  estado.leituraFalha = false;
  estado.papel = "operator";
  estado.pedidos = [];
  estado.portoes = [];
  estado.slugsLidos = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("o portão", () => {
  it("é o de escrita do Apolo: sem sessão 401, viewer 403, e nada chega ao cadastro", async () => {
    expect((await POST(pedir(CORPO, false))).status).toBe(401);
    estado.papel = "viewer";
    expect((await POST(pedir(CORPO))).status).toBe(403);
    expect(estado.portoes).toEqual(["write", "write"]);
    expect(estado.pedidos).toHaveLength(0);
  });
});

describe("quem opera", () => {
  it("sem slug: a Careli opera, origem hub, autor do hub", async () => {
    const resposta = await POST(pedir(CORPO));
    expect(resposta.status).toBe(201);
    expect(estado.pedidos).toEqual([
      {
        autor: { id: "a1a1a1a1-1111-4222-8333-444455556666", nome: "Lucas" },
        entrada: { cidade: "Ipatinga", codigo: "VDS", nome: "Vale do Sol", paiCodigo: null, tipoProduto: "loteamento", uf: "MG" },
        incorporadorId: null,
        origem: "hub",
      },
    ]);
    expect(estado.slugsLidos).toHaveLength(0);
    expect((await resposta.json()).data).toMatchObject({ enterpriseId: "100001", operadoPor: null });
  });

  it("⚠️ com slug: o id é o do banco, e um uuid no corpo não passa", async () => {
    const resposta = await POST(
      pedir({ ...CORPO, operadoPor: "9a9a9a9a-1111-4222-8333-444455556666", operadoPorIncorporadorSlug: "Cecilio-Rocha" }),
    );
    expect(resposta.status).toBe(201);
    expect(estado.slugsLidos).toEqual(["cecilio-rocha"]);
    expect(estado.pedidos).toHaveLength(1);
    expect(estado.pedidos[0]).toMatchObject({ incorporadorId: CECILIO, origem: "hub" });
  });

  it("portal inexistente ou desativado: 422 no campo, sem cadastrar", async () => {
    estado.incorporador = null;
    const inexistente = await POST(pedir({ ...CORPO, operadoPorIncorporadorSlug: "nao-existe" }));
    expect(inexistente.status).toBe(422);
    expect((await inexistente.json()).erros.operadoPorIncorporadorSlug).toMatch(/nao-existe/);

    estado.incorporador = { ativo: false, id: CECILIO, slug: "cecilio-rocha", tipo: "incorporador" };
    expect((await POST(pedir({ ...CORPO, operadoPorIncorporadorSlug: "cecilio-rocha" }))).status).toBe(422);
    expect(estado.pedidos).toHaveLength(0);
  });

  it("⚠️ portal comercial (a Gurgel) não opera produto: 422 no campo, sem cadastrar", async () => {
    estado.incorporador = { ativo: true, id: "7b7b7b7b-1111-4222-8333-444455556666", slug: "gurgel", tipo: "comercial" };
    const resposta = await POST(pedir({ ...CORPO, operadoPorIncorporadorSlug: "gurgel" }));
    expect(resposta.status).toBe(422);
    expect((await resposta.json()).erros.operadoPorIncorporadorSlug).toMatch(/portal comercial não opera produto/);
    expect(estado.pedidos).toHaveLength(0);
  });

  it("banco fora ao conferir o portal: 503, sem cadastrar", async () => {
    estado.leituraFalha = true;
    expect((await POST(pedir({ ...CORPO, operadoPorIncorporadorSlug: "cecilio-rocha" }))).status).toBe(503);
    expect(estado.pedidos).toHaveLength(0);
  });
});
