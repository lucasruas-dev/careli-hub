import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/temis/trabalhos — O BOARD DA CARELI NÃO MOSTRA O QUE A CECÍLIO CONFECCIONA.
//
// Decisão do Lucas (16/09/2026): a venda do time da Cecílio é confeccionada no portal dela. O que
// está travado aqui é o combinado para a Têmis da Careli: o padrão é `careli`, e só
// `?incluir=incorporadores` pede a fila inteira. Nada mais da rota muda.

const estado = vi.hoisted(() => ({
  autorizado: true,
  board: vi.fn(async () => []),
}));

vi.mock("@/lib/apolo/auth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    authorizeApoloRead: async () =>
      estado.autorizado
        ? { nome: "Jurídico", ok: true, userId: "user-hub" }
        : { ok: false, response: NextResponse.json({ error: "x" }, { status: 401 }) },
  };
});

vi.mock("@/lib/temis/trabalhos-db", () => ({
  abrirTrabalho: vi.fn(),
  marcarAtividade: vi.fn(),
  trabalhosDoBoard: estado.board,
}));

import { GET } from "@/app/api/temis/trabalhos/route";

function pedido(query = ""): Request {
  return new Request(`https://c2x.app.br/api/temis/trabalhos${query}`, {
    headers: { authorization: "Bearer x" },
  });
}

describe("GET /api/temis/trabalhos, recorte de dono", () => {
  beforeEach(() => {
    estado.autorizado = true;
    estado.board.mockClear();
  });

  it("sem parâmetro, lê só os trabalhos da Careli", async () => {
    const r = await GET(pedido());
    expect(r.status).toBe(200);
    expect(estado.board).toHaveBeenCalledWith({
      comAssinaturas: true,
      enterpriseId: undefined,
      operadoPor: "careli",
    });
  });

  it("?incluir=incorporadores é a supervisão: a fila inteira", async () => {
    await GET(pedido("?incluir=incorporadores&empreendimento=37"));
    expect(estado.board).toHaveBeenCalledWith({
      comAssinaturas: true,
      enterpriseId: "37",
      operadoPor: "todos",
    });
  });

  it("outro valor de incluir não abre nada", async () => {
    await GET(pedido("?incluir=tudo"));
    expect(estado.board).toHaveBeenCalledWith(expect.objectContaining({ operadoPor: "careli" }));
  });

  it("sem login do hub, nem consulta", async () => {
    estado.autorizado = false;
    const r = await GET(pedido());
    expect(r.status).toBe(401);
    expect(estado.board).not.toHaveBeenCalled();
  });
});
