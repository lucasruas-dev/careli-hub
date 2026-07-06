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
import {
  buildCacaTools,
  describeApoloProfile,
  type CacaToolContext,
} from "./executors";
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

// Master switch da CACÁ com VOZ (responde nota de voz quando o cliente manda áudio). Só liga
// com CACA_VOICE_ENABLED=1/true E a chave da ElevenLabs no ambiente. Ver [[project-caca-voice-tts]].
export function isCacaVoiceReplyEnabled(): boolean {
  const flag = process.env.CACA_VOICE_ENABLED?.trim().toLowerCase();

  return (
    (flag === "1" || flag === "true") &&
    Boolean(process.env.ELEVENLABS_API_KEY?.trim())
  );
}

// Reduz um telefone à chave nacional canônica (tira 55 e o 9º dígito de celular), pra casar
// variantes (com/sem 55, com/sem 9). Ex.: 5531983013616 -> 3183013616.
function canonicalPhoneKey(value: string | null | undefined): string {
  let digits = String(value ?? "").replace(/\D/g, "");

  if (digits.startsWith("55") && digits.length >= 12) {
    digits = digits.slice(2);
  }

  if (digits.length === 11 && digits[2] === "9") {
    digits = digits.slice(0, 2) + digits.slice(3);
  }

  return digits;
}

function parseAdminPhoneKeys(env: string | undefined): Set<string> {
  return new Set(
    String(env ?? "")
      .split(",")
      .map((phone) => canonicalPhoneKey(phone))
      .filter(Boolean),
  );
}

// Mapa número→hub_user_id (env CACA_HERMES_USER_MAP = "fone:uuid,fone:uuid"), pra consultar o
// Hermes do admin. Chave = telefone canonicalizado.
function parseHermesUserMap(env: string | undefined): Map<string, string> {
  const map = new Map<string, string>();

  for (const pair of String(env ?? "").split(",")) {
    const [phone, userId] = pair.split(":").map((part) => part.trim());
    const key = canonicalPhoneKey(phone);

    if (key && userId) {
      map.set(key, userId);
    }
  }

  return map;
}

// Modo ASSISTENTE: quem fala é um número admin VERIFICADO (allowlist CACA_ADMIN_PHONES; Nívea
// em CACA_NIVEA_PHONES ganha tratamento de dona). Gate por número (nunca por alegação), pra
// ninguém no WhatsApp impersonar. Ver [[project-caca-admin-assistant-mode]].
function resolveCacaAdmin(contact: CacaAgentContact): {
  isAdmin: boolean;
  isOwner: boolean;
  isDoctor: boolean;
  hubUserId: string | null;
} {
  const admins = parseAdminPhoneKeys(process.env.CACA_ADMIN_PHONES);
  const owners = parseAdminPhoneKeys(process.env.CACA_NIVEA_PHONES);
  // Números tratados por "Doutor" na saudação (ex.: Fabrício). Só cosmético; o gate de acesso
  // segue sendo admin/owner. Ver [[project-caca-admin-assistant-mode]].
  const doctors = parseAdminPhoneKeys(process.env.CACA_DOCTOR_PHONES);

  if (admins.size === 0 && owners.size === 0) {
    return { hubUserId: null, isAdmin: false, isDoctor: false, isOwner: false };
  }

  const keys = [contact.whatsapp_phone, contact.phone]
    .map((phone) => canonicalPhoneKey(phone))
    .filter(Boolean);

  const isOwner = keys.some((key) => owners.has(key));
  const isAdmin = isOwner || keys.some((key) => admins.has(key));
  const isDoctor = keys.some((key) => doctors.has(key));

  const hermesMap = parseHermesUserMap(process.env.CACA_HERMES_USER_MAP);
  const hubUserId =
    keys.map((key) => hermesMap.get(key)).find(Boolean) ?? null;

  return { hubUserId, isAdmin, isDoctor, isOwner };
}

