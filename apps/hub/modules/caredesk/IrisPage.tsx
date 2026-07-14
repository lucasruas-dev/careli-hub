/* eslint-disable */
// @ts-nocheck
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  CheckCheck,
  ChevronRight,
  Clock3,
  ClipboardList,
  CircleStop,
  DatabaseZap,
  Download,
  Edit3,
  FileText,
  Forward,
  HandCoins,
  ImageIcon,
  Inbox,
  LayoutDashboard,
  Mail,
  Megaphone,
  MessageCircle,
  MessageSquareReply,
  Mic,
  Network,
  Play,
  Plus,
  RefreshCw,
  Reply,
  Route,
  Save,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Smartphone,
  TicketCheck,
  Trash2,
  Upload,
  Video,
  Workflow,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";

import {
  IrisModuleShell,
  type IrisShellNavigationItem,
} from "./blocks/shell/iris-shell";
import { IrisBoardKanban } from "./blocks/board/iris-board-kanban";
import { type IrisBoardMetrics } from "./blocks/board/iris-board-view";
import {
  EmailChannelChip,
  emailBoxLabel,
  type IrisTicketQueueHelpers,
  type IrisTicketQueueRenderers,
  queueChipClasses,
} from "./blocks/board/iris-ticket-queue";
import {
  IrisHistoryView,
  type IrisHistoryFocus,
  type IrisHistoryViewHelpers,
} from "./blocks/history/iris-history-view";
import { IrisReportsView } from "./blocks/reports/iris-reports-view";
import {
  IrisStartAttendanceModal,
  type IrisStartAttendanceModalHelpers,
} from "./blocks/start-attendance/iris-start-attendance-modal";
import { IrisSetupView } from "./blocks/setup/iris-setup-view";
import {
  IrisAttendantPanel,
  type IrisAttendantDocumentPosition,
  type IrisAttendantResponse,
} from "./blocks/caca/iris-attendant-panel";
import { IrisMetaBroadcastsView } from "./blocks/meta-whatsapp/iris-meta-broadcasts-view";
import {
  IrisConversationComposerActions,
  type IrisConversationComposerWindow,
} from "./blocks/conversation/iris-composer-actions";
import {
  IrisConversationContextSidebar,
  IrisConversationEmptyState,
  IrisConversationInboxSidebar,
  IrisConversationMessagesTimeline,
  type IrisInboxChannelFilter,
  type IrisConversationReadOnlyHelpers,
  type IrisConversationReadOnlyRenderers,
  type IrisConversationWaitState,
} from "./blocks/conversation/iris-conversation-readonly";
import {
  IrisCobrancaContextSidebar,
  type CobrancaProposalRenderArgs,
} from "./blocks/conversation/iris-cobranca-context";
import {
  IrisAthenaPanel,
  type AthenaAction,
  type AthenaMessage,
} from "./blocks/caca/iris-athena-panel";
import {
  IrisCobrancaCloseModal,
  IrisCobrancaTransferModal,
} from "./blocks/conversation/iris-cobranca-actions";
import {
  IRIS_QUEUE_LOAD_TIMEOUT_MS,
  buildIrisSnapshot,
  emptyIrisData,
  enrichTicketsWithCrm360,
  ensureOperatorIdentity,
  loadIrisData,
  loadTicketMessages,
  mapMessageRow,
  mapQueueRow,
  mapTicketProfileRow,
  withIrisTimeout,
} from "./data/iris-data-client";
import { useOutsideDismiss } from "@/hooks/use-outside-dismiss";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { PanteonLoadingState } from "@/components/panteon/panteon-loading";
import {
  playIrisInboundSound,
  registerIrisNotificationPermissionIntent,
  showBrowserIrisNotification,
} from "@/lib/iris/notification-effects";
import {
  audioExtensionForMime,
  audioNeedsTranscode,
  transcodeAudioToMp3,
} from "@/lib/iris/audio-transcode";
import { getHubPresenceSnapshot } from "@/lib/hub-presence";
import { canReplyAsCaca } from "@/lib/iris/caca-reply-access";
import { PhoneFlag } from "./components/phone-flag";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";
import { usePanteonNotifications } from "@/providers/pulsex-notification-provider";
import type {
  IrisAgendaTimelineEntry,
  IrisApoloClientOption,
  IrisApoloContextEntity,
  IrisContextModalMode,
  IrisCrm360Registration,
  IrisData,
  IrisInboundNotice,
  IrisMessage,
  IrisMessageReaction,
  IrisMetaPhoneNumberLink,
  IrisMetaPhoneNumberOption,
  IrisMetaTemplatesResponse,
  IrisOrigin,
  IrisPriority,
  IrisQueueConfig,
  IrisReplyPreview,
  IrisStatus,
  IrisTemplate,
  IrisTemplateFeedback,
  IrisTicket,
  IrisTicketContextAgendaEvent,
  IrisTicketContextNote,
  IrisTicketProfileConfig,
  IrisTone,
} from "./types/iris-types";

type IrisPageProps = {
  boardOnly?: boolean;
  // Cockpit de cobranca do Hades: contexto proprio (parcelas/link de boleto),
  // rotulos e o "+" do board apontam pro fluxo do Hades. Iris segue o motor.
  cobrancaMode?: boolean;
  embedded?: boolean;
  // Reabre a conversa de um protocolo (AT-xxxx) ao montar — usado pelo "Voltar
  // ao atendimento" do Hades, que volta pra conversa e nao pro board.
  initialAttendanceProtocol?: string | null;
  initialTickets?: IrisTicket[];
  loadFromSupabase?: boolean;
  // Quando definido, o "+" / Novo atendimento do board embarcado chama este
  // override (ex.: Hades abre o seletor de cliente + form proprio) em vez do
  // IrisStartAttendanceModal padrao.
  onStartAttendanceOverride?: (() => void) | null;
  // Render-prop do guardian: renderiza o ProposalModal (acordo/promessa) INLINE
  // no cockpit de cobranca, sem import circular caredesk->guardian.
  renderCobrancaProposal?: (args: CobrancaProposalRenderArgs) => ReactNode;
  operatorScoped?: boolean;
  queueSlugFilter?: string | null;
};

type IrisView =
  | "gestao"
  | "historico"
  | "atendimento"
  | "disparos"
  | "setup"
  | "relatorios";

function readIrisTemplateSyncNotificationId(
  sync?: IrisMetaTemplatesResponse["localTemplateSync"],
) {
  if (!sync?.ok || (!sync.matched && !sync.imported)) {
    return null;
  }

  return [
    sync.id ?? "template",
    sync.imported ? "imported" : "matched",
    sync.metaStatus ?? "unknown",
    sync.localStatus ?? "unknown",
  ].join(":");
}

// Extrai o id de cliente C2X do ticket de cobranca (metadata.cobranca.clientId =
// "c2x-client-NNN") para vincular retornos/tarefas criados do atendimento.
function readTicketCobrancaC2xId(
  metadata: Record<string, unknown> | null | undefined,
): number | null {
  const cobranca =
    metadata && typeof metadata.cobranca === "object" && metadata.cobranca
      ? (metadata.cobranca as Record<string, unknown>)
      : null;
  const clientId =
    typeof cobranca?.clientId === "string" ? cobranca.clientId : null;
  const match = clientId?.match(/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

function buildIrisHistoryFocus(ticket: IrisTicket): IrisHistoryFocus {
  return {
    contactId: ticket.contactId ?? null,
    contactLabel: ticket.contactLabel ?? null,
    contactPhone: ticket.contactPhone ?? null,
    requestedAt: Date.now(),
  };
}

function ticketMatchesHistoryFocus(
  ticket: IrisTicket,
  focus: IrisHistoryFocus | null,
) {
  if (!focus) {
    return true;
  }

  if (focus.contactId && ticket.contactId) {
    return focus.contactId === ticket.contactId;
  }

  if (focus.contactPhone && ticket.contactPhone) {
    return focus.contactPhone === ticket.contactPhone;
  }

  if (focus.contactLabel) {
    return focus.contactLabel === ticket.contactLabel;
  }

  return false;
}

const emptyIrisTickets: IrisTicket[] = [];
// Rede de seguranca APENAS: quem traz novidade na hora e o realtime
// (postgres_changes logo abaixo). Full-refresh a cada 12s por aba foi o mesmo
// padrao que gerou a fatura do Hermes em maio/2026 — nao baixar sem medir.
const IRIS_REFRESH_INTERVAL_MS =
  process.env.NODE_ENV === "development" ? 120_000 : 90_000;
// Janela de coalescencia dos eventos realtime: uma rajada (ex.: burst do
// webhook Meta) vira UM refresh — cada refresh recarrega a fila INTEIRA.
const IRIS_REALTIME_REFRESH_DEBOUNCE_MS = 2_500;

const navigationItems: Array<IrisShellNavigationItem<IrisView>> = [
  { id: "gestao", label: "Board", icon: LayoutDashboard },
  { id: "historico", label: "Historico", icon: Clock3 },
  { id: "disparos", label: "Disparos", icon: Megaphone },
  { id: "setup", label: "Setup", icon: Settings2 },
  { id: "relatorios", label: "Relatorios", icon: BarChart3 },
];

const statusLabel: Record<IrisStatus, string> = {
  cancelled: "Encerrado",
  closed: "Encerrado",
  new: "Novo",
  open: "Pendente",
  pending: "Pendente",
  resolved: "Encerrado",
  waiting_customer: "Espera",
  waiting_operator: "Pendente",
};

const priorityLabel: Record<IrisPriority, string> = {
  critical: "Critica",
  high: "Alta",
  low: "Baixa",
  medium: "Media",
};
const priorityOptions: IrisPriority[] = ["low", "medium", "high", "critical"];
const setupStatusOptions = ["planned", "active", "paused", "archived"];
const setupStatusLabel: Record<string, string> = {
  active: "Ativo",
  archived: "Arquivado",
  paused: "Pausado",
  planned: "Planejado",
};
const IRIS_EMOJI_OPTIONS = [
  // Rostos
  "😀", "😃", "😄", "😁", "😊", "🙂", "😉", "😍",
  "🥰", "😘", "😎", "🤩", "🤗", "😅", "😂", "🤣",
  "🙃", "😌", "🤔", "😴", "😢", "😭", "😳", "😡",
  // Gestos e mãos
  "👍", "👎", "👏", "🙌", "🙏", "👌", "🤝", "💪",
  "👋", "✌️", "🤙", "🫶",
  // Corações e brilhos
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🔥", "✨",
  "⭐", "🎉", "💯",
  // Símbolos úteis do atendimento
  "✅", "❌", "⚠️", "❗", "❓", "📌", "💬", "📎",
  "📅", "💰", "🏠", "📞",
];
const IRIS_REACTION_OPTIONS = ["👍", "❤️", "😂", "🙏", "✅"];
const IRIS_AUDIO_MAX_DATA_URL_LENGTH = 4_000_000;
// Anexos de saída (foto/print/documento). Imagem é reduzida no cliente antes de subir.
const IRIS_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
const IRIS_ATTACHMENT_DOC_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);
const IRIS_ATTACHMENT_INPUT_ACCEPT =
  "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";
const IRIS_OPT_IN_TEMPLATE = {
  bodyText: "Olá {{1}}, estou testando a Iris, podemos conversar?",
  buttons: ["Sim", "Não"],
  category: "MARKETING",
  exampleName: "Lucas",
  language: "pt_BR",
  name: "iris_opt_in_teste_v1",
  title: "Opt-in Iris teste",
  variables: [
    {
      example: "Lucas",
      key: "primeiro_nome",
      label: "Primeiro nome",
      placeholder: "{{1}}",
    },
  ],
};

const IRIS_META_TEMPLATE_VARIABLES = [
  {
    example: "Lucas",
    key: "primeiro_nome",
    label: "Primeiro nome",
    placeholder: "{{1}}",
    readiness: "Pronta",
  },
  {
    example: "Lucas",
    key: "operador",
    label: "Operador",
    placeholder: "{{2}}",
    readiness: "Iris",
  },
  {
    example: "Lucas Moreira Ruas",
    key: "nome_cliente",
    label: "Nome completo",
    placeholder: "{{3}}",
    readiness: "Pronta",
  },
  {
    example: "AT-000001",
    key: "protocolo",
    label: "Protocolo Iris",
    placeholder: "{{4}}",
    readiness: "Pronta",
  },
  {
    example: "Segunda via de boleto",
    key: "assunto",
    label: "Assunto",
    placeholder: "{{5}}",
    readiness: "Iris",
  },
  {
    example: "Q01L02 · 12 · mai/26",
    key: "parcelas",
    label: "Parcelas",
    placeholder: "{{6}}",
    readiness: "Iris",
  },
  {
    example: "Lagoa Bonita",
    key: "empreendimento",
    label: "Empreendimento",
    placeholder: "{{7}}",
    readiness: "Cobrança",
  },
  {
    example: "Quadra 01 lote 02",
    key: "unidade",
    label: "Unidade",
    placeholder: "{{8}}",
    readiness: "Cobrança",
  },
  {
    example: "25/05/2026",
    key: "vencimento",
    label: "Vencimento",
    placeholder: "{{9}}",
    readiness: "Cobrança",
  },
  {
    example: "R$ 1.200,00",
    key: "valor",
    label: "Valor total",
    placeholder: "{{10}}",
    readiness: "Cobrança",
  },
  {
    example: "R$ 3.600,00",
    key: "saldo_aberto",
    label: "Saldo em aberto",
    placeholder: "{{11}}",
    readiness: "Cobrança",
  },
  {
    example: "37 dias",
    key: "dias_atraso",
    label: "Dias de atraso",
    placeholder: "{{12}}",
    readiness: "Cobrança",
  },
  {
    example: "https://cobranca.c2x.app.br/b/abc123",
    key: "link_boleto",
    label: "Link do boleto",
    placeholder: "{{13}}",
    readiness: "Cobrança",
  },
];

const IRIS_TEMPLATE_AUTO_REFRESH_MS = 45_000;
const IRIS_TEMPLATE_STATUS_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "APPROVED", label: "Aprovados" },
  { id: "PENDING", label: "Pendentes" },
  { id: "REJECTED", label: "Rejeitados" },
  { id: "NONE", label: "Nao criados" },
];
const IRIS_TEMPLATE_HEADER_OPTIONS = [
  {
    accept: "",
    description: "Template somente texto e botoes.",
    id: "NONE",
    label: "Sem midia",
  },
  {
    accept: "image/jpeg,image/jpg,image/png",
    description: "JPG ou PNG ate 5 MB.",
    id: "IMAGE",
    label: "Imagem",
  },
  {
    accept: "video/mp4,video/3gpp",
    description: "MP4 ou 3GPP ate 16 MB.",
    id: "VIDEO",
    label: "Video",
  },
  {
    accept: "application/pdf",
    description: "PDF ate 100 MB.",
    id: "DOCUMENT",
    label: "Documento",
  },
];
const IRIS_META_TEMPLATE_LIBRARY_PRESETS = [
  {
    bodyText:
      "Ola {{1}}, seu atendimento Careli foi iniciado com sucesso. Nosso time segue disponivel para te apoiar.",
    buttonsText: "Entendi, Falar com operador",
    category: "UTILITY",
    description:
      "Modelo base para abertura de atendimento e continuidade da conversa.",
    id: "atendimento_iniciado",
    title: "Atendimento iniciado",
    variableKeys: ["primeiro_nome"],
  },
  {
    bodyText:
      "Ola {{1}}, confirmamos o protocolo {{2}} no Iris. Se precisar, responda esta mensagem para seguirmos.",
    buttonsText: "Tudo certo, Preciso de ajuda",
    category: "UTILITY",
    description:
      "Confirma o protocolo operacional para manter rastreabilidade do atendimento.",
    id: "confirmacao_protocolo",
    title: "Confirmacao de protocolo",
    variableKeys: ["primeiro_nome", "protocolo"],
  },
  {
    bodyText:
      "Ola {{1}}, seu atendimento sera conduzido por {{2}}. Se desejar, responda por aqui para continuarmos.",
    buttonsText: "Pode continuar, Trocar de assunto",
    category: "UTILITY",
    description: "Comunica quem assumiu o atendimento antes da conversa livre.",
    id: "handoff_operador",
    title: "Handoff para operador",
    variableKeys: ["primeiro_nome", "operador"],
  },
  {
    bodyText:
      "Ola {{1}}, identificamos uma atualizacao no seu cadastro relacionado a {{2}}.",
    buttonsText: "Ver detalhes, Atualizar agora",
    category: "MARKETING",
    description:
      "Modelo de reengajamento para orientar proxima acao do cliente.",
    id: "reengajamento_cadastro",
    title: "Reengajamento de cadastro",
    variableKeys: ["primeiro_nome", "empreendimento"],
  },
  {
    bodyText:
      "Ola {{1}}, o valor {{2}} esta previsto para {{3}}. Se precisar, posso te enviar o link oficial.",
    buttonsText: "Enviar link, Falar com time",
    category: "UTILITY",
    description:
      "Comunicacao de vencimento com linguagem operacional e opcao de suporte.",
    id: "lembrete_vencimento",
    title: "Lembrete de vencimento",
    variableKeys: ["primeiro_nome", "valor", "vencimento"],
  },
  {
    bodyText:
      "Codigo de confirmacao Careli: {{1}}. Use este codigo para validar seu acesso de forma segura.",
    buttonsText: "",
    category: "AUTHENTICATION",
    description:
      "Base para mensagens de autenticacao quando o fluxo exigir validacao.",
    id: "codigo_autenticacao",
    title: "Codigo de autenticacao",
    variableKeys: ["protocolo"],
  },
];

