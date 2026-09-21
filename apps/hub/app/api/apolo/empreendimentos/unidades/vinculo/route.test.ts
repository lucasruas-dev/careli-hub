import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA DO HUB PARA O VÍNCULO DA UNIDADE.
//
// A regra está provada em lib/apolo/vinculo-de-unidades-servidor.test.ts. Aqui se prova a PORTA:
// escrita exige `authorizeApoloWrite`, leitura exige `authorizeApoloRead`, o autor é o usuário do
// hub (é ele que vai para o carimbo) e o detalhe técnico SAI na resposta.

const estado = vi.hoisted(() => ({ escrita: true, leitura: true }));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloRead: vi.fn(async () =>
    estado.leitura
      ? { nome: "Lucas", ok: true, userId: "33333333-3333-4333-8333-333333333333" }
      : { ok: false, response: NextResponse.json({ error: "Sem acesso." }, { status: 403 }) },
  ),
  authorizeApoloWrite: vi.fn(async () =>
    estado.escrita
      ? { nome: "Lucas", ok: true, userId: "33333333-3333-4333-8333-333333333333" }
      : { ok: false, response: NextResponse.json({ error: "Sem escrita." }, { status: 403 }) },
  ),
}));

vi.mock("@/lib/apolo/vinculo-de-unidades-servidor", () => ({
  executarVinculoDeUnidades: vi.fn(async () => ({ data: { gravadas: 2 }, ok: true })),
}));

import { executarVinculoDeUnidades } from "@/lib/apolo/vinculo-de-unidades-servidor";

import { GET, POST } from "./route";

const executar = vi.mocked(executarVinculoDeUnidades);
const ROTA = "https://c2x.app.br/api/apolo/empreendimentos/unidades/vinculo";

function post(corpo: unknown): Request {
  return new Request(ROTA, {
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    headers: { authorization: "Bearer token" },
    method: "POST",
  });
}

beforeEach(() => {
  estado.escrita = true;
  estado.leitura = true;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST", () => {
  it("sem papel de escrita devolve o gate, sem chamar a regra", async () => {
    estado.escrita = false;
    const resposta = await POST(post({ acao: "aplicar", enterpriseId: "27" }));
    expect(resposta.status).toBe(403);
    expect(executar).not.toHaveBeenCalled();
  });

  it("corpo inválido é 400", async () => {
    expect((await POST(post("{nao-json"))).status).toBe(400);
    expect((await POST(post(["x"]))).status).toBe(400);
    expect(executar).not.toHaveBeenCalled();
  });

  // ⚠️ O AUTOR VAI PARA O CARIMBO (0181): sem ele, "quem vinculou este lote?" fica sem resposta.
  it("passa o corpo inteiro e o autor do hub", async () => {
    const corpo = { acao: "aplicar", categoriaId: "cat", enterpriseId: "27", unidadeIds: ["u1"] };
    const resposta = await POST(post(corpo));
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ data: { gravadas: 2 } });

    const entrada = executar.mock.calls[0]?.[0];
    expect(entrada?.corpo).toEqual(corpo);
    expect(entrada?.autor).toEqual({ id: "33333333-3333-4333-8333-333333333333", nome: "Lucas" });
  });

  it("a falha sai com status, texto e o detalhe técnico", async () => {
    executar.mockResolvedValueOnce({
      detalhe: "Migration 0181 não aplicada.",
      error: "Não foi possível concluir o vínculo agora.",
      ok: false,
      status: 503,
    });
    const resposta = await POST(post({ acao: "aplicar", enterpriseId: "27" }));
    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual({
      detalhe: "Migration 0181 não aplicada.",
      error: "Não foi possível concluir o vínculo agora.",
    });
  });
});

describe("GET", () => {
  it("sem leitura devolve o gate", async () => {
    estado.leitura = false;
    const resposta = await GET(new Request(`${ROTA}?enterpriseId=27`));
    expect(resposta.status).toBe(403);
    expect(executar).not.toHaveBeenCalled();
  });

  // ⚠️ A LISTA QUE A TELA ESCOLHE E A LISTA QUE O SERVIDOR CARIMBA SÃO A MESMA FUNÇÃO.
  it("monta a ação universo com o filtro da query", async () => {
    await GET(new Request(`${ROTA}?enterpriseId=27&codigo=LBR&faixa=1-40&quadras=C,D`));
    const corpo = executar.mock.calls[0]?.[0]?.corpo as {
      acao: string;
      codigo: string;
      enterpriseId: string;
      filtro: { faixa: string; quadras: string[] };
    };
    expect(corpo.acao).toBe("universo");
    expect(corpo.enterpriseId).toBe("27");
    expect(corpo.codigo).toBe("LBR");
    expect(corpo.filtro.faixa).toBe("1-40");
    expect(corpo.filtro.quadras).toEqual(["C", "D"]);
  });
});
