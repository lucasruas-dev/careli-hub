import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA DA CONFERÊNCIA DA CORRETAGEM ZERO — metade lida como TEXTO, metade exercitada com o Supabase
// e a guarda do C2X simulados.
//
// ⚠️ A PARTE LIDA COMO TEXTO COBRA O QUE O TYPECHECK NÃO ALCANÇA, pelo mesmo motivo da rota da posse:
// o `workspace_id` trocado por um uuid casa zero linhas em silêncio (a conferência "grava" e o termo
// segue recusando), e o portão trocado pelo de escrita deixaria o operador de atendimento responder
// "houve corretagem?" no lugar da coordenação.
const ROTA = readFileSync(join(__dirname, "route.ts"), "utf8");
const CODIGO = ROTA.split("\n")
  .filter((linha) => !/^\s*(\/\/|\/\*|\*)/.test(linha))
  .join("\n");

const estado = vi.hoisted(() => ({
  autorizacao: "coordenacao" as "coordenacao" | "negada" | "sem_sessao",
  comSupabase: true,
  conferivel: { ok: true, valorDeTabela: 93900 } as { error?: string; ok: boolean; status?: number; valorDeTabela?: null | number },
  errosDoUpsert: null as null | { code?: string; message: string },
  guardas: [] as Array<{ c2xId: number; contratoId: number }>,
  gravacoes: [] as Array<{ opcoes: unknown; tabela: string; valores: Record<string, unknown> }>,
}));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloCoordenacao: async () => {
    if (estado.autorizacao === "sem_sessao") {
      return { ok: false, response: Response.json({ error: "Sessao do Apolo ausente." }, { status: 401 }) };
    }
    if (estado.autorizacao === "negada") {
      return { ok: false, response: Response.json({ error: "Usuario sem acesso ao Apolo." }, { status: 403 }) };
    }
    return { nome: "Coordenadora", ok: true, userId: "3f7a2c18-9d4b-4f2a-8a11-0c5e6b7d8e90" };
  },
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () =>
    estado.comSupabase
      ? {
          from: (tabela: string) => ({
            upsert: async (valores: Record<string, unknown>, opcoes: unknown) => {
              estado.gravacoes.push({ opcoes, tabela, valores });
              return { error: estado.errosDoUpsert };
            },
          }),
        }
      : null,
}));

vi.mock("@/lib/apolo/termo-de-rescisao-server", () => ({
  conferirContratoDeCorretagemZero: async (escopo: { c2xId: number; contratoId: number }) => {
    estado.guardas.push(escopo);
    return estado.conferivel;
  },
}));

import * as modulo from "./route";
import { PUT } from "./route";

function pedido(corpo: unknown, bruto?: string): Request {
  return new Request("http://localhost/api/apolo/rescisao/conferencia-corretagem", {
    body: bruto ?? JSON.stringify(corpo),
    headers: { Authorization: "Bearer token-de-teste", "Content-Type": "application/json" },
    method: "PUT",
  });
}

const SEM_CORRETAGEM = {
  c2xId: 77,
  contrato: 2417,
  observacao: "Contrato assinado não prevê intermediação.",
  resultado: "sem_corretagem",
};

const COM_CORRETAGEM = {
  c2xId: 77,
  contrato: 2417,
  observacao: "Cláusula 3.2 do contrato assinado.",
  resultado: "com_corretagem",
  valor: "7.000,50",
};

