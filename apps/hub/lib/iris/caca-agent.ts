import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { prepareBoletoResendAction } from "@/lib/guardian/asaas";
import { loadHadesAttendanceClient } from "@/lib/guardian/attendance";

export const CACA_AGENT_VERSION = "iris-caca-agent-v9";
const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_REASONING_EFFORT = "medium";
const DEFAULT_TEXT_VERBOSITY = "low";
const CACA_AUTOMATION_METADATA_KEY = "cacaAutomation";
const CACA_BUSINESS_TIME_ZONE = "America/Sao_Paulo";

type AgentTraceStatus = "blocked" | "error" | "ok" | "skipped";
type AgentTraceMetadata = Record<string, boolean | number | string | null>;

export type CacaAgentTraceStep = {
  at: string;
  metadata?: AgentTraceMetadata;
  status: AgentTraceStatus;
  summary: string;
  tool: string;
};

export type CacaAgentContact = {
  c2x_payload?: Record<string, unknown> | null;
  document?: string | null;
  display_name?: string | null;
  email?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  phone?: string | null;
  whatsapp_phone?: string | null;
};

export type CacaAgentTicket = {
  assigned_to_user_id?: string | null;
  contact_id?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  protocol?: string | null;
  source_context?: Record<string, unknown> | null;
  status?: string | null;
};

export type CacaAgentMessageDetail = {
  body: string;
  messageType: string;
};

type BillingItem = {
  acquisitionRequestId: string;
  dueDate: string;
  id: string;
  number: string;
  overdueDays: number;
  reference: string;
  status: "A vencer" | "Liquidada" | "Vencida";
  unitCode?: string;
  unitLabel?: string;
  value: string;
};

type CacaRichContext = {
  contracts: CacaContractContext[];
  customer: {
    c2xClientId: string | null;
    displayName: string | null;
    documentMasked: string | null;
    emailKnown: boolean;
    entityId: string | null;
    phoneKnown: boolean;
    validationSource: string | null;
  };
  financial: {
    installmentsOpen: number;
    installmentsOverdue: number;
    installmentsPaid: number;
  } | null;
  notes: string[];
  previousTickets: CacaPreviousTicketContext[];
  recentMessages: CacaContextMessage[];
};

type CacaContextMessage = {
  at: string | null;
  role: "atendimento" | "cliente" | "sistema";
  text: string;
  type: string | null;
};

type CacaContractContext = {
  contractStatus: string | null;
  d4signDocumentAvailable: boolean;
  d4signStatus: string | null;
  enterprise: string | null;
  unit: string | null;
};

type CacaPreviousTicketContext = {
  lastMessage: string | null;
  protocol: string | null;
  status: string | null;
  updatedAt: string | null;
};

type CaredeskMessageContextRow = {
  body: string | null;
  created_at: string | null;
  direction: string | null;
  message_type: string | null;
  sender_type: string | null;
  ticket_id?: string | null;
};

type CaredeskTicketContextRow = {
  id: string;
  protocol: string | null;
  status: string | null;
  updated_at: string | null;
};

export type CacaAutomationState = {
  apoloC2xClientId?: string | null;
  apoloDisplayName?: string | null;
  apoloEntityId?: string | null;
  apoloValidationSource?: "cpf" | "phone" | "state" | null;
  awaitingCadastroConfirmation?: boolean;
  awaitingBoletoSelection?: boolean;
  awaitingCustomerIdentity?: boolean;
  awaitingCpfDocument?: boolean;
  awaitingDocumentFragment?: boolean;
  boletoOptions?: Array<{
    index: number;
    label?: string;
    paymentId: string;
  }>;
  documentFragmentPosition?: "first4" | "last4";
  generalFallbackCount?: number;
  handoffRequired?: boolean;
  identityCandidateName?: string | null;
  identityCandidateUnitCode?: string | null;
  identityAttempts?: number;
  lastFallbackKind?: string | null;
  originalIntent?: string | null;
};

export type CacaAgentTurn = {
  agentVersion: typeof CACA_AGENT_VERSION;
  handoff: {
    reason: string | null;
    required: boolean;
  };
  model: string | null;
  nextState: CacaAutomationState;
  nextStep:
    | "ask_document_fragment"
    | "ask_customer_identity"
    | "boleto_ready"
    | "choose_boleto"
    | "general_reply"
    | "handoff";
  replyText: string;
  source: "deterministic" | "openai";
  toolsUsed: string[];
  trace: CacaAgentTraceStep[];
};