export function IrisPage({
  boardOnly = false,
  cobrancaMode = false,
  embedded = false,
  initialAttendanceProtocol = null,
  initialTickets = emptyIrisTickets,
  loadFromSupabase = true,
  onStartAttendanceOverride = null,
  operatorScoped = false,
  queueSlugFilter = null,
  renderCobrancaProposal = null,
}: IrisPageProps) {
  const { hubUser } = useAuth();
  const { publishNotification } = usePanteonNotifications();
  // Fila da Caca: so lider/coordenador (leader) e admin enxergam. Operadores e
  // viewers nao veem os tickets conduzidos pela Caca.
  const canSeeCacaQueue =
    hubUser?.role === "admin" || hubUser?.role === "leader";
  const operatorUserId = operatorScoped ? (hubUser?.id ?? null) : null;
  const scopedQueueSlug = normalizeOptionalIrisQueueSlug(queueSlugFilter);
  const [irisData, setIrisData] = useState<IrisData>({
    ...emptyIrisData,
    tickets: initialTickets,
  });
  // Escopo de persistência da UI: separa a Iris standalone do cockpit embarcado
  // do Hades (cobrança), pra o "continuar de onde estava" de cada um não colidir.
  const persistScope = cobrancaMode
    ? "hades-cockpit"
    : embedded
      ? "iris-embed"
      : "iris";
  const [selectedTicketId, setSelectedTicketId] = usePersistedState<string>(
    `${persistScope}.selectedTicketId`,
    initialTickets[0]?.id ?? "",
  );
  const [activeView, setActiveView] = usePersistedState<IrisView>(
    `${persistScope}.activeView`,
    "gestao",
  );
  const attendanceProtocolHandledRef = useRef<string | null>(null);
  const [historyFocus, setHistoryFocus] = useState<IrisHistoryFocus | null>(
    null,
  );
  // Sidebar recolhida = preferência pura → durável (localStorage), sobrevive à sessão.
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState(
    `${persistScope}.sidebarCollapsed`,
    false,
    { backend: "local" },
  );
  const [loading, setLoading] = useState(loadFromSupabase);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inboundNotice, setInboundNotice] = useState<IrisInboundNotice | null>(
    null,
  );
  const [onlineOperators, setOnlineOperators] = useState(0);
  const [startAttendanceOpen, setStartAttendanceOpen] = useState(false);
  const [startAttendanceQueueLabel, setStartAttendanceQueueLabel] = useState<
    string | null
  >(null);
  const knownMessageIdsRef = useRef<Set<string>>(
    collectIrisMessageIds({ ...emptyIrisData, tickets: initialTickets }),
  );
  const refreshInFlightRef = useRef(false);

  const enrichIrisDataWithCrm360 = useCallback(async (data: IrisData) => {
    return enrichTicketsWithCrm360(data, {
      getAccessToken: getIrisAccessToken,
    });
  }, []);

  function notifyInbound(ticket: IrisTicket, message: IrisMessage) {
    const notice = {
      body: message.body || "Nova mensagem recebida no WhatsApp.",
      id: message.id,
      receivedAt: message.createdAt,
      ticketId: ticket.id,
      title: ticketContactLabel(ticket),
    };

    setInboundNotice(notice);
    playIrisInboundSound();
    showBrowserIrisNotification({
      body: notice.body,
      tag: `iris-${ticket.id}`,
      title: `Iris - ${notice.title}`,
    });
    // Registra na central de notificacoes do Panteon (o sininho), igual o Hermes —
    // assim a notificacao fica persistida mesmo depois de lida.
    publishNotification({
      actionLabel: "Abrir",
      context: { entityId: ticket.id, entityType: "iris-ticket" },
      createdAt: message.createdAt,
      description: notice.body,
      href: `${cobrancaMode ? "/hades" : "/iris"}?atendimento=${encodeURIComponent(ticket.protocol)}`,
      id: `iris-msg-${message.id}`,
      kind: "atendimento",
      moduleId: cobrancaMode ? "hades" : "iris",
      moduleLabel: cobrancaMode ? "Hades" : "Iris",
      severity: "info",
      title: notice.title,
    });
  }

  const refreshIrisData = useCallback(
    async ({ notifyNewInbound = false } = {}) => {
      if (!loadFromSupabase || refreshInFlightRef.current) {
        return;
      }

      if (operatorScoped && !operatorUserId) {
        return;
      }

      refreshInFlightRef.current = true;

      try {
        const nextData = await enrichIrisDataWithCrm360(
          await withIrisTimeout(
            loadIrisData({ operatorUserId, queueSlugFilter: scopedQueueSlug }),
            IRIS_QUEUE_LOAD_TIMEOUT_MS,
            "fila da Iris",
          ),
        );
        let latestInbound: { message: IrisMessage; ticket: IrisTicket } | null =
          null;
        const knownMessageIds = knownMessageIdsRef.current;

        nextData.tickets.forEach((ticket) => {
          ticket.messages.forEach((message) => {
            const alreadyKnown = knownMessageIds.has(message.id);

            if (!alreadyKnown) {
              knownMessageIds.add(message.id);

              if (notifyNewInbound && message.direction === "inbound") {
                if (
                  !latestInbound ||
                  dateValue(message.createdAt) >
                    dateValue(latestInbound.message.createdAt)
                ) {
                  latestInbound = { message, ticket };
                }
              }
            }
          });
        });

        setIrisData(nextData);
        setSelectedTicketId((current) =>
          current && nextData.tickets.some((ticket) => ticket.id === current)
            ? current
            : nextData.tickets[0]?.id || "",
        );

        if (latestInbound) {
          notifyInbound(latestInbound.ticket, latestInbound.message);
        }
      } catch (error) {
        console.error("[iris] nao foi possivel atualizar a operacao", error);
      } finally {
        refreshInFlightRef.current = false;
      }
    },
    [
      enrichIrisDataWithCrm360,
      loadFromSupabase,
      operatorScoped,
      operatorUserId,
      scopedQueueSlug,
    ],
  );

  useEffect(() => {
    if (!loadFromSupabase) {
      setIrisData((current) => ({
        ...current,
        tickets: initialTickets,
      }));
      knownMessageIdsRef.current = collectIrisMessageIds({
        ...emptyIrisData,
        tickets: initialTickets,
      });
      setSelectedTicketId((current) => current || initialTickets[0]?.id || "");
      return;
    }

    let active = true;

    async function loadIris() {
      if (operatorScoped && !operatorUserId) {
        setIrisData(emptyIrisData);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);

      try {
        const nextData = await enrichIrisDataWithCrm360(
          await withIrisTimeout(
            loadIrisData({ operatorUserId, queueSlugFilter: scopedQueueSlug }),
            IRIS_QUEUE_LOAD_TIMEOUT_MS,
            "fila da Iris",
          ),
        );

        if (!active) {
          return;
        }

        setIrisData(nextData);
        knownMessageIdsRef.current = collectIrisMessageIds(nextData);
        setSelectedTicketId(
          (current) => current || nextData.tickets[0]?.id || "",
        );
      } catch (error) {
        console.error("[caredesk] nao foi possivel carregar a operacao", error);
        if (active) {
          setIrisData(emptyIrisData);
          setLoadError("Nao foi possivel carregar a operacao do Iris.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadIris();

    return () => {
      active = false;
    };
  }, [
    enrichIrisDataWithCrm360,
    initialTickets,
    loadFromSupabase,
    operatorScoped,
    operatorUserId,
    scopedQueueSlug,
  ]);

  useEffect(() => {
    if (!loadFromSupabase) {
      return;
    }

    registerIrisNotificationPermissionIntent();

    const client = getHubSupabaseClient();

    if (!client) {
      return;
    }

    // Coalesce das rajadas do realtime: N eventos em janela curta viram um
    // unico refresh (que recarrega a fila inteira). Sem isso, cada mensagem de
    // um burst dispara uma recarga completa em cada aba aberta.
    let realtimeDebounceId: number | null = null;
    let pendingNotifyNewInbound = false;

    const scheduleRealtimeRefresh = (notifyNewInbound: boolean) => {
      pendingNotifyNewInbound = pendingNotifyNewInbound || notifyNewInbound;

      if (realtimeDebounceId !== null) {
        return;
      }

      realtimeDebounceId = window.setTimeout(() => {
        realtimeDebounceId = null;
        const notify = pendingNotifyNewInbound;
        pendingNotifyNewInbound = false;
        void refreshIrisData({ notifyNewInbound: notify });
      }, IRIS_REALTIME_REFRESH_DEBOUNCE_MS);
    };

    // Mensagem do TICKET ABERTO aparece NA HORA: o evento do realtime ja traz a
    // linha inteira — mapeia e insere direto na conversa, sem esperar o refresh
    // debounced da fila (que segue rodando para lista/previews). Era o "recebo
    // a notificacao mas a mensagem nao aparece" relatado pelo time (7/jul).
    const applyRealtimeMessageRow = (row: Record<string, unknown> | undefined) => {
      // A conversa aberta pode ser um TICKET ou um GRUPO (grupo nao tem ticket:
      // o id da conversa E o id do grupo). Sem isso, mensagem de grupo so
      // aparecia com F5.
      const conversationId =
        typeof row?.ticket_id === "string"
          ? row.ticket_id
          : typeof row?.group_id === "string"
            ? row.group_id
            : null;

      if (
        !row ||
        !conversationId ||
        conversationId !== selectedTicketIdRef.current
      ) {
        return;
      }

      const message = mapMessageRow(row);

      knownMessageIdsRef.current.add(message.id);
      setActiveThread((current) => {
        if (!current || current.ticketId !== conversationId) {
          return current;
        }

        const withoutDuplicate = current.messages.filter(
          (item) => item.id !== message.id,
        );

        return {
          ...current,
          messages: [...withoutDuplicate, message].sort(
            (first, second) =>
              dateValue(first.createdAt) - dateValue(second.createdAt),
          ),
        };
      });
    };

    // Assinatura RESILIENTE: o canal do Supabase pode cair em silencio
    // (CHANNEL_ERROR/TIMED_OUT/CLOSED) — sem rejoin, so o polling de 90s ou o
    // F5 traziam vida de volta ("tem que dar F5"). Aqui: rejoin com backoff e
    // refresh de recuperacao ao reconectar (cobre o que passou offline).
    let cancelled = false;
    let activeChannel: ReturnType<typeof client.channel> | null = null;
    let resubscribeTimeoutId: number | null = null;
    let resubscribeDelayMs = 2_000;

    const subscribeIrisRealtime = () => {
      if (cancelled) {
        return;
      }

      const channel = client
        .channel(`iris-caredesk-live-${Date.now()}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "caredesk_messages" },
          (payload: { new?: Record<string, unknown> }) => {
            applyRealtimeMessageRow(payload.new);
            scheduleRealtimeRefresh(true);
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "caredesk_messages" },
          (payload: { new?: Record<string, unknown> }) => {
            applyRealtimeMessageRow(payload.new);
            scheduleRealtimeRefresh(false);
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "caredesk_tickets" },
          () => {
            scheduleRealtimeRefresh(true);
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "caredesk_tickets" },
          () => {
            scheduleRealtimeRefresh(false);
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "caredesk_contacts" },
          () => {
            scheduleRealtimeRefresh(false);
          },
        )
        .subscribe((status) => {
          if (cancelled) {
            return;
          }

          if (status === "SUBSCRIBED") {
            resubscribeDelayMs = 2_000;
            // Recupera o que aconteceu enquanto o canal esteve fora.
            scheduleRealtimeRefresh(false);
            return;
          }

          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            void client.removeChannel(channel);

            if (activeChannel === channel) {
              activeChannel = null;
            }

            if (resubscribeTimeoutId === null) {
              resubscribeTimeoutId = window.setTimeout(() => {
                resubscribeTimeoutId = null;
                subscribeIrisRealtime();
              }, resubscribeDelayMs);
              resubscribeDelayMs = Math.min(resubscribeDelayMs * 2, 30_000);
            }
          }
        });

      activeChannel = channel;
    };

    subscribeIrisRealtime();

    const refreshInterval = window.setInterval(() => {
      void refreshIrisData({ notifyNewInbound: true });
    }, IRIS_REFRESH_INTERVAL_MS);

    // Voltar pra aba = refresh na hora; cobre reconexao do realtime e deixa o
    // intervalo de fallback ser folgado sem perda de frescor percebido.
    const handleWindowFocus = () => {
      scheduleRealtimeRefresh(false);
    };
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", handleWindowFocus);
      if (realtimeDebounceId !== null) {
        window.clearTimeout(realtimeDebounceId);
      }
      if (resubscribeTimeoutId !== null) {
        window.clearTimeout(resubscribeTimeoutId);
      }
      if (activeChannel) {
        void client.removeChannel(activeChannel);
      }
    };
  }, [loadFromSupabase, refreshIrisData]);

  useEffect(() => {
    if (!inboundNotice) {
      return;
    }

    const timeout = window.setTimeout(() => setInboundNotice(null), 7000);

    return () => window.clearTimeout(timeout);
  }, [inboundNotice]);

  useEffect(() => {
    if (!loadFromSupabase) {
      return;
    }

    let active = true;

    async function refreshPresence() {
      try {
        const snapshot = await getHubPresenceSnapshot();
        const online = snapshot.data.filter(
          (presence) => presence.status === "online",
        ).length;

        if (active) {
          setOnlineOperators(online);
        }
      } catch (error) {
        console.warn("[iris] nao foi possivel carregar presenca", error);
      }
    }

    void refreshPresence();
    const interval = window.setInterval(refreshPresence, 30000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [loadFromSupabase]);

  // Ref espelho do ticket aberto: o handler do realtime le sem re-assinar o canal.
  const selectedTicketIdRef = useRef(selectedTicketId);

  useEffect(() => {
    selectedTicketIdRef.current = selectedTicketId;
  }, [selectedTicketId]);

  const selectedTicket = useMemo(() => {
    return (
      irisData.tickets.find((ticket) => ticket.id === selectedTicketId) ??
      irisData.tickets[0] ??
      null
    );
  }, [irisData.tickets, selectedTicketId]);

  // Historico COMPLETO do ticket aberto, buscado sob demanda por ticket_id. A carga em
  // massa tem teto de 1000 msgs por workspace (PostgREST); aqui a conversa aberta nunca
  // trunca, qualquer que seja o volume. No render, mesclamos com as mensagens ao vivo do
  // snapshot (novas/otimistas/editadas), entao continua atualizando em tempo real.
  const [activeThread, setActiveThread] = useState<{
    messages: IrisMessage[];
    ticketId: string;
  } | null>(null);

  useEffect(() => {
    if (!loadFromSupabase || !selectedTicketId) {
      setActiveThread(null);
      return;
    }

    let active = true;

    void loadTicketMessages(selectedTicketId)
      .then((messages) => {
        if (active) {
          setActiveThread({ messages, ticketId: selectedTicketId });
        }
      })
      .catch(() => {
        if (active) {
          setActiveThread(null);
        }
      });

    return () => {
      active = false;
    };
  }, [loadFromSupabase, selectedTicketId]);

  const selectedTicketForView = useMemo(() => {
    if (
      !selectedTicket ||
      !activeThread ||
      activeThread.ticketId !== selectedTicket.id ||
      activeThread.messages.length === 0
    ) {
      return selectedTicket;
    }

    // Uniao por id: base = historico completo (activeThread); as mensagens ao vivo do
    // snapshot sobrescrevem por id (novas/otimistas/editadas). Ordena ascendente.
    const byId = new Map<string, IrisMessage>();
    for (const message of activeThread.messages) {
      byId.set(message.id, message);
    }
    for (const message of selectedTicket.messages) {
      byId.set(message.id, message);
    }

    const merged = Array.from(byId.values()).sort(
      (first, second) =>
        new Date(first.createdAt ?? 0).getTime() -
        new Date(second.createdAt ?? 0).getTime(),
    );

    return { ...selectedTicket, messages: merged };
  }, [activeThread, selectedTicket]);

  // Reabre a conversa do protocolo (deep-link): "Voltar ao atendimento" do Hades
  // e o clique na notificacao da central. Rastreia o ultimo protocolo tratado pra
  // suportar abrir notificacoes diferentes sem remontar a tela.
  useEffect(() => {
    if (!initialAttendanceProtocol) {
      return;
    }
    const normalized = initialAttendanceProtocol.trim().toUpperCase();
    if (attendanceProtocolHandledRef.current === normalized) {
      return;
    }
    const target = irisData.tickets.find(
      (ticket) => (ticket.protocol ?? "").trim().toUpperCase() === normalized,
    );
    if (target) {
      attendanceProtocolHandledRef.current = normalized;
      setSelectedTicketId(target.id);
      setActiveView("atendimento");
    }
  }, [initialAttendanceProtocol, irisData.tickets]);

  // Métricas de atendimento (SLA, 1ª resposta, TDR...) NÃO contam grupos:
  // grupo não é atendimento, não tem prazo nem encerramento.
  const snapshot = useMemo(
    () =>
      buildIrisSnapshot(
        {
          ...irisData,
          tickets: irisData.tickets.filter(
            (ticket) => ticket.isGroup !== true,
          ),
        },
        onlineOperators,
      ),
    [irisData, onlineOperators],
  );

  function openAttendance(ticketId?: string | { id?: string }) {
    const targetId =
      typeof ticketId === "string"
        ? ticketId
        : (ticketId?.id ?? selectedTicket?.id);

    if (!targetId) {
      return;
    }
    setSelectedTicketId(targetId);
    setActiveView("atendimento");
  }

  function openHistoryForTicket(ticket: IrisTicket) {
    setHistoryFocus(buildIrisHistoryFocus(ticket));
    setActiveView("historico");
  }

  function handleLocalMessage(ticketId: string, message: IrisMessage) {
    knownMessageIdsRef.current.add(message.id);
    setIrisData((current) => ({
      ...current,
      tickets: current.tickets.map((ticket) =>
        ticket.id === ticketId
          ? {
              ...ticket,
              assignedToLabel: assignedToLabelAfterMessage(ticket, message),
              lastMessageAt: message.createdAt,
              lastMessagePreview: irisMessagePreview(message),
              messages: [...ticket.messages, message],
              status: statusAfterMessage(ticket, message),
            }
          : ticket,
      ),
    }));
  }

  function handleMessageUpdated(ticketId: string, message: IrisMessage) {
    knownMessageIdsRef.current.add(message.id);
    setIrisData((current) => ({
      ...current,
      tickets: current.tickets.map((ticket) => {
        if (ticket.id !== ticketId) {
          return ticket;
        }

        const hasMessage = ticket.messages.some(
          (currentMessage) => currentMessage.id === message.id,
        );
        const messages = hasMessage
          ? ticket.messages.map((currentMessage) =>
              currentMessage.id === message.id ? message : currentMessage,
            )
          : [...ticket.messages, message];
        const latestMessage = messages[messages.length - 1];

        return {
          ...ticket,
          assignedToLabel: assignedToLabelAfterMessage(ticket, message),
          lastMessageAt: latestMessage?.createdAt ?? ticket.lastMessageAt,
          lastMessagePreview: latestMessage
            ? irisMessagePreview(latestMessage)
            : ticket.lastMessagePreview,
          messages,
          status: statusAfterMessage(ticket, message),
        };
      }),
    }));
  }

  function handleProfilesChanged(profiles: IrisTicketProfileConfig[]) {
    setIrisData((current) => ({
      ...current,
      profiles,
    }));
  }

  function handleQueuesChanged(queues: IrisQueueConfig[]) {
    setIrisData((current) => ({
      ...current,
      queues,
    }));
  }

  function handleTicketClosed({
    closedAt,
    metadata,
    resolvedAt,
    status,
    ticketId,
  }: {
    closedAt?: string | null;
    metadata?: Record<string, unknown> | null;
    resolvedAt?: string | null;
    status?: string | null;
    ticketId: string;
  }) {
    setIrisData((current) => ({
      ...current,
      tickets: current.tickets.map((ticket) => {
        if (ticket.id !== ticketId) {
          return ticket;
        }

        const nextMetadata =
          metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? metadata
            : (ticket.metadata ?? null);

        return {
          ...ticket,
          closedAt: closedAt ?? ticket.closedAt ?? new Date().toISOString(),
          metadata: nextMetadata,
          resolvedAt: resolvedAt ?? ticket.resolvedAt ?? null,
          status: status ? normalizeStatus(status) : "closed",
        };
      }),
    }));
  }

  function handleTicketContextUpdated({
    metadata,
    ticketId,
  }: {
    metadata?: Record<string, unknown> | null;
    ticketId: string;
  }) {
    setIrisData((current) => ({
      ...current,
      tickets: current.tickets.map((ticket) => {
        if (ticket.id !== ticketId) {
          return ticket;
        }

        return {
          ...ticket,
          metadata:
            metadata && typeof metadata === "object" && !Array.isArray(metadata)
              ? metadata
              : (ticket.metadata ?? null),
        };
      }),
    }));
  }

  // Setup do hub (aba Setup da Iris) só para admin.
  const canManageHubSetup = hubUser?.role === "admin";
  const visibleNavigationItems = (
    boardOnly
      ? navigationItems.filter((item) => item.id === "gestao")
      : navigationItems
  ).filter((item) => item.id !== "setup" || canManageHubSetup);
  const embeddedBoardOnly = embedded && boardOnly;

  return (
    <div
      onClick={registerIrisNotificationPermissionIntent}
      className={[
        "h-full min-h-0 overflow-hidden bg-subtle dark:bg-canvas text-ink",
        embedded && !embeddedBoardOnly
          ? "rounded-2xl border border-line"
          : "",
      ].join(" ")}
    >
      {inboundNotice ? (
        <IrisInboundNoticeToast
          notice={inboundNotice}
          onDismiss={() => setInboundNotice(null)}
          onOpen={() => {
            setSelectedTicketId(inboundNotice.ticketId);
            setActiveView("atendimento");
            setInboundNotice(null);
          }}
        />
      ) : null}
      {startAttendanceOpen ? (
        <IrisStartAttendanceModal
          data={irisData}
          helpers={irisStartAttendanceModalHelpers}
          initialQueueLabel={startAttendanceQueueLabel}
          onClose={() => {
            setStartAttendanceOpen(false);
            setStartAttendanceQueueLabel(null);
          }}
          onTemplatesSynced={() => {
            void refreshIrisData({ notifyNewInbound: false });
          }}
          onTicketCreated={(ticketId) => {
            setStartAttendanceOpen(false);
            setStartAttendanceQueueLabel(null);
            void refreshIrisData({ notifyNewInbound: false });
            if (ticketId) {
              setSelectedTicketId(ticketId);
              setActiveView("atendimento");
            }
          }}
        />
      ) : null}
      {embeddedBoardOnly ? (
        <section className="h-[calc(100vh-11rem)] min-h-[560px] overflow-hidden rounded-2xl border border-line bg-subtle dark:bg-canvas p-3">
          {loadError ? (
            <div className="h-full rounded-2xl border border-rose-200 bg-surface p-8 text-center text-sm font-semibold text-rose-700">
              {loadError}
            </div>
          ) : activeView === "atendimento" ? (
            <AttendanceView
              cobrancaMode={cobrancaMode}
              renderCobrancaProposal={renderCobrancaProposal}
              ticket={selectedTicketForView}
              tickets={irisData.tickets}
              selectedTicketId={selectedTicket?.id ?? selectedTicketId}
              onSelectTicket={setSelectedTicketId}
              onClose={() => setActiveView("gestao")}
              onOpenHistoryForTicket={openHistoryForTicket}
              onMessageCreated={handleLocalMessage}
              onMessageUpdated={handleMessageUpdated}
              onTicketClosed={handleTicketClosed}
              onTicketContextUpdated={handleTicketContextUpdated}
            />
          ) : (
            <ManagementView
              canSeeCacaQueue={canSeeCacaQueue}
              data={irisData}
              loading={loading}
              snapshot={snapshot}
              onOpenAttendance={openAttendance}
              onSelectTicket={setSelectedTicketId}
              onStartAttendance={(queueLabel) => {
                if (onStartAttendanceOverride) {
                  onStartAttendanceOverride();
                  return;
                }
                setStartAttendanceQueueLabel(
                  queueLabel && queueLabel !== "Todos" ? queueLabel : null,
                );
                setStartAttendanceOpen(true);
              }}
            />
          )}
        </section>
      ) : (
        <IrisModuleShell
          activeView={activeView}
          collapsed={sidebarCollapsed}
          navigationItems={visibleNavigationItems}
          onSelectView={(itemId) => {
            if (itemId === "historico") {
              setHistoryFocus(null);
            }
            setActiveView(itemId);
          }}
          onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        >
          {loadError ? (
            <div className="h-full rounded-2xl border border-rose-200 bg-surface p-8 text-center text-sm font-semibold text-rose-700">
              {loadError}
            </div>
          ) : activeView === "gestao" ? (
            <ManagementView
              canSeeCacaQueue={canSeeCacaQueue}
              data={irisData}
              loading={loading}
              snapshot={snapshot}
              onOpenAttendance={openAttendance}
              onSelectTicket={setSelectedTicketId}
              onStartAttendance={(queueLabel) => {
                setStartAttendanceQueueLabel(
                  queueLabel && queueLabel !== "Todos" ? queueLabel : null,
                );
                setStartAttendanceOpen(true);
              }}
            />
          ) : activeView === "historico" ? (
            <IrisHistoryView
              focus={historyFocus}
              helpers={irisHistoryViewHelpers}
              renderers={irisTicketQueueRenderers}
              ticketQueueHelpers={irisTicketQueueHelpers}
              tickets={irisData.tickets}
              onClearFocus={() => setHistoryFocus(null)}
              onOpenAttendance={(ticketId) => {
                setSelectedTicketId(ticketId);
                setActiveView("atendimento");
              }}
              onSelectTicket={setSelectedTicketId}
            />
          ) : activeView === "atendimento" ? (
            <AttendanceView
              cobrancaMode={cobrancaMode}
              renderCobrancaProposal={renderCobrancaProposal}
              ticket={selectedTicketForView}
              tickets={irisData.tickets}
              selectedTicketId={selectedTicket?.id ?? selectedTicketId}
              onSelectTicket={setSelectedTicketId}
              onClose={() => setActiveView("gestao")}
              onOpenHistoryForTicket={openHistoryForTicket}
              onMessageCreated={handleLocalMessage}
              onMessageUpdated={handleMessageUpdated}
              onTicketClosed={handleTicketClosed}
              onTicketContextUpdated={handleTicketContextUpdated}
            />
          ) : activeView === "disparos" ? (
            <IrisMetaBroadcastsView
              data={irisData}
              getAccessToken={getIrisAccessToken}
              helpers={irisMetaBroadcastsHelpers}
              snapshot={snapshot}
            />
          ) : activeView === "setup" && canManageHubSetup ? (
            <IrisSetupView
              constants={irisSetupViewConstants}
              data={irisData}
              helpers={irisSetupViewHelpers}
              snapshot={snapshot}
              onQueuesChanged={handleQueuesChanged}
              onProfilesChanged={handleProfilesChanged}
              onTemplatesSynced={() => {
                void refreshIrisData({ notifyNewInbound: false });
              }}
            />
          ) : (
            <IrisReportsView
              data={irisData}
              formatCount={formatCount}
              snapshot={snapshot}
            />
          )}
        </IrisModuleShell>
      )}
    </div>
  );
}

function ManagementView({
  canSeeCacaQueue,
  data,
  loading,
  snapshot,
  onOpenAttendance,
  onSelectTicket,
  onStartAttendance,
}: {
  canSeeCacaQueue: boolean;
  data: IrisData;
  loading: boolean;
  snapshot: ReturnType<typeof buildIrisSnapshot>;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  onStartAttendance: (queueLabel?: string) => void;
}) {
  // Board (kanban): abertos + encerrados HOJE (pra alimentar a coluna "Resolvido hoje").
  // Grupos ENTRAM (o Board e a porta de entrada do cockpit — sem eles o grupo fica
  // inalcancavel) e caem na propria coluna de canal. Nao contaminam as METRICAS:
  // o snapshot de SLA/1a resposta/TDR filtra grupos fora.
  const boardTickets = useMemo(
    () =>
      data.tickets.filter(
        (ticket) =>
          ticket.isGroup === true ||
          ((canSeeCacaQueue || !isCacaOwnedTicket(ticket)) &&
            (!isClosedTicket(ticket) || isClosedToday(ticket))),
      ),
    [canSeeCacaQueue, data.tickets],
  );
  const boardMetrics = useMemo<IrisBoardMetrics>(
    () => ({
      averageHandlingTimeLabel: snapshot.averageHandlingTimeLabel,
      firstResponseLabel: snapshot.firstResponseLabel,
      responseTimeLabel: snapshot.responseTimeLabel,
      slaCriticalLabel: formatCount(snapshot.slaCritical),
      slaCriticalTone: snapshot.slaCritical ? "red" : "neutral",
    }),
    [
      snapshot.averageHandlingTimeLabel,
      snapshot.firstResponseLabel,
      snapshot.responseTimeLabel,
      snapshot.slaCritical,
    ],
  );

  return loading ? (
    <IrisLoading />
  ) : (
    <IrisBoardKanban
      helpers={irisTicketQueueHelpers}
      metrics={boardMetrics}
      onOpenAttendance={onOpenAttendance}
      onSelectTicket={onSelectTicket}
      onStartAttendance={onStartAttendance}
      renderers={irisTicketQueueRenderers}
      tickets={boardTickets}
    />
  );
}

function AttendanceView({
  cobrancaMode = false,
  onClose,
  onOpenHistoryForTicket,
  onMessageCreated,
  onMessageUpdated,
  onTicketClosed,
  onTicketContextUpdated,
  onSelectTicket,
  renderCobrancaProposal,
  selectedTicketId,
  ticket,
  tickets,
}: {
  cobrancaMode?: boolean;
  renderCobrancaProposal?: ((args: CobrancaProposalRenderArgs) => ReactNode) | null;
  onClose: () => void;
  onOpenHistoryForTicket: (ticket: IrisTicket) => void;
  onMessageCreated: (ticketId: string, message: IrisMessage) => void;
  onMessageUpdated: (ticketId: string, message: IrisMessage) => void;
  onTicketClosed: (input: {
    closedAt?: string | null;
    metadata?: Record<string, unknown> | null;
    resolvedAt?: string | null;
    status?: string | null;
    ticketId: string;
  }) => void;
  onTicketContextUpdated: (input: {
    metadata?: Record<string, unknown> | null;
    ticketId: string;
  }) => void;
  onSelectTicket: (ticketId: string) => void;
  selectedTicketId: string;
  ticket: IrisTicket | null;
  tickets: IrisTicket[];
}) {
  if (!ticket) {
    return <IrisConversationEmptyState />;
  }

  return (
    <IrisConversationPanel
      cobrancaMode={cobrancaMode}
      renderCobrancaProposal={renderCobrancaProposal}
      ticket={ticket}
      tickets={tickets}
      selectedTicketId={selectedTicketId}
      onSelectTicket={onSelectTicket}
      onClose={onClose}
      onOpenHistoryForTicket={onOpenHistoryForTicket}
      onMessageCreated={onMessageCreated}
      onMessageUpdated={onMessageUpdated}
      onTicketClosed={onTicketClosed}
      onTicketContextUpdated={onTicketContextUpdated}
    />
  );
}

function cobrancaAssunto(label: string): string {
  return label.trim().toLowerCase() === "primeiro contato" ? "Contato" : label;
}

function athenaActionLabel(action: AthenaAction): string {
  switch (action) {
    case "boletos":
      return "Enviar boletos";
    case "total":
      return "Total em aberto";
    case "resumir":
      return "Resumir conversa";
    case "tickets":
      return "Lista de tickets";
    case "ajustar_tom":
      return "Ajustar o tom da minha mensagem";
    default:
      return "";
  }
}

function readCobrancaClientId(ticket: IrisTicket): string | null {
  const metadata = ticket.metadata;
  const cobranca =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).cobranca
      : null;
  if (cobranca && typeof cobranca === "object" && !Array.isArray(cobranca)) {
    const clientId = (cobranca as Record<string, unknown>).clientId;
    if (typeof clientId === "string" && clientId.trim()) return clientId;
  }
  return null;
}

function IrisConversationPanel({
  cobrancaMode = false,
  onClose,
  onOpenHistoryForTicket,
  onMessageCreated,
  onMessageUpdated,
  onTicketClosed,
  onTicketContextUpdated,
  onSelectTicket,
  renderCobrancaProposal,
  selectedTicketId,
  ticket,
  tickets,
}: {
  cobrancaMode?: boolean;
  renderCobrancaProposal?: ((args: CobrancaProposalRenderArgs) => ReactNode) | null;
  onClose: () => void;
  onOpenHistoryForTicket: (ticket: IrisTicket) => void;
  onMessageCreated: (ticketId: string, message: IrisMessage) => void;
  onMessageUpdated: (ticketId: string, message: IrisMessage) => void;
  onTicketClosed: (input: {
    closedAt?: string | null;
    metadata?: Record<string, unknown> | null;
    resolvedAt?: string | null;
    status?: string | null;
    ticketId: string;
  }) => void;
  onTicketContextUpdated: (input: {
    metadata?: Record<string, unknown> | null;
    ticketId: string;
  }) => void;
  onSelectTicket: (ticketId: string) => void;
  selectedTicketId: string;
  ticket: IrisTicket;
  tickets: IrisTicket[];
}) {
  const [conversationFilter, setConversationFilter] = useState("Abertas");
  // Filtro por canal na fila (Tudo / WhatsApp / Grupo / E-mail).
  const [conversationChannel, setConversationChannel] =
    useState<IrisInboxChannelFilter>("all");
  const [draft, setDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [recordingAudio, setRecordingAudio] = useState(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [audioPreview, setAudioPreview] = useState<{
    blob: Blob;
    durationMs: number | null;
    url: string;
  } | null>(null);
  // Anexo pronto pra enviar (foto/print/arquivo). previewUrl = objectURL só de imagem.
  const [attachmentDraft, setAttachmentDraft] = useState<{
    file: File;
    fileName: string;
    kind: "document" | "image";
    previewUrl: string | null;
  } | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<IrisReplyPreview | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const [closingTicket, setClosingTicket] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [search, setSearch] = useState("");
  const [showPreviousTickets, setShowPreviousTickets] = useState(false);
  const [conversationListCollapsed, setConversationListCollapsed] =
    useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  // Sinal pro contexto abrir o popup de registrar acordo/promessa (icone no header).
  const [proposalSignal, setProposalSignal] = useState(0);
  // Athena (assistente do operador) — thread/prompt/loading.
  const [athenaThread, setAthenaThread] = useState<AthenaMessage[]>([]);
  const [athenaPrompt, setAthenaPrompt] = useState("");
  const [athenaLoading, setAthenaLoading] = useState(false);
  // Mensagem da conversa selecionada como contexto pra Athena ("responda essa…").
  const [athenaContextMessage, setAthenaContextMessage] = useState<string | null>(
    null,
  );
  const [attendantOpen, setAttendantOpen] = useState(false);
  const [attendantPrompt, setAttendantPrompt] = useState("");
  const [attendantDocumentFragment, setAttendantDocumentFragment] =
    useState("");
  const [attendantDocumentPosition, setAttendantDocumentPosition] = useState<
    IrisAttendantDocumentPosition
  >("last4");
  const [attendantLoading, setAttendantLoading] = useState(false);
  const [attendantResult, setAttendantResult] =
    useState<IrisAttendantResponse | null>(null);
  const [attendantFeedback, setAttendantFeedback] = useState("");
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStartedAtRef = useRef<number | null>(null);
  const audioCancelledRef = useRef(false);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const repairingOutboundMessageIds = useRef(new Set<string>());
  const { hubUser } = useAuth();
  const operatorLabel = formatIrisOperatorLabel(hubUser?.name);
  const operatorAvatarUrl = hubUser?.avatarUrl ?? null;
  // Operação assistida: "reply" fala com o cliente, "note" é sussurro interno.
  const [composerMode, setComposerMode] = useState<"reply" | "note">("reply");
  // Responder como Cacá (operador dispara, servidor envia assinado como Cacá).
  const [sendingAsCaca, setSendingAsCaca] = useState(false);
  const [contextModalMode, setContextModalMode] =
    useState<IrisContextModalMode>(null);
  const [apoloContextEntity, setApoloContextEntity] =
    useState<IrisApoloContextEntity | null>(null);
  const [apoloContextError, setApoloContextError] = useState<string | null>(
    null,
  );
  const [apoloContextLoading, setApoloContextLoading] = useState(false);
  const [apoloContextUpdatedAt, setApoloContextUpdatedAt] = useState<
    string | null
  >(null);
  const [contextNoteDraft, setContextNoteDraft] = useState("");
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  // Assunto do atendimento: o operador escolhe no bloco fixo do topo (catalogo do
  // Setup) e o valor carrega pro encerramento. Mensagem nova vem em branco.
  const [attendanceSubject, setAttendanceSubject] = useState(
    ticket?.subject ?? "",
  );
  const [subjectCatalog, setSubjectCatalog] = useState<string[]>([]);
  const [contextAgendaEvents, setContextAgendaEvents] = useState<
    IrisTicketContextAgendaEvent[]
  >([]);
  const [contextAgendaTitleDraft, setContextAgendaTitleDraft] = useState("");
  const [contextAgendaDateDraft, setContextAgendaDateDraft] = useState("");
  const [contextAgendaNotesDraft, setContextAgendaNotesDraft] = useState("");
  const [contextAgendaMonthCursor, setContextAgendaMonthCursor] =
    useState(startOfMonthIso());
  const [contextSaving, setContextSaving] = useState(false);

  const conversations = useMemo(() => {
    const normalized = search.trim().toLowerCase();

    return tickets
      .filter((item) => {
        const displayLabel = ticketContactLabel(item).toLowerCase();
        const crmSubtitle = ticketCrmSubtitle(item).toLowerCase();
        const matchesSearch =
          !normalized ||
          displayLabel.includes(normalized) ||
          crmSubtitle.includes(normalized) ||
          item.contactLabel.toLowerCase().includes(normalized) ||
          item.protocol.toLowerCase().includes(normalized) ||
          item.lastMessagePreview.toLowerCase().includes(normalized);

        if (!matchesSearch) {
          return false;
        }

        // Cacá isolada: atendimentos conduzidos por ela não entram nesta fila.
        // (No handoff o ticket deixa de ser dela e volta a aparecer aqui.)
        if (isCacaOwnedTicket(item)) {
          return false;
        }

        // Filtro por canal (Tudo / WhatsApp / Grupo / E-mail).
        if (conversationChannel === "email" && !isEmailTicket(item)) {
          return false;
        }
        if (conversationChannel === "group" && item.isGroup !== true) {
          return false;
        }
        if (
          conversationChannel === "whatsapp" &&
          (isEmailTicket(item) || item.isGroup === true)
        ) {
          return false;
        }

        if (conversationFilter === "Pendentes") {
          return ["new", "waiting_operator", "pending", "open"].includes(
            effectiveIrisStatus(item),
          );
        }

        if (conversationFilter === "Encerradas") {
          return isClosedTicket(item);
        }

        return !isClosedTicket(item);
      })
      .sort(sortIrisTickets);
  }, [conversationChannel, conversationFilter, search, tickets]);

  const previousTickets = useMemo(() => {
    return tickets
      .filter((item) => item.id !== ticket.id)
      .filter((item) =>
        ticket.contactId
          ? item.contactId === ticket.contactId
          : ticket.contactPhone
            ? item.contactPhone === ticket.contactPhone
            : item.contactLabel === ticket.contactLabel,
      )
      .sort(
        (first, second) =>
          dateValue(second.openedAt) - dateValue(first.openedAt),
      );
  }, [
    ticket.contactId,
    ticket.contactLabel,
    ticket.contactPhone,
    ticket.id,
    tickets,
  ]);
  const ticketContextNote = useMemo(
    () => readIrisTicketContextNote(ticket.metadata),
    [ticket.metadata],
  );
  const ticketContextAgendaEvents = useMemo(
    () => readIrisTicketContextAgendaEvents(ticket.metadata),
    [ticket.metadata],
  );
  const hasUserPortfolio = hasIrisApoloUserPortfolio(apoloContextEntity);
  const fallbackUserProfile = hasIrisRegisteredUserProfile(
    ticket.crm360Registration,
  );
  const portfolioShortcutEnabled = hasUserPortfolio || fallbackUserProfile;
  // Marcadores do header (centro): PERFIL do contato (papel Careli) + adimplencia.
  // Cliente vira Comprador (tem carteira) ou Prospect; demais papeis vêm do Apolo
  // (pulando "pessoa fisica/juridica", que é tipo de pessoa, não perfil).
  const contactProfileLabel = (() => {
    if (hasUserPortfolio) {
      return "Comprador";
    }

    const apoloProfiles = apoloContextEntity?.profiles ?? [];
    const isUsuario =
      fallbackUserProfile ||
      apoloProfiles.some((profile) =>
        (profile ?? "").toLowerCase().includes("usuario"),
      );

    if (isUsuario) {
      return "Prospect";
    }

    const role = apoloProfiles.find((profile) => {
      const key = (profile ?? "").toLowerCase().trim();

      return key !== "" && !key.includes("pessoa") && !key.includes("usuario");
    });

    return (
      role ??
      (ticket.profileLabel && ticket.profileLabel !== "Sem perfil"
        ? ticket.profileLabel
        : null)
    );
  })();
  const contactDelinquency: "adimplente" | "inadimplente" | null =
    hasUserPortfolio
      ? (apoloContextEntity?.financial?.overdueInstallments ?? 0) > 0
        ? "inadimplente"
        : "adimplente"
      : null;
  const agendaTimeline = useMemo(
    () =>
      buildIrisMergedAgendaEntries({
        entity: apoloContextEntity,
        events: contextAgendaEvents,
      }),
    [apoloContextEntity, contextAgendaEvents],
  );
  const agendaCalendar = useMemo(
    () => buildIrisAgendaCalendar(contextAgendaMonthCursor, agendaTimeline),
    [contextAgendaMonthCursor, agendaTimeline],
  );
  const contextShortcuts = [
    {
      active: contextModalMode === "client",
      disabled: false,
      icon: FileText,
      id: "client" as const,
      label: "Dados do cliente e nota",
      onClick: () => {
        openContextModal("client");
      },
    },
    {
      active: contextModalMode === "agenda",
      disabled: false,
      icon: CalendarClock,
      id: "agenda" as const,
      label: "Agenda mensal e tarefas",
      onClick: () => {
        openContextModal("agenda");
      },
    },
    {
      active: false,
      disabled: true,
      icon: ClipboardList,
      id: "portfolio" as const,
      label: portfolioShortcutEnabled
        ? "Carteira em breve"
        : "Carteira indisponivel para este cliente",
      onClick: () => {},
    },
    {
      active: false,
      disabled: true,
      icon: Clock3,
      id: "history" as const,
      label: "Historico em breve",
      onClick: () => {},
    },
  ];

  const loadApoloContext = useCallback(async () => {
    const phoneDigits = normalizeIrisPhoneDigits(ticket.contactPhone);
    const queryCandidates = [
      phoneDigits.length >= 8 ? phoneDigits : "",
      ticketContactLabel(ticket),
    ].filter((value, index, values) => {
      const normalized = value.trim();

      return (
        normalized.length >= 3 &&
        values.findIndex((item) => item.trim() === normalized) === index
      );
    });

    if (!queryCandidates.length) {
      setApoloContextEntity(null);
      setApoloContextError(
        "Telefone ou nome insuficiente para consultar o Apolo.",
      );
      setApoloContextLoading(false);
      return;
    }

    setApoloContextLoading(true);
    setApoloContextError(null);
    setApoloContextUpdatedAt(null);

    try {
      const accessToken = await getIrisAccessToken();
      let resolvedEntity: IrisApoloContextEntity | null = null;
      let lastResponseError: string | null = null;

      // 1) Fonte: read-model do Apolo (Iris<-Apolo). O loader hidrata o portfolio
      // (parcelas/contrato) via fetchC2xPortfolioByEntity, entao a Carteira vem
      // completa — mesma informacao de parcelas do Hades.
      for (const candidate of queryCandidates) {
        const response = await fetch(
          `/api/apolo/relationships?q=${encodeURIComponent(candidate)}&limit=20`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );
        const payload = (await response.json().catch(() => null)) as {
          data?: {
            entities?: IrisApoloContextEntity[];
          };
          error?: string;
        } | null;

        if (!response.ok) {
          lastResponseError =
            payload?.error ?? "Nao foi possivel consultar o Apolo.";
          continue;
        }

        const entities = Array.isArray(payload?.data?.entities)
          ? payload?.data?.entities
          : [];

        if (!entities.length) {
          continue;
        }

        resolvedEntity = pickIrisApoloEntityForTicket(entities, ticket);

        if (resolvedEntity) {
          break;
        }
      }

      // 2) Fallback: resolver direto no C2X (so se o read-model nao achou).
      if (!resolvedEntity) {
        try {
          const c2xResponse = await fetch("/api/iris/c2x/resolve", {
            body: JSON.stringify({
              phones: ticket.contactPhone ? [ticket.contactPhone] : [],
              query: ticketContactLabel(ticket),
            }),
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            method: "POST",
          });
          const c2xPayload = (await c2xResponse.json().catch(() => null)) as {
            data?: { entities?: IrisApoloContextEntity[] };
            error?: string;
          } | null;

          if (c2xResponse.ok && Array.isArray(c2xPayload?.data?.entities)) {
            resolvedEntity = pickIrisApoloEntityForTicket(
              c2xPayload.data.entities,
              ticket,
            );
          }
        } catch {
          // Sem C2X disponivel: fica so com o read-model do Apolo.
        }
      }

      if (!resolvedEntity) {
        setApoloContextEntity(null);
        setApoloContextError(
          lastResponseError ??
            "Cliente nao localizado no Apolo para este atendimento.",
        );
        return;
      }

      setApoloContextEntity(resolvedEntity);
      setApoloContextUpdatedAt(new Date().toISOString());
    } catch (contextError) {
      setApoloContextEntity(null);
      setApoloContextError(
        contextError instanceof Error
          ? contextError.message
          : "Nao foi possivel carregar os dados do Apolo.",
      );
    } finally {
      setApoloContextLoading(false);
    }
  }, [
    ticket.contactPhone,
    ticket.crm360Registration?.entityId,
    ticket.contactLabel,
    ticket.contactId,
    ticket.id,
  ]);

  useEffect(() => {
    void loadApoloContext();
  }, [loadApoloContext]);

  useEffect(() => {
    setContextNoteDraft(ticketContextNote?.text ?? "");
    setContextAgendaEvents(ticketContextAgendaEvents);
    setContextAgendaTitleDraft("");
    setContextAgendaDateDraft("");
    setContextAgendaNotesDraft("");
    setContextAgendaMonthCursor(
      startOfMonthIso(
        ticketContextAgendaEvents[0]?.scheduledAt ?? new Date().toISOString(),
      ),
    );
    setContextModalMode(null);
    setAttendanceSubject(ticket.subject ?? "");
  }, [ticket.id, ticket.subject]);

  // Catalogo de assuntos cadastrados (Setup) p/ o select do bloco fixo. Mesma
  // fonte do close modal (GET /api/iris/tickets -> profiles).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getIrisAccessToken();
        const response = await fetch("/api/iris/tickets", {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const payload = (await response.json().catch(() => null)) as {
          profiles?: { name: string; slug?: string }[];
        } | null;
        if (cancelled || !response.ok || !payload) {
          return;
        }
        const list = (payload.profiles ?? [])
          .map((profile) =>
            profile.slug === "primeiro-contato" ||
            profile.name?.toLowerCase() === "primeiro contato"
              ? "Contato"
              : profile.name,
          )
          .filter(Boolean);
        setSubjectCatalog(Array.from(new Set(list)));
      } catch {
        // segue sem catalogo; o assunto atual continua editavel como texto.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const latestCustomerMessage = useMemo(() => {
    for (let index = ticket.messages.length - 1; index >= 0; index -= 1) {
      const message = ticket.messages[index];

      if (message.direction === "inbound" && message.body.trim()) {
        return message.body.trim();
      }
    }

    return ticket.lastMessagePreview === "Sem mensagens registradas"
      ? ""
      : ticket.lastMessagePreview;
  }, [ticket.lastMessagePreview, ticket.messages]);

  const ticketChecklist = buildTicketChecklist(ticket);
  const ticketClosed = isClosedTicket(ticket);
  const customerServiceWindow = getIrisCustomerServiceWindow(ticket, tickets);
  const ticketStatus = effectiveIrisStatus(ticket);
  const ticketIncomplete =
    !ticketClosed &&
    (ticketStatus === "new" ||
      ticketStatus === "pending" ||
      ticketStatus === "waiting_operator" ||
      ticketChecklist.some((item) => !item.ok));
  const operationReady = !ticketClosed;
  const editingMessage = editingMessageId
    ? (ticket.messages.find((message) => message.id === editingMessageId) ??
      null)
    : null;
  const ticketIsEmail = isEmailTicket(ticket);
  // Grupo de WhatsApp: conversa de monitoramento (read-only), sem janela de 24h.
  const ticketIsGroup = ticket.isGroup === true;
  // Quando a Caca conduz o atendimento, o operador NAO pode atropelar (enviar):
  // so acompanha e direciona/transfere. O composer fica travado.
  const attendanceWithCaca = isCacaOwnedTicket(ticket);
  // Grupo não tem janela de 24h do Meta — o envio depende só do ticket estar operável.
  const canSendFreeForm =
    operationReady &&
    (ticketIsGroup || customerServiceWindow.open) &&
    !attendanceWithCaca;
  const composerReady = editingMessage
    ? operationReady && !attendanceWithCaca
    : canSendFreeForm;
  // Operação assistida (sussurro): quem NÃO é o dono do atendimento só pode mandar
  // nota interna (pra assumir o cliente é por transferência/encerramento). Nota não
  // depende da janela de 24h nem da trava da Cacá — só do ticket estar aberto.
  const ticketHasOwner = Boolean(ticket.assignedToUserId);
  const viewerIsOwner = Boolean(
    hubUser?.id &&
      ticket.assignedToUserId &&
      hubUser.id === ticket.assignedToUserId,
  );
  const mustWhisper = !ticketClosed && ticketHasOwner && !viewerIsOwner;
  const effectiveComposerMode: "reply" | "note" =
    mustWhisper && !editingMessage ? "note" : composerMode;
  const noteModeActive = effectiveComposerMode === "note" && !editingMessage;
  const composerReadyForMode = noteModeActive ? operationReady : composerReady;
  const blockedTooltip = ticketClosed
    ? "Ticket encerrado"
    : customerServiceWindow.open
      ? "Enviar mensagem"
      : "Janela WhatsApp fechada";
  const latestMessage = ticket.messages[ticket.messages.length - 1] ?? null;
  const latestMessageSignature = latestMessage
    ? [
        latestMessage.id,
        latestMessage.body,
        latestMessage.deliveryStatus,
        latestMessage.deliveredAt,
        latestMessage.readAt,
        latestMessage.reactions?.length ?? 0,
      ].join(":")
    : "";

  useOutsideDismiss({
    enabled: emojiPickerOpen,
    onDismiss: () => setEmojiPickerOpen(false),
    ref: emojiPickerRef,
  });

  useEffect(() => {
    setAttendantResult(null);
    setAttendantFeedback("");
    setAttendantDocumentFragment("");
    setAttendantPrompt(latestCustomerMessage);
  }, [latestCustomerMessage, ticket.id]);

  // Ao trocar de conversa, volta o composer pro modo "responder cliente".
  useEffect(() => {
    setComposerMode("reply");
  }, [ticket.id]);

  useEffect(() => {
    if (!canSendFreeForm || sending || !ticket.contactPhone) {
      return;
    }

    const pendingLocalMessage = ticket.messages.find((message) =>
      shouldRepairOutboundMessage(message),
    );

    if (
      !pendingLocalMessage ||
      repairingOutboundMessageIds.current.has(pendingLocalMessage.id)
    ) {
      return;
    }

    void sendExistingLocalMessage(pendingLocalMessage);
  }, [
    canSendFreeForm,
    sending,
    ticket.channelId,
    ticket.contactId,
    ticket.contactPhone,
    ticket.id,
    ticket.messages,
  ]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const viewport = messagesViewportRef.current;

      if (!viewport) {
        return;
      }

      viewport.scrollTo({
        behavior: "auto",
        top: viewport.scrollHeight,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [latestMessageSignature, ticket.id, ticket.messages.length]);

  async function runIrisAttendant(selectedPaymentId?: string) {
    if (attendantLoading || ticketClosed) {
      return;
    }

    setAttendantLoading(true);
    setAttendantFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/attendant", {
        body: JSON.stringify({
          action: selectedPaymentId ? "select_boleto" : "analyze",
          documentFragment: attendantDocumentFragment,
          documentFragmentPosition: attendantDocumentPosition,
          message: attendantPrompt || latestCustomerMessage,
          selectedPaymentId,
          ticketId: ticket.id,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | (IrisAttendantResponse & { error?: string })
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Nao foi possivel acionar a Cacá.");
      }

      setAttendantResult(payload);
    } catch (error) {
      setAttendantFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel acionar a Cacá agora.",
      );
    } finally {
      setAttendantLoading(false);
    }
  }

  function useAttendantReplyAsDraft() {
    const replyText = attendantResult?.replyText?.trim();

    if (!replyText) {
      return;
    }

    setDraft(replyText);
    setEditingMessageId(null);
    setReplyToMessage(null);
    setEmojiPickerOpen(false);
    setFeedback("Resposta da Cacá aplicada ao rascunho.");
    window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
  }

  const cobrancaClientId = cobrancaMode ? readCobrancaClientId(ticket) : null;

  function insertDraftText(text: string) {
    const value = text.trim();
    if (!value) return;
    setDraft((current) => (current.trim() ? `${current}\n${value}` : value));
    window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
  }

  function askAthenaAboutMessage(message: IrisMessage) {
    const body = (message.body ?? "").trim();
    if (!body) return;
    setAthenaContextMessage(body);
    setAttendantOpen(true);
    setAthenaPrompt((current) =>
      current.trim() ? current : "Responda esta mensagem ",
    );
  }

  async function transcribeAudio(audio: Blob): Promise<string> {
    try {
      const accessToken = await getIrisAccessToken();
      const form = new FormData();
      form.append("audio", audio, "athena-audio.webm");
      const response = await fetch("/api/iris/athena/transcribe", {
        body: form,
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as {
        text?: string;
      } | null;
      return typeof body?.text === "string" ? body.text.trim() : "";
    } catch {
      return "";
    }
  }

  async function runAthena(
    action: AthenaAction,
    promptOverride?: string,
    audioUrl?: string,
  ) {
    if (athenaLoading) return;

    // "Lista de tickets": montada localmente a partir dos tickets do cliente
    // (atual + anteriores), sem chamar o backend da Athena.
    if (action === "tickets") {
      const clientTickets = [ticket, ...previousTickets];
      const lines = clientTickets.length
        ? clientTickets
            .map((item) => {
              const opened = formatDateTime(item.openedAt);
              const closedValue = item.closedAt ?? item.resolvedAt;
              const period = closedValue
                ? `aberto ${opened} · encerrado ${formatDateTime(closedValue)}`
                : `aberto ${opened} · em aberto`;
              return `• ${item.protocol} — ${item.subject || "Sem assunto"}\n  ${period} · ${item.assignedToLabel}`;
            })
            .join("\n")
        : "Este cliente ainda nao possui outros tickets.";
      const stamp = Date.now();
      setAthenaThread((current) => [
        ...current,
        { id: `op-${stamp}`, role: "operator", text: athenaActionLabel("tickets") },
        {
          id: `at-${stamp}`,
          role: "athena",
          text: `Tickets deste cliente:\n${lines}`,
        },
      ]);
      return;
    }

    const userText =
      action === "livre"
        ? (promptOverride ?? athenaPrompt).trim()
        : athenaActionLabel(action);
    if (action === "livre" && !userText) return;

    setAthenaLoading(true);
    const stamp = Date.now();
    setAthenaThread((current) => [
      ...current,
      { audioUrl, id: `op-${stamp}`, role: "operator", text: userText },
    ]);
    if (action === "livre") {
      setAthenaPrompt("");
    }

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/athena", {
        body: JSON.stringify({
          action,
          contextMessage: athenaContextMessage ?? "",
          draft,
          prompt: action === "livre" ? userText : "",
          ticketId: ticket.id,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        replyText?: string;
      } | null;
      const text =
        body?.replyText ??
        body?.error ??
        "Não consegui responder agora. Tente de novo.";
      setAthenaThread((current) => [
        ...current,
        { id: `at-${Date.now()}`, role: "athena", text },
      ]);
    } catch {
      setAthenaThread((current) => [
        ...current,
        {
          id: `at-${Date.now()}`,
          role: "athena",
          text: "Não consegui falar com a Athena agora.",
        },
      ]);
    } finally {
      setAthenaLoading(false);
    }
  }

  // Auto-registro na timeline do cliente (Hades) das acoes do atendimento de
  // cobranca. Best-effort — nao bloqueia a acao se falhar.
  async function logCobrancaTimeline(title: string, description: string) {
    if (!cobrancaMode || !cobrancaClientId) {
      return;
    }
    try {
      const accessToken = await getIrisAccessToken();
      await fetch("/api/hades/attendance/manual-events", {
        body: JSON.stringify({
          client: { id: cobrancaClientId, name: ticketContactLabel(ticket) },
          event: {
            description,
            occurredAt: new Date().toISOString(),
            status: "Registrado",
            title,
            type: "Atendimento",
          },
          kind: "timeline",
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
    } catch {
      // timeline e best-effort.
    }
  }

  async function performClose(options: {
    closeReason?: string;
    motivo?: string;
    subject?: string;
  }) {
    if (ticketClosed || closingTicket) {
      return;
    }

    setClosingTicket(true);
    setFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/tickets", {
        body: JSON.stringify({
          action: "close",
          closeReason:
            options.closeReason ?? "Encerrado manualmente no atendimento Iris.",
          ...(options.motivo ? { closeMotivo: options.motivo } : {}),
          ...(options.subject ? { subject: options.subject } : {}),
          ticketId: ticket.id,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as {
        alreadyClosed?: boolean;
        error?: string;
        ticket?: {
          closedAt?: string | null;
          metadata?: Record<string, unknown> | null;
          resolvedAt?: string | null;
          status?: string | null;
        } | null;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Nao foi possivel encerrar o chat.");
      }

      const closedTicket = payload?.ticket;
      const metadata =
        closedTicket?.metadata &&
        typeof closedTicket.metadata === "object" &&
        !Array.isArray(closedTicket.metadata)
          ? closedTicket.metadata
          : null;

      onTicketClosed({
        closedAt:
          typeof closedTicket?.closedAt === "string"
            ? closedTicket.closedAt
            : new Date().toISOString(),
        metadata,
        resolvedAt:
          typeof closedTicket?.resolvedAt === "string"
            ? closedTicket.resolvedAt
            : (ticket.resolvedAt ?? null),
        status:
          typeof closedTicket?.status === "string"
            ? closedTicket.status
            : "closed",
        ticketId: ticket.id,
      });

      setDraft("");
      setEditingMessageId(null);
      setEmojiPickerOpen(false);
      setReplyToMessage(null);
      setCloseModalOpen(false);
      await logCobrancaTimeline(
        "Atendimento encerrado",
        `Protocolo ${ticket.protocol}${options.motivo ? ` · ${options.motivo}` : ""}${
          options.subject ? ` · ${options.subject}` : ""
        }${options.closeReason ? ` · ${options.closeReason}` : ""}`,
      );
      setFeedback(
        payload?.alreadyClosed
          ? "Protocolo ja estava encerrado."
          : `Chat encerrado. Protocolo ${ticket.protocol} finalizado.`,
      );
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel encerrar o chat agora.",
      );
    } finally {
      setClosingTicket(false);
    }
  }

  async function closeTicket() {
    if (ticketClosed || closingTicket) {
      return;
    }
    const confirmed = window.confirm(
      `Encerrar o chat e finalizar o protocolo ${ticket.protocol}?`,
    );
    if (!confirmed) {
      return;
    }
    await performClose({});
  }

  async function transferTicket(input: {
    queueId: string | null;
    queueSlug: string | null;
    reason: string;
    userId: string | null;
  }) {
    if (ticketClosed || transferring) {
      return;
    }
    setTransferring(true);
    setFeedback("");
    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/tickets", {
        body: JSON.stringify({
          action: "transfer",
          targetQueueId: input.queueId,
          targetQueueSlug: input.queueSlug,
          targetUserId: input.userId,
          ticketId: ticket.id,
          transferReason: input.reason,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel direcionar o atendimento.",
        );
      }
      setTransferModalOpen(false);
      await logCobrancaTimeline(
        "Atendimento direcionado",
        `Protocolo ${ticket.protocol} · ${input.reason}`,
      );
      onClose();
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel direcionar o atendimento agora.",
      );
    } finally {
      setTransferring(false);
    }
  }

  function openContextModal(mode: Exclude<IrisContextModalMode, null>) {
    setContextModalMode(mode);

    if (mode === "agenda" && !contextAgendaDateDraft) {
      setContextAgendaDateDraft(toDateTimeLocalInput(new Date().toISOString()));
    }

    void loadApoloContext();
  }

  async function persistTicketContextUpdate(input: {
    contextAgendaEvents?: IrisTicketContextAgendaEvent[];
    contextNote?: string;
    successMessage: string;
  }) {
    if (contextSaving) {
      return false;
    }

    setContextSaving(true);
    setFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/tickets", {
        body: JSON.stringify({
          action: "context_update",
          contextAgendaEvents: input.contextAgendaEvents,
          contextNote: input.contextNote,
          ticketId: ticket.id,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        ticket?: {
          metadata?: Record<string, unknown> | null;
        } | null;
      } | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel atualizar o contexto do ticket.",
        );
      }

      const metadata =
        payload?.ticket?.metadata &&
        typeof payload.ticket.metadata === "object" &&
        !Array.isArray(payload.ticket.metadata)
          ? payload.ticket.metadata
          : null;

      onTicketContextUpdated({
        metadata,
        ticketId: ticket.id,
      });

      if (metadata) {
        setContextNoteDraft(readIrisTicketContextNote(metadata)?.text ?? "");
        setContextAgendaEvents(readIrisTicketContextAgendaEvents(metadata));
      }

      setFeedback(input.successMessage);
      return true;
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel atualizar o contexto agora.",
      );
      return false;
    } finally {
      setContextSaving(false);
    }
  }

  async function saveContextNote() {
    await persistTicketContextUpdate({
      contextNote: contextNoteDraft,
      successMessage: "Nota do cliente salva no ticket.",
    });
  }

  async function createContextAgendaEvent() {
    const title = contextAgendaTitleDraft.trim();
    const scheduledAt = normalizeDateTimeInputToIso(contextAgendaDateDraft);

    if (!title) {
      setFeedback("Informe o titulo da atividade para agendar.");
      return;
    }

    if (!scheduledAt) {
      setFeedback("Informe data e hora validas para a agenda.");
      return;
    }

    const nextEvents = sortIrisTicketContextAgendaEvents([
      ...contextAgendaEvents,
      {
        createdAt: new Date().toISOString(),
        createdByLabel: operatorLabel,
        id: `ctx-event-${Date.now()}`,
        kind: "tarefa",
        notes: contextAgendaNotesDraft.trim() || null,
        scheduledAt,
        status: "planned",
        title,
      },
    ]);
    const saved = await persistTicketContextUpdate({
      contextAgendaEvents: nextEvents,
      successMessage: "Atividade registrada na agenda do cliente.",
    });

    if (!saved) {
      return;
    }

    setContextAgendaEvents(nextEvents);
    setContextAgendaTitleDraft("");
    setContextAgendaDateDraft("");
    setContextAgendaNotesDraft("");
    setContextAgendaMonthCursor(startOfMonthIso(scheduledAt));
  }

  async function sendMessage() {
    // Anexo em preview tem prioridade: o rascunho vira a legenda.
    if (attachmentDraft && !editingMessageId && !noteModeActive) {
      await sendAttachmentDraft();
      return;
    }

    const body = draft.trim();

    if (!body || sending || !operationReady) {
      return;
    }

    if (editingMessageId) {
      await saveEditedMessage(body);
      return;
    }

    if (noteModeActive) {
      await sendInternalNote(body);
      return;
    }

    // E-mail: responde pelo Gmail (mesmo thread), não pelo WhatsApp/Meta.
    if (isEmailTicket(ticket)) {
      await sendEmailReply(body);
      return;
    }

    // Grupo: envia pelo gateway Evolution (número observador, membro do grupo).
    // Não passa pelo Meta e não tem janela de 24h.
    if (ticketIsGroup) {
      await sendGroupReply(body);
      return;
    }

    if (!canSendFreeForm) {
      setFeedback(customerServiceWindow.label);
      return;
    }

    setSending(true);
    setFeedback("");

    try {
      const now = new Date().toISOString();
      const optimisticMessage: IrisMessage = {
        body,
        createdAt: now,
        deliveryStatus: "queued",
        direction: "outbound",
        id: `local-${now}`,
        messageType: "text",
        operatorAvatarUrl,
        replyTo: replyToMessage,
        senderLabel: operatorLabel,
        senderType: "operator",
      };

      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/messages", {
        body: JSON.stringify({
          body,
          channelId: ticket.channelId ?? null,
          contactId: ticket.contactId ?? null,
          replyToMessageId: replyToMessage?.messageId ?? null,
          ticketId: ticket.id,
          to: ticket.contactPhone ?? "",
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: Record<string, unknown> | null;
      } | null;

      if (payload?.message) {
        onMessageCreated(
          ticket.id,
          ensureOperatorIdentity(
            mapMessageRow(payload.message),
            operatorLabel,
            operatorAvatarUrl,
          ),
        );
      }

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel enviar pelo WhatsApp.",
        );
      }

      if (!payload?.message) {
        onMessageCreated(ticket.id, optimisticMessage);
      }

      setDraft("");
      setReplyToMessage(null);
      setEmojiPickerOpen(false);
      setFeedback("Mensagem enviada pelo WhatsApp.");
    } catch (error) {
      console.error("[caredesk] nao foi possivel enviar mensagem", error);
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel enviar a mensagem agora.",
      );
    } finally {
      setSending(false);
    }
  }

  // Responder um ticket de e-mail: o servidor envia pelo Gmail (caixa robô caca@),
  // no mesmo thread do cliente. Sem janela de 24h e sem WhatsApp.
  // Toda saída do grupo (texto, imagem, documento, áudio, reação) passa por aqui:
  // vai pelo gateway Evolution, saindo pelo número observador (membro do grupo).
  // Grupo não é ticket — o id da conversa É o id do grupo.
  async function sendGroupRequest(
    payload: Record<string, unknown>,
    errorFallback: string,
  ): Promise<boolean> {
    setSending(true);
    setFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/group-messages", {
        body: JSON.stringify({ ...payload, groupId: ticket.id }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        message?: Record<string, unknown> | null;
      } | null;

      if (data?.message) {
        onMessageCreated(
          ticket.id,
          ensureOperatorIdentity(
            mapMessageRow(data.message),
            operatorLabel,
            operatorAvatarUrl,
          ),
        );
      }

      if (!response.ok) {
        throw new Error(data?.error ?? errorFallback);
      }

      return true;
    } catch (error) {
      console.error("[caredesk] falha na saida para o grupo", error);
      setFeedback(error instanceof Error ? error.message : errorFallback);

      return false;
    } finally {
      setSending(false);
    }
  }

  async function sendGroupReply(body: string) {
    if (!body || sending || !operationReady) {
      return;
    }

    const ok = await sendGroupRequest(
      { body },
      "Nao foi possivel enviar a mensagem ao grupo.",
    );

    if (ok) {
      setDraft("");
      setReplyToMessage(null);
      setEmojiPickerOpen(false);
      setFeedback("Mensagem enviada ao grupo.");
    }
  }

  async function sendEmailReply(body: string) {
    if (!body || sending || !operationReady) {
      return;
    }

    setSending(true);
    setFeedback("");

    try {
      const now = new Date().toISOString();
      const optimisticMessage: IrisMessage = {
        body,
        createdAt: now,
        deliveryStatus: "queued",
        direction: "outbound",
        id: `local-${now}`,
        messageType: "text",
        operatorAvatarUrl,
        senderLabel: operatorLabel,
        senderType: "operator",
      };

      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/tickets/email-reply", {
        body: JSON.stringify({ body, ticketId: ticket.id }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: Record<string, unknown> | null;
      } | null;

      if (payload?.message) {
        onMessageCreated(
          ticket.id,
          ensureOperatorIdentity(
            mapMessageRow(payload.message),
            operatorLabel,
            operatorAvatarUrl,
          ),
        );
      }

      if (!response.ok) {
        throw new Error(payload?.error ?? "Nao foi possivel enviar o e-mail.");
      }

      if (!payload?.message) {
        onMessageCreated(ticket.id, optimisticMessage);
      }

      setDraft("");
      setReplyToMessage(null);
      setEmojiPickerOpen(false);
      setFeedback("E-mail enviado.");
    } catch (error) {
      console.error("[caredesk] nao foi possivel enviar e-mail", error);
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel enviar o e-mail agora.",
      );
    } finally {
      setSending(false);
    }
  }

  // Responder como Cacá: o operador escreve, mas o servidor de produção envia
  // assinado como Cacá e registra como automação dela (sem reatribuir o ticket).
  async function handleSendAsCaca(text: string) {
    const value = text.trim();

    if (!value || sendingAsCaca) {
      return;
    }

    setSendingAsCaca(true);
    setFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/tickets/caca-reply", {
        body: JSON.stringify({ body: value, ticketId: ticket.id }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: Record<string, unknown> | null;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Nao foi possivel enviar como Caca.");
      }

      if (payload?.message) {
        onMessageCreated(
          ticket.id,
          ensureOperatorIdentity(mapMessageRow(payload.message), "Cacá", null),
        );
      }

      setFeedback("Mensagem enviada como Caca.");
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel enviar como Caca.",
      );
    } finally {
      setSendingAsCaca(false);
    }
  }

  async function sendInternalNote(body: string) {
    if (!body || sending || !operationReady) {
      return;
    }

    setSending(true);
    setFeedback("");

    try {
      const now = new Date().toISOString();
      const optimisticNote: IrisMessage = {
        body,
        createdAt: now,
        deliveryStatus: "sent",
        direction: "internal",
        id: `local-note-${now}`,
        messageType: "note",
        operatorAvatarUrl,
        senderLabel: operatorLabel,
        senderType: "operator",
      };

      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/notes", {
        body: JSON.stringify({
          body,
          channelId: ticket.channelId ?? null,
          ticketId: ticket.id,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: Record<string, unknown> | null;
      } | null;

      if (payload?.message) {
        onMessageCreated(
          ticket.id,
          ensureOperatorIdentity(
            mapMessageRow(payload.message),
            operatorLabel,
            operatorAvatarUrl,
          ),
        );
      }

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel registrar a nota interna.",
        );
      }

      if (!payload?.message) {
        onMessageCreated(ticket.id, optimisticNote);
      }

      setDraft("");
      setReplyToMessage(null);
      setEmojiPickerOpen(false);
      setFeedback("Mensagem assistida registrada.");
    } catch (error) {
      console.error("[caredesk] nao foi possivel registrar nota interna", error);
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel registrar a nota agora.",
      );
    } finally {
      setSending(false);
    }
  }

  async function saveEditedMessage(body: string) {
    if (!editingMessageId || sending) {
      return;
    }

    // Grupo sai pelo gateway Evolution: editar ainda nao passa por la.
    if (ticketIsGroup) {
      setFeedback("Em grupo ainda nao da para editar a mensagem pela Iris.");
      return;
    }

    setSending(true);
    setFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/messages", {
        body: JSON.stringify({
          action: "edit",
          body,
          messageId: editingMessageId,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: Record<string, unknown> | null;
      } | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel editar a mensagem.",
        );
      }

      if (payload?.message) {
        onMessageUpdated(
          ticket.id,
          ensureOperatorIdentity(
            mapMessageRow(payload.message),
            operatorLabel,
            operatorAvatarUrl,
          ),
        );
      }

      setDraft("");
      setEditingMessageId(null);
      setEmojiPickerOpen(false);
      setFeedback("Mensagem atualizada no Iris.");
    } catch (error) {
      console.error("[caredesk] nao foi possivel editar mensagem", error);
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel editar a mensagem agora.",
      );
    } finally {
      setSending(false);
    }
  }

  async function sendExistingLocalMessage(message: IrisMessage) {
    // Reparo de mensagem local so existe no caminho do Meta.
    if (ticketIsGroup) {
      return;
    }

    repairingOutboundMessageIds.current.add(message.id);
    setSending(true);
    setFeedback("Sincronizando mensagem local com o WhatsApp.");

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/messages", {
        body: JSON.stringify({
          body: message.body,
          channelId: ticket.channelId ?? null,
          contactId: ticket.contactId ?? null,
          messageId: message.id,
          ticketId: ticket.id,
          to: ticket.contactPhone ?? "",
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: Record<string, unknown> | null;
      } | null;

      if (payload?.message) {
        onMessageCreated(
          ticket.id,
          ensureOperatorIdentity(
            mapMessageRow(payload.message),
            operatorLabel,
            operatorAvatarUrl,
          ),
        );
      }

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel enviar pelo WhatsApp.",
        );
      }

      setFeedback("Mensagem sincronizada e enviada pelo WhatsApp.");
    } catch (error) {
      console.error("[caredesk] nao foi possivel sincronizar mensagem", error);
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel sincronizar a mensagem local.",
      );
    } finally {
      setSending(false);
    }
  }

  async function reactToMessage(message: IrisMessage, emoji: string) {
    if (sending || !operationReady) {
      return;
    }

    // Reação é recurso do WhatsApp (Meta). E-mail não tem.
    if (isEmailTicket(ticket)) {
      return;
    }

    // Grupo: reage pelo gateway Evolution, não pelo Meta.
    if (ticketIsGroup) {
      await sendGroupRequest(
        { action: "react", emoji, messageId: message.id },
        "Não foi possível reagir no grupo.",
      );
      return;
    }

    if (!canSendFreeForm) {
      setFeedback(customerServiceWindow.label);
      return;
    }

    setFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/messages", {
        body: JSON.stringify({
          action: "react",
          emoji,
          messageId: message.id,
          ticketId: ticket.id,
          to: ticket.contactPhone ?? "",
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: Record<string, unknown> | null;
      } | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel reagir a mensagem.",
        );
      }

      if (payload?.message) {
        onMessageUpdated(
          ticket.id,
          ensureOperatorIdentity(
            mapMessageRow(payload.message),
            operatorLabel,
            operatorAvatarUrl,
          ),
        );
      }
    } catch (error) {
      console.error("[caredesk] nao foi possivel reagir", error);
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel reagir a mensagem agora.",
      );
    }
  }

  function prepareReply(message: IrisMessage) {
    setReplyToMessage(createReplyPreview(message));
    setEditingMessageId(null);
    setEmojiPickerOpen(false);
    window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
  }

  function prepareEdit(message: IrisMessage) {
    if (message.direction !== "outbound" || message.senderType !== "operator") {
      return;
    }

    // Não dá pra "editar" um e-mail já enviado (o edit da Iris é do WhatsApp/Meta).
    if (isEmailTicket(ticket)) {
      return;
    }

    setDraft(message.body);
    setEditingMessageId(message.id);
    setReplyToMessage(null);
    setEmojiPickerOpen(false);
    window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
  }

  function cancelComposerContext() {
    setEditingMessageId(null);
    setReplyToMessage(null);
    setEmojiPickerOpen(false);
  }

  function insertEmoji(emoji: string) {
    setDraft((current) => `${current}${emoji}`);
    window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
  }

  function handleComposerKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();

    if (
      (!draft.trim() && !attachmentDraft) ||
      sending ||
      !composerReady ||
      recordingAudio
    ) {
      return;
    }

    void sendMessage();
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function stopAudioRecording() {
    if (!recordingAudio) {
      return;
    }

    mediaRecorderRef.current?.stop();
  }

  function discardAudioPreview() {
    setAudioPreview((current) => {
      if (current) {
        URL.revokeObjectURL(current.url);
      }

      return null;
    });
  }

  // Cancela a gravação em curso (descarta) ou o preview ainda não enviado.
  function cancelAudioRecording() {
    if (recordingAudio) {
      audioCancelledRef.current = true;
      mediaRecorderRef.current?.stop();
      return;
    }

    discardAudioPreview();
  }

  function sendRecordedAudio() {
    if (!audioPreview) {
      return;
    }

    const { blob, durationMs, url } = audioPreview;

    URL.revokeObjectURL(url);
    setAudioPreview(null);
    void sendAudioMessage(blob, durationMs);
  }

  async function startAudioRecording() {
    if (sending || recordingAudio || audioPreview) {
      return;
    }

    if (!canSendFreeForm) {
      setFeedback(customerServiceWindow.label);
      return;
    }

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setFeedback("Gravacao de audio indisponivel neste navegador.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      audioCancelledRef.current = false;
      audioChunksRef.current = [];
      audioStartedAtRef.current = Date.now();
      mediaRecorderRef.current = recorder;
      setRecordingElapsedMs(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const chunks = [...audioChunksRef.current];
        const durationMs = audioStartedAtRef.current
          ? Date.now() - audioStartedAtRef.current
          : null;

        stream.getTracks().forEach((track) => track.stop());
        clearRecordingTimer();
        setRecordingAudio(false);
        mediaRecorderRef.current = null;
        audioStartedAtRef.current = null;
        audioChunksRef.current = [];

        if (audioCancelledRef.current || !chunks.length) {
          audioCancelledRef.current = false;
          return;
        }

        // Em vez de enviar direto, monta um preview pro operador ouvir antes (igual WhatsApp).
        const audioBlob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });

        setAudioPreview({
          blob: audioBlob,
          durationMs,
          url: URL.createObjectURL(audioBlob),
        });
      };
      recorder.start();
      setRecordingAudio(true);
      setFeedback("");
      recordingTimerRef.current = setInterval(() => {
        if (audioStartedAtRef.current) {
          setRecordingElapsedMs(Date.now() - audioStartedAtRef.current);
        }
      }, 200);
    } catch (error) {
      console.error("[caredesk] microfone indisponivel", error);
      setRecordingAudio(false);
      clearRecordingTimer();
      setFeedback("Nao foi possivel acessar o microfone.");
    }
  }

  async function sendAudioMessage(audioBlob: Blob, durationMs: number | null) {
    if (sending) {
      return;
    }

    // Grupo nao tem janela de 24h (o gate dela e do Meta).
    if (!ticketIsGroup && !canSendFreeForm) {
      setFeedback(customerServiceWindow.label);
      return;
    }

    if (audioBlob.size <= 0) {
      setFeedback("Audio vazio. Grave novamente.");
      return;
    }

    setSending(true);
    setFeedback("");

    try {
      // O WhatsApp rejeita webm (formato do Chrome); converte pra mp3 quando necessario.
      const sourceMime = audioBlob.type || "audio/webm";
      let outboundBlob = audioBlob;
      let outboundMime = sourceMime;

      if (audioNeedsTranscode(sourceMime)) {
        setFeedback("Convertendo audio...");
        outboundBlob = await transcodeAudioToMp3(audioBlob);
        outboundMime = "audio/mpeg";
        setFeedback("");
      }

      const outboundExt = audioExtensionForMime(outboundMime);
      const dataUrl = await readBlobAsDataUrl(outboundBlob);

      if (dataUrl.length > IRIS_AUDIO_MAX_DATA_URL_LENGTH) {
        throw new Error("Audio muito grande para este recorte de homologacao.");
      }

      const audioMedia = {
        dataUrl,
        durationMs,
        fileName: `iris-audio-${Date.now()}.${outboundExt}`,
        mimeType: outboundMime,
        type: "audio" as const,
      };

      // Grupo: audio vai pelo gateway Evolution, nao pelo Meta.
      if (ticketIsGroup) {
        const ok = await sendGroupRequest(
          { body: "", media: audioMedia },
          "Nao foi possivel enviar o audio ao grupo.",
        );

        if (ok) {
          setReplyToMessage(null);
          setFeedback("Audio enviado ao grupo.");
        }

        return;
      }

      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/messages", {
        body: JSON.stringify({
          body: "Audio WhatsApp",
          channelId: ticket.channelId ?? null,
          contactId: ticket.contactId ?? null,
          media: audioMedia,
          replyToMessageId: replyToMessage?.messageId ?? null,
          ticketId: ticket.id,
          to: ticket.contactPhone ?? "",
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: Record<string, unknown> | null;
      } | null;

      if (payload?.message) {
        onMessageCreated(
          ticket.id,
          ensureOperatorIdentity(
            mapMessageRow(payload.message),
            operatorLabel,
            operatorAvatarUrl,
          ),
        );
      }

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel enviar audio pelo WhatsApp.",
        );
      }

      setReplyToMessage(null);
      setFeedback("Audio enviado pelo WhatsApp.");
    } catch (error) {
      console.error("[caredesk] nao foi possivel enviar audio", error);
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel enviar o audio agora.",
      );
    } finally {
      setSending(false);
    }
  }

  // Escolhe/valida um anexo (foto, print, arquivo) — sem enviar ainda: fica em preview
  // no compositor, com o rascunho servindo de legenda opcional.
  function handlePickAttachment(file: File | null | undefined) {
    if (!file) {
      return;
    }

    // Anexo (incl. print colado) ainda não é suportado no e-mail (MVP outbound = texto).
    if (isEmailTicket(ticket)) {
      setFeedback("Anexo ainda não disponível no e-mail.");
      return;
    }

    const isImage = file.type.startsWith("image/");
    const isDoc = IRIS_ATTACHMENT_DOC_TYPES.has(file.type);

    if (!isImage && !isDoc) {
      setFeedback(
        "Tipo de arquivo nao suportado. Envie imagem, PDF, Office ou texto.",
      );
      return;
    }

    if (!isImage && file.size > IRIS_ATTACHMENT_MAX_BYTES) {
      setFeedback("Arquivo muito grande (maximo ~3MB).");
      return;
    }

    setAttachmentDraft((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }

      return {
        file,
        fileName: file.name || (isImage ? "imagem" : "documento"),
        kind: isImage ? "image" : "document",
        previewUrl: isImage ? URL.createObjectURL(file) : null,
      };
    });
    setFeedback("");
    window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
  }

  function cancelAttachment() {
    setAttachmentDraft((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }

      return null;
    });
  }

  // Colar (Ctrl+V) uma imagem/print direto no compositor vira anexo.
  function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = event.clipboardData?.items;

    if (!items) {
      return;
    }

    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();

        if (file) {
          event.preventDefault();
          handlePickAttachment(file);
          return;
        }
      }
    }
  }

  async function sendAttachmentDraft() {
    if (!attachmentDraft || sending) {
      return;
    }

    if (!canSendFreeForm) {
      setFeedback(customerServiceWindow.label);
      return;
    }

    const { file, kind } = attachmentDraft;
    const caption = draft.trim();

    // Otimista: limpa o preview e o rascunho já; erro volta no feedback.
    cancelAttachment();
    setDraft("");
    await sendAttachmentMessage(file, kind, caption);
  }

  async function sendAttachmentMessage(
    file: File,
    kind: "document" | "image",
    caption: string,
  ) {
    setSending(true);
    setFeedback("");

    try {
      let dataUrl: string;
      let mimeType = file.type;
      let fileName = file.name || (kind === "image" ? "imagem.jpg" : "documento");

      if (kind === "image") {
        // Reduz imagem grande no cliente pra caber no body da requisição.
        const prepared = await prepareOutboundImage(file);
        dataUrl = prepared.dataUrl;
        mimeType = prepared.mimeType;
        fileName = prepared.fileName;
      } else {
        dataUrl = await readBlobAsDataUrl(file);
      }

      if (dataUrl.length > IRIS_AUDIO_MAX_DATA_URL_LENGTH) {
        throw new Error("Arquivo muito grande para enviar. Reduza o tamanho.");
      }

      // Grupo: anexo vai pelo gateway Evolution, nao pelo Meta.
      if (ticketIsGroup) {
        const ok = await sendGroupRequest(
          { body: caption, media: { dataUrl, fileName, mimeType, type: kind } },
          "Nao foi possivel enviar o anexo ao grupo.",
        );

        if (ok) {
          setReplyToMessage(null);
          setFeedback(
            kind === "image"
              ? "Imagem enviada ao grupo."
              : "Documento enviado ao grupo.",
          );
        }

        return;
      }

      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/messages", {
        body: JSON.stringify({
          body: caption,
          channelId: ticket.channelId ?? null,
          contactId: ticket.contactId ?? null,
          media: { dataUrl, fileName, mimeType, type: kind },
          replyToMessageId: replyToMessage?.messageId ?? null,
          ticketId: ticket.id,
          to: ticket.contactPhone ?? "",
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: Record<string, unknown> | null;
      } | null;

      if (payload?.message) {
        onMessageCreated(
          ticket.id,
          ensureOperatorIdentity(
            mapMessageRow(payload.message),
            operatorLabel,
            operatorAvatarUrl,
          ),
        );
      }

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel enviar o anexo pelo WhatsApp.",
        );
      }

      setReplyToMessage(null);
      setFeedback(
        kind === "image"
          ? "Imagem enviada pelo WhatsApp."
          : "Documento enviado pelo WhatsApp.",
      );
    } catch (error) {
      console.error("[caredesk] nao foi possivel enviar anexo", error);
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel enviar o anexo agora.",
      );
    } finally {
      setSending(false);
    }
  }

  const irisConversationReadOnlyRenderers: IrisConversationReadOnlyRenderers = {
    renderContactAvatar: (ticket, size) => (
      <ContactAvatar size={size} ticket={ticket} />
    ),
    renderMessageBubble: ({ message, ticket }) => (
      <MessageBubble
        message={message}
        onAskAthena={askAthenaAboutMessage}
        onEdit={prepareEdit}
        onReact={reactToMessage}
        onReply={prepareReply}
        ticket={ticket}
      />
    ),
    renderTicketSeparator: (separatorTicket, compact) => (
      <TicketSeparator
        ticket={separatorTicket}
        compact={compact}
        subject={compact ? undefined : attendanceSubject}
        subjectOptions={compact ? undefined : subjectCatalog}
        onSubjectChange={compact ? undefined : setAttendanceSubject}
      />
    ),
  };

  return (
    <section className="relative flex h-full min-h-0 w-full overflow-hidden rounded-xl border border-line/70 bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <IrisConversationInboxSidebar
        channelFilter={conversationChannel}
        cobrancaMode={cobrancaMode}
        collapsed={conversationListCollapsed}
        conversations={conversations}
        filter={conversationFilter}
        helpers={irisConversationReadOnlyHelpers}
        onChannelFilterChange={setConversationChannel}
        onCollapseChange={setConversationListCollapsed}
        onFilterChange={setConversationFilter}
        onSearchChange={setSearch}
        onSelectTicket={onSelectTicket}
        renderers={irisConversationReadOnlyRenderers}
        search={search}
        selectedTicketId={selectedTicketId}
      />

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
        <header className="shrink-0 border-b border-line bg-surface">
          <div className="flex flex-col gap-2 px-4 py-2.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <ContactAvatar ticket={ticket} size="md" />
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-ink">
                  {/* Prefere o nome COMPLETO do Apolo (mesma fonte do painel Cliente,
                      apoloContextEntity) — o phone-match leve às vezes não casa e o
                      header caía pro display_name do WhatsApp (ex.: só "Aguiar"). */}
                  {capitalizeName(apoloContextEntity?.displayName) ||
                    ticketContactLabel(ticket)}
                </h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-ink-muted">
                  <span>{ticket.protocol}</span>
                  {/* Grupo nao tem status de atendimento (nao abre nem encerra). */}
                  {!ticketIsGroup ? (
                    <>
                      <span aria-hidden="true">-</span>
                      <span>{statusLabel[ticketStatus]}</span>
                    </>
                  ) : null}
                  <span aria-hidden="true">·</span>
                  {ticketIsEmail ? (
                    <EmailChannelChip
                      boxLabel={emailBoxLabel(ticket.channelLabel)}
                    />
                  ) : (
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${queueChipClasses(
                        ticket.queueLabel,
                      )}`}
                    >
                      {ticket.queueLabel}
                    </span>
                  )}
                  {contactProfileLabel ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span
                        title={
                          contactDelinquency === "inadimplente"
                            ? "Comprador inadimplente"
                            : contactDelinquency === "adimplente"
                              ? "Comprador adimplente"
                              : undefined
                        }
                        className={[
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1",
                          contactDelinquency === "inadimplente"
                            ? "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/12 dark:text-rose-300 dark:ring-rose-500/25"
                            : contactDelinquency === "adimplente"
                              ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/12 dark:text-emerald-300 dark:ring-emerald-500/25"
                              : "bg-subtle text-ink-soft ring-slate-200 dark:ring-white/10",
                        ].join(" ")}
                      >
                        {contactProfileLabel.toLowerCase()}
                      </span>
                    </>
                  ) : null}
                  {cobrancaMode && ticket.contactPhone ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-ink">
                        {ticket.contactPhone}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-2 xl:justify-end">
              {cobrancaMode ? (
                <label className="hidden h-9 max-w-full items-center gap-2 rounded-lg border border-line/70 bg-subtle/70 px-2 text-xs font-semibold text-ink-soft sm:inline-flex">
                  <span className="shrink-0">Assunto</span>
                  <select
                    value={cobrancaAssunto(ticket.profileLabel)}
                    disabled
                    className="h-6 max-w-52 bg-transparent text-xs font-semibold text-ink outline-none"
                    aria-label="Assunto do atendimento"
                  >
                    <option>{cobrancaAssunto(ticket.profileLabel)}</option>
                  </select>
                </label>
              ) : null}
              {cobrancaMode && cobrancaClientId && renderCobrancaProposal ? (
                <Tooltip content="Registrar acordo / promessa" placement="bottom">
                  <button
                    type="button"
                    onClick={() => setProposalSignal((current) => current + 1)}
                    aria-label="Registrar acordo ou promessa"
                    className="inline-flex size-9 items-center justify-center rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/8 text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/12"
                  >
                    <HandCoins className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
              ) : null}
              {/* Grupo não é atendimento: não se transfere nem se encerra. */}
              {!ticketIsGroup ? (
                <>
                  <Tooltip
                    content="Direcionar / transferir atendimento"
                    placement="bottom"
                  >
                    <button
                      type="button"
                      onClick={() => setTransferModalOpen(true)}
                      disabled={ticketClosed || transferring}
                      aria-label="Direcionar / transferir atendimento"
                      className="inline-flex size-9 items-center justify-center rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/8 text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/12 disabled:cursor-not-allowed disabled:border-line disabled:bg-subtle disabled:text-ink-muted"
                    >
                      <Forward className="size-4" aria-hidden="true" />
                    </button>
                  </Tooltip>
                  <Tooltip
                    content={
                      ticketClosed
                        ? cobrancaMode
                          ? "Atendimento encerrado"
                          : "Chat encerrado"
                        : closingTicket
                          ? cobrancaMode
                            ? "Encerrando atendimento..."
                            : "Encerrando chat..."
                          : cobrancaMode
                            ? "Encerrar atendimento"
                            : "Encerrar chat"
                    }
                    placement="bottom"
                  >
                    <button
                      type="button"
                      onClick={() => setCloseModalOpen(true)}
                      disabled={ticketClosed || closingTicket}
                      aria-label={
                        ticketClosed
                          ? cobrancaMode
                            ? "Atendimento encerrado"
                            : "Chat encerrado"
                          : closingTicket
                            ? cobrancaMode
                              ? "Encerrando atendimento"
                              : "Encerrando chat"
                            : cobrancaMode
                              ? "Encerrar atendimento"
                              : "Encerrar chat"
                      }
                      className="inline-flex size-9 items-center justify-center rounded-lg border border-rose-200/70 bg-rose-50/70 text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-line disabled:bg-subtle disabled:text-ink-muted"
                    >
                      <CircleStop className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </Tooltip>
                </>
              ) : null}
              <div className="flex w-fit items-center gap-1 rounded-lg border border-line/70 bg-surface p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <Tooltip content="Voltar" placement="bottom">
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Voltar para o board"
                    className="flex size-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-subtle hover:text-[#7A5E2C]"
                  >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
            </div>
          </div>
        </header>

        {feedback ? (
          <div className="mx-4 mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            {feedback}
          </div>
        ) : null}

        {ticketIsEmail ? <IrisEmailThreadHeader ticket={ticket} /> : null}

        {/* Athena do Hades agora cobre tambem o atendimento (ver IrisAthenaPanel abaixo). */}
        {false ? (
          <IrisAttendantPanel
            disabled={ticketClosed}
            documentFragment={attendantDocumentFragment}
            documentPosition={attendantDocumentPosition}
            feedback={attendantFeedback}
            loading={attendantLoading}
            onAnalyze={() => void runIrisAttendant()}
            onClose={() => setAttendantOpen(false)}
            onDocumentFragmentChange={setAttendantDocumentFragment}
            onDocumentPositionChange={setAttendantDocumentPosition}
            onPromptChange={setAttendantPrompt}
            onSelectBillingItem={(item) => void runIrisAttendant(item.id)}
            onUseReply={useAttendantReplyAsDraft}
            prompt={attendantPrompt}
            result={attendantResult}
          />
        ) : null}

        <IrisConversationMessagesTimeline
          onTogglePreviousTickets={() =>
            setShowPreviousTickets((current) => !current)
          }
          previousTickets={previousTickets}
          renderers={irisConversationReadOnlyRenderers}
          showPreviousTickets={showPreviousTickets}
          ticket={ticket}
          viewportRef={messagesViewportRef}
        />

        <IrisConversationComposerActions
          agendaContext={{
            clientC2xId: readTicketCobrancaC2xId(ticket.metadata),
            clientName: ticket.contactLabel,
            module: cobrancaMode ? "hades" : "iris",
            protocol: ticket.protocol,
          }}
          attendantOpen={attendantOpen}
          blockedTooltip={blockedTooltip}
          canSendFreeForm={canSendFreeForm}
          channelKind={
            ticketIsEmail ? "email" : ticketIsGroup ? "group" : "whatsapp"
          }
          cobrancaMode={cobrancaMode}
          composerMode={effectiveComposerMode}
          composerReady={composerReadyForMode}
          mustWhisper={mustWhisper}
          onComposerModeChange={setComposerMode}
          onToggleAttendant={() => setAttendantOpen((current) => !current)}
          customerServiceWindow={
            customerServiceWindow as IrisConversationComposerWindow
          }
          draft={draft}
          editingMessageBody={editingMessage?.body}
          emojiOptions={IRIS_EMOJI_OPTIONS}
          emojiPickerOpen={emojiPickerOpen}
          emojiPickerRef={emojiPickerRef}
          lockedByCaca={attendanceWithCaca}
          onSendAsCaca={
            canReplyAsCaca(hubUser?.id) ? handleSendAsCaca : undefined
          }
          sendingAsCaca={sendingAsCaca}
          onOpenNotes={() => setNotesModalOpen(true)}
          onCancelComposerContext={cancelComposerContext}
          onComposerKeyDown={handleComposerKeyDown}
          onDraftChange={setDraft}
          onInsertEmoji={insertEmoji}
          onSendMessage={sendMessage}
          onStartAudioRecording={startAudioRecording}
          onStopAudioRecording={stopAudioRecording}
          onCancelAudio={cancelAudioRecording}
          onSendAudioPreview={sendRecordedAudio}
          audioPreviewUrl={audioPreview?.url ?? null}
          attachmentInputAccept={IRIS_ATTACHMENT_INPUT_ACCEPT}
          attachmentPreview={
            attachmentDraft
              ? {
                  fileName: attachmentDraft.fileName,
                  kind: attachmentDraft.kind,
                  previewUrl: attachmentDraft.previewUrl,
                }
              : null
          }
          hasAttachment={Boolean(attachmentDraft)}
          onPickAttachment={handlePickAttachment}
          onCancelAttachment={cancelAttachment}
          onComposerPaste={handleComposerPaste}
          recordingElapsedLabel={formatAudioDuration(recordingElapsedMs)}
          onToggleEmojiPicker={() => setEmojiPickerOpen((current) => !current)}
          operationReady={operationReady}
          recordingAudio={recordingAudio}
          replyToMessageBody={replyToMessage?.body}
          sending={sending}
          textareaRef={composerTextareaRef}
          ticketChecklist={ticketChecklist}
          ticketClosed={ticketClosed}
        />

        {attendantOpen ? (
          <div className="absolute bottom-[84px] right-3 z-30 w-[380px] max-w-[calc(100%-1.5rem)]">
            <IrisAthenaPanel
              cobrancaMode={cobrancaMode}
              contextMessage={athenaContextMessage}
              disabled={ticketClosed}
              loading={athenaLoading}
              onClearContext={() => setAthenaContextMessage(null)}
              onClose={() => {
                setAttendantOpen(false);
                setAthenaContextMessage(null);
              }}
              onPromptChange={setAthenaPrompt}
              onSend={(action, promptOverride, audioUrl) =>
                void runAthena(action, promptOverride, audioUrl)
              }
              onTranscribe={transcribeAudio}
              onUseReply={(text) => insertDraftText(text)}
              prompt={athenaPrompt}
              thread={athenaThread}
            />
          </div>
        ) : null}
      </main>

      {cobrancaMode ? (
        <IrisCobrancaContextSidebar
          clienteFields={[
            { label: "Cliente", value: irisConversationReadOnlyHelpers.crm360ContextLabel(ticket.crm360Registration) },
            {
              label: "Telefone",
              value: ticket.contactPhone ? (
                <span className="inline-flex items-center gap-1.5">
                  <PhoneFlag phone={ticket.contactPhone} />
                  {ticket.contactPhone}
                </span>
              ) : (
                "-"
              ),
            },
            { label: "CPF/CNPJ", value: ticket.contactDocument ?? "-" },
            { label: "E-mail", value: ticket.contactEmail ?? "-" },
            { label: "Fila", value: ticket.queueLabel },
            { label: "Operador", value: ticket.assignedToLabel },
            { label: "Assunto", value: cobrancaAssunto(ticket.profileLabel) },
            { label: "SLA", value: irisConversationReadOnlyHelpers.slaLabel(ticket) },
            { label: "Prioridade", value: irisConversationReadOnlyHelpers.priorityLabel[ticket.priority] },
            { label: "Origem", value: ticket.sourceLabel },
            { label: "Canal", value: irisConversationReadOnlyHelpers.formatIrisChannelLabel(ticket.channelLabel) },
            { label: "Janela WhatsApp", value: customerServiceWindow.contextLabel },
          ]}
          clientId={cobrancaClientId}
          collapsed={contextCollapsed}
          currentTicketId={ticket.id}
          formatDateTime={irisConversationReadOnlyHelpers.formatDateTime}
          note={ticketContextNote}
          onInsertDraftText={insertDraftText}
          onSelectTicket={onSelectTicket}
          onToggleCollapsed={() => setContextCollapsed((current) => !current)}
          proposalOpenSignal={proposalSignal}
          renderProposal={renderCobrancaProposal ?? undefined}
          tickets={[
            ticket,
            ...previousTickets.filter((item) => item.id !== ticket.id),
          ].map((item) => ({
            id: item.id,
            closedAt: item.closedAt ?? item.resolvedAt,
            openedAt: item.openedAt,
            operator: item.assignedToLabel,
            protocol: item.protocol,
            status: item.status,
            subject: cobrancaAssunto(item.subject),
          }))}
        />
      ) : (
        <IrisCobrancaContextSidebar
          apoloEntity={apoloContextEntity}
          clienteFields={
            // Grupo nao tem cliente/CPF/operador: mostra o que e do grupo.
            ticketIsGroup
              ? [
                  {
                    label: "Grupo",
                    value: ticket.subject?.trim() || ticket.contactLabel,
                  },
                  { label: "Código", value: ticket.protocol },
                  {
                    label: "Participantes",
                    value:
                      typeof ticket.metadata?.participantsCount === "number"
                        ? String(ticket.metadata.participantsCount)
                        : "-",
                  },
                  { label: "Canal", value: "WhatsApp · Grupo" },
                ]
              : [
            {
              label: "Cliente",
              value:
                capitalizeName(apoloContextEntity?.displayName) ||
                capitalizeName(ticket.crm360Registration?.label) ||
                "-",
            },
            ...(ticket.crm360Registration?.relationLabel
              ? [
                  {
                    label: "Imobiliária",
                    value: capitalizeName(
                      ticket.crm360Registration.relationLabel,
                    ),
                  },
                ]
              : []),
            {
              label: "Telefone",
              value: ticket.contactPhone ? (
                <span className="inline-flex items-center gap-1.5">
                  <PhoneFlag phone={ticket.contactPhone} />
                  {formatPhoneForDisplay(ticket.contactPhone)}
                </span>
              ) : (
                "-"
              ),
            },
            {
              label: "CPF/CNPJ",
              value:
                apoloContextEntity?.documentMasked?.trim() ||
                ticket.contactDocument ||
                "-",
            },
            {
              label: "E-mail",
              value:
                ticket.contactEmail ||
                apoloContextEntity?.contacts?.find(
                  (contact) => contact.type === "email" && contact.value,
                )?.value ||
                "-",
            },
            { label: "Operador", value: ticket.assignedToLabel },
            {
              label: "Assunto",
              value: attendanceSubject.trim() || ticket.subject?.trim() || "-",
            },
            {
              label: "Origem",
              value: ticketOrigin(ticket) === "active" ? "Ativo" : "Passivo",
            },
            {
              label: "Canal",
              value: ticketIsEmail
                ? "E-mail"
                : ticketIsGroup
                  ? "WhatsApp · Grupo"
                  : "WhatsApp",
            },
            ...(ticketIsEmail || ticketIsGroup
              ? []
              : [
                  {
                    label: "Janela WhatsApp",
                    value: customerServiceWindow.contextLabel,
                  },
                ]),
                ]
          }
          clientId={null}
          collapsed={contextCollapsed}
          currentTicketId={ticket.id}
          formatDateTime={irisConversationReadOnlyHelpers.formatDateTime}
          mode="atendimento"
          note={ticketContextNote}
          onInsertDraftText={insertDraftText}
          onSelectTicket={onSelectTicket}
          onToggleCollapsed={() => setContextCollapsed((current) => !current)}
          tickets={[
            ticket,
            ...previousTickets.filter((item) => item.id !== ticket.id),
          ].map((item) => ({
            id: item.id,
            closedAt: item.closedAt ?? item.resolvedAt,
            openedAt: item.openedAt,
            operator: item.assignedToLabel,
            protocol: item.protocol,
            status: item.status,
            subject: item.subject,
          }))}
        />
      )}

      {closeModalOpen ? (
        <IrisCobrancaCloseModal
          currentSubject={attendanceSubject || ticket.subject}
          protocol={ticket.protocol}
          submitting={closingTicket}
          onCancel={() => setCloseModalOpen(false)}
          onConfirm={({ note, reason, subject }) =>
            void performClose({
              closeReason: note || undefined,
              motivo: reason || undefined,
              subject: subject || undefined,
            })
          }
        />
      ) : null}
      {transferModalOpen ? (
        <IrisCobrancaTransferModal
          submitting={transferring}
          onCancel={() => setTransferModalOpen(false)}
          onConfirm={(input) => void transferTicket(input)}
        />
      ) : null}

      {notesModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-[2px]">
          <button
            type="button"
            aria-label="Fechar notas"
            onClick={() => setNotesModalOpen(false)}
            className="absolute inset-0 cursor-default"
          />
          <section className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-[0_24px_90px_rgba(15,23,42,0.24)]">
            <header className="border-b border-line px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                Atendimento {ticket.protocol}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-ink">
                Nota do atendimento
              </h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Fica registrada no ticket, visivel pra equipe.
              </p>
            </header>
            <div className="px-5 py-4">
              <textarea
                value={contextNoteDraft}
                onChange={(event) => setContextNoteDraft(event.target.value)}
                rows={5}
                placeholder="Escreva uma observacao sobre este atendimento..."
                className="w-full resize-none rounded-xl border border-line/70 bg-subtle/60 px-3 py-2 text-sm text-ink outline-none focus:border-[#A07C3B]/40"
              />
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
              <button
                type="button"
                onClick={() => setNotesModalOpen(false)}
                className="inline-flex h-9 items-center rounded-lg border border-line/70 bg-surface px-3 text-sm font-semibold text-ink-soft transition-colors hover:bg-subtle"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  void saveContextNote();
                  setNotesModalOpen(false);
                }}
                className="inline-flex h-9 items-center rounded-lg bg-[#A07C3B] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35]"
              >
                Salvar nota
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {contextModalMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-[2px]">
          <button
            type="button"
            aria-label="Fechar popup de contexto"
            onClick={() => setContextModalMode(null)}
            className="absolute inset-0 cursor-default"
          />
          <section className="relative z-10 flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-[0_24px_90px_rgba(15,23,42,0.24)]">
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                  Contexto do cliente
                </p>
                <h2 className="mt-1 text-lg font-semibold text-ink">
                  {contextModalMode === "client"
                    ? "Dados do cliente e nota interna"
                    : "Agenda mensal e atividades"}
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  {contextModalMode === "client"
                    ? "Dados vindos do Apolo e anotacoes do operador para continuidade do atendimento."
                    : "Visual mensal da agenda com criacao de tarefas do cliente."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setContextModalMode(null)}
                aria-label="Fechar popup"
                className="flex size-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </header>

            {contextModalMode === "client" ? (
              <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 xl:grid-cols-[minmax(0,1fr)_340px] [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
                <div className="space-y-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-normal text-ink-muted">
                      Dados Apolo
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void loadApoloContext();
                      }}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[11px] font-semibold text-ink-soft transition-colors hover:border-[#A07C3B]/30 hover:text-[#7A5E2C]"
                    >
                      <RefreshCw
                        className={`size-3 ${apoloContextLoading ? "animate-spin" : ""}`}
                        aria-hidden="true"
                      />
                      Atualizar
                    </button>
                  </div>

                  {apoloContextLoading ? (
                    <p className="rounded-lg border border-line/70 bg-subtle px-3 py-2 text-xs font-semibold text-ink-muted">
                      Carregando dados do Apolo...
                    </p>
                  ) : null}

                  {!apoloContextLoading && apoloContextError ? (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                      {apoloContextError}
                    </p>
                  ) : null}

                  {!apoloContextLoading &&
                  !apoloContextError &&
                  !apoloContextEntity ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      Cliente ainda nao localizado no Apolo para este contato.
                    </p>
                  ) : null}

                  {!apoloContextLoading &&
                  !apoloContextError &&
                  apoloContextEntity ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <ContextItem
                        label="Nome"
                        value={
                          apoloContextEntity.displayName?.trim() || "Sem nome"
                        }
                      />
                      <ContextItem
                        label="Documento"
                        value={apoloContextEntity.documentMasked?.trim() || "-"}
                      />
                      <ContextItem
                        label="Perfis"
                        value={formatIrisApoloProfiles(
                          apoloContextEntity.profiles,
                        )}
                      />
                      <ContextItem
                        label="Localidade"
                        value={apoloContextEntity.locationLabel?.trim() || "-"}
                      />
                      <ContextItem
                        label="Status"
                        value={apoloContextEntity.status?.trim() || "-"}
                      />
                      <ContextItem
                        label="Proxima acao"
                        value={apoloContextEntity.nextAction?.trim() || "-"}
                      />
                    </div>
                  ) : null}

                  {apoloContextUpdatedAt ? (
                    <p className="text-[11px] font-medium text-ink-muted">
                      Atualizado em {formatDateTime(apoloContextUpdatedAt)}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-3 rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/12 p-3">
                  <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                    Nota interna
                  </p>
                  <textarea
                    value={contextNoteDraft}
                    onChange={(event) =>
                      setContextNoteDraft(event.target.value)
                    }
                    rows={10}
                    placeholder="Registre observacoes importantes para os proximos atendimentos..."
                    className="w-full resize-none rounded-lg border border-[#eadcc2] bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-[#A07C3B]/45"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void saveContextNote();
                    }}
                    disabled={contextSaving}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#101820] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#17212b] disabled:cursor-not-allowed disabled:bg-subtle"
                  >
                    <Save className="size-3.5" aria-hidden="true" />
                    {contextSaving ? "Salvando..." : "Salvar nota"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 xl:grid-cols-[minmax(0,1fr)_360px] [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
                <div className="rounded-xl border border-line/70 bg-subtle/70 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setContextAgendaMonthCursor(
                          shiftMonthIso(contextAgendaMonthCursor, -1),
                        )
                      }
                      className="inline-flex size-8 items-center justify-center rounded-md border border-line bg-surface text-ink-soft transition-colors hover:border-[#A07C3B]/30 hover:text-[#7A5E2C]"
                      aria-label="Mes anterior"
                    >
                      <ChevronRight
                        className="size-4 rotate-180"
                        aria-hidden="true"
                      />
                    </button>
                    <p className="text-sm font-semibold text-ink">
                      {agendaCalendar.monthLabel}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setContextAgendaMonthCursor(
                          shiftMonthIso(contextAgendaMonthCursor, 1),
                        )
                      }
                      className="inline-flex size-8 items-center justify-center rounded-md border border-line bg-surface text-ink-soft transition-colors hover:border-[#A07C3B]/30 hover:text-[#7A5E2C]"
                      aria-label="Proximo mes"
                    >
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {agendaCalendar.weekdayLabels.map((label) => (
                      <span
                        key={label}
                        className="px-1 py-1 text-center text-[11px] font-semibold text-ink-muted"
                      >
                        {label}
                      </span>
                    ))}
                    {agendaCalendar.weeks.flatMap((week) =>
                      week.map((day) => (
                        <div
                          key={day.id}
                          className={[
                            "min-h-16 rounded-md border px-1.5 py-1",
                            day.inCurrentMonth
                              ? "border-line/70 bg-surface"
                              : "border-line bg-subtle text-ink-muted",
                          ].join(" ")}
                        >
                          <p
                            className={[
                              "text-[11px] font-semibold",
                              day.isToday ? "text-[#7A5E2C]" : "text-ink-soft",
                            ].join(" ")}
                          >
                            {day.dayNumber}
                          </p>
                          {day.eventsCount > 0 ? (
                            <p className="mt-1 rounded-full bg-[#A07C3B]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#7A5E2C]">
                              {day.eventsCount} item
                              {day.eventsCount > 1 ? "s" : ""}
                            </p>
                          ) : null}
                        </div>
                      )),
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/12 p-3">
                    <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                      Nova atividade
                    </p>
                    <div className="mt-2 space-y-2">
                      <input
                        value={contextAgendaTitleDraft}
                        onChange={(event) =>
                          setContextAgendaTitleDraft(event.target.value)
                        }
                        placeholder="Ex.: Encaminhar boleto"
                        className="h-10 w-full rounded-lg border border-[#eadcc2] bg-surface px-3 text-sm text-ink outline-none transition-colors focus:border-[#A07C3B]/45"
                      />
                      <input
                        type="datetime-local"
                        value={contextAgendaDateDraft}
                        onChange={(event) =>
                          setContextAgendaDateDraft(event.target.value)
                        }
                        className="h-10 w-full rounded-lg border border-[#eadcc2] bg-surface px-3 text-sm text-ink outline-none transition-colors focus:border-[#A07C3B]/45"
                      />
                      <textarea
                        rows={3}
                        value={contextAgendaNotesDraft}
                        onChange={(event) =>
                          setContextAgendaNotesDraft(event.target.value)
                        }
                        placeholder="Detalhes opcionais da atividade..."
                        className="w-full resize-none rounded-lg border border-[#eadcc2] bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-[#A07C3B]/45"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void createContextAgendaEvent();
                      }}
                      disabled={contextSaving}
                      className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-[#101820] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#17212b] disabled:cursor-not-allowed disabled:bg-subtle"
                    >
                      <CalendarClock className="size-3.5" aria-hidden="true" />
                      {contextSaving ? "Salvando..." : "Agendar atividade"}
                    </button>
                  </div>

                  <div className="rounded-xl border border-line/70 bg-surface p-3">
                    <p className="text-xs font-semibold uppercase tracking-normal text-ink-muted">
                      Linha do tempo
                    </p>
                    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
                      {agendaTimeline.length ? (
                        agendaTimeline.slice(0, 14).map((item) => (
                          <article
                            key={item.id}
                            className="rounded-lg border border-line/70 bg-subtle/70 px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-xs font-semibold text-ink">
                                {item.title}
                              </p>
                              <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-semibold text-ink-soft">
                                {item.kindLabel}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-ink-soft">
                              {item.description}
                            </p>
                            <p className="mt-1 text-[10px] font-semibold text-ink-muted">
                              {item.dateLabel}
                            </p>
                          </article>
                        ))
                      ) : (
                        <p className="rounded-lg border border-line/70 bg-subtle px-3 py-2 text-xs font-semibold text-ink-muted">
                          Sem atividades registradas. A agenda esta pronta para
                          novos agendamentos.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function TicketSeparator({
  compact = false,
  onSubjectChange,
  subject,
  subjectOptions,
  ticket,
}: {
  compact?: boolean;
  onSubjectChange?: (value: string) => void;
  subject?: string;
  subjectOptions?: string[];
  ticket: IrisTicket;
}) {
  const status = effectiveIrisStatus(ticket);
  const email = isEmailTicket(ticket);
  const group = ticket.isGroup === true;
  const channelLine = group
    ? `Grupo · ${ticket.queueLabel}`
    : email
      ? `E-mail · ${emailBoxLabel(ticket.channelLabel)}`
      : `WhatsApp · ${ticket.queueLabel}`;
  const subjectChoices = Array.from(
    new Set([subject, ...(subjectOptions ?? [])]),
  ).filter((value): value is string => Boolean(value && value.trim()));
  const openedDayLabel = ticket.openedAt
    ? `${new Date(ticket.openedAt).toLocaleDateString("pt-BR")} · ${new Date(
        ticket.openedAt,
      ).toLocaleDateString("pt-BR", { weekday: "long" })}`
    : "-";

  return (
    <div
      className={`flex items-center justify-center gap-3 ${
        compact ? "" : "sticky top-0 z-10 bg-subtle/95 py-2 backdrop-blur-sm"
      }`}
    >
      <div className="h-px flex-1 bg-subtle/70" />
      <div
        className={[
          "rounded-2xl border border-line/70 bg-surface px-4 py-2 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
          compact ? "min-w-[260px]" : "min-w-[320px]",
        ].join(" ")}
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          {/* Grupo nao e ticket: mostra o codigo do grupo (GRP-xxxx), sem status. */}
          <span
            className={
              group
                ? "rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/30"
                : "rounded-full bg-[#A07C3B]/12 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15 dark:bg-[#A07C3B]/15 dark:text-[#d9b877] dark:ring-[#A07C3B]/30"
            }
          >
            {group ? ticket.protocol : `Ticket ${ticket.protocol}`}
          </span>
          {!group ? (
            <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-semibold text-ink-soft ring-1 ring-slate-200 dark:ring-white/10">
              {statusLabel[status]}
            </span>
          ) : null}
        </div>
        {!compact ? (
          <>
            {onSubjectChange && !email && !group ? (
              <select
                value={subject ?? ""}
                onChange={(event) => onSubjectChange(event.target.value)}
                aria-label="Assunto do atendimento"
                className={`mt-2 block w-full rounded-lg border px-2 py-1 text-center text-sm font-semibold outline-none focus:border-[#A07C3B]/40 ${
                  (subject ?? "").trim()
                    ? "border-line/70 bg-surface text-ink"
                    : "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-400/50 dark:bg-rose-500/15 dark:text-rose-300"
                }`}
              >
                <option value="">Selecione o assunto…</option>
                {subjectChoices.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              // E-mail e grupo já têm assunto próprio — mostra estático (sem catálogo do WhatsApp).
              <p className="mt-2 text-sm font-semibold text-ink [overflow-wrap:anywhere]">
                {ticket.subject?.trim() ||
                  (group
                    ? ticket.contactLabel
                    : email
                      ? "(sem assunto)"
                      : ticketCrmSubtitle(ticket))}
              </p>
            )}
            <p className="mt-1 text-xs font-medium capitalize text-ink-muted">
              {openedDayLabel} · {channelLine}
            </p>
          </>
        ) : (
          <p className="mt-1 truncate text-xs font-medium text-ink-muted">
            {formatDateTime(ticket.openedAt)} - {ticket.queueLabel}
          </p>
        )}
      </div>
      <div className="h-px flex-1 bg-subtle/70" />
    </div>
  );
}

// Cabeçalho de E-MAIL do cockpit: deixa claro que o atendimento é por e-mail e mostra
// De / Para / Assunto (como um cliente de e-mail), diferente do chat do WhatsApp.
function IrisEmailThreadHeader({ ticket }: { ticket: IrisTicket }) {
  const subject =
    ticket.subject?.trim() ||
    readTicketRecordString(ticket.sourceContext, "subject") ||
    "(sem assunto)";
  const fromLabel = ticketContactLabel(ticket);
  const fromEmail =
    ticket.contactEmail?.trim() ||
    readTicketRecordString(ticket.sourceContext, "fromEmail") ||
    "";
  const toAddress =
    readTicketRecordString(ticket.sourceContext, "groupAddress") ||
    emailBoxLabel(ticket.channelLabel);

  return (
    <div className="mx-4 mt-3">
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-3 dark:border-indigo-400/30 dark:bg-indigo-500/10">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-lg bg-indigo-500 text-white">
            <Mail className="size-3.5" aria-hidden="true" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
            E-mail · {emailBoxLabel(ticket.channelLabel)}
          </span>
        </div>
        <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">
          {subject}
        </p>
        <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-xs text-ink-muted">
          <dt className="font-semibold text-ink-soft">De</dt>
          <dd className="min-w-0 truncate">
            {fromLabel}
            {fromEmail ? (
              <span className="text-ink-muted"> · {fromEmail}</span>
            ) : null}
          </dd>
          <dt className="font-semibold text-ink-soft">Para</dt>
          <dd className="min-w-0 truncate">{toAddress}</dd>
        </dl>
      </div>
    </div>
  );
}

function IrisTemplateFeedbackBox({ feedback }: { feedback: unknown }) {
  const normalized = normalizeIrisTemplateFeedback(feedback);

  if (!normalized) {
    return null;
  }

  const tone = normalized.tone ?? "neutral";
  const toneClass =
    tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-900"
      : tone === "warning"
        ? "border-[#f2dfbf] bg-[#fffbeb] text-[#7A5E2C]"
        : tone === "success"
          ? "border-emerald-100 bg-emerald-50 text-emerald-900"
          : "border-line bg-surface text-ink";
  const metaLine = [
    normalized.metaCode ? `Codigo Meta: ${normalized.metaCode}` : null,
    normalized.providerMessage
      ? `Retorno Meta: ${normalized.providerMessage}`
      : null,
    normalized.metaDetail ? `Detalhe Meta: ${normalized.metaDetail}` : null,
  ].filter((line): line is string => Boolean(line));
  const Icon =
    tone === "error" ? ShieldAlert : tone === "success" ? CheckCircle2 : Clock3;

  return (
    <div className={`mt-3 rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          {normalized.title ? (
            <p className="text-xs font-semibold">{normalized.title}</p>
          ) : null}
          <p className="mt-0.5 text-xs font-medium leading-5">
            {normalized.message}
          </p>
          {normalized.cause ? (
            <p className="mt-1 text-xs font-medium leading-5 opacity-90">
              Possivel causa: {normalized.cause}
            </p>
          ) : null}
          {normalized.action ? (
            <p className="mt-1 text-xs font-semibold leading-5">
              Proxima acao: {normalized.action}
            </p>
          ) : null}
          {metaLine.length ? (
            <div className="mt-2 space-y-1 rounded-md bg-surface/65 px-2 py-1.5 text-[11px] font-semibold leading-4 opacity-90">
              {metaLine.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function createIrisTemplateFeedback({
  action,
  cause,
  message,
  metaCode,
  metaDetail,
  providerMessage,
  title,
  tone = "neutral",
}: IrisTemplateFeedback): IrisTemplateFeedback {
  return {
    action,
    cause,
    message,
    metaCode,
    metaDetail,
    providerMessage,
    title,
    tone,
  };
}

function createIrisTemplateFeedbackFromPayload(
  payload: IrisMetaTemplatesResponse | null | undefined,
  fallbackMessage: string,
) {
  return createIrisTemplateFeedback({
    action: payload?.errorAction,
    cause: payload?.errorCause,
    message: payload?.error ?? fallbackMessage,
    metaCode: payload?.metaCode,
    metaDetail: payload?.metaDetail,
    providerMessage: payload?.providerMessage,
    title: payload?.errorTitle ?? "Falha na Meta",
    tone: "error",
  });
}

function normalizeIrisTemplateFeedback(
  feedback: unknown,
): IrisTemplateFeedback | null {
  if (!feedback) {
    return null;
  }

  if (typeof feedback === "string") {
    const message = feedback.trim();

    return message
      ? createIrisTemplateFeedback({ message, tone: "neutral" })
      : null;
  }

  if (typeof feedback !== "object" || Array.isArray(feedback)) {
    return null;
  }

  const record = feedback as Record<string, unknown>;
  const message =
    typeof record.message === "string" ? record.message.trim() : "";

  if (!message) {
    return null;
  }

  return createIrisTemplateFeedback({
    action: typeof record.action === "string" ? record.action : null,
    cause: typeof record.cause === "string" ? record.cause : null,
    message,
    metaCode: typeof record.metaCode === "string" ? record.metaCode : null,
    metaDetail:
      typeof record.metaDetail === "string" ? record.metaDetail : null,
    providerMessage:
      typeof record.providerMessage === "string"
        ? record.providerMessage
        : null,
    title: typeof record.title === "string" ? record.title : null,
    tone:
      record.tone === "error" ||
      record.tone === "success" ||
      record.tone === "warning"
        ? record.tone
        : "neutral",
  });
}

function IrisInboundNoticeToast({
  notice,
  onDismiss,
  onOpen,
}: {
  notice: IrisInboundNotice;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="fixed right-5 top-20 z-[90] w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-[#eadcc2] bg-surface p-3 shadow-[0_18px_45px_rgba(15,23,42,0.18)]">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
          <MessageCircle className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
            Nova mensagem WhatsApp
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-ink">
            {notice.title}
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-soft">
            {notice.body}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-ink-muted">
              {formatDateTime(notice.receivedAt)}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onDismiss}
                className="h-7 rounded-md px-2 text-[11px] font-semibold text-ink-muted transition-colors hover:bg-subtle"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={onOpen}
                className="h-7 rounded-md bg-[#A07C3B] px-2 text-[11px] font-semibold text-white transition-colors hover:bg-[#8E6F35]"
              >
                Abrir
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactAvatar({
  size = "md",
  ticket,
}: {
  size?: "sm" | "md" | "lg";
  ticket: IrisTicket;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const sizeClass =
    size === "lg" ? "size-11" : size === "sm" ? "size-8" : "size-9";
  const textClass =
    size === "lg" ? "text-sm" : size === "sm" ? "text-[11px]" : "text-xs";
  const imageUrl =
    ticket.contactAvatarUrl && !imageFailed ? ticket.contactAvatarUrl : null;
  const label = ticketContactLabel(ticket);
  // Cor do avatar = cor do canal (e-mail = azul/indigo; WhatsApp = verde).
  const email = isEmailTicket(ticket);

  if (imageUrl) {
    return (
      <img
        alt={label}
        className={`${sizeClass} shrink-0 rounded-full border border-line object-cover shadow-[0_1px_2px_rgba(15,23,42,0.08)]`}
        src={imageUrl}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className={[
        sizeClass,
        textClass,
        "flex shrink-0 items-center justify-center rounded-full border font-semibold uppercase shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        email
          ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/15 dark:text-indigo-300"
          : "border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300",
      ].join(" ")}
    >
      {contactInitials(label)}
    </span>
  );
}

function MessageBubble({
  message,
  onAskAthena,
  onEdit,
  onReact,
  onReply,
  ticket,
}: {
  message: IrisMessage;
  onAskAthena?: (message: IrisMessage) => void;
  onEdit: (message: IrisMessage) => void;
  onReact: (message: IrisMessage, emoji: string) => void;
  onReply: (message: IrisMessage) => void;
  ticket: IrisTicket;
}) {
  const outbound = message.direction === "outbound";
  const internal =
    message.direction === "internal" || message.senderType === "system";
  const canEdit = outbound && message.senderType === "operator";
  // Em grupo, cada mensagem recebida é de um participante — mostra quem enviou.
  const showGroupSender =
    ticket.isGroup === true && !outbound && Boolean(message.senderLabel);
  const avatarLabel = outbound
    ? (message.senderLabel ?? "Operador Iris")
    : ticketContactLabel(ticket);
  const avatarUrl = outbound
    ? message.operatorAvatarUrl
    : ticket.contactAvatarUrl;

  if (internal) {
    // Nota interna de operador (sussurro) = cartão dourado com autor; só a equipe vê.
    // Mensagens de sistema (transferência etc.) seguem como pílula cinza central.
    if (message.messageType === "note") {
      return (
        <div className="flex justify-center">
          <div className="w-full max-w-[80%] rounded-xl border border-[#A07C3B]/30 bg-[#A07C3B]/12 px-3.5 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="mb-1 text-[11px] font-semibold text-ink">
              {message.senderLabel ?? "Operador"}
            </div>
            <p className="whitespace-pre-wrap text-sm text-ink [overflow-wrap:anywhere]">
              {message.body}
            </p>
            <div className="mt-1 text-right text-[11px] text-[#A07C3B]/70">
              {formatDateTime(message.createdAt)}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-center">
        <div className="max-w-[70%] rounded-full border border-line/70 bg-surface px-3 py-1.5 text-center text-xs font-semibold text-ink-muted shadow-[0_1px_2px_rgba(15,23,42,0.04)] [overflow-wrap:anywhere]">
          {message.body}
        </div>
      </div>
    );
  }

  // E-mail: renderiza cada mensagem como um CARTÃO de e-mail (De/quando + corpo), largura
  // cheia, em vez do balão estilo WhatsApp — deixa claro que o canal é e-mail.
  if (isEmailTicket(ticket)) {
    return (
      <EmailMessageCard
        avatarLabel={avatarLabel}
        avatarUrl={avatarUrl}
        message={message}
        outbound={outbound}
        senderEmail={outbound ? null : ticket.contactEmail ?? null}
      />
    );
  }

  return (
    <div
      className={[
        "group flex w-full min-w-0",
        outbound ? "justify-end pr-1 sm:pr-2" : "justify-start pl-1 sm:pl-2",
      ].join(" ")}
    >
      <div
        className={[
          "flex min-w-0 max-w-[88%] items-end gap-2 sm:max-w-[76%] 2xl:max-w-[860px]",
          outbound ? "flex-row-reverse" : "flex-row",
        ].join(" ")}
      >
        <InlineAvatar
          avatarUrl={avatarUrl}
          label={avatarLabel}
          tone={outbound ? "gold" : "green"}
        />
        <div className="relative min-w-0">
          <MessageBubbleActions
            canEdit={canEdit}
            message={message}
            onAskAthena={onAskAthena}
            onEdit={onEdit}
            onReact={onReact}
            onReply={onReply}
            outbound={outbound}
          />
          <div
            className={[
              "min-w-[128px] max-w-full rounded-2xl px-4 py-3 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.05)] [overflow-wrap:anywhere]",
              outbound
                ? "border border-[#c8ecd7] bg-[#eaf8f0] text-ink dark:border-[#1f6b50]/60 dark:bg-[#1c5742] dark:text-[var(--uix-text-primary)]"
                : "border border-line bg-surface text-ink dark:border-white/[0.07] dark:bg-[#282b2a] dark:text-[var(--uix-text-primary)]",
            ].join(" ")}
          >
            {outbound && message.senderLabel ? (
              <div className="mb-1.5 flex items-center justify-end gap-1.5">
                <span className="rounded-full border border-[#c8ecd7] bg-surface/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-[#0f766e] dark:border-[#1f6b50]/60 dark:bg-white/[0.06] dark:text-[#9fd8bd]">
                  {message.senderLabel}
                </span>
              </div>
            ) : null}
            {showGroupSender ? (
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  {message.senderLabel}
                </span>
              </div>
            ) : null}
            {message.replyTo ? (
              <MessageReplyPreview
                reply={message.replyTo}
                outbound={outbound}
              />
            ) : null}
            <MessageContent message={message} outbound={outbound} />
            <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-ink-muted">
              {message.editedAt ? <span>editada</span> : null}
              <span>{formatDateTime(message.createdAt)}</span>
              {outbound ? <MessageDeliveryIndicator message={message} /> : null}
            </div>
          </div>
          {message.reactions?.length ? (
            <MessageReactionStrip
              reactions={message.reactions}
              outbound={outbound}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Cartão de mensagem de e-mail (largura cheia, com De/quem + corpo). Recebido = neutro;
// Enviado = tom dourado (identidade do operador), com "Enviado por".
function EmailMessageCard({
  avatarLabel,
  avatarUrl,
  message,
  outbound,
  senderEmail,
}: {
  avatarLabel: string;
  avatarUrl?: string | null;
  message: IrisMessage;
  outbound: boolean;
  senderEmail?: string | null;
}) {
  return (
    <div className="flex w-full min-w-0 justify-center">
      <div
        className={[
          "w-full max-w-[860px] rounded-xl border shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
          outbound
            ? "border-[#A07C3B]/25 bg-[#A07C3B]/5 dark:border-[#A07C3B]/30 dark:bg-[#A07C3B]/10"
            : "border-line bg-surface dark:border-white/[0.07]",
        ].join(" ")}
      >
        <div className="flex items-center gap-2.5 border-b border-line/70 px-3.5 py-2 dark:border-white/[0.06]">
          <InlineAvatar
            avatarUrl={avatarUrl}
            label={avatarLabel}
            tone={outbound ? "gold" : "indigo"}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">
              {avatarLabel}
              {senderEmail ? (
                <span className="font-normal text-ink-muted">
                  {" "}
                  · {senderEmail}
                </span>
              ) : null}
            </p>
            <p className="text-[11px] font-medium text-ink-muted">
              {outbound ? "Enviado" : "Recebido"} · {formatDateTime(message.createdAt)}
            </p>
          </div>
          <span
            className={[
              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              outbound
                ? "border-[#A07C3B]/25 bg-surface text-[#7A5E2C] dark:bg-white/[0.06] dark:text-[#d9b877]"
                : "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/15 dark:text-indigo-300",
            ].join(" ")}
          >
            {outbound ? "Resposta" : "E-mail"}
          </span>
        </div>
        <div className="px-3.5 py-3">
          <MessageContent message={message} outbound={outbound} />
          {outbound ? (
            <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-ink-muted">
              <MessageDeliveryIndicator message={message} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MessageBubbleActions({
  canEdit,
  message,
  onAskAthena,
  onEdit,
  onReact,
  onReply,
  outbound,
}: {
  canEdit: boolean;
  message: IrisMessage;
  onAskAthena?: (message: IrisMessage) => void;
  onEdit: (message: IrisMessage) => void;
  onReact: (message: IrisMessage, emoji: string) => void;
  onReply: (message: IrisMessage) => void;
  outbound: boolean;
}) {
  return (
    <div
      className={[
        "absolute -top-3 z-10 flex items-center gap-1 rounded-full border border-line bg-surface px-1 py-0.5 opacity-0 shadow-[0_8px_22px_rgba(15,23,42,0.12)] transition-opacity focus-within:opacity-100 group-hover:opacity-100",
        outbound ? "right-2" : "left-2",
      ].join(" ")}
    >
      {IRIS_REACTION_OPTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onReact(message, emoji)}
          className="flex size-7 items-center justify-center rounded-full text-sm transition-colors hover:bg-subtle"
          aria-label={`Reagir com ${emoji}`}
        >
          {emoji}
        </button>
      ))}
      <span className="h-5 w-px bg-subtle" aria-hidden="true" />
      <Tooltip content="Responder" placement="top">
        <button
          type="button"
          onClick={() => onReply(message)}
          className="flex size-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-subtle hover:text-[#7A5E2C]"
          aria-label="Responder mensagem"
        >
          <Reply className="size-3.5" aria-hidden="true" />
        </button>
      </Tooltip>
      {onAskAthena ? (
        <Tooltip content="Pedir à Athena sobre esta mensagem" placement="top">
          <button
            type="button"
            onClick={() => onAskAthena(message)}
            className="flex size-7 items-center justify-center rounded-full text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
            aria-label="Pedir à Athena sobre esta mensagem"
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
      {canEdit ? (
        <Tooltip content="Editar no Iris" placement="top">
          <button
            type="button"
            onClick={() => onEdit(message)}
            className="flex size-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-subtle hover:text-[#7A5E2C]"
            aria-label="Editar mensagem"
          >
            <Edit3 className="size-3.5" aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

function MessageReplyPreview({
  outbound,
  reply,
}: {
  outbound: boolean;
  reply: IrisReplyPreview;
}) {
  return (
    <div
      className={[
        "mb-2 rounded-xl border-l-2 px-3 py-2 text-xs",
        outbound
          ? "border-[#A07C3B] bg-surface/70 text-ink-soft dark:bg-black/20"
          : "border-emerald-400 bg-emerald-50/70 text-ink-soft dark:border-emerald-500/50 dark:bg-emerald-500/10",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5 font-semibold text-ink">
        <MessageSquareReply className="size-3.5" aria-hidden="true" />
        <span>{reply.senderLabel ?? "Mensagem"}</span>
      </div>
      <p className="mt-1 line-clamp-2 [overflow-wrap:anywhere]">{reply.body}</p>
    </div>
  );
}

function MessageReactionStrip({
  outbound,
  reactions,
}: {
  outbound: boolean;
  reactions: IrisMessageReaction[];
}) {
  return (
    <div
      className={[
        "absolute -bottom-3 flex rounded-full border border-line bg-surface px-1.5 py-0.5 text-sm shadow-[0_6px_16px_rgba(15,23,42,0.12)]",
        outbound ? "right-3" : "left-3",
      ].join(" ")}
    >
      {reactions.slice(0, 4).map((reaction, index) => (
        <Tooltip
          key={`${reaction.actorUserId ?? reaction.actorLabel ?? "actor"}-${reaction.emoji}-${index}`}
          content={reaction.actorLabel ?? "Reacao"}
          placement="top"
        >
          <span className="-ml-0.5 first:ml-0">{reaction.emoji}</span>
        </Tooltip>
      ))}
    </div>
  );
}

function MessageContent({
  message,
  outbound,
}: {
  message: IrisMessage;
  outbound: boolean;
}) {
  const kind = message.mediaKind ?? message.messageType ?? null;
  const mediaUrl = message.mediaUrl ?? null;
  const caption = isGenericMediaPlaceholder(message.body) ? null : message.body;

  if (message.messageType === "audio" || kind === "audio") {
    return <AudioMessageContent message={message} outbound={outbound} />;
  }

  if (mediaUrl && kind === "image") {
    return (
      <ImageMessageContent
        caption={caption}
        fileName={message.mediaFileName ?? null}
        url={mediaUrl}
      />
    );
  }

  if (mediaUrl && kind === "video") {
    return (
      <div className="space-y-1.5">
        <video controls src={mediaUrl} className="max-h-72 w-full rounded-lg" />
        {caption ? <MessageCaption text={caption} /> : null}
      </div>
    );
  }

  if (mediaUrl && kind === "document") {
    return (
      <div className="space-y-1.5">
        <a
          href={mediaUrl}
          target="_blank"
          rel="noreferrer"
          download={message.mediaFileName ?? undefined}
          className={[
            "flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
            outbound
              ? "border-white/40 bg-white/15 hover:bg-white/25"
              : "border-line bg-surface hover:bg-subtle",
          ].join(" ")}
        >
          <FileText className="size-5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {message.mediaFileName ?? "Documento recebido"}
          </span>
          <Download className="size-4 shrink-0 opacity-70" aria-hidden="true" />
        </a>
        {caption ? <MessageCaption text={caption} /> : null}
      </div>
    );
  }

  if (message.messageType === "unsupported") {
    return (
      <p className="whitespace-pre-wrap italic leading-6 opacity-80 [overflow-wrap:anywhere]">
        Mensagem nao suportada pelo WhatsApp (ex.: enquete, contato ou "ver uma
        vez").
      </p>
    );
  }

  // Mensagem só de emoji: renderiza grande, como o WhatsApp (tamanho diminui conforme a
  // quantidade). Vale tanto pro que o cliente manda quanto pro que o operador envia.
  const emojiOnly = emojiOnlyMessage(message.body);

  if (emojiOnly) {
    return (
      <p className={`whitespace-pre-wrap leading-tight ${emojiOnly.sizeClass}`}>
        {message.body.trim()}
      </p>
    );
  }

  return (
    <p className="whitespace-pre-wrap leading-6 [overflow-wrap:anywhere]">
      <WhatsAppText text={message.body} />
    </p>
  );
}

// Detecta se a mensagem é só emoji (sem texto) e escolhe o tamanho grande conforme a
// quantidade — imita o WhatsApp (1 emoji = enorme; vai reduzindo). Retorna null se tiver
// qualquer caractere que não seja emoji/modificador/espaço.
function emojiOnlyMessage(
  body: string | null | undefined,
): { count: number; sizeClass: string } | null {
  const text = (body ?? "").trim();

  if (!text || text.length > 40) {
    return null;
  }

  // Remove emojis, modificadores de tom, ZWJ, seletores de variação, indicadores
  // regionais (bandeiras) e espaços. Se sobrar QUALQUER coisa (letra, número), não é
  // só-emoji — assim "😀5" ou "ok 👍" caem no render de texto normal.
  const withoutEmoji = text.replace(
    /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{FE0E}\u{200D}\u{20E3}\s]/gu,
    "",
  );

  if (withoutEmoji.length > 0) {
    return null;
  }

  const pictographs = text.match(/\p{Extended_Pictographic}/gu) ?? [];

  if (pictographs.length === 0) {
    return null;
  }

  const sizeClass =
    pictographs.length <= 1
      ? "text-5xl"
      : pictographs.length <= 3
        ? "text-4xl"
        : pictographs.length <= 6
          ? "text-3xl"
          : "text-2xl";

  return { count: pictographs.length, sizeClass };
}

function MessageCaption({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap leading-6 [overflow-wrap:anywhere]">
      <WhatsAppText text={text} />
    </p>
  );
}

// Renderiza a formatação do WhatsApp no cockpit (o operador vê negrito/itálico igual o cliente,
// sem o `*`/`_` literal). *negrito* -> bold, _italico_ -> italic, ~tachado~ -> strikethrough.
function WhatsAppText({ text }: { text: string }) {
  const nodes: Array<JSX.Element | string> = [];
  const pattern = /(\*[^*\n]+\*)|(_[^_\n]+_)|(~[^~\n]+~)/g;
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const inner = token.slice(1, -1);

    if (token.startsWith("*")) {
      nodes.push(<strong key={key++}>{inner}</strong>);
    } else if (token.startsWith("_")) {
      nodes.push(<em key={key++}>{inner}</em>);
    } else {
      nodes.push(<s key={key++}>{inner}</s>);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return <>{nodes}</>;
}

function ImageMessageContent({
  caption,
  fileName,
  url,
}: {
  caption: string | null;
  fileName: string | null;
  url: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block overflow-hidden rounded-lg"
      >
        { }
        <img
          src={url}
          alt={fileName ?? "Imagem recebida pelo WhatsApp"}
          className="max-h-72 w-auto cursor-zoom-in rounded-lg object-cover transition hover:opacity-95"
        />
      </button>
      {caption ? <MessageCaption text={caption} /> : null}
      {open ? (
        <ImageLightbox
          alt={fileName ?? "Imagem recebida pelo WhatsApp"}
          onClose={() => setOpen(false)}
          url={url}
        />
      ) : null}
    </div>
  );
}

function ImageLightbox({
  alt,
  onClose,
  url,
}: {
  alt: string;
  onClose: () => void;
  url: string;
}) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKey);

    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-[2px]"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
      >
        <X className="size-5" aria-hidden="true" />
      </button>
      { }
      <img
        src={url}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
      />
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
      >
        <Download className="size-4" aria-hidden="true" />
        Abrir original
      </a>
    </div>
  );
}

function isGenericMediaPlaceholder(body: string) {
  return /^Mensagem .+ recebida pelo WhatsApp\.$/.test(body.trim());
}

function AudioMessageContent({
  message,
  outbound,
}: {
  message: IrisMessage;
  outbound: boolean;
}) {
  return (
    <div className="flex min-w-[220px] items-center gap-3">
      <span
        className={[
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          outbound
            ? "bg-[#A07C3B] text-white"
            : "bg-emerald-50 text-emerald-700",
        ].join(" ")}
      >
        <Play className="ml-0.5 size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        {message.audioUrl ? (
          <audio
            aria-label="Audio WhatsApp"
            controls
            className="h-8 w-full max-w-[260px]"
            src={message.audioUrl}
          />
        ) : (
          <>
            <div className="h-2 rounded-full bg-subtle">
              <div className="h-2 w-1/3 rounded-full bg-[#A07C3B]" />
            </div>
            <p className="mt-1 text-xs font-semibold text-ink-muted">
              Audio WhatsApp
            </p>
          </>
        )}
      </div>
      <span className="shrink-0 text-xs font-semibold text-ink-muted">
        {formatAudioDuration(message.audioDurationMs)}
      </span>
    </div>
  );
}

function InlineAvatar({
  avatarUrl,
  label,
  tone,
}: {
  avatarUrl?: string | null;
  label: string;
  tone: "gold" | "green" | "indigo";
}) {
  const [failed, setFailed] = useState(false);
  const imageUrl = avatarUrl && !failed ? avatarUrl : null;

  if (imageUrl) {
    return (
      <img
        alt={label}
        className="size-8 shrink-0 rounded-full border border-line object-cover shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
        src={imageUrl}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={[
        "flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold uppercase shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        tone === "gold"
          ? "border-[#eadcc2] bg-[#A07C3B]/12 text-[#7A5E2C] dark:border-[#A07C3B]/40 dark:bg-[#A07C3B]/15 dark:text-[#d9b877]"
          : tone === "indigo"
            ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/15 dark:text-indigo-300"
            : "border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300",
      ].join(" ")}
    >
      {contactInitials(label)}
    </span>
  );
}

function MessageDeliveryIndicator({ message }: { message: IrisMessage }) {
  const normalized = getEffectiveDeliveryStatus(message);
  const hasMetaConfirmation = Boolean(message.externalMessageId);
  const pendingMetaSend =
    !hasMetaConfirmation &&
    normalized !== "failed" &&
    normalized !== "delivered" &&
    normalized !== "read";
  const doubleCheck =
    !pendingMetaSend && (normalized === "delivered" || normalized === "read");
  const Icon =
    normalized === "failed" || pendingMetaSend
      ? Clock3
      : doubleCheck
        ? CheckCheck
        : Check;
  const label = getDeliveryStatusLabel(normalized);
  const colorClass = pendingMetaSend
    ? "text-amber-500"
    : normalized === "read"
      ? "text-sky-500"
      : normalized === "failed"
        ? "text-rose-500"
        : "text-ink-muted";
  const tooltip = pendingMetaSend
    ? "Aguardando envio pela Meta"
    : normalized === "failed" && message.failureReason
      ? `${label}: ${message.failureReason}`
      : label;

  return (
    <Tooltip content={tooltip} placement="top">
      <span
        aria-label={tooltip}
        className={`inline-flex items-center ${colorClass}`}
      >
        <Icon className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
      </span>
    </Tooltip>
  );
}

function normalizeDeliveryStatus(status?: string | null) {
  const normalized = status?.toLowerCase();

  if (
    normalized === "read" ||
    normalized === "delivered" ||
    normalized === "sent" ||
    normalized === "failed" ||
    normalized === "queued" ||
    normalized === "draft"
  ) {
    return normalized;
  }

  return "queued";
}

function getEffectiveDeliveryStatus(message: IrisMessage) {
  if (message.readAt) {
    return "read";
  }

  if (message.deliveredAt) {
    return "delivered";
  }

  return normalizeDeliveryStatus(message.deliveryStatus);
}

function getDeliveryStatusLabel(status: string) {
  if (status === "read") {
    return "Visualizado";
  }

  if (status === "delivered") {
    return "Entregue, ainda nao visualizado";
  }

  if (status === "failed") {
    return "Falha no envio";
  }

  if (status === "sent") {
    return "Enviado, ainda nao entregue";
  }

  return "Aguardando envio";
}

function shouldRepairOutboundMessage(message: IrisMessage) {
  const normalized = normalizeDeliveryStatus(message.deliveryStatus);
  const ageInMs = Date.now() - dateValue(message.createdAt);
  const repairWindowInMs = 60 * 60 * 1000;

  return (
    message.direction === "outbound" &&
    message.senderType === "operator" &&
    message.messageType !== "audio" &&
    !message.externalMessageId &&
    (normalized === "queued" ||
      normalized === "sent" ||
      normalized === "draft") &&
    ageInMs >= 0 &&
    ageInMs <= repairWindowInMs
  );
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-3 py-2.5">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-ink [overflow-wrap:anywhere]">
        {value}
      </p>
    </div>
  );
}

function StatusPill({
  label,
  tone = "gold",
}: {
  label: string;
  tone?: "blue" | "danger" | "gold" | "green" | "neutral";
}) {
  const classes =
    tone === "danger"
      ? "border-rose-100 bg-rose-50 text-rose-700"
      : tone === "blue"
        ? "border-sky-100 bg-sky-50 text-sky-700"
        : tone === "green"
          ? "border-emerald-100 bg-emerald-50 text-emerald-700"
          : tone === "neutral"
            ? "border-line bg-subtle text-ink-soft"
            : "border-[#eadcc2] bg-[#A07C3B]/12 text-[#8a682f]";

  return (
    <span
      className={`inline-flex w-fit rounded-full border px-2 py-1 text-xs font-semibold ${classes}`}
    >
      {label}
    </span>
  );
}

function Crm360Badge({
  registration,
}: {
  compact?: boolean;
  registration?: IrisCrm360Registration | null;
}) {
  const registered = registration?.status === "registered";
  const missing = registration?.status === "missing";
  const label = "Apolo";
  const classes = registered
    ? "border-emerald-100 bg-emerald-50 text-emerald-700"
    : missing
      ? "border-rose-100 bg-rose-50 text-rose-700"
      : "border-line bg-subtle text-ink-muted";

  return (
    <Tooltip
      content={crm360ContextLabel(registration)}
      placement="top"
      triggerClassName="inline-flex"
    >
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${classes}`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            registered
              ? "bg-emerald-500"
              : missing
                ? "bg-rose-500"
                : "bg-subtle"
          }`}
          aria-hidden="true"
        />
        {label}
      </span>
    </Tooltip>
  );
}

function OriginPill({ origin }: { origin: IrisOrigin }) {
  const active = origin === "active";

  return (
    <span
      className={[
        "inline-flex w-fit rounded-full border px-2 py-1 text-xs font-semibold",
        active
          ? "border-sky-100 bg-sky-50 text-sky-700"
          : "border-violet-100 bg-violet-50 text-violet-700",
      ].join(" ")}
    >
      {active ? "Ativo" : "Passivo"}
    </span>
  );
}

function PriorityPill({ priority }: { priority: IrisPriority }) {
  const classes =
    priority === "critical"
      ? "bg-rose-50 text-rose-700 ring-rose-100"
      : priority === "high"
        ? "bg-orange-50 text-orange-700 ring-orange-100"
        : priority === "medium"
          ? "bg-amber-50 text-amber-700 ring-amber-100"
          : "bg-emerald-50 text-emerald-700 ring-emerald-100";

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${classes}`}
    >
      {priorityLabel[priority]}
    </span>
  );
}

const irisTicketQueueHelpers: IrisTicketQueueHelpers = {
  effectiveIrisStatus,
  estimateAverageResponse,
  estimateFirstResponse,
  filterTicketsByBoardOwner,
  formatDateTime,
  formatIrisChannelLabel,
  isCacaOwned: isCacaOwnedTicket,
  isClosedTicket,
  isClosedToday,
  isSlaCritical,
  isWaitingForIris,
  priorityLabel,
  slaClasses,
  slaLabel,
  sortIrisTickets,
  statusLabel,
  statusTone,
  ticketContactLabel,
  ticketCrmSubtitle,
  ticketOrigin,
  ticketResponseTimeLabel,
  ticketResponseTimeState,
  unique,
};

const irisHistoryViewHelpers: IrisHistoryViewHelpers = {
  dateValue,
  formatCount,
  isClosedTicket,
  ticketContactLabel,
  ticketCrmSubtitle,
  ticketMatchesHistoryFocus,
  unique,
};

const irisTicketQueueRenderers: IrisTicketQueueRenderers = {
  renderContactAvatar: (ticket, size) => (
    <ContactAvatar size={size} ticket={ticket} />
  ),
  renderCrm360Badge: (registration, compact) => (
    <Crm360Badge compact={compact} registration={registration} />
  ),
  renderOriginPill: (origin) => <OriginPill origin={origin} />,
  renderPriorityPill: (priority) => <PriorityPill priority={priority} />,
  renderStatusPill: ({ label, tone }) => (
    <StatusPill label={label} tone={tone} />
  ),
};

const irisConversationReadOnlyHelpers: IrisConversationReadOnlyHelpers = {
  conversationTime,
  conversationWaitAge,
  conversationWaitState,
  crm360ContextLabel,
  formatDateTime,
  formatIrisChannelLabel,
  priorityLabel,
  slaLabel,
  ticketContactLabel,
};

const irisMetaBroadcastsHelpers = {
  formatCount,
  formatDateTime,
};

function buildTicketChecklist(ticket: IrisTicket) {
  return [
    {
      id: "profile",
      label: "Perfil",
      ok: Boolean(ticket.profileLabel && ticket.profileLabel !== "Sem perfil"),
    },
    {
      id: "queue",
      label: "Fila",
      ok: Boolean(ticket.queueLabel && ticket.queueLabel !== "Sem fila"),
    },
    {
      id: "contact",
      label: "Contato",
      ok: Boolean(ticket.contactPhone || ticket.contactEmail),
    },
    {
      id: "priority",
      label: "Prioridade",
      ok: Boolean(ticket.priority),
    },
    {
      id: "sla",
      label: "SLA",
      ok: slaLabel(ticket) !== "Sem SLA",
    },
  ];
}

// Primeira Maiúscula em nomes que vêm em CAIXA ALTA do C2X (regra de UI do Lucas).
function capitalizeName(value?: string | null): string {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) =>
      word ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

function conversationWaitState(ticket: IrisTicket): IrisConversationWaitState {
  const status = effectiveIrisStatus(ticket);

  if (status === "closed" || status === "resolved" || status === "cancelled") {
    return { label: "Encerrado", tone: "encerrado" };
  }

  // waiting_customer = ultima mensagem foi nossa (operador/Caca) -> aguardando o cliente
  if (status === "waiting_customer") {
    return { label: "Espera", tone: "espera" };
  }

  // new / open / pending / waiting_operator = ultima foi do cliente -> aguardando a gente
  return { label: "Pendente", tone: "pendente" };
}

function conversationWaitAge(ticket: IrisTicket): string {
  const value = ticket.lastMessageAt ?? ticket.openedAt;

  if (!value) {
    return "";
  }

  const time = new Date(value).getTime();

  if (Number.isNaN(time)) {
    return "";
  }

  const diffMinutes = Math.floor((Date.now() - time) / 60000);

  if (diffMinutes < 1) {
    return "agora";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}min`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  return `${Math.floor(diffHours / 24)}d`;
}

function conversationTime(ticket: IrisTicket) {
  const value = ticket.lastMessageAt ?? ticket.openedAt;
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === today) {
    return date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (date.toDateString() === yesterday.toDateString()) {
    return "Ontem";
  }

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function IrisLoading() {
  return (
    <PanteonLoadingState
      className="rounded-2xl border-line bg-surface p-8"
      minHeightClassName="min-h-32"
      title="Carregando fila"
    />
  );
}

function toneBg(tone: IrisTone) {
  if (tone === "gold") return "bg-[#A07C3B]/12";
  if (tone === "green") return "bg-emerald-50";
  if (tone === "red") return "bg-rose-50";
  if (tone === "blue") return "bg-sky-50";
  return "bg-subtle";
}

function toneText(tone: IrisTone) {
  if (tone === "gold") return "text-[#A07C3B]";
  if (tone === "green") return "text-emerald-600";
  if (tone === "red") return "text-rose-600";
  if (tone === "blue") return "text-sky-600";
  return "text-ink-muted";
}

function crm360ContextLabel(registration?: IrisCrm360Registration | null) {
  if (!registration) {
    return "Nao consultado";
  }

  if (registration.status === "registered") {
    const profile =
      registration.profileLabel ?? registration.profiles?.join(", ");
    const parts = [
      registration.label ? formatIrisDisplayName(registration.label) : null,
      profile,
      registration.relationLabel,
    ].filter(Boolean);

    return parts.length ? parts.join(" - ") : "Cadastro localizado";
  }

  if (registration.status === "missing") {
    return "Sem cadastro";
  }

  return "Nao consultado";
}

function ticketContactLabel(ticket: IrisTicket) {
  const registration = ticket.crm360Registration;
  const contactLabel = resolveWhatsAppContactLabel(ticket);

  if (registration?.status === "registered" && registration.label) {
    return formatIrisDisplayName(registration.label);
  }

  return contactLabel;
}

function ticketCrmSubtitle(ticket: IrisTicket) {
  const registration = ticket.crm360Registration;

  if (registration?.status === "registered") {
    return (
      registration.profileLabel ??
      registration.profiles?.join(" | ") ??
      registration.relationLabel ??
      "Apolo"
    );
  }

  if (registration?.status === "missing") {
    return "Telefone sem cadastro no Apolo";
  }

  return ticket.subject;
}

function stripWhatsAppContactPrefix(value: string) {
  return value.replace(/^WhatsApp\s*-\s*/i, "").trim() || value;
}

function resolveWhatsAppContactLabel(ticket: IrisTicket) {
  const contactLabel = formatIrisDisplayName(
    stripWhatsAppContactPrefix(ticket.contactLabel),
  );

  if (!isGenericTicketContactLabel(contactLabel)) {
    return contactLabel;
  }

  const formattedPhone =
    typeof ticket.contactPhone === "string" && ticket.contactPhone.trim()
      ? formatPhoneForDisplay(ticket.contactPhone)
      : null;

  if (formattedPhone && formattedPhone !== "-") {
    return `WhatsApp ${formattedPhone}`;
  }

  return "Sem contato";
}

function isGenericTicketContactLabel(value: string) {
  const normalized = value.toLowerCase().trim();

  if (!normalized) {
    return true;
  }

  return (
    normalized === "sem cadastro" ||
    normalized === "cliente sem cadastro" ||
    normalized === "sem contato" ||
    normalized === "contato whatsapp" ||
    /^whatsapp\s+\d{4,}$/.test(normalized)
  );
}

function formatIrisDisplayName(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return value;
  }

  return normalized
    .split(" ")
    .map((word, index) => formatIrisDisplayNameWord(word, index))
    .join(" ");
}

function formatIrisDisplayNameWord(word: string, index: number) {
  const lower = word.toLocaleLowerCase("pt-BR");
  const smallWords = new Set(["da", "das", "de", "do", "dos", "e"]);

  if (index > 0 && smallWords.has(lower)) {
    return lower;
  }

  return lower.replace(/(^|[-'`])(\p{L})/gu, (match, prefix, letter) => {
    return `${prefix}${letter.toLocaleUpperCase("pt-BR")}`;
  });
}

function maybeIrisOperatorLabel(value?: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized || normalized.includes("@")) {
    return null;
  }

  return formatIrisDisplayName(normalized);
}

function formatIrisOperatorLabel(value?: unknown) {
  return maybeIrisOperatorLabel(value) ?? "Operador Iris";
}

function assignedToLabelAfterMessage(ticket: IrisTicket, message: IrisMessage) {
  if (message.direction !== "outbound" || message.senderType !== "operator") {
    return ticket.assignedToLabel;
  }

  return maybeIrisOperatorLabel(message.senderLabel) ?? ticket.assignedToLabel;
}

function statusAfterMessage(
  ticket: IrisTicket,
  message: IrisMessage,
): IrisStatus {
  if (isClosedTicket(ticket)) {
    return ticket.status;
  }

  if (message.direction === "outbound" && message.senderType === "operator") {
    return "waiting_customer";
  }

  if (message.direction === "inbound" && ticket.status !== "new") {
    return "pending";
  }

  return ticket.status;
}

function formatIrisChannelLabel(value: string) {
  return (
    value
      .replace(/\s*Careli\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim() || value
  );
}

function isIrisRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractIrisApoloClientOptions(
  payload: unknown,
): IrisApoloClientOption[] {
  const payloadRecord = isIrisRecord(payload) ? payload : null;
  const data = isIrisRecord(payloadRecord?.data) ? payloadRecord.data : null;
  const entities = Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.entities)
      ? data.entities
      : [];

  return entities
    .map((rawEntity) => {
      const entity = isIrisRecord(rawEntity) ? rawEntity : null;

      if (!entity) {
        return null;
      }

      const phone = pickIrisApoloPhone(entity);

      if (!phone) {
        return null;
      }

      const label = formatIrisDisplayName(
        normalizeIrisText(entity.displayName) ??
          normalizeIrisText(entity.tradeName) ??
          normalizeIrisText(entity.legalName) ??
          "Cliente",
      );
      const profiles = Array.isArray(entity.profiles)
        ? entity.profiles.filter(
            (profile): profile is string => typeof profile === "string",
          )
        : [];

      return {
        documentMasked: normalizeIrisText(entity.documentMasked),
        firstName: extractFirstName(label),
        id: normalizeIrisIdentifier(entity.id, phone),
        label,
        locationLabel: normalizeIrisText(entity.locationLabel),
        phone,
        profileLabel: formatApoloProfileLabel(
          profiles,
          normalizeIrisText(entity.kind) ?? undefined,
        ),
        profiles,
      } satisfies IrisApoloClientOption;
    })
    .filter(Boolean) as IrisApoloClientOption[];
}

function pickIrisApoloPhone(entity: unknown) {
  const entityRecord = isIrisRecord(entity) ? entity : null;
  const directPhone = String(entityRecord?.phone ?? "").replace(/\D/g, "");

  if (directPhone.length >= 12 && directPhone.length <= 15) {
    return directPhone;
  }

  if (directPhone.length === 10 || directPhone.length === 11) {
    return `55${directPhone}`;
  }

  const contacts = Array.isArray(entityRecord?.contacts)
    ? entityRecord.contacts.filter(isIrisRecord)
    : [];
  const whatsapp =
    contacts.find((contact) => contact.type === "whatsapp") ??
    contacts.find((contact) => contact.type === "phone");
  const raw = String(whatsapp?.value ?? "").replace(/\D/g, "");

  if (raw.length >= 12 && raw.length <= 15) {
    return raw;
  }

  if (raw.length === 10 || raw.length === 11) {
    return `55${raw}`;
  }

  return null;
}

function formatApoloProfileLabel(profiles: string[], kind?: string) {
  const labels = profiles
    .map((profile) => profile.replace(/_/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((profile) => formatIrisDisplayName(profile));

  if (labels.length) {
    return labels.slice(0, 2).join(" | ");
  }

  if (kind === "pj") {
    return "Pessoa juridica";
  }

  if (kind === "pf") {
    return "Pessoa fisica";
  }

  return "Apolo";
}

function extractFirstName(value: string) {
  return value.split(/\s+/).filter(Boolean)[0] ?? "cliente";
}

function renderIrisOptInTemplate(firstName: string) {
  return IRIS_OPT_IN_TEMPLATE.bodyText.replace(
    "{{1}}",
    firstName || IRIS_OPT_IN_TEMPLATE.exampleName,
  );
}

function defaultIrisQueueId(
  queues: IrisQueueConfig[],
  preferredQueueLabel?: string | null,
) {
  const preferredLabel = normalizeIrisSelectionLabel(preferredQueueLabel);

  return (
    queues.find(
      (queue) =>
        queue.status === "active" &&
        preferredLabel &&
        normalizeIrisSelectionLabel(queue.name) === preferredLabel,
    )?.id ??
    queues.find(
      (queue) => queue.status === "active" && queue.slug === "atendimento",
    )?.id ??
    queues.find((queue) => queue.status === "active")?.id ??
    ""
  );
}

function normalizeIrisSelectionLabel(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function renderSelectedIrisTemplatePreview(
  template: IrisTemplate,
  firstName: string,
) {
  const variables = readTemplateVariables(template).map((variable) => {
    if (variable.key === "primeiro_nome" || variable.placeholder === "{{1}}") {
      return {
        ...variable,
        example:
          firstName || variable.example || IRIS_OPT_IN_TEMPLATE.exampleName,
      };
    }

    if (variable.key === "nome_cliente") {
      return {
        ...variable,
        example: firstName || variable.example,
      };
    }

    return variable;
  });

  return renderMetaTemplatePreview(
    template.body ?? IRIS_OPT_IN_TEMPLATE.bodyText,
    variables.length ? variables : IRIS_OPT_IN_TEMPLATE.variables,
  );
}

function createIrisTemplateForm() {
  return {
    bodyText: IRIS_OPT_IN_TEMPLATE.bodyText,
    buttonsText: IRIS_OPT_IN_TEMPLATE.buttons.join(", "),
    category: IRIS_OPT_IN_TEMPLATE.category,
    displayName: IRIS_OPT_IN_TEMPLATE.title,
    headerFileName: "",
    headerFormat: "NONE",
    headerHandle: "",
    headerMimeType: "",
    headerSendLink: "",
    language: IRIS_OPT_IN_TEMPLATE.language,
    name: IRIS_OPT_IN_TEMPLATE.name,
    phoneNumberId: "",
    queueLabel: "",
    subjectLabel: "",
    variables: [...IRIS_OPT_IN_TEMPLATE.variables],
  };
}

function createIrisTemplateDraft() {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(2, 16);

  return {
    ...createIrisTemplateForm(),
    displayName: "Novo template",
    name: `iris_template_${timestamp}`,
  };
}

function irisTemplateToForm(template: IrisTemplate) {
  const buttons = readTemplateButtons(template);
  const variables = readTemplateVariables(template);

  return {
    bodyText: template.body ?? IRIS_OPT_IN_TEMPLATE.bodyText,
    buttonsText: buttons.length
      ? buttons.join(", ")
      : IRIS_OPT_IN_TEMPLATE.buttons.join(", "),
    category:
      readTemplateMetadataString(template, "metaCategory") ??
      IRIS_OPT_IN_TEMPLATE.category,
    displayName: template.name,
    headerFileName:
      readTemplateMetadataString(template, "mediaHeaderFileName") ?? "",
    headerFormat: readTemplateHeaderFormat(template) ?? "NONE",
    headerHandle:
      readTemplateMetadataString(template, "mediaHeaderHandle") ?? "",
    headerMimeType:
      readTemplateMetadataString(template, "mediaHeaderMimeType") ?? "",
    headerSendLink:
      readTemplateMetadataString(template, "mediaHeaderSendLink") ?? "",
    language:
      readTemplateMetadataString(template, "metaLanguage") ??
      IRIS_OPT_IN_TEMPLATE.language,
    name: readTemplateMetaName(template) ?? template.slug.replace(/-/g, "_"),
    phoneNumberId:
      readTemplateMetadataString(template, "metaPhoneNumberId") ?? "",
    queueLabel: readTemplateQueueLabel(template),
    subjectLabel: readTemplateSubjectLabel(template),
    variables: variables.length
      ? variables
      : [...IRIS_OPT_IN_TEMPLATE.variables],
  };
}

function findIrisTemplateByMetaName(
  templates: IrisTemplate[],
  metaName: string,
) {
  const normalizedName = metaName.trim().toLowerCase();

  return templates.find((template) => {
    const metadataName = readTemplateMetaName(template)?.toLowerCase();

    return (
      metadataName === normalizedName ||
      template.slug === slugifyIrisProfile(normalizedName).replace(/_/g, "-") ||
      template.slug === normalizedName.replace(/_/g, "-")
    );
  });
}

function readTemplateMetaStatus(template?: IrisTemplate | null) {
  const status = readTemplateMetadataString(template, "metaStatus");

  return status ?? null;
}

function readTemplateMetaName(template?: IrisTemplate | null) {
  return readTemplateMetadataString(template, "metaTemplateName");
}

function readTemplatePhoneLabel(template?: IrisTemplate | null) {
  const displayNumber = readTemplateMetadataString(
    template,
    "metaPhoneDisplayNumber",
  );
  const label = readTemplateMetadataString(template, "metaPhoneLabel");

  return displayNumber ?? (isGenericMetaPhoneLabel(label) ? null : label);
}

function readTemplateQueueLabel(template?: IrisTemplate | null) {
  return (
    readTemplateMetadataString(template, "queueLabel") ??
    template?.category ??
    "Atendimento"
  );
}

function readTemplateSubjectLabel(template?: IrisTemplate | null) {
  const purpose = readTemplateMetadataString(template, "templatePurpose");

  return (
    readTemplateMetadataString(template, "subjectLabel") ??
    (purpose === "active_contact_opt_in" ? "Opt-in ativo" : null) ??
    "Sem assunto"
  );
}

function findMetaPhoneNumberOption(
  phoneNumbers: IrisMetaPhoneNumberOption[],
  id?: string | null,
) {
  const normalizedId = typeof id === "string" ? id.trim() : "";

  if (normalizedId) {
    return (
      phoneNumbers.find((phoneNumber) => phoneNumber.id === normalizedId) ??
      null
    );
  }

  return null;
}

function formatMetaPhoneNumberOption(
  phoneNumber?: IrisMetaPhoneNumberOption | null,
) {
  if (!phoneNumber) {
    return "Telefone nao selecionado";
  }

  const label = String(phoneNumber.label ?? "").trim();
  const verifiedName = String(phoneNumber.verifiedName ?? "").trim();
  const displayPhoneNumber = String(
    phoneNumber.displayPhoneNumber ?? "",
  ).trim();
  const usableLabel = isGenericMetaPhoneLabel(label) ? "" : label;

  return (
    [displayPhoneNumber, verifiedName].filter(Boolean).join(" - ") ||
    usableLabel ||
    `Telefone sem numero (${formatMetaPhoneIdSuffix(phoneNumber.id)})`
  );
}

function formatSelectedTemplatePhoneForDisplay({
  phoneNumber,
  phoneNumberId,
  template,
}: {
  phoneNumber?: IrisMetaPhoneNumberOption | null;
  phoneNumberId?: string | null;
  template?: IrisTemplate | null;
}) {
  return (
    (phoneNumber ? formatMetaPhoneNumberOption(phoneNumber) : null) ??
    readTemplatePhoneLabel(template) ??
    `Telefone sem numero (${formatMetaPhoneIdSuffix(phoneNumberId)})`
  );
}

function isGenericMetaPhoneLabel(value?: string | null) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  return (
    !normalized ||
    normalized === "telefone meta" ||
    normalized === "telefone meta configurado" ||
    normalized.startsWith("telefone nao identificado") ||
    normalized.startsWith("telefone não identificado")
  );
}

function formatMetaPhoneIdSuffix(value?: string | null) {
  const normalized = String(value ?? "").trim();

  return normalized ? `ID final ${normalized.slice(-4)}` : "ID Meta sem numero";
}

function readTemplateHeaderFormat(template?: IrisTemplate | null) {
  const format = readTemplateMetadataString(template, "mediaHeaderFormat");

  return format === "IMAGE" || format === "VIDEO" || format === "DOCUMENT"
    ? format
    : null;
}

function templateHeaderFormatLabel(format?: string | null) {
  if (format === "IMAGE") {
    return "Imagem";
  }

  if (format === "VIDEO") {
    return "Video";
  }

  if (format === "DOCUMENT") {
    return "Documento";
  }

  return "Sem midia";
}

function readTemplateStatusGroup(template?: IrisTemplate | null) {
  const status = readTemplateMetaStatus(template);

  if (isMetaTemplateApprovedStatus(status)) {
    return "APPROVED";
  }

  if (isMetaTemplatePendingStatus(status)) {
    return "PENDING";
  }

  if (isMetaTemplateUnavailableStatus(status)) {
    return "REJECTED";
  }

  return "NONE";
}

function readTemplateMetadataString(
  template: IrisTemplate | null | undefined,
  key: string,
) {
  const value = template?.metadata?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTemplateVariablesValue(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : null))
    .filter((item): item is string => Boolean(item));
}

function readTemplateButtons(template?: IrisTemplate | null) {
  const value = template?.metadata?.buttons;

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : null))
    .filter((item): item is string => Boolean(item));
}

function readTemplateVariables(template?: IrisTemplate | null) {
  const metadataVariables = template?.metadata?.variables;

  if (Array.isArray(metadataVariables)) {
    return metadataVariables
      .map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return null;
        }

        const variable = item as Record<string, unknown>;
        const key =
          typeof variable.key === "string" && variable.key.trim()
            ? variable.key.trim()
            : `variavel_${index + 1}`;
        const label =
          typeof variable.label === "string" && variable.label.trim()
            ? variable.label.trim()
            : key;
        const placeholder =
          typeof variable.placeholder === "string" &&
          variable.placeholder.trim()
            ? variable.placeholder.trim()
            : `{{${index + 1}}}`;
        const example =
          typeof variable.example === "string" && variable.example.trim()
            ? variable.example.trim()
            : label;

        return { example, key, label, placeholder };
      })
      .filter(Boolean);
  }

  return normalizeTemplateVariablesValue(template?.variables).map(
    (key, index) => {
      const known = IRIS_META_TEMPLATE_VARIABLES.find(
        (variable) => variable.key === key,
      );

      return {
        example: known?.example ?? key,
        key,
        label: known?.label ?? key,
        placeholder: known?.placeholder ?? `{{${index + 1}}}`,
      };
    },
  );
}

