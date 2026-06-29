import Anthropic from "@anthropic-ai/sdk";

// Client Claude compartilhado por todos os agentes do Panteon (Cacá, Athena, ata do Chronos,
// copiloto do Zeus, etc.). Centraliza: leitura da chave, roteamento de modelos e os defaults de
// custo/qualidade. A transcrição de voz (Whisper) NÃO passa por aqui — segue na OpenAI.
//
// IDs exatos da Anthropic (NÃO acrescentar sufixo de data):
//  - default = Sonnet 4.6  → workhorse dos atendimentos (alto volume, bom custo/latência)
//  - heavy   = Opus 4.8    → turnos difíceis/escalados (gestão de crise, leitura de contrato)
//  - fast    = Haiku 4.5   → triagem/classificação barata
export const CLAUDE_MODEL = {
  default: process.env.CLAUDE_MODEL_DEFAULT?.trim() || "claude-sonnet-4-6",
  fast: process.env.CLAUDE_MODEL_FAST?.trim() || "claude-haiku-4-5",
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