export async function runCacaAgentTurn({
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
  const trace: CacaAgentTraceStep[] = [];
  const toolsUsed: string[] = [];
  const state = readCacaAutomationState(ticket.metadata ?? null);
  const text = messageDetail.body.trim();
  const identityHint = extractCustomerIdentityHint(text);
  const unsupportedMedia =
    messageDetail.messageType !== "text" &&
    messageDetail.messageType !== "button" &&
    messageDetail.messageType !== "interactive";

  traceTool(trace, toolsUsed, {
    metadata: {
      hasState: Boolean(
        state.awaitingBoletoSelection ||
          state.awaitingCadastroConfirmation ||
          state.awaitingCpfDocument ||
          state.awaitingCustomerIdentity ||
          state.awaitingDocumentFragment,
      ),
      messageType: messageDetail.messageType,
      protocol: ticket.protocol ?? null,
    },
    status: "ok",
    summary: "Contexto Iris carregado para a Cacá.",
    tool: "iris_get_ticket_context",
  });

  if (unsupportedMedia) {
    traceTool(trace, toolsUsed, {
      metadata: { messageType: messageDetail.messageType },
      status: "blocked",
      summary: "Midia inbound ainda nao possui ferramenta de leitura homologada.",
      tool: "iris_read_customer_media",
    });

    return buildHandoffReply({
      reason:
        "Mensagem recebida exige leitura humana ou midia ainda nao analisada automaticamente.",
      replyText:
        "Recebi seu arquivo ou audio. Para analisar com seguranca, vou encaminhar para um atendente humano continuar o atendimento.",
      state,
      toolsUsed,
      trace,
    });
  }

  const conversationInterruption = buildConversationInterruptionReply({
    contact,
    state,
    text,
  });

  if (conversationInterruption) {
    const nextState = buildNextCacaState(state, {
      awaitingBoletoSelection: false,
      awaitingCadastroConfirmation: false,
      awaitingCpfDocument: false,
      awaitingCustomerIdentity: false,
      awaitingDocumentFragment: false,
      boletoOptions: [],
      generalFallbackCount: 0,
      handoffRequired: conversationInterruption.handoffRequired,
      lastFallbackKind: conversationInterruption.kind,
      originalIntent: null,
    });

    if (conversationInterruption.handoffRequired) {
      return buildHandoffReply({
        reason:
          conversationInterruption.reason ??
          "Atendimento humano solicitado pela conversa.",
        replyText: conversationInterruption.text,
        state: nextState,
        toolsUsed,
        trace,
      });
    }

    return finalizeTurn({
      handoff: {
        reason: null,
        required: false,
      },
      model: null,
      nextState,
      nextStep: "general_reply",
      replyText: conversationInterruption.text,
      source: "deterministic",
      toolsUsed,
      trace,
    });
  }

  const selectedBoletoOptions = state.awaitingBoletoSelection
    ? resolveSelectedBoletoOptions(text, state)
    : [];
  const financialPendingIntent = hasFinancialPendingIntent(text);
  const boletoIntent =
    hasBoletoIntent(text) ||
    financialPendingIntent ||
    Boolean(state.awaitingCadastroConfirmation) ||
    Boolean(state.awaitingCpfDocument) ||
    Boolean(state.awaitingCustomerIdentity) ||
    Boolean(state.awaitingDocumentFragment) ||
    Boolean(state.awaitingBoletoSelection);

  traceTool(trace, toolsUsed, {
    metadata: {
      awaitingBoletoSelection: Boolean(state.awaitingBoletoSelection),
      awaitingCadastroConfirmation: Boolean(state.awaitingCadastroConfirmation),
      awaitingCpfDocument: Boolean(state.awaitingCpfDocument),
      boletoIntent,
      financialPendingIntent,
      selectedPayments: selectedBoletoOptions.length,
    },
    status: "ok",
    summary: boletoIntent
      ? financialPendingIntent
        ? "Intencao de pendencia financeira detectada e direcionada ao fluxo seguro de consulta."
        : "Intencao de boleto detectada ou conversa ja estava nesse fluxo."
      : "Mensagem classificada como atendimento geral.",
    tool: "caca_classify_intent",
  });

  if (!boletoIntent) {
    const richContext = await loadCacaRichContext({
      client,
      contact,
      state,
      ticket,
      toolsUsed,
      trace,
    });
    const aiReply = await requestCacaOpenAiReply({
      contact,
      context: richContext,
      message: text,
      state,
      ticket,
      toolsUsed,
      trace,
    });
    const fallback = buildAutonomousFallbackReply({
      contact,
      context: richContext,
      state,
      text,
    });
    const nextFallbackCount = aiReply.text
      ? 0
      : (state.generalFallbackCount ?? 0) + 1;

    return finalizeTurn({
      handoff: {
        reason: null,
        required: false,
      },
      model: aiReply.model,
      nextState: buildNextCacaState(state, {
        awaitingBoletoSelection: false,
        awaitingCadastroConfirmation: false,
        awaitingCpfDocument: false,
        awaitingCustomerIdentity: false,
        awaitingDocumentFragment: false,
        generalFallbackCount: nextFallbackCount,
        handoffRequired: false,
        lastFallbackKind: aiReply.text ? null : fallback.kind,
      }),
      nextStep: "general_reply",
      replyText: aiReply.text || fallback.text,
      source: aiReply.text ? "openai" : "deterministic",
      toolsUsed,
      trace,
    });
  }

  const customerAccess = await resolveBoletoCustomerAccess({
    client,
    contact,
    identityHint,
    state,
    text,
    ticket,
    toolsUsed,
    trace,
  });

  if (customerAccess.status === "ask") {
    return finalizeTurn({
      handoff: {
        reason: null,
        required: false,
      },
      model: null,
      nextState: buildNextCacaState(state, {
        awaitingBoletoSelection: false,
        awaitingCadastroConfirmation:
          customerAccess.awaiting === "cadastro_confirmation",
        awaitingCpfDocument: customerAccess.awaiting === "cpf",
        awaitingCustomerIdentity: true,
        awaitingDocumentFragment: false,
        handoffRequired: false,
        identityAttempts: (state.identityAttempts ?? 0) + 1,
        ...customerAccess.statePatch,
        originalIntent: state.originalIntent ?? text,
      }),
      nextStep: "ask_customer_identity",
      replyText: customerAccess.replyText,
      source: "deterministic",
      toolsUsed,
      trace,
    });
  }

  if (customerAccess.status === "handoff") {
    return buildHandoffReply({
      reason: customerAccess.reason,
      replyText: customerAccess.replyText,
      state: buildNextCacaState(state, customerAccess.statePatch ?? {}),
      toolsUsed,
      trace,
    });
  }

  if (state.awaitingBoletoSelection && selectedBoletoOptions.length === 0) {
    const normalizedText = normalizeForIntent(text);

    if (isThanks(normalizedText)) {
      return finalizeTurn({
        handoff: {
          reason: null,
          required: false,
        },
        model: null,
        nextState: buildNextCacaState(state, {
          awaitingBoletoSelection: false,
          boletoOptions: [],
          generalFallbackCount: 0,
          lastFallbackKind: "thanks_after_boleto",
          originalIntent: null,
        }),
        nextStep: "general_reply",
        replyText:
          "Por nada. Fico feliz em ajudar. Se precisar de mais alguma coisa depois, me chama por aqui.",
        source: "deterministic",
        toolsUsed,
        trace,
      });
    }

    if (isNoLongerNeeded(normalizedText)) {
      return finalizeTurn({
        handoff: {
          reason: null,
          required: false,
        },
        model: null,
        nextState: buildNextCacaState(state, {
          awaitingBoletoSelection: false,
          boletoOptions: [],
          generalFallbackCount: 0,
          lastFallbackKind: "customer_closed_boleto_flow",
          originalIntent: null,
        }),
        nextStep: "general_reply",
        replyText:
          "Tudo certo. Vou deixar essa solicitacao encerrada por aqui. Se precisar de algo depois, eu retomo com voce.",
        source: "deterministic",
        toolsUsed,
        trace,
      });
    }

    if (!looksLikeBoletoSelectionAttempt(normalizedText)) {
      const richContext = await loadCacaRichContext({
        client,
        contact,
        state,
        ticket,
        toolsUsed,
        trace,
      });
      const fallback = buildAutonomousFallbackReply({
        contact,
        context: richContext,
        state,
        text,
      });

      return finalizeTurn({
        handoff: {
          reason: null,
          required: false,
        },
        model: null,
        nextState: buildNextCacaState(state, {
          awaitingBoletoSelection: false,
          boletoOptions: [],
          generalFallbackCount: 0,
          lastFallbackKind: fallback.kind,
          originalIntent: null,
        }),
        nextStep: "general_reply",
        replyText: fallback.text,
        source: "deterministic",
        toolsUsed,
        trace,
      });
    }

    return finalizeTurn({
      handoff: {
        reason: null,
        required: false,
      },
      model: null,
      nextState: state,
      nextStep: "choose_boleto",
      replyText:
        "Para eu enviar o boleto certo, responda com o *numero correspondente* da lista. Se quiser mais de um, envie os numeros juntos. Ex.: 1 e 3.",
      source: "deterministic",
      toolsUsed,
      trace,
    });
  }

  const c2xClientId =
    customerAccess.c2xClientId ?? extractC2xClientId(contact, ticket);

  traceTool(trace, toolsUsed, {
    metadata: {
      c2xClientKnown: Boolean(c2xClientId),
      validationSource: customerAccess.validationSource,
    },
    status: c2xClientId ? "ok" : "blocked",
    summary: c2xClientId
      ? "Vinculo C2X encontrado para consulta financeira controlada."
      : "Vinculo C2X ausente no contexto Iris.",
    tool: "apolo_lookup_customer",
  });

  if (!c2xClientId) {
    return buildHandoffReply({
      reason: "Contato Iris sem id de cliente C2X para consulta financeira.",
      replyText:
        "Seu cadastro foi confirmado, mas ainda nao encontrei o vinculo financeiro necessario para listar boletos. Vou encaminhar para um atendente humano consultar no sistema.",
      state,
      toolsUsed,
      trace,
    });
  }

  if (selectedBoletoOptions.length > 0) {
    try {
      const deliveredBoletos: Array<{ label: string; url: string }> = [];

      for (const option of selectedBoletoOptions) {
        const boleto = await prepareBoletoResendAction(option.paymentId, "link");
        const boletoUrl = boleto.boletoUrl;

        if (!boletoUrl) {
          throw new Error("Esta parcela nao possui link de boleto no sistema.");
        }

        deliveredBoletos.push({
          label: option.label ?? `Boleto ${option.index}`,
          url: boletoUrl,
        });
      }

      traceTool(trace, toolsUsed, {
        metadata: {
          firstPaymentId: selectedBoletoOptions[0]?.paymentId ?? null,
          payments: selectedBoletoOptions.length,
        },
        status: "ok",
        summary: "Asset oficial de boleto preparado por ferramenta Hades.",
        tool: "hades_get_boleto_delivery_asset",
      });

      const selectedIds = new Set(
        selectedBoletoOptions.map((option) => option.paymentId),
      );
      const remainingOptions = (state.boletoOptions ?? []).filter(
        (option) => !selectedIds.has(option.paymentId),
      );
      const deliveredList =
        deliveredBoletos.length === 1
          ? buildDeliveredBoletoLine(deliveredBoletos[0])
          : deliveredBoletos
              .map(
                (item, index) =>
                  `${index + 1}. ${item.label}\nLink do boleto: ${item.url}`,
              )
              .join("\n\n");

      return finalizeTurn({
        handoff: {
          reason: null,
          required: false,
        },
        model: null,
        nextState: buildNextCacaState(state, {
          apoloC2xClientId: customerAccess.c2xClientId,
          apoloDisplayName: customerAccess.displayName,
          apoloEntityId: customerAccess.entityId,
          apoloValidationSource: customerAccess.validationSource,
          awaitingBoletoSelection: remainingOptions.length > 0,
          awaitingCadastroConfirmation: false,
          awaitingCpfDocument: false,
          awaitingCustomerIdentity: false,
          awaitingDocumentFragment: false,
          boletoOptions: remainingOptions,
          handoffRequired: false,
          identityAttempts: 0,
          originalIntent: remainingOptions.length > 0 ? state.originalIntent ?? text : null,
        }),
        nextStep: "boleto_ready",
        replyText: [
          deliveredBoletos.length === 1
            ? "*Pronto, localizei o boleto solicitado.*"
            : "*Pronto, localizei os boletos solicitados.*",
          "",
          deliveredList,
          "",
          "*Confira os dados antes de concluir o pagamento.*",
          "",
          remainingOptions.length > 0
            ? "Se quiser receber outro boleto da lista, responda com o *numero correspondente*."
            : "Se precisar de outro boleto, me avise por aqui.",
        ].join("\n"),
        source: "deterministic",
        toolsUsed,
        trace,
      });
    } catch (error) {
      traceTool(trace, toolsUsed, {
        metadata: {
          error: errorMessage(error),
          firstPaymentId: selectedBoletoOptions[0]?.paymentId ?? null,
          payments: selectedBoletoOptions.length,
        },
        status: "error",
        summary: "Falha sanitizada ao preparar asset oficial de boleto.",
        tool: "hades_get_boleto_delivery_asset",
      });

      return buildHandoffReply({
        reason: "Ferramenta de boleto nao conseguiu preparar o link oficial.",
        replyText:
          "Seu cadastro foi confirmado, mas nao consegui preparar o boleto com seguranca agora. Vou encaminhar para um atendente humano continuar.",
        state,
        toolsUsed,
        trace,
      });
    }
  }

  const billing = await loadBillingItems(c2xClientId);

  traceTool(trace, toolsUsed, {
    metadata: {
      items: billing.items.length,
      sourceError: Boolean(billing.error),
    },
    status: billing.error ? "error" : "ok",
    summary: billing.error
      ? "Consulta de parcelas retornou erro sanitizado."
      : "Parcelas elegiveis carregadas do Hades/C2X.",
    tool: "hades_list_customer_billing_items",
  });

  if (billing.error) {
    return buildHandoffReply({
      reason: billing.error,
      replyText:
        "Seu cadastro foi confirmado, mas a consulta financeira nao respondeu agora. Vou encaminhar para um atendente humano conferir seus boletos com seguranca.",
      state,
      toolsUsed,
      trace,
    });
  }

  if (billing.items.length === 0) {
    return finalizeTurn({
      handoff: {
        reason: null,
        required: false,
      },
      model: null,
      nextState: buildNextCacaState(state, {
        apoloC2xClientId: customerAccess.c2xClientId,
        apoloDisplayName: customerAccess.displayName,
        apoloEntityId: customerAccess.entityId,
        apoloValidationSource: customerAccess.validationSource,
        awaitingBoletoSelection: false,
        awaitingCadastroConfirmation: false,
        awaitingCpfDocument: false,
        awaitingCustomerIdentity: false,
        awaitingDocumentFragment: false,
        boletoOptions: [],
        handoffRequired: false,
        identityAttempts: 0,
        originalIntent: null,
      }),
      nextStep: "general_reply",
      replyText:
        "Conferi seu cadastro e nao encontrei boletos vencidos ou a vencer com link disponivel neste momento.",
      source: "deterministic",
      toolsUsed,
      trace,
    });
  }

  const visibleItems = billing.items.slice(0, 6);
  const list = visibleItems
    .map((item, index) => {
      return `${index + 1}. ${buildBillingOptionLabel(item)}`;
    })
    .join("\n");

  return finalizeTurn({
    handoff: {
      reason: null,
      required: false,
    },
    model: null,
    nextState: buildNextCacaState(state, {
      apoloC2xClientId: customerAccess.c2xClientId,
      apoloDisplayName: customerAccess.displayName,
      apoloEntityId: customerAccess.entityId,
      apoloValidationSource: customerAccess.validationSource,
      awaitingBoletoSelection: true,
      awaitingCadastroConfirmation: false,
      awaitingCpfDocument: false,
      awaitingCustomerIdentity: false,
      awaitingDocumentFragment: false,
      boletoOptions: visibleItems.map((item, index) => ({
        index: index + 1,
        label: buildBillingOptionLabel(item),
        paymentId: item.id,
      })),
      handoffRequired: false,
      identityAttempts: 0,
      originalIntent: state.originalIntent ?? text,
    }),
    nextStep: "choose_boleto",
    replyText: [
      "*Cadastro confirmado.* Encontrei estes boletos disponiveis:",
      "",
      list,
      "",
      "*Responda com o numero correspondente* ao boleto que quer receber.",
      "Se quiser mais de um, envie os numeros juntos. Ex.: 1 e 3.",
    ].join("\n"),
    source: "deterministic",
    toolsUsed,
    trace,
  });
}

export function readCacaAutomationState(
  metadata: Record<string, unknown> | null,
): CacaAutomationState {
  const raw = isRecord(metadata)
    ? metadata[CACA_AUTOMATION_METADATA_KEY]
    : null;
  const record = isRecord(raw) ? raw : {};
  const boletoOptions = Array.isArray(record.boletoOptions)
    ? record.boletoOptions
        .map((option) => (isRecord(option) ? option : null))
        .filter((option): option is Record<string, unknown> => Boolean(option))
        .map((option) => ({
          index: Number(option.index),
          label: readString(option.label) ?? undefined,
          paymentId: readString(option.paymentId) ?? "",
        }))
        .filter((option) => Number.isFinite(option.index) && option.paymentId)
    : [];

  return {
    apoloC2xClientId: readString(record.apoloC2xClientId),
    apoloDisplayName: readString(record.apoloDisplayName),
    apoloEntityId: readString(record.apoloEntityId),
    apoloValidationSource:
      record.apoloValidationSource === "cpf" ||
      record.apoloValidationSource === "phone" ||
      record.apoloValidationSource === "state"
        ? record.apoloValidationSource
        : null,
    awaitingBoletoSelection: record.awaitingBoletoSelection === true,
    awaitingCadastroConfirmation:
      record.awaitingCadastroConfirmation === true,
    awaitingCpfDocument: record.awaitingCpfDocument === true,
    awaitingCustomerIdentity: record.awaitingCustomerIdentity === true,
    awaitingDocumentFragment: record.awaitingDocumentFragment === true,
    boletoOptions,
    documentFragmentPosition:
      record.documentFragmentPosition === "first4" ? "first4" : "last4",
    handoffRequired: record.handoffRequired === true,
    identityCandidateName: readString(record.identityCandidateName),
    identityCandidateUnitCode: readString(record.identityCandidateUnitCode),
    generalFallbackCount: Number.isFinite(Number(record.generalFallbackCount))
      ? Number(record.generalFallbackCount)
      : 0,
    identityAttempts: Number.isFinite(Number(record.identityAttempts))
      ? Number(record.identityAttempts)
      : 0,
    lastFallbackKind: readString(record.lastFallbackKind),
    originalIntent: readString(record.originalIntent),
  };
}

type CustomerIdentityHint = {
  documentDigits: string | null;
  documentFragment: string | null;
  documentType: "cnpj" | "cpf" | null;
  fullName: string | null;
  unitCode: string | null;
};

type ApoloEntityRow = {
  display_name: string;
  document_masked: string | null;
  entity_kind: string;
  id: string;
  status: string | null;
};

type ApoloIdentifierRow = {
  entity_id: string;
  value_hash: string;
  value_masked: string | null;
};

type ApoloProfileRow = {
  entity_id: string;
  profile: string;
  status: string | null;
};

type ApoloCommercialLinkRow = {
  entity_id: string;
  metadata: Record<string, unknown> | null;
  relationship_role: string | null;
  stage_label: string | null;
  status: string | null;
  unit_label: string | null;
};

type ApoloSourceLinkRow = {
  entity_id: string;
  source_id: string | null;
  source_system: string | null;
  source_table: string | null;
};

type ApoloCustomerRecord = {
  c2xClientId: string | null;
  displayName: string;
  documentMasked: string | null;
  entityId: string;
  hasBuyerProfile: boolean;
  hasUnitPortfolio: boolean;
  profiles: string[];
  unitLabels: string[];
};

type BoletoCustomerAccess =
  | {
      c2xClientId: string | null;
      displayName: string | null;
      entityId: string | null;
      status: "verified";
      validationSource: "cpf" | "phone" | "state";
    }
  | {
      awaiting: "cadastro_confirmation" | "cpf";
      replyText: string;
      statePatch?: Partial<CacaAutomationState>;
      status: "ask";
    }
  | {
      reason: string;
      replyText: string;
      statePatch?: Partial<CacaAutomationState>;
      status: "handoff";
    };

async function resolveBoletoCustomerAccess({
  client,
  contact,
  identityHint,
  state,
  text,
  ticket,
  toolsUsed,
  trace,
}: {
  client?: SupabaseClient;
  contact: CacaAgentContact;
  identityHint: CustomerIdentityHint;
  state: CacaAutomationState;
  text: string;
  ticket: CacaAgentTicket;
  toolsUsed: string[];
  trace: CacaAgentTraceStep[];
}): Promise<BoletoCustomerAccess> {
  const storedC2xClientId =
    state.apoloC2xClientId ?? extractC2xClientId(contact, ticket);

  if (
    state.apoloEntityId &&
    storedC2xClientId &&
    (state.apoloValidationSource === "phone" ||
      state.apoloValidationSource === "cpf" ||
      state.awaitingBoletoSelection)
  ) {
    traceTool(trace, toolsUsed, {
      metadata: {
        entityId: state.apoloEntityId,
        validationSource: state.apoloValidationSource ?? "state",
      },
      status: "ok",
      summary: "Identidade Apolo ja validada neste ticket.",
      tool: "apolo_reuse_customer_identity",
    });

    return {
      c2xClientId: storedC2xClientId,
      displayName: state.apoloDisplayName ?? contact.display_name ?? null,
      entityId: state.apoloEntityId,
      status: "verified",
      validationSource: state.apoloValidationSource ?? "state",
    };
  }

  if (!client) {
    traceTool(trace, toolsUsed, {
      metadata: { hasSupabaseClient: false },
      status: "blocked",
      summary: "Cliente Supabase indisponivel para validar comprador no Apolo.",
      tool: "apolo_validate_customer_phone",
    });

    return askForCpfIdentity({
      contact,
      identityHint,
      reason:
        "Nao consegui consultar nosso sistema automaticamente neste momento. Vamos validar pelo CPF do proponente.",
      state,
      text,
    });
  }

  const phoneMatch = await lookupApoloByPhone(client, contact);

  traceTool(trace, toolsUsed, {
    metadata: {
      c2xClientKnown: Boolean(phoneMatch?.c2xClientId),
      found: Boolean(phoneMatch),
      hasBuyerProfile: Boolean(phoneMatch?.hasBuyerProfile),
      hasUnitPortfolio: Boolean(phoneMatch?.hasUnitPortfolio),
    },
    status:
      phoneMatch?.hasBuyerProfile && phoneMatch.hasUnitPortfolio
        ? "ok"
        : "blocked",
    summary:
      phoneMatch?.hasBuyerProfile && phoneMatch.hasUnitPortfolio
        ? "Telefone do WhatsApp validado como comprador com unidade no Apolo."
        : "Telefone do WhatsApp nao validou comprador com unidade no Apolo.",
    tool: "apolo_validate_customer_phone",
  });

  if (
    phoneMatch?.hasBuyerProfile &&
    phoneMatch.hasUnitPortfolio &&
    phoneMatch.c2xClientId
  ) {
    return {
      c2xClientId: phoneMatch.c2xClientId,
      displayName: phoneMatch.displayName,
      entityId: phoneMatch.entityId,
      status: "verified",
      validationSource: "phone",
    };
  }

  const storedCandidate = state.apoloEntityId
    ? await lookupApoloByEntityId(client, state.apoloEntityId)
    : null;

  if (
    state.awaitingCadastroConfirmation &&
    storedCandidate &&
    !identityHint.documentDigits
  ) {
    const providedName = identityHint.fullName ?? text;

    traceTool(trace, toolsUsed, {
      metadata: {
        entityId: storedCandidate.entityId,
        nameMatched: nameMatches(storedCandidate.displayName, providedName),
      },
      status: nameMatches(storedCandidate.displayName, providedName)
        ? "ok"
        : "blocked",
      summary: "Confirmacao cadastral do proponente avaliada pelo Apolo.",
      tool: "apolo_verify_customer_cadastro",
    });

    if (nameMatches(storedCandidate.displayName, providedName)) {
      return {
        c2xClientId: storedCandidate.c2xClientId,
        displayName: storedCandidate.displayName,
        entityId: storedCandidate.entityId,
        status: "verified",
        validationSource: "cpf",
      };
    }

    if ((state.identityAttempts ?? 0) >= 3) {
      return {
        reason: "Confirmacao cadastral do proponente nao conferiu.",
        replyText:
          "Nao consegui confirmar os dados cadastrais com seguranca por aqui. Vou encaminhar para um atendente validar seu contrato e seguir com o boleto.",
        statePatch: {
          awaitingCadastroConfirmation: false,
          awaitingCpfDocument: false,
          handoffRequired: true,
        },
        status: "handoff",
      };
    }

    return {
      awaiting: "cadastro_confirmation",
      replyText:
        "Ainda nao consegui confirmar o cadastro. Me envie o *nome completo do titular do contrato* exatamente como esta no cadastro.",
      statePatch: {
        apoloC2xClientId: storedCandidate.c2xClientId,
        apoloDisplayName: storedCandidate.displayName,
        apoloEntityId: storedCandidate.entityId,
        identityCandidateName:
          state.identityCandidateName ?? identityHint.fullName,
        identityCandidateUnitCode:
          state.identityCandidateUnitCode ?? identityHint.unitCode,
      },
      status: "ask",
    };
  }

  const documentDigits = identityHint.documentDigits;

  if (documentDigits && (documentDigits.length === 11 || documentDigits.length === 14)) {
    const documentMatch = await lookupApoloByDocument(client, documentDigits);

    traceTool(trace, toolsUsed, {
      metadata: {
        documentType: documentDigits.length === 14 ? "cnpj" : "cpf",
        found: Boolean(documentMatch),
        hasBuyerProfile: Boolean(documentMatch?.hasBuyerProfile),
        hasUnitPortfolio: Boolean(documentMatch?.hasUnitPortfolio),
      },
      status: documentMatch ? "ok" : "blocked",
      summary: documentMatch
        ? "Documento do proponente localizado no Apolo."
        : "Documento do proponente nao encontrado no Apolo.",
      tool: "apolo_lookup_customer_document",
    });

    if (!documentMatch) {
      return {
        reason: "CPF/CNPJ informado nao encontrado no sistema.",
        replyText:
          "Nao encontrei esse CPF/CNPJ em nosso sistema. Vou encaminhar para um atendente validar o proponente do contrato com seguranca.",
        statePatch: {
          awaitingCadastroConfirmation: false,
          awaitingCpfDocument: false,
          handoffRequired: true,
        },
        status: "handoff",
      };
    }

    if (!documentMatch.hasBuyerProfile || !documentMatch.hasUnitPortfolio) {
      return {
        reason: "Documento encontrado no sistema sem perfil de comprador com unidade.",
        replyText:
          "Localizei o cadastro, mas ele nao aparece como comprador com unidade ativa em nosso sistema. Vou encaminhar para um atendente validar o contrato antes de enviar boleto.",
        statePatch: {
          apoloC2xClientId: documentMatch.c2xClientId,
          apoloDisplayName: documentMatch.displayName,
          apoloEntityId: documentMatch.entityId,
          handoffRequired: true,
        },
        status: "handoff",
      };
    }

    const providedName =
      identityHint.fullName ??
      state.identityCandidateName ??
      contact.display_name ??
      null;

    if (providedName && nameMatches(documentMatch.displayName, providedName)) {
      traceTool(trace, toolsUsed, {
        metadata: {
          entityId: documentMatch.entityId,
          nameMatched: true,
        },
        status: "ok",
        summary:
          "Documento e dado cadastral do proponente conferiram no Apolo.",
        tool: "apolo_verify_customer_cadastro",
      });

      return {
        c2xClientId: documentMatch.c2xClientId,
        displayName: documentMatch.displayName,
        entityId: documentMatch.entityId,
        status: "verified",
        validationSource: "cpf",
      };
    }

    return {
      awaiting: "cadastro_confirmation",
      replyText:
        "Localizei o cadastro pelo *CPF/CNPJ*. Para concluir a validacao, me envie o *nome completo do titular do contrato*.",
      statePatch: {
        apoloC2xClientId: documentMatch.c2xClientId,
        apoloDisplayName: documentMatch.displayName,
        apoloEntityId: documentMatch.entityId,
        identityCandidateName:
          state.identityCandidateName ?? identityHint.fullName,
        identityCandidateUnitCode:
          state.identityCandidateUnitCode ?? identityHint.unitCode,
      },
      status: "ask",
    };
  }

  const candidateByHint = await lookupApoloByNameAndUnit(
    client,
    identityHint,
  );

  if (candidateByHint) {
    traceTool(trace, toolsUsed, {
      metadata: {
        entityId: candidateByHint.entityId,
        unitHint: identityHint.unitCode,
      },
      status: "ok",
      summary:
        "Nome/unidade informados localizaram um candidato no Apolo; CPF ainda sera validado.",
      tool: "apolo_lookup_customer_hint",
    });
  }

  return askForCpfIdentity({
    contact,
    identityHint,
    reason: phoneMatch
      ? "Nao encontrei este numero como telefone de comprador com unidade em nosso sistema."
      : "Nao encontrei este numero no cadastro de comprador em nosso sistema.",
    state: buildNextCacaState(state, {
      apoloC2xClientId: candidateByHint?.c2xClientId ?? null,
      apoloDisplayName: candidateByHint?.displayName ?? null,
      apoloEntityId: candidateByHint?.entityId ?? null,
    }),
    text,
  });
}

function askForCpfIdentity({
  contact,
  identityHint,
  reason,
  state,
  text,
}: {
  contact: CacaAgentContact;
  identityHint: CustomerIdentityHint;
  reason: string;
  state: CacaAutomationState;
  text: string;
}): BoletoCustomerAccess {
  const name = firstName(contact.display_name);
  const candidateName = identityHint.fullName ?? state.identityCandidateName;
  const unitCode = identityHint.unitCode ?? state.identityCandidateUnitCode;
  const contextHint = [
    candidateName ? "Ja considerei o nome informado para localizar o cadastro." : null,
    unitCode ? "Tambem considerei a unidade informada para conferir o contrato." : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    awaiting: "cpf",
    replyText: [
      `Claro${name ? `, ${name}` : ""}. Vou cuidar disso com voce.`,
      reason,
      contextHint,
      "Para proteger seus dados, me envie o *CPF ou CNPJ completo* do proponente do contrato.",
    ]
      .filter(Boolean)
      .join(" "),
    statePatch: {
      awaitingCadastroConfirmation: false,
      awaitingCpfDocument: true,
      identityCandidateName: candidateName ?? extractLikelyName(text),
      identityCandidateUnitCode: unitCode,
    },
    status: "ask",
  };
}

async function lookupApoloByPhone(
  client: SupabaseClient,
  contact: CacaAgentContact,
) {
  const phones = uniqueStrings(
    [contact.whatsapp_phone, contact.phone]
      .map((phone) => readString(phone))
      .filter((phone): phone is string => Boolean(phone)),
  );

  if (!phones.length) {
    return null;
  }

  const hashes = uniqueStrings(
    phones
      .flatMap((phone) => buildBrazilPhoneVariants(phone))
      .map((phone) => hashIdentifier("phone", phone)),
  );

  return lookupApoloByIdentifierHashes(client, ["phone"], hashes);
}

async function lookupApoloByDocument(
  client: SupabaseClient,
  documentDigits: string,
) {
  const documentType = documentDigits.length === 14 ? "cnpj" : "cpf";

  return lookupApoloByIdentifierHashes(client, [documentType], [
    hashIdentifier(documentType, documentDigits),
  ]);
}

async function lookupApoloByIdentifierHashes(
  client: SupabaseClient,
  identifierTypes: string[],
  hashes: string[],
) {
  if (!hashes.length) {
    return null;
  }

  const { data, error } = await client
    .from("apolo_entity_identifiers")
    .select("entity_id,value_hash,value_masked")
    .in("identifier_type", identifierTypes)
    .in("value_hash", hashes)
    .limit(20)
    .returns<ApoloIdentifierRow[]>();

  if (error || !data?.length) {
    return null;
  }

  const records = await hydrateApoloCustomerRecords(
    client,
    uniqueStrings(data.map((row) => row.entity_id)),
  );

  return pickPreferredApoloCustomer(records);
}

async function lookupApoloByEntityId(client: SupabaseClient, entityId: string) {
  const records = await hydrateApoloCustomerRecords(client, [entityId]);

  return records[0] ?? null;
}

async function lookupApoloByNameAndUnit(
  client: SupabaseClient,
  identityHint: CustomerIdentityHint,
) {
  if (!identityHint.fullName && !identityHint.unitCode) {
    return null;
  }

  const query = normalizeForIntent(
    [identityHint.fullName, identityHint.unitCode].filter(Boolean).join(" "),
  );

  if (query.length < 4) {
    return null;
  }

  const { data, error } = await client
    .from("apolo_search_entries")
    .select("entity_id")
    .ilike("normalized_text", `%${query}%`)
    .limit(10)
    .returns<Array<{ entity_id: string }>>();

  if (error || !data?.length) {
    return null;
  }

  const records = await hydrateApoloCustomerRecords(
    client,
    uniqueStrings(data.map((row) => row.entity_id)),
  );
  const unitCode = normalizeForIntent(identityHint.unitCode ?? "");
  const filtered = unitCode
    ? records.filter((record) =>
        record.unitLabels.some((unit) =>
          normalizeForIntent(unit).includes(unitCode),
        ),
      )
    : records;

  return pickPreferredApoloCustomer(filtered);
}

async function hydrateApoloCustomerRecords(
  client: SupabaseClient,
  entityIds: string[],
): Promise<ApoloCustomerRecord[]> {
  const uniqueEntityIds = uniqueStrings(entityIds).filter(Boolean);

  if (!uniqueEntityIds.length) {
    return [];
  }

  const [entitiesResult, profilesResult, commercialResult, sourcesResult] =
    await Promise.all([
      client
        .from("apolo_entities")
        .select("id,display_name,document_masked,entity_kind,status")
        .in("id", uniqueEntityIds)
        .neq("status", "archived")
        .returns<ApoloEntityRow[]>(),
      client
        .from("apolo_entity_profiles")
        .select("entity_id,profile,status")
        .in("entity_id", uniqueEntityIds)
        .returns<ApoloProfileRow[]>(),
      client
        .from("apolo_commercial_links")
        .select("entity_id,relationship_role,unit_label,stage_label,status,metadata")
        .in("entity_id", uniqueEntityIds)
        .neq("status", "archived")
        .returns<ApoloCommercialLinkRow[]>(),
      client
        .from("apolo_source_links")
        .select("entity_id,source_system,source_table,source_id")
        .in("entity_id", uniqueEntityIds)
        .returns<ApoloSourceLinkRow[]>(),
    ]);

  if (
    entitiesResult.error ||
    profilesResult.error ||
    commercialResult.error ||
    sourcesResult.error
  ) {
    return [];
  }

  const profilesByEntity = groupRowsBy(
    (profilesResult.data ?? []).filter((row) => row.status !== "archived"),
    "entity_id",
  );
  const commercialByEntity = groupRowsBy(
    (commercialResult.data ?? []).filter((row) => row.status !== "archived"),
    "entity_id",
  );
  const sourcesByEntity = groupRowsBy(sourcesResult.data ?? [], "entity_id");

  return (entitiesResult.data ?? []).map((entity) => {
    const profiles = uniqueStrings(
      (profilesByEntity.get(entity.id) ?? []).map((row) => row.profile),
    );
    const commercialLinks = commercialByEntity.get(entity.id) ?? [];
    const unitLabels = commercialLinks
      .flatMap((row) => [
        row.unit_label,
        readString(row.metadata?.unitCode),
        readString(row.metadata?.unitId),
      ])
      .filter((value): value is string => Boolean(value));
    const hasBuyerProfile = profiles.includes("usuario");
    const hasUnitPortfolio =
      hasBuyerProfile ||
      commercialLinks.some((row) => {
        const role = normalizeForIntent(row.relationship_role ?? "");
        const unitText = normalizeForIntent(
          [row.unit_label, readString(row.metadata?.unitCode)].join(" "),
        );

        return (
          role.includes("usuario") &&
          unitText.length > 0 &&
          !unitText.includes("sem carteira") &&
          !unitText.includes("qualificacao")
        );
      });
    const c2xClientId =
      sourcesByEntity
        .get(entity.id)
        ?.find(
          (row) =>
            row.source_system === "c2x" &&
            row.source_table === "users" &&
            /^\d+$/.test(String(row.source_id ?? "")),
        )?.source_id ?? null;

    return {
      c2xClientId,
      displayName: entity.display_name,
      documentMasked: entity.document_masked,
      entityId: entity.id,
      hasBuyerProfile,
      hasUnitPortfolio,
      profiles,
      unitLabels: uniqueStrings(unitLabels),
    };
  });
}

function pickPreferredApoloCustomer(records: ApoloCustomerRecord[]) {
  return (
    records.find(
      (record) =>
        record.hasBuyerProfile && record.hasUnitPortfolio && record.c2xClientId,
    ) ??
    records.find((record) => record.hasBuyerProfile && record.hasUnitPortfolio) ??
    records[0] ??
    null
  );
}

function extractCustomerIdentityHint(text: string): CustomerIdentityHint {
  const documentDigits = extractFullDocumentDigits(text);

  return {
    documentDigits,
    documentFragment: extractFourDigitFragment(text),
    documentType: documentDigits
      ? documentDigits.length === 14
        ? "cnpj"
        : "cpf"
      : null,
    fullName: extractLikelyName(text),
    unitCode: extractUnitCode(text),
  };
}

function extractFullDocumentDigits(text: string) {
  const candidates = text.match(/\d[\d.\-/\s]{8,}\d/g) ?? [];

  for (const candidate of candidates) {
    const digits = normalizeDigits(candidate);

    if (digits.length === 11 || digits.length === 14) {
      return digits;
    }
  }

  const digits = normalizeDigits(text);

  return digits.length === 11 || digits.length === 14 ? digits : null;
}

function extractUnitCode(text: string) {
  const match = /\bunidade\s+([a-z0-9][a-z0-9._-]{2,})/i.exec(text);

  return match?.[1]?.toUpperCase() ?? null;
}

function extractLikelyName(text: string) {
  const cleaned = text
    .replace(/\bunidade\s+[a-z0-9][a-z0-9._-]{2,}/gi, " ")
    .replace(/\b(cpf|cnpj|documento|proponente|contrato|titular)\b/gi, " ")
    .replace(/\b(final|inicio|come[cç]o|meu|minha|do|da|de|dos|das)\b/gi, " ")
    .replace(/\d[\d.\-/\s]*\d/g, " ")
    .replace(/[^A-Za-zÀ-ÿ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = /([A-Za-zÀ-ÿ]{2,}(?:\s+[A-Za-zÀ-ÿ]{2,}){1,5})/.exec(
    cleaned,
  );
  const value = match?.[1]?.trim() ?? null;

  if (!value) {
    return null;
  }

  const normalized = normalizeForIntent(value);

  if (
    /^(bom dia|boa tarde|boa noite|por favor|quero boleto|preciso boleto)$/.test(
      normalized,
    )
  ) {
    return null;
  }

  return value;
}

function nameMatches(expected: string | null | undefined, provided: string) {
  const expectedText = normalizeNameForMatch(expected);
  const providedText = normalizeNameForMatch(provided);

  if (!expectedText || !providedText) {
    return false;
  }

  if (
    expectedText.includes(providedText) ||
    providedText.includes(expectedText)
  ) {
    return true;
  }

  const expectedTokens = expectedText.split(" ").filter((token) => token.length > 2);
  const providedTokens = new Set(
    providedText.split(" ").filter((token) => token.length > 2),
  );
  const matchedTokens = expectedTokens.filter((token) => providedTokens.has(token));

  return matchedTokens.length >= 2 && matchedTokens.length / expectedTokens.length >= 0.6;
}

function normalizeNameForMatch(value: string | null | undefined) {
  return normalizeForIntent(value ?? "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBrazilPhoneVariants(value: string) {
  const digits = normalizeDigits(value);
  const variants = new Set<string>();

  if (digits.length >= 8) {
    variants.add(digits);
  }

  const national = digits.startsWith("55") ? digits.slice(2) : digits;

  if (national.length >= 8) {
    variants.add(national);
    variants.add(`55${national}`);
  }

  if (national.length === 11 && national[2] === "9") {
    const withoutNinthDigit = `${national.slice(0, 2)}${national.slice(3)}`;
    variants.add(withoutNinthDigit);
    variants.add(`55${withoutNinthDigit}`);
  }

  if (national.length === 10) {
    const withNinthDigit = `${national.slice(0, 2)}9${national.slice(2)}`;
    variants.add(withNinthDigit);
    variants.add(`55${withNinthDigit}`);
  }

  return Array.from(variants).filter((variant) => variant.length >= 8);
}

function hashIdentifier(type: string, value: string) {
  return createHash("sha256")
    .update(`apolo-identifier:${type}:${value.trim().toLowerCase()}`)
    .digest("hex");
}

function groupRowsBy<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
) {
  const grouped = new Map<string, T[]>();

  rows.forEach((row) => {
    const value = row[key];

    if (typeof value !== "string") {
      return;
    }

    grouped.set(value, [...(grouped.get(value) ?? []), row]);
  });

  return grouped;
}

function uniqueStrings(items: Array<string | null | undefined>) {
  return Array.from(new Set(items.filter((item): item is string => Boolean(item))));
}

async function loadBillingItems(c2xClientId: string) {
  try {
    const client = await loadHadesAttendanceClient(c2xClientId);
    const items = (client?.c2xInstallments ?? [])
      .filter((item) => item.status === "Vencida" || item.status === "A vencer")
      .filter((item) => item.paymentUrl || item.invoiceUrl)
      .sort((first, second) => {
        if (first.status !== second.status) {
          return first.status === "Vencida" ? -1 : 1;
        }

        return first.referenceValue - second.referenceValue;
      })
      .slice(0, 12)
      .map((item) => ({
        acquisitionRequestId: item.acquisitionRequestId,
        dueDate: item.dueDate,
        id: item.id,
        number: item.number,
        overdueDays: item.overdueDays,
        reference: item.reference,
        status: item.status,
        unitCode: item.unitCode,
        unitLabel: item.unitLabel,
        value: item.value,
      }));

    return { error: null, items };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Nao foi possivel consultar parcelas no Hades.",
      items: [] as BillingItem[],
    };
  }
}

function buildBillingOptionLabel(item: BillingItem) {
  const status =
    item.status === "Vencida"
      ? `vencida ha ${item.overdueDays} dia(s)`
      : "a vencer";
  const unit =
    item.unitLabel || item.unitCode
      ? ` - ${item.unitLabel || item.unitCode}`
      : "";

  return `${item.number} - ${item.reference}${unit} - ${item.value} - ${status}`;
}

function buildDeliveredBoletoLine(
  item: { label: string; url: string } | undefined,
) {
  if (!item) {
    return "";
  }

  return [item.label, `Link do boleto: ${item.url}`].join("\n");
}

function buildHandoffReply({
  reason,
  replyText,
  state,
  toolsUsed,
  trace,
}: {
  reason: string;
  replyText: string;
  state: CacaAutomationState;
  toolsUsed: string[];
  trace: CacaAgentTraceStep[];
}): CacaAgentTurn {
  traceTool(trace, toolsUsed, {
    metadata: { reason },
    status: "ok",
    summary: "Handoff humano exigido pelo agente.",
    tool: "iris_handoff_to_human",
  });

  return finalizeTurn({
    handoff: {
      reason,
      required: true,
    },
    model: null,
    nextState: buildNextCacaState(state, {
      awaitingBoletoSelection: false,
      awaitingCadastroConfirmation: false,
      awaitingCpfDocument: false,
      awaitingCustomerIdentity: false,
      awaitingDocumentFragment: false,
      boletoOptions: [],
      handoffRequired: true,
      identityAttempts: 0,
    }),
    nextStep: "handoff",
    replyText,
    source: "deterministic",
    toolsUsed,
    trace,
  });
}

function buildNextCacaState(
  state: CacaAutomationState,
  patch: Partial<CacaAutomationState>,
): CacaAutomationState {
  return {
    ...state,
    ...patch,
  };
}

function finalizeTurn({
  handoff,
  model,
  nextState,
  nextStep,
  replyText,
  source,
  toolsUsed,
  trace,
}: Omit<CacaAgentTurn, "agentVersion">): CacaAgentTurn {
  return {
    agentVersion: CACA_AGENT_VERSION,
    handoff,
    model,
    nextState,
    nextStep,
    replyText,
    source,
    toolsUsed: Array.from(new Set(toolsUsed)),
    trace,
  };
}

function resolveSelectedBoletoOptions(
  text: string,
  state: CacaAutomationState,
) {
  const normalized = normalizeForIntent(text);
  const options = state.boletoOptions ?? [];

  if (/\b(todos|todas)\b/.test(normalized)) {
    return options;
  }

  const requestedIndexes = new Set(
    Array.from(normalized.matchAll(/\b\d+\b/g))
      .map((match) => Number(match[0]))
      .filter((value) => Number.isFinite(value)),
  );
  const selectedOptions = [
    ...options.filter((option) => requestedIndexes.has(option.index)),
    ...options.filter((option) =>
      normalized.includes(option.paymentId.toLowerCase()),
    ),
  ];
  const seenPaymentIds = new Set<string>();

  return selectedOptions.filter((option) => {
    if (seenPaymentIds.has(option.paymentId)) {
      return false;
    }

    seenPaymentIds.add(option.paymentId);
    return true;
  });
}

function extractFourDigitFragment(text: string) {
  const match = /\b(\d{4})\b/.exec(text.replace(/\D/g, " "));

  return match?.[1] ?? null;
}

function hasBoletoIntent(value: string) {
  return /\b(boleto|segunda via|2a via|2ª via|parcela|fatura|vencid|a vencer|pagamento|pix|linha digitavel)\b/i.test(
    value,
  );
}

function hasFinancialPendingIntent(value: string) {
  const normalized = normalizeForIntent(value);

  return /\b(pendencia financeira|pendencias financeiras|pendente financeiro|financeiro pendente|debito|debitos|divida|dividas|em aberto|em atraso|inadimplencia|inadimplente|devendo|estou devendo|to devendo|algo em aberto|tenho alguma coisa em aberto|tenho algo em aberto)\b/.test(
    normalized,
  );
}

async function loadCacaRichContext({
  client,
  contact,
  state,
  ticket,
  toolsUsed,
  trace,
}: {
  client?: SupabaseClient;
  contact: CacaAgentContact;
  state: CacaAutomationState;
  ticket: CacaAgentTicket;
  toolsUsed: string[];
  trace: CacaAgentTraceStep[];
}): Promise<CacaRichContext> {
  const c2xClientId = state.apoloC2xClientId ?? extractC2xClientId(contact, ticket);
  const context: CacaRichContext = {
    contracts: [],
    customer: {
      c2xClientId,
      displayName: state.apoloDisplayName ?? contact.display_name ?? null,
      documentMasked: readString(contact.document),
      emailKnown: Boolean(readString(contact.email)),
      entityId: state.apoloEntityId ?? null,
      phoneKnown: Boolean(readString(contact.whatsapp_phone) ?? readString(contact.phone)),
      validationSource: state.apoloValidationSource ?? null,
    },
    financial: null,
    notes: [
      "Contexto carregado por ferramentas server-side autorizadas; nao exponha IDs internos, documentos completos, links privados ou detalhes que nao estejam no resumo.",
    ],
    previousTickets: [],
    recentMessages: [],
  };

  if (!client) {
    traceTool(trace, toolsUsed, {
      metadata: { reason: "supabase_client_absent" },
      status: "skipped",
      summary: "Historico Iris nao carregado porque o client Supabase nao foi fornecido.",
      tool: "iris_load_conversation_memory",
    });
  } else {
    try {
      context.recentMessages = await loadCacaRecentMessages(client, ticket.id);

      traceTool(trace, toolsUsed, {
        metadata: {
          messages: context.recentMessages.length,
          ticketId: ticket.id,
        },
        status: "ok",
        summary: "Historico recente do ticket carregado para a Caca.",
        tool: "iris_load_conversation_memory",
      });

      context.previousTickets = await loadCacaPreviousTickets(client, ticket);

      traceTool(trace, toolsUsed, {
        metadata: {
          contactKnown: Boolean(ticket.contact_id),
          tickets: context.previousTickets.length,
        },
        status: "ok",
        summary: "Memoria curta de tickets anteriores do contato carregada para a Caca.",
        tool: "iris_load_previous_ticket_memory",
      });
    } catch (error) {
      traceTool(trace, toolsUsed, {
        metadata: { error: errorMessage(error) },
        status: "error",
        summary: "Falha sanitizada ao carregar historico recente ou tickets anteriores do Iris.",
        tool: "iris_load_conversation_memory",
      });
    }
  }

  if (!c2xClientId) {
    traceTool(trace, toolsUsed, {
      metadata: { c2xClientKnown: false },
      status: "skipped",
      summary: "Contrato e financeiro nao carregados porque o vinculo C2X ainda nao esta confirmado.",
      tool: "hades_load_customer_contract_context",
    });

    return context;
  }

  try {
    const hadesClient = await loadHadesAttendanceClient(c2xClientId);
    const units = hadesClient?.carteira?.unidades ?? [];
    const installments = hadesClient?.c2xInstallments ?? [];

    context.contracts = units.slice(0, 6).map((unit) => ({
      contractStatus: safeContextValue(unit.statusVenda),
      d4signDocumentAvailable: Boolean(
        unit.signedContractDocumentId || unit.signedContractUrl,
      ),
      d4signStatus: safeContextValue(unit.signedContractStatus),
      enterprise: safeContextValue(unit.empreendimento),
      unit: safeContextValue(unit.unidadeLote || unit.matricula),
    }));
    context.financial = {
      installmentsOpen: installments.filter((item) => item.status === "A vencer").length,
      installmentsOverdue: installments.filter((item) => item.status === "Vencida").length,
      installmentsPaid: installments.filter((item) => item.status === "Liquidada").length,
    };

    const d4signDocuments = context.contracts.filter(
      (contract) => contract.d4signDocumentAvailable,
    ).length;

    traceTool(trace, toolsUsed, {
      metadata: {
        c2xClientKnown: true,
        contracts: context.contracts.length,
        d4signDocuments,
        installments: installments.length,
      },
      status: "ok",
      summary: "Resumo seguro de contratos, unidades e financeiro carregado do Hades/C2X.",
      tool: "hades_load_customer_contract_context",
    });

    traceTool(trace, toolsUsed, {
      metadata: {
        documentsAvailable: d4signDocuments,
        textLoaded: false,
      },
      status: d4signDocuments > 0 ? "ok" : "skipped",
      summary:
        "D4Sign disponivel como metadado seguro; leitura integral exige ferramenta controlada para extracao e sanitizacao.",
      tool: "d4sign_contract_context",
    });
  } catch (error) {
    traceTool(trace, toolsUsed, {
      metadata: { error: errorMessage(error), c2xClientKnown: true },
      status: "error",
      summary: "Falha sanitizada ao carregar resumo de contratos/financeiro.",
      tool: "hades_load_customer_contract_context",
    });
  }

  return context;
}

async function loadCacaRecentMessages(
  client: SupabaseClient,
  ticketId: string,
) {
  const { data, error } = await client
    .from("caredesk_messages")
    .select("body,created_at,direction,sender_type,message_type")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(14)
    .returns<CaredeskMessageContextRow[]>();

  if (error) {
    throw new Error("Nao foi possivel carregar o historico do atendimento.");
  }

  return (data ?? [])
    .reverse()
    .map((row) => {
      const text = readString(row.body);

      return {
        at: row.created_at ?? null,
        role: resolveCacaMessageRole(row),
        text: text ? sanitizePromptText(text, 420) : "[mensagem sem texto]",
        type: readString(row.message_type),
      };
    })
    .filter((message) => message.text !== "[mensagem sem texto]" || Boolean(message.type));
}

async function loadCacaPreviousTickets(
  client: SupabaseClient,
  ticket: CacaAgentTicket,
) {
  if (!ticket.contact_id) {
    return [];
  }

  const { data: tickets, error: ticketsError } = await client
    .from("caredesk_tickets")
    .select("id,protocol,status,updated_at")
    .eq("contact_id", ticket.contact_id)
    .neq("id", ticket.id)
    .order("updated_at", { ascending: false })
    .limit(4)
    .returns<CaredeskTicketContextRow[]>();

  if (ticketsError) {
    throw new Error("Nao foi possivel carregar tickets anteriores.");
  }

  const ticketRows = tickets ?? [];
  const ticketIds = ticketRows.map((row) => row.id);

  if (!ticketIds.length) {
    return [];
  }

  const { data: messages, error: messagesError } = await client
    .from("caredesk_messages")
    .select("ticket_id,body,created_at,direction,sender_type,message_type")
    .in("ticket_id", ticketIds)
    .order("created_at", { ascending: false })
    .limit(24)
    .returns<CaredeskMessageContextRow[]>();

  if (messagesError) {
    throw new Error("Nao foi possivel carregar resumo de tickets anteriores.");
  }

  const lastMessageByTicket = new Map<string, string>();

  for (const message of messages ?? []) {
    const ticketId = readString(message.ticket_id);

    if (!ticketId || lastMessageByTicket.has(ticketId)) {
      continue;
    }

    const text = readString(message.body);

    if (text) {
      lastMessageByTicket.set(ticketId, sanitizePromptText(text, 220));
    }
  }

  return ticketRows.map((row) => ({
    lastMessage: lastMessageByTicket.get(row.id) ?? null,
    protocol: row.protocol,
    status: row.status,
    updatedAt: row.updated_at,
  }));
}

function resolveCacaMessageRole(
  row: Pick<CaredeskMessageContextRow, "direction" | "sender_type">,
): CacaContextMessage["role"] {
  if (row.direction === "inbound" || row.sender_type === "customer") {
    return "cliente";
  }

  if (row.direction === "internal" || row.sender_type === "system") {
    return "sistema";
  }

  return "atendimento";
}

function formatCacaContextForPrompt(context: CacaRichContext) {
  return [
    "Resumo autorizado do cliente:",
    formatCustomerContextForPrompt(context),
    "",
    "Historico recente do ticket:",
    formatRecentMessagesForPrompt(context.recentMessages),
    "",
    "Tickets anteriores do mesmo contato:",
    formatPreviousTicketsForPrompt(context.previousTickets),
    "",
    "Contratos/unidades e D4Sign:",
    formatContractContextForPrompt(context.contracts),
    "",
    "Resumo financeiro seguro:",
    formatFinancialContextForPrompt(context),
    "",
    "Notas de seguranca:",
    context.notes.join(" "),
  ].join("\n");
}

function formatCustomerContextForPrompt(context: CacaRichContext) {
  const customer = context.customer;

  return [
    `Nome conhecido: ${customer.displayName ?? "nao informado"}`,
    `Vinculo C2X confirmado: ${customer.c2xClientId ? "sim" : "nao"}`,
    `Documento mascarado no contato: ${customer.documentMasked ?? "nao informado"}`,
    `Telefone no contato: ${customer.phoneKnown ? "sim" : "nao"}`,
    `E-mail no contato: ${customer.emailKnown ? "sim" : "nao"}`,
    `Validacao anterior: ${customer.validationSource ?? "nao informada"}`,
  ].join("\n");
}

function formatRecentMessagesForPrompt(messages: CacaContextMessage[]) {
  if (!messages.length) {
    return "Nenhuma mensagem anterior carregada para este ticket.";
  }

  return messages
    .map((message) => {
      const at = message.at ? ` em ${message.at}` : "";

      return `- ${message.role}${at}: ${message.text}`;
    })
    .join("\n");
}

function formatPreviousTicketsForPrompt(tickets: CacaPreviousTicketContext[]) {
  if (!tickets.length) {
    return "Nenhum ticket anterior carregado para este contato.";
  }

  return tickets
    .map((ticket, index) =>
      [
        `${index + 1}. Protocolo ${ticket.protocol ?? "nao informado"}`,
        `status ${ticket.status ?? "nao informado"}`,
        ticket.updatedAt ? `atualizado em ${ticket.updatedAt}` : null,
        ticket.lastMessage ? `ultima mensagem: ${ticket.lastMessage}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");
}

function formatContractContextForPrompt(contracts: CacaContractContext[]) {
  if (!contracts.length) {
    return "Nenhum contrato/unidade autorizado carregado neste momento.";
  }

  return contracts
    .map((contract, index) =>
      [
        `${index + 1}. ${contract.enterprise ?? "Empreendimento nao informado"}`,
        `unidade ${contract.unit ?? "nao informada"}`,
        `contrato ${contract.contractStatus ?? "status nao informado"}`,
        `D4Sign ${contract.d4signDocumentAvailable ? "disponivel" : "nao disponivel"}`,
        contract.d4signStatus ? `status assinatura ${contract.d4signStatus}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");
}

function formatFinancialContextForPrompt(context: CacaRichContext) {
  if (!context.financial) {
    return "Resumo financeiro nao carregado neste momento.";
  }

  return [
    `Parcelas vencidas: ${context.financial.installmentsOverdue}`,
    `Parcelas a vencer: ${context.financial.installmentsOpen}`,
    `Parcelas liquidadas: ${context.financial.installmentsPaid}`,
  ].join("\n");
}

async function requestCacaOpenAiReply({
  contact,
  context,
  message,
  state,
  ticket,
  toolsUsed,
  trace,
}: {
  contact: CacaAgentContact;
  context: CacaRichContext;
  message: string;
  state: CacaAutomationState;
  ticket: CacaAgentTicket;
  toolsUsed: string[];
  trace: CacaAgentTraceStep[];
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.HUB_IRIS_ATTENDANT_MODEL?.trim() || DEFAULT_MODEL;

  if (!apiKey) {
    traceTool(trace, toolsUsed, {
      metadata: { model },
      status: "skipped",
      summary: "OPENAI_API_KEY indisponivel; resposta operacional usara fallback.",
      tool: "openai_responses_compose",
    });

    return { model: null, text: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      body: JSON.stringify({
        input: [
          {
            content: [
              {
                text: [
                  `Mensagem do cliente: ${message || "Nao informada."}`,
                  `Protocolo Iris: ${ticket.protocol ?? "Nao informado"}`,
                  `Cliente: ${contact.display_name ?? "Cliente Iris"}`,
                  `Saudacao operacional atual: ${greetingForNow()}`,
                  `Estado do atendimento: ${describeCacaState(state)}`,
                  `Ultimo fallback usado: ${state.lastFallbackKind ?? "nenhum"}`,
                  `Quantidade de fallbacks recentes: ${state.generalFallbackCount ?? 0}`,
                  "Contexto autorizado carregado para este atendimento:",
                  formatCacaContextForPrompt(context),
                  "Contexto: atendimento em WhatsApp dentro da Iris. A conversa pode ser livre, mas acoes sensiveis dependem das ferramentas do backend.",
                  "Ferramentas controladas disponiveis: memoria recente do atendimento, cadastro seguro do cliente, resumo de contratos/unidades, resumo financeiro, autenticacao por cadastro, consulta de boletos, asset oficial de boleto e handoff humano.",
                ].join("\n"),
                type: "input_text",
              },
            ],
            role: "user",
          },
        ],
        instructions: [
          "Voce e a Caca, agente exclusiva de atendimento ao cliente da Careli dentro da Iris.",
          "Atue como uma atendente humana de alto nivel: leia a mensagem inteira, considere o historico recente, reconheca o que a pessoa acabou de dizer, responda com empatia real e conduza o proximo passo sem parecer menu.",
          "Use o contexto autorizado para nao perguntar novamente algo que ja esta claro na conversa, mas nunca revele IDs internos, documento completo, telefone completo, link privado, payload, SQL, nome de tabela ou segredo.",
          "Se o cliente perguntar sobre atendimento anterior, historico, o que foi conversado ou se voce lembra do ultimo atendimento, responda usando a memoria de tickets anteriores. Se a memoria nao tiver detalhe suficiente, diga isso de forma clara e ofereca chamar uma pessoa para abrir o historico completo.",
          "Se o cliente mandar apenas saudacao, use a saudacao operacional atual enviada no contexto e responda de forma natural.",
          "Nao repita apresentacao pronta em toda mensagem. Nunca responda duas vezes seguidas com a mesma pergunta, lista generica de assuntos ou frase padrao.",
          "Se o cliente agradecer, reconheca e encerre de forma cordial. Se disser que nao precisa mais, respeite o encerramento e nao insista.",
          "Se o cliente mudar de assunto enquanto um fluxo estiver pendente, reconheca a mudanca e siga o novo assunto em vez de repetir a etapa anterior.",
          "Se o cliente mandar saudacao, responda saudando. Se perguntar como voce esta, responda de forma simpatica e breve antes de seguir. Se demonstrar irritacao ou disser que voce nao entendeu, peca desculpas, reconheca a falha e ofereca encaminhar para uma pessoa.",
          "Se o cliente disser apenas 'suporte', pergunte qual problema ele precisa resolver, sem listar categorias.",
          "Se o cliente pedir algo fora das ferramentas disponiveis, diga o que voce consegue fazer agora e quando precisa chamar uma pessoa.",
          "Use portugues do Brasil, tom educado, humano, breve e prestativo.",
          "Use cordialidade direta nas respostas, com frases como 'me envie', 'me conta' ou 'posso conferir por aqui'.",
          "Nao atue como Athena e nao fale como suporte interno.",
          "Nao mencione nomes internos como Apolo, Iris ou Hades para o cliente; use termos como nosso sistema, cadastro ou atendimento.",
          "Nao invente dados, protocolo, boleto, contrato, desconto, prazo ou status.",
          "Nunca prometa retorno futuro, consulta em andamento ou 'te retorno' sem uma acao server-side ja executada neste turno. A Caca nao possui job assincrono para voltar sozinha depois; se faltar dado ou ferramenta, peca o dado que falta ou acione humano.",
          "Quando o contexto informar contrato D4Sign apenas como metadado, voce pode dizer que localizou registro de contrato no nosso sistema, mas nao diga que leu o contrato completo nem cite clausulas que nao estejam no contexto.",
          "Se o cliente pedir detalhes especificos de contrato que nao estejam no resumo autorizado, explique que vai acionar uma pessoa para validar o documento antes de responder.",
          "Se houver resumo financeiro carregado, use os totais como contexto geral, mas nao envie valores detalhados nem link sem a ferramenta oficial.",
          "Nao prometa boleto sem autenticacao e sem ferramenta oficial retornar o asset.",
          "Se o cliente perguntar como voce esta, responda de forma simpatica e breve antes de conduzir o atendimento.",
          "Para boleto, o backend valida primeiro se o telefone pertence a comprador com unidade no cadastro interno. Se nao pertencer, a Caca coleta CPF/CNPJ completo do proponente e confirma um dado cadastral antes de consultar boletos.",
          "Para pendencia financeira, debito, parcelas em aberto ou inadimplencia, nao resolva apenas por conversa livre: use o fluxo seguro do backend. Se o resumo financeiro nao estiver carregado e nao houver validacao suficiente, solicite CPF/CNPJ pelo fluxo seguro ou encaminhe humano.",
          "Faca uma pergunta por vez. Quando houver risco, explique que vai acionar um atendente humano.",
        ].join(" "),
        max_output_tokens: 500,
        model,
        reasoning: {
          effort: DEFAULT_REASONING_EFFORT,
        },
        text: {
          verbosity: DEFAULT_TEXT_VERBOSITY,
        },
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      traceTool(trace, toolsUsed, {
        metadata: { httpStatus: response.status, model },
        status: "error",
        summary: "OpenAI Responses nao retornou resposta utilizavel.",
        tool: "openai_responses_compose",
      });

      return { model, text: null };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const text = extractOpenAiText(data) || null;

    traceTool(trace, toolsUsed, {
      metadata: { model, replied: Boolean(text) },
      status: text ? "ok" : "skipped",
      summary: text
        ? "Resposta de atendimento geral composta pela OpenAI."
        : "OpenAI nao retornou texto; fallback operacional sera usado.",
      tool: "openai_responses_compose",
    });

    return { model, text };
  } catch (error) {
    traceTool(trace, toolsUsed, {
      metadata: { error: errorMessage(error), model },
      status: "error",
      summary: "Falha sanitizada ao chamar OpenAI Responses.",
      tool: "openai_responses_compose",
    });

    return { model, text: null };
  } finally {
    clearTimeout(timeout);
  }
}

function buildAutonomousFallbackReply({
  contact,
  context,
  state,
  text,
}: {
  contact: CacaAgentContact;
  context: CacaRichContext;
  state: CacaAutomationState;
  text: string;
}) {
  const normalized = normalizeForIntent(text);
  const name = firstName(contact.display_name);
  const repeatedFallback =
    (state.generalFallbackCount ?? 0) > 0 ||
    state.lastFallbackKind === "general" ||
    state.lastFallbackKind === "ambiguous";

  if (isGreeting(normalized)) {
    const periodGreeting = greetingForNow();

    return {
      kind: "greeting",
      text: `${periodGreeting}${name ? `, ${name}` : ""}. Estou por aqui para te ajudar. O que voce precisa resolver agora?`,
    };
  }

  if (isThanks(normalized)) {
    return {
      kind: "thanks",
      text: "Por nada. Se aparecer outra duvida, me chama por aqui que eu tento resolver com voce.",
    };
  }

  if (isSocialCheckIn(normalized)) {
    return {
      kind: "social_check_in",
      text: `Estou bem${name ? `, ${name}` : ""}, obrigada por perguntar. Estou aqui com o contexto do seu atendimento para tentar resolver sem te fazer repetir tudo.`,
    };
  }

  if (isPreviousAttendanceIntent(normalized)) {
    return {
      kind: "previous_ticket_memory",
      text: buildPreviousTicketMemoryReply({ context, name }),
    };
  }

  if (isSupportIntent(normalized)) {
    return {
      kind: "support",
      text: `${name ? `${name}, ` : ""}me conta o que aconteceu e em qual etapa voce travou. Eu vou usar o historico daqui para nao te fazer repetir o que ja apareceu no atendimento.`,
    };
  }

  if (isFinancialHistoryIntent(normalized)) {
    return {
      kind: "financial_history",
      text: buildFinancialHistoryFallbackReply({ context, name }),
    };
  }

  if (isContractIntent(normalized)) {
    return {
      kind: "contract",
      text: buildContractFallbackReply({ context, name }),
    };
  }

  if (isShortAmbiguous(normalized)) {
    return {
      kind: "ambiguous",
      text: repeatedFallback
        ? `${name ? `${name}, ` : ""}acho que ainda nao captei o que voce precisa. Me escreve em uma frase o que aconteceu que eu sigo por esse caminho.`
        : `${name ? `${name}, ` : ""}me conta rapidinho o que voce precisa resolver agora.`,
    };
  }

  return {
    kind: "general",
    text: repeatedFallback
      ? `${name ? `${name}, ` : ""}vou tentar de outro jeito: me diga o que aconteceu e qual resultado voce espera. Se eu nao conseguir resolver por aqui, eu chamo uma pessoa para continuar.`
      : `${name ? `${name}, ` : ""}entendi. Me conta um pouco mais do que voce precisa resolver para eu seguir pelo caminho certo.`,
  };
}

function buildPreviousTicketMemoryReply({
  context,
  name,
}: {
  context: CacaRichContext;
  name: string;
}) {
  const latestTicket =
    context.previousTickets.find((ticket) => ticket.lastMessage) ??
    context.previousTickets[0];

  if (!latestTicket) {
    return `${name ? `${name}, ` : ""}eu procurei no contexto deste atendimento, mas nao encontrei detalhe suficiente de um atendimento anterior para te responder com seguranca. Posso chamar uma pessoa para abrir o historico completo e continuar daqui.`;
  }

  const protocol = latestTicket.protocol
    ? `protocolo ${latestTicket.protocol}`
    : "um atendimento anterior";
  const status = latestTicket.status ? `, status ${latestTicket.status}` : "";
  const lastMessage = latestTicket.lastMessage
    ? ` A ultima mensagem registrada foi: "${latestTicket.lastMessage}".`
    : " Nao veio um resumo de mensagens suficiente neste contexto.";

  return `${name ? `${name}, ` : ""}encontrei ${protocol}${status}.${lastMessage} Se quiser, eu sigo por esse ponto ou chamo uma pessoa para abrir o historico completo.`;
}

function buildFinancialHistoryFallbackReply({
  context,
  name,
}: {
  context: CacaRichContext;
  name: string;
}) {
  if (!context.financial) {
    return `${name ? `${name}, ` : ""}consigo ajudar com segunda via de boleto por aqui. Para historico de valores pagos, saldo ou extrato detalhado, vou chamar uma pessoa para consultar com seguranca.`;
  }

  return `${name ? `${name}, ` : ""}eu tenho um resumo seguro aqui: ${context.financial.installmentsPaid} parcela(s) liquidadas, ${context.financial.installmentsOverdue} vencida(s) e ${context.financial.installmentsOpen} a vencer. Para valores detalhados ou extrato do contrato, eu chamo uma pessoa para validar no sistema antes de te responder.`;
}

function buildContractFallbackReply({
  context,
  name,
}: {
  context: CacaRichContext;
  name: string;
}) {
  const contract = context.contracts.find(
    (item) => item.unit || item.enterprise || item.d4signDocumentAvailable,
  );

  if (!contract) {
    return `${name ? `${name}, ` : ""}posso te ajudar com contrato, sim. Neste atendimento eu ainda nao tenho um resumo seguro do documento carregado; me diga se voce precisa da segunda via, assinatura ou alguma duvida especifica, que eu direciono com seguranca.`;
  }

  const unit = contract.unit ? `, unidade ${contract.unit}` : "";
  const enterprise = contract.enterprise
    ? ` de ${contract.enterprise}`
    : "";
  const availability = contract.d4signDocumentAvailable
    ? "Tambem encontrei registro de documento assinado no nosso sistema."
    : "Ainda nao apareceu documento assinado disponivel neste contexto.";

  return `${name ? `${name}, ` : ""}encontrei registro de contrato${enterprise}${unit}. ${availability} Me diga se voce precisa da segunda via, confirmar assinatura ou tirar duvida sobre algum ponto; se for detalhe de clausula, eu chamo uma pessoa para validar o documento antes de responder.`;
}

function buildConversationInterruptionReply({
  contact,
  state,
  text,
}: {
  contact: CacaAgentContact;
  state: CacaAutomationState;
  text: string;
}) {
  const normalized = normalizeForIntent(text);
  const name = firstName(contact.display_name);

  if (isHumanRequest(normalized)) {
    return {
      handoffRequired: true,
      kind: "human_request",
      reason: "Cliente pediu atendimento humano.",
      text: `${name ? `${name}, ` : ""}claro. Vou chamar uma pessoa para continuar seu atendimento por aqui.`,
    };
  }

  if (state.awaitingBoletoSelection && isThanks(normalized)) {
    return {
      handoffRequired: false,
      kind: "thanks_after_boleto",
      reason: null,
      text: `${name ? `${name}, ` : ""}por nada. Fico feliz em ajudar. Se precisar de mais alguma coisa depois, me chama por aqui.`,
    };
  }

  if (state.awaitingBoletoSelection && isNoLongerNeeded(normalized)) {
    return {
      handoffRequired: false,
      kind: "customer_closed_boleto_flow",
      reason: null,
      text: `${name ? `${name}, ` : ""}tudo certo. Vou deixar essa solicitacao encerrada por aqui. Se precisar de algo depois, eu retomo com voce.`,
    };
  }

  if (isNoLongerNeeded(normalized)) {
    return {
      handoffRequired: false,
      kind: "customer_closed_general_flow",
      reason: null,
      text: `${name ? `${name}, ` : ""}tudo certo. Obrigada por avisar. Se precisar de algo depois, eu retomo com voce por aqui.`,
    };
  }

  if (isFrustration(normalized)) {
    return {
      handoffRequired: true,
      kind: "frustration",
      reason:
        "Cliente demonstrou frustracao ou informou que a Caca nao entendeu.",
      text: `${name ? `${name}, ` : ""}voce tem razao, eu nao entendi do jeito que precisava. Desculpa por isso. Vou chamar uma pessoa para continuar e deixar registrado que voce precisa de ajuda sem repetir tudo de novo.`,
    };
  }

  if (isPauseOrLeave(normalized)) {
    return {
      handoffRequired: true,
      kind: "pause_or_leave",
      reason:
        "Cliente indicou que vai pausar ou sair da conversa sem resolver o atendimento.",
      text: `${name ? `${name}, ` : ""}entendo. Desculpa por nao ter resolvido antes. Vou deixar o atendimento encaminhado para uma pessoa continuar depois, sem voce precisar recomecar do zero.`,
    };
  }

  if (
    state.lastFallbackKind === "support" &&
    isShortAmbiguous(normalized)
  ) {
    return {
      handoffRequired: false,
      kind: "support_follow_up",
      reason: null,
      text: `${name ? `${name}, ` : ""}me diz o que aconteceu no suporte: qual tela, erro ou dificuldade voce esta vendo?`,
    };
  }

  return null;
}

function describeCacaState(state: CacaAutomationState) {
  const markers: string[] = [];

  if (state.awaitingBoletoSelection) {
    markers.push("aguardando escolha de boleto");
  }

  if (
    state.awaitingCustomerIdentity ||
    state.awaitingCpfDocument ||
    state.awaitingCadastroConfirmation
  ) {
    markers.push("aguardando validacao Apolo do proponente");
  }

  if (state.handoffRequired) {
    markers.push("handoff humano solicitado");
  }

  return markers.length ? markers.join("; ") : "sem fluxo pendente";
}

function extractOpenAiText(data: Record<string, unknown>) {
  const directText = readString(data.output_text);

  if (directText) {
    return directText;
  }

  const output = Array.isArray(data.output) ? data.output : [];

  for (const item of output) {
    const content = isRecord(item) && Array.isArray(item.content)
      ? item.content
      : [];

    for (const part of content) {
      const text = isRecord(part) ? readString(part.text) : null;

      if (text) {
        return text;
      }
    }
  }

  return "";
}

function extractC2xClientId(
  contact: CacaAgentContact | null,
  ticket: CacaAgentTicket,
) {
  return (
    findLegacyId(contact?.c2x_payload, true) ||
    findLegacyId(contact?.metadata, false) ||
    findLegacyId(ticket.metadata, false) ||
    findLegacyId(ticket.source_context, false)
  );
}

function findLegacyId(
  source: Record<string, unknown> | null | undefined,
  allowGenericId: boolean,
): string | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  const keys = [
    "c2xClientId",
    "c2x_client_id",
    "clientC2xId",
    "client_c2x_id",
    "legacyClientId",
    "legacy_client_id",
    "legacyUserId",
    "legacy_user_id",
    "c2xUserId",
    "c2x_user_id",
    "clientId",
    "client_id",
    "userId",
    "user_id",
    ...(allowGenericId ? ["id"] : []),
  ];

  for (const key of keys) {
    const value = legacyIdValue(source[key]);

    if (value) {
      return value;
    }
  }

  for (const value of Object.values(source)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const nested = findLegacyId(value as Record<string, unknown>, false);

    if (nested) {
      return nested;
    }
  }

  return null;
}

function legacyIdValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return /^\d+$/.test(normalized) ? normalized : null;
}

function traceTool(
  trace: CacaAgentTraceStep[],
  toolsUsed: string[],
  step: Omit<CacaAgentTraceStep, "at">,
) {
  if (!toolsUsed.includes(step.tool)) {
    toolsUsed.push(step.tool);
  }

  trace.push({
    ...step,
    at: new Date().toISOString(),
    metadata: step.metadata ? sanitizeTraceMetadata(step.metadata) : undefined,
  });
}

function sanitizeTraceMetadata(metadata: AgentTraceMetadata) {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      typeof value === "string" ? truncateText(value, 120) : value,
    ]),
  );
}

function normalizeDigits(value: string | null | undefined) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeForIntent(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function firstName(value: string | null | undefined) {
  const name = readString(value);

  if (!name) {
    return "";
  }

  return name.split(/\s+/)[0] ?? "";
}

function isGreeting(value: string) {
  return /^(oi|oie|ola|bom dia|boa tarde|boa noite|opa|e ai|hey|hello)\b/.test(
    value,
  );
}

function isThanks(value: string) {
  return /\b(obrigad[ao]?|obg|valeu|vlw|agradecid[ao]?|brigad[ao]?)\b/.test(
    value,
  );
}

function isNoLongerNeeded(value: string) {
  return /\b(nao precisa|nao preciso|nao precisa mais|nao quero|sem necessidade|ja resolveu|ja resolvi|ja recebi|pode encerrar|encerra|resolvido)\b/.test(
    value,
  );
}

function looksLikeBoletoSelectionAttempt(value: string) {
  return /\b(\d+|todos|todas|primeir|segund|terceir|quart|quint|sext|setim|oitav)\b/.test(
    value,
  );
}

function isPreviousAttendanceIntent(value: string) {
  return /\b(ultimo atendimento|atendimento anterior|historico do atendimento|historico de atendimento|historico|conversamos|conversa anterior|ticket anterior|tickets anteriores|protocolo anterior|lembra do atendimento|sabe o que conversamos)\b/.test(
    value,
  );
}

function isSocialCheckIn(value: string) {
  return /\b(como (vc|voce|voces|esta|ta|vai)|tudo bem|tudo certo|como esta|como ta|e voce)\b/.test(
    value,
  );
}

function isSupportIntent(value: string) {
  return /\b(suporte|ajuda|problema|erro|falha|bug|travou|travando|nao funciona|nao abre|dificuldade)\b/.test(
    value,
  );
}

function isFinancialHistoryIntent(value: string) {
  return /\b(quanto ja paguei|quanto paguei|ja paguei|valor pago|pagamentos feitos|historico de pagamento|extrato|saldo|quitei|quitado)\b/.test(
    value,
  );
}

function isContractIntent(value: string) {
  return /\b(contrato|documento|assinatura|d4sign|unidade|lote)\b/.test(
    value,
  );
}

function isHumanRequest(value: string) {
  return /\b(humano|pessoa|atendente|operador|falar com alguem|falar com uma pessoa|me liga|ligacao)\b/.test(
    value,
  );
}

function isFrustration(value: string) {
  return /\b(nao entendeu|nao esta entendendo|voce nao entendeu|vc nao entendeu|parece bot|resposta automatica|automatico|automaticas|nada a ver|errado|nao foi isso|ja falei|to irritad|estou irritad|cansei)\b/.test(
    value,
  );
}

function isPauseOrLeave(value: string) {
  return /\b(vou dormir|vou sair|deixa pra la|deixa para la|desisto|amanha vejo|depois vejo)\b/.test(
    value,
  );
}

function isShortAmbiguous(value: string) {
  return (
    value.length <= 18 &&
    /^(ok|sim|nao|por favor|pf|favor|pode|preciso|quero|boa|bom|certo|ta|ta bom|entendi|oie|oi|ola)$/.test(
      value,
    )
  );
}

function greetingForNow(now = new Date()) {
  const hour = hourInCacaBusinessTimezone(now);

  if (hour < 12) {
    return "Bom dia";
  }

  if (hour < 18) {
    return "Boa tarde";
  }

  return "Boa noite";
}

function hourInCacaBusinessTimezone(now: Date) {
  const formattedHour = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    hour12: false,
    timeZone: CACA_BUSINESS_TIME_ZONE,
  }).format(now);
  const hour = Number(formattedHour);

  return Number.isFinite(hour) ? hour : now.getHours();
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function safeContextValue(value: string | null | undefined) {
  const text = readString(value);

  if (!text) {
    return null;
  }

  const normalized = normalizeForIntent(text);

  if (
    normalized === "-" ||
    normalized === "n/a" ||
    normalized === "nao informado" ||
    normalized === "sem informacao"
  ) {
    return null;
  }

  return sanitizePromptText(text, 160);
}

function sanitizePromptText(value: string, maxLength: number) {
  const withoutLinks = value.replace(/https?:\/\/\S+/gi, "[link]");
  const withoutDocuments = withoutLinks.replace(
    /\b\d[\d.\-/\s]{8,}\d\b/g,
    (match) => {
      const digits = normalizeDigits(match);

      if (digits.length >= 9) {
        return digits.length === 14
          ? "[cnpj informado]"
          : "[documento informado]";
      }

      return match;
    },
  );

  return truncateText(withoutDocuments.replace(/\s+/g, " ").trim(), maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
