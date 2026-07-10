import { completeWithClaudeStructured, resolveClaudeModel } from "@/lib/ai/claude";
import { PANTEON_CHANGELOG } from "@/lib/changelog/changelog";

import { listHubItTickets } from "./server";
import {
  hubItTicketCategories,
  hubItTicketCategoryLabels,
  hubItTicketPriorities,
  hubItTicketPriorityLabels,
  type HubItTicketCategory,
  type HubItTicketPriority,
  type HubItTicketTriageResult,
} from "./types";

// Triagem do Nivel 1 (agente do HelpDesk). O agente LE o chamado, procura
// duplicata, confere se o changelog ja resolveu, sugere a classificacao correta
// e escreve a devolutiva. Ele NUNCA fecha o ticket e NUNCA finge que resolveu:
// so triagem e resposta. "Misto por confianca": casos claros (duplicata ou
// "ja corrigido na vX") o agente marca pra responder direto; o resto vira
// rascunho pro operador revisar. A decisao de mandar e sempre um clique humano.

type AuthorizedHubItTicketUser = Parameters<
  typeof listHubItTickets
>[0]["user"];

const MAX_DEDUPE_CANDIDATES = 50;
const MAX_CHANGELOG_ENTRIES = 25;

export async function runHubItTicketTriage({
  protocol,
  user,
}: {
  protocol: string;
  user: AuthorizedHubItTicketUser;
}): Promise<HubItTicketTriageResult> {
  const [ticket] = await listHubItTickets({
    includeDetails: true,
    protocol,
    scope: "all",
    user,
  });

  if (!ticket) {
    throw new Error("Chamado nao encontrado para triagem.");
  }

  // Lista leve pra dedupe: so o essencial de cada chamado, sem anexos/eventos.
  const allTickets = await listHubItTickets({ scope: "all", user });
  const candidates = allTickets
    .filter((current) => current.protocol !== ticket.protocol)
    .slice(0, MAX_DEDUPE_CANDIDATES)
    .map((current) => ({
      categoria: hubItTicketCategoryLabels[current.category],
      modulo: current.module,
      protocolo: current.protocol,
      status: current.status,
      titulo: current.title,
    }));

  const releases = PANTEON_CHANGELOG.slice(0, MAX_CHANGELOG_ENTRIES).map(
    (entry) => ({
      itens: entry.modules.flatMap((entryModule) =>
        entryModule.screens.flatMap((screen) => screen.items),
      ),
      modulos: entry.modules.map((entryModule) => entryModule.module),
      titulo: entry.title,
      versao: entry.version,
    }),
  );

  const structured = await completeWithClaudeStructured<HubItTicketTriageResult>({
    inputSchema: {
      properties: {
        autonomy: {
          description:
            "responder = casos claros (duplicata evidente ou ja corrigido numa versao do changelog) com confianca alta; rascunho = qualquer duvida ou correcao que exige o time.",
          enum: ["responder", "rascunho"],
          type: "string",
        },
        confidence: { enum: ["alta", "media", "baixa"], type: "string" },
        duplicateProtocol: {
          description:
            "Protocolo do chamado que este DUPLICA, ou string vazia se nao houver.",
          type: "string",
        },
        escalate: {
          description:
            "true quando precisa de engenharia/humano (bug real, sem correcao conhecida).",
          type: "boolean",
        },
        internalNote: {
          description: "Nota curta pro operador, so interna. Portugues.",
          type: "string",
        },
        resolutionSummary: {
          description:
            "Resumo objetivo do que resolve, so quando autonomy=responder (ex.: 'Corrigido na v1.31.5, pedir Ctrl+F5'). Vazio se rascunho.",
          type: "string",
        },
        resolvedByVersion: {
          description:
            "Versao do changelog que ja resolve este chamado, ou string vazia.",
          type: "string",
        },
        responseText: {
          description:
            "Devolutiva pro solicitante, em portugues, cordial e objetiva. Sempre assine como 'Zeus (assistente do Panteon)'. Sem travessao (usar virgula/dois-pontos).",
          type: "string",
        },
        suggestedCategory: { enum: [...hubItTicketCategories], type: "string" },
        suggestedPriority: { enum: [...hubItTicketPriorities], type: "string" },
      },
      required: [
        "autonomy",
        "confidence",
        "duplicateProtocol",
        "escalate",
        "internalNote",
        "resolutionSummary",
        "resolvedByVersion",
        "responseText",
        "suggestedCategory",
        "suggestedPriority",
      ],
      type: "object",
    },
    maxTokens: 1_400,
    messages: [
      {
        content: JSON.stringify({
          candidatos_duplicata: candidates,
          changelog_recente: releases,
          chamado: {
            categoria_atual: hubItTicketCategoryLabels[ticket.category],
            impacto_atual: hubItTicketPriorityLabels[ticket.priority],
            leitura_tecnica: ticket.technicalSummary,
            modulo: ticket.module,
            o_que_ocorreu: ticket.actualResult ?? "",
            protocolo: ticket.protocol,
            relato: ticket.userDescription,
            resultado_esperado: ticket.expectedResult ?? "",
            titulo: ticket.title,
          },
        }),
        role: "user",
      },
    ],
    model: resolveClaudeModel("default"),
    system: [
      "Voce e o Zeus, agente de triagem do HelpDesk do Panteon (Careli).",
      "Sua tarefa: ler o chamado, achar duplicata, conferir se o changelog ja resolveu, sugerir a classificacao (tipo/impacto) e escrever a devolutiva.",
      "REGRAS DURAS: voce NUNCA fecha o ticket e NUNCA afirma que consertou algo. Nivel 1 e triagem e resposta.",
      "So marque autonomy=responder quando a confianca for alta E for uma duplicata clara OU um caso ja corrigido numa versao do changelog. Qualquer duvida: autonomy=rascunho.",
      "Se for bug real sem correcao conhecida: escalate=true e autonomy=rascunho.",
      "Nao invente versao do changelog: so cite resolvedByVersion se a versao realmente aparecer na lista enviada.",
      "Entregue tudo chamando a ferramenta entregar_triagem.",
    ].join("\n"),
    toolDescription: "Entrega a triagem estruturada do chamado.",
    toolName: "entregar_triagem",
  });

  if (!structured) {
    return {
      autonomy: "rascunho",
      confidence: "baixa",
      duplicateProtocol: null,
      escalate: false,
      internalNote: "Triagem por IA indisponivel no momento.",
      resolutionSummary: "",
      resolvedByVersion: null,
      responseText: "",
      source: "unavailable",
      suggestedCategory: ticket.category,
      suggestedPriority: ticket.priority,
    };
  }

  return normalizeTriageResult(structured.data, {
    fallbackCategory: ticket.category,
    fallbackPriority: ticket.priority,
  });
}

