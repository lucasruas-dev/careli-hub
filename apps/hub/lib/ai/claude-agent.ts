import Anthropic from "@anthropic-ai/sdk";

// Motor agêntico genérico sobre a Messages API da Claude: o modelo decide quais ferramentas
// chamar, a gente executa no backend (gating de identidade, auditoria, custo) e devolve o
// resultado, em loop, até a resposta final. Usado pela Cacá, Athena e demais agentes.
//
// Decisões de design:
//  - system prompt entra como bloco com cache_control efêmero → prompt caching corta ~90% do
//    custo do system estável a cada turno;
//  - thinking adaptativo + effort são opcionais (Haiku não aceita; Sonnet/Opus aceitam);
//  - cap de iterações de ferramenta protege contra loop infinito e estouro de custo.

export type ClaudeAgentToolResult = {
  content: string;
  isError?: boolean;
};

export type ClaudeAgentTool = {
  definition: Anthropic.Tool;
  run: (
    input: Record<string, unknown>,
  ) => Promise<ClaudeAgentToolResult | string>;
};

export type ClaudeAgentTraceStep = {
  input: Record<string, unknown>;
  ok: boolean;
  summary: string;
  tool: string;
};

export type ClaudeAgentResult = {
  iterations: number;
  stopReason: string | null;
  text: string;
  trace: ClaudeAgentTraceStep[];
};

export type ClaudeEffort = "low" | "medium" | "high" | "max";

const DEFAULT_MAX_TOOL_ITERATIONS = 6;
const DEFAULT_MAX_TOKENS = 1024;

export async function runClaudeAgent({
  client,
  effort,
  maxTokens = DEFAULT_MAX_TOKENS,
  maxToolIterations = DEFAULT_MAX_TOOL_ITERATIONS,
  messages,
  model,
  system,
  thinking = true,
  tools = [],
}: {
  client: Anthropic;
  effort?: ClaudeEffort;
  maxTokens?: number;
  maxToolIterations?: number;
  messages: Anthropic.MessageParam[];
  model: string;
  system?: string;
  thinking?: boolean;
  tools?: ClaudeAgentTool[];
}): Promise<ClaudeAgentResult> {
  const toolDefinitions = tools.map((tool) => tool.definition);
  const toolByName = new Map(tools.map((tool) => [tool.definition.name, tool]));
  const conversation: Anthropic.MessageParam[] = [...messages];
  const trace: ClaudeAgentTraceStep[] = [];
  const systemBlocks: Anthropic.TextBlockParam[] | undefined = system
    ? [{ cache_control: { type: "ephemeral" }, text: system, type: "text" }]
    : undefined;

  let stopReason: string | null = null;
  let iterations = 0;

  while (iterations < maxToolIterations) {
    iterations += 1;

    const response = await client.messages.create({
      max_tokens: maxTokens,
      messages: conversation,
      model,
      ...(systemBlocks ? { system: systemBlocks } : {}),
      ...(thinking ? { thinking: { type: "adaptive" } } : {}),
      ...(effort ? { output_config: { effort } } : {}),
      ...(toolDefinitions.length ? { tools: toolDefinitions } : {}),
    });

    stopReason = response.stop_reason;

    if (response.stop_reason !== "tool_use") {
      return {
        iterations,
        stopReason,
        text: extractText(response.content),
        trace,
      };
    }

    // Claude pediu ferramentas: executa cada uma e devolve os resultados num único turno user.
    conversation.push({ content: response.content, role: "assistant" });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") {
        continue;
      }

      const input = (block.input ?? {}) as Record<string, unknown>;
      const tool = toolByName.get(block.name);

      if (!tool) {
        toolResults.push({
          content: `Ferramenta desconhecida: ${block.name}`,
          is_error: true,
          tool_use_id: block.id,
          type: "tool_result",
        });
        trace.push({
          input,
          ok: false,
          summary: "ferramenta desconhecida",
          tool: block.name,
        });
        continue;
      }

      try {
        const raw = await tool.run(input);
        const result = typeof raw === "string" ? { content: raw } : raw;

        toolResults.push({
          content: result.content,
          tool_use_id: block.id,
          type: "tool_result",
          ...(result.isError ? { is_error: true } : {}),
        });
        trace.push({
          input,
          ok: !result.isError,
          summary: truncate(result.content, 160),
          tool: block.name,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "erro desconhecido";

        toolResults.push({
          content: `Erro ao executar a ferramenta: ${message}`,
          is_error: true,
          tool_use_id: block.id,
          type: "tool_result",
        });
        trace.push({
          input,
          ok: false,
          summary: truncate(message, 160),
          tool: block.name,
        });
      }
    }

    conversation.push({ content: toolResults, role: "user" });
  }

  // Estourou o cap de iterações no meio de tool-use. Antes devolvíamos text vazio e o
  // chamador caía num fallback genérico — péssimo depois de o agente já ter apurado tudo.
  // Fazemos UMA chamada final com tool_choice "none": o modelo é obrigado a fechar a
  // resposta com o que já tem, sem pedir mais ferramenta.
  try {
    const finalResponse = await client.messages.create({
      max_tokens: maxTokens,
      messages: conversation,
      model,
      ...(systemBlocks ? { system: systemBlocks } : {}),
      ...(toolDefinitions.length
        ? { tool_choice: { type: "none" }, tools: toolDefinitions }
        : {}),
    });

    return {
      iterations,
      stopReason: finalResponse.stop_reason ?? "max_tool_iterations",
      text: extractText(finalResponse.content),
      trace,
    };
  } catch (error) {
    console.error("[claude-agent] final no-tools completion failed", {
      model,
      reason: error instanceof Error ? error.message : String(error),
    });

    return {
      iterations,
      stopReason: stopReason ?? "max_tool_iterations",
      text: "",
      trace,
    };
  }
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
