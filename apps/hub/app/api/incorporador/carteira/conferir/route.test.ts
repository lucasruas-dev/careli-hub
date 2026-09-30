import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessaoIncorporador } from "@/lib/apolo/incorporador/sessao";

// PAGAMENTOS A CONFERIR, NA ROTA DE VERDADE (30/09/2026).
//
// O que se trava aqui é a PORTA e a fiação: quem não tem o Garden no Financeiro não vê a rota (404),
// e o POST assina com o usuário da sessão e só manda à lib a cobrança e a observação. A régua da
// lista tem teste próprio em lib/lsoft/pagamentos-a-conferir.test.ts. Tudo sintético.

const m = vi.hoisted(() => ({
  autorizado: true,
  idsDaSessao: vi.fn(),
  ler: vi.fn(),
  marcar: vi.fn(),
  sessao: null as unknown,
}));

vi.mock("@/lib/apolo/incorporador/escopo", () => ({
  autorizar: () =>
    m.autorizado
      ? { ok: true, sessao: m.sessao }
      : { ok: false, response: NextResponse.json({ error: "Sessão expirada." }, { status: 401 }) },
  foraDoEscopo: () => NextResponse.json({ error: "Nao encontrado." }, { status: 404 }),
  idsDaSessao: m.idsDaSessao,
}));
vi.mock("@/lib/lsoft/pagamentos-a-conferir", async (original) => ({
  ...(await original<typeof import("@/lib/lsoft/pagamentos-a-conferir")>()),
  lerPagamentosAConferir: m.ler,
  marcarPagamentoConferido: m.marcar,
}));
vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => null }));

const { GET, POST } = await import("./route");

const IMPRESSAO = "0123456789abcdef";

const sessao = (parcial: Partial<SessaoIncorporador> = {}): SessaoIncorporador => ({
  enterpriseIds: ["37", "39"],
  enterpriseIdsComCarteira: ["37", "39"],
  exp: Date.now() + 60_000,
  incorporadorId: "inc-1",
  incorporadorNome: "Loteadora Teste",
  slug: "cecilio-rocha",
  tipo: "incorporador",
  usuarioId: "u-1",
  usuarioNome: "Usuária Teste",
  ...parcial,
});

const pedido = (corpo?: unknown) =>
  new Request("https://c2x.app.br/api/incorporador/carteira/conferir", {
    ...(corpo === undefined
      ? {}
      : { body: JSON.stringify(corpo), headers: { "Content-Type": "application/json" }, method: "POST" }),
  });

beforeEach(() => {
  m.autorizado = true;
  m.sessao = sessao();
  m.idsDaSessao.mockReset().mockResolvedValue(["37", "39"]);
  m.ler.mockReset().mockResolvedValue({
    conferidoIndisponivel: false,
    grupos: { conferir: [{ cobrancaId: "pay_a" }], integracao: [] },
    ok: true,
  });
  m.marcar.mockReset().mockResolvedValue({ ok: true });
});

describe("a porta", () => {
  it("sem sessão do portal, devolve a resposta do autorizar e não lê nada", async () => {
    m.autorizado = false;
    const r = await GET(pedido());
    expect(r.status).toBe(401);
    expect(m.ler).not.toHaveBeenCalled();
  });

  it("portal que não vê a base do LSoft: 404, sem ler", async () => {
    m.sessao = sessao({ slug: "vistaalegre" });
    expect((await GET(pedido())).status).toBe(404);
    expect((await POST(pedido({ cobrancaId: "pay_a", impressao: IMPRESSAO, observacao: "conferido" }))).status).toBe(404);
    expect(m.ler).not.toHaveBeenCalled();
    expect(m.marcar).not.toHaveBeenCalled();
  });

  it("modo comercial (coordenador): 404, mesmo no slug que vê o LSoft", async () => {
    m.sessao = sessao({ tipo: "comercial" });
    expect((await GET(pedido())).status).toBe(404);
    expect(m.ler).not.toHaveBeenCalled();
  });

  it("⚠️ sem o Garden (39) no escopo da sessão: 404 (o `cer` vê o LSoft, mas só tem o VOC)", async () => {
    m.sessao = sessao({ slug: "cer" });
    m.idsDaSessao.mockResolvedValue(["37"]);
    expect((await GET(pedido())).status).toBe(404);
    expect((await POST(pedido({ cobrancaId: "pay_a", impressao: IMPRESSAO, observacao: "conferido" }))).status).toBe(404);
    expect(m.ler).not.toHaveBeenCalled();
    expect(m.marcar).not.toHaveBeenCalled();
  });
});

