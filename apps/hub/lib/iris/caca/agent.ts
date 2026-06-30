import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAnthropicClient, resolveClaudeModel } from "@/lib/ai/claude";
import { runClaudeAgent } from "@/lib/ai/claude-agent";
import {
  CACA_AGENT_VERSION,
  type CacaAgentContact,
  type CacaAgentMessageDetail,
  type CacaAgentTicket,
  type CacaAgentTraceStep,
  type CacaAgentTurn,
  type CacaAutomationState,
  lookupApoloByPhone,
  readCacaAutomationState,
} from "@/lib/iris/caca-agent";

import { readClientNotes } from "./client-memory";
import { buildCacaTools, type CacaToolContext } from "./executors";
import { buildCacaSystemPrompt } from "./persona";

const HISTORY_LIMIT = 14;

// Flag de migração: a Cacá-Claude só assume quando CACA_ENGINE=claude E a chave existe.
// Qualquer falha aqui faz o inbound cair na Cacá determinística (rede de segurança).
export function isCacaClaudeEngineEnabled(): boolean {
  return (
    process.env.CACA_ENGINE?.trim().toLowerCase() === "claude" &&
    Boolean(getAnthropicClient())
  );
}

export async function runCacaClaudeTurn({
  client,
  contact,
  messageDetail,
  ticket,
}: {
  client?: SupabaseClient;
  contact: CacaAgentContact;
  messageDetail: CacaAgentMessageDetail;
  ticket: CacaAgentTicket;
}): Promise<CacaAgentTurn> {
  const anthropic = getAnthropicClient();

  if (!anthropic || !client) {
    throw new Error("Claude ou Supabase indisponível para a Cacá.");
  }

  const state = readCacaAutomationState(ticket.metadata ?? null);
  let identityVerified = Boolean(
    state.apoloC2xClientId &&
      (state.apoloValidationSource === "cpf" ||
        state.apoloValidationSource === "phone"),
  );
  let c2xClientId = state.apoloC2xClientId ?? null;
  let customerName = state.apoloDisplayName ?? contact.display_name ?? null;
  let validationSource: "cpf" | "phone" | null =
    state.apoloValidationSource === "cpf" ||
    state.apoloValidationSource === "phone"
      ? state.apoloValidationSource
      : null;

  // Regra do Lucas: se o telefone do WhatsApp bate com o telefone do cadastro (comprador com
  // unidade), a identidade está confirmada — pode consultar e enviar boleto SEM pedir CPF.
  if (!identityVerified) {
    try {
      const byPhone = await lookupApoloByPhone(client, contact);

      if (
        byPhone?.hasBuyerProfile &&
        byPhone.hasUnitPortfolio &&
        byPhone.c2xClientId
      ) {
        identityVerified = true;
        c2xClientId = byPhone.c2xClientId;
        customerName = byPhone.displayName ?? customerName;
        validationSource = "phone";
      }
    } catch {
      // Sem match por telefone: segue não-verificado (a Cacá pede CPF pela ferramenta).
    }
  }

  const toolContext: CacaToolContext = {
    c2xClientId,
    client,
    contactId: contact.id ?? null,
    customerName,
    handoff: { reason: null, requested: false },
    identityVerified,
    validationSource,
  };

  const clientNotes = readClientNotes(contact);
  const businessHours = businessHoursForNow();
  const system = buildCacaSystemPrompt({
    businessHoursOpen: businessHours.open,
    clientNotes: clientNotes.map((entry) => entry.note),
    customerName: toolContext.customerName ?? undefined,
    greeting: greetingForNow(),
    identityVerified,
    nextContactLabel: businessHours.nextContactLabel,
  });
  const messages = await buildConversation(client, ticket.id, messageDetail);
  const model = resolveClaudeModel("heavy");

  const result = await runClaudeAgent({
    client: anthropic,
    effort: "high",
    maxTokens: 1024,
    maxToolIterations: 6,
    messages,
    model,
    system,
    thinking: true,
    tools: buildCacaTools(toolContext),
  });

  const handoffRequired = toolContext.handoff.requested;
  const replyText =
    result.text.trim() ||
    (handoffRequired
      ? "Já estou te encaminhando para o nosso time. Em instantes alguém te responde por aqui."
      : "Me dá só mais um detalhe pra eu te ajudar direitinho?");

  const nextState: CacaAutomationState = {
    ...state,
    apoloC2xClientId: toolContext.c2xClientId ?? state.apoloC2xClientId ?? null,
    apoloDisplayName:
      toolContext.customerName ?? state.apoloDisplayName ?? null,
    apoloValidationSource: toolContext.identityVerified
      ? toolContext.validationSource ?? "cpf"
      : state.apoloValidationSource ?? null,
    handoffRequired,
  };

  return {
    agentVersion: CACA_AGENT_VERSION,
    handoff: { reason: toolContext.handoff.reason, required: handoffRequired },
    model,
    nextState,
    nextStep: handoffRequired ? "handoff" : "general_reply",
    replyText,
    source: "claude",
    toolsUsed: Array.from(new Set(result.trace.map((step) => step.tool))),
    trace: result.trace.map(
      (step): CacaAgentTraceStep => ({
        at: new Date().toISOString(),
        metadata: { ok: step.ok },
        status: step.ok ? "ok" : "error",
        summary: step.summary,
        tool: step.tool,
      }),
    ),
  };
}