function parseTemplateButtons(value: string) {
  return value
    .split(/[,;\n]/)
    .map((button) => button.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function mergeTemplateVariable(
  current: typeof IRIS_OPT_IN_TEMPLATE.variables,
  variable: (typeof IRIS_META_TEMPLATE_VARIABLES)[number],
) {
  if (current.some((item) => item.key === variable.key)) {
    return current;
  }

  return [
    ...current,
    {
      example: variable.example,
      key: variable.key,
      label: variable.label,
      placeholder: variable.placeholder,
    },
  ];
}

function buildTemplateVariablesFromPreset(keys: string[]) {
  const uniqueKeys = unique(
    keys.map((key) => key.trim()).filter((key) => key.length > 0),
  );

  return uniqueKeys.map((key, index) => {
    const known = IRIS_META_TEMPLATE_VARIABLES.find(
      (variable) => variable.key === key,
    );

    return {
      example: known?.example ?? key,
      key,
      label: known?.label ?? key,
      placeholder: `{{${index + 1}}}`,
    };
  });
}

function renderMetaTemplatePreview(
  bodyText: string,
  variables: typeof IRIS_OPT_IN_TEMPLATE.variables,
) {
  return variables.reduce(
    (text, variable) =>
      text.replaceAll(variable.placeholder, variable.example || variable.label),
    bodyText,
  );
}

function sortIrisTemplatesForSetup(left: IrisTemplate, right: IrisTemplate) {
  const statusOrder: Record<string, number> = {
    PENDING: 0,
    REJECTED: 1,
    NONE: 2,
    APPROVED: 3,
  };
  const leftStatus = statusOrder[readTemplateStatusGroup(left)] ?? 9;
  const rightStatus = statusOrder[readTemplateStatusGroup(right)] ?? 9;

  if (leftStatus !== rightStatus) {
    return leftStatus - rightStatus;
  }

  return `${readTemplateQueueLabel(left)} ${readTemplateSubjectLabel(left)} ${left.name}`.localeCompare(
    `${readTemplateQueueLabel(right)} ${readTemplateSubjectLabel(right)} ${right.name}`,
    "pt-BR",
  );
}

function phoneNumberLinkFeedback(link?: IrisMetaPhoneNumberLink | null) {
  if (!link) {
    return null;
  }

  if (link.checkStatus === "checked" && link.linked === true) {
    return "Telefone de envio validado na WABA do template.";
  }

  if (link.checkStatus === "checked" && link.linked === false) {
    return "Crie um novo template para o telefone de envio.";
  }

  if (link.checkStatus === "missing_config") {
    return "Configuracao Meta incompleta para validar o telefone de envio.";
  }

  if (link.checkStatus === "unavailable") {
    return "Nao foi possivel validar se o telefone de envio pertence a WABA do template.";
  }

  return null;
}

function templateStatusLabel(status?: string | null) {
  if (isMetaTemplateApprovedStatus(status)) {
    return "Aprovado";
  }

  if (isMetaTemplatePendingStatus(status)) {
    return "Pendente";
  }

  if (normalizeMetaTemplateStatusKey(status) === "REJECTED") {
    return "Rejeitado";
  }

  if (isMetaTemplateUnavailableStatus(status)) {
    return "Indisponivel";
  }

  if (status === "NOT_FOUND") {
    return "Nao localizado";
  }

  return "Nao criado";
}

function templateStatusTone(status?: string | null) {
  if (isMetaTemplateApprovedStatus(status)) {
    return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  }

  if (isMetaTemplatePendingStatus(status)) {
    return "bg-amber-50 text-amber-700 ring-amber-100";
  }

  if (isMetaTemplateUnavailableStatus(status)) {
    return "bg-rose-50 text-rose-700 ring-rose-100";
  }

  if (status === "NOT_FOUND") {
    return "bg-subtle text-ink ring-slate-200";
  }

  return "bg-subtle text-ink-soft ring-slate-200";
}

function normalizeMetaTemplateStatusKey(status?: string | null) {
  return (
    status
      ?.trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_") ?? null
  );
}

function isMetaTemplateApprovedStatus(status?: string | null) {
  const normalized = normalizeMetaTemplateStatusKey(status);

  return (
    normalized === "APPROVED" ||
    normalized === "ACTIVE" ||
    Boolean(normalized?.startsWith("APPROVED_")) ||
    Boolean(normalized?.startsWith("ACTIVE_"))
  );
}

function isMetaTemplatePendingStatus(status?: string | null) {
  const normalized = normalizeMetaTemplateStatusKey(status);

  return (
    normalized === "PENDING" ||
    normalized === "IN_REVIEW" ||
    Boolean(normalized?.startsWith("PENDING_"))
  );
}

function isMetaTemplateUnavailableStatus(status?: string | null) {
  const normalized = normalizeMetaTemplateStatusKey(status);

  return (
    normalized === "DISABLED" ||
    normalized === "INACTIVE" ||
    normalized === "PAUSED" ||
    normalized === "REJECTED" ||
    Boolean(normalized?.startsWith("DISABLED_")) ||
    Boolean(normalized?.startsWith("INACTIVE_")) ||
    Boolean(normalized?.startsWith("PAUSED_")) ||
    Boolean(normalized?.startsWith("REJECTED_"))
  );
}

function formatPhoneForDisplay(value: string) {
  const digits = value.replace(/\D/g, "");
  const withoutCountry = digits.startsWith("55") ? digits.slice(2) : digits;

  if (withoutCountry.length === 11) {
    return `+55 (${withoutCountry.slice(0, 2)}) ${withoutCountry.slice(2, 7)}-${withoutCountry.slice(7)}`;
  }

  if (withoutCountry.length === 10) {
    return `+55 (${withoutCountry.slice(0, 2)}) ${withoutCountry.slice(2, 6)}-${withoutCountry.slice(6)}`;
  }

  return digits ? `+${digits}` : "-";
}

const irisSetupViewConstants = {
  IRIS_META_TEMPLATE_LIBRARY_PRESETS,
  IRIS_META_TEMPLATE_VARIABLES,
  IRIS_TEMPLATE_AUTO_REFRESH_MS,
  IRIS_TEMPLATE_HEADER_OPTIONS,
  IRIS_TEMPLATE_STATUS_FILTERS,
  priorityLabel,
  priorityOptions,
  setupStatusLabel,
  setupStatusOptions,
};

const irisSetupViewHelpers = {
  IrisTemplateFeedbackBox,
  buildTemplateVariablesFromPreset,
  createIrisTemplateDraft,
  createIrisTemplateFeedback,
  createIrisTemplateFeedbackFromPayload,
  createIrisTemplateForm,
  createProfileForm,
  createQueueForm,
  defaultIrisQueueId,
  findIrisTemplateByMetaName,
  findMetaPhoneNumberOption,
  formatCount,
  formatMetaPhoneNumberOption,
  formatSelectedTemplatePhoneForDisplay,
  formatSlaMinutes,
  getIrisAccessToken,
  irisTemplateToForm,
  mapQueueRow,
  mapTicketProfileRow,
  mergeTemplateVariable,
  normalizeIrisSelectionLabel,
  parseTemplateButtons,
  phoneNumberLinkFeedback,
  profileToForm,
  queueToForm,
  readIrisTemplateSyncNotificationId,
  readTemplateButtons,
  readTemplateHeaderFormat,
  readTemplateMetadataString,
  readTemplateMetaName,
  readTemplateMetaStatus,
  readTemplatePhoneLabel,
  readTemplateQueueLabel,
  readTemplateStatusGroup,
  readTemplateSubjectLabel,
  renderMetaTemplatePreview,
  saveIrisQueue,
  saveIrisTicketProfile,
  sortIrisProfiles,
  sortIrisQueues,
  sortIrisTemplatesForSetup,
  slugifyIrisProfile,
  slugifyIrisQueue,
  templateHeaderFormatLabel,
  templateStatusLabel,
  templateStatusTone,
  unique,
};

const irisStartAttendanceModalHelpers = {
  TemplateFeedbackBox: IrisTemplateFeedbackBox,
  createIrisTemplateFeedback,
  createIrisTemplateFeedbackFromPayload,
  defaultIrisQueueId,
  extractIrisApoloClientOptions,
  findMetaPhoneNumberOption,
  formatMetaPhoneNumberOption,
  formatPhoneForDisplay,
  formatSelectedTemplatePhoneForDisplay,
  getIrisAccessToken,
  irisOptInTemplate: IRIS_OPT_IN_TEMPLATE,
  isMetaTemplateApprovedStatus,
  isMetaTemplateUnavailableStatus,
  normalizeIrisSelectionLabel,
  phoneNumberLinkFeedback,
  readIrisTemplateSyncNotificationId,
  readTemplateButtons,
  readTemplateMetadataString,
  readTemplateMetaName,
  readTemplateMetaStatus,
  readTemplateQueueLabel,
  readTemplateSubjectLabel,
  renderSelectedIrisTemplatePreview,
  sortIrisProfiles,
  sortIrisQueues,
  sortIrisTemplatesForSetup,
  templateStatusLabel,
  templateStatusTone,
} satisfies IrisStartAttendanceModalHelpers;

async function saveIrisTicketProfile(
  form: ReturnType<typeof createProfileForm>,
) {
  const supabase = getHubSupabaseClient();

  if (!supabase) {
    throw new Error("Conexao do Supabase indisponivel para salvar o assunto.");
  }

  const payload = {
    category: form.category.trim(),
    description: form.description.trim() || null,
    name: form.name.trim(),
    priority: normalizePriority(form.priority),
    queue_id: form.queueId,
    required_fields: parseRequiredFields(form.requiredFields),
    sla_first_response_minutes: normalizePositiveInteger(
      form.slaFirstResponseMinutes,
      60,
    ),
    sla_resolution_minutes: normalizePositiveInteger(
      form.slaResolutionMinutes,
      480,
    ),
    slug: slugifyIrisProfile(form.slug || form.name),
    status: setupStatusOptions.includes(form.status) ? form.status : "active",
  };
  const selectColumns =
    "id,queue_id,name,slug,category,priority,sla_first_response_minutes,sla_resolution_minutes,description,required_fields,status";

  const result = form.id
    ? await supabase
        .from("caredesk_ticket_profiles")
        .update(payload)
        .eq("id", form.id)
        .select(selectColumns)
        .single()
    : await supabase
        .from("caredesk_ticket_profiles")
        .upsert(payload, { onConflict: "queue_id,slug" })
        .select(selectColumns)
        .single();

  if (result.error || !result.data) {
    throw new Error(
      result.error?.message ?? "Nao foi possivel salvar o assunto.",
    );
  }

  return result.data;
}

async function saveIrisQueue(form: ReturnType<typeof createQueueForm>) {
  const supabase = getHubSupabaseClient();

  if (!supabase) {
    throw new Error("Conexao do Supabase indisponivel para salvar a fila.");
  }

  const payload = {
    assignment_strategy: form.assignmentStrategy.trim() || "manual",
    color: /^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : "#A07C3B",
    default_priority: normalizePriority(form.defaultPriority),
    // Vínculo fila→número (canal WhatsApp). metadata das filas só guarda isso hoje.
    metadata: { channelId: form.channelId.trim() || null },
    name: form.name.trim(),
    routing_strategy: form.routingStrategy.trim() || "manual",
    sla_first_response_minutes: normalizePositiveInteger(
      form.slaFirstResponseMinutes,
      60,
    ),
    sla_resolution_minutes: normalizePositiveInteger(
      form.slaResolutionMinutes,
      480,
    ),
    slug: slugifyIrisQueue(form.slug || form.name),
    status: setupStatusOptions.includes(form.status) ? form.status : "active",
  };
  const selectColumns =
    "id,name,slug,color,status,default_priority,sla_first_response_minutes,sla_resolution_minutes,routing_strategy,assignment_strategy,metadata";

  const result = form.id
    ? await supabase
        .from("caredesk_queues")
        .update(payload)
        .eq("id", form.id)
        .select(selectColumns)
        .single()
    : await supabase
        .from("caredesk_queues")
        .upsert(payload, { onConflict: "slug" })
        .select(selectColumns)
        .single();

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? "Nao foi possivel salvar a fila.");
  }

  return result.data;
}

