import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/apolo/cadastro/salvar — O HUB NÃO MUDA COM A EXTRAÇÃO (16/09/2026).
//
// A regra saiu para `lib/apolo/cadastro-salvar.ts` (o CRM do portal chama a mesma função). O que
// está travado aqui é a PORTA do hub: quem é o autor (operador do Bearer, staging `u-`), as origens
// de sempre e as respostas de sempre, inclusive o 409 com `entityIdExistente` que o time da Careli
// usa para abrir a ficha existente.

const estado = vi.hoisted(() => ({
  autorizado: true,
  salvar: vi.fn(),
}));

vi.mock("@/lib/apolo/auth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    authorizeApoloRead: async () =>
      estado.autorizado
        ? { nome: "Operador", ok: true, userId: "operador-1" }
        : { ok: false, response: NextResponse.json({ error: "x" }, { status: 401 }) },
  };
});

vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => ({}) }));
vi.mock("@/lib/apolo/cadastro-salvar", () => ({ salvarCadastroDoApolo: estado.salvar }));

import { POST } from "./route";

function pedido(corpo: unknown = { persona: "pf", role: "prospect" }): Request {
  return new Request("https://c2x.app.br/api/apolo/cadastro/salvar", {
    body: JSON.stringify(corpo),
    headers: { authorization: "Bearer x" },
    method: "POST",
  });
}

beforeEach(() => {
  estado.autorizado = true;
  estado.salvar.mockReset();
});

describe("POST /api/apolo/cadastro/salvar", () => {
  it("sem login não chama a regra", async () => {
    estado.autorizado = false;
    expect((await POST(pedido())).status).toBe(401);
    expect(estado.salvar).not.toHaveBeenCalled();
  });

  it("autor é o operador do hub, com as origens de sempre", async () => {
    estado.salvar.mockResolvedValue({
      corpo: { autenticacao: "A", cadBase64: null, entityId: "e", ok: true, savedDocs: [], warnings: [] },
      esteira: "gravada",
      ok: true,
    });
    const r = await POST(pedido());
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({
      autenticacao: "A",
      cadBase64: null,
      entityId: "e",
      ok: true,
      savedDocs: [],
      warnings: [],
    });
    const chamada = estado.salvar.mock.calls[0]?.[0];
    expect(chamada).toMatchObject({
      autor: { donoUpload: "u-operador-1", ownerUserId: "operador-1", registro: null },
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
    });
  });

  it("duplicado: 409 com o id da ficha existente e a frase inteira (é o time da Careli)", async () => {
    estado.salvar.mockResolvedValue({
      ok: false,
      recusa: {
        entityIdExistente: "ent-velha",
        error: "Este CPF já tem CAD cadastrada no empreendimento VALE DO OURO.",
        motivo: "cad-no-empreendimento",
        ok: false,
      },
      tipo: "recusado",
    });
    const r = await POST(pedido());
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      entityIdExistente: "ent-velha",
      error: "Este CPF já tem CAD cadastrada no empreendimento VALE DO OURO.",
      jaExiste: true,
    });
  });

  it("recusa sem ficha existente é 500; corpo inválido mantém o status da regra", async () => {
    estado.salvar.mockResolvedValueOnce({
      ok: false,
      recusa: { error: "Nao foi possivel criar a entidade: x", ok: false },
      tipo: "recusado",
    });
    expect((await POST(pedido())).status).toBe(500);

    estado.salvar.mockResolvedValueOnce({
      error: "Maximo de 40 arquivos por cadastro.",
      ok: false,
      status: 413,
      tipo: "invalido",
    });
    const r = await POST(pedido());
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ error: "Maximo de 40 arquivos por cadastro." });
  });
});
