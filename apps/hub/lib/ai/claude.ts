import Anthropic from "@anthropic-ai/sdk";

// Client Claude compartilhado por todos os agentes do Panteon (Cacá, Athena, ata do Chronos,
// copiloto do Zeus, etc.). Centraliza: leitura da chave, roteamento de modelos e os defaults de
// custo/qualidade. A transcrição de voz (Whisper) NÃO passa por aqui — segue na OpenAI.
//
// IDs exatos da Anthropic (família Claude 5 + Opus 4.8):
//  - default = Sonnet 5    → workhorse dos atendimentos (alto volume, bom custo/latência)
//  - heavy   = Opus 4.8    → turnos difíceis/escalados (gestão de crise, leitura de contrato)
//  - fast    = Haiku 4.5   → triagem/classificação barata
export const CLAUDE_MODEL = {
  default: process.env.CLAUDE_MODEL_DEFAULT?.trim() || "claude-sonnet-5",
  fast: process.env.CLAUDE_MODEL_FAST?.trim() || "claude-haiku-4-5-20251001",
  heavy: process.env.CLAUDE_MODEL_HEAVY?.trim() || "claude-opus-4-8",
} as const;

export type ClaudeModelTier = keyof typeof CLAUDE_MODEL;

let cachedClient: Anthropic | null = null;

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

// Devolve o client Anthropic ou null se a chave ainda não estiver configurada no ambiente
// (durante a migração os agentes caem no fallback OpenAI/determinístico quando isto é null).
export function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey });
  }

  return cachedClient;
}

export function resolveClaudeModel(tier: ClaudeModelTier = "default"): string {
  return CLAUDE_MODEL[tier];
}

export type ClaudeChatMessage = {
  content: string;
  role: "assistant" | "user";
};

// Claude exige mensagens alternando papel e comecando por "user". Junta turnos
// consecutivos do mesmo papel e descarta lideres "assistant" solto.
function normalizeClaudeMessages(
  messages: ClaudeChatMessage[],
): ClaudeChatMessage[] {
  const merged: ClaudeChatMessage[] = [];

  for (const message of messages) {
    const content = message.content?.trim();
    if (!content) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      last.content = `${last.content}\n\n${content}`;
    } else {
      merged.push({ content, role: message.role });
    }
  }

  let firstUser = 0;
  while (firstUser < merged.length && merged[firstUser]?.role !== "user") {
    firstUser += 1;
  }

  return merged.slice(firstUser);
}

// Completion de texto simples sobre a Messages API da Claude (system + historico
// -> texto). Motor padrao das migracoes OpenAI->Claude dos agentes do hub que so
// precisam de texto (sem tool-use). Retorna null se a chave nao estiver setada.
export async function completeWithClaude({
  maxTokens = 2048,
  messages,
  model,
  system,
  temperature,
}: {
  maxTokens?: number;
  messages: ClaudeChatMessage[];
  model?: string;
  system?: string;
  temperature?: number;
}): Promise<{ model: string; text: string } | null> {
  const client = getAnthropicClient();
  if (!client) {
    return null;
  }

  const normalized = normalizeClaudeMessages(messages);
  if (!normalized.length) {
    return null;
  }

  const resolvedModel = model ?? resolveClaudeModel("default");

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      max_tokens: maxTokens,
      messages: normalized,
      model: resolvedModel,
      ...(system ? { system } : {}),
      ...(typeof temperature === "number" ? { temperature } : {}),
    });
  } catch (error) {
    console.error("[claude] completeWithClaude failed", {
      model: resolvedModel,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const text = response.content
    .filter(
      (block): block is Anthropic.TextBlock => block.type === "text",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();

  return { model: response.model, text };
}

// Saida ESTRUTURADA garantida (equivalente ao response_format json_schema da OpenAI).
// Em vez de pedir pro modelo escrever JSON valido a mao — fragil quando o valor e um
// texto grande em Markdown (ata, pauta): newline/aspas literais quebram o JSON.parse —
// forcamos uma unica tool e lemos o `input` ja estruturado (a API serializa o JSON).
// Use para agentes que precisam de campos previsiveis (ata do Chronos, pauta, etc.).
export async function completeWithClaudeStructured<
  T = Record<string, unknown>,
>({
  inputSchema,
  maxTokens = 4096,
  messages,
  model,
  system,
  toolDescription,
  toolName,
}: {
  inputSchema: Anthropic.Tool.InputSchema;
  maxTokens?: number;
  messages: ClaudeChatMessage[];
  model?: string;
  system?: string;
  toolDescription?: string;
  toolName: string;
}): Promise<{ data: T; model: string } | null> {
  const client = getAnthropicClient();
  if (!client) {
    return null;
  }

  const normalized = normalizeClaudeMessages(messages);
  if (!normalized.length) {
    return null;
  }

  const resolvedModel = model ?? resolveClaudeModel("default");

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      max_tokens: maxTokens,
      messages: normalized,
      model: resolvedModel,
      ...(system ? { system } : {}),
      tool_choice: { name: toolName, type: "tool" },
      tools: [
        {
          description: toolDescription ?? "Entrega o resultado estruturado.",
          input_schema: inputSchema,
          name: toolName,
        },
      ],
    });
  } catch (error) {
    console.error("[claude] completeWithClaudeStructured failed", {
      model: resolvedModel,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === toolName,
  );

  if (!toolUse) {
    return null;
  }

  return { data: toolUse.input as T, model: response.model };
}
