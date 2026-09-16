import { describe, expect, it, vi } from "vitest";

// A RESPOSTA "NÃO CONFERIDO" DO HUB É NOVA A CADA CHAMADA (revisão da onda 3, item [4]).
//
// Até 16/09/2026 ela era uma constante de módulo (`const semConflito = NextResponse.json(...)`). Uma
// `Response` tem corpo de leitura única, e a função quente da Vercel devolvia a MESMA instância na
// segunda chamada: o corpo já tinha sido lido, e o wizard tratava a checagem como falha. O que fica
// travado: duas chamadas seguidas, dois corpos legíveis, duas instâncias.

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloRead: async () => ({ ok: true, userId: "operador-1" }),
}));

vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => null }));

vi.mock("@/lib/apolo/cadastro-checar-cpf", () => ({
  conferirCpfNoEmpreendimento: vi.fn(),
}));

import { POST } from "./route";

function pedido(corpo: unknown): Request {
  return new Request("https://c2x.app.br/api/apolo/cadastro/checar-cpf", {
    body: JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("/api/apolo/cadastro/checar-cpf: não conferido", () => {
  it("duas chamadas seguidas devolvem duas respostas, com o corpo legível nas duas", async () => {
    // CPF pela metade: o caminho do "não conferido" sem consultar nada.
    const primeira = await POST(pedido({ cpf: "529", enterpriseId: "37" }));
    const segunda = await POST(pedido({ cpf: "529", enterpriseId: "37" }));

    expect(primeira).not.toBe(segunda);
    const esperado = { data: { conferido: false, conflito: null } };
    expect(await primeira.json()).toEqual(esperado);
    expect(await segunda.json()).toEqual(esperado);
    expect(segunda.headers.get("Cache-Control")).toBe("no-store");
  });

  it("corpo inválido e Supabase ausente também respondem 'não conferido' a cada vez", async () => {
    const invalido = new Request("https://c2x.app.br/api/apolo/cadastro/checar-cpf", {
      body: "{",
      method: "POST",
    });
    expect(await (await POST(invalido)).json()).toEqual({ data: { conferido: false, conflito: null } });

    // CPF completo com empreendimento, mas sem Supabase: não conferido, duas vezes.
    for (let vez = 0; vez < 2; vez += 1) {
      const r = await POST(pedido({ cpf: "52998224725", enterpriseId: "37" }));
      expect(await r.json()).toEqual({ data: { conferido: false, conflito: null } });
    }
  });
});