export async function runCacaClaudeTurn({
  client,
  contact,
  destination,
  messageDetail,
  outboundPhoneNumberId,
  ticket,
  voiceMode = false,
}: {
  client?: SupabaseClient;
  contact: CacaAgentContact;
  // Destino (wa_id) + phone_number_id do atendimento — pra tools que ENVIAM mídia (relatório).
  destination?: string | null;
  messageDetail: CacaAgentMessageDetail;
  outboundPhoneNumberId?: string | null;
  ticket: CacaAgentTicket;
  // Resposta vai virar nota de voz -> texto "falado" + pontuação reforçada.
  voiceMode?: boolean;
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
  let customerProfileLabel: string | null = null;
  // Se quem fala é uma imobiliária/corretora conhecida (telefone bate com o cadastro dela),
  // já abrimos o escopo da carteira: ela pode consultar os clientes DELA sem digitar o CNPJ.
  let imobiliariaC2xClientId: string | null = null;
  let imobiliariaName: string | null = null;

  // Regra do Lucas: se o telefone do WhatsApp bate com o telefone do cadastro (comprador com
  // unidade), a identidade está confirmada — pode consultar e enviar boleto SEM pedir CPF.
  if (!identityVerified) {
    try {
      const byPhone = await lookupApoloByPhone(client, contact);

      // Captura o perfil pelo telefone mesmo quando NÃO é comprador — assim a Cacá já
      // entende com quem fala (colaborador, parceiro, prospect) e não trata a ausência
      // de carteira como erro.
      if (byPhone) {
        customerProfileLabel =
          describeApoloProfile(byPhone.profiles) ?? customerProfileLabel;

        const isRealtor = byPhone.profiles.some((profile) =>
          ["imobiliaria", "corretor"].includes(profile.toLowerCase()),
        );

        if (isRealtor && byPhone.c2xClientId) {
          imobiliariaC2xClientId = byPhone.c2xClientId;
          imobiliariaName =
            byPhone.displayName ?? contact.display_name ?? null;
        }
      }

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

  const businessHours = businessHoursForNow();
  const admin = resolveCacaAdmin(contact);

  // Admin (direção) PREVALECE sobre qualquer escopo de imobiliária deixado no ticket: ele não
  // é "parceiro da Beltrão", é dono — some com o enquadramento de imobiliária. Ver
  // [[project-caca-admin-assistant-mode]].
  if (admin.isAdmin) {
    imobiliariaC2xClientId = null;
    imobiliariaName = null;
  }

  const toolContext: CacaToolContext = {
    assistantHubUserId: admin.hubUserId,
    assistantMode: admin.isAdmin,
    businessHoursOpen: businessHours.open,
    destination: destination ?? null,
    outboundPhoneNumberId: outboundPhoneNumberId ?? null,
    c2xClientId,
    client,
    contactId: contact.id ?? null,
    customerName,
    customerProfileLabel,
    handoff: { reason: null, requested: false },
    identityVerified,
    imobiliariaC2xClientId,
    imobiliariaName,
    nextContactLabel: businessHours.nextContactLabel,
    validationSource,
  };

  const clientNotes = readClientNotes(contact);
  const system = buildCacaSystemPrompt({
    businessHoursOpen: businessHours.open,
    clientNotes: clientNotes.map((entry) => entry.note),
    customerName: toolContext.customerName ?? undefined,
    customerProfileLabel: toolContext.customerProfileLabel,
    greeting: greetingForNow(),
    identityVerified,
    imobiliariaName: toolContext.imobiliariaName,
    nextContactLabel: businessHours.nextContactLabel,
    voiceMode,
    assistantMode: admin.isAdmin,
    assistantIsOwner: admin.isOwner,
    assistantIsDoctor: admin.isDoctor,
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
    // No modo admin (direção), libera a BUSCA WEB nativa do Claude — pra ela responder
    // qualquer coisa (placar de jogo, cotação, notícia). Cliente normal NÃO tem web.
    serverTools: admin.isAdmin
      ? [{ max_uses: 4, name: "web_search", type: "web_search_20250305" }]
      : [],
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

  // A API também exige TERMINAR com 'user' — modelos novos rejeitam prefill de
  // assistant ("This model does not support assistant message prefill", 400 real
  // visto 3× nos logs de 2-3/jul, derrubando a Cacá pro fallback determinístico).
  // Acontece quando uma mensagem NOSSA (operador/template) entrou no histórico
  // depois do inbound que disparou este turno. Reancora no texto do inbound.
  if (messages[messages.length - 1]?.role === "assistant") {
    messages.push({
      content:
        (messageDetail.body ?? "").trim() ||
        "(cliente aguarda retorno — continue o atendimento)",
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