type CaredeskHistoryRow = {
  body: string | null;
  direction: string | null;
  sender_type: string | null;
};

async function buildConversation(
  client: SupabaseClient,
  ticketId: string,
  messageDetail: CacaAgentMessageDetail,
): Promise<Anthropic.MessageParam[]> {
  const { data } = await client
    .from("caredesk_messages")
    .select("body,direction,sender_type")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT)
    .returns<CaredeskHistoryRow[]>();

  const rows = (data ?? []).reverse();
  const messages: Anthropic.MessageParam[] = [];
  const mediaUrl = readStoredMediaUrl(messageDetail);
  const mediaAnalysis = readMediaSummary(messageDetail);

  rows.forEach((row, index) => {
    const isCustomer =
      row.direction === "inbound" || row.sender_type === "customer";
    const role: "assistant" | "user" = isCustomer ? "user" : "assistant";
    const text = (row.body ?? "").trim() || "(mensagem sem texto)";
    const isLastCustomer = index === rows.length - 1 && isCustomer;

    // Última mensagem do cliente com imagem: anexa a imagem nativa pra Cacá VER de fato.
    if (isLastCustomer && mediaUrl?.kind === "image") {
      messages.push({
        content: [
          { source: { type: "url", url: mediaUrl.url }, type: "image" },
          {
            text: [text, mediaAnalysis].filter(Boolean).join("\n\n"),
            type: "text",
          },
        ],
        role: "user",
      });
      return;
    }

    // Demais mídias (áudio/documento): usa a leitura textual já feita.
    const enriched =
      isLastCustomer && mediaAnalysis
        ? [text, mediaAnalysis].filter(Boolean).join("\n\n")
        : text;

    messages.push({ content: enriched, role });
  });

  // A API exige que a conversa comece com 'user'. Descarta turnos 'assistant' iniciais.
  while (messages.length && messages[0]?.role === "assistant") {
    messages.shift();
  }

  if (!messages.length) {
    messages.push({
      content: (messageDetail.body ?? "").trim() || "Olá",
      role: "user",
    });
  }

  return messages;
}

function readStoredMediaUrl(
  messageDetail: CacaAgentMessageDetail,
): { kind: string; url: string } | null {
  const media = (
    messageDetail as { media?: { storedUrl?: unknown; type?: unknown } }
  ).media;
  const url =
    media && typeof media.storedUrl === "string" ? media.storedUrl : null;
  const kind = media && typeof media.type === "string" ? media.type : "unknown";

  return url ? { kind, url } : null;
}

function readMediaSummary(messageDetail: CacaAgentMessageDetail): string | null {
  const analysis = messageDetail.mediaAnalysis;

  if (!analysis || analysis.status !== "ok") {
    return null;
  }

  const summary =
    typeof analysis.summary === "string" ? analysis.summary.trim() : "";
  const transcript =
    typeof analysis.transcript === "string" ? analysis.transcript.trim() : "";

  return summary || transcript || null;
}

function greetingForNow(): string {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      hour12: false,
      timeZone: "America/Sao_Paulo",
    }).format(new Date()),
  );

  if (!Number.isFinite(hour)) {
    return "olá";
  }

  if (hour < 12) {
    return "bom dia";
  }

  if (hour < 18) {
    return "boa tarde";
  }

  return "boa noite";
}

// Atendimento humano: seg-sex 9h-18h (America/Sao_Paulo). Devolve se está aberto agora
// e quando o time volta a atender (pra Cacá comunicar ao transferir fora do horário).
function businessHoursForNow(): { nextContactLabel: string; open: boolean } {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo",
    weekday: "long",
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  const isWeekend = weekday === "Saturday" || weekday === "Sunday";
  const isBusinessDay = !isWeekend;
  const open = isBusinessDay && hour >= 9 && hour < 18;

  let nextContactLabel: string;

  if (open) {
    nextContactLabel = "ainda hoje, dentro do horário";
  } else if (isBusinessDay && hour < 9) {
    nextContactLabel = "hoje a partir das 9h";
  } else if (weekday === "Friday" || isWeekend) {
    nextContactLabel = "na segunda-feira";
  } else {
    nextContactLabel = "amanhã pela manhã";
  }

  return { nextContactLabel, open };
}