function ticketScore(ticket: IrisTicket) {
  return (
    (ticket.priority === "critical" ? 500 : 0) +
    (ticket.priority === "high" ? 250 : 0) +
    (isSlaCritical(ticket) ? 300 : 0) +
    (isWaitingForIris(ticket) ? 180 : 0) +
    (effectiveIrisStatus(ticket) === "waiting_operator" ? 120 : 0)
  );
}

function sortIrisTickets(first: IrisTicket, second: IrisTicket) {
  const scoreDifference = ticketScore(second) - ticketScore(first);
  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  return dateValue(second.openedAt) - dateValue(first.openedAt);
}

function sortIrisProfiles(
  first: IrisTicketProfileConfig,
  second: IrisTicketProfileConfig,
) {
  return (
    first.queueLabel.localeCompare(second.queueLabel, "pt-BR") ||
    first.category.localeCompare(second.category, "pt-BR") ||
    first.name.localeCompare(second.name, "pt-BR")
  );
}

function sortIrisQueues(first: IrisQueueConfig, second: IrisQueueConfig) {
  return first.name.localeCompare(second.name, "pt-BR");
}

function createQueueForm() {
  return {
    assignmentStrategy: "manual",
    channelId: "",
    color: "#A07C3B",
    defaultPriority: "medium" as IrisPriority,
    id: "",
    name: "",
    routingStrategy: "manual",
    slaFirstResponseMinutes: "60",
    slaResolutionMinutes: "480",
    slug: "",
    status: "active",
  };
}

