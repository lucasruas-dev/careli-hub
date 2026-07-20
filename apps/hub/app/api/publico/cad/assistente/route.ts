import type Anthropic from "@anthropic-ai/sdk";

import { runClaudeAgent } from "@/lib/ai/claude-agent";
import { getAnthropicClient, resolveClaudeModel } from "@/lib/ai/claude";
import {
  buildAssistenteCadPrompt,
  MAX_MENSAGEM,
  MAX_TURNOS,
} from "@/lib/publico/assistente/persona";
import { json, lerCorpo, prepararRota } from "@/lib/publico/cad/rotas";
import { verificarPreSessao, verificarSessao } from "@/lib/publico/cad/sessao";

// A CACÁ do formulário público. Assistente de FAQ do processo, e só isso nesta fase.
//
// ⚠️ ZERO FERRAMENTAS DE DADOS. `buildCacaTools` (a CACÁ do WhatsApp) num anônimo daria acesso
// a carteira, boletos e `consultar_panteon`; o `CacaToolContext` é o gate de tudo isso e ele
// não existe aqui. A conversa vem do CORPO, não do banco: não há ticket nem contato.
//
// MODELO `default` (Sonnet 5) e não `heavy`: a CACÁ do WhatsApp roda Opus com effort alto para
// turnos difíceis de cobrança. Num widget de FAQ isso é caro sem motivo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Turno = { conteudo: string; papel: "assistente" | "corretor" };

export async function POST(request: Request) {
  // Aceita sessão completa OU pré-sessão: a CACÁ precisa estar disponível desde o começo do
  // preenchimento, e no começo o corretor ainda não tem sessão. Sem nenhuma das duas, não
  // respondemos: o widget não é um chat aberto ao mundo.
  const sessao = verificarSessao(request.headers.get("x-cad-sessao"));
  const pre = verificarPreSessao(request.headers.get("x-cad-pre-sessao"));
  const imobiliaria = sessao.ok ? sessao.sessao.imobiliariaNome : pre.ok ? pre.pre.imobiliariaNome : "";

  const preparo = await prepararRota(request, "assistente");
  if (!preparo.ok) return preparo.response;

  const client = getAnthropicClient();
  if (!client) {
    return json({
      resposta:
        "A assistente está indisponível agora. Fale com a nossa central que a gente ajuda por lá.",
    });
  }

  const corpo = await lerCorpo<{ turnos?: Turno[] }>(request);
  const turnos = (corpo?.turnos ?? [])
    .filter((t) => t?.conteudo?.trim())
    .slice(-MAX_TURNOS)
    .map((t) => ({
      content: t.conteudo.trim().slice(0, MAX_MENSAGEM),
      role: (t.papel === "assistente" ? "assistant" : "user") as "assistant" | "user",
    }));

  if (!turnos.length) return json({ resposta: "" });
  // A Claude exige que a conversa comece por "user".
  if (turnos[0]?.role !== "user") turnos.shift();
  if (!turnos.length) return json({ resposta: "" });

  try {
    const resultado = await runClaudeAgent({
      client,
      maxTokens: 600,
      messages: turnos as Anthropic.MessageParam[],
      model: resolveClaudeModel("default"),
      system: buildAssistenteCadPrompt({ imobiliaria }),
      thinking: false,
      tools: [],
    });
    return json({ resposta: resultado.text });
  } catch {
    return json({
      resposta:
        "Não consegui responder agora. Tente de novo em instantes ou fale com a nossa central.",
    });
  }
}