describe("GET", () => {
  it("devolve os dois grupos e se o Conferido está disponível, sem cache", async () => {
    const r = await GET(pedido());
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(await r.json()).toEqual({
      data: { conferidoDisponivel: true, conferir: [{ cobrancaId: "pay_a" }], integracao: [] },
    });
  });

  it("falha de leitura vira 503 genérico: o detalhe do banco não atravessa para o portal", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    m.ler.mockResolvedValue({ erro: "relation lsoft_parcelas: statement timeout", ok: false });
    const r = await GET(pedido());
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain("lsoft_parcelas");
    erro.mockRestore();
  });
});

describe("POST", () => {
  it("⚠️ assina com o usuário da SESSÃO e ignora autor, motivo e origem mandados no corpo", async () => {
    const r = await POST(
      pedido({
        autor: "Outra Pessoa",
        cobrancaId: "  pay_a  ",
        impressao: IMPRESSAO,
        motivo: "qualquer",
        observacao: "  baixa dada na ficha  ",
        origem: "careli",
      }),
    );
    expect(r.status).toBe(200);
    expect(m.marcar).toHaveBeenCalledTimes(1);
    expect(m.marcar).toHaveBeenCalledWith({
      autor: "Usuária Teste (cecilio-rocha)",
      cobrancaId: "pay_a",
      impressao: IMPRESSAO,
      observacao: "baixa dada na ficha",
      origem: "incorporador",
    });
  });

  it("sem cobrança ou sem observação que sirva: 400, e nada é gravado", async () => {
    expect((await POST(pedido({ impressao: IMPRESSAO, observacao: "conferido" }))).status).toBe(400);
    expect((await POST(pedido({ cobrancaId: "pay_a", impressao: IMPRESSAO, observacao: "ok" }))).status).toBe(400);
    expect((await POST(pedido({ cobrancaId: "pay_a", impressao: IMPRESSAO }))).status).toBe(400);
    expect((await POST(pedido({ cobrancaId: 12, impressao: IMPRESSAO, observacao: "conferido" }))).status).toBe(400);
    // Sem a impressao do motivo que a pessoa viu (ou com uma que nao e um hash), o pedido nem chega a lib.
    expect((await POST(pedido({ cobrancaId: "pay_a", observacao: "conferido" }))).status).toBe(400);
    expect((await POST(pedido({ cobrancaId: "pay_a", impressao: "conferir|texto cru", observacao: "conferido" }))).status).toBe(400);
    expect(m.marcar).not.toHaveBeenCalled();
  });

  it("devolve o erro e o status da lib (o pagamento que já saiu da lista é 404)", async () => {
    m.marcar.mockResolvedValue({ erro: "Este pagamento não está mais na lista.", ok: false, status: 404 });
    const r = await POST(pedido({ cobrancaId: "pay_z", impressao: IMPRESSAO, observacao: "conferido" }));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "Este pagamento não está mais na lista." });

    m.marcar.mockResolvedValue({ erro: "Este pagamento mudou desde que a lista foi aberta. Confira de novo.", ok: false, status: 409 });
    expect((await POST(pedido({ cobrancaId: "pay_a", impressao: IMPRESSAO, observacao: "conferido" }))).status).toBe(409);
  });
});
