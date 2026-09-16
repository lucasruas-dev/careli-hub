import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA DO HUB PARA CADASTRAR UNIDADES NO PANTEON.
//
// A regra está provada em lib/hercules/cadastrar-unidades-panteon-server.test.ts. Aqui se prova a
// porta: `authorizeApoloWrite` manda, o autor é o usuário do hub, não há guarda de recorte (o time
// da Careli alcança qualquer produto) e o detalhe técnico SAI na resposta (ao contrário do portal).

const estado = vi.hoisted(() => ({ autorizado: true }));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloWrite: vi.fn(async () =>
    estado.autorizado
      ? { nome: "Lucas", ok: true, userId: "33333333-3333-4333-8333-333333333333" }
      : { ok: false, response: NextResponse.json({ error: "Usuario sem acesso ao Apolo." }, { status: 403 }) },
  ),
}));

vi.mock("@/lib/hercules/cadastrar-unidades-panteon-server", () => ({
  executarCadastroDeUnidades: vi.fn(async () => ({ data: { criadas: 2 }, ok: true })),
}));

import { executarCadastroDeUnidades } from "@/lib/hercules/cadastrar-unidades-panteon-server";

import { POST } from "./route";

const executar = vi.mocked(executarCadastroDeUnidades);

function requisicao(corpo: unknown): Request {
  return new Request("https://c2x.app.br/api/apolo/empreendimentos/unidades/panteon", {
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    headers: { authorization: "Bearer token" },
    method: "POST",
  });
}

beforeEach(() => {
  estado.autorizado = true;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/apolo/empreendimentos/unidades/panteon", () => {
  it("sem papel de escrita devolve a resposta do gate, sem chamar a regra", async () => {
    estado.autorizado = false;
    const resposta = await POST(requisicao({ acao: "importar", enterpriseId: "39" }));
    expect(resposta.status).toBe(403);
    expect(executar).not.toHaveBeenCalled();
  });

  it("corpo inválido e empreendimento ausente são 400", async () => {
    expect((await POST(requisicao("{nao-json"))).status).toBe(400);
    expect((await POST(requisicao(["x"]))).status).toBe(400);
    expect((await POST(requisicao({ acao: "importar" }))).status).toBe(400);
    expect(executar).not.toHaveBeenCalled();
  });

  it("passa o produto, o corpo e o autor do hub, sem guarda de recorte", async () => {
    const corpo = { acao: "importar", enterpriseId: " 100001 ", linhas: [{ apartamento: "101" }] };
    const resposta = await POST(requisicao(corpo));
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ data: { criadas: 2 } });

    const entrada = executar.mock.calls[0]?.[0];
    expect(entrada?.pedido).toBe("100001");
    expect(entrada?.corpo).toEqual(corpo);
    expect(entrada?.autor).toEqual({ id: "33333333-3333-4333-8333-333333333333", nome: "Lucas" });
    expect(entrada?.podeOperar).toBeUndefined();
  });

  it("a falha sai com status, texto, dados e o detalhe técnico", async () => {
    executar.mockResolvedValueOnce({
      data: { linhas: [] },
      detalhe: "Migration 0171 não aplicada.",
      error: "O cadastro de apartamentos ainda não está liberado. Fale com a Careli.",
      ok: false,
      status: 503,
    });
    const resposta = await POST(requisicao({ acao: "importar", enterpriseId: "100001" }));
    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual({
      data: { linhas: [] },
      detalhe: "Migration 0171 não aplicada.",
      error: "O cadastro de apartamentos ainda não está liberado. Fale com a Careli.",
    });
  });
});
