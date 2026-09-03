import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA /api/ai/command (IA do editor de minutas) — o caminho de SEGURANÇA.
//
// O que está travado aqui: sem Bearer é 401 antes de qualquer coisa; sem ANTHROPIC_API_KEY é 503;
// o `model`/`apiKey` que o kit do Plate manda no corpo são IGNORADOS (o provider é criado com a
// chave do servidor e o modelo é sempre CLAUDE_MODEL.default); e o prompt de toda ferramenta
// carrega a regra das variáveis do sistema.
//
// `ai` e `@ai-sdk/anthropic` são mockados: o teste é da REGRA da rota, não do stream.

const estado = vi.hoisted(() => ({
  /** O que a rota escreveu no UI Message Stream (`writer.write`). */
  escritos: [] as unknown[],
  modelosPedidos: [] as string[],
  promptsDeEscolha: [] as string[],
}));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloWrite: async (request: Request) => {
    const header = request.headers.get("authorization") ?? "";
    if (!/^Bearer\s+\S+/i.test(header)) {
      return {
        ok: false,
        response: Response.json({ error: "Sessao do Apolo ausente." }, { status: 401 }),
      };
    }
    return { ok: true, userId: "user-1" };
  },
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => (modelId: string) => {
    estado.modelosPedidos.push(modelId);
    return { modelId, provider: "anthropic-mock", specificationVersion: "v3" };
  }),
}));

vi.mock("ai", () => ({
  Output: {
    array: (x: unknown) => x,
    choice: (x: unknown) => x,
  },
  createUIMessageStream: ({ execute }: { execute: (a: { writer: unknown }) => Promise<void> }) => {
    const writer = { merge: () => {}, write: (parte: unknown) => estado.escritos.push(parte) };
    void execute({ writer });
    return new ReadableStream();
  },
  createUIMessageStreamResponse: ({ stream }: { stream: ReadableStream }) =>
    new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
  generateText: vi.fn(async (args: { prompt: string }) => {
    estado.promptsDeEscolha.push(args.prompt);
    return { output: "generate" };
  }),
  streamText: vi.fn(() => ({ elementStream: (async function* () {})(), stream: new ReadableStream() })),
  toUIMessageStream: () => new ReadableStream(),
  tool: (t: unknown) => t,
}));

// A lista base da Têmis é da Frente B; aqui basta um editor sem plugins para a rota rodar.
vi.mock("@/modules/temis/editor-base-kit-temis", () => ({ BaseEditorKitTemis: [] }));

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { POST } from "@/app/api/ai/command/route";
import { REGRA_VARIAVEIS, commonEditRules, commonGenerateRules } from "@/app/api/ai/command/prompt/common";

const corpoDoKit = {
  apiKey: "sk-do-browser-nao-vale",
  ctx: {
    children: [{ children: [{ text: "O COMPRADOR pagará [valor_total]." }], id: "b1", type: "p" }],
    selection: null,
    toolName: null,
  },
  messages: [{ id: "m1", parts: [{ text: "Escreva uma cláusula de foro", type: "text" }], role: "user" }],
  model: "gpt-4o",
};

function requisicao(corpo: unknown, comBearer = true) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (comBearer) headers.set("Authorization", "Bearer token-de-teste");
  return new Request("https://c2x.app.br/api/ai/command", {
    body: JSON.stringify(corpo),
    headers,
    method: "POST",
  });
}

const chaveOriginal = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  estado.escritos = [];
  estado.modelosPedidos = [];
  estado.promptsDeEscolha = [];
  process.env.ANTHROPIC_API_KEY = "sk-ant-teste";
  vi.mocked(createAnthropic).mockClear();
});

afterEach(() => {
  if (chaveOriginal === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = chaveOriginal;
});

describe("a rota de IA do editor de minutas", () => {
  it("sem Bearer → 401 e o provider nem é criado", async () => {
    const r = await POST(requisicao(corpoDoKit, false) as never);
    expect(r.status).toBe(401);
    expect(createAnthropic).not.toHaveBeenCalled();
  });

  it("sem ANTHROPIC_API_KEY → 503", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await POST(requisicao(corpoDoKit) as never);
    expect(r.status).toBe(503);
    expect(createAnthropic).not.toHaveBeenCalled();
  });

  it("corpo sem ctx/messages → 400", async () => {
    const r = await POST(requisicao({ messages: "x" }) as never);
    expect(r.status).toBe(400);
  });

  it("`model: gpt-4o` e `apiKey` do corpo são ignorados: chave do servidor, Claude fixo", async () => {
    const r = await POST(requisicao(corpoDoKit) as never);
    expect(r.status).toBe(200);
    expect(createAnthropic).toHaveBeenCalledTimes(1);
    expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-ant-teste" });
    expect(estado.modelosPedidos.length).toBeGreaterThan(0);
    for (const modelo of estado.modelosPedidos) {
      expect(modelo).toBe("claude-sonnet-5");
    }
    expect(estado.modelosPedidos).not.toContain("gpt-4o");
  });

  it("o prompt de escolha da ferramenta chega ao modelo com a instrução do usuário", async () => {
    await POST(requisicao(corpoDoKit) as never);
    // O stream roda no execute assíncrono; dá um tique para o generateText ser chamado.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(estado.promptsDeEscolha).toHaveLength(1);
    expect(estado.promptsDeEscolha[0]).toContain("Escreva uma cláusula de foro");
    expect(estado.promptsDeEscolha[0]).toContain("classificador");
  });

  it("a escolha da ferramenta não pede um teto de saída que o thinking consome", async () => {
    // ⚠️ Com 64 tokens o thinking adaptativo do Sonnet 5 cortava a resposta e `output` vinha vazio.
    await POST(requisicao(corpoDoKit) as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const chamada = vi.mocked(generateText).mock.calls[0]?.[0] as { maxOutputTokens?: number };
    expect(chamada.maxOutputTokens).toBeGreaterThanOrEqual(1024);
  });

  it("escolha vazia (resposta cortada) cai em `generate` em vez de derrubar o stream", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({ output: undefined } as never);
    await POST(requisicao(corpoDoKit) as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(estado.escritos).toContainEqual({ data: "generate", type: "data-toolName" });
    expect(estado.escritos).not.toContainEqual({ data: undefined, type: "data-toolName" });
  });
});

describe("a regra das variáveis do sistema", () => {
  it("está em toda família de prompt (edição e geração)", () => {
    expect(REGRA_VARIAVEIS).toContain("[nome_cliente]");
    expect(REGRA_VARIAVEIS).toContain("EXATAMENTE");
    expect(REGRA_VARIAVEIS).toContain("[inicio_x]");
    expect(commonEditRules).toContain("VARIÁVEIS DO SISTEMA");
    expect(commonGenerateRules).toContain("VARIÁVEIS DO SISTEMA");
  });
});
