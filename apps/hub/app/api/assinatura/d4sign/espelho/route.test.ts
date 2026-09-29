import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA DA RODADA DO ESPELHO DA D4SIGN (F3 da fonte única, seção 6, "Autenticação").
//   • GET: SÓ `Authorization: Bearer <CRON_SECRET>` (timingSafeEqual); `x-vercel-cron` não vale; segredo
//     vazio → 503.
//   • POST: admin do Hub; ensaio por padrão, grava só com `?gravar=1`; recusa `refazer` e teto infinito;
//     `so` só inteiros, até 50.

const m = vi.hoisted(() => ({
  chamadas: [] as Array<{ opcoes: Record<string, unknown> }>,
  papel: "admin",
}));

vi.mock("@/lib/assinatura/espelho-d4sign/espelho", async (original) => ({
  ...(await original<typeof import("@/lib/assinatura/espelho-d4sign/espelho")>()),
  espelharD4Sign: async (entrada: { opcoes: Record<string, unknown> }) => {
    m.chamadas.push({ opcoes: entrada.opcoes });
    return { falhas: [], gravou: entrada.opcoes.gravar };
  },
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ config: {}, ok: true, pool: {} }),
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    auth: {
      getUser: async (token: string) =>
        token === "sessao-boa" ? { data: { user: { id: "u-admin" } }, error: null } : { data: { user: null }, error: { message: "x" } },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: "u-admin", role: m.papel, status: "active" }, error: null }),
        }),
      }),
    }),
  }),
}));

const { GET, POST } = await import("./route");

const URL_DA_ROTA = "https://c2x.app.br/api/assinatura/d4sign/espelho";

function pedido(metodo: "GET" | "POST", cabecalhos: Record<string, string> = {}, busca = ""): NextRequest {
  return new NextRequest(`${URL_DA_ROTA}${busca}`, { headers: cabecalhos, method: metodo });
}

beforeEach(() => {
  m.chamadas.length = 0;
  m.papel = "admin";
  process.env.CRON_SECRET = "segredo-do-cron";
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET (o cron)", () => {
  it("sem Bearer → 401", async () => {
    expect((await GET(pedido("GET"))).status).toBe(401);
    expect(m.chamadas).toHaveLength(0);
  });

  it("só x-vercel-cron → 401 (o cabeçalho não autentica ninguém)", async () => {
    expect((await GET(pedido("GET", { "x-vercel-cron": "1" }))).status).toBe(401);
    expect(m.chamadas).toHaveLength(0);
  });

  it("Bearer errado → 401 (inclusive do mesmo tamanho)", async () => {
    expect((await GET(pedido("GET", { authorization: "Bearer outro" }))).status).toBe(401);
    expect((await GET(pedido("GET", { authorization: "Bearer segredo-do-crox" }))).status).toBe(401);
    expect(m.chamadas).toHaveLength(0);
  });

  it("CRON_SECRET vazio → 503, mesmo com Bearer vazio", async () => {
    process.env.CRON_SECRET = "";
    expect((await GET(pedido("GET", { authorization: "Bearer " }))).status).toBe(503);
    expect((await GET(pedido("GET", { authorization: "Bearer qualquer" }))).status).toBe(503);
    expect(m.chamadas).toHaveLength(0);
  });

  it("Bearer certo → roda gravando e movendo vendas (MOVER_VENDAS ligada em 29/09/2026), teto 20", async () => {
    const resposta = await GET(pedido("GET", { authorization: "Bearer segredo-do-cron" }));
    expect(resposta.status).toBe(200);
    expect(m.chamadas[0]?.opcoes).toMatchObject({ concorrencia: 3, gravar: true, moverVendas: true, orcamentoMs: 240_000, tetoDeListas: 20 });
  });
});

describe("POST (o admin, à mão)", () => {
  const admin = { authorization: "Bearer sessao-boa" };

  it("sem sessão → 401; quem não é admin → 403", async () => {
    expect((await POST(pedido("POST"))).status).toBe(401);
    m.papel = "operator";
    expect((await POST(pedido("POST", admin))).status).toBe(403);
    expect(m.chamadas).toHaveLength(0);
  });

  it("é ENSAIO por padrão; grava só com ?gravar=1", async () => {
    await POST(pedido("POST", admin));
    await POST(pedido("POST", admin, "?gravar=1"));
    expect(m.chamadas.map((c) => c.opcoes.gravar)).toEqual([false, true]);
  });

  it("com refazer → 400", async () => {
    expect((await POST(pedido("POST", admin, "?refazer=1"))).status).toBe(400);
    expect(m.chamadas).toHaveLength(0);
  });

  it("teto infinito ou acima de 20 → 400", async () => {
    expect((await POST(pedido("POST", admin, "?teto=Infinity"))).status).toBe(400);
    expect((await POST(pedido("POST", admin, "?teto=500"))).status).toBe(400);
    expect(m.chamadas).toHaveLength(0);
  });

  it("so: só inteiros, até 50", async () => {
    expect((await POST(pedido("POST", admin, "?so=1,abc"))).status).toBe(400);
    const muitos = Array.from({ length: 51 }, (_, i) => i + 1).join(",");
    expect((await POST(pedido("POST", admin, `?so=${muitos}`))).status).toBe(400);
    expect((await POST(pedido("POST", admin, "?so=3806,3807"))).status).toBe(200);
    expect(m.chamadas[0]?.opcoes.so).toEqual([3806, 3807]);
  });

  it("registra quem disparou, só pelo id", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await POST(pedido("POST", admin));
    expect(JSON.stringify(info.mock.calls)).toContain("u-admin");
  });
});