function queueToForm(queue: IrisQueueConfig) {
  return {
    assignmentStrategy: queue.assignmentStrategy,
    channelId: queue.channelId ?? "",
    color: queue.color || "#A07C3B",
    defaultPriority: queue.defaultPriority,
    id: queue.id,
    name: queue.name,
    routingStrategy: queue.routingStrategy,
    slaFirstResponseMinutes: String(queue.slaFirstResponseMinutes),
    slaResolutionMinutes: String(queue.slaResolutionMinutes),
    slug: queue.slug,
    status: queue.status,
  };
}

function createProfileForm(queueId = "") {
  return {
    category: "Atendimento",
    description: "",
    id: "",
    name: "",
    priority: "medium" as IrisPriority,
    queueId,
    requiredFields: "contact_id, queue_id",
    slaFirstResponseMinutes: "60",
    slaResolutionMinutes: "480",
    slug: "",
    status: "active",
  };
}

function profileToForm(profile: IrisTicketProfileConfig) {
  return {
    category: profile.category,
    description: profile.description ?? "",
    id: profile.id,
    name: profile.name,
    priority: profile.priority,
    queueId: profile.queueId ?? "",
    requiredFields: profile.requiredFields.join(", "),
    slaFirstResponseMinutes: String(profile.slaFirstResponseMinutes),
    slaResolutionMinutes: String(profile.slaResolutionMinutes),
    slug: profile.slug,
    status: profile.status,
  };
}

