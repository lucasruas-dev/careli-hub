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

// Consumo do turno inteiro (todas as iterações somadas). Sem isto não dá pra responder
// "quanto custa um atendimento" nem comparar um modelo com outro — era o buraco de
// observabilidade que impedia qualquer decisão de tier ser mais que opinião.
export type ClaudeAgentUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  // Quantas chamadas ao modelo o turno custou (loop + fechamento).
  requests: number;
};

export type ClaudeAgentResult = {
  iterations: number;
  stopReason: string | null;
  text: string;
  trace: ClaudeAgentTraceStep[];
  usage: ClaudeAgentUsage;
};

export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

const DEFAULT_MAX_TOOL_ITERATIONS = 6;
const DEFAULT_MAX_TOKENS = 1024;

function acumularUso(
  usage: ClaudeAgentUsage,
  resposta: Anthropic.Message,
): void {
  usage.requests += 1;
  usage.inputTokens += resposta.usage?.input_tokens ?? 0;
  usage.outputTokens += resposta.usage?.output_tokens ?? 0;
  usage.cacheReadTokens += resposta.usage?.cache_read_input_tokens ?? 0;
  usage.cacheCreationTokens += resposta.usage?.cache_creation_input_tokens ?? 0;
}

export async function runClaudeAgent({
  cacheTtl = "5m",
  client,
  effort,
  maxTokens = DEFAULT_MAX_TOKENS,
  maxToolIterations = DEFAULT_MAX_TOOL_ITERATIONS,
  messages,
  model,
  serverTools = [],
  system,
  systemVolatile,
  thinking = true,
  tools = [],
}: {
  // Validade do bloco cacheado. "1h" custa mais pra escrever e muito menos pra manter
  // vivo entre atendimentos espaçados; "5m" (default da API) serve pra rajada curta.
  cacheTtl?: "5m" | "1h";
  client: Anthropic;
  effort?: ClaudeEffort;
  maxTokens?: number;
  maxToolIterations?: number;
  messages: Anthropic.MessageParam[];
  model: string;
  // Ferramentas de SERVIDOR do Claude (ex.: web_search): o próprio Claude executa, sem
  // executor no backend. Entram no request, mas não no toolByName (não têm run).
  serverTools?: Anthropic.ToolUnion[];
  // Parte ESTÁVEL do system: é ela que entra no cache.
  system?: string;
  // Parte que muda a cada turno (saudação, horário, nome de quem fala, avisos do dia).
  // Vai DEPOIS do bloco cacheado, justamente pra não invalidá-lo.
  systemVolatile?: string;
  thinking?: boolean;
  tools?: ClaudeAgentTool[];
}): Promise<ClaudeAgentResult> {
  const toolDefinitions: Anthropic.ToolUnion[] = [
    ...tools.map((tool) => tool.definition),
    ...serverTools,
  ];
  const toolByName = new Map(tools.map((tool) => [tool.definition.name, tool]));
  const conversation: Anthropic.MessageParam[] = [...messages];
  const trace: ClaudeAgentTraceStep[] = [];
  // A ORDEM aqui é o que faz o cache funcionar. O casamento é de PREFIXO, na sequência
  // tools -> system -> messages: tudo que vier antes do primeiro byte diferente é
  // reaproveitado. Por isso o estável entra primeiro, carregando o breakpoint, e o
  // volátil entra depois, num bloco sem cache. Enquanto o system era um bloco único com
  // o nome do cliente e a saudação interpolados no meio, trocar de atendimento
  // invalidava o prefixo INTEIRO, inclusive as 30 ferramentas.
  const systemBlocks: Anthropic.TextBlockParam[] = [];

  if (system) {
    systemBlocks.push({
      cache_control: { ttl: cacheTtl, type: "ephemeral" },
      text: system,
      type: "text",
    });
  }

  if (systemVolatile?.trim()) {
    systemBlocks.push({ text: systemVolatile, type: "text" });
  }

  let stopReason: string | null = null;
  let iterations = 0;
  const usage: ClaudeAgentUsage = {
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    requests: 0,
  };

  // Do Opus 5 em diante o thinking vem LIGADO por padrão: omitir o campo nao desliga
  // nada. Quem pede thinking:false precisa dizer "disabled" na cara. (E "disabled" so'
  // e' aceito ate' effort "high" — acima disso a API devolve 400.)
  const thinkingParam = thinking
    ? ({ type: "adaptive" } as const)
    : ({ type: "disabled" } as const);

  while (iterations < maxToolIterations) {
    iterations += 1;

    const response = await client.messages.create({
      max_tokens: maxTokens,
      messages: conversation,
      model,
      ...(systemBlocks.length ? { system: systemBlocks } : {}),
      thinking: thinkingParam,
      ...(effort ? { output_config: { effort } } : {}),
      ...(toolDefinitions.length ? { tools: toolDefinitions } : {}),
    });

    acumularUso(usage, response);
    stopReason = response.stop_reason;

    if (response.stop_reason !== "tool_use") {
      return {
        iterations,
        stopReason,
        text: extractText(response.content),
        trace,
        usage,
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
    // Esta chamada precisa dos MESMOS parametros do loop. Sem repetir `thinking` e
    // `effort` aqui, o fechamento roda com a configuracao default do modelo — e no
    // Opus 5 isso significa thinking ligado no effort mais alto, dentro do mesmo
    // max_tokens. E' o pior lugar possivel pra truncar: o agente ja' apurou tudo.
    const finalResponse = await client.messages.create({
      max_tokens: maxTokens,
      messages: conversation,
      model,
      ...(systemBlocks.length ? { system: systemBlocks } : {}),
      thinking: thinkingParam,
      ...(effort ? { output_config: { effort } } : {}),
      ...(toolDefinitions.length
        ? { tool_choice: { type: "none" }, tools: toolDefinitions }
        : {}),
    });

    acumularUso(usage, finalResponse);

    return {
      iterations,
      stopReason: finalResponse.stop_reason ?? "max_tool_iterations",
      text: extractText(finalResponse.content),
      trace,
      usage,
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
      usage,
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