beforeEach(() => {
  estado.autorizacao = "coordenacao";
  estado.comSupabase = true;
  estado.conferivel = { ok: true, valorDeTabela: 93900 };
  estado.errosDoUpsert = null;
  estado.guardas = [];
  estado.gravacoes = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("a rota, lida como texto", () => {
  it("o workspace é `careli`, e não um uuid", () => {
    expect(ROTA).toContain('const WORKSPACE = "careli"');
    expect(ROTA).not.toMatch(/const WORKSPACE = "[0-9a-f]{8}-/);
  });

  it("o portão é o da coordenação, e nenhum outro", () => {
    expect(CODIGO).toContain("await authorizeApoloCoordenacao(request)");
    expect(CODIGO).not.toContain("authorizeApoloWrite");
    expect(CODIGO).not.toContain("authorizeApoloRead");
  });

  it("declara maxDuration = 30, dinâmica e em Node, como a rota do PDF", () => {
    expect(CODIGO).toMatch(/export const maxDuration = 30;/);
    expect(CODIGO).toContain('export const dynamic = "force-dynamic";');
    expect(CODIGO).toContain('export const runtime = "nodejs";');
  });

  it("a ordem é auth, corpo, infraestrutura, validação", () => {
    const posicoes = [
      "await authorizeApoloCoordenacao(request)",
      "await request.json()",
      "createApoloAdminClient()",
      "idPlausivel(corpo.c2xId)",
      "await conferirContratoDeCorretagemZero(",
    ].map((trecho) => CODIGO.indexOf(trecho));

    expect(posicoes.every((p) => p >= 0)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
  });

  it("só exporta o que um arquivo de rota do Next aceita", () => {
    expect(Object.keys(modulo).sort()).toEqual(["PUT", "dynamic", "maxDuration", "runtime"]);
  });

  it("o C2X é só consultado por aqui (a guarda mora na lib) e não há insert solto", () => {
    expect(CODIGO).not.toContain("getHadesDbPool");
    expect(CODIGO).toContain(".upsert(");
  });
});

describe("as guardas", () => {
  it("sem sessão: devolve a resposta do portão (401)", async () => {
    estado.autorizacao = "sem_sessao";
    const resposta = await PUT(pedido(SEM_CORRETAGEM));
    expect(resposta.status).toBe(401);
  });

  it("quem não é coordenação: 403 com a frase da regra", async () => {
    estado.autorizacao = "negada";
    const resposta = await PUT(pedido(SEM_CORRETAGEM));

    expect(resposta.status).toBe(403);
    expect(await resposta.json()).toEqual({
      error: "Só a coordenação (admin ou líder) registra a conferência da corretagem.",
    });
    expect(estado.gravacoes).toHaveLength(0);
  });

  it.each([["não é json", "{quebrado"], ["null", "null"], ["array", "[]"], ["texto", '"texto"']])(
    "corpo %s: 400",
    async (_nome, bruto) => {
      const resposta = await PUT(pedido(null, bruto));
      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toEqual({ error: "Corpo inválido." });
    },
  );

  it("sem Supabase: 503, antes de validar o conteúdo", async () => {
    estado.comSupabase = false;
    const resposta = await PUT(pedido({ resultado: "qualquer coisa" }));
    expect(resposta.status).toBe(503);
  });

  it.each([
    ["sem cliente", { ...SEM_CORRETAGEM, c2xId: undefined }],
    ["contrato torto", { ...SEM_CORRETAGEM, contrato: "abc" }],
    ["contrato zero", { ...SEM_CORRETAGEM, contrato: 0 }],
    ["resultado desconhecido", { ...SEM_CORRETAGEM, resultado: "talvez" }],
    ["sem observação", { ...SEM_CORRETAGEM, observacao: "   " }],
    ["valor num 'não houve'", { ...SEM_CORRETAGEM, valor: 100 }],
    ["'houve' sem valor", { ...COM_CORRETAGEM, valor: undefined }],
    ["'houve' com valor zero", { ...COM_CORRETAGEM, valor: "0,00" }],
    ["'houve' com valor negativo", { ...COM_CORRETAGEM, valor: -5 }],
    ["'houve' com valor em texto", { ...COM_CORRETAGEM, valor: "muito" }],
    ["'houve' com três casas", { ...COM_CORRETAGEM, valor: "10,123" }],
    ["'houve' com valor gigante", { ...COM_CORRETAGEM, valor: 1e12 }],
  ])("%s: 400, e nada é consultado nem gravado", async (_nome, corpo) => {
    const resposta = await PUT(pedido(corpo));

    expect(resposta.status).toBe(400);
    expect(typeof (await resposta.json()).error).toBe("string");
    expect(estado.guardas).toHaveLength(0);
    expect(estado.gravacoes).toHaveLength(0);
  });
});

describe("a guarda do C2X", () => {
  it("passa o cliente e o contrato do corpo para a guarda", async () => {
    await PUT(pedido(SEM_CORRETAGEM));
    expect(estado.guardas).toEqual([{ c2xId: 77, contratoId: 2417 }]);
  });

  it("contrato de outro cliente: 404 com a frase, e nada é gravado", async () => {
    estado.conferivel = { error: "Este contrato não está entre os contratos deste cliente.", ok: false, status: 404 };
    const resposta = await PUT(pedido(SEM_CORRETAGEM));

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ error: "Este contrato não está entre os contratos deste cliente." });
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("comissão que não é zero: 422 com a frase, e nada é gravado", async () => {
    estado.conferivel = { error: "O contrato de corretagem desta venda não registra R$ 0,00.", ok: false, status: 422 };
    const resposta = await PUT(pedido(COM_CORRETAGEM));

    expect(resposta.status).toBe(422);
    expect((await resposta.json()).error).toContain("R$ 0,00");
    expect(estado.gravacoes).toHaveLength(0);
  });

  // ⚠️ ACHADO DA REVISÃO (30/09/2026): R$ 700.000 no lugar de R$ 7.000 deixaria a base da multa
  // negativa. O teto é o valor de tabela da unidade.
  it("valor da corretagem igual ou acima do valor de tabela: 400, e nada é gravado", async () => {
    const resposta = await PUT(pedido({ ...COM_CORRETAGEM, valor: "700.000,00" }));

    expect(resposta.status).toBe(400);
    expect((await resposta.json()).error).toContain("não é menor que o valor de tabela");
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("logo abaixo do valor de tabela ainda grava", async () => {
    const resposta = await PUT(pedido({ ...COM_CORRETAGEM, valor: "93.899,99" }));
    expect(resposta.status).toBe(200);
  });

  it("unidade sem valor de tabela: 'houve' recusa com 422, e 'não houve' grava", async () => {
    estado.conferivel = { ok: true, valorDeTabela: null };

    const houve = await PUT(pedido(COM_CORRETAGEM));
    expect(houve.status).toBe(422);
    expect(estado.gravacoes).toHaveLength(0);

    const naoHouve = await PUT(pedido(SEM_CORRETAGEM));
    expect(naoHouve.status).toBe(200);
  });

  it("C2X fora do ar: 503", async () => {
    estado.conferivel = { error: "Não foi possível ler o contrato no C2X.", ok: false, status: 503 };
    const resposta = await PUT(pedido(SEM_CORRETAGEM));
    expect(resposta.status).toBe(503);
  });
});

describe("a gravação", () => {
  it("'não houve': upsert por (workspace, contrato) com o carimbo e sem valor", async () => {
    const resposta = await PUT(pedido(SEM_CORRETAGEM));

    expect(resposta.status).toBe(200);
    expect(estado.gravacoes).toHaveLength(1);
    const { opcoes, tabela, valores } = estado.gravacoes[0]!;
    expect(tabela).toBe("hercules_conferencia_corretagem");
    expect(opcoes).toEqual({ onConflict: "workspace_id,contrato_c2x_id" });
    expect(valores).toMatchObject({
      conferido_por: "3f7a2c18-9d4b-4f2a-8a11-0c5e6b7d8e90",
      conferido_por_nome: "Coordenadora",
      contrato_c2x_id: 2417,
      observacao: "Contrato assinado não prevê intermediação.",
      resultado: "sem_corretagem",
      valor_em_reais: null,
      workspace_id: "careli",
    });
    expect(typeof valores.conferido_em).toBe("string");
  });

  it("'houve': o valor em formato brasileiro vira número", async () => {
    const resposta = await PUT(pedido(COM_CORRETAGEM));

    expect(resposta.status).toBe(200);
    expect(estado.gravacoes[0]!.valores).toMatchObject({ resultado: "com_corretagem", valor_em_reais: 7000.5 });
    expect((await resposta.json()).data).toEqual({ contrato: 2417, resultado: "com_corretagem", valor: 7000.5 });
  });

  it("aceita o valor como número e o 'R$' na frente", async () => {
    await PUT(pedido({ ...COM_CORRETAGEM, valor: 3500 }));
    await PUT(pedido({ ...COM_CORRETAGEM, valor: "R$ 1.234,56" }));

    expect(estado.gravacoes.map((g) => g.valores.valor_em_reais)).toEqual([3500, 1234.56]);
  });

  it("a observação vai aparada", async () => {
    await PUT(pedido({ ...SEM_CORRETAGEM, observacao: "  visto no contrato  " }));
    expect(estado.gravacoes[0]!.valores.observacao).toBe("visto no contrato");
  });

  it("tabela ausente: 503 com a frase", async () => {
    estado.errosDoUpsert = {
      code: "PGRST205",
      message: "Could not find the table 'public.hercules_conferencia_corretagem' in the schema cache",
    };
    const resposta = await PUT(pedido(SEM_CORRETAGEM));

    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual({ error: "A tabela da conferência ainda não foi criada." });
  });

  it("outro erro do banco: 500 com a frase, sem vazar a mensagem", async () => {
    estado.errosDoUpsert = { message: "deadlock detected" };
    const resposta = await PUT(pedido(SEM_CORRETAGEM));

    expect(resposta.status).toBe(500);
    expect(JSON.stringify(await resposta.json())).not.toContain("deadlock");
  });
});
