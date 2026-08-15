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

import { carregarAvisosVigentes } from "./avisos-operacionais";
import { readClientNotes } from "./client-memory";
import { lerIdentidadeLembrada } from "./identidade-lembrada";
import {
  buildCacaTools,
  describeApoloProfile,
  type CacaToolContext,
} from "./executors";
import { buildCacaSystemPrompt } from "./persona";

// Quantas mensagens do atendimento a Cacá enxerga. Em 14 ela perdia o começo em 24,9%
// dos tickets (medido 01-15/08), justamente onde mora o pedido original e o momento em
// que a identidade foi validada. Cada mensagem a mais é reprocessada em toda iteração de
// ferramenta do turno, então isto é um trade-off de custo consciente, não um número solto.
const HISTORY_LIMIT = 24;

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
  // entity_id do Apolo do contato (casado por TELEFONE) — pra tools que GRAVAM na ficha do prospect
  // (registrar_chave_pix). Persistido no state pra sobreviver entre turnos.
  let apoloEntityId: string | null = state.apoloEntityId ?? null;

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

        // O telefone casou uma entidade do Apolo (mesmo prospect, sem carteira). Guarda o
        // entity_id pra registrar_chave_pix gravar na ficha certa.
        apoloEntityId = byPhone.entityId ?? apoloEntityId;

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

  // MEMÓRIA DE IDENTIDADE: o telefone não casou com um cadastro de comprador, mas ESTE número
  // já validou um cadastro por CPF num atendimento recente (até 30 dias). Reaproveita, em vez
  // de fazer o cliente digitar CPF e nome completo de novo — 64,5% dos atendimentos são de
  // clientes reincidentes e a identidade morria no fechamento do ticket (4h).
  // A persona pede uma reconfirmação leve do nome antes de expor financeiro.
  let identidadeLembrada: { displayName: string | null } | null = null;

  if (!identityVerified) {
    const lembrada = lerIdentidadeLembrada(contact);

    if (lembrada) {
      identityVerified = true;
      c2xClientId = lembrada.c2xClientId;
      customerName = lembrada.displayName ?? customerName;
      validationSource = "cpf";
      identidadeLembrada = { displayName: lembrada.displayName };
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
    entityId: apoloEntityId,
    handoff: { reason: null, requested: false },
    identityVerified,
    imobiliariaC2xClientId,
    imobiliariaName,
    nextContactLabel: businessHours.nextContactLabel,
    validationSource,
  };

  const clientNotes = readClientNotes(contact);
  // Mural de avisos: o que a operação está vivendo agora (atraso de emissão, obra, manutenção).
  // Best-effort — se a leitura falhar, a Cacá responde sem esse contexto.
  const avisos = await carregarAvisosVigentes(client);
  const system = buildCacaSystemPrompt({
    avisosOperacionais: avisos.map((aviso) => ({
      texto: aviso.texto,
      titulo: aviso.titulo,
    })),
    businessHoursOpen: businessHours.open,
    clientNotes: clientNotes.map((entry) => entry.note),
    customerName: toolContext.customerName ?? undefined,
    customerProfileLabel: toolContext.customerProfileLabel,
    greeting: greetingForNow(),
    identidadeLembrada,
    identityVerified,
    imobiliariaName: toolContext.imobiliariaName,
    nextContactLabel: businessHours.nextContactLabel,
    voiceMode,
    assistantMode: admin.isAdmin,
    assistantIsOwner: admin.isOwner,
    assistantIsDoctor: admin.isDoctor,
  });
  const messages = await buildConversation(client, ticket.id, messageDetail);
  // No modo admin (direção), libera a BUSCA WEB nativa do Claude — pra ela responder
  // qualquer coisa (placar de jogo, cotação, notícia). Cliente normal NÃO tem web.
  // Versão 2026-02 traz filtragem dinâmica: o modelo filtra os resultados antes de
  // eles entrarem no contexto. Não declarar `code_execution` junto, ela já roda por
  // baixo e um segundo ambiente de execução confunde o modelo.
  const serverTools: Anthropic.ToolUnion[] = admin.isAdmin
    ? [{ max_uses: 4, name: "web_search", type: "web_search_20260209" }]
    : [];

  // Parâmetros do turno, isolados porque podem ser reexecutados no modelo reserva logo
  // abaixo. `tools` é montado UMA vez de propósito: o toolContext é mutável.
  const parametrosDoTurno = {
    client: anthropic,
    effort: "high" as const,
    // ATENÇÃO: no Opus 5 este teto cobre o RACIOCÍNIO MAIS a resposta. Com 1024 o
    // pensamento comia o orçamento e o texto saía truncado ou vazio (e vazio cai no
    // fallback genérico lá embaixo). A resposta dela tem 375 caracteres de média, então
    // a folga aqui é toda pro raciocínio.
    maxTokens: 4000,
    // Conta TURNOS do modelo, não chamadas de ferramenta. Uma cadeia comum (validar CPF,
    // achar cadastro, listar parcelas, gerar boleto, enviar, confirmar) já consome 6, e
    // qualquer erro de ferramenta gasta mais um no retry.
    maxToolIterations: 8,
    messages,
    serverTools,
    system,
    thinking: true,
    tools: buildCacaTools(toolContext),
  };

  // Tier `frontier` = o melhor modelo disponível, reservado a quem fala com o CLIENTE.
  let model = resolveClaudeModel("frontier");
  const iniciadoEm = Date.now();
  let result: Awaited<ReturnType<typeof runClaudeAgent>>;

  try {
    result = await runClaudeAgent({ ...parametrosDoTurno, model });
  } catch (erro) {
    if (!modeloIndisponivel(erro)) {
      throw erro;
    }

    // REDE DE SEGURANÇA da troca de motor: "o modelo mais novo" às vezes quer dizer
    // "ainda não liberado nesta conta". Sem isto, um id que a conta não enxerga viraria
    // falha técnica em TODO atendimento, e o cliente receberia "tive um problema
    // técnico" no lugar da resposta. Cai pro tier heavy, que é o que rodava antes.
    console.error("[caca] modelo frontier indisponível, usando o heavy", {
      frontier: model,
      motivo: erro instanceof Error ? erro.message : String(erro),
    });
    model = resolveClaudeModel("heavy");
    result = await runClaudeAgent({ ...parametrosDoTurno, model });
  }

  const latencyMs = Date.now() - iniciadoEm;

  // O turno pode terminar sem texto utilizável de três jeitos: RECUSA dos classificadores
  // de segurança (HTTP 200, conteúdo vazio, stop_reason "refusal"), estouro do teto de
  // tokens no meio da frase, ou as duas chamadas falhando. Em todos, responder a frase
  // genérica é PIOR que assumir o limite: a recusa é determinística, então o cliente
  // responde, ela recusa de novo, e o ticket gira com a Cacá como dona e ninguém sabendo.
  const textoUtil = result.text.trim();
  const falhaDeGeracao =
    result.stopReason === "refusal" ||
    result.stopReason === "max_tokens" ||
    !textoUtil;

  if (falhaDeGeracao) {
    console.error("[caca] turno sem resposta utilizável, transferindo", {
      stopReason: result.stopReason,
      ticket: ticket.protocol ?? ticket.id,
      usage: result.usage,
    });
  }

  const handoffRequired = toolContext.handoff.requested || falhaDeGeracao;
  const replyText =
    (falhaDeGeracao ? "" : textoUtil) ||
    "Deixa eu chamar uma pessoa do nosso time pra te ajudar com isso. Já estou encaminhando o seu atendimento.";

  const nextState: CacaAutomationState = {
    ...state,
    apoloC2xClientId: toolContext.c2xClientId ?? state.apoloC2xClientId ?? null,
    apoloEntityId: apoloEntityId ?? state.apoloEntityId ?? null,
    apoloDisplayName:
      toolContext.customerName ?? state.apoloDisplayName ?? null,
    apoloValidationSource: toolContext.identityVerified
      ? toolContext.validationSource ?? "cpf"
      : state.apoloValidationSource ?? null,
    handoffRequired,
  };

  return {
    agentVersion: CACA_AGENT_VERSION,
    handoff: {
      reason:
        toolContext.handoff.reason ??
        (falhaDeGeracao
          ? `A assistente não conseguiu concluir a resposta (${result.stopReason ?? "sem texto"}).`
          : null),
      required: handoffRequired,
    },
    model,
    nextState,
    nextStep: handoffRequired ? "handoff" : "general_reply",
    replyText,
    source: "claude",
    toolsUsed: Array.from(new Set(result.trace.map((step) => step.tool))),
    usage: {
      cacheCreationTokens: result.usage.cacheCreationTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      inputTokens: result.usage.inputTokens,
      latencyMs,
      outputTokens: result.usage.outputTokens,
      requests: result.usage.requests,
      stopReason: result.stopReason,
    },
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
    // Desempate por id: rajada de WhatsApp cai no mesmo segundo, e sem critério estável
    // a mesma conversa pode voltar em ordem diferente entre um turno e outro — o que
    // muda a conversa por baixo do modelo e ainda estraga o cache de prefixo.
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
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

// Erro que significa "este modelo não existe ou não está liberado para esta conta":
// 404 do SDK, ou 400 reclamando do campo `model`. Qualquer outra falha (limite de taxa,
// timeout, indisponibilidade momentânea) fica DE FORA de propósito: rebaixar o modelo por
// causa de um soluço passageiro faria a Cacá atender no modelo pior sem ninguém notar.
function modeloIndisponivel(erro: unknown): boolean {
  const status = (erro as { status?: number } | null)?.status;

  if (status === 404) {
    return true;
  }

  const mensagem = (
    erro instanceof Error ? erro.message : String(erro ?? "")
  ).toLowerCase();

  return status === 400 && mensagem.includes("model");
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