function normalizeRequiredFields(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(String)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      return parseRequiredFields(value);
    }
  }

  return [];
}

function parseRequiredFields(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePositiveInteger(value: string | number, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function slugifyIrisProfile(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "assunto-atendimento";
}

function slugifyIrisQueue(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "fila-atendimento";
}

function normalizeOptionalIrisQueueSlug(value?: string | null) {
  const trimmed = String(value ?? "").trim();

  return trimmed ? slugifyIrisQueue(trimmed) : null;
}

function isSameIrisQueueScope(
  queue: IrisQueueConfig,
  normalizedQueueSlug: string,
) {
  return [queue.slug, queue.name]
    .map((value) => normalizeOptionalIrisQueueSlug(value))
    .includes(normalizedQueueSlug);
}

function formatSlaMinutes(minutes: number) {
  if (minutes >= 1440) {
    return `${Math.round(minutes / 1440)}d`;
  }

  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  return `${minutes} min`;
}

function normalizePriority(value: unknown): IrisPriority {
  if (
    value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low"
  ) {
    return value;
  }

  return "medium";
}

function normalizeStatus(value: unknown): IrisStatus {
  if (
    value === "new" ||
    value === "open" ||
    value === "waiting_customer" ||
    value === "waiting_operator" ||
    value === "pending" ||
    value === "resolved" ||
    value === "closed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return "new";
}

function isClosedTicket(ticket: IrisTicket) {
  return ["cancelled", "closed", "resolved"].includes(ticket.status);
}

// Ticket de e-mail (canal kind=email; provider=gmail no source_context como reforço).
// E-mail não tem a janela de 24h do WhatsApp e responde por outro transporte (Gmail API).
function isEmailTicket(ticket: IrisTicket) {
  if (ticket.channelKind === "email") {
    return true;
  }

  const provider = ticket.sourceContext?.["provider"];

  return typeof provider === "string" && provider.toLowerCase() === "gmail";
}

function effectiveIrisStatus(ticket: IrisTicket): IrisStatus {
  if (shouldPromoteNewTicketToPending(ticket)) {
    return "pending";
  }

  return ticket.status;
}

function shouldPromoteNewTicketToPending(ticket: IrisTicket) {
  if (ticket.status !== "new" || hasCareliResponse(ticket)) {
    return false;
  }

  const openedAt = dateValue(ticket.openedAt);

  if (!openedAt) {
    return false;
  }

  return Date.now() - openedAt >= 3 * 60 * 1000;
}

function hasCareliResponse(ticket: IrisTicket) {
  return (
    Boolean(ticket.firstRespondedAt) || getFirstCareliResponseAt(ticket) > 0
  );
}

function ticketOrigin(ticket: IrisTicket): IrisOrigin {
  const firstMessage = sortedTicketMessages(ticket).filter(
    (message) => message.direction !== "internal",
  )[0];

  if (firstMessage && isCareliMessage(firstMessage)) {
    return "active";
  }

  return "passive";
}

function filterTicketsByBoardOwner(
  tickets: IrisTicket[],
  ownerView: "Todos" | "Cacá" | "Operadores",
) {
  return tickets.filter((ticket) => {
    if (ownerView === "Todos") {
      return true;
    }

    if (ownerView === "Cacá") {
      return isCacaOwnedTicket(ticket);
    }

    return isOperatorOwnedTicket(ticket);
  });
}

function isCacaOwnedTicket(ticket: IrisTicket) {
  if (isClosedTicket(ticket)) {
    return false;
  }

  if (
    isTicketMarkedForOperator(ticket) ||
    isActiveContactOriginTicket(ticket)
  ) {
    return false;
  }

  const assignedToCaca =
    normalizeIrisOwnerKey(ticket.assignedToLabel) === "caca";
  const cacaAutomation = readCacaAutomationFromTicket(ticket);

  if (readTicketRecordBoolean(cacaAutomation, "handoffRequired")) {
    return false;
  }

  if (assignedToCaca || cacaAutomation) {
    return true;
  }

  return (
    effectiveIrisStatus(ticket) === "waiting_customer" &&
    ticketOrigin(ticket) === "passive"
  );
}

function isOperatorOwnedTicket(ticket: IrisTicket) {
  if (isClosedTicket(ticket)) {
    return false;
  }

  return !isCacaOwnedTicket(ticket);
}

function isTicketMarkedForOperator(ticket: IrisTicket) {
  const metadata = ticket.metadata;
  const handlingOwner = normalizeIrisOwnerKey(
    readTicketRecordString(metadata, "handlingOwner"),
  );
  const status = effectiveIrisStatus(ticket);

  if (handlingOwner === "operator") {
    return true;
  }

  if (
    status === "waiting_operator" ||
    status === "open" ||
    status === "pending"
  ) {
    return true;
  }

  const cacaAutomation = readCacaAutomationFromTicket(ticket);

  if (readTicketRecordBoolean(cacaAutomation, "handoffRequired")) {
    return true;
  }

  const assignedOwner = normalizeIrisOwnerKey(ticket.assignedToLabel);

  return assignedOwner !== "sem-responsavel" && assignedOwner !== "caca";
}

function isActiveContactOriginTicket(ticket: IrisTicket) {
  const activeConsent = readTicketRecordString(
    ticket.metadata,
    "activeContactConsent",
  );
  const sourceContactOrigin = readTicketRecordString(
    ticket.sourceContext,
    "contactOrigin",
  );

  if (sourceContactOrigin === "active") {
    return true;
  }

  return activeConsent === "awaiting_customer_reply";
}

function normalizeIrisOwnerKey(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function readCacaAutomationFromTicket(ticket: IrisTicket) {
  const metadata = ticket.metadata;

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const raw = metadata.cacaAutomation;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  return raw as Record<string, unknown>;
}

function readTicketRecordBoolean(
  record: Record<string, unknown> | null | undefined,
  key: string,
) {
  return record?.[key] === true;
}

function ticketResponseTimeLabel(ticket: IrisTicket) {
  const currentWait = getCurrentCustomerWaitMinutes(ticket);

  if (currentWait !== null) {
    return formatDuration(currentWait);
  }

  const responseTimes = ticketResponseTimeMinutes(ticket);

  if (responseTimes.length) {
    return formatDuration(average(responseTimes));
  }

  return "-";
}

function ticketResponseTimeState(ticket: IrisTicket) {
  if (getCurrentCustomerWaitMinutes(ticket) !== null) {
    return "Aguardando";
  }

  if (isClosedTicket(ticket)) {
    return "Encerrado";
  }

  return hasCareliResponse(ticket) ? "Respondido" : "Sem dados";
}

function sortedTicketMessages(ticket: IrisTicket) {
  return [...ticket.messages].sort(
    (first, second) => dateValue(first.createdAt) - dateValue(second.createdAt),
  );
}

function isCareliMessage(message: IrisMessage) {
  return message.direction === "outbound" || message.senderType === "operator";
}

function isCustomerMessage(message: IrisMessage) {
  return message.direction === "inbound" || message.senderType === "customer";
}

function getIrisCustomerServiceWindow(
  ticket: IrisTicket,
  tickets: IrisTicket[],
) {
  // E-mail não tem janela de 24h (isso é regra do WhatsApp/Meta): a resposta por e-mail
  // fica sempre liberada. Curto-circuito antes de qualquer cálculo de janela.
  if (isEmailTicket(ticket)) {
    return {
      contextLabel: "E-mail",
      expiresAt: null,
      label: "Resposta por e-mail sempre liberada.",
      lastCustomerMessageAt: null,
      open: true,
      reason: "open" as const,
    };
  }

  const relatedTickets = getRelatedTicketsForCustomerServiceWindow(
    ticket,
    tickets,
  );
  const lastCustomerMessageAt =
    relatedTickets
      .map((currentTicket) => {
        const metadataLastMessageAt = readTicketRecordString(
          currentTicket.metadata,
          "lastCustomerMessageAt",
        );
        const metadataOpenedAt = readTicketRecordString(
          currentTicket.metadata,
          "customerServiceWindowOpenedAt",
        );
        const inboundMessages =
          sortedTicketMessages(currentTicket).filter(isCustomerMessage);
        const lastInbound = inboundMessages[inboundMessages.length - 1];

        return (
          metadataLastMessageAt ??
          metadataOpenedAt ??
          lastInbound?.sentAt ??
          lastInbound?.createdAt ??
          null
        );
      })
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => dateValue(right) - dateValue(left))[0] ?? null;
  const lastCustomerMessageTime = dateValue(lastCustomerMessageAt);

  if (!lastCustomerMessageTime) {
    return {
      contextLabel: "Sem resposta do cliente",
      expiresAt: null,
      label:
        "Aguardando resposta do cliente. O WhatsApp libera mensagem livre apenas depois da resposta ao template.",
      lastCustomerMessageAt: null,
      open: false,
      reason: "no_customer_reply" as const,
    };
  }

  const expiresAt = new Date(
    lastCustomerMessageTime + 24 * 60 * 60 * 1000,
  ).toISOString();
  const expiresAtTime = dateValue(expiresAt);
  const open = Boolean(expiresAtTime && Date.now() < expiresAtTime);

  if (open) {
    return {
      contextLabel: `Aberta ate ${formatDateTime(expiresAt)}`,
      expiresAt,
      label: `Janela WhatsApp aberta ate ${formatDateTime(expiresAt)}.`,
      lastCustomerMessageAt,
      open,
      reason: "open" as const,
    };
  }

  return {
    contextLabel: `Fechada em ${formatDateTime(expiresAt)}`,
    expiresAt,
    label:
      "Janela de 24h fechada. Envie um template aprovado e aguarde nova resposta do cliente.",
    lastCustomerMessageAt,
    open,
    reason: "expired" as const,
  };
}

function getRelatedTicketsForCustomerServiceWindow(
  ticket: IrisTicket,
  tickets: IrisTicket[],
) {
  const ticketPhone = normalizeIrisPhoneDigits(ticket.contactPhone);
  const ticketId = ticket.contactId?.trim();

  return tickets.filter((candidate) => {
    if (ticketId && candidate.contactId) {
      if (candidate.contactId === ticketId) {
        return true;
      }
    }

    if (ticketPhone) {
      return matchesIrisPhoneDigits(ticketPhone, candidate.contactPhone);
    }

    return candidate.contactLabel === ticket.contactLabel;
  });
}

function readTicketRecordString(
  record: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = record?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getFirstCareliResponseAt(ticket: IrisTicket) {
  const firstRespondedAt = dateValue(ticket.firstRespondedAt);

  if (firstRespondedAt) {
    return firstRespondedAt;
  }

  const openedAt = dateValue(ticket.openedAt);
  const firstResponse = sortedTicketMessages(ticket).find((message) => {
    return isCareliMessage(message) && dateValue(message.createdAt) >= openedAt;
  });

  return dateValue(firstResponse?.createdAt);
}

function ticketResponseTimeMinutes(ticket: IrisTicket) {
  const waits: number[] = [];
  let waitingFrom: number | null = null;

  sortedTicketMessages(ticket).forEach((message) => {
    const createdAt = dateValue(message.createdAt);

    if (!createdAt) {
      return;
    }

    if (isCustomerMessage(message) && waitingFrom === null) {
      waitingFrom = createdAt;
      return;
    }

    if (
      isCareliMessage(message) &&
      waitingFrom !== null &&
      createdAt >= waitingFrom
    ) {
      waits.push((createdAt - waitingFrom) / 60000);
      waitingFrom = null;
    }
  });

  return waits;
}

function getCurrentCustomerWaitMinutes(ticket: IrisTicket) {
  if (isClosedTicket(ticket)) {
    return null;
  }

  let waitingFrom: number | null = null;

  sortedTicketMessages(ticket).forEach((message) => {
    const createdAt = dateValue(message.createdAt);

    if (!createdAt) {
      return;
    }

    if (isCustomerMessage(message)) {
      waitingFrom = waitingFrom ?? createdAt;
      return;
    }

    if (isCareliMessage(message)) {
      waitingFrom = null;
    }
  });

  return waitingFrom === null
    ? null
    : Math.max(0, Date.now() - waitingFrom) / 60000;
}

function isClosedToday(ticket: IrisTicket) {
  if (!isClosedTicket(ticket)) {
    return false;
  }

  const today = new Date().toDateString();
  return (
    new Date(ticket.lastMessageAt ?? ticket.openedAt).toDateString() === today
  );
}

function isWaitingForIris(ticket: IrisTicket) {
  const status = effectiveIrisStatus(ticket);

  return (
    !isClosedTicket(ticket) &&
    (ticket.unread ||
      status === "new" ||
      status === "pending" ||
      status === "waiting_operator")
  );
}

function isSlaCritical(ticket: IrisTicket) {
  const due = ticket.firstRespondedAt
    ? ticket.resolutionDueAt
    : (ticket.firstResponseDueAt ?? ticket.resolutionDueAt);

  if (!due || isClosedTicket(ticket)) {
    return false;
  }

  return new Date(due).getTime() <= Date.now();
}

function slaLabel(ticket: IrisTicket) {
  if (isClosedTicket(ticket)) {
    return "Encerrado";
  }

  const due = ticket.firstRespondedAt
    ? ticket.resolutionDueAt
    : (ticket.firstResponseDueAt ?? ticket.resolutionDueAt);

  if (!due) {
    return "Sem SLA";
  }

  const diffMinutes = Math.round(
    (new Date(due).getTime() - Date.now()) / 60000,
  );

  if (diffMinutes <= 0) {
    return "Vencido";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} min`;
  }

  return `${Math.floor(diffMinutes / 60)}h ${diffMinutes % 60}m`;
}

function slaClasses(ticket: IrisTicket) {
  if (isClosedTicket(ticket)) {
    return "bg-subtle text-ink-soft ring-slate-200";
  }

  if (isSlaCritical(ticket)) {
    return "bg-rose-50 text-rose-700 ring-rose-100";
  }

  return "bg-emerald-50 text-emerald-700 ring-emerald-100";
}

function statusTone(status: IrisStatus) {
  if (status === "closed" || status === "resolved" || status === "cancelled") {
    return "green";
  }

  if (status === "new") {
    return "blue";
  }

  if (status === "waiting_customer") {
    return "gold";
  }

  if (
    status === "waiting_operator" ||
    status === "pending" ||
    status === "open"
  ) {
    return "danger";
  }

  return "neutral";
}

function estimateFirstResponse(tickets: IrisTicket[]) {
  const responseTimes = tickets
    .map((ticket) => {
      const openedAt = dateValue(ticket.openedAt);
      const firstResponseAt = getFirstCareliResponseAt(ticket);

      return openedAt && firstResponseAt
        ? Math.max(0, firstResponseAt - openedAt) / 60000
        : null;
    })
    .filter((minutes): minutes is number => minutes !== null);

  if (!responseTimes.length) {
    return "Sem dados";
  }

  return formatDuration(average(responseTimes));
}

function estimateAverageResponse(tickets: IrisTicket[]) {
  const responseTimes = tickets.flatMap(ticketResponseTimeMinutes);

  if (!responseTimes.length) {
    return "Sem dados";
  }

  return formatDuration(average(responseTimes));
}

function estimateAverageHandlingTime(tickets: IrisTicket[]) {
  const handlingTimes = tickets
    .map((ticket) => {
      const openedAt = dateValue(ticket.openedAt);
      const closedAt =
        dateValue(ticket.closedAt) || dateValue(ticket.resolvedAt);

      return openedAt && closedAt
        ? Math.max(0, closedAt - openedAt) / 60000
        : null;
    })
    .filter((minutes): minutes is number => minutes !== null);

  if (!handlingTimes.length) {
    return "Sem dados";
  }

  return formatDuration(average(handlingTimes));
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatDuration(minutes: number) {
  if (!Number.isFinite(minutes)) {
    return "Sem dados";
  }

  const rounded = Math.round(minutes);

  if (rounded < 60) {
    return `${rounded}m`;
  }

  return `${Math.floor(rounded / 60)}h ${rounded % 60}m`;
}

function labelForSource(source: string) {
  if (source === "manual") {
    return "Entrada manual";
  }

  if (source === "support") {
    return "Suporte ao cliente";
  }

  return "Acionamento externo";
}

function formatCount(value: number) {
  return Number(value ?? 0).toLocaleString("pt-BR");
}

function collectIrisMessageIds(data: IrisData) {
  return new Set(
    data.tickets.flatMap((ticket) =>
      ticket.messages.map((message) => message.id).filter(Boolean),
    ),
  );
}

function createReplyPreview(message: IrisMessage): IrisReplyPreview {
  return {
    body: irisMessagePreview(message),
    createdAt: message.createdAt,
    direction: message.direction,
    externalMessageId: message.externalMessageId ?? null,
    messageId: message.id,
    senderLabel:
      message.senderLabel ??
      (message.direction === "inbound" ? "Cliente" : "Operador Iris"),
  };
}

function irisMessagePreview(message: IrisMessage) {
  if (message.messageType === "audio") {
    return "Audio WhatsApp";
  }

  if (message.messageType && message.messageType !== "text") {
    return message.body || `Mensagem ${message.messageType}`;
  }

  return message.body || "Mensagem sem texto";
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Nao foi possivel ler o audio."));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Audio invalido."));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Nao foi possivel ler a imagem."));
    img.src = src;
  });
}

// Prepara a imagem de saída: PNG/JPG pequeno passa direto; grande é reduzido (máx 1600px)
// e reexportado em JPEG pra caber no body da requisição. Meta aceita jpg/png.
async function prepareOutboundImage(
  file: File,
): Promise<{ dataUrl: string; fileName: string; mimeType: string }> {
  const MAX_DIM = 1600;
  const passthroughOk =
    (file.type === "image/jpeg" || file.type === "image/png") &&
    file.size <= 900_000;
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageElement(objectUrl);
    const scale = Math.min(1, MAX_DIM / Math.max(image.width, image.height));

    if (scale === 1 && passthroughOk) {
      const dataUrl = await readBlobAsDataUrl(file);

      return {
        dataUrl,
        fileName: file.name || "imagem",
        mimeType: file.type,
      };
    }

    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      const dataUrl = await readBlobAsDataUrl(file);

      return {
        dataUrl,
        fileName: file.name || "imagem",
        mimeType: file.type,
      };
    }

    context.drawImage(image, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const baseName = (file.name || "imagem").replace(/\.[^.]+$/, "");

    return { dataUrl, fileName: `${baseName}.jpg`, mimeType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function formatAudioDuration(durationMs?: number | null) {
  if (!durationMs || !Number.isFinite(durationMs)) {
    return "0:00";
  }

  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getContactAvatarUrl(contact: unknown) {
  const contactRecord = isIrisRecord(contact) ? contact : null;
  const metadata = isIrisRecord(contactRecord?.metadata)
    ? contactRecord.metadata
    : null;
  const c2xPayload = isIrisRecord(contactRecord?.c2x_payload)
    ? contactRecord.c2x_payload
    : null;
  const candidates = [
    metadata?.avatar_url,
    metadata?.avatarUrl,
    metadata?.profile_picture_url,
    metadata?.profilePictureUrl,
    metadata?.profile_photo_url,
    metadata?.profilePhotoUrl,
    metadata?.picture,
    metadata?.image,
    c2xPayload?.avatar_url,
    c2xPayload?.avatarUrl,
    c2xPayload?.profile_picture_url,
    c2xPayload?.profilePictureUrl,
    c2xPayload?.picture,
  ];

  return candidates.find(isUsableUrl) ?? null;
}

function isUsableUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^https?:\/\//i.test(value.trim()) &&
    value.trim().length <= 2048
  );
}

function contactInitials(name: string) {
  const words = name
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (!words.length) {
    return "IR";
  }

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
}

function normalizeIrisPhoneDigits(value?: string | null) {
  if (!value) {
    return "";
  }

  return String(value).replace(/\D+/g, "");
}

function matchesIrisPhoneDigits(expected: string, current?: string | null) {
  const left = normalizeIrisPhoneDigits(expected);
  const right = normalizeIrisPhoneDigits(current);

  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  const minComparableLength = 10;
  const rightTail = right.slice(-minComparableLength);
  const leftTail = left.slice(-minComparableLength);

  return (
    (right.length >= minComparableLength && left.endsWith(rightTail)) ||
    (left.length >= minComparableLength && right.endsWith(leftTail))
  );
}

function pickIrisApoloEntityForTicket(
  entities: IrisApoloContextEntity[],
  ticket: IrisTicket,
) {
  if (!entities.length) {
    return null;
  }

  const registeredEntityId = ticket.crm360Registration?.entityId?.trim();

  if (registeredEntityId) {
    const byId = entities.find((entity) => entity.id === registeredEntityId);

    if (byId) {
      return byId;
    }
  }

  const ticketPhone = normalizeIrisPhoneDigits(ticket.contactPhone);

  if (ticketPhone) {
    const byPhone = entities.find((entity) =>
      (entity.contacts ?? []).some((contact) =>
        matchesIrisPhoneDigits(ticketPhone, contact?.value),
      ),
    );

    if (byPhone) {
      return byPhone;
    }
  }

  return entities[0] ?? null;
}

function hasIrisRegisteredUserProfile(
  registration?: IrisCrm360Registration | null,
) {
  if (registration?.status !== "registered") {
    return false;
  }

  const labels = [
    registration.profileLabel ?? "",
    ...(registration.profiles ?? []),
  ]
    .join(" ")
    .toLowerCase();

  return labels.includes("usuario");
}

function hasIrisApoloUserPortfolio(entity?: IrisApoloContextEntity | null) {
  if (!entity) {
    return false;
  }

  const hasUserProfile = (entity.profiles ?? []).some(
    (profile) => profile === "usuario",
  );

  if (!hasUserProfile) {
    return false;
  }

  return (entity.commercialLinks ?? []).some((link) => {
    const normalizedRole = (link.role ?? "").toLowerCase().trim();
    const hasEligibleRole =
      normalizedRole === "usuario" || normalizedRole === "usuario comprador";

    const hasEvidence = Boolean(
      (link.unitCode ?? "").trim() ||
      (link.unit ?? "").trim() ||
      (link.referenceLabel ?? "").trim() ||
      (link.tableValue ?? "").trim() ||
      (link.installments?.length ?? 0),
    );

    return hasEligibleRole && hasEvidence;
  });
}

function formatIrisApoloProfiles(profiles?: string[] | null) {
  if (!profiles?.length) {
    return "-";
  }

  return profiles
    .map((profile) => profile.replace(/_/g, " "))
    .map((profile) => formatIrisDisplayName(profile))
    .join(" | ");
}

function buildIrisApoloAgendaItems(
  entity?: IrisApoloContextEntity | null,
): IrisAgendaTimelineEntry[] {
  if (!entity) {
    return [];
  }

  const timelineItems = (entity.timeline ?? []).map((event, index) => ({
    dateLabel:
      formatDateTime(event.date) !== "-"
        ? formatDateTime(event.date)
        : (event.date ?? "Sem data"),
    dateValue: dateValue(event.date),
    description: event.description ?? "Registro operacional no relacionamento.",
    id: `timeline-${index}-${event.title ?? "evento"}`,
    kindLabel: "Timeline",
    scheduledAt: event.date ?? null,
    source: "apolo" as const,
    title: event.title ?? "Evento de relacionamento",
    tone:
      event.status === "blocked"
        ? ("danger" as const)
        : event.status === "attention"
          ? ("gold" as const)
          : ("success" as const),
  }));
  const installmentItems = (entity.commercialLinks ?? []).flatMap(
    (link, linkIndex) =>
      (link.installments ?? []).map((installment, installmentIndex) => ({
        dateLabel:
          formatDateTime(installment.paidAt ?? installment.dueDate) !== "-"
            ? formatDateTime(installment.paidAt ?? installment.dueDate)
            : (installment.paidAt ?? installment.dueDate ?? "Sem data"),
        dateValue: dateValue(installment.paidAt ?? installment.dueDate),
        description: `${link.enterprise ?? "Carteira"} · ${installment.value ?? "-"}`,
        id: `installment-${linkIndex}-${installment.id ?? installmentIndex}`,
        kindLabel: "Pagamento",
        scheduledAt: installment.paidAt ?? installment.dueDate ?? null,
        source: "apolo" as const,
        title: `${installment.reference ?? "Parcela"} · ${installment.status ?? "Sem status"}`,
        tone:
          installment.status === "Vencida"
            ? ("danger" as const)
            : installment.status === "A vencer"
              ? ("gold" as const)
              : ("success" as const),
      })),
  );
  const serviceItems = (entity.serviceSignals ?? []).map((signal, index) => ({
    dateLabel:
      formatDateTime(signal.lastEvent) !== "-"
        ? formatDateTime(signal.lastEvent)
        : (signal.lastEvent ?? "Sem data"),
    dateValue: dateValue(signal.lastEvent),
    description: `Protocolo ${signal.protocol ?? "-"} · ${signal.status ?? "-"}`,
    id: `service-${index}-${signal.protocol ?? "protocolo"}`,
    kindLabel: "Atendimento",
    scheduledAt: signal.lastEvent ?? null,
    source: "apolo" as const,
    title: signal.channel ?? "Canal de atendimento",
    tone: "success" as const,
  }));

  return [...timelineItems, ...installmentItems, ...serviceItems].sort(
    (first, second) => second.dateValue - first.dateValue,
  );
}

function readIrisTicketContextNote(
  metadata?: Record<string, unknown> | null,
): IrisTicketContextNote | null {
  const raw = metadata?.operatorContextNote;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const text = normalizeIrisText(record.text);

  if (!text) {
    return null;
  }

  return {
    text,
    updatedAt: normalizeIrisText(record.updatedAt),
    updatedByUserId: normalizeIrisText(record.updatedByUserId),
  };
}

function readIrisTicketContextAgendaEvents(
  metadata?: Record<string, unknown> | null,
) {
  const raw = metadata?.contextAgendaEvents;

  if (!Array.isArray(raw)) {
    return [];
  }

  return sortIrisTicketContextAgendaEvents(
    raw
      .map((event, index) => {
        if (!event || typeof event !== "object" || Array.isArray(event)) {
          return null;
        }

        const record = event as Record<string, unknown>;
        const title = normalizeIrisText(record.title);
        const scheduledAt = normalizeDateInputToIso(record.scheduledAt);

        if (!title || !scheduledAt) {
          return null;
        }

        return {
          createdAt: normalizeDateInputToIso(record.createdAt),
          createdByLabel:
            normalizeIrisText(record.createdByLabel) ?? "Operador Iris",
          id:
            normalizeIrisText(record.id) ?? `ctx-event-${index}-${scheduledAt}`,
          kind: normalizeIrisText(record.kind) ?? "atividade",
          notes: normalizeIrisText(record.notes),
          scheduledAt,
          status: normalizeIrisText(record.status) ?? "planned",
          title,
        };
      })
      .filter((event): event is IrisTicketContextAgendaEvent => Boolean(event)),
  );
}

function sortIrisTicketContextAgendaEvents(
  events: IrisTicketContextAgendaEvent[],
) {
  return [...events].sort(
    (first, second) =>
      dateValue(second.scheduledAt) - dateValue(first.scheduledAt),
  );
}

function buildIrisMergedAgendaEntries({
  entity,
  events,
}: {
  entity?: IrisApoloContextEntity | null;
  events: IrisTicketContextAgendaEvent[];
}) {
  const apoloItems = buildIrisApoloAgendaItems(entity);
  const ticketItems: IrisAgendaTimelineEntry[] = events.map((event) => ({
    createdAt: event.createdAt ?? null,
    createdByLabel: event.createdByLabel ?? null,
    dateLabel: formatDateTime(event.scheduledAt),
    dateValue: dateValue(event.scheduledAt),
    description:
      event.notes?.trim() ||
      `Atividade criada pelo operador (${event.createdByLabel ?? "Iris"}).`,
    id: event.id,
    kindLabel: formatIrisAgendaKind(event.kind),
    scheduledAt: event.scheduledAt,
    source: "ticket",
    title: event.title,
    tone: "gold",
  }));

  return [...ticketItems, ...apoloItems].sort(
    (first, second) => second.dateValue - first.dateValue,
  );
}

function buildIrisAgendaCalendar(
  monthCursorIso: string,
  items: IrisAgendaTimelineEntry[],
) {
  const monthCursorDate = new Date(monthCursorIso);
  const monthStart = Number.isNaN(monthCursorDate.getTime())
    ? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    : new Date(monthCursorDate.getFullYear(), monthCursorDate.getMonth(), 1);
  const monthEnd = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() + 1,
    0,
  );
  const firstGridDay = new Date(monthStart);
  firstGridDay.setDate(monthStart.getDate() - monthStart.getDay());
  const lastGridDay = new Date(monthEnd);
  lastGridDay.setDate(monthEnd.getDate() + (6 - monthEnd.getDay()));
  const dayToCount = new Map<string, number>();

  items.forEach((item) => {
    const date = new Date(item.scheduledAt ?? "");

    if (Number.isNaN(date.getTime())) {
      return;
    }

    const key = date.toISOString().slice(0, 10);
    dayToCount.set(key, (dayToCount.get(key) ?? 0) + 1);
  });

  const days = [];
  const cursor = new Date(firstGridDay);
  const nowKey = new Date().toISOString().slice(0, 10);

  while (cursor <= lastGridDay) {
    const key = cursor.toISOString().slice(0, 10);
    const dayNumber = cursor.getDate();

    days.push({
      dayNumber,
      eventsCount: dayToCount.get(key) ?? 0,
      id: `day-${key}`,
      inCurrentMonth: cursor.getMonth() === monthStart.getMonth(),
      isToday: key === nowKey,
      key,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  const weeks = [];

  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }

  return {
    monthLabel: monthStart.toLocaleDateString("pt-BR", {
      month: "long",
      year: "numeric",
    }),
    weekdayLabels: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"],
    weeks,
  };
}

function formatIrisAgendaKind(kind?: string | null) {
  const normalized = normalizeIrisText(kind)?.toLowerCase();

  if (normalized === "tarefa") {
    return "Tarefa";
  }

  if (normalized === "reuniao") {
    return "Reuniao";
  }

  if (normalized === "entrega") {
    return "Entrega";
  }

  return "Agenda";
}

function startOfMonthIso(value?: string) {
  const date = value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  return new Date(safeDate.getFullYear(), safeDate.getMonth(), 1).toISOString();
}

function shiftMonthIso(monthCursorIso: string, delta: number) {
  const current = new Date(monthCursorIso);
  const safeDate = Number.isNaN(current.getTime()) ? new Date() : current;

  return new Date(
    safeDate.getFullYear(),
    safeDate.getMonth() + delta,
    1,
  ).toISOString();
}

function toDateTimeLocalInput(value?: string | null) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function normalizeDateTimeInputToIso(value?: string | null) {
  if (!value || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeDateInputToIso(value: unknown) {
  const normalized = normalizeIrisText(value);

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeIrisText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeIrisIdentifier(value: unknown, fallback: string) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return fallback;
}

async function getIrisAccessToken() {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao do Supabase indisponivel.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa ausente.");
  }

  return accessToken;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  });
}

function dateValue(value?: string | null) {
  if (!value) {
    return 0;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