// A trava "misto por confianca" mora aqui, no servidor: mesmo que o modelo
// escorregue, so vira "responder" quando ha DE FATO duplicata ou versao, com
// confianca alta e sem escalar. O resto cai pra rascunho.
function normalizeTriageResult(
  raw: HubItTicketTriageResult,
  fallback: {
    fallbackCategory: HubItTicketCategory;
    fallbackPriority: HubItTicketPriority;
  },
): HubItTicketTriageResult {
  const duplicateProtocol = cleanProtocol(raw.duplicateProtocol);
  const resolvedByVersion = cleanText(raw.resolvedByVersion);
  const escalate = Boolean(raw.escalate);
  const confidence = ["alta", "media", "baixa"].includes(raw.confidence)
    ? raw.confidence
    : "baixa";
  const hasClearResolution = Boolean(duplicateProtocol || resolvedByVersion);
  const autonomy =
    raw.autonomy === "responder" &&
    confidence === "alta" &&
    hasClearResolution &&
    !escalate
      ? "responder"
      : "rascunho";

  return {
    autonomy,
    confidence,
    duplicateProtocol,
    escalate,
    internalNote: cleanText(raw.internalNote) ?? "",
    resolutionSummary:
      autonomy === "responder" ? (cleanText(raw.resolutionSummary) ?? "") : "",
    resolvedByVersion,
    responseText: cleanText(raw.responseText) ?? "",
    source: "claude",
    suggestedCategory: hubItTicketCategories.includes(raw.suggestedCategory)
      ? raw.suggestedCategory
      : fallback.fallbackCategory,
    suggestedPriority: hubItTicketPriorities.includes(raw.suggestedPriority)
      ? raw.suggestedPriority
      : fallback.fallbackPriority,
  };
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function cleanProtocol(value: unknown): string | null {
  const text = cleanText(value);

  return text && /^TI-/i.test(text) ? text.toUpperCase() : null;
}
