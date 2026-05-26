/* eslint-disable */
// @ts-nocheck
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  DatabaseZap,
  CircleStop,
  Edit3,
  FileText,
  Headphones,
  ImageIcon,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  MessageSquareReply,
  MessageSquareText,
  Mic,
  Network,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
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
  Smile,
  Sparkles,
  Smartphone,
  TicketCheck,
  Trash2,
  Upload,
  UsersRound,
  Video,
  Workflow,
  Wifi,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";

import { PanteonTopbarUser } from "@/components/panteon/panteon-topbar-user";
import { useOutsideDismiss } from "@/hooks/use-outside-dismiss";
import {
  playIrisInboundSound,
  registerIrisNotificationPermissionIntent,
  showBrowserIrisNotification,
} from "@/lib/iris/notification-effects";
import { getHubPresenceSnapshot } from "@/lib/hub-presence";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";

type IrisPageProps = {
  boardOnly?: boolean;
  embedded?: boolean;
  initialTickets?: IrisTicket[];
  loadFromSupabase?: boolean;
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

type IrisTone = "gold" | "green" | "red" | "blue" | "neutral";
type IrisOrigin = "active" | "passive";
type IrisPriority = "low" | "medium" | "high" | "critical";
type IrisStatus =
  | "new"
  | "open"
  | "waiting_customer"
  | "waiting_operator"
  | "pending"
  | "resolved"
  | "closed"
  | "cancelled";

type IrisMessage = {
  audioDurationMs?: number | null;
  audioMimeType?: string | null;
  audioUrl?: string | null;
  body: string;
  createdAt: string;
  deliveryStatus: string;
  direction: "inbound" | "outbound" | "internal";
  editedAt?: string | null;
  externalMessageId?: string | null;
  id: string;
  messageType?: string | null;
  operatorAvatarUrl?: string | null;
  readAt?: string | null;
  deliveredAt?: string | null;
  reactions?: IrisMessageReaction[];
  replyTo?: IrisReplyPreview | null;
  senderLabel?: string | null;
  senderType: "customer" | "operator" | "agent" | "system";
  sentAt?: string | null;
};

type IrisReplyPreview = {
  body: string;
  createdAt?: string | null;
  direction?: IrisMessage["direction"] | null;
  externalMessageId?: string | null;
  messageId: string;
  senderLabel?: string | null;
};

type IrisMessageReaction = {
  actorAvatarUrl?: string | null;
  actorLabel?: string | null;
  actorUserId?: string | null;
  createdAt?: string | null;
  emoji: string;
};

type IrisTicket = {
  crm360Registration?: IrisCrm360Registration | null;
  assignedToLabel: string;
  channelId?: string | null;
  channelLabel: string;
  contactAvatarUrl?: string | null;
  contactDocument?: string | null;
  contactEmail?: string | null;
  contactId?: string | null;
  contactLabel: string;
  contactPhone?: string | null;
  createdAt: string;
  firstRespondedAt?: string | null;
  firstResponseDueAt?: string | null;
  id: string;
  lastMessageAt?: string | null;
  lastMessagePreview: string;
  metadata?: Record<string, unknown> | null;
  messages: IrisMessage[];
  openedAt: string;
  priority: IrisPriority;
  profileLabel: string;
  protocol: string;
  queueLabel: string;
  queueSlug?: string | null;
  resolutionDueAt?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  sourceContext?: Record<string, unknown> | null;
  sourceLabel: string;
  status: IrisStatus;
  subject: string;
  unread: boolean;
};

type IrisHistoryFocus = {
  contactId?: string | null;
  contactLabel?: string | null;
  contactPhone?: string | null;
  requestedAt: number;
};

type IrisCrm360Registration = {
  documentMasked?: string | null;
  entityId?: string;
  entityKind?: string;
  label?: string;
  matchedPhone?: string;
  profileLabel?: string | null;
  profiles?: string[];
  relationLabel?: string | null;
  status: "registered" | "missing" | "unknown";
};

type IrisApoloContextContact = {
  label?: string | null;
  primary?: boolean;
  status?: string | null;
  type?: string | null;
  value?: string | null;
};

type IrisApoloContextInstallment = {
  dueDate?: string | null;
  id?: string;
  number?: string;
  paidAt?: string | null;
  reference?: string | null;
  status?: string | null;
  value?: string | null;
};

type IrisApoloContextCommercialLink = {
  enterprise?: string | null;
  installments?: IrisApoloContextInstallment[];
  referenceLabel?: string | null;
  role?: string | null;
  stage?: string | null;
  tableValue?: string | null;
  unit?: string | null;
  unitCode?: string | null;
};

type IrisApoloContextTimelineEvent = {
  date?: string | null;
  description?: string | null;
  status?: "ok" | "attention" | "blocked" | string;
  title?: string | null;
};

type IrisApoloContextServiceSignal = {
  channel?: string | null;
  lastEvent?: string | null;
  protocol?: string | null;
  status?: string | null;
};

type IrisApoloContextFinancial = {
  overdueAmount?: string | null;
  overdueInstallments?: number | null;
  paidAmount?: string | null;
  paymentBehavior?: string | null;
  risk?: string | null;
  totalPortfolio?: string | null;
};

type IrisApoloContextEntity = {
  commercialLinks?: IrisApoloContextCommercialLink[];
  contacts?: IrisApoloContextContact[];
  displayName?: string | null;
  documentMasked?: string | null;
  financial?: IrisApoloContextFinancial | null;
  id: string;
  kind?: string | null;
  locationLabel?: string | null;
  nextAction?: string | null;
  profiles?: string[];
  serviceSignals?: IrisApoloContextServiceSignal[];
  status?: string | null;
  timeline?: IrisApoloContextTimelineEvent[];
};

type IrisContextModalMode = "client" | "agenda" | null;

type IrisTicketContextNote = {
  text: string;
  updatedAt?: string | null;
  updatedByUserId?: string | null;
};

type IrisTicketContextAgendaEvent = {
  createdAt?: string | null;
  createdByLabel?: string | null;
  id: string;
  kind?: string | null;
  notes?: string | null;
  scheduledAt: string;
  status?: string | null;
  title: string;
};

type IrisAgendaTimelineEntry = {
  createdAt?: string | null;
  createdByLabel?: string | null;
  dateLabel: string;
  dateValue: number;
  description: string;
  id: string;
  kindLabel: string;
  scheduledAt?: string | null;
  source: "apolo" | "ticket";
  title: string;
  tone: "danger" | "gold" | "success";
};

type IrisAttendantBillingItem = {
  acquisitionRequestId: string;
  dueDate: string;
  id: string;
  number: string;
  overdueDays: number;
  reference: string;
  status: "Vencida" | "A vencer" | "Liquidada";
  unitCode?: string;
  unitLabel?: string;
  value: string;
};

type IrisAttendantResponse = {
  authentication?: {
    label?: string;
    status?: string;
  };
  billingItems?: IrisAttendantBillingItem[];
  boleto?: {
    boletoUrl?: string;
    message?: string;
    paymentId?: string;
  } | null;
  customer?: {
    c2xClientKnown?: boolean;
    documentMasked?: string | null;
    label?: string | null;
    phoneMasked?: string | null;
  };
  handoff?: {
    reason?: string | null;
    required?: boolean;
  };
  model?: string | null;
  nextStep?: string;
  replyText?: string;
  source?: "openai" | "fallback";
};

type IrisQueueConfig = {
  assignmentStrategy: string;
  color: string;
  defaultPriority: IrisPriority;
  id: string;
  name: string;
  routingStrategy: string;
  slaFirstResponseMinutes: number;
  slaResolutionMinutes: number;
  slug: string;
  status: string;
};

type IrisTicketProfileConfig = {
  category: string;
  description?: string | null;
  id: string;
  name: string;
  priority: IrisPriority;
  queueId?: string | null;
  queueLabel: string;
  requiredFields: string[];
  slaFirstResponseMinutes: number;
  slaResolutionMinutes: number;
  slug: string;
  status: string;
};

type IrisTemplate = {
  body?: string | null;
  category: string;
  channelKind: string;
  id: string;
  metadata?: Record<string, unknown> | null;
  name: string;
  slug: string;
  status: string;
  variables?: string[];
};

type IrisBroadcast = {
  id: string;
  name: string;
  scheduledAt?: string | null;
  status: string;
};

type IrisData = {
  broadcasts: IrisBroadcast[];
  channels: Array<{ id: string; kind: string; name: string; status: string }>;
  profiles: IrisTicketProfileConfig[];
  queues: IrisQueueConfig[];
  templates: IrisTemplate[];
  tickets: IrisTicket[];
};

type IrisInboundNotice = {
  body: string;
  id: string;
  receivedAt: string;
  ticketId: string;
  title: string;
};

type IrisMetaEvent = {
  contactName?: string | null;
  contactWaId?: string | null;
  direction: "inbound" | "status" | "system";
  id: string;
  messageId?: string | null;
  messageText?: string | null;
  providerEventType: string;
  receivedAt: string;
  signatureValid: boolean;
  statusDetail?: string | null;
};

type IrisMetaRef = {
  contactWaId?: string | null;
  createdAt: string;
  deliveryStatus?: string | null;
  direction: string;
  id: string;
  messageId: string;
};

type IrisMetaEventsResponse = {
  error?: string;
  events?: IrisMetaEvent[];
  refs?: IrisMetaRef[];
  summary?: {
    inbound: number;
    refsKnown: number;
    statuses: number;
    total: number;
  };
};

type IrisMetaTemplatesResponse = {
  error?: string;
  errorAction?: string | null;
  errorCause?: string | null;
  errorTitle?: string | null;
  ignoredTemplateCount?: number;
  localTemplateSync?: {
    error?: string | null;
    id?: string | null;
    imported?: boolean;
    localStatus?: string | null;
    matched?: boolean;
    metaStatus?: string | null;
    ok?: boolean;
  } | null;
  localTemplateSyncSummary?: {
    failed?: number;
    imported?: number;
    matched?: number;
    total?: number;
    updated?: number;
  } | null;
  metaCode?: string | null;
  metaDetail?: string | null;
  phoneNumberLink?: IrisMetaPhoneNumberLink | null;
  phoneNumbers?: IrisMetaPhoneNumberOption[];
  providerMessage?: string | null;
  selectedPhoneNumberId?: string | null;
  templates?: IrisMetaTemplateOption[];
};

type IrisTemplateFeedbackTone = "error" | "neutral" | "success" | "warning";

type IrisTemplateFeedback = {
  action?: string | null;
  cause?: string | null;
  message: string;
  metaCode?: string | null;
  metaDetail?: string | null;
  providerMessage?: string | null;
  title?: string | null;
  tone?: IrisTemplateFeedbackTone;
};

type IrisMetaTemplateOption = {
  category?: string | null;
  id?: string | null;
  language?: string | null;
  name?: string | null;
  status?: string | null;
};

type IrisMetaPhoneNumberOption = {
  codeVerificationStatus?: string | null;
  displayPhoneNumber?: string | null;
  id: string;
  isDefault?: boolean;
  label?: string | null;
  nameStatus?: string | null;
  qualityRating?: string | null;
  verifiedName?: string | null;
  whatsappBusinessAccountId?: string | null;
};

type IrisMetaPhoneNumberLink = {
  checkStatus?: "checked" | "missing_config" | "unavailable" | string;
  linked?: boolean | null;
  phoneBusinessAccountDetected?: boolean | null;
  phoneCount?: number | null;
  templateBusinessAccountSource?:
    | "configured"
    | "missing_config"
    | "phone"
    | "unavailable"
    | string;
};

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

type IrisApoloClientOption = {
  documentMasked?: string | null;
  firstName: string;
  id: string;
  label: string;
  locationLabel?: string | null;
  phone: string;
  profileLabel: string;
  profiles: string[];
};

const emptyIrisData: IrisData = {
  broadcasts: [],
  channels: [],
  profiles: [],
  queues: [],
  templates: [],
  tickets: [],
};
const emptyIrisTickets: IrisTicket[] = [];
const IRIS_REFRESH_INTERVAL_MS =
  process.env.NODE_ENV === "development" ? 120_000 : 12_000;
const IRIS_QUEUE_LOAD_TIMEOUT_MS = 15_000;
const IRIS_CRM360_ENRICH_TIMEOUT_MS = 4_000;

const navigationItems: Array<{
  id: IrisView;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
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
const priorityOptions: IrisPriority[] = [
  "low",
  "medium",
  "high",
  "critical",
];
const setupStatusOptions = ["planned", "active", "paused", "archived"];
const setupStatusLabel: Record<string, string> = {
  active: "Ativo",
  archived: "Arquivado",
  paused: "Pausado",
  planned: "Planejado",
};
const IRIS_EMOJI_OPTIONS = [
  "😀",
  "😄",
  "😊",
  "😉",
  "😍",
  "🙏",
  "👍",
  "👏",
  "✅",
  "⚠️",
  "📌",
  "💬",
];
const IRIS_REACTION_OPTIONS = ["👍", "❤️", "😂", "🙏", "✅"];
const IRIS_AUDIO_MAX_DATA_URL_LENGTH = 4_000_000;
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
    example: "Lagoa Bonita",
    key: "empreendimento",
    label: "Empreendimento",
    placeholder: "{{5}}",
    readiness: "CRM",
  },
  {
    example: "Quadra 01 lote 02",
    key: "unidade",
    label: "Unidade",
    placeholder: "{{6}}",
    readiness: "CRM",
  },
  {
    example: "25/05/2026",
    key: "vencimento",
    label: "Vencimento",
    placeholder: "{{7}}",
    readiness: "Controlada",
  },
  {
    example: "R$ 1.200,00",
    key: "valor",
    label: "Valor",
    placeholder: "{{8}}",
    readiness: "Controlada",
  },
  {
    example: "https://c2x.app.br/...",
    key: "link",
    label: "Link",
    placeholder: "{{9}}",
    readiness: "Controlada",
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
    description:
      "Comunica quem assumiu o atendimento antes da conversa livre.",
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
  embedded = false,
  initialTickets = emptyIrisTickets,
  loadFromSupabase = true,
  operatorScoped = false,
  queueSlugFilter = null,
}: IrisPageProps) {
  const { hubUser } = useAuth();
  const operatorUserId = operatorScoped ? hubUser?.id ?? null : null;
  const scopedQueueSlug = normalizeOptionalIrisQueueSlug(queueSlugFilter);
  const [irisData, setIrisData] = useState<IrisData>({
    ...emptyIrisData,
    tickets: initialTickets,
  });
  const [selectedTicketId, setSelectedTicketId] = useState<string>(
    initialTickets[0]?.id ?? "",
  );
  const [activeView, setActiveView] = useState<IrisView>("gestao");
  const [historyFocus, setHistoryFocus] = useState<IrisHistoryFocus | null>(
    null,
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(loadFromSupabase);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inboundNotice, setInboundNotice] = useState<IrisInboundNotice | null>(
    null,
  );
  const [onlineOperators, setOnlineOperators] = useState(0);
  const [startAttendanceOpen, setStartAttendanceOpen] = useState(false);
  const [startAttendanceQueueLabel, setStartAttendanceQueueLabel] =
    useState<string | null>(null);
  const knownMessageIdsRef = useRef<Set<string>>(
    collectIrisMessageIds({ ...emptyIrisData, tickets: initialTickets }),
  );
  const refreshInFlightRef = useRef(false);

  const enrichIrisDataWithCrm360 = useCallback(async (data: IrisData) => {
    return enrichTicketsWithCrm360(data);
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

    const channel = client
      .channel("iris-caredesk-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "caredesk_messages" },
        () => {
          void refreshIrisData({ notifyNewInbound: true });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "caredesk_messages" },
        () => {
          void refreshIrisData({ notifyNewInbound: false });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "caredesk_tickets" },
        () => {
          void refreshIrisData({ notifyNewInbound: true });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "caredesk_tickets" },
        () => {
          void refreshIrisData({ notifyNewInbound: false });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "caredesk_contacts" },
        () => {
          void refreshIrisData({ notifyNewInbound: false });
        },
      )
      .subscribe();

    const refreshInterval = window.setInterval(() => {
      void refreshIrisData({ notifyNewInbound: true });
    }, IRIS_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshInterval);
      void client.removeChannel(channel);
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

  const selectedTicket = useMemo(() => {
    return (
      irisData.tickets.find((ticket) => ticket.id === selectedTicketId) ??
      irisData.tickets[0] ??
      null
    );
  }, [irisData.tickets, selectedTicketId]);

  const snapshot = useMemo(
    () => buildIrisSnapshot(irisData, onlineOperators),
    [irisData, onlineOperators],
  );

  function openAttendance(ticketId?: string) {
    const targetId = ticketId ?? selectedTicket?.id;
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
            : ticket.metadata ?? null;

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
              : ticket.metadata ?? null,
        };
      }),
    }));
  }

  function handleOpenModuleLauncher() {
    window.dispatchEvent(new Event("careli:toggle-module-launcher"));
  }

  const visibleNavigationItems = boardOnly
    ? navigationItems.filter((item) => item.id === "gestao")
    : navigationItems;
  const embeddedBoardOnly = embedded && boardOnly;

  return (
    <div
      onClick={registerIrisNotificationPermissionIntent}
      className={[
        "h-full min-h-0 overflow-hidden bg-[#f3f6fa] text-[#101820]",
        embedded && !embeddedBoardOnly
          ? "rounded-2xl border border-[#dbe3ef]"
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
        <section className="h-[min(820px,calc(100vh-9rem))] min-h-[560px] overflow-hidden rounded-2xl border border-[#dbe3ef] bg-[#f3f6fa] p-3">
          {loadError ? (
            <div className="h-full rounded-2xl border border-rose-200 bg-white p-8 text-center text-sm font-semibold text-rose-700">
              {loadError}
            </div>
          ) : (
            <ManagementView
              data={irisData}
              loading={loading}
              snapshot={snapshot}
              onOpenAttendance={setSelectedTicketId}
              onSelectTicket={setSelectedTicketId}
              onStartAttendance={(queueLabel) => {
                setStartAttendanceQueueLabel(
                  queueLabel && queueLabel !== "Todos" ? queueLabel : null,
                );
                setStartAttendanceOpen(true);
              }}
            />
          )}
        </section>
      ) : (
      <div
        className={[
          "grid h-full min-h-0 transition-[grid-template-columns] duration-200",
          sidebarCollapsed
            ? "grid-cols-[72px_minmax(0,1fr)]"
            : "grid-cols-[240px_minmax(0,1fr)]",
        ].join(" ")}
      >
        <aside
          className={[
            "panteon-module-sidebar relative flex min-h-full flex-col border-r py-4 text-[#ECECF1] transition-all duration-200",
            sidebarCollapsed ? "px-3" : "px-4",
          ].join(" ")}
        >
          <div
            className={[
              "panteon-module-sidebar__top mb-4",
              sidebarCollapsed ? "-mx-3 px-3" : "-mx-4 px-4",
            ].join(" ")}
          >
            {sidebarCollapsed ? (
              <div className="grid justify-items-center gap-2 pb-1 pt-0.5">
                <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-[#d5dde8]">
                  <Headphones className="h-4 w-4" />
                </span>
                <Tooltip content="Abrir sidebar do Panteon" placement="right">
                  <button
                    type="button"
                    onClick={handleOpenModuleLauncher}
                    aria-label="Abrir sidebar do Panteon"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
                  >
                    <LayoutGrid aria-hidden="true" size={15} />
                  </button>
                </Tooltip>
                <Tooltip content="Expandir sidebar" placement="right">
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed((current) => !current)}
                    aria-label="Expandir sidebar"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
                  >
                    <PanelLeftOpen aria-hidden="true" size={16} />
                  </button>
                </Tooltip>
              </div>
            ) : (
              <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_2rem_2rem] items-center gap-2 rounded-xl bg-white/[0.035] px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-2.5 text-[#d5dde8]">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-[#101820]">
                    <Headphones className="h-4 w-4" />
                  </span>
                  <span className="grid min-w-0 gap-0.5">
                    <span className="min-w-0 truncate text-sm font-semibold leading-tight text-white">
                      Iris
                    </span>
                  </span>
                </div>
                <Tooltip content="Abrir sidebar do Panteon" placement="right">
                  <button
                    type="button"
                    onClick={handleOpenModuleLauncher}
                    aria-label="Abrir sidebar do Panteon"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
                  >
                    <LayoutGrid aria-hidden="true" size={15} />
                  </button>
                </Tooltip>
                <Tooltip content="Recolher sidebar" placement="right">
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed((current) => !current)}
                    aria-label="Recolher sidebar"
                    className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
                  >
                    <PanelLeftClose aria-hidden="true" size={16} />
                  </button>
                </Tooltip>
              </div>
            )}
          </div>

          <nav className="space-y-1">
            {visibleNavigationItems.map((item) => (
              <IrisNavButton
                key={item.id}
                active={activeView === item.id}
                icon={item.icon}
                label={item.label}
                collapsed={sidebarCollapsed}
                onClick={() => {
                  if (item.id === "historico") {
                    setHistoryFocus(null);
                  }
                  setActiveView(item.id);
                }}
              />
            ))}
          </nav>

          <div className="mt-auto" />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <IrisTopbar />

          <section className="min-h-0 flex-1 overflow-hidden p-3">
            {loadError ? (
              <div className="h-full rounded-2xl border border-rose-200 bg-white p-8 text-center text-sm font-semibold text-rose-700">
                {loadError}
              </div>
            ) : activeView === "gestao" ? (
              <ManagementView
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
              <HistoryView
                focus={historyFocus}
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
                ticket={selectedTicket}
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
              <BroadcastView data={irisData} snapshot={snapshot} />
            ) : activeView === "setup" ? (
              <SetupView
                data={irisData}
                snapshot={snapshot}
                onQueuesChanged={handleQueuesChanged}
                onProfilesChanged={handleProfilesChanged}
                onTemplatesSynced={() => {
                  void refreshIrisData({ notifyNewInbound: false });
                }}
              />
            ) : (
              <ReportsView data={irisData} snapshot={snapshot} />
            )}
          </section>
        </main>
      </div>
      )}
    </div>
  );
}

function IrisTopbar() {
  return (
    <header className="sticky top-0 z-20 border-b border-[#dbe3ef] bg-white/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-[230px]">
          <h2 className="text-lg font-semibold text-[#101820]">
            Ticket
          </h2>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <PanteonTopbarUser className="ml-1 border-l border-[#dbe3ef] pl-3" compact />
        </div>
      </div>
    </header>
  );
}

function ManagementView({
  data,
  loading,
  snapshot,
  onOpenAttendance,
  onSelectTicket,
  onStartAttendance,
}: {
  data: IrisData;
  loading: boolean;
  snapshot: ReturnType<typeof buildIrisSnapshot>;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  onStartAttendance: (queueLabel?: string) => void;
}) {
  const openTickets = useMemo(
    () => data.tickets.filter((ticket) => !isClosedTicket(ticket)),
    [data.tickets],
  );

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SignalCard
          icon={Clock3}
          title="TPR"
          value={snapshot.firstResponseLabel}
          tone="gold"
        />
        <SignalCard
          icon={MessageCircle}
          title="TDR"
          value={snapshot.responseTimeLabel}
          tone="blue"
        />
        <SignalCard
          icon={TicketCheck}
          title="TMA"
          value={snapshot.averageHandlingTimeLabel}
          tone="green"
        />
        <SignalCard
          icon={ShieldAlert}
          title="SLA critico"
          value={formatCount(snapshot.slaCritical)}
          tone={snapshot.slaCritical ? "red" : "neutral"}
        />
      </div>

      <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 min-w-0">
          {loading ? (
            <IrisLoading />
          ) : (
            <IrisTicketQueue
              tickets={openTickets}
              onOpenAttendance={onOpenAttendance}
              onSelectTicket={onSelectTicket}
              onStartAttendance={onStartAttendance}
            />
          )}
        </div>

        <aside className="min-h-0 space-y-3 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          <ActionPanel
            icon={CalendarClock}
            title="Agenda"
            items={[
              {
                detail: "Tickets com proxima resposta vencendo",
                title: "Retornos",
                value: formatCount(snapshot.followUpsToday),
              },
              {
                detail: "Demandas que pedem distribuicao",
                title: "Escalados",
                value: formatCount(snapshot.waitingOperator),
              },
            ]}
          />
        </aside>
      </div>
    </div>
  );
}

function HistoryView({
  focus,
  onClearFocus,
  onOpenAttendance,
  onSelectTicket,
  tickets,
}: {
  focus: IrisHistoryFocus | null;
  onClearFocus: () => void;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  tickets: IrisTicket[];
}) {
  const [queue, setQueue] = useState("Todas as filas");
  const [search, setSearch] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const closedTickets = useMemo(
    () => tickets.filter((ticket) => isClosedTicket(ticket)),
    [tickets],
  );
  const focusTickets = useMemo(() => {
    if (!focus) {
      return emptyIrisTickets;
    }

    return tickets.filter((ticket) => ticketMatchesHistoryFocus(ticket, focus));
  }, [focus, tickets]);
  const sourceTickets = focus ? focusTickets : closedTickets;
  const focusedContactClosedCount = useMemo(
    () => focusTickets.filter((ticket) => isClosedTicket(ticket)).length,
    [focusTickets],
  );
  const queues = useMemo(
    () => ["Todas as filas", ...unique(sourceTickets.map((ticket) => ticket.queueLabel))],
    [sourceTickets],
  );

  useEffect(() => {
    if (!focus) {
      return;
    }

    setQueue("Todas as filas");
    setSearch(focus.contactLabel ?? focus.contactPhone ?? "");
  }, [focus?.requestedAt]);

  const filteredTickets = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const rawPeriodStartValue = periodStart
      ? new Date(periodStart).getTime()
      : null;
    const rawPeriodEndValue = periodEnd ? new Date(periodEnd).getTime() : null;
    const periodStartValue =
      rawPeriodStartValue !== null && Number.isFinite(rawPeriodStartValue)
        ? rawPeriodStartValue
        : null;
    const periodEndValue =
      rawPeriodEndValue !== null && Number.isFinite(rawPeriodEndValue)
        ? rawPeriodEndValue
        : null;

    return sourceTickets
      .filter((ticket) => {
        const displayLabel = ticketContactLabel(ticket).toLowerCase();
        const crmSubtitle = ticketCrmSubtitle(ticket).toLowerCase();
        const ticketStartAt = dateValue(ticket.openedAt);
        const ticketEndAt = dateValue(
          ticket.closedAt ??
            ticket.resolvedAt ??
            ticket.lastMessageAt ??
            ticket.openedAt,
        );
        const matchesSearch =
          normalized.length === 0 ||
          displayLabel.includes(normalized) ||
          crmSubtitle.includes(normalized) ||
          ticket.protocol.toLowerCase().includes(normalized) ||
          ticket.contactLabel.toLowerCase().includes(normalized) ||
          ticket.subject.toLowerCase().includes(normalized);
        const matchesPeriodStart =
          periodStartValue === null || ticketStartAt >= periodStartValue;
        const matchesPeriodEnd =
          periodEndValue === null || ticketEndAt <= periodEndValue;

        return (
          matchesSearch &&
          matchesPeriodStart &&
          matchesPeriodEnd &&
          (queue === "Todas as filas" || ticket.queueLabel === queue)
        );
      })
      .sort(
        (first, second) =>
          dateValue(
            second.closedAt ??
              second.resolvedAt ??
              second.lastMessageAt ??
              second.openedAt,
          ) -
          dateValue(
            first.closedAt ??
              first.resolvedAt ??
              first.lastMessageAt ??
              first.openedAt,
          ),
      );
  }, [periodEnd, periodStart, queue, search, sourceTickets]);

  const focusedContactLabel =
    focus?.contactLabel ?? focus?.contactPhone ?? null;
  const headerDescription = focus
    ? "Tickets do cliente em andamento e encerrados no Iris."
    : "Tickets encerrados saem do Board e ficam consultaveis aqui.";
  const headerBadgeLabel = focus
    ? `${formatCount(sourceTickets.length)} tickets do cliente`
    : `${formatCount(closedTickets.length)} encerrados`;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="shrink-0 border-b border-slate-100 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Historico de atendimentos
            </h2>
            <p className="mt-1 text-xs font-medium text-slate-500">
              {headerDescription}
            </p>
          </div>
          <span className="inline-flex h-8 items-center rounded-full border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-3 text-xs font-semibold text-[#7A5E2C]">
            {headerBadgeLabel}
          </span>
        </div>
        {focusedContactLabel ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/8 px-3 py-2">
            <Clock3 className="size-4 text-[#7A5E2C]" aria-hidden="true" />
            <p className="text-xs font-semibold text-[#7A5E2C]">
              Filtrando historico de {focusedContactLabel}. Encerrados:{" "}
              {formatCount(focusedContactClosedCount)}.
            </p>
            <button
              type="button"
              onClick={onClearFocus}
              className="ml-auto inline-flex h-7 items-center rounded-md border border-[#A07C3B]/30 bg-white px-2.5 text-[11px] font-semibold text-[#7A5E2C] transition-colors hover:bg-[#fff8ec]"
            >
              Ver todos
            </button>
          </div>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 gap-3 p-3">
        <div className="grid gap-2 rounded-xl border border-slate-200/70 bg-slate-50/60 p-2 lg:grid-cols-[minmax(0,1fr)_180px_190px_190px]">
          <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-sm text-slate-500">
            <Search className="size-4 text-[#A07C3B]" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar cliente, protocolo ou assunto..."
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
            />
          </label>
          <FilterSelect
            label="Fila"
            value={queue}
            options={queues}
            onChange={setQueue}
          />
          <label className="grid h-10 items-center rounded-lg border border-slate-200/70 bg-white px-3">
            <span className="sr-only">Inicio no periodo</span>
            <input
              type="datetime-local"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              className="w-full bg-transparent text-xs font-medium text-slate-700 outline-none"
              aria-label="Inicio no periodo"
            />
          </label>
          <label className="grid h-10 items-center rounded-lg border border-slate-200/70 bg-white px-3">
            <span className="sr-only">Encerramento no periodo</span>
            <input
              type="datetime-local"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              className="w-full bg-transparent text-xs font-medium text-slate-700 outline-none"
              aria-label="Encerramento no periodo"
            />
          </label>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200/70">
          <div className="hidden min-w-0 grid-cols-[repeat(10,minmax(0,1fr))_40px] gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-slate-400 xl:grid">
            <span>Ticket</span>
            <span>Fila</span>
            <span>Canal</span>
            <span>Status</span>
            <span>SLA</span>
            <span>Origem</span>
            <span>Perfil</span>
            <span>Assunto</span>
            <span>TDR</span>
            <span>Responsavel</span>
            <span className="text-right">Chat</span>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
            {filteredTickets.length > 0 ? (
              filteredTickets.map((ticket) => (
                <IrisTicketRow
                  key={ticket.id}
                  ticket={ticket}
                  onOpenAttendance={onOpenAttendance}
                  onSelectTicket={onSelectTicket}
                  showTimeline
                />
              ))
            ) : (
              <EmptyState
                icon={Clock3}
                title={
                  focus
                    ? "Nenhum ticket do cliente encontrado"
                    : "Nenhum ticket encerrado encontrado"
                }
                description={
                  focus
                    ? "Ajuste o filtro para localizar os tickets do cliente selecionado."
                    : "Ajuste o filtro ou use outro termo para localizar historicos do cliente."
                }
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function IrisTicketQueue({
  onOpenAttendance,
  onSelectTicket,
  onStartAttendance,
  tickets,
}: {
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  onStartAttendance: (queueLabel?: string) => void;
  tickets: IrisTicket[];
}) {
  const [ownerView, setOwnerView] = useState<
    "Todos" | "Cacá" | "Operadores"
  >("Todos");
  const [queue, setQueue] = useState("Todos");
  const [status, setStatus] = useState("Todos");
  const [priority, setPriority] = useState("Todas");
  const [search, setSearch] = useState("");
  const ownerScopedTickets = useMemo(
    () => filterTicketsByBoardOwner(tickets, ownerView),
    [ownerView, tickets],
  );
  const ownerCounters = useMemo(
    () => ({
      "Cacá": filterTicketsByBoardOwner(tickets, "Cacá").length,
      Operadores: filterTicketsByBoardOwner(tickets, "Operadores").length,
      Todos: filterTicketsByBoardOwner(tickets, "Todos").length,
    }),
    [tickets],
  );

  const queues = useMemo(
    () => ["Todos", ...unique(ownerScopedTickets.map((ticket) => ticket.queueLabel))],
    [ownerScopedTickets],
  );
  const statuses = useMemo(
    () => [
      "Todos",
      ...unique(
        ownerScopedTickets.map((ticket) => statusLabel[effectiveIrisStatus(ticket)]),
      ),
    ],
    [ownerScopedTickets],
  );

  useEffect(() => {
    if (!queues.includes(queue)) {
      setQueue("Todos");
    }
  }, [queue, queues]);

  useEffect(() => {
    if (!statuses.includes(status)) {
      setStatus("Todos");
    }
  }, [status, statuses]);

  const filteredTickets = useMemo(() => {
    const normalized = search.trim().toLowerCase();

    return ownerScopedTickets
      .filter((ticket) => {
        const displayLabel = ticketContactLabel(ticket).toLowerCase();
        const crmSubtitle = ticketCrmSubtitle(ticket).toLowerCase();
        const matchesSearch =
          normalized.length === 0 ||
          displayLabel.includes(normalized) ||
          crmSubtitle.includes(normalized) ||
          ticket.protocol.toLowerCase().includes(normalized) ||
          ticket.contactLabel.toLowerCase().includes(normalized) ||
          ticket.subject.toLowerCase().includes(normalized);

        return (
          matchesSearch &&
          (queue === "Todos" || ticket.queueLabel === queue) &&
          (status === "Todos" ||
            statusLabel[effectiveIrisStatus(ticket)] === status) &&
          (priority === "Todas" || priorityLabel[ticket.priority] === priority)
        );
      })
      .sort(sortIrisTickets);
  }, [ownerScopedTickets, priority, queue, search, status]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="shrink-0 border-b border-slate-100 px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-950">
              Inbox
            </h2>
            <Tooltip
              content="Novo atendimento"
              placement="left"
              triggerClassName="shrink-0"
            >
              <button
                type="button"
                aria-label="Novo atendimento"
                title="Novo atendimento"
                onClick={() => onStartAttendance(queue)}
                className="inline-flex size-9 items-center justify-center rounded-lg bg-[#101820] text-white shadow-sm transition-colors hover:bg-[#1f2c3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d0ad69]"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <KpiCard
              icon={TicketCheck}
              label="Tickets abertos"
              shortLabel="Tickets"
              value={`${tickets.filter((ticket) => !isClosedTicket(ticket)).length}`}
            />
            <KpiCard
              icon={ShieldAlert}
              label="SLA critico"
              shortLabel="SLA"
              value={`${tickets.filter(isSlaCritical).length}`}
              tone="danger"
            />
            <KpiCard
              icon={Clock3}
              label="Tempo de primeira resposta"
              shortLabel="1a resp."
              value={estimateFirstResponse(tickets)}
            />
            <KpiCard
              icon={Clock3}
              label="Media de resposta"
              shortLabel="Media"
              value={estimateAverageResponse(tickets)}
            />
            <KpiCard
              icon={CheckCircle2}
              label="Encerrados hoje"
              shortLabel="Hoje"
              value={`${tickets.filter(isClosedToday).length}`}
            />
            <KpiCard
              icon={Sparkles}
              label="Sem resposta"
              shortLabel="Sem resp."
              value={`${tickets.filter(isWaitingForIris).length}`}
              tone={tickets.some(isWaitingForIris) ? "danger" : "gold"}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200/70 bg-slate-50/70 p-1.5">
            {(["Todos", "Cacá", "Operadores"] as const).map((option) => {
              const active = ownerView === option;

              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setOwnerView(option)}
                  className={[
                    "inline-flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-colors",
                    active
                      ? "bg-[#101820] text-white shadow-sm"
                      : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-[#7A5E2C]",
                  ].join(" ")}
                >
                  <span>{option}</span>
                  <span
                    className={[
                      "inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                      active
                        ? "bg-white/20 text-white"
                        : "bg-[#A07C3B]/10 text-[#7A5E2C]",
                    ].join(" ")}
                  >
                    {ownerCounters[option]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 p-3">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="grid gap-2 rounded-xl border border-slate-200/70 bg-slate-50/60 p-2 lg:grid-cols-[minmax(0,1fr)_150px_150px_150px]">
            <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-sm text-slate-500">
              <Search className="size-4 text-[#A07C3B]" aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar protocolo, cliente ou assunto..."
                className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
              />
            </label>
            <FilterSelect
              label="Fila"
              value={queue}
              options={queues}
              onChange={setQueue}
            />
            <FilterSelect
              label="Status"
              value={status}
              options={statuses}
              onChange={setStatus}
            />
            <FilterSelect
              label="Prioridade"
              value={priority}
              options={["Todas", "Critica", "Alta", "Media", "Baixa"]}
              onChange={setPriority}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200/70">
            <div className="hidden min-w-0 grid-cols-[repeat(10,minmax(0,1fr))_40px] gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-slate-400 xl:grid">
              <span>Ticket</span>
              <span>Fila</span>
              <span>Canal</span>
              <span>Status</span>
              <span>SLA</span>
              <span>Origem</span>
              <span>Perfil</span>
              <span>Assunto</span>
              <span>TDR</span>
              <span>Responsavel</span>
              <span className="text-right" title="Atendimento">
                Chat
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              {filteredTickets.length > 0 ? (
                filteredTickets.map((ticket) => (
                  <IrisTicketRow
                    key={ticket.id}
                    ticket={ticket}
                    onOpenAttendance={onOpenAttendance}
                    onSelectTicket={onSelectTicket}
                  />
                ))
              ) : (
                <EmptyState
                  icon={Inbox}
                  title={
                    ownerView === "Cacá"
                      ? "Nenhum ticket em atendimento da Cacá"
                      : ownerView === "Operadores"
                        ? "Nenhum ticket na visão dos operadores"
                        : "Nenhum ticket na fila"
                  }
                  description={
                    ownerView === "Cacá"
                      ? "Quando a Cacá estiver conduzindo atendimento passivo, os tickets aparecerao aqui."
                      : ownerView === "Operadores"
                        ? "Quando houver handoff da Cacá ou atendimento humano em andamento, os tickets aparecerao aqui."
                        : "Quando uma mensagem de cliente chegar ou um operador iniciar um contato, o ticket deve nascer no Iris."
                  }
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function IrisStartAttendanceModal({
  data,
  initialQueueLabel,
  onClose,
  onTicketCreated,
  onTemplatesSynced,
}: {
  data: IrisData;
  initialQueueLabel?: string | null;
  onClose: () => void;
  onTicketCreated: (ticketId?: string) => void;
  onTemplatesSynced?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IrisApoloClientOption[]>([]);
  const [selectedClient, setSelectedClient] =
    useState<IrisApoloClientOption | null>(null);
  const [searching, setSearching] = useState(false);
  const activeQueues = useMemo(
    () =>
      data.queues
        .filter((queue) => queue.status === "active")
        .sort(sortIrisQueues),
    [data.queues],
  );
  const [selectedQueueId, setSelectedQueueId] = useState(() =>
    defaultIrisQueueId(data.queues, initialQueueLabel),
  );
  const selectedQueue =
    activeQueues.find((queue) => queue.id === selectedQueueId) ??
    activeQueues[0] ??
    null;
  const subjectOptions = useMemo(
    () =>
      data.profiles
        .filter(
          (profile) =>
            profile.status === "active" &&
            (!selectedQueue || profile.queueId === selectedQueue.id),
        )
        .sort(sortIrisProfiles),
    [data.profiles, selectedQueue],
  );
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const selectedProfile =
    subjectOptions.find((profile) => profile.id === selectedProfileId) ??
    subjectOptions[0] ??
    null;
  const activeContactTemplates = useMemo(
    () =>
      data.templates
        .filter(
          (template) =>
            template.channelKind === "whatsapp" &&
            Boolean(readTemplateMetaName(template)) &&
            template.status !== "paused" &&
            !isMetaTemplateUnavailableStatus(readTemplateMetaStatus(template)),
        )
        .sort(sortIrisTemplatesForSetup),
    [data.templates],
  );
  const templateOptions = useMemo(() => {
    const queueLabel = normalizeIrisSelectionLabel(selectedQueue?.name);
    const subjectLabel = normalizeIrisSelectionLabel(selectedProfile?.name);

    return activeContactTemplates.filter((template) => {
      return (
        normalizeIrisSelectionLabel(readTemplateQueueLabel(template)) ===
          queueLabel &&
        normalizeIrisSelectionLabel(readTemplateSubjectLabel(template)) ===
          subjectLabel
      );
    });
  }, [activeContactTemplates, selectedProfile, selectedQueue]);
  const [selectedLocalTemplateId, setSelectedLocalTemplateId] = useState("");
  const selectedLocalTemplate =
    templateOptions.find((template) => template.id === selectedLocalTemplateId) ??
    templateOptions[0] ??
    null;
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);
  const [templateMeta, setTemplateMeta] =
    useState<IrisMetaTemplateOption | null>(null);
  const [templatePhoneLink, setTemplatePhoneLink] =
    useState<IrisMetaPhoneNumberLink | null>(null);
  const [templatePhoneNumbers, setTemplatePhoneNumbers] = useState<
    IrisMetaPhoneNumberOption[]
  >([]);
  const templateSyncNotifiedRef = useRef(new Set<string>());
  const [selectedTemplatePhoneNumberId, setSelectedTemplatePhoneNumberId] =
    useState("");
  const [templateFeedback, setTemplateFeedback] =
    useState<IrisTemplateFeedback | string>("");
  const [error, setError] = useState("");
  const [startingTicket, setStartingTicket] = useState(false);
  const selectedLocalTemplatePhoneNumberId = readTemplateMetadataString(
    selectedLocalTemplate,
    "metaPhoneNumberId",
  );

  const firstName = selectedClient?.firstName ?? IRIS_OPT_IN_TEMPLATE.exampleName;
  const preview = selectedLocalTemplate
    ? renderSelectedIrisTemplatePreview(selectedLocalTemplate, firstName)
    : "";
  const templateButtons = selectedLocalTemplate
    ? readTemplateButtons(selectedLocalTemplate)
    : [];
  const templateApproved = isMetaTemplateApprovedStatus(templateStatus);
  const startTemplateName =
    templateMeta?.name ??
    readTemplateMetaName(selectedLocalTemplate) ??
    selectedLocalTemplate?.slug.replace(/-/g, "_") ??
    IRIS_OPT_IN_TEMPLATE.name;
  const startTemplateLanguage =
    templateMeta?.language ??
    readTemplateMetadataString(selectedLocalTemplate, "metaLanguage") ??
    IRIS_OPT_IN_TEMPLATE.language;
  const selectedTemplatePhoneNumber = findMetaPhoneNumberOption(
    templatePhoneNumbers,
    selectedTemplatePhoneNumberId,
  );
  const selectedTemplatePhoneLabel = formatSelectedTemplatePhoneForDisplay({
    phoneNumber: selectedTemplatePhoneNumber,
    template: selectedLocalTemplate,
    phoneNumberId: selectedTemplatePhoneNumberId,
  });
  const selectedTemplatePhoneDisplayNumber =
    selectedTemplatePhoneNumber?.displayPhoneNumber ??
    readTemplateMetadataString(selectedLocalTemplate, "metaPhoneDisplayNumber");
  const templatePhoneDisplayMissing = Boolean(
    selectedTemplatePhoneNumberId && !selectedTemplatePhoneDisplayNumber,
  );
  const selectedTemplatePhoneNumberIsListed = templatePhoneNumbers.some(
    (phoneNumber) => phoneNumber.id === selectedTemplatePhoneNumberId,
  );
  const templatePhoneMismatch =
    templatePhoneLink?.checkStatus === "checked" &&
    templatePhoneLink.linked === false;
  const templateReadyToSend =
    Boolean(selectedLocalTemplate) &&
    templateApproved &&
    Boolean(selectedTemplatePhoneNumberId) &&
    !templatePhoneMismatch;
  const templateCanStart =
    Boolean(selectedQueue) && Boolean(selectedProfile);

  useEffect(() => {
    if (!activeQueues.length) {
      setSelectedQueueId("");
      return;
    }

    if (
      !selectedQueueId ||
      !activeQueues.some((queue) => queue.id === selectedQueueId)
    ) {
      setSelectedQueueId(defaultIrisQueueId(activeQueues, initialQueueLabel));
    }
  }, [activeQueues, initialQueueLabel, selectedQueueId]);

  useEffect(() => {
    if (!subjectOptions.length) {
      setSelectedProfileId("");
      return;
    }

    if (
      !selectedProfileId ||
      !subjectOptions.some((profile) => profile.id === selectedProfileId)
    ) {
      setSelectedProfileId(subjectOptions[0].id);
    }
  }, [selectedProfileId, subjectOptions]);

  useEffect(() => {
    if (!templateOptions.length) {
      setSelectedLocalTemplateId("");
      return;
    }

    if (
      !selectedLocalTemplateId ||
      !templateOptions.some((template) => template.id === selectedLocalTemplateId)
    ) {
      setSelectedLocalTemplateId(templateOptions[0].id);
    }
  }, [selectedLocalTemplateId, templateOptions]);

  useEffect(() => {
    const templatePhoneNumberId = readTemplateMetadataString(
      selectedLocalTemplate,
      "metaPhoneNumberId",
    );

    setSelectedTemplatePhoneNumberId(templatePhoneNumberId ?? "");
  }, [selectedLocalTemplate]);

  useEffect(() => {
    let active = true;

    async function loadTemplateStatus() {
      const templateName = readTemplateMetaName(selectedLocalTemplate);
      const templateLanguage = readTemplateMetadataString(
        selectedLocalTemplate,
        "metaLanguage",
      );
      const effectivePhoneNumberId =
        selectedLocalTemplatePhoneNumberId ?? selectedTemplatePhoneNumberId;

      if (!selectedLocalTemplate || !templateName) {
        setTemplateStatus(null);
        setTemplateMeta(null);
        setTemplatePhoneLink(null);
        setTemplatePhoneNumbers([]);
        setSelectedTemplatePhoneNumberId("");
        setTemplateFeedback(
          createIrisTemplateFeedback({
            message:
              selectedProfile && selectedQueue
                ? "Nenhum template aprovado localizado para esta fila e assunto."
                : "Escolha fila e assunto para localizar templates aprovados.",
            title: "Template obrigatorio",
            tone: "warning",
          }),
        );
        return;
      }

      setTemplateStatus(readTemplateMetaStatus(selectedLocalTemplate));
      setTemplateMeta({
        language: templateLanguage ?? IRIS_OPT_IN_TEMPLATE.language,
        name: templateName,
        status: readTemplateMetaStatus(selectedLocalTemplate),
      });

      try {
        const accessToken = await getIrisAccessToken();
        const params = new URLSearchParams({
          language: templateLanguage ?? IRIS_OPT_IN_TEMPLATE.language,
          name: templateName,
        });

        if (effectivePhoneNumberId) {
          params.set("phoneNumberId", effectivePhoneNumberId);
        }

        const response = await fetch(`/api/iris/meta/templates?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const payload = (await response.json().catch(
          () => null,
        )) as IrisMetaTemplatesResponse | null;

        if (!active) {
          return;
        }

        if (!response.ok) {
          setTemplateFeedback(
            createIrisTemplateFeedbackFromPayload(
              payload,
              "Nao foi possivel consultar o template Meta neste ambiente.",
            ),
          );
          return;
        }

        const templateSyncId = readIrisTemplateSyncNotificationId(
          payload?.localTemplateSync,
        );
        if (
          templateSyncId &&
          !templateSyncNotifiedRef.current.has(templateSyncId)
        ) {
          templateSyncNotifiedRef.current.add(templateSyncId);
          onTemplatesSynced?.();
        }

        const template = payload?.templates?.[0];
        const phoneNumbers = Array.isArray(payload?.phoneNumbers)
          ? payload.phoneNumbers
          : [];
        const selectedPhoneNumberId =
          payload?.selectedPhoneNumberId ??
          effectivePhoneNumberId ??
          phoneNumbers.find((phoneNumber) => phoneNumber.isDefault)?.id ??
          phoneNumbers[0]?.id ??
          "";
        setTemplatePhoneNumbers(phoneNumbers);
        setSelectedTemplatePhoneNumberId((current) =>
          current || selectedPhoneNumberId,
        );
        setTemplateStatus(template?.status ?? "NOT_FOUND");
        setTemplateMeta(
          template ?? {
            language: templateLanguage ?? IRIS_OPT_IN_TEMPLATE.language,
            name: templateName,
            status: "NOT_FOUND",
          },
        );
        setTemplatePhoneLink(payload?.phoneNumberLink ?? null);
        const phoneMismatch =
          payload?.phoneNumberLink?.checkStatus === "checked" &&
          payload.phoneNumberLink.linked === false;
        setTemplateFeedback(
          phoneMismatch
            ? createIrisTemplateFeedback({
                action:
                  "Crie ou selecione um template aprovado para o telefone de envio escolhido.",
                cause:
                  "Existe template aprovado com esse nome em outra WABA, mas ele nao pertence ao telefone selecionado.",
                message:
                  "O template aprovado nao esta vinculado ao telefone de envio deste atendimento.",
                title: "Telefone divergente",
                tone: "error",
              })
            : createIrisTemplateFeedback({
                action: phoneNumberLinkFeedback(payload?.phoneNumberLink),
                cause: payload?.ignoredTemplateCount
                  ? "Existe template com esse nome em outra WABA, mas ele nao pertence ao telefone de envio selecionado."
                  : undefined,
                message: template
                  ? `Template Meta ${templateStatusLabel(template.status)}.`
                  : "Template nao encontrado na Meta para este telefone, nome e idioma.",
                title: template ? "Consulta concluida" : "Template nao localizado",
                tone: template ? "success" : "warning",
              }),
        );
      } catch (templateError) {
        if (active) {
          setTemplateFeedback(
            createIrisTemplateFeedback({
              message:
                templateError instanceof Error
                  ? templateError.message
                  : "Nao foi possivel consultar o template Meta.",
              title: "Falha ao consultar a Meta",
              tone: "error",
            }),
          );
        }
      }
    }

    void loadTemplateStatus();

    return () => {
      active = false;
    };
  }, [
    selectedLocalTemplate,
    selectedLocalTemplatePhoneNumberId,
    selectedProfile,
    selectedQueue,
    selectedTemplatePhoneNumberId,
    onTemplatesSynced,
  ]);

  useEffect(() => {
    const normalized = query.trim();

    if (normalized.length < 2) {
      setResults([]);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      setError("");

      try {
        const accessToken = await getIrisAccessToken();
        const response = await fetch(
          `/api/iris/apolo/search?q=${encodeURIComponent(normalized)}&limit=12`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            payload?.error ?? "Nao foi possivel buscar no CRM 360.",
          );
        }

        if (active) {
          setResults(extractIrisApoloClientOptions(payload));
        }
      } catch (searchError) {
        if (active) {
          setResults([]);
          setError(
            searchError instanceof Error
              ? searchError.message
              : "Nao foi possivel buscar no CRM 360.",
          );
        }
      } finally {
        if (active) {
          setSearching(false);
        }
      }
    }, 320);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [query]);

  async function startTicket() {
    if (!selectedClient || !templateCanStart) {
      return;
    }

    setStartingTicket(true);
    setError("");

    try {
      const accessToken = await getIrisAccessToken();
      const requestPayload = {
        apoloEntityId: selectedClient.id,
        apoloProfileLabel: selectedClient.profileLabel,
        contactName: selectedClient.label,
        firstName: selectedClient.firstName,
        metadata: {
          activeContactTemplateId: selectedLocalTemplate?.id,
          activeContactTemplateName: selectedLocalTemplate?.name,
          activeContactTemplateQueue: selectedQueue?.name,
          activeContactTemplateSubject: selectedProfile?.name,
        },
        phone: selectedClient.phone,
        phoneNumberId: selectedTemplatePhoneNumberId,
        profileId: selectedProfile?.id,
        queueId: selectedQueue?.id,
        subject: selectedProfile?.name,
        templateId: selectedLocalTemplate?.id,
        templateLanguage: startTemplateLanguage,
        templateName: startTemplateName,
      };

      const attemptStartTicket = async (sendTemplate: boolean) => {
        const response = await fetch("/api/iris/tickets", {
          body: JSON.stringify({
            ...requestPayload,
            sendTemplate,
          }),
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        const payload = await response.json().catch(() => null);

        return { payload, response };
      };

      const windowAttempt = await attemptStartTicket(false);

      if (windowAttempt.response.ok) {
        onTicketCreated(windowAttempt.payload?.ticket?.id);
        return;
      }

      const windowError =
        windowAttempt.payload?.error ?? "Nao foi possivel iniciar o atendimento.";
      const requiresTemplate =
        windowAttempt.response.status === 409 &&
        typeof windowError === "string" &&
        windowError.toLowerCase().includes("janela de 24h fechada");

      if (!requiresTemplate) {
        throw new Error(windowError);
      }

      if (!templateReadyToSend) {
        throw new Error(
          "Janela de 24h fechada. Selecione template aprovado e telefone de envio para iniciar o contato ativo.",
        );
      }

      const templateAttempt = await attemptStartTicket(true);

      if (!templateAttempt.response.ok) {
        throw new Error(
          templateAttempt.payload?.error ??
            "Nao foi possivel iniciar o atendimento.",
        );
      }

      onTicketCreated(templateAttempt.payload?.ticket?.id);
    } catch (ticketError) {
      setError(
        ticketError instanceof Error
          ? ticketError.message
          : "Nao foi possivel iniciar o atendimento.",
      );
    } finally {
      setStartingTicket(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 py-6 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="Fechar novo atendimento"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section className="relative z-10 flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_24px_90px_rgba(15,23,42,0.24)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
              Contato ativo
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              Novo atendimento
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Buscar cliente no CRM 360 e iniciar o atendimento. Se a janela de 24h estiver aberta, a Iris reaproveita a conversa sem novo template.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar formulario"
            className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 xl:grid-cols-[minmax(0,1fr)_360px] [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          <div className="min-w-0 space-y-4">
            <label className="block rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
              <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                Cliente CRM 360 / Apolo
              </span>
              <div className="mt-2 flex h-10 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-sm text-slate-500">
                <Search className="size-4 text-[#A07C3B]" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por cliente ou telefone..."
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
                />
              </div>
              {searching ? (
                <p className="mt-2 text-xs font-medium text-slate-500">
                  Buscando no CRM 360...
                </p>
              ) : null}
            </label>

            <div className="rounded-xl border border-slate-200/70">
              <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-slate-400">
                Resultado da busca
              </div>
              <div className="max-h-72 overflow-y-auto p-2 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
                {results.length ? (
                  results.map((client) => {
                    const active = selectedClient?.id === client.id;

                    return (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => setSelectedClient(client)}
                        className={[
                          "mb-2 grid w-full gap-1 rounded-lg border px-3 py-2 text-left transition-colors last:mb-0",
                          active
                            ? "border-[#A07C3B]/35 bg-[#A07C3B]/5"
                            : "border-slate-200/70 bg-white hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-3">
                          <p className="truncate text-sm font-semibold text-slate-950">
                            {client.label}
                          </p>
                          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                            CRM 360
                          </span>
                        </div>
                        <p className="truncate text-xs text-slate-500">
                          {client.profileLabel} · {formatPhoneForDisplay(client.phone)}
                        </p>
                        <p className="truncate text-xs text-slate-400">
                          {client.documentMasked ?? client.locationLabel ?? "Cadastro Apolo"}
                        </p>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-8 text-center text-sm text-slate-500">
                    {query.trim().length < 2
                      ? "Digite pelo menos 2 caracteres para buscar."
                      : "Nenhum cliente localizado com telefone para WhatsApp."}
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="min-w-0 space-y-4">
            <div className="rounded-xl border border-slate-200/70 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                    Template Meta
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-slate-950">
                    {selectedLocalTemplate?.name ?? "Escolha um template"}
                  </h3>
                  <p className="mt-0.5 truncate text-xs font-medium text-slate-500">
                    {[selectedQueue?.name, selectedProfile?.name]
                      .filter(Boolean)
                      .join(" / ") || "Fila e assunto"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${templateStatusTone(templateStatus)}`}
                >
                  {templateStatusLabel(templateStatus)}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                    Fila
                  </span>
                  <select
                    value={selectedQueue?.id ?? ""}
                    onChange={(event) => {
                      setSelectedQueueId(event.target.value);
                      setSelectedProfileId("");
                      setSelectedLocalTemplateId("");
                    }}
                    className="mt-2 h-10 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/60"
                  >
                    <option value="">Selecione a fila</option>
                    {activeQueues.map((queue) => (
                      <option key={queue.id} value={queue.id}>
                        {queue.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                    Assunto
                  </span>
                  <select
                    value={selectedProfile?.id ?? ""}
                    onChange={(event) => {
                      setSelectedProfileId(event.target.value);
                      setSelectedLocalTemplateId("");
                    }}
                    disabled={!selectedQueue || !subjectOptions.length}
                    className="mt-2 h-10 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/60 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">Selecione o assunto</option>
                    {subjectOptions.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                    Template aprovado
                  </span>
                  <select
                    value={selectedLocalTemplate?.id ?? ""}
                    onChange={(event) =>
                      setSelectedLocalTemplateId(event.target.value)
                    }
                    disabled={!selectedProfile || !templateOptions.length}
                    className="mt-2 h-10 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/60 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">Selecione o template</option>
                    {templateOptions.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 truncate text-xs font-medium text-slate-500">
                    {templateOptions.length
                      ? `${templateOptions.length} template(s) aprovado(s) para esta combinacao.`
                      : "Nenhum template aprovado para esta fila e assunto."}
                  </p>
                </label>
              </div>

              <label className="mt-4 block">
                <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                  Telefone de envio
                </span>
                <div className="mt-2 flex h-10 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3">
                  <Smartphone className="size-4 shrink-0 text-[#A07C3B]" aria-hidden="true" />
                  <select
                    value={selectedTemplatePhoneNumberId}
                    onChange={(event) =>
                      setSelectedTemplatePhoneNumberId(event.target.value)
                    }
                    disabled={
                      !selectedLocalTemplate ||
                      Boolean(selectedLocalTemplatePhoneNumberId)
                    }
                    className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-700 outline-none disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    <option value="">Selecione o telefone</option>
                    {selectedTemplatePhoneNumberId &&
                    !selectedTemplatePhoneNumberIsListed ? (
                      <option value={selectedTemplatePhoneNumberId}>
                        {selectedTemplatePhoneLabel}
                      </option>
                    ) : null}
                    {templatePhoneNumbers.map((phoneNumber) => (
                      <option key={phoneNumber.id} value={phoneNumber.id}>
                        {formatMetaPhoneNumberOption(phoneNumber)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="mt-1 truncate text-xs font-medium text-slate-500">
                  {selectedLocalTemplatePhoneNumberId
                    ? `${selectedTemplatePhoneLabel} esta salvo no template aprovado.`
                    : selectedTemplatePhoneNumber
                    ? `${formatMetaPhoneNumberOption(selectedTemplatePhoneNumber)} define a WABA do template.`
                    : "A Iris consulta e cria o template na WABA do telefone selecionado."}
                </p>
              </label>

              <div className="mt-4 rounded-xl border border-[#e7dfd3] bg-[#f8f4ec] p-3">
                {selectedLocalTemplate ? (
                  <>
                    <p className="text-sm font-medium leading-6 text-slate-800">
                      {preview}
                    </p>
                    {templateButtons.length ? (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {templateButtons.map((button) => (
                          <span
                            key={button}
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-emerald-100 bg-white text-sm font-semibold text-emerald-700"
                          >
                            {button}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm font-medium leading-6 text-slate-500">
                    Escolha fila e assunto para carregar os templates aprovados.
                  </p>
                )}
              </div>

              <p className="mt-3 text-xs leading-5 text-slate-500">
                No contato ativo, a Iris envia template aprovado apenas quando a janela de 24h estiver fechada.
              </p>

              <IrisTemplateFeedbackBox feedback={templateFeedback} />
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                Atendimento
              </p>
              <div className="mt-3 space-y-2">
                <ReadonlyMini label="Cliente" value={selectedClient?.label ?? "-"} />
                <ReadonlyMini label="Telefone" value={selectedClient ? formatPhoneForDisplay(selectedClient.phone) : "-"} />
                <ReadonlyMini label="Origem" value="Ativo" />
                <ReadonlyMini label="Status inicial" value="Espera" />
                <ReadonlyMini label="Fila" value={selectedQueue?.name ?? "-"} />
                <ReadonlyMini label="Assunto" value={selectedProfile?.name ?? "-"} />
                <ReadonlyMini label="Template" value={selectedLocalTemplate?.name ?? "-"} />
              </div>
            </div>
          </aside>
        </div>

        <footer className="border-t border-slate-100 p-4">
          {error ? (
            <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
              {error}
            </p>
          ) : null}
          {templatePhoneMismatch ? (
            <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
              O template aprovado nao pertence ao telefone de envio selecionado. Crie ou selecione um template aprovado para este telefone.
            </p>
          ) : null}
          {templatePhoneDisplayMissing ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              A Meta ainda nao retornou o numero exibivel deste telefone. A Iris vai usar o ID do telefone selecionado e a validacao server-side da WABA.
            </p>
          ) : null}
          {!selectedLocalTemplate ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              Se a janela de 24h estiver fechada, selecione um template aprovado para iniciar o contato ativo.
            </p>
          ) : !templateApproved ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              Se a janela de 24h estiver fechada, o template precisa estar aprovado pela Meta antes de iniciar contato ativo real.
            </p>
          ) : null}
          {selectedLocalTemplate && !selectedTemplatePhoneNumberId ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              Se a janela de 24h estiver fechada, selecione o telefone de envio. Esse telefone define onde o template existe na Meta.
            </p>
          ) : null}
          <button
            type="button"
            onClick={startTicket}
            disabled={!selectedClient || !templateCanStart || startingTicket}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1f2c3a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="size-4" aria-hidden="true" />
            {startingTicket ? "Iniciando atendimento..." : "Iniciar atendimento"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ReadonlyMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200/70 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold text-slate-800">
        {value}
      </p>
    </div>
  );
}

function IrisTicketRow({
  onOpenAttendance,
  onSelectTicket,
  showTimeline = false,
  ticket,
}: {
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  showTimeline?: boolean;
  ticket: IrisTicket;
}) {
  const effectiveStatus = effectiveIrisStatus(ticket);
  const origin = ticketOrigin(ticket);
  const timelineStartedAt = formatDateTime(ticket.openedAt);
  const timelineClosedAt = formatDateTime(
    ticket.closedAt ?? ticket.resolvedAt ?? ticket.lastMessageAt,
  );

  return (
    <article
      className={`grid min-w-0 gap-2 overflow-hidden border-b border-slate-100 px-3 py-2.5 transition-colors last:border-b-0 hover:bg-slate-50/70 xl:grid-cols-[repeat(10,minmax(0,1fr))_40px] xl:items-center ${
        ticket.unread ? "bg-[#A07C3B]/5 shadow-[inset_3px_0_0_#A07C3B]" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => onSelectTicket(ticket.id)}
        className="min-w-0 text-left"
      >
        <div className="flex items-start gap-2">
          <ContactAvatar ticket={ticket} size="sm" />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="min-w-0 truncate font-mono text-sm font-semibold text-[#7A5E2C]">
                {ticket.protocol}
              </span>
              {ticket.unread ? (
                <span className="rounded-full bg-[#A07C3B] px-2 py-0.5 text-[11px] font-semibold text-white shadow-[0_0_0_3px_rgba(160,124,59,0.12)]">
                  nova
                </span>
              ) : null}
              <PriorityPill priority={ticket.priority} />
              <Crm360Badge compact registration={ticket.crm360Registration} />
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-slate-950">
              {ticketContactLabel(ticket)}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {ticketCrmSubtitle(ticket)}
            </p>
            {showTimeline ? (
              <p className="mt-1 truncate text-[11px] font-medium text-slate-500">
                Inicio: {timelineStartedAt} | Encerramento: {timelineClosedAt}
              </p>
            ) : null}
          </div>
        </div>
      </button>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800">
          {ticket.queueLabel}
        </p>
      </div>

      <div className="min-w-0 text-sm font-medium text-slate-600">
        <p className="truncate">{formatIrisChannelLabel(ticket.channelLabel)}</p>
      </div>

      <div className="min-w-0 overflow-hidden">
        <StatusPill
          label={statusLabel[effectiveStatus]}
          tone={statusTone(effectiveStatus)}
        />
        {effectiveStatus === "pending" && ticket.status === "new" ? (
          <p className="mt-1 truncate text-xs text-rose-500">+3 min</p>
        ) : null}
      </div>

      <div className="min-w-0">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${slaClasses(ticket)}`}
        >
          {slaLabel(ticket)}
        </span>
        <p className="mt-1 text-xs text-slate-400">
          {formatDateTime(ticket.openedAt)}
        </p>
      </div>

      <div className="min-w-0">
        <OriginPill origin={origin} />
        <p className="mt-1 truncate text-xs text-slate-400">
          {ticket.sourceLabel}
        </p>
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800">
          {ticket.profileLabel}
        </p>
      </div>

      <div className="min-w-0 overflow-hidden">
        <p className="truncate text-sm font-semibold text-slate-800">
          {ticket.subject}
        </p>
        <p
          className="mt-1 max-w-full truncate text-xs text-slate-500"
          title={ticket.lastMessagePreview}
        >
          {ticket.lastMessagePreview}
        </p>
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800">
          {ticketResponseTimeLabel(ticket)}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {ticketResponseTimeState(ticket)}
        </p>
      </div>

      <p className="truncate text-sm font-medium text-slate-600">
        {ticket.assignedToLabel}
      </p>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onOpenAttendance(ticket.id)}
          title="Abrir atendimento"
          aria-label="Abrir atendimento do ticket"
          className="inline-flex size-8 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function AttendanceView({
  onClose,
  onOpenHistoryForTicket,
  onMessageCreated,
  onMessageUpdated,
  onTicketClosed,
  onTicketContextUpdated,
  onSelectTicket,
  selectedTicketId,
  ticket,
  tickets,
}: {
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
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-2xl border border-[#dbe3ef] bg-white">
        <div className="text-center">
          <MessageCircle className="mx-auto h-8 w-8 text-[#A07C3B]" />
          <h3 className="mt-3 text-base font-semibold">Selecione um ticket</h3>
        </div>
      </div>
    );
  }

  return (
    <IrisConversationPanel
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

function IrisConversationPanel({
  onClose,
  onOpenHistoryForTicket,
  onMessageCreated,
  onMessageUpdated,
  onTicketClosed,
  onTicketContextUpdated,
  onSelectTicket,
  selectedTicketId,
  ticket,
  tickets,
}: {
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
  const [draft, setDraft] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [recordingAudio, setRecordingAudio] = useState(false);
  const [replyToMessage, setReplyToMessage] =
    useState<IrisReplyPreview | null>(null);
  const [sending, setSending] = useState(false);
  const [closingTicket, setClosingTicket] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [search, setSearch] = useState("");
  const [showPreviousTickets, setShowPreviousTickets] = useState(false);
  const [conversationListCollapsed, setConversationListCollapsed] =
    useState(false);
  const [attendantOpen, setAttendantOpen] = useState(false);
  const [attendantPrompt, setAttendantPrompt] = useState("");
  const [attendantDocumentFragment, setAttendantDocumentFragment] =
    useState("");
  const [attendantDocumentPosition, setAttendantDocumentPosition] =
    useState<"last4" | "first4">("last4");
  const [attendantLoading, setAttendantLoading] = useState(false);
  const [attendantResult, setAttendantResult] =
    useState<IrisAttendantResponse | null>(null);
  const [attendantFeedback, setAttendantFeedback] = useState("");
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStartedAtRef = useRef<number | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const repairingOutboundMessageIds = useRef(new Set<string>());
  const { hubUser } = useAuth();
  const operatorLabel = formatIrisOperatorLabel(hubUser?.name);
  const operatorAvatarUrl = hubUser?.avatarUrl ?? null;
  const [contextModalMode, setContextModalMode] =
    useState<IrisContextModalMode>(null);
  const [apoloContextEntity, setApoloContextEntity] =
    useState<IrisApoloContextEntity | null>(null);
  const [apoloContextError, setApoloContextError] = useState<string | null>(null);
  const [apoloContextLoading, setApoloContextLoading] = useState(false);
  const [apoloContextUpdatedAt, setApoloContextUpdatedAt] = useState<string | null>(
    null,
  );
  const [contextNoteDraft, setContextNoteDraft] = useState("");
  const [contextAgendaEvents, setContextAgendaEvents] = useState<
    IrisTicketContextAgendaEvent[]
  >([]);
  const [contextAgendaTitleDraft, setContextAgendaTitleDraft] = useState("");
  const [contextAgendaDateDraft, setContextAgendaDateDraft] = useState("");
  const [contextAgendaNotesDraft, setContextAgendaNotesDraft] = useState("");
  const [contextAgendaMonthCursor, setContextAgendaMonthCursor] = useState(
    startOfMonthIso(),
  );
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

        if (conversationFilter === "Pendentes") {
          return [
            "new",
            "waiting_operator",
            "pending",
            "open",
          ].includes(effectiveIrisStatus(item));
        }

        if (conversationFilter === "Encerradas") {
          return isClosedTicket(item);
        }

        return !isClosedTicket(item);
      })
      .sort(sortIrisTickets);
  }, [conversationFilter, search, tickets]);

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
      setApoloContextError("Telefone ou nome insuficiente para consultar o Apolo.");
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
        const payload = (await response.json().catch(() => null)) as
          | {
              data?: {
                entities?: IrisApoloContextEntity[];
              };
              error?: string;
            }
          | null;

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
  }, [ticket.id]);

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
    ? ticket.messages.find((message) => message.id === editingMessageId) ?? null
    : null;
  const canSendFreeForm = operationReady && customerServiceWindow.open;
  const composerReady = editingMessage ? operationReady : canSendFreeForm;
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

    setClosingTicket(true);
    setFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/tickets", {
        body: JSON.stringify({
          action: "close",
          closeReason: "Encerrado manualmente no atendimento Iris.",
          ticketId: ticket.id,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            alreadyClosed?: boolean;
            error?: string;
            ticket?: {
              closedAt?: string | null;
              metadata?: Record<string, unknown> | null;
              resolvedAt?: string | null;
              status?: string | null;
            } | null;
          }
        | null;

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
            : ticket.resolvedAt ?? null,
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
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            ticket?: {
              metadata?: Record<string, unknown> | null;
            } | null;
          }
        | null;

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
    const body = draft.trim();

    if (!body || sending || !operationReady) {
      return;
    }

    if (editingMessageId) {
      await saveEditedMessage(body);
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
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            message?: Record<string, unknown> | null;
          }
        | null;

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

  async function saveEditedMessage(body: string) {
    if (!editingMessageId || sending) {
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
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            message?: Record<string, unknown> | null;
          }
        | null;

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
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            message?: Record<string, unknown> | null;
          }
        | null;

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
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            message?: Record<string, unknown> | null;
          }
        | null;

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

    if (!draft.trim() || sending || !composerReady || recordingAudio) {
      return;
    }

    void sendMessage();
  }

  async function toggleAudioRecording() {
    if (sending) {
      return;
    }

    if (recordingAudio) {
      mediaRecorderRef.current?.stop();
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

      audioChunksRef.current = [];
      audioStartedAtRef.current = Date.now();
      mediaRecorderRef.current = recorder;
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
        setRecordingAudio(false);
        mediaRecorderRef.current = null;
        audioStartedAtRef.current = null;
        audioChunksRef.current = [];

        if (chunks.length) {
          const audioBlob = new Blob(chunks, {
            type: recorder.mimeType || "audio/webm",
          });
          void sendAudioMessage(audioBlob, durationMs);
        }
      };
      recorder.start();
      setRecordingAudio(true);
      setFeedback("Gravando audio. Clique novamente no microfone para enviar.");
    } catch (error) {
      console.error("[caredesk] microfone indisponivel", error);
      setRecordingAudio(false);
      setFeedback("Nao foi possivel acessar o microfone.");
    }
  }

  async function sendAudioMessage(audioBlob: Blob, durationMs: number | null) {
    if (sending) {
      return;
    }

    if (!canSendFreeForm) {
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
      const dataUrl = await readBlobAsDataUrl(audioBlob);

      if (dataUrl.length > IRIS_AUDIO_MAX_DATA_URL_LENGTH) {
        throw new Error("Audio muito grande para este recorte de homologacao.");
      }

      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/messages", {
        body: JSON.stringify({
          body: "Audio WhatsApp",
          channelId: ticket.channelId ?? null,
          contactId: ticket.contactId ?? null,
          media: {
            dataUrl,
            durationMs,
            fileName: `iris-audio-${Date.now()}.webm`,
            mimeType: audioBlob.type || "audio/webm",
            type: "audio",
          },
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
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            message?: Record<string, unknown> | null;
          }
        | null;

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

  return (
    <section className="relative flex h-full min-h-0 w-full overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <aside
        className={[
          "hidden shrink-0 border-r border-slate-300/80 bg-white shadow-[4px_0_18px_rgba(15,23,42,0.05)] transition-all duration-300 lg:flex lg:flex-col",
          conversationListCollapsed ? "w-14" : "w-72",
        ].join(" ")}
      >
        <div
          className={
            conversationListCollapsed ? "p-2" : "border-b border-slate-100 p-3"
          }
        >
          {conversationListCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => setConversationListCollapsed(false)}
                className="flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
                aria-label="Expandir conversas"
                title="Expandir conversas"
              >
                <PanelLeftOpen className="size-4" aria-hidden="true" />
              </button>
              <div className="flex size-9 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
                <MessageCircle className="size-4" aria-hidden="true" />
              </div>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                {conversations.length}
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                    Inbox WhatsApp
                  </p>
                  <h2 className="mt-1 text-sm font-semibold text-slate-950">
                    Conversas
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setConversationListCollapsed(true)}
                  className="flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-[#7A5E2C]"
                  aria-label="Recolher conversas"
                  title="Recolher conversas"
                >
                  <PanelLeftClose className="size-4" aria-hidden="true" />
                </button>
              </div>
              <label className="mt-3 flex rounded-lg border border-slate-200/70 bg-white px-3 py-1.5">
                <span className="sr-only">Buscar conversa</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar conversa..."
                  className="h-7 w-full bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
                />
              </label>
              <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-slate-100/70 p-1">
                {["Abertas", "Pendentes", "Encerradas"].map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setConversationFilter(filter)}
                    className={[
                      "h-7 rounded-md text-[11px] font-semibold transition-colors",
                      conversationFilter === filter
                        ? "bg-white text-[#7A5E2C] shadow-sm"
                        : "text-slate-500 hover:bg-white/70",
                    ].join(" ")}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {!conversationListCollapsed ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
            {conversations.length ? (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => onSelectTicket(conversation.id)}
                  className={[
                    "mb-2 w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                    conversation.id === selectedTicketId
                      ? "border-[#A07C3B]/25 bg-[#A07C3B]/5"
                      : "border-slate-200/70 bg-white hover:bg-slate-50",
                  ].join(" ")}
                >
                  <div className="flex items-start gap-2.5">
                    <ContactAvatar ticket={conversation} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-semibold text-slate-950">
                          {ticketContactLabel(conversation)}
                        </p>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {conversationTime(conversation)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-slate-500 [overflow-wrap:anywhere]">
                        {conversation.lastMessagePreview}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-lg border border-slate-200/70 bg-white p-4 text-center text-xs font-semibold text-slate-400">
                Nenhuma conversa encontrada
              </div>
            )}
          </div>
        ) : null}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <header className="shrink-0 border-b border-slate-100 bg-white">
          <div className="flex flex-col gap-2 px-4 py-2.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <ContactAvatar ticket={ticket} size="md" />
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-slate-950">
                  {ticketContactLabel(ticket)}
                </h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500">
                  <span>{ticket.protocol}</span>
                  <span aria-hidden="true">-</span>
                  <span>{statusLabel[ticketStatus]}</span>
                  {ticketIncomplete ? (
                    <>
                      <span aria-hidden="true">-</span>
                      <Tooltip
                        content="Ticket criado e aguardando dados operacionais."
                        placement="bottom"
                      >
                        <span className="rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                          Autoaberto
                        </span>
                      </Tooltip>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-2 xl:justify-end">
              <label className="hidden h-9 max-w-full items-center gap-2 rounded-lg border border-slate-200/70 bg-slate-50/70 px-2 text-xs font-semibold text-slate-600 sm:inline-flex">
                <span className="shrink-0">Perfil</span>
                <select
                  value={ticket.profileLabel}
                  disabled
                  className="h-6 max-w-52 bg-transparent text-xs font-semibold text-slate-700 outline-none"
                  aria-label="Perfil do ticket"
                >
                  <option>{ticket.profileLabel}</option>
                </select>
              </label>
              <Tooltip
                content={
                  attendantOpen
                    ? "Ocultar Cacá"
                    : "Acionar Cacá"
                }
                placement="bottom"
              >
                <button
                  type="button"
                  onClick={() => setAttendantOpen((current) => !current)}
                  disabled={ticketClosed}
                  aria-label={
                    attendantOpen
                      ? "Ocultar Cacá"
                      : "Acionar Cacá"
                  }
                  className={[
                    "inline-flex size-9 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400",
                    attendantOpen
                      ? "border-[#A07C3B]/40 bg-[#101820] text-white hover:bg-[#17212b]"
                      : "border-[#A07C3B]/20 bg-[#fbf6ec] text-[#7A5E2C] hover:border-[#A07C3B]/35 hover:bg-[#f4ebdc]",
                  ].join(" ")}
                >
                  <Bot className="h-4 w-4" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip
                content={
                  ticketClosed
                    ? "Chat encerrado"
                    : closingTicket
                      ? "Encerrando chat..."
                      : "Encerrar chat"
                }
                placement="bottom"
              >
                <button
                  type="button"
                  onClick={() => void closeTicket()}
                  disabled={ticketClosed || closingTicket}
                  aria-label={
                    ticketClosed
                      ? "Chat encerrado"
                      : closingTicket
                        ? "Encerrando chat"
                        : "Encerrar chat"
                  }
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-rose-200/70 bg-rose-50/70 text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <CircleStop className="h-4 w-4" aria-hidden="true" />
                </button>
              </Tooltip>
              <div className="flex w-fit items-center gap-1 rounded-lg border border-slate-200/70 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <Tooltip content="Voltar para o board" placement="bottom">
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Voltar para o board"
                    className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#7A5E2C]"
                  >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip content="Protocolo" placement="bottom">
                  <button
                    type="button"
                    aria-label="Protocolo"
                    className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#7A5E2C]"
                  >
                    <FileText className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip content="SLA" placement="bottom">
                  <button
                    type="button"
                    aria-label="SLA"
                    className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#7A5E2C]"
                  >
                    <Clock3 className="size-4" aria-hidden="true" />
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

        {attendantOpen ? (
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

        <div
          ref={messagesViewportRef}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-slate-50/40 px-3 py-4 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin] sm:px-4"
        >
          <div className="w-full min-w-0 space-y-5">
            {previousTickets.length > 0 ? (
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPreviousTickets((current) => !current)}
                  className="inline-flex h-9 items-center rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
                >
                  {showPreviousTickets
                    ? "Ocultar tickets anteriores"
                    : `Ver tickets anteriores (${previousTickets.length})`}
                </button>
              </div>
            ) : null}

            {showPreviousTickets ? (
              <div className="space-y-3">
                {previousTickets.slice(0, 5).map((previousTicket) => (
                  <TicketSeparator
                    key={previousTicket.id}
                    ticket={previousTicket}
                    compact
                  />
                ))}
              </div>
            ) : null}

            <TicketSeparator ticket={ticket} />

            {ticket.messages.length > 0 ? (
              ticket.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onEdit={prepareEdit}
                  onReact={reactToMessage}
                  onReply={prepareReply}
                  ticket={ticket}
                />
              ))
            ) : (
              <EmptyState
                icon={MessageCircle}
                title="Sem mensagens registradas"
                description="A conversa deste ticket ainda nao possui mensagens no Iris."
              />
            )}
          </div>
        </div>

        <footer className="shrink-0 border-t border-slate-100 bg-white p-2.5">
          {ticketClosed ? (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
                <LockKeyhole className="size-3.5" aria-hidden="true" />
                <span>Ticket encerrado</span>
              </div>
              <TicketChecklist items={ticketChecklist} />
            </div>
          ) : null}

          {!ticketClosed ? (
            <div
              className={[
                "mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2",
                customerServiceWindow.open
                  ? "border-emerald-100 bg-emerald-50"
                  : "border-amber-200 bg-amber-50",
              ].join(" ")}
            >
              <div
                className={[
                  "flex min-w-0 items-center gap-2 text-xs font-semibold",
                  customerServiceWindow.open
                    ? "text-emerald-700"
                    : "text-amber-800",
                ].join(" ")}
              >
                {customerServiceWindow.open ? (
                  <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <LockKeyhole
                    className="size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0">{customerServiceWindow.label}</span>
              </div>
            </div>
          ) : null}

          <div className="mb-2 flex items-center justify-between gap-2">
            <OperationalToolbar disabled={!operationReady} />
            {operationReady ? (
              <TicketChecklist items={ticketChecklist} compact />
            ) : null}
          </div>

          {replyToMessage || editingMessage ? (
            <div className="mb-2 flex items-start justify-between gap-3 rounded-lg border border-[#eadcc2] bg-[#fbf6ec] px-3 py-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-normal text-[#7A5E2C]">
                  {editingMessage ? "Editando mensagem" : "Respondendo"}
                </p>
                <p className="mt-0.5 line-clamp-1 text-xs font-medium text-slate-600">
                  {editingMessage
                    ? editingMessage.body
                    : replyToMessage?.body ?? "Mensagem selecionada"}
                </p>
              </div>
              <button
                type="button"
                onClick={cancelComposerContext}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white hover:text-[#7A5E2C]"
                aria-label="Cancelar contexto"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}

          <div ref={emojiPickerRef} className="relative">
            {emojiPickerOpen && composerReady ? (
              <div className="absolute bottom-full left-0 z-20 mb-2 grid w-56 grid-cols-6 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
                {IRIS_EMOJI_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => insertEmoji(emoji)}
                    className="flex size-8 items-center justify-center rounded-lg text-base transition-colors hover:bg-slate-100"
                    aria-label={`Inserir ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}

            <div
              className={[
                "flex items-end gap-2 rounded-xl border border-slate-200/70 bg-slate-50/70 p-2 transition-opacity",
                composerReady ? "opacity-100" : "opacity-55",
              ].join(" ")}
            >
              <ComposerIconButton
                disabled={!composerReady}
                label="Emoji"
                onClick={() => setEmojiPickerOpen((current) => !current)}
              >
                <Smile className="size-4" aria-hidden="true" />
              </ComposerIconButton>
              <ComposerIconButton
                disabled
                label="Anexos em breve"
                onClick={() => undefined}
              >
                <Paperclip className="size-4" aria-hidden="true" />
              </ComposerIconButton>
              <textarea
                ref={composerTextareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={
                  composerReady
                    ? editingMessage
                      ? "Editar mensagem no Iris..."
                      : "Escrever mensagem WhatsApp..."
                    : ticketClosed
                      ? "Ticket encerrado"
                      : "Aguardando janela WhatsApp"
                }
                disabled={!composerReady}
                className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              <ComposerIconButton
                disabled={!canSendFreeForm || sending}
                label={recordingAudio ? "Parar e enviar audio" : "Enviar audio"}
                onClick={toggleAudioRecording}
              >
                {recordingAudio ? (
                  <CircleStop
                    className="size-4 text-rose-500"
                    aria-hidden="true"
                  />
                ) : (
                  <Mic className="size-4" aria-hidden="true" />
                )}
              </ComposerIconButton>
              <Tooltip
                content={
                  composerReady
                    ? editingMessage
                      ? "Salvar edicao"
                      : "Enviar mensagem"
                    : blockedTooltip
                }
                placement="top"
              >
                <button
                  type="button"
                  disabled={
                    sending || !draft.trim() || !composerReady || recordingAudio
                  }
                  onClick={sendMessage}
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
                  aria-label={
                    composerReady
                      ? editingMessage
                        ? "Salvar edicao"
                        : "Enviar mensagem"
                      : blockedTooltip
                  }
                >
                  <Send className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          </div>
        </footer>
      </main>

      <aside className="hidden w-[330px] shrink-0 border-l border-slate-100 bg-white xl:block">
        <div className="border-b border-slate-100 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <ContactAvatar ticket={ticket} size="lg" />
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                  Contexto
                </p>
                <h3 className="mt-1 truncate text-sm font-semibold text-slate-950">
                  {ticketContactLabel(ticket)}
                </h3>
                <p className="mt-0.5 text-xs font-medium text-slate-500">
                  {ticket.contactPhone ?? "Sem telefone"}
                </p>
              </div>
            </div>
            <MessageSquareText
              className="size-4 text-slate-300"
              aria-hidden="true"
            />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-slate-100/70 p-1">
            {contextShortcuts.map((shortcut, index) => (
              <Tooltip
                content={shortcut.label}
                key={index}
                placement="bottom"
              >
                <button
                  type="button"
                  onClick={shortcut.onClick}
                  disabled={Boolean(shortcut.disabled)}
                  className={[
                    "flex size-8 items-center justify-center rounded-md transition-colors",
                    shortcut.disabled
                      ? "cursor-not-allowed text-slate-300"
                      : shortcut.active
                        ? "bg-white text-[#7A5E2C]"
                        : "text-slate-500 hover:bg-white hover:text-[#7A5E2C]",
                  ].join(" ")}
                  aria-label={shortcut.label}
                >
                  <shortcut.icon className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className="min-h-0 space-y-2 overflow-y-auto p-3 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
              Nota do operador
            </p>
            <p className="mt-1 text-sm font-medium text-slate-700 [overflow-wrap:anywhere]">
              {ticketContextNote?.text?.trim() || "Sem nota registrada para este cliente."}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {ticketContextNote?.updatedAt
                ? `Atualizada em ${formatDateTime(ticketContextNote.updatedAt)}`
                : "Use o primeiro icone para registrar observacoes do atendimento."}
            </p>
          </div>
          <ContextItem label="Cliente" value={ticketContactLabel(ticket)} />
          <ContextItem label="CRM 360" value={crm360ContextLabel(ticket.crm360Registration)} />
          <ContextItem label="Telefone" value={ticket.contactPhone ?? "-"} />
          <ContextItem
            label="Documento"
            value={
              ticket.crm360Registration?.status === "registered"
                ? ticket.crm360Registration.documentMasked ??
                  ticket.contactDocument ??
                  "-"
                : ticket.contactDocument ?? "-"
            }
          />
          <ContextItem label="E-mail" value={ticket.contactEmail ?? "-"} />
          <ContextItem label="Fila" value={ticket.queueLabel} />
          <ContextItem label="Operador" value={ticket.assignedToLabel} />
          <ContextItem label="Protocolo" value={ticket.protocol} />
          <ContextItem label="Perfil" value={ticket.profileLabel} />
          <ContextItem label="SLA" value={slaLabel(ticket)} />
          <ContextItem
            label="Prioridade"
            value={priorityLabel[ticket.priority]}
          />
          <ContextItem label="Origem" value={ticket.sourceLabel} />
          <ContextItem
            label="Canal"
            value={formatIrisChannelLabel(ticket.channelLabel)}
          />
          <ContextItem
            label="Janela WhatsApp"
            value={customerServiceWindow.contextLabel}
          />

          <div className="rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
              Historico Iris
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-950">
              {previousTickets.length} tickets anteriores
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              {ticket.messages.length} mensagens neste atendimento.
            </p>
          </div>
        </div>
      </aside>

      {contextModalMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-[2px]">
          <button
            type="button"
            aria-label="Fechar popup de contexto"
            onClick={() => setContextModalMode(null)}
            className="absolute inset-0 cursor-default"
          />
          <section className="relative z-10 flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_24px_90px_rgba(15,23,42,0.24)]">
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                  Contexto do cliente
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">
                  {contextModalMode === "client"
                    ? "Dados do cliente e nota interna"
                    : "Agenda mensal e atividades"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {contextModalMode === "client"
                    ? "Dados vindos do Apolo e anotacoes do operador para continuidade do atendimento."
                    : "Visual mensal da agenda com criacao de tarefas do cliente."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setContextModalMode(null)}
                aria-label="Fechar popup"
                className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </header>

            {contextModalMode === "client" ? (
              <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 xl:grid-cols-[minmax(0,1fr)_340px] [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
                <div className="space-y-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                      Dados Apolo
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void loadApoloContext();
                      }}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/30 hover:text-[#7A5E2C]"
                    >
                      <RefreshCw
                        className={`size-3 ${apoloContextLoading ? "animate-spin" : ""}`}
                        aria-hidden="true"
                      />
                      Atualizar
                    </button>
                  </div>

                  {apoloContextLoading ? (
                    <p className="rounded-lg border border-slate-200/70 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
                      Carregando dados do Apolo...
                    </p>
                  ) : null}

                  {!apoloContextLoading && apoloContextError ? (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                      {apoloContextError}
                    </p>
                  ) : null}

                  {!apoloContextLoading && !apoloContextError && !apoloContextEntity ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      Cliente ainda nao localizado no Apolo para este contato.
                    </p>
                  ) : null}

                  {!apoloContextLoading && !apoloContextError && apoloContextEntity ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <ContextItem
                        label="Nome"
                        value={apoloContextEntity.displayName?.trim() || "Sem nome"}
                      />
                      <ContextItem
                        label="Documento"
                        value={apoloContextEntity.documentMasked?.trim() || "-"}
                      />
                      <ContextItem
                        label="Perfis"
                        value={formatIrisApoloProfiles(apoloContextEntity.profiles)}
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
                    <p className="text-[11px] font-medium text-slate-400">
                      Atualizado em {formatDateTime(apoloContextUpdatedAt)}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-3 rounded-xl border border-[#A07C3B]/15 bg-[#fbf6ec] p-3">
                  <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                    Nota interna
                  </p>
                  <textarea
                    value={contextNoteDraft}
                    onChange={(event) => setContextNoteDraft(event.target.value)}
                    rows={10}
                    placeholder="Registre observacoes importantes para os proximos atendimentos..."
                    className="w-full resize-none rounded-lg border border-[#eadcc2] bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/45"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void saveContextNote();
                    }}
                    disabled={contextSaving}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#101820] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#17212b] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <Save className="size-3.5" aria-hidden="true" />
                    {contextSaving ? "Salvando..." : "Salvar nota"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 xl:grid-cols-[minmax(0,1fr)_360px] [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
                <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setContextAgendaMonthCursor(
                          shiftMonthIso(contextAgendaMonthCursor, -1),
                        )
                      }
                      className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:border-[#A07C3B]/30 hover:text-[#7A5E2C]"
                      aria-label="Mes anterior"
                    >
                      <ChevronRight className="size-4 rotate-180" aria-hidden="true" />
                    </button>
                    <p className="text-sm font-semibold text-slate-900">
                      {agendaCalendar.monthLabel}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setContextAgendaMonthCursor(
                          shiftMonthIso(contextAgendaMonthCursor, 1),
                        )
                      }
                      className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:border-[#A07C3B]/30 hover:text-[#7A5E2C]"
                      aria-label="Proximo mes"
                    >
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {agendaCalendar.weekdayLabels.map((label) => (
                      <span
                        key={label}
                        className="px-1 py-1 text-center text-[11px] font-semibold text-slate-500"
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
                              ? "border-slate-200/70 bg-white"
                              : "border-slate-100 bg-slate-50 text-slate-400",
                          ].join(" ")}
                        >
                          <p
                            className={[
                              "text-[11px] font-semibold",
                              day.isToday ? "text-[#7A5E2C]" : "text-slate-600",
                            ].join(" ")}
                          >
                            {day.dayNumber}
                          </p>
                          {day.eventsCount > 0 ? (
                            <p className="mt-1 rounded-full bg-[#A07C3B]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#7A5E2C]">
                              {day.eventsCount} item{day.eventsCount > 1 ? "s" : ""}
                            </p>
                          ) : null}
                        </div>
                      )),
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="rounded-xl border border-[#A07C3B]/15 bg-[#fbf6ec] p-3">
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
                        className="h-10 w-full rounded-lg border border-[#eadcc2] bg-white px-3 text-sm text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/45"
                      />
                      <input
                        type="datetime-local"
                        value={contextAgendaDateDraft}
                        onChange={(event) =>
                          setContextAgendaDateDraft(event.target.value)
                        }
                        className="h-10 w-full rounded-lg border border-[#eadcc2] bg-white px-3 text-sm text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/45"
                      />
                      <textarea
                        rows={3}
                        value={contextAgendaNotesDraft}
                        onChange={(event) =>
                          setContextAgendaNotesDraft(event.target.value)
                        }
                        placeholder="Detalhes opcionais da atividade..."
                        className="w-full resize-none rounded-lg border border-[#eadcc2] bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/45"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void createContextAgendaEvent();
                      }}
                      disabled={contextSaving}
                      className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-[#101820] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#17212b] disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <CalendarClock className="size-3.5" aria-hidden="true" />
                      {contextSaving ? "Salvando..." : "Agendar atividade"}
                    </button>
                  </div>

                  <div className="rounded-xl border border-slate-200/70 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                      Linha do tempo
                    </p>
                    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
                      {agendaTimeline.length ? (
                        agendaTimeline.slice(0, 14).map((item) => (
                          <article
                            key={item.id}
                            className="rounded-lg border border-slate-200/70 bg-slate-50/70 px-3 py-2"
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-xs font-semibold text-slate-900">
                                {item.title}
                              </p>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                {item.kindLabel}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-slate-600">
                              {item.description}
                            </p>
                            <p className="mt-1 text-[10px] font-semibold text-slate-500">
                              {item.dateLabel}
                            </p>
                          </article>
                        ))
                      ) : (
                        <p className="rounded-lg border border-slate-200/70 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
                          Sem atividades registradas. A agenda esta pronta para novos agendamentos.
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

function IrisAttendantPanel({
  disabled,
  documentFragment,
  documentPosition,
  feedback,
  loading,
  onAnalyze,
  onClose,
  onDocumentFragmentChange,
  onDocumentPositionChange,
  onPromptChange,
  onSelectBillingItem,
  onUseReply,
  prompt,
  result,
}: {
  disabled: boolean;
  documentFragment: string;
  documentPosition: "last4" | "first4";
  feedback: string;
  loading: boolean;
  onAnalyze: () => void;
  onClose: () => void;
  onDocumentFragmentChange: (value: string) => void;
  onDocumentPositionChange: (value: "last4" | "first4") => void;
  onPromptChange: (value: string) => void;
  onSelectBillingItem: (item: IrisAttendantBillingItem) => void;
  onUseReply: () => void;
  prompt: string;
  result: IrisAttendantResponse | null;
}) {
  const billingItems = result?.billingItems ?? [];
  const replyText = result?.replyText?.trim() ?? "";
  const hasBoletoOptions =
    result?.nextStep === "choose_boleto" && billingItems.length > 0;

  return (
    <div className="shrink-0 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
      <div className="rounded-xl border border-[#A07C3B]/20 bg-white p-3 shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#101820] text-white">
              <Bot className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                Cacá
              </p>
              <h3 className="truncate text-sm font-semibold text-slate-950">
                Atendimento ao cliente e boletos
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#7A5E2C]"
            aria-label="Fechar Cacá"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 grid gap-2 xl:grid-cols-[1fr_210px_auto]">
          <label className="min-w-0 rounded-lg border border-slate-200/70 bg-slate-50 px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">
              Mensagem do cliente
            </span>
            <textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              disabled={disabled || loading}
              rows={2}
              placeholder="Use a ultima mensagem recebida ou descreva a solicitacao."
              className="mt-1 min-h-12 w-full resize-none bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:text-slate-400"
            />
          </label>

          <div className="rounded-lg border border-slate-200/70 bg-slate-50 px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">
              CPF/CNPJ
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                value={documentFragment}
                onChange={(event) =>
                  onDocumentFragmentChange(
                    event.target.value.replace(/\D/g, "").slice(0, 4),
                  )
                }
                disabled={disabled || loading}
                inputMode="numeric"
                placeholder="4 digitos"
                className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-900 outline-none transition-colors focus:border-[#A07C3B]/45 disabled:cursor-not-allowed disabled:text-slate-400"
              />
              <div className="grid w-[82px] grid-cols-2 rounded-md bg-white p-0.5 ring-1 ring-slate-200">
                {[
                  { label: "Fim", value: "last4" as const },
                  { label: "Ini", value: "first4" as const },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onDocumentPositionChange(option.value)}
                    disabled={disabled || loading}
                    className={[
                      "h-8 rounded text-[11px] font-semibold transition-colors disabled:cursor-not-allowed",
                      documentPosition === option.value
                        ? "bg-[#101820] text-white"
                        : "text-slate-500 hover:bg-slate-100",
                    ].join(" ")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onAnalyze}
            disabled={disabled || loading}
            className="inline-flex h-full min-h-14 items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            {loading ? "Analisando" : "Analisar"}
          </button>
        </div>

        {feedback ? (
          <div className="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {feedback}
          </div>
        ) : null}

        {result ? (
          <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0 rounded-lg border border-slate-200/70 bg-slate-50/70 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
                  <CheckCircle2 className="size-3 text-emerald-600" aria-hidden="true" />
                  {result.authentication?.label ?? "Analise pronta"}
                </span>
                {result.handoff?.required ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                    <ShieldAlert className="size-3" aria-hidden="true" />
                    Atendimento humano
                  </span>
                ) : null}
                {result.source ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#fbf6ec] px-2 py-1 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                    {result.source === "openai" ? "OpenAI" : "Regra segura"}
                  </span>
                ) : null}
              </div>

              {replyText ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">
                    Resposta sugerida
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                    {replyText}
                  </p>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={onUseReply}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#101820] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#17212b]"
                    >
                      <Send className="size-3.5" aria-hidden="true" />
                      Usar no rascunho
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="min-w-0 rounded-lg border border-slate-200/70 bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">
                Boletos
              </p>
              {hasBoletoOptions ? (
                <div className="mt-2 space-y-2">
                  {billingItems.slice(0, 6).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectBillingItem(item)}
                      disabled={loading}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-colors hover:border-[#A07C3B]/30 hover:bg-[#fbf6ec] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="block text-xs font-semibold text-slate-950">
                        {item.number} - {item.reference}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-medium text-slate-500">
                        {item.value} - {item.status}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-xs font-semibold text-slate-400">
                  Nenhum boleto selecionavel nesta analise.
                </div>
              )}
              {result.handoff?.reason ? (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>{result.handoff.reason}</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TicketSeparator({
  compact = false,
  ticket,
}: {
  compact?: boolean;
  ticket: IrisTicket;
}) {
  const status = effectiveIrisStatus(ticket);

  return (
    <div className="flex items-center justify-center gap-3">
      <div className="h-px flex-1 bg-slate-200/70" />
      <div
        className={[
          "rounded-2xl border border-slate-200/70 bg-white px-4 py-2 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
          compact ? "min-w-[260px]" : "min-w-[320px]",
        ].join(" ")}
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full bg-[#fbf6ec] px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
            Ticket {ticket.protocol}
          </span>
          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
            {statusLabel[status]}
          </span>
        </div>
        {!compact ? (
          <>
            <p className="mt-2 text-sm font-semibold text-slate-950">
              {ticketCrmSubtitle(ticket)}
            </p>
            <p className="mt-1 text-xs font-medium text-slate-500">
              {formatDateTime(ticket.openedAt)} - {ticket.queueLabel} -{" "}
              {formatIrisChannelLabel(ticket.channelLabel)}
            </p>
          </>
        ) : (
          <p className="mt-1 truncate text-xs font-medium text-slate-500">
            {formatDateTime(ticket.openedAt)} - {ticket.queueLabel}
          </p>
        )}
      </div>
      <div className="h-px flex-1 bg-slate-200/70" />
    </div>
  );
}

function OperationalToolbar({ disabled }: { disabled: boolean }) {
  const tools = [
    { icon: FileText, label: "Nota" },
    { icon: CalendarClock, label: "Retorno" },
    { icon: ClipboardList, label: "Tarefa" },
    { icon: TicketCheck, label: "Ticket" },
  ];

  return (
    <div className="flex items-center gap-1">
      {tools.map((tool) => (
        <Tooltip content={tool.label} key={tool.label} placement="top">
          <button
            type="button"
            disabled={disabled}
            aria-label={tool.label}
            className="flex size-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-400 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <tool.icon className="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

function ComposerIconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} placement="top">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-[#7A5E2C] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function TicketChecklist({
  compact = false,
  items,
}: {
  compact?: boolean;
  items: Array<{ id: string; label: string; ok: boolean }>;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {items.map((item) => (
        <span
          key={item.id}
          className={[
            "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ring-1",
            item.ok
              ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
              : "bg-white text-amber-700 ring-amber-200",
            compact ? "py-0.5" : "",
          ].join(" ")}
        >
          <CheckCircle2 className="size-3" aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function MetaWhatsAppEnginePanel() {
  const [events, setEvents] = useState<IrisMetaEvent[]>([]);
  const [refs, setRefs] = useState<IrisMetaRef[]>([]);
  const [summary, setSummary] = useState<IrisMetaEventsResponse["summary"]>({
    inbound: 0,
    refsKnown: 0,
    statuses: 0,
    total: 0,
  });
  const [to, setTo] = useState("");
  const [body, setBody] = useState("Teste Iris - WhatsApp homologacao.");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadEvents();
  }, []);

  async function loadEvents() {
    setLoading(true);
    setError(null);

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/events?limit=20", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as
        | IrisMetaEventsResponse
        | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel carregar eventos Meta.",
        );
      }

      setEvents(payload?.events ?? []);
      setRefs(payload?.refs ?? []);
      setSummary(payload?.summary ?? summary);
    } catch (eventError) {
      console.error("[iris] falha ao carregar eventos meta", eventError);
      setError(
        eventError instanceof Error
          ? eventError.message
          : "Nao foi possivel carregar eventos Meta.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function sendTestMessage() {
    if (sending) {
      return;
    }

    setSending(true);
    setFeedback(null);
    setError(null);

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/messages", {
        body: JSON.stringify({
          body,
          to,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            messageId?: string;
            persistence?: { ok?: boolean; warning?: string };
          }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Meta rejeitou o envio.");
      }

      setFeedback(
        payload?.persistence?.warning ??
          `Mensagem enviada pela Iris: ${payload?.messageId ?? "sem id"}.`,
      );
      setBody("");
      await loadEvents();
    } catch (sendError) {
      console.error("[iris] falha ao enviar meta whatsapp", sendError);
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Nao foi possivel enviar pelo WhatsApp.",
      );
    } finally {
      setSending(false);
    }
  }

  const latestOutbound = refs.find((ref) => ref.direction === "outbound");
  const latestInbound = events.find((event) => event.direction === "inbound");

  return (
    <section className="rounded-2xl border border-[#dbe3ef] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                Meta WhatsApp
              </p>
              <h3 className="text-base font-semibold text-slate-950">
                Motor de homologacao
              </h3>
            </div>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Envio manual protegido e leitura dos webhooks recebidos. Automacoes
            e disparo em massa continuam fora deste teste.
          </p>
        </div>

        <button
          type="button"
          onClick={loadEvents}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Activity className="h-4 w-4" aria-hidden="true" />
          Atualizar
        </button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <MiniMetaStat label="Eventos" value={summary?.total ?? 0} />
            <MiniMetaStat label="Entradas" value={summary?.inbound ?? 0} />
            <MiniMetaStat label="Status" value={summary?.statuses ?? 0} />
            <MiniMetaStat label="Refs" value={summary?.refsKnown ?? 0} />
          </div>

          <div className="rounded-xl border border-slate-200/70 bg-slate-50/60">
            <div className="flex items-center justify-between border-b border-slate-200/70 px-3 py-2">
              <p className="text-sm font-semibold text-slate-950">
                Ultimos webhooks
              </p>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                {loading ? "Carregando" : `${events.length} eventos`}
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto p-2 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              {events.length ? (
                events.map((event) => (
                  <MetaEventRow event={event} key={event.id} />
                ))
              ) : (
                <div className="rounded-lg border border-slate-200/70 bg-white p-4 text-center text-sm font-medium text-slate-500">
                  {loading
                    ? "Carregando eventos..."
                    : "Nenhum webhook encontrado."}
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-xl border border-[#A07C3B]/15 bg-[#fbf6ec] p-3">
            <p className="text-sm font-semibold text-slate-950">
              Envio manual
            </p>
            <label className="mt-3 block text-xs font-semibold text-slate-600">
              WhatsApp destino
              <input
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="55DDDnumero"
                className="mt-1 h-10 w-full rounded-lg border border-[#d8c8aa] bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-[#A07C3B]"
              />
            </label>
            <label className="mt-3 block text-xs font-semibold text-slate-600">
              Mensagem
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={4}
                className="mt-1 w-full resize-none rounded-lg border border-[#d8c8aa] bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#A07C3B]"
              />
            </label>
            <button
              type="button"
              onClick={sendTestMessage}
              disabled={sending || !to.trim() || !body.trim()}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#A07C3B] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {sending ? "Enviando" : "Enviar pela Iris"}
            </button>
          </div>

          {feedback ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
              {feedback}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
              {error}
            </div>
          ) : null}

          <BuilderCard
            icon={Wifi}
            title="Estado do motor"
            rows={[
              ["Ultima entrada", latestInbound?.messageText ?? "Sem entrada"],
              [
                "Ultima saida",
                latestOutbound?.deliveryStatus
                  ? latestOutbound.deliveryStatus
                  : "Aguardando envio",
              ],
              ["Canal", "Meta Cloud API"],
              ["Modo", "Homologacao manual"],
            ]}
          />
        </aside>
      </div>
    </section>
  );
}

function MiniMetaStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-slate-950">
        {formatCount(value)}
      </p>
    </div>
  );
}

function MetaEventRow({ event }: { event: IrisMetaEvent }) {
  const tone =
    event.direction === "inbound"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : event.direction === "status"
        ? "bg-sky-50 text-sky-700 ring-sky-100"
        : "bg-slate-50 text-slate-600 ring-slate-200";

  return (
    <div className="mb-2 rounded-lg border border-slate-200/70 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${tone}`}
            >
              {event.providerEventType}
            </span>
            <span className="text-[11px] font-semibold text-slate-400">
              {formatDateTime(event.receivedAt)}
            </span>
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-slate-950">
            {event.contactName ?? event.contactWaId ?? "Contato Meta"}
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
            {event.messageText ??
              event.statusDetail ??
              event.messageId ??
              "Evento sem texto operacional."}
          </p>
        </div>
        <StatusPill
          label={event.signatureValid ? "Assinado" : "Sem assinatura"}
          tone={event.signatureValid ? "green" : "danger"}
        />
      </div>
    </div>
  );
}

function BroadcastView({
  data,
  snapshot,
}: {
  data: IrisData;
  snapshot: ReturnType<typeof buildIrisSnapshot>;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-4">
      <section className="space-y-4">
        <div className="grid grid-cols-4 gap-3">
          <SignalCard
            icon={Megaphone}
            title="Campanhas"
            value={`${formatCount(data.broadcasts.length)} ativas`}
            tone="gold"
          />
          <SignalCard
            icon={UsersRound}
            title="Base apta"
            value={formatCount(snapshot.contacts)}
          />
          <SignalCard
            icon={Clock3}
            title="Janela"
            value="09h-18h"
            tone="blue"
          />
          <SignalCard
            icon={CheckCircle2}
            title="Aprovacao"
            value="Obrigatoria"
            tone="green"
          />
        </div>

        <MetaWhatsAppEnginePanel />

        <div className="rounded-2xl border border-[#dbe3ef] bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold">Disparos</h3>
            <button className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#A07C3B] px-3 text-sm font-semibold text-white">
              <Send className="h-4 w-4" />
              Novo disparo
            </button>
          </div>
          <div className="space-y-2">
            {data.broadcasts.length > 0 ? (
              data.broadcasts.map((campaign) => (
                <div
                  key={campaign.id}
                  className="grid grid-cols-[minmax(0,1fr)_150px_130px_110px] items-center gap-3 rounded-xl border border-[#e4eaf3] bg-[#fbfcfe] p-3"
                >
                  <div>
                    <p className="font-semibold">{campaign.name}</p>
                    <p className="text-xs text-[#63708a]">
                      {campaign.scheduledAt
                        ? formatDateTime(campaign.scheduledAt)
                        : "Sem agendamento"}
                    </p>
                  </div>
                  <span className="text-sm text-[#34415a]">WhatsApp</span>
                  <StatusPill label={campaign.status} />
                  <button className="justify-self-end rounded-lg border border-[#dbe3ef] px-3 py-2 text-xs font-semibold text-[#34415a]">
                    Abrir
                  </button>
                </div>
              ))
            ) : (
              <EmptyState
                icon={Megaphone}
                title="Nenhum disparo criado"
                description="Campanhas e comunicados em massa devem nascer nas tabelas de disparo do Iris."
              />
            )}
          </div>
        </div>
      </section>

      <aside className="space-y-3">
        <BuilderCard
          icon={SlidersHorizontal}
          title="Segmentacao"
          rows={[
            ["Publico", "Base de contatos do Iris"],
            ["Regra", "Fila + perfil + consentimento"],
            ["Canal", "Canal ativo"],
            ["Aprovacao", "Equipe Careli"],
          ]}
        />
        <BuilderCard
          icon={LockKeyhole}
          title="Governanca"
          rows={[
            ["Mensagem", "Personalizada"],
            ["Anexos", "Controlados"],
            ["Tom", "Careli"],
            ["Bloqueio", "Sem envio automatico"],
          ]}
        />
      </aside>
    </div>
  );
}

function SetupView({
  data,
  onQueuesChanged,
  onProfilesChanged,
  onTemplatesSynced,
  snapshot,
}: {
  data: IrisData;
  onQueuesChanged: (queues: IrisQueueConfig[]) => void;
  onProfilesChanged: (profiles: IrisTicketProfileConfig[]) => void;
  onTemplatesSynced: () => void;
  snapshot: ReturnType<typeof buildIrisSnapshot>;
}) {
  const firstQueueId = data.queues[0]?.id ?? "";
  const queueById = useMemo(
    () => new Map(data.queues.map((queue) => [queue.id, queue])),
    [data.queues],
  );
  const [selectedQueueId, setSelectedQueueId] = useState("all");
  const [editingQueueId, setEditingQueueId] = useState("");
  const [editingProfileId, setEditingProfileId] = useState("");
  const [queueForm, setQueueForm] = useState(() => createQueueForm());
  const [profileForm, setProfileForm] = useState(() =>
    createProfileForm(firstQueueId),
  );
  const [subjectSearch, setSubjectSearch] = useState("");
  const [savingQueue, setSavingQueue] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [queueFeedback, setQueueFeedback] = useState<string | null>(null);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [setupTab, setSetupTab] = useState<"profiles" | "templates">(
    "profiles",
  );
  const selectedQueue = data.queues.find((queue) => queue.id === selectedQueueId);

  useEffect(() => {
    if (!profileForm.queueId && firstQueueId) {
      setProfileForm((current) => ({
        ...current,
        queueId: firstQueueId,
      }));
    }
  }, [firstQueueId, profileForm.queueId]);

  const visibleProfiles = useMemo(
    () =>
      data.profiles
        .filter((profile) => {
          const matchesQueue =
            selectedQueueId === "all" || profile.queueId === selectedQueueId;
          const search = subjectSearch.trim().toLowerCase();
          const matchesSearch =
            !search ||
            [
              profile.name,
              profile.slug,
              profile.category,
              profile.queueLabel,
              profile.description,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(search);

          return matchesQueue && matchesSearch;
        })
        .sort(sortIrisProfiles),
    [data.profiles, selectedQueueId, subjectSearch],
  );
  const activeProfiles = data.profiles.filter(
    (profile) => profile.status === "active",
  ).length;
  const activeQueues = data.queues.filter(
    (queue) => queue.status === "active",
  ).length;
  const categories = unique(
    data.profiles.map((profile) => profile.category).filter(Boolean),
  );

  function updateQueueForm(field: string, value: string) {
    setQueueFeedback(null);
    setQueueForm((current) => {
      const next = {
        ...current,
        [field]: value,
      };

      if (field === "name" && !editingQueueId) {
        next.slug = slugifyIrisQueue(value);
      }

      return next;
    });
  }

  function updateProfileForm(field: string, value: string) {
    setProfileFeedback(null);
    setProfileForm((current) => {
      const next = {
        ...current,
        [field]: value,
      };

      if (field === "name" && !editingProfileId) {
        next.slug = slugifyIrisProfile(value);
      }

      return next;
    });
  }

  function startNewQueue() {
    setEditingQueueId("");
    setQueueFeedback(null);
    setQueueForm(createQueueForm());
  }

  function startEditQueue(queue: IrisQueueConfig) {
    setEditingQueueId(queue.id);
    setQueueFeedback(null);
    setQueueForm(queueToForm(queue));
    setSelectedQueueId(queue.id);
    setProfileForm((current) => ({
      ...current,
      queueId: current.queueId || queue.id,
    }));
  }

  function startNewProfile() {
    setEditingProfileId("");
    setProfileFeedback(null);
    setProfileForm(
      createProfileForm(selectedQueueId === "all" ? firstQueueId : selectedQueueId),
    );
  }

  function startEditProfile(profile: IrisTicketProfileConfig) {
    setEditingProfileId(profile.id);
    setProfileFeedback(null);
    setProfileForm(profileToForm(profile));
  }

  async function saveQueue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!queueForm.name.trim() || !queueForm.slug.trim()) {
      setQueueFeedback("Preencha nome e slug da fila.");
      return;
    }

    setSavingQueue(true);
    setQueueFeedback(null);

    try {
      const savedRow = await saveIrisQueue(queueForm);
      const savedQueue = mapQueueRow(savedRow);
      const nextQueues = [
        ...data.queues.filter(
          (queue) =>
            queue.id !== savedQueue.id && queue.slug !== savedQueue.slug,
        ),
        savedQueue,
      ].sort(sortIrisQueues);

      onQueuesChanged(nextQueues);
      setEditingQueueId(savedQueue.id);
      setSelectedQueueId(savedQueue.id);
      setQueueForm(queueToForm(savedQueue));
      setProfileForm((current) => ({
        ...current,
        queueId: current.queueId || savedQueue.id,
      }));
      setQueueFeedback("Fila salva no Iris.");
    } catch (error) {
      setQueueFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel salvar a fila do Iris.",
      );
    } finally {
      setSavingQueue(false);
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!profileForm.queueId) {
      setProfileFeedback("Selecione uma fila antes de salvar o assunto.");
      return;
    }

    if (
      !profileForm.name.trim() ||
      !profileForm.slug.trim() ||
      !profileForm.category.trim()
    ) {
      setProfileFeedback("Preencha nome, slug e categoria do assunto.");
      return;
    }

    setSavingProfile(true);
    setProfileFeedback(null);

    try {
      const savedRow = await saveIrisTicketProfile(profileForm);
      const savedProfile = mapTicketProfileRow(
        savedRow,
        savedRow.queue_id ? queueById.get(savedRow.queue_id) : null,
      );
      const nextProfiles = [
        ...data.profiles.filter(
          (profile) =>
            profile.id !== savedProfile.id &&
            !(
              profile.queueId === savedProfile.queueId &&
              profile.slug === savedProfile.slug
            ),
        ),
        savedProfile,
      ].sort(sortIrisProfiles);

      onProfilesChanged(nextProfiles);
      setEditingProfileId(savedProfile.id);
      setProfileForm(profileToForm(savedProfile));
      setProfileFeedback("Assunto de atendimento salvo no Iris.");
    } catch (error) {
      setProfileFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel salvar o assunto do Iris.",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  if (setupTab === "templates") {
    return (
      <div className="grid h-full min-h-0 gap-4 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
        <section className="min-w-0 rounded-2xl border border-[#dbe3ef] bg-white p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A07C3B]">
                Setup Iris
              </p>
              <h3 className="mt-1 text-base font-semibold text-[#101820]">
                Templates Meta WhatsApp
              </h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[#63708a]">
                Criacao, status Meta e variaveis CRM 360 para contato ativo.
              </p>
            </div>
            <IrisSetupTabs active={setupTab} onChange={setSetupTab} />
          </div>

          <IrisTemplateSetupPanel
            profiles={data.profiles}
            queues={data.queues}
            onTemplatesSynced={onTemplatesSynced}
            templates={data.templates}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 gap-4 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
      <section className="min-w-0 rounded-2xl border border-[#dbe3ef] bg-white p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A07C3B]">
              Setup Iris
            </p>
            <h3 className="mt-1 text-base font-semibold text-[#101820]">
              Filas e assuntos
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#63708a]">
              Cada fila define roteamento e SLA base. Cada assunto define o
              tipo de atendimento que o operador vai usar no ticket.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <IrisSetupTabs active={setupTab} onChange={setSetupTab} />
            <button
              type="button"
              onClick={startNewQueue}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] transition-colors hover:border-[#A07C3B]/30 hover:text-[#7A5E2C]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nova fila
            </button>
            <button
              type="button"
              onClick={startNewProfile}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#101820] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#1f2937]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Novo assunto
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <IrisTemplateMetricCard
            icon={Workflow}
            label="Filas"
            value={formatCount(data.queues.length)}
          />
          <IrisTemplateMetricCard
            icon={Route}
            label="Filas ativas"
            tone="green"
            value={formatCount(activeQueues)}
          />
          <IrisTemplateMetricCard
            icon={MessageSquareText}
            label="Assuntos"
            tone="gold"
            value={formatCount(data.profiles.length)}
          />
          <IrisTemplateMetricCard
            icon={SlidersHorizontal}
            label="Categorias"
            tone="blue"
            value={formatCount(categories.length)}
          />
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px] 2xl:grid-cols-[320px_minmax(0,1fr)_390px]">
          <div className="min-w-0 space-y-3 xl:max-h-[calc(100vh-300px)] xl:overflow-y-auto xl:pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
            <div className="rounded-2xl border border-[#dbe3ef] bg-[#fbfcfe] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-normal text-[#8a96aa]">
                    Filas
                  </p>
                  <h4 className="mt-1 text-sm font-semibold text-[#101820]">
                    Rotas de atendimento
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={startNewQueue}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-[#dbe3ef] bg-white text-[#A07C3B] transition-colors hover:border-[#A07C3B]/35"
                  aria-label="Nova fila"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => setSelectedQueueId("all")}
                  className={[
                    "w-full rounded-xl border p-3 text-left transition-colors",
                    selectedQueueId === "all"
                      ? "border-[#101820] bg-white"
                      : "border-[#e4eaf3] bg-white hover:border-[#A07C3B]/35",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#101820]">
                      Todas as filas
                    </span>
                    <span className="rounded-full bg-[#f4f6fa] px-2 py-0.5 text-[11px] font-semibold text-[#63708a]">
                      {formatCount(data.profiles.length)}
                    </span>
                  </div>
                </button>

                {data.queues.map((queue) => {
                  const selected = selectedQueueId === queue.id;
                  const queueSubjects = data.profiles.filter(
                    (profile) => profile.queueId === queue.id,
                  ).length;

                  return (
                    <button
                      key={queue.id}
                      type="button"
                      onClick={() => startEditQueue(queue)}
                      className={[
                        "w-full rounded-xl border p-3 text-left transition-colors",
                        selected
                          ? "border-[#A07C3B]/55 bg-[#fbf6ec]"
                          : "border-[#e4eaf3] bg-white hover:border-[#A07C3B]/35",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: queue.color }}
                            />
                            <span className="truncate text-sm font-semibold text-[#101820]">
                              {queue.name}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs font-medium text-[#63708a]">
                            {queue.slug} | {queue.assignmentStrategy}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                          {setupStatusLabel[queue.status] ?? queue.status}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/20">
                          {priorityLabel[queue.defaultPriority]}
                        </span>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                          {formatCount(queueSubjects)} assuntos
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <form
              onSubmit={saveQueue}
              className="rounded-2xl border border-[#dbe3ef] bg-white p-3"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#fbf6ec] text-[#A07C3B]">
                  <Workflow className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h4 className="text-sm font-semibold text-[#101820]">
                    {editingQueueId ? "Editar fila" : "Nova fila"}
                  </h4>
                  <p className="text-xs text-[#63708a]">
                    caredesk_queues
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <SetupField label="Nome da fila">
                  <input
                    value={queueForm.name}
                    onChange={(event) =>
                      updateQueueForm("name", event.target.value)
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    placeholder="Atendimento"
                  />
                </SetupField>
                <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
                  <SetupField label="Slug">
                    <input
                      value={queueForm.slug}
                      onChange={(event) =>
                        updateQueueForm(
                          "slug",
                          slugifyIrisQueue(event.target.value),
                        )
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                      placeholder="atendimento"
                    />
                  </SetupField>
                  <SetupField label="Cor">
                    <input
                      type="color"
                      value={queueForm.color}
                      onChange={(event) =>
                        updateQueueForm("color", event.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white p-1 outline-none"
                    />
                  </SetupField>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SetupField label="Prioridade">
                    <select
                      value={queueForm.defaultPriority}
                      onChange={(event) =>
                        updateQueueForm("defaultPriority", event.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    >
                      {priorityOptions.map((priority) => (
                        <option key={priority} value={priority}>
                          {priorityLabel[priority]}
                        </option>
                      ))}
                    </select>
                  </SetupField>
                  <SetupField label="Status">
                    <select
                      value={queueForm.status}
                      onChange={(event) =>
                        updateQueueForm("status", event.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    >
                      {setupStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {setupStatusLabel[status]}
                        </option>
                      ))}
                    </select>
                  </SetupField>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SetupField label="1a resposta">
                    <input
                      type="number"
                      min="1"
                      value={queueForm.slaFirstResponseMinutes}
                      onChange={(event) =>
                        updateQueueForm(
                          "slaFirstResponseMinutes",
                          event.target.value,
                        )
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    />
                  </SetupField>
                  <SetupField label="Resolucao">
                    <input
                      type="number"
                      min="1"
                      value={queueForm.slaResolutionMinutes}
                      onChange={(event) =>
                        updateQueueForm(
                          "slaResolutionMinutes",
                          event.target.value,
                        )
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    />
                  </SetupField>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SetupField label="Roteamento">
                    <input
                      value={queueForm.routingStrategy}
                      onChange={(event) =>
                        updateQueueForm("routingStrategy", event.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    />
                  </SetupField>
                  <SetupField label="Distribuicao">
                    <input
                      value={queueForm.assignmentStrategy}
                      onChange={(event) =>
                        updateQueueForm(
                          "assignmentStrategy",
                          event.target.value,
                        )
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    />
                  </SetupField>
                </div>
              </div>

              {queueFeedback ? (
                <p className="mt-3 rounded-lg border border-[#dbe3ef] bg-[#fbfcfe] px-3 py-2 text-xs font-semibold text-[#63708a]">
                  {queueFeedback}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={savingQueue}
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#101820] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                {savingQueue ? "Salvando..." : "Salvar fila"}
              </button>
            </form>
          </div>

          <div className="min-w-0 rounded-2xl border border-[#dbe3ef] bg-[#fbfcfe] p-3 xl:max-h-[calc(100vh-300px)] xl:overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-normal text-[#8a96aa]">
                  Assuntos
                </p>
                <h4 className="mt-1 text-sm font-semibold text-[#101820]">
                  {selectedQueue?.name ?? "Todas as filas"}
                </h4>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                {formatCount(visibleProfiles.length)} visiveis
              </span>
            </div>

            <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px]">
              <label className="relative block min-w-0">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A07C3B]"
                  aria-hidden="true"
                />
                <input
                  value={subjectSearch}
                  onChange={(event) => setSubjectSearch(event.target.value)}
                  placeholder="Buscar assunto"
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white pl-9 pr-3 text-sm font-semibold text-[#34415a] outline-none"
                />
              </label>
              <FilterSelect
                label="Fila"
                value={selectedQueueId}
                options={["all", ...data.queues.map((queue) => queue.id)]}
                optionLabels={{
                  all: "Todas",
                  ...Object.fromEntries(
                    data.queues.map((queue) => [queue.id, queue.name]),
                  ),
                }}
                onChange={setSelectedQueueId}
              />
            </div>

            <div className="mt-3 max-h-[calc(100vh-430px)] overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              <div className="space-y-2">
                {visibleProfiles.length > 0 ? (
                  visibleProfiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => startEditProfile(profile)}
                      className={[
                        "w-full rounded-xl border p-3 text-left transition-colors",
                        editingProfileId === profile.id
                          ? "border-[#A07C3B]/45 bg-[#fbf6ec]"
                          : "border-[#e4eaf3] bg-white hover:border-[#A07C3B]/30",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#101820]">
                            {profile.name}
                          </p>
                          <p className="mt-1 truncate text-xs font-medium text-[#63708a]">
                            {profile.queueLabel} | {profile.category} |{" "}
                            {profile.slug}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                          {setupStatusLabel[profile.status] ?? profile.status}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/20">
                          {priorityLabel[profile.priority]}
                        </span>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                          TPR {profile.slaFirstResponseMinutes} min
                        </span>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                          TMA {formatSlaMinutes(profile.slaResolutionMinutes)}
                        </span>
                      </div>
                    </button>
                  ))
                ) : (
                  <EmptyState
                    icon={Route}
                    title="Nenhum assunto configurado"
                    description="Cadastre assuntos para padronizar triagem, prioridade, SLA e metricas da Iris."
                  />
                )}
              </div>
            </div>
          </div>

          <form
            onSubmit={saveProfile}
            className="rounded-2xl border border-[#dbe3ef] bg-white p-3 xl:max-h-[calc(100vh-300px)] xl:overflow-y-auto xl:pr-3 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fbf6ec] text-[#A07C3B]">
                <Settings2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h4 className="text-sm font-semibold text-[#101820]">
                  {editingProfileId ? "Editar assunto" : "Novo assunto"}
                </h4>
                <p className="text-xs text-[#63708a]">
                  caredesk_ticket_profiles
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <SetupField label="Fila">
                <select
                  value={profileForm.queueId}
                  onChange={(event) =>
                    updateProfileForm("queueId", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                >
                  <option value="">Selecione</option>
                  {data.queues.map((queue) => (
                    <option key={queue.id} value={queue.id}>
                      {queue.name}
                    </option>
                  ))}
                </select>
              </SetupField>

              <SetupField label="Nome do assunto">
                <input
                  value={profileForm.name}
                  onChange={(event) =>
                    updateProfileForm("name", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                  placeholder="Ex.: Segunda via de boleto"
                />
              </SetupField>

              <div className="grid grid-cols-2 gap-2">
                <SetupField label="Slug">
                  <input
                    value={profileForm.slug}
                    onChange={(event) =>
                      updateProfileForm(
                        "slug",
                        slugifyIrisProfile(event.target.value),
                      )
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    placeholder="segunda-via-boleto"
                  />
                </SetupField>
                <SetupField label="Categoria">
                  <input
                    value={profileForm.category}
                    onChange={(event) =>
                      updateProfileForm("category", event.target.value)
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    placeholder="Financeiro"
                  />
                </SetupField>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <SetupField label="Prioridade">
                  <select
                    value={profileForm.priority}
                    onChange={(event) =>
                      updateProfileForm("priority", event.target.value)
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                  >
                    {priorityOptions.map((priority) => (
                      <option key={priority} value={priority}>
                        {priorityLabel[priority]}
                      </option>
                    ))}
                  </select>
                </SetupField>
                <SetupField label="Status">
                  <select
                    value={profileForm.status}
                    onChange={(event) =>
                      updateProfileForm("status", event.target.value)
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                  >
                    {setupStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {setupStatusLabel[status]}
                      </option>
                    ))}
                  </select>
                </SetupField>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <SetupField label="TPR">
                  <input
                    type="number"
                    min="1"
                    value={profileForm.slaFirstResponseMinutes}
                    onChange={(event) =>
                      updateProfileForm(
                        "slaFirstResponseMinutes",
                        event.target.value,
                      )
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                  />
                </SetupField>
                <SetupField label="TMA alvo">
                  <input
                    type="number"
                    min="1"
                    value={profileForm.slaResolutionMinutes}
                    onChange={(event) =>
                      updateProfileForm(
                        "slaResolutionMinutes",
                        event.target.value,
                      )
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                  />
                </SetupField>
              </div>

              <SetupField label="Campos obrigatorios">
                <input
                  value={profileForm.requiredFields}
                  onChange={(event) =>
                    updateProfileForm("requiredFields", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                  placeholder="contact_id, queue_id"
                />
              </SetupField>

              <SetupField label="Descricao">
                <textarea
                  value={profileForm.description}
                  onChange={(event) =>
                    updateProfileForm("description", event.target.value)
                  }
                  className="min-h-20 w-full resize-none rounded-lg border border-[#dbe3ef] bg-white px-3 py-2 text-sm font-medium text-[#34415a] outline-none"
                  placeholder="Quando usar este assunto no atendimento."
                />
              </SetupField>
            </div>

            {profileFeedback ? (
              <p className="mt-3 rounded-lg border border-[#dbe3ef] bg-[#fbfcfe] px-3 py-2 text-xs font-semibold text-[#63708a]">
                {profileFeedback}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={savingProfile}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#A07C3B] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {savingProfile ? "Salvando..." : "Salvar assunto"}
            </button>
          </form>
        </div>
      </section>

    </div>
  );
}

function IrisSetupTabs({
  active,
  onChange,
}: {
  active: "profiles" | "templates";
  onChange: (tab: "profiles" | "templates") => void;
}) {
  const tabs = [
    { id: "profiles" as const, icon: Route, label: "Filas e assuntos" },
    { id: "templates" as const, icon: MessageSquareText, label: "Templates" },
  ];

  return (
    <div className="inline-flex h-10 rounded-xl border border-[#dbe3ef] bg-[#fbfcfe] p-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const selected = active === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={[
              "inline-flex items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors",
              selected
                ? "bg-[#101820] text-white shadow-sm"
                : "text-[#63708a] hover:bg-white hover:text-[#101820]",
            ].join(" ")}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function IrisTemplateSetupPanel({
  onTemplatesSynced,
  profiles,
  queues,
  templates,
}: {
  onTemplatesSynced: () => void;
  profiles: IrisTicketProfileConfig[];
  queues: IrisQueueConfig[];
  templates: IrisTemplate[];
}) {
  const [templateForm, setTemplateForm] = useState(() =>
    createIrisTemplateForm(),
  );
  const [checkingTemplate, setCheckingTemplate] = useState(false);
  const [syncingMetaTemplates, setSyncingMetaTemplates] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [uploadingTemplateMedia, setUploadingTemplateMedia] = useState(false);
  const [autoRefreshStatus, setAutoRefreshStatus] = useState(true);
  const [lastTemplateRefreshAt, setLastTemplateRefreshAt] = useState("");
  const [metaStatus, setMetaStatus] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateFeedback, setTemplateFeedback] =
    useState<IrisTemplateFeedback | string>("");
  const [removingTemplateId, setRemovingTemplateId] = useState<string | null>(
    null,
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [templatePhoneNumbers, setTemplatePhoneNumbers] = useState<
    IrisMetaPhoneNumberOption[]
  >([]);
  const templateMediaInputRef = useRef<HTMLInputElement | null>(null);
  const templateSyncNotifiedRef = useRef(new Set<string>());
  const localTemplate = useMemo(
    () => findIrisTemplateByMetaName(templates, templateForm.name),
    [templateForm.name, templates],
  );
  const selectedLibraryTemplate = useMemo(() => {
    if (selectedTemplateId) {
      return templates.find((template) => template.id === selectedTemplateId) ?? null;
    }

    return localTemplate ?? null;
  }, [localTemplate, selectedTemplateId, templates]);
  const displayedStatus =
    metaStatus ?? readTemplateMetaStatus(selectedLibraryTemplate) ?? null;
  const buttons = parseTemplateButtons(templateForm.buttonsText);
  const preview = renderMetaTemplatePreview(
    templateForm.bodyText,
    templateForm.variables,
  );
  const subjectProfileOptions = useMemo(
    () => [...profiles].sort(sortIrisProfiles),
    [profiles],
  );
  const selectedSubjectProfileId = useMemo(() => {
    const exactMatch = subjectProfileOptions.find(
      (profile) =>
        profile.name === templateForm.subjectLabel &&
        profile.queueLabel === templateForm.queueLabel,
    );
    const subjectMatch = subjectProfileOptions.find(
      (profile) => profile.name === templateForm.subjectLabel,
    );

    return exactMatch?.id ?? subjectMatch?.id ?? (templateForm.subjectLabel ? "__current" : "");
  }, [subjectProfileOptions, templateForm.queueLabel, templateForm.subjectLabel]);
  const templateSubjectMissing =
    !templateForm.subjectLabel.trim() || !templateForm.queueLabel.trim();
  const templatePhoneMissing = !templateForm.phoneNumberId.trim();
  const selectedTemplatePhoneNumber = findMetaPhoneNumberOption(
    templatePhoneNumbers,
    templateForm.phoneNumberId,
  );
  const templatePhoneDisplayMissing = Boolean(
    templateForm.phoneNumberId.trim() &&
      !selectedTemplatePhoneNumber?.displayPhoneNumber,
  );
  const selectedHeaderOption =
    IRIS_TEMPLATE_HEADER_OPTIONS.find(
      (option) => option.id === templateForm.headerFormat,
    ) ?? IRIS_TEMPLATE_HEADER_OPTIONS[0];
  const templateMediaMissing =
    templateForm.headerFormat !== "NONE" && !templateForm.headerHandle.trim();
  const queueOptions = useMemo(
    () =>
      unique([
        ...queues.map((queue) => queue.name),
        ...templates.map(readTemplateQueueLabel),
        templateForm.queueLabel,
      ].filter(Boolean)).slice(0, 12),
    [queues, templateForm.queueLabel, templates],
  );
  const templateStats = useMemo(
    () => ({
      approved: templates.filter(
        (template) => readTemplateStatusGroup(template) === "APPROVED",
      ).length,
      pending: templates.filter(
        (template) => readTemplateStatusGroup(template) === "PENDING",
      ).length,
      rejected: templates.filter(
        (template) => readTemplateStatusGroup(template) === "REJECTED",
      ).length,
      total: templates.length,
    }),
    [templates],
  );
  const filteredTemplates = useMemo(() => {
    const search = templateSearch.trim().toLowerCase();

    return templates
      .filter((template) => {
        const queueLabel = readTemplateQueueLabel(template);
        const subjectLabel = readTemplateSubjectLabel(template);
        const statusGroup = readTemplateStatusGroup(template);
        const searchable = [
          template.name,
          readTemplateMetaName(template),
          queueLabel,
          subjectLabel,
          template.body,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return (
          (queueFilter === "all" || queueLabel === queueFilter) &&
          (statusFilter === "all" || statusGroup === statusFilter) &&
          (!search || searchable.includes(search))
        );
      })
      .sort(sortIrisTemplatesForSetup);
  }, [queueFilter, statusFilter, templateSearch, templates]);

  useEffect(() => {
    if (
      selectedTemplateId &&
      !templates.some((template) => template.id === selectedTemplateId)
    ) {
      setSelectedTemplateId(null);
    }
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    setMetaStatus(readTemplateMetaStatus(selectedLibraryTemplate));
  }, [selectedLibraryTemplate]);

  useEffect(() => {
    if (!autoRefreshStatus || !templateForm.name.trim()) {
      return;
    }

    const timer = window.setInterval(() => {
      void checkTemplateStatus({ silent: true });
    }, IRIS_TEMPLATE_AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [
    autoRefreshStatus,
    templateForm.language,
    templateForm.name,
    templateForm.phoneNumberId,
  ]);

  useEffect(() => {
    void checkTemplateStatus({ silent: true });
  }, []);

  function updateTemplateForm(field: string, value: string) {
    setTemplateFeedback("");
    setTemplateForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function startNewTemplate() {
    setSelectedTemplateId(null);
    setMetaStatus(null);
    setLastTemplateRefreshAt("");
    setTemplateFeedback("");
    setTemplateForm({
      ...createIrisTemplateDraft(),
      phoneNumberId:
        selectedTemplatePhoneNumber?.id ??
        templatePhoneNumbers.find((phoneNumber) => phoneNumber.isDefault)?.id ??
        templatePhoneNumbers[0]?.id ??
        "",
    });
  }

  function applyTemplateLibraryPreset(
    preset: (typeof IRIS_META_TEMPLATE_LIBRARY_PRESETS)[number],
  ) {
    setSelectedTemplateId(null);
    setMetaStatus(null);
    setLastTemplateRefreshAt("");
    setTemplateFeedback("");
    setTemplateForm((current) => {
      const suffix = new Date()
        .toISOString()
        .replace(/\D/g, "")
        .slice(8, 14);
      const name = `${preset.id}_${suffix}`
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_");
      const variables = buildTemplateVariablesFromPreset(
        preset.variableKeys,
      );
      const phoneNumberId =
        current.phoneNumberId ||
        selectedTemplatePhoneNumber?.id ||
        templatePhoneNumbers.find((phoneNumber) => phoneNumber.isDefault)?.id ||
        templatePhoneNumbers[0]?.id ||
        "";

      return {
        ...current,
        bodyText: preset.bodyText,
        buttonsText: preset.buttonsText,
        category: preset.category,
        displayName: preset.title,
        headerFileName: "",
        headerFormat: "NONE",
        headerHandle: "",
        headerMimeType: "",
        headerSendLink: "",
        name,
        phoneNumberId,
        variables,
      };
    });
    setTemplateFeedback(
      createIrisTemplateFeedback({
        action:
          "Revise assunto, fila e telefone de envio antes de consultar ou enviar para a Meta.",
        message: `${preset.title} aplicado no formulario.`,
        title: "Modelo carregado",
        tone: "success",
      }),
    );
  }

  function selectTemplateSubject(profileId: string) {
    if (profileId === "__current") {
      return;
    }

    const profile = subjectProfileOptions.find(
      (option) => option.id === profileId,
    );

    setTemplateFeedback("");
    setTemplateForm((current) => ({
      ...current,
      queueLabel: profile?.queueLabel ?? "",
      subjectLabel: profile?.name ?? "",
    }));
  }

  function loadTemplateIntoForm(template: IrisTemplate) {
    setSelectedTemplateId(template.id);
    setMetaStatus(readTemplateMetaStatus(template));
    setTemplateFeedback("");
    setTemplateForm((current) => {
      const loaded = irisTemplateToForm(template);

      return {
        ...loaded,
        phoneNumberId:
          loaded.phoneNumberId ||
          current.phoneNumberId ||
          templatePhoneNumbers.find((phoneNumber) => phoneNumber.isDefault)?.id ||
          templatePhoneNumbers[0]?.id ||
          "",
      };
    });
  }

  function addTemplateVariable(variable: (typeof IRIS_META_TEMPLATE_VARIABLES)[number]) {
    setTemplateFeedback("");
    setTemplateForm((current) => {
      const variables = mergeTemplateVariable(current.variables, variable);
      const bodyText = current.bodyText.includes(variable.placeholder)
        ? current.bodyText
        : `${current.bodyText.trim()} ${variable.placeholder}`.trim();

      return {
        ...current,
        bodyText,
        variables,
      };
    });
  }

  function updateTemplateHeaderFormat(format: string) {
    setTemplateFeedback("");
    setTemplateForm((current) => ({
      ...current,
      headerFileName: format === "NONE" ? "" : current.headerFileName,
      headerFormat: format,
      headerHandle: format === "NONE" ? "" : current.headerHandle,
      headerMimeType: format === "NONE" ? "" : current.headerMimeType,
      headerSendLink: format === "NONE" ? "" : current.headerSendLink,
    }));
  }

  function clearTemplateHeaderMedia() {
    setTemplateFeedback("");
    setTemplateForm((current) => ({
      ...current,
      headerFileName: "",
      headerHandle: "",
      headerMimeType: "",
    }));
    if (templateMediaInputRef.current) {
      templateMediaInputRef.current.value = "";
    }
  }

  async function handleTemplateMediaFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file || templateForm.headerFormat === "NONE") {
      return;
    }

    setUploadingTemplateMedia(true);
    setTemplateFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const formData = new FormData();
      formData.append("format", templateForm.headerFormat);
      formData.append("file", file);

      const response = await fetch("/api/iris/meta/templates/media", {
        body: formData,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        method: "POST",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setTemplateFeedback(
          createIrisTemplateFeedbackFromPayload(
            payload,
            "Nao foi possivel enviar a midia para a Meta.",
          ),
        );
        return;
      }

      setTemplateForm((current) => ({
        ...current,
        headerFileName: payload?.media?.fileName ?? file.name,
        headerFormat: payload?.media?.format ?? current.headerFormat,
        headerHandle: payload?.media?.handle ?? "",
        headerMimeType: payload?.media?.mimeType ?? file.type,
      }));
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action: "Agora envie o template para aprovacao da Meta.",
          message: "Midia de exemplo enviada para a Meta.",
          title: "Amostra recebida",
          tone: "success",
        }),
      );
    } catch (error) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          message:
            error instanceof Error
              ? error.message
              : "Nao foi possivel enviar a midia para a Meta.",
          title: "Falha no upload da midia",
          tone: "error",
        }),
      );
    } finally {
      setUploadingTemplateMedia(false);
      if (templateMediaInputRef.current) {
        templateMediaInputRef.current.value = "";
      }
    }
  }

  async function checkTemplateStatus(options?: { silent?: boolean }) {
    const silent = Boolean(options?.silent);

    if (!silent) {
      setCheckingTemplate(true);
      setTemplateFeedback("");
    }

    try {
      const accessToken = await getIrisAccessToken();
      const params = new URLSearchParams({
        bodyText: templateForm.bodyText,
        displayName: templateForm.displayName,
        language: templateForm.language,
        name: templateForm.name,
        queueLabel: templateForm.queueLabel,
        subjectLabel: templateForm.subjectLabel,
      });

      if (buttons.length) {
        params.set("buttons", buttons.join(","));
      }

      if (templateForm.phoneNumberId.trim()) {
        params.set("phoneNumberId", templateForm.phoneNumberId.trim());
      }

      const response = await fetch(
        `/api/iris/meta/templates?${params.toString()}`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        if (!silent) {
          setTemplateFeedback(
            createIrisTemplateFeedbackFromPayload(
              payload,
              "Nao foi possivel consultar o template na Meta.",
            ),
          );
        }
        return;
      }

      const templateSyncId = readIrisTemplateSyncNotificationId(
        payload?.localTemplateSync,
      );
      if (
        templateSyncId &&
        !templateSyncNotifiedRef.current.has(templateSyncId)
      ) {
        templateSyncNotifiedRef.current.add(templateSyncId);
        onTemplatesSynced();
      }

      const template = payload?.templates?.[0];
      const phoneNumbers = Array.isArray(payload?.phoneNumbers)
        ? payload.phoneNumbers
        : [];
      const selectedPhoneNumberId =
        payload?.selectedPhoneNumberId ??
        phoneNumbers.find((phoneNumber) => phoneNumber.isDefault)?.id ??
        phoneNumbers[0]?.id ??
        "";
      if (phoneNumbers.length) {
        setTemplatePhoneNumbers(phoneNumbers);
      }
      if (!templateForm.phoneNumberId.trim() && selectedPhoneNumberId) {
        setTemplateForm((current) =>
          current.phoneNumberId
            ? current
            : {
                ...current,
                phoneNumberId: selectedPhoneNumberId,
              },
        );
      }
      const status = template?.status ?? "NOT_FOUND";
      setMetaStatus(status);
      setLastTemplateRefreshAt(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      if (!silent) {
        if (payload?.error && !template) {
          setTemplateFeedback(
            createIrisTemplateFeedbackFromPayload(
              payload,
              "Nao foi possivel consultar o template na Meta.",
            ),
          );
          return;
        }

        const phoneMismatch =
          payload?.phoneNumberLink?.checkStatus === "checked" &&
          payload.phoneNumberLink.linked === false;
        setTemplateFeedback(
          phoneMismatch
            ? createIrisTemplateFeedback({
                action:
                  "Crie um novo template para o telefone selecionado ou selecione o telefone correto antes de consultar.",
                cause:
                  "Existe template com esse nome em outra WABA, mas ele nao pertence ao telefone de envio selecionado.",
                message:
                  "O template encontrado na Meta nao pertence ao telefone escolhido na Iris.",
                title: "Telefone divergente",
                tone: "error",
              })
            : createIrisTemplateFeedback({
                action: phoneNumberLinkFeedback(payload?.phoneNumberLink),
                cause: payload?.ignoredTemplateCount
                  ? "Existe template com esse nome em outra WABA, mas ele nao pertence ao telefone de envio selecionado."
                  : undefined,
                message: template
                  ? `Status Meta: ${templateStatusLabel(status)}.`
                  : "Template ainda nao encontrado na Meta para este nome e idioma.",
                title: template ? "Consulta concluida" : "Template nao localizado",
                tone: template ? "success" : "warning",
              }),
        );
      }
    } catch (error) {
      if (!silent) {
        setTemplateFeedback(
          createIrisTemplateFeedback({
            message:
              error instanceof Error
                ? error.message
                : "Nao foi possivel consultar o template na Meta.",
            title: "Falha ao consultar a Meta",
            tone: "error",
          }),
        );
      }
    } finally {
      if (!silent) {
        setCheckingTemplate(false);
      }
    }
  }

  async function syncApprovedMetaTemplates() {
    if (templateSubjectMissing) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action:
            "Escolha um assunto cadastrado para a Iris vincular fila e contexto antes de importar templates da Meta.",
          message: "Sincronizacao bloqueada por falta de assunto.",
          title: "Assunto obrigatorio",
          tone: "warning",
        }),
      );
      return;
    }

    if (templatePhoneMissing) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action:
            "Escolha o telefone de envio. A sincronizacao usa a WABA vinculada a esse telefone.",
          message: "Sincronizacao bloqueada por falta de telefone.",
          title: "Telefone obrigatorio",
          tone: "warning",
        }),
      );
      return;
    }

    setSyncingMetaTemplates(true);
    setTemplateFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const params = new URLSearchParams({
        language: templateForm.language,
        phoneNumberId: templateForm.phoneNumberId.trim(),
        queueLabel: templateForm.queueLabel,
        subjectLabel: templateForm.subjectLabel,
        syncApproved: "true",
      });

      const response = await fetch(
        `/api/iris/meta/templates?${params.toString()}`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | IrisMetaTemplatesResponse
        | null;

      if (!response.ok || payload?.error) {
        setTemplateFeedback(
          createIrisTemplateFeedbackFromPayload(
            payload,
            "Nao foi possivel sincronizar templates aprovados da Meta.",
          ),
        );
        return;
      }

      const phoneNumbers = Array.isArray(payload?.phoneNumbers)
        ? payload.phoneNumbers
        : [];
      if (phoneNumbers.length) {
        setTemplatePhoneNumbers(phoneNumbers);
      }

      const selectedPhoneNumberId =
        payload?.selectedPhoneNumberId ??
        phoneNumbers.find((phoneNumber) => phoneNumber.isDefault)?.id ??
        phoneNumbers[0]?.id ??
        "";
      if (!templateForm.phoneNumberId.trim() && selectedPhoneNumberId) {
        setTemplateForm((current) =>
          current.phoneNumberId
            ? current
            : {
                ...current,
                phoneNumberId: selectedPhoneNumberId,
              },
        );
      }

      const summary = payload?.localTemplateSyncSummary;
      const total = summary?.total ?? 0;
      const imported = summary?.imported ?? 0;
      const updated = summary?.updated ?? 0;
      const matched = summary?.matched ?? 0;
      const failed = summary?.failed ?? 0;

      setLastTemplateRefreshAt(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );

      if (total > 0 && failed === 0) {
        onTemplatesSynced();
        setTemplateFeedback(
          createIrisTemplateFeedback({
            action:
              "Abra o modal Novo atendimento novamente ou escolha o template na biblioteca atualizada.",
            cause:
              matched > 0
                ? "A Meta retornou templates ativos e a Iris reativou/atualizou o cache local."
                : undefined,
            message: `${total} template(s) aprovado(s) sincronizado(s): ${imported} importado(s), ${updated} atualizado(s).`,
            title: "Templates sincronizados",
            tone: "success",
          }),
        );
        return;
      }

      setTemplateFeedback(
        createIrisTemplateFeedback({
          action:
            "Confirme no Meta Manager se o template esta ativo para este telefone, idioma e WABA. Se estiver, consulte pelo nome Meta exato.",
          message:
            "Nenhum template aprovado foi retornado pela Meta para este telefone e idioma.",
          title: "Nada para sincronizar",
          tone: "warning",
        }),
      );
    } catch (error) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          message:
            error instanceof Error
              ? error.message
              : "Nao foi possivel sincronizar templates aprovados da Meta.",
          title: "Falha ao sincronizar Meta",
          tone: "error",
        }),
      );
    } finally {
      setSyncingMetaTemplates(false);
    }
  }

  async function createTemplate() {
    if (templateSubjectMissing) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action: "Selecione um assunto cadastrado na lista. A fila sera vinculada automaticamente pelo cadastro do assunto.",
          message: "Template sem assunto vinculado.",
          title: "Assunto obrigatorio",
          tone: "warning",
        }),
      );
      return;
    }

    if (templatePhoneMissing) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action: "Escolha o telefone que vai enviar esse template. A Iris criara e consultara a WABA vinculada a esse telefone.",
          message: "Template sem telefone de envio vinculado.",
          title: "Telefone de envio obrigatorio",
          tone: "warning",
        }),
      );
      return;
    }

    if (templateMediaMissing) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action: "Clique em Enviar exemplo na midia do header antes de enviar o template para aprovacao.",
          message: "Template com midia precisa de uma amostra aprovada pela Meta.",
          title: "Midia de exemplo pendente",
          tone: "warning",
        }),
      );
      return;
    }

    setCreatingTemplate(true);
    setTemplateFeedback(
      createIrisTemplateFeedback({
        action:
          "Aguarde o retorno da Meta. Se houver bloqueio, a Iris vai mostrar o motivo neste painel.",
        message: "Enviando o template para aprovacao da Meta.",
        title: "Envio em andamento",
        tone: "neutral",
      }),
    );

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/templates", {
        body: JSON.stringify({
          bodyText: templateForm.bodyText,
          buttons,
          category: templateForm.category,
          displayName: templateForm.displayName,
          headerFileName: templateForm.headerFileName,
          headerFormat: templateForm.headerFormat,
          headerHandle: templateForm.headerHandle,
          headerMimeType: templateForm.headerMimeType,
          headerSendLink: templateForm.headerSendLink,
          language: templateForm.language,
          name: templateForm.name,
          phoneNumberId: templateForm.phoneNumberId,
          queueLabel: templateForm.queueLabel,
          subjectLabel: templateForm.subjectLabel,
          variables: templateForm.variables,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setTemplateFeedback(
          createIrisTemplateFeedbackFromPayload(
            payload,
            "Nao foi possivel criar o template real na Meta.",
          ),
        );
        return;
      }

      const status = payload?.template?.status ?? null;
      if (Array.isArray(payload?.phoneNumbers)) {
        setTemplatePhoneNumbers(payload.phoneNumbers);
      }
      if (payload?.selectedPhoneNumberId) {
        updateTemplateForm("phoneNumberId", payload.selectedPhoneNumberId);
      }
      setMetaStatus(status);
      setLastTemplateRefreshAt(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action:
            status === "PENDING"
              ? "Aguarde a aprovacao ou mantenha a atualizacao automatica ligada para acompanhar."
              : undefined,
          message: payload?.created
            ? `Template enviado para a Meta como ${templateStatusLabel(status)}.`
            : `Template ja existia na Meta como ${templateStatusLabel(status)}.`,
          title: payload?.created ? "Template enviado" : "Template ja existe",
          tone: status === "REJECTED" ? "warning" : "success",
        }),
      );
    } catch (error) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          message:
            error instanceof Error
              ? error.message
              : "Nao foi possivel criar o template real na Meta.",
          title: "Falha ao enviar para a Meta",
          tone: "error",
        }),
      );
    } finally {
      setCreatingTemplate(false);
    }
  }

  async function removeTemplateFromLibrary(templateToRemove?: IrisTemplate | null) {
    const targetTemplate =
      templateToRemove ?? selectedLibraryTemplate ?? localTemplate;

    if (!targetTemplate) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action: "Selecione um template da biblioteca antes de excluir.",
          message: "Nenhum template selecionado para exclusao.",
          title: "Selecao obrigatoria",
          tone: "warning",
        }),
      );
      return;
    }

    const confirmed = window.confirm(
      `Excluir o template ${targetTemplate.name} da biblioteca Iris?`,
    );

    if (!confirmed) {
      return;
    }

    setRemovingTemplateId(targetTemplate.id);
    setTemplateFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/templates", {
        body: JSON.stringify({
          action: "archive_local",
          removeReason: "Removido manualmente no Setup da Iris.",
          templateId: targetTemplate.id,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            alreadyArchived?: boolean;
            error?: string;
            linkedTicket?: {
              id?: string | null;
              protocol?: string | null;
              status?: string | null;
            } | null;
          }
        | null;

      if (!response.ok) {
        const linkedProtocol =
          typeof payload?.linkedTicket?.protocol === "string"
            ? payload.linkedTicket.protocol
            : null;
        const message = linkedProtocol
          ? `${payload?.error ?? "Nao foi possivel remover o template."} Protocolo: ${linkedProtocol}.`
          : payload?.error ?? "Nao foi possivel remover o template.";

        setTemplateFeedback(
          createIrisTemplateFeedback({
            action:
              response.status === 409
                ? "Encerre o atendimento vinculado e tente novamente."
                : "Tente novamente em instantes.",
            message,
            title:
              response.status === 409
                ? "Template vinculado a ticket aberto"
                : "Falha ao remover template",
            tone: response.status === 409 ? "warning" : "error",
          }),
        );
        return;
      }

      onTemplatesSynced();

      if (selectedLibraryTemplate?.id === targetTemplate.id) {
        setSelectedTemplateId(null);
        startNewTemplate();
      }

      setTemplateFeedback(
        createIrisTemplateFeedback({
          action:
            "Esta acao arquiva apenas na Iris. O template permanece na Meta ate remocao oficial la.",
          message: payload?.alreadyArchived
            ? "Template ja estava arquivado na biblioteca Iris."
            : "Template removido da biblioteca Iris.",
          title: "Biblioteca atualizada",
          tone: "success",
        }),
      );
    } catch (error) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          message:
            error instanceof Error
              ? error.message
              : "Nao foi possivel remover o template da biblioteca.",
          title: "Falha ao remover template",
          tone: "error",
        }),
      );
    } finally {
      setRemovingTemplateId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <IrisTemplateMetricCard
          icon={MessageSquareText}
          label="Templates"
          value={formatCount(templateStats.total)}
        />
        <IrisTemplateMetricCard
          icon={CheckCircle2}
          label="Aprovados"
          tone="green"
          value={formatCount(templateStats.approved)}
        />
        <IrisTemplateMetricCard
          icon={Clock3}
          label="Pendentes"
          tone="gold"
          value={formatCount(templateStats.pending)}
        />
        <IrisTemplateMetricCard
          icon={CircleStop}
          label="Rejeitados"
          tone="red"
          value={formatCount(templateStats.rejected)}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)]">
        <section className="min-w-0 rounded-2xl border border-[#dbe3ef] bg-[#fbfcfe] p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-[#101820]">
                Biblioteca de templates
              </h4>
              <p className="mt-1 text-xs font-medium text-[#63708a]">
                Fila, assunto e status Meta em uma visao unica.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip
                content={
                  !selectedLibraryTemplate
                    ? "Selecione um template da lista para excluir"
                    : removingTemplateId
                      ? "Excluindo template..."
                      : "Excluir template da biblioteca Iris"
                }
                placement="bottom"
              >
                <button
                  type="button"
                  onClick={() => void removeTemplateFromLibrary()}
                  disabled={!selectedLibraryTemplate || Boolean(removingTemplateId)}
                  aria-label="Excluir template da biblioteca Iris"
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip content="Novo template" placement="bottom">
                <button
                  type="button"
                  onClick={startNewTemplate}
                  aria-label="Novo template"
                  className="inline-flex size-9 items-center justify-center rounded-lg bg-[#101820] text-white transition-colors hover:bg-[#1f2937]"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_190px]">
            <label className="relative block min-w-0">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A07C3B]"
                aria-hidden="true"
              />
              <input
                value={templateSearch}
                onChange={(event) => setTemplateSearch(event.target.value)}
                placeholder="Buscar template"
                className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white pl-9 pr-3 text-sm font-semibold text-[#34415a] outline-none"
              />
            </label>
            <select
              value={queueFilter}
              onChange={(event) => setQueueFilter(event.target.value)}
              className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
            >
              <option value="all">Todas as filas</option>
              {queueOptions.map((queue) => (
                <option key={queue} value={queue}>
                  {queue}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {IRIS_TEMPLATE_STATUS_FILTERS.map((filter) => {
              const selected = statusFilter === filter.id;

              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setStatusFilter(filter.id)}
                  className={[
                    "inline-flex h-8 items-center rounded-full px-3 text-xs font-semibold ring-1 transition-colors",
                    selected
                      ? "bg-[#101820] text-white ring-[#101820]"
                      : "bg-white text-[#63708a] ring-[#dbe3ef] hover:text-[#101820]",
                  ].join(" ")}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          <IrisTemplateFeedbackBox feedback={templateFeedback} />

          <div className="mt-3 max-h-[calc(100vh-360px)] space-y-2 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
            {filteredTemplates.length ? (
              filteredTemplates.map((template) => {
                const status = readTemplateMetaStatus(template);
                const headerFormat = readTemplateHeaderFormat(template);
                const phoneLabel = readTemplatePhoneLabel(template);
                const selected = selectedLibraryTemplate?.id === template.id;

                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => loadTemplateIntoForm(template)}
                    className={[
                      "w-full rounded-xl border bg-white p-3 text-left transition-colors",
                      selected
                        ? "border-[#A07C3B] shadow-sm"
                        : "border-[#e4eaf3] hover:border-[#A07C3B]/40",
                    ].join(" ")}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="max-w-full truncate text-sm font-semibold text-[#101820]">
                            {template.name}
                          </p>
                          <span className="shrink-0 rounded-full bg-[#f4f6fa] px-2 py-0.5 text-[10px] font-semibold text-[#63708a]">
                            {readTemplateQueueLabel(template)}
                          </span>
                          {headerFormat ? (
                            <span className="shrink-0 rounded-full bg-[#eef6ff] px-2 py-0.5 text-[10px] font-semibold text-[#1769aa]">
                              {templateHeaderFormatLabel(headerFormat)}
                            </span>
                          ) : null}
                          {phoneLabel ? (
                            <span className="max-w-[220px] shrink-0 truncate rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                              {phoneLabel}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-xs font-semibold text-[#63708a]">
                          {readTemplateSubjectLabel(template)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${templateStatusTone(status)}`}
                      >
                        {templateStatusLabel(status)}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-xs text-[#63708a]">
                      {template.body ?? readTemplateMetaName(template) ?? template.slug}
                    </p>
                  </button>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-[#dbe3ef] bg-white px-4 py-10 text-center">
                <p className="text-sm font-semibold text-[#101820]">
                  Nenhum template neste filtro.
                </p>
                <p className="mt-1 text-xs text-[#63708a]">
                  Ajuste fila, status ou busca para visualizar outros registros.
                </p>
              </div>
            )}
          </div>
        </section>

        <aside className="min-w-0 space-y-3">
          <div className="rounded-2xl border border-[#dbe3ef] bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                  Biblioteca base
                </p>
                <h4 className="mt-1 text-sm font-semibold text-[#101820]">
                  Modelos Meta para partir
                </h4>
                <p className="mt-1 text-xs font-medium text-[#63708a]">
                  Selecione um modelo para preencher o formulario e acelerar a criacao.
                </p>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {IRIS_META_TEMPLATE_LIBRARY_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyTemplateLibraryPreset(preset)}
                  className="w-full rounded-xl border border-[#e4eaf3] bg-[#fbfcfe] p-3 text-left transition-colors hover:border-[#A07C3B]/35 hover:bg-[#fff8ec]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[#101820]">
                      {preset.title}
                    </p>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                      {preset.category}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] font-medium leading-5 text-[#63708a]">
                    {preset.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#dbe3ef] bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                  Criacao
                </p>
                <h4 className="mt-1 text-sm font-semibold text-[#101820]">
                  Template Meta
                </h4>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${templateStatusTone(displayedStatus)}`}
                >
                  {templateStatusLabel(displayedStatus)}
                </span>
                <button
                  type="button"
                  onClick={() => checkTemplateStatus()}
                  disabled={checkingTemplate}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dbe3ef] bg-white px-3 text-xs font-semibold text-[#34415a] transition-colors hover:border-[#A07C3B]/30 disabled:cursor-not-allowed disabled:bg-slate-100"
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  {checkingTemplate ? "Consultando" : "Consultar"}
                </button>
                <button
                  type="button"
                  onClick={syncApprovedMetaTemplates}
                  disabled={syncingMetaTemplates}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#A07C3B]/25 bg-[#fff8ec] px-3 text-xs font-semibold text-[#7A5E2C] transition-colors hover:border-[#A07C3B]/45 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${syncingMetaTemplates ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  {syncingMetaTemplates ? "Sincronizando" : "Sincronizar Meta"}
                </button>
                <button
                  type="button"
                  onClick={createTemplate}
                  disabled={
                    creatingTemplate ||
                    templateSubjectMissing ||
                    templatePhoneMissing ||
                    templateMediaMissing ||
                    uploadingTemplateMedia
                  }
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {creatingTemplate ? "Enviando" : "Enviar para Meta"}
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
              <SetupField label="Assunto">
                <select
                  value={selectedSubjectProfileId}
                  onChange={(event) => selectTemplateSubject(event.target.value)}
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                >
                  <option value="">Escolha um assunto</option>
                  {selectedSubjectProfileId === "__current" ? (
                    <option value="__current">
                      {templateForm.subjectLabel} |{" "}
                      {templateForm.queueLabel || "Fila nao localizada"}
                    </option>
                  ) : null}
                  {subjectProfileOptions.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} | {profile.queueLabel}
                    </option>
                  ))}
                </select>
              </SetupField>
              <SetupField label="Fila vinculada">
                <div className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-[#dbe3ef] bg-[#fbfcfe] px-3 text-sm font-semibold text-[#34415a]">
                  <Route className="h-4 w-4 shrink-0 text-[#A07C3B]" aria-hidden="true" />
                  <span className="truncate">
                    {templateForm.queueLabel || "Definida pelo assunto"}
                  </span>
                </div>
              </SetupField>
            </div>

            <div className="mt-3">
              <SetupField label="Telefone de envio">
                <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(180px,0.45fr)]">
                  <div className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-[#dbe3ef] bg-white px-3">
                    <Smartphone className="h-4 w-4 shrink-0 text-[#A07C3B]" aria-hidden="true" />
                    <select
                      value={templateForm.phoneNumberId}
                      onChange={(event) => {
                        setMetaStatus(null);
                        setLastTemplateRefreshAt("");
                        updateTemplateForm("phoneNumberId", event.target.value);
                      }}
                      className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#34415a] outline-none"
                    >
                      <option value="">Selecione o telefone</option>
                      {templatePhoneNumbers.map((phoneNumber) => (
                        <option key={phoneNumber.id} value={phoneNumber.id}>
                          {formatMetaPhoneNumberOption(phoneNumber)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex h-10 min-w-0 items-center rounded-lg border border-[#dbe3ef] bg-[#fbfcfe] px-3 text-xs font-semibold text-[#63708a]">
                    <span className="truncate">
                      {selectedTemplatePhoneNumber?.displayPhoneNumber
                        ? selectedTemplatePhoneNumber.isDefault
                          ? "Telefone padrao da Iris"
                          : "Telefone selecionado"
                        : "Define a WABA do template"}
                    </span>
                  </div>
                </div>
                <p className="mt-1 truncate text-xs font-medium text-[#63708a]">
                  {selectedTemplatePhoneNumber?.displayPhoneNumber
                    ? `${formatMetaPhoneNumberOption(selectedTemplatePhoneNumber)} sera usado para consultar, criar e enviar este template.`
                    : templateForm.phoneNumberId
                      ? "A Meta nao retornou o numero exibivel. A Iris usara o ID do telefone selecionado e validara a WABA no servidor."
                      : "A Meta aprova templates por WABA; a Iris resolve a WABA a partir do telefone escolhido."}
                </p>
              </SetupField>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SetupField label="Nome interno">
                <input
                  value={templateForm.displayName}
                  onChange={(event) =>
                    updateTemplateForm("displayName", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                />
              </SetupField>
              <SetupField label="Nome Meta">
                <input
                  value={templateForm.name}
                  onChange={(event) =>
                    updateTemplateForm(
                      "name",
                      event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "_"),
                    )
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                />
              </SetupField>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_130px]">
              <SetupField label="Categoria Meta">
                <select
                  value={templateForm.category}
                  onChange={(event) =>
                    updateTemplateForm("category", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                >
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITY">Utility</option>
                  <option value="AUTHENTICATION">Authentication</option>
                </select>
              </SetupField>
              <SetupField label="Idioma">
                <input
                  value={templateForm.language}
                  onChange={(event) =>
                    updateTemplateForm("language", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                />
              </SetupField>
            </div>

            <div className="mt-3 rounded-xl border border-[#e4eaf3] bg-[#fbfcfe] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h5 className="text-sm font-semibold text-[#101820]">
                    Midia do header
                  </h5>
                  <p className="mt-1 text-xs font-medium text-[#63708a]">
                    Use imagem ou video quando a primeira mensagem precisar de contexto visual aprovado pela Meta.
                  </p>
                </div>
                {templateForm.headerHandle ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                    Exemplo enviado
                  </span>
                ) : null}
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                {IRIS_TEMPLATE_HEADER_OPTIONS.map((option) => {
                  const selected = templateForm.headerFormat === option.id;
                  const HeaderIcon =
                    option.id === "IMAGE"
                      ? ImageIcon
                      : option.id === "VIDEO"
                        ? Video
                        : option.id === "DOCUMENT"
                          ? FileText
                          : MessageSquareText;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => updateTemplateHeaderFormat(option.id)}
                      className={[
                        "min-w-0 rounded-lg border px-3 py-2 text-left transition-colors",
                        selected
                          ? "border-[#A07C3B] bg-[#fff8ec] text-[#101820]"
                          : "border-[#dbe3ef] bg-white text-[#63708a] hover:border-[#A07C3B]/40 hover:text-[#101820]",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-2">
                        <HeaderIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate text-xs font-semibold">
                          {option.label}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[11px] font-medium">
                        {option.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              {templateForm.headerFormat !== "NONE" ? (
                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <div className="rounded-lg border border-[#dbe3ef] bg-white p-3">
                    <input
                      ref={templateMediaInputRef}
                      type="file"
                      accept={selectedHeaderOption.accept}
                      onChange={handleTemplateMediaFileChange}
                      className="hidden"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[#101820]">
                          {templateForm.headerFileName || "Exemplo para aprovacao"}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-[#63708a]">
                          A Meta usa este arquivo como amostra do template.
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {templateForm.headerHandle ? (
                          <button
                            type="button"
                            onClick={clearTemplateHeaderMedia}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#dbe3ef] bg-white text-[#63708a] hover:border-rose-200 hover:text-rose-600"
                            aria-label="Remover midia"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => templateMediaInputRef.current?.click()}
                          disabled={uploadingTemplateMedia}
                          className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-[#101820] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          <Upload className="h-4 w-4" aria-hidden="true" />
                          {uploadingTemplateMedia ? "Enviando" : "Enviar exemplo"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <SetupField label="URL publica para envio">
                    <input
                      value={templateForm.headerSendLink}
                      onChange={(event) =>
                        updateTemplateForm("headerSendLink", event.target.value)
                      }
                      placeholder="https://..."
                      className="h-12 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    />
                  </SetupField>
                </div>
              ) : null}
            </div>

            <div className="mt-3">
              <SetupField label="Botoes quick reply">
                <input
                  value={templateForm.buttonsText}
                  onChange={(event) =>
                    updateTemplateForm("buttonsText", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                />
              </SetupField>
            </div>

            <div className="mt-3">
              <SetupField label="Mensagem">
                <textarea
                  value={templateForm.bodyText}
                  onChange={(event) =>
                    updateTemplateForm("bodyText", event.target.value)
                  }
                  className="min-h-28 w-full resize-none rounded-lg border border-[#dbe3ef] bg-white px-3 py-2 text-sm font-medium leading-6 text-[#34415a] outline-none"
                />
              </SetupField>
            </div>

            <div className="mt-3 rounded-xl border border-[#e4eaf3] bg-[#fbfcfe] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h5 className="text-sm font-semibold text-[#101820]">
                  Variaveis
                </h5>
                <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                  Meta {`{{1}}`}, {`{{2}}`}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {IRIS_META_TEMPLATE_VARIABLES.map((variable) => (
                  <button
                    key={variable.key}
                    type="button"
                    onClick={() => addTemplateVariable(variable)}
                    className="min-w-0 rounded-lg border border-[#dbe3ef] bg-white p-2 text-left transition-colors hover:border-[#A07C3B]/35 hover:bg-[#fbf6ec]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-[#101820]">
                        {variable.label}
                      </span>
                      <span className="shrink-0 rounded-full bg-[#f4f6fa] px-1.5 py-0.5 text-[10px] font-semibold text-[#63708a]">
                        {variable.readiness}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-[#A07C3B]">
                      {variable.placeholder}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#e7dfd3] bg-[#f8f4ec] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                Preview
              </p>
              <span className="truncate text-xs font-semibold text-[#63708a]">
                {templateForm.queueLabel} / {templateForm.subjectLabel}
              </span>
            </div>
            {templateForm.headerFormat !== "NONE" ? (
              <div className="mt-3 flex min-h-24 items-center justify-center rounded-xl border border-dashed border-[#d8c7a7] bg-white px-4 py-3 text-center">
                <div>
                  <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-[#fbf6ec] text-[#A07C3B]">
                    {templateForm.headerFormat === "IMAGE" ? (
                      <ImageIcon className="h-5 w-5" aria-hidden="true" />
                    ) : templateForm.headerFormat === "VIDEO" ? (
                      <Video className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <FileText className="h-5 w-5" aria-hidden="true" />
                    )}
                  </div>
                  <p className="text-xs font-semibold text-[#101820]">
                    Header {selectedHeaderOption.label}
                  </p>
                  <p className="mt-1 max-w-xs truncate text-[11px] font-medium text-[#63708a]">
                    {templateForm.headerFileName || "Midia de exemplo pendente"}
                  </p>
                </div>
              </div>
            ) : null}
            <p className="mt-2 break-words text-sm font-medium leading-6 text-[#101820]">
              {preview}
            </p>
            {buttons.length ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {buttons.map((button) => (
                  <span
                    key={button}
                    className="inline-flex h-9 min-w-0 items-center justify-center rounded-lg border border-emerald-100 bg-white px-2 text-sm font-semibold text-emerald-700"
                  >
                    <span className="truncate">{button}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-[#dbe3ef] bg-[#fbfcfe] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                  Status Meta
                </p>
                <h4 className="mt-1 truncate text-sm font-semibold text-[#101820]">
                  {templateForm.displayName}
                </h4>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${templateStatusTone(displayedStatus)}`}
              >
                {templateStatusLabel(displayedStatus)}
              </span>
            </div>

            <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#dbe3ef] bg-white px-3 py-2 text-xs font-semibold text-[#63708a]">
              <span>Atualizar aprovacao automaticamente</span>
              <input
                type="checkbox"
                checked={autoRefreshStatus}
                onChange={(event) => setAutoRefreshStatus(event.target.checked)}
                className="h-4 w-4 accent-[#A07C3B]"
              />
            </label>

            {lastTemplateRefreshAt ? (
              <p className="mt-2 text-xs font-medium text-[#63708a]">
                Ultima consulta: {lastTemplateRefreshAt}
              </p>
            ) : null}
            {selectedTemplatePhoneNumber ? (
              <p className="mt-1 truncate text-xs font-semibold text-[#34415a]">
                Telefone: {formatMetaPhoneNumberOption(selectedTemplatePhoneNumber)}
              </p>
            ) : null}

            <IrisTemplateFeedbackBox feedback={templateFeedback} />

            <div className="mt-3 grid gap-2">
              {templateSubjectMissing ? (
                <p className="rounded-lg border border-[#f2dfbf] bg-[#fffbeb] px-3 py-2 text-xs font-semibold text-[#7A5E2C]">
                  Escolha o assunto antes de enviar. A fila sera preenchida pelo cadastro do assunto.
                </p>
              ) : null}
              {templatePhoneMissing ? (
                <p className="rounded-lg border border-[#f2dfbf] bg-[#fffbeb] px-3 py-2 text-xs font-semibold text-[#7A5E2C]">
                  Escolha o telefone de envio. A Iris cria e consulta o template na WABA desse telefone.
                </p>
              ) : null}
              {templatePhoneDisplayMissing ? (
                <p className="rounded-lg border border-[#f2dfbf] bg-[#fffbeb] px-3 py-2 text-xs font-semibold text-[#7A5E2C]">
                  A Meta nao retornou o numero exibivel do telefone selecionado. A criacao segue pelo ID do telefone e pela WABA validada no servidor.
                </p>
              ) : null}
              {templateMediaMissing ? (
                <p className="rounded-lg border border-[#f2dfbf] bg-[#fffbeb] px-3 py-2 text-xs font-semibold text-[#7A5E2C]">
                  Template com midia precisa de uma amostra enviada para aprovacao da Meta.
                </p>
              ) : null}
              {templateForm.headerFormat !== "NONE" &&
              templateForm.headerHandle &&
              !templateForm.headerSendLink.trim() ? (
                <p className="rounded-lg border border-[#dbe3ef] bg-white px-3 py-2 text-xs font-semibold text-[#63708a]">
                  Cadastre uma URL publica para a Iris enviar esta midia no atendimento ativo.
                </p>
              ) : null}
            </div>

          </div>
        </aside>
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
          : "border-[#dbe3ef] bg-white text-[#34415a]";
  const metaLine = [
    normalized.metaCode ? `Codigo Meta: ${normalized.metaCode}` : null,
    normalized.providerMessage
      ? `Retorno Meta: ${normalized.providerMessage}`
      : null,
    normalized.metaDetail ? `Detalhe Meta: ${normalized.metaDetail}` : null,
  ].filter((line): line is string => Boolean(line));
  const Icon =
    tone === "error"
      ? ShieldAlert
      : tone === "success"
        ? CheckCircle2
        : Clock3;

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
            <div className="mt-2 space-y-1 rounded-md bg-white/65 px-2 py-1.5 text-[11px] font-semibold leading-4 opacity-90">
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
  const message = typeof record.message === "string" ? record.message.trim() : "";

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

function IrisTemplateMetricCard({
  icon: Icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: typeof MessageSquareText;
  label: string;
  tone?: IrisTone;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[#dbe3ef] bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`grid h-9 w-9 place-items-center rounded-xl ${toneBg(tone)}`}
        >
          <Icon className={`h-4 w-4 ${toneText(tone)}`} aria-hidden="true" />
        </span>
        <span className="text-lg font-semibold text-[#101820]">{value}</span>
      </div>
      <p className="mt-3 truncate text-xs font-semibold uppercase tracking-normal text-[#8a96aa]">
        {label}
      </p>
    </div>
  );
}

function ReportsView({
  data,
  snapshot,
}: {
  data: IrisData;
  snapshot: ReturnType<typeof buildIrisSnapshot>;
}) {
  const priorityRows = [
    [
      "Critica",
      data.tickets.filter((ticket) => ticket.priority === "critical").length,
      snapshot.total,
    ],
    [
      "Alta",
      data.tickets.filter((ticket) => ticket.priority === "high").length,
      snapshot.total,
    ],
    [
      "Media",
      data.tickets.filter((ticket) => ticket.priority === "medium").length,
      snapshot.total,
    ],
    [
      "Baixa",
      data.tickets.filter((ticket) => ticket.priority === "low").length,
      snapshot.total,
    ],
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4">
      <section className="rounded-2xl border border-[#dbe3ef] bg-white p-4">
        <h3 className="mb-4 text-base font-semibold">
          Performance operacional
        </h3>
        <div className="grid grid-cols-4 gap-3">
          <SignalCard
            icon={TicketCheck}
            title="Tickets"
            value={formatCount(snapshot.total)}
          />
          <SignalCard
            icon={ShieldAlert}
            title="Criticos"
            value={formatCount(snapshot.critical)}
            tone="red"
          />
          <SignalCard
            icon={MessageCircle}
            title="Sem resposta"
            value={formatCount(snapshot.unanswered)}
            tone="gold"
          />
          <SignalCard
            icon={Sparkles}
            title="Acoes IA"
            value={formatCount(snapshot.aiActions)}
            tone="blue"
          />
        </div>
        <div className="mt-5 space-y-3">
          {priorityRows.map(([label, value, total]) => (
            <ProgressLine
              key={label}
              label={label}
              value={value}
              total={total}
            />
          ))}
        </div>
      </section>

      <aside className="space-y-3">
        <BuilderCard
          icon={Activity}
          title="Resumo"
          rows={[
            ["Fila", formatCount(snapshot.total)],
            ["SLA critico", formatCount(snapshot.slaCritical)],
            ["Cliente foco", snapshot.topTicket?.contactLabel ?? "-"],
            ["Proxima janela", "Hoje"],
          ]}
        />
        <BuilderCard
          icon={CalendarClock}
          title="Agenda"
          rows={[
            ["Retornos", formatCount(snapshot.followUpsToday)],
            ["Sem resposta", formatCount(snapshot.unanswered)],
            ["Escalados", formatCount(snapshot.waitingOperator)],
            ["Proxima janela", "Hoje"],
          ]}
        />
      </aside>
    </div>
  );
}

function IrisNavButton({
  active,
  collapsed,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  collapsed: boolean;
  icon: typeof LayoutDashboard;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip
      className="w-full"
      content={label}
      placement={collapsed ? "right" : "top"}
      triggerClassName="w-full"
    >
      <button
        type="button"
        onClick={onClick}
        className={[
          "group relative flex h-11 w-full items-center rounded-lg text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#d0ad69]",
          collapsed ? "justify-center px-0" : "gap-3 px-3",
          active
            ? "bg-[#2A2B32] text-[#ECECF1]"
            : "text-[#C5C5D2] hover:bg-[#2A2B32]/80 hover:text-[#ECECF1]",
        ].join(" ")}
      >
        {active ? (
          <span className="absolute left-0 top-2 h-7 w-0.5 rounded-full bg-[#A07C3B]" />
        ) : null}
        <span
          className={[
            "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
            active ? "panteon-module-sidebar__active-icon" : "text-[#8E8EA0]",
          ].join(" ")}
        >
          <Icon className="h-[17px] w-[17px]" aria-hidden="true" />
        </span>
        {!collapsed ? <span>{label}</span> : null}
        {active && !collapsed ? (
          <ChevronRight className="ml-auto h-4 w-4 text-[#8E8EA0]" />
        ) : null}
      </button>
    </Tooltip>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.06] p-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-white/45">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function HeaderMetric({
  icon: Icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: typeof Wifi;
  label: string;
  tone?: IrisTone;
  value: string;
}) {
  return (
    <div className="flex h-10 min-w-[118px] items-center gap-2 rounded-xl border border-[#dbe3ef] bg-white px-3">
      <span
        className={[
          "flex h-7 w-7 items-center justify-center rounded-lg",
          toneBg(tone),
        ].join(" ")}
      >
        <Icon className={["h-4 w-4", toneText(tone)].join(" ")} />
      </span>
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#8a96aa]">
          {label}
        </p>
        <p className="text-sm font-semibold text-[#101820]">{value}</p>
      </div>
    </div>
  );
}

function SignalCard({
  icon: Icon,
  title,
  tone = "neutral",
  value,
}: {
  icon: typeof Inbox;
  title: string;
  tone?: IrisTone;
  value: string;
}) {
  return (
    <div className="flex h-full min-h-[88px] flex-col rounded-2xl border border-[#dbe3ef] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span
          className={[
            "flex h-10 w-10 items-center justify-center rounded-xl",
            toneBg(tone),
          ].join(" ")}
        >
          <Icon className={["h-5 w-5", toneText(tone)].join(" ")} />
        </span>
        <span className="rounded-full bg-[#f4f6fa] px-2 py-1 text-[11px] font-semibold text-[#63708a]">
          {value}
        </span>
      </div>
      <h3 className="mt-auto pt-3 text-sm font-semibold">{title}</h3>
    </div>
  );
}

function IconOnlySignalCard({
  icon: Icon,
  label,
  tone = "neutral",
  tooltip,
}: {
  icon: typeof Inbox;
  label: string;
  tone?: IrisTone;
  tooltip: string;
}) {
  return (
    <Tooltip
      className="h-full w-full"
      content={tooltip}
      placement="top"
      triggerClassName="h-full w-full"
    >
      <div className="flex min-h-[84px] items-center justify-center rounded-2xl border border-[#dbe3ef] bg-white p-4 shadow-sm">
        <span
          className={[
            "flex h-11 w-11 items-center justify-center rounded-xl",
            toneBg(tone),
          ].join(" ")}
        >
          <Icon className={["h-5 w-5", toneText(tone)].join(" ")} />
        </span>
        <span className="sr-only">{label}</span>
      </div>
    </Tooltip>
  );
}

function ActionPanel({
  icon: Icon,
  items,
  title,
}: {
  icon: typeof Sparkles;
  items: Array<{ detail: string; title: string; value: string }>;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-[#dbe3ef] bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fbf6ec] text-[#A07C3B]">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.title}
            className="rounded-xl border border-[#e4eaf3] bg-[#fbfcfe] p-3"
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8a96aa]">
              {item.title}
            </p>
            <p className="mt-1 text-sm font-semibold">{item.value}</p>
            <p className="mt-1 line-clamp-2 text-xs text-[#63708a]">
              {item.detail}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function BuilderCard({
  icon: Icon,
  rows,
  title,
}: {
  icon: typeof SlidersHorizontal;
  rows: Array<[string, string]>;
  title: string;
}) {
  return (
    <div className="rounded-2xl border border-[#dbe3ef] bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fbf6ec] text-[#A07C3B]">
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="divide-y divide-[#edf1f6]">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 py-2 text-sm"
          >
            <span className="text-[#63708a]">{label}</span>
            <span className="text-right font-semibold">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SetupSection({
  icon: Icon,
  items,
  title,
}: {
  icon: typeof Workflow;
  items: Array<[string, string]>;
  title: string;
}) {
  return (
    <section className="rounded-2xl border border-[#dbe3ef] bg-white p-4">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fbf6ec] text-[#A07C3B]">
          <Icon className="h-5 w-5" />
        </span>
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      <div className="space-y-2">
        {items.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 rounded-xl border border-[#e4eaf3] bg-[#fbfcfe] px-3 py-3"
          >
            <span className="text-sm font-semibold">{label}</span>
            <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-[#63708a]">
              {value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SetupField({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a96aa]">
        {label}
      </span>
      {children}
    </label>
  );
}

function ProgressLine({
  label,
  total,
  value,
}: {
  label: string;
  total: number;
  value: number;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-[#63708a]">
          {formatCount(value)} | {pct}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#edf1f6]">
        <div
          className="h-full rounded-full bg-[#A07C3B]"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  shortLabel,
  tone = "neutral",
  value,
}: {
  icon: typeof TicketCheck;
  label: string;
  shortLabel: string;
  tone?: "danger" | "gold" | "neutral";
  value: string;
}) {
  const toneClass =
    tone === "danger"
      ? "bg-rose-50 text-rose-700 ring-rose-100"
      : tone === "gold"
        ? "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15"
        : "bg-slate-50 text-slate-700 ring-slate-200";

  return (
    <Tooltip
      className="w-full"
      content={`${label}: ${value}`}
      placement="top"
      triggerClassName="w-full"
    >
      <div className="group flex min-h-14 items-center gap-2 rounded-lg border border-slate-200/70 bg-slate-50/55 px-3 py-2 transition-colors hover:border-[#A07C3B]/20 hover:bg-white">
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 transition-transform group-hover:scale-105 ${toneClass}`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold leading-5 text-slate-950">
            {value}
          </p>
          <p className="truncate text-[11px] font-semibold uppercase tracking-normal text-slate-400">
            {shortLabel}
          </p>
        </div>
      </div>
    </Tooltip>
  );
}

function InsightCard({
  description,
  title,
  value,
}: {
  description: string;
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
        {title}
      </p>
      <p className="mt-1 text-base font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function FilterSelect({
  label,
  onChange,
  optionLabels,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  optionLabels?: Record<string, string>;
  options: string[];
  value: string;
}) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-500">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 w-full bg-transparent text-xs font-semibold text-slate-700 outline-none"
        aria-label={label}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabels?.[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
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
    <div className="fixed right-5 top-20 z-[90] w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-[#eadcc2] bg-white p-3 shadow-[0_18px_45px_rgba(15,23,42,0.18)]">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
          <MessageCircle className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
            Nova mensagem WhatsApp
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-950">
            {notice.title}
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
            {notice.body}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-400">
              {formatDateTime(notice.receivedAt)}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onDismiss}
                className="h-7 rounded-md px-2 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-50"
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

  if (imageUrl) {
    return (
      <img
        alt={label}
        className={`${sizeClass} shrink-0 rounded-full border border-slate-200 object-cover shadow-[0_1px_2px_rgba(15,23,42,0.08)]`}
        src={imageUrl}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className={`${sizeClass} ${textClass} flex shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 font-semibold uppercase text-emerald-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)]`}
    >
      {contactInitials(label)}
    </span>
  );
}

function MessageBubble({
  message,
  onEdit,
  onReact,
  onReply,
  ticket,
}: {
  message: IrisMessage;
  onEdit: (message: IrisMessage) => void;
  onReact: (message: IrisMessage, emoji: string) => void;
  onReply: (message: IrisMessage) => void;
  ticket: IrisTicket;
}) {
  const outbound = message.direction === "outbound";
  const internal =
    message.direction === "internal" || message.senderType === "system";
  const canEdit = outbound && message.senderType === "operator";
  const avatarLabel = outbound
    ? message.senderLabel ?? "Operador Iris"
    : ticketContactLabel(ticket);
  const avatarUrl = outbound ? message.operatorAvatarUrl : ticket.contactAvatarUrl;

  if (internal) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[70%] rounded-full border border-slate-200/70 bg-white px-3 py-1.5 text-center text-xs font-semibold text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)] [overflow-wrap:anywhere]">
          {message.body}
        </div>
      </div>
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
            onEdit={onEdit}
            onReact={onReact}
            onReply={onReply}
            outbound={outbound}
          />
          <div
            className={[
              "min-w-[128px] max-w-full rounded-2xl px-4 py-3 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.05)] [overflow-wrap:anywhere]",
              outbound
                ? "border border-[#eadcc2] bg-[#f8f4ed] text-slate-900"
                : "border border-slate-200 bg-white text-slate-800",
            ].join(" ")}
          >
            {outbound && message.senderLabel ? (
              <div className="mb-1.5 flex items-center justify-end gap-1.5">
                <span className="rounded-full border border-[#eadcc2] bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-[#7A5E2C]">
                  {message.senderLabel}
                </span>
              </div>
            ) : null}
            {message.replyTo ? (
              <MessageReplyPreview reply={message.replyTo} outbound={outbound} />
            ) : null}
            {message.messageType === "audio" ? (
              <AudioMessageContent message={message} outbound={outbound} />
            ) : (
              <p className="whitespace-pre-wrap leading-6 [overflow-wrap:anywhere]">
                {message.body}
              </p>
            )}
            <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-slate-400">
              {message.editedAt ? <span>editada</span> : null}
              <span>{formatDateTime(message.createdAt)}</span>
              {outbound ? <MessageDeliveryIndicator message={message} /> : null}
            </div>
          </div>
          {message.reactions?.length ? (
            <MessageReactionStrip reactions={message.reactions} outbound={outbound} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MessageBubbleActions({
  canEdit,
  message,
  onEdit,
  onReact,
  onReply,
  outbound,
}: {
  canEdit: boolean;
  message: IrisMessage;
  onEdit: (message: IrisMessage) => void;
  onReact: (message: IrisMessage, emoji: string) => void;
  onReply: (message: IrisMessage) => void;
  outbound: boolean;
}) {
  return (
    <div
      className={[
        "absolute -top-3 z-10 flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1 py-0.5 opacity-0 shadow-[0_8px_22px_rgba(15,23,42,0.12)] transition-opacity focus-within:opacity-100 group-hover:opacity-100",
        outbound ? "right-2" : "left-2",
      ].join(" ")}
    >
      {IRIS_REACTION_OPTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onReact(message, emoji)}
          className="flex size-7 items-center justify-center rounded-full text-sm transition-colors hover:bg-slate-100"
          aria-label={`Reagir com ${emoji}`}
        >
          {emoji}
        </button>
      ))}
      <span className="h-5 w-px bg-slate-200" aria-hidden="true" />
      <Tooltip content="Responder" placement="top">
        <button
          type="button"
          onClick={() => onReply(message)}
          className="flex size-7 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#7A5E2C]"
          aria-label="Responder mensagem"
        >
          <Reply className="size-3.5" aria-hidden="true" />
        </button>
      </Tooltip>
      {canEdit ? (
        <Tooltip content="Editar no Iris" placement="top">
          <button
            type="button"
            onClick={() => onEdit(message)}
            className="flex size-7 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-[#7A5E2C]"
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
          ? "border-[#A07C3B] bg-white/70 text-slate-600"
          : "border-emerald-400 bg-emerald-50/70 text-slate-600",
      ].join(" ")}
    >
      <div className="flex items-center gap-1.5 font-semibold text-slate-700">
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
        "absolute -bottom-3 flex rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-sm shadow-[0_6px_16px_rgba(15,23,42,0.12)]",
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
          outbound ? "bg-[#A07C3B] text-white" : "bg-emerald-50 text-emerald-700",
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
            <div className="h-2 rounded-full bg-slate-200">
              <div className="h-2 w-1/3 rounded-full bg-[#A07C3B]" />
            </div>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              Audio WhatsApp
            </p>
          </>
        )}
      </div>
      <span className="shrink-0 text-xs font-semibold text-slate-500">
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
  tone: "gold" | "green";
}) {
  const [failed, setFailed] = useState(false);
  const imageUrl = avatarUrl && !failed ? avatarUrl : null;

  if (imageUrl) {
    return (
      <img
        alt={label}
        className="size-8 shrink-0 rounded-full border border-slate-200 object-cover shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
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
          ? "border-[#eadcc2] bg-[#fbf6ec] text-[#7A5E2C]"
          : "border-emerald-100 bg-emerald-50 text-emerald-700",
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
  const colorClass =
    pendingMetaSend
      ? "text-amber-500"
      : normalized === "read"
      ? "text-sky-500"
      : normalized === "failed"
        ? "text-rose-500"
        : "text-slate-400";
  const tooltip = pendingMetaSend
    ? "Aguardando envio pela Meta"
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
    <div className="rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-950 [overflow-wrap:anywhere]">
        {value}
      </p>
    </div>
  );
}

function EmptyState({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: typeof Inbox;
  title: string;
}) {
  return (
    <div className="flex min-h-48 items-center justify-center p-8 text-center">
      <div>
        <Icon className="mx-auto h-8 w-8 text-[#A07C3B]" />
        <h3 className="mt-3 text-base font-semibold text-slate-950">{title}</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
          {description}
        </p>
      </div>
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
            ? "border-slate-200 bg-slate-50 text-slate-600"
            : "border-[#eadcc2] bg-[#fbf6ec] text-[#8a682f]";

  return (
    <span
      className={`inline-flex w-fit rounded-full border px-2 py-1 text-xs font-semibold ${classes}`}
    >
      {label}
    </span>
  );
}

function Crm360Badge({ registration }: {
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
      : "border-slate-200 bg-slate-50 text-slate-500";

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
                : "bg-slate-400"
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
    <div className="rounded-2xl border border-[#dbe3ef] bg-white p-8">
      <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-[#eadcc2] border-t-[#A07C3B]" />
      <p className="mt-3 text-center text-sm font-semibold text-[#63708a]">
        Carregando fila
      </p>
    </div>
  );
}

function toneBg(tone: IrisTone) {
  if (tone === "gold") return "bg-[#fbf6ec]";
  if (tone === "green") return "bg-emerald-50";
  if (tone === "red") return "bg-rose-50";
  if (tone === "blue") return "bg-sky-50";
  return "bg-[#f4f6fa]";
}

function toneText(tone: IrisTone) {
  if (tone === "gold") return "text-[#A07C3B]";
  if (tone === "green") return "text-emerald-600";
  if (tone === "red") return "text-rose-600";
  if (tone === "blue") return "text-sky-600";
  return "text-[#63708a]";
}

async function loadIrisData({
  operatorUserId,
  queueSlugFilter,
}: {
  operatorUserId?: string | null;
  queueSlugFilter?: string | null;
} = {}): Promise<IrisData> {
  const supabase = getHubSupabaseClient();

  if (!supabase) {
    return emptyIrisData;
  }

  const normalizedQueueSlugFilter =
    normalizeOptionalIrisQueueSlug(queueSlugFilter);
  const queuesResult = await supabase
    .from("caredesk_queues")
    .select(
      "id,name,slug,color,status,default_priority,sla_first_response_minutes,sla_resolution_minutes,routing_strategy,assignment_strategy",
    )
    .order("name", { ascending: true });

  if (queuesResult.error) {
    throw queuesResult.error;
  }

  const queues = (queuesResult.data ?? []).map(mapQueueRow);
  const scopedQueueIds = normalizedQueueSlugFilter
    ? queues
        .filter((queue) => isSameIrisQueueScope(queue, normalizedQueueSlugFilter))
        .map((queue) => queue.id)
    : [];
  let ticketsQuery = supabase
    .from("caredesk_tickets")
    .select(
      "id,protocol,contact_id,queue_id,profile_id,channel_id,status,priority,subject,source_module,source_entity_type,source_context,assigned_to_user_id,opened_at,first_response_due_at,resolution_due_at,first_responded_at,resolved_at,closed_at,metadata,created_at,updated_at",
    )
    .order("opened_at", { ascending: false })
    .limit(200);

  if (operatorUserId) {
    ticketsQuery = ticketsQuery.eq("assigned_to_user_id", operatorUserId);
  }

  if (normalizedQueueSlugFilter) {
    ticketsQuery = scopedQueueIds.length
      ? ticketsQuery.in("queue_id", scopedQueueIds)
      : ticketsQuery.eq("queue_id", "__iris_queue_scope_not_found__");
  }

  const [
    ticketsResult,
    profilesResult,
    templatesResult,
    channelsResult,
    broadcastsResult,
  ] = await Promise.all([
    ticketsQuery,
    supabase
      .from("caredesk_ticket_profiles")
      .select(
        "id,queue_id,name,slug,category,priority,sla_first_response_minutes,sla_resolution_minutes,description,required_fields,status",
      )
      .order("category", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("caredesk_templates")
      .select("id,name,slug,category,channel_kind,body,variables,status,metadata")
      .order("name", { ascending: true }),
    supabase
      .from("caredesk_channels")
      .select("id,name,kind,status")
      .order("name", { ascending: true }),
    supabase
      .from("caredesk_broadcasts")
      .select("id,name,status,scheduled_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const failedResult = [
    ticketsResult,
    profilesResult,
    templatesResult,
    channelsResult,
    broadcastsResult,
  ].find((result) => result.error);

  if (failedResult?.error) {
    throw failedResult.error;
  }

  const ticketsRows = ticketsResult.data ?? [];
  const ticketIds = ticketsRows.map((ticket) => ticket.id);
  const contactIds = unique(
    ticketsRows.map((ticket) => ticket.contact_id).filter(Boolean),
  );
  const assignedUserIds = unique(
    ticketsRows.map((ticket) => ticket.assigned_to_user_id).filter(Boolean),
  );

  const [contactsResult, messagesResult, assignedUsersResult] = await Promise.all([
    contactIds.length
      ? supabase
          .from("caredesk_contacts")
          .select(
            "id,display_name,document,email,phone,whatsapp_phone,metadata,c2x_payload",
          )
          .in("id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    ticketIds.length
        ? supabase
          .from("caredesk_messages")
          .select(
            "id,ticket_id,body,direction,sender_type,sender_user_id,message_type,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id,sender_user:hub_users(display_name,email,avatar_url)",
          )
          .in("ticket_id", ticketIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    assignedUserIds.length
      ? supabase
          .from("hub_users")
          .select("id,display_name,avatar_url")
          .in("id", assignedUserIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const failedNestedResult = [contactsResult, messagesResult, assignedUsersResult].find(
    (result) => result.error,
  );

  if (failedNestedResult?.error) {
    throw failedNestedResult.error;
  }

  const channels = (channelsResult.data ?? []).map((channel) => ({
    id: channel.id,
    kind: channel.kind,
    name: channel.name,
    status: channel.status,
  }));
  const templates = (templatesResult.data ?? [])
    .map((template) => ({
      body: template.body ?? null,
      category: template.category,
      channelKind: template.channel_kind,
      id: template.id,
      metadata:
        template.metadata && typeof template.metadata === "object"
          ? template.metadata
          : null,
      name: template.name,
      slug: template.slug,
      status: template.status,
      variables: normalizeTemplateVariablesValue(template.variables),
    }))
    .filter((template) => {
      const status = String(template.status ?? "")
        .trim()
        .toLocaleLowerCase("pt-BR");

      return status !== "archived";
    });
  const broadcasts = (broadcastsResult.data ?? []).map((broadcast) => ({
    id: broadcast.id,
    name: broadcast.name,
    scheduledAt: broadcast.scheduled_at,
    status: broadcast.status,
  }));
  const queueById = new Map(queues.map((queue) => [queue.id, queue]));
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const contactById = new Map(
    (contactsResult.data ?? []).map((contact) => [contact.id, contact]),
  );
  const assignedUserById = new Map(
    (assignedUsersResult.data ?? []).map((user) => [user.id, user]),
  );
  const profileRows = profilesResult.data ?? [];
  const profiles = profileRows.map((profile) =>
    mapTicketProfileRow(
      profile,
      profile.queue_id ? queueById.get(profile.queue_id) : null,
    ),
  );
  const profileById = new Map(
    profileRows.map((profile) => [profile.id, profile]),
  );
  const messagesByTicket = groupMessagesByTicket(messagesResult.data ?? []);

  return {
    broadcasts,
    channels,
    profiles,
    queues,
    templates,
    tickets: ticketsRows.map((ticket) =>
      mapTicketRow({
        channel: ticket.channel_id ? channelById.get(ticket.channel_id) : null,
        contact: ticket.contact_id ? contactById.get(ticket.contact_id) : null,
        messages: messagesByTicket.get(ticket.id) ?? [],
        profile: ticket.profile_id ? profileById.get(ticket.profile_id) : null,
        queue: ticket.queue_id ? queueById.get(ticket.queue_id) : null,
        assignedUser: ticket.assigned_to_user_id
          ? assignedUserById.get(ticket.assigned_to_user_id)
          : null,
        row: ticket,
      }),
    ),
  };
}

async function enrichTicketsWithCrm360(data: IrisData): Promise<IrisData> {
  const phones = unique(
    data.tickets
      .map((ticket) => ticket.contactPhone)
      .filter((phone): phone is string => Boolean(phone?.trim())),
  );

  if (!phones.length) {
    return data;
  }

  try {
    const accessToken = await getIrisAccessToken();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      IRIS_CRM360_ENRICH_TIMEOUT_MS,
    );

    const response = await fetch("/api/iris/apolo/phone-match", {
      body: JSON.stringify({ phones }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    }).finally(() => window.clearTimeout(timeoutId));

    if (!response.ok) {
      return data;
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          results?: Record<string, IrisCrm360Registration>;
        }
      | null;
    const results = payload?.results ?? {};

    return {
      ...data,
      tickets: data.tickets.map((ticket) => ({
        ...ticket,
        crm360Registration: ticket.contactPhone
          ? results[ticket.contactPhone] ?? { status: "missing" }
          : null,
      })),
    };
  } catch (error) {
    const isAbort =
      error instanceof DOMException && error.name === "AbortError";

    if (isAbort) {
      console.warn("[iris] consulta CRM 360 excedeu o tempo limite");
    } else {
      console.error("[iris] nao foi possivel consultar o CRM 360", error);
    }

    return data;
  }
}

async function withIrisTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} excedeu ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

function crm360ContextLabel(registration?: IrisCrm360Registration | null) {
  if (!registration) {
    return "Nao consultado";
  }

  if (registration.status === "registered") {
    const profile = registration.profileLabel ?? registration.profiles?.join(", ");
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

  if (registration?.status === "registered" && registration.label) {
    return formatIrisDisplayName(registration.label);
  }

  if (registration?.status === "missing") {
    return "Sem cadastro";
  }

  return formatIrisDisplayName(stripWhatsAppContactPrefix(ticket.contactLabel));
}

function ticketCrmSubtitle(ticket: IrisTicket) {
  const registration = ticket.crm360Registration;

  if (registration?.status === "registered") {
    return (
      registration.profileLabel ??
      registration.profiles?.join(" | ") ??
      registration.relationLabel ??
      "CRM 360"
    );
  }

  if (registration?.status === "missing") {
    return "Telefone sem cadastro no CRM 360";
  }

  return ticket.subject;
}

function stripWhatsAppContactPrefix(value: string) {
  return value.replace(/^WhatsApp\s*-\s*/i, "").trim() || value;
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

function statusAfterMessage(ticket: IrisTicket, message: IrisMessage): IrisStatus {
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
  return value
    .replace(/\s*Careli\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim() || value;
}

function extractIrisApoloClientOptions(payload: any): IrisApoloClientOption[] {
  const entities = Array.isArray(payload?.data?.results)
    ? payload.data.results
    : Array.isArray(payload?.data?.entities)
      ? payload.data.entities
      : [];

  return entities
    .map((entity: any) => {
      const phone = pickIrisApoloPhone(entity);

      if (!phone) {
        return null;
      }

      const label = formatIrisDisplayName(
        entity.displayName ?? entity.tradeName ?? entity.legalName ?? "Cliente",
      );
      const profiles = Array.isArray(entity.profiles) ? entity.profiles : [];

      return {
        documentMasked: entity.documentMasked ?? null,
        firstName: extractFirstName(label),
        id: String(entity.id ?? phone),
        label,
        locationLabel: entity.locationLabel ?? null,
        phone,
        profileLabel: formatApoloProfileLabel(profiles, entity.kind),
        profiles,
      } satisfies IrisApoloClientOption;
    })
    .filter(Boolean) as IrisApoloClientOption[];
}

function pickIrisApoloPhone(entity: any) {
  const directPhone = String(entity?.phone ?? "").replace(/\D/g, "");

  if (directPhone.length >= 12 && directPhone.length <= 15) {
    return directPhone;
  }

  if (directPhone.length === 10 || directPhone.length === 11) {
    return `55${directPhone}`;
  }

  const contacts = Array.isArray(entity?.contacts) ? entity.contacts : [];
  const whatsapp =
    contacts.find((contact: any) => contact?.type === "whatsapp") ??
    contacts.find((contact: any) => contact?.type === "phone");
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
    .map((profile) =>
      profile
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
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

  return "CRM 360";
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
    if (
      variable.key === "primeiro_nome" ||
      variable.placeholder === "{{1}}"
    ) {
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
  const timestamp = new Date()
    .toISOString()
    .replace(/\D/g, "")
    .slice(2, 16);

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
    headerFileName: readTemplateMetadataString(template, "mediaHeaderFileName") ?? "",
    headerFormat: readTemplateHeaderFormat(template) ?? "NONE",
    headerHandle: readTemplateMetadataString(template, "mediaHeaderHandle") ?? "",
    headerMimeType: readTemplateMetadataString(template, "mediaHeaderMimeType") ?? "",
    headerSendLink: readTemplateMetadataString(template, "mediaHeaderSendLink") ?? "",
    language:
      readTemplateMetadataString(template, "metaLanguage") ??
      IRIS_OPT_IN_TEMPLATE.language,
    name: readTemplateMetaName(template) ?? template.slug.replace(/-/g, "_"),
    phoneNumberId: readTemplateMetadataString(template, "metaPhoneNumberId") ?? "",
    queueLabel: readTemplateQueueLabel(template),
    subjectLabel: readTemplateSubjectLabel(template),
    variables: variables.length ? variables : [...IRIS_OPT_IN_TEMPLATE.variables],
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
      phoneNumbers.find((phoneNumber) => phoneNumber.id === normalizedId) ?? null
    );
  }

  return null;
}

function formatMetaPhoneNumberOption(phoneNumber?: IrisMetaPhoneNumberOption | null) {
  if (!phoneNumber) {
    return "Telefone nao selecionado";
  }

  const label = String(phoneNumber.label ?? "").trim();
  const verifiedName = String(phoneNumber.verifiedName ?? "").trim();
  const displayPhoneNumber = String(phoneNumber.displayPhoneNumber ?? "").trim();
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
  const normalized = String(value ?? "").trim().toLowerCase();

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
    return "bg-slate-50 text-slate-700 ring-slate-200";
  }

  return "bg-slate-50 text-slate-600 ring-slate-200";
}

function normalizeMetaTemplateStatusKey(status?: string | null) {
  return status?.trim().toUpperCase().replace(/[\s-]+/g, "_") ?? null;
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
    "id,name,slug,color,status,default_priority,sla_first_response_minutes,sla_resolution_minutes,routing_strategy,assignment_strategy";

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

function mapQueueRow(row: any): IrisQueueConfig {
  return {
    assignmentStrategy: row.assignment_strategy ?? "manual",
    color: row.color ?? "#A07C3B",
    defaultPriority: normalizePriority(row.default_priority),
    id: row.id,
    name: row.name,
    routingStrategy: row.routing_strategy ?? "manual",
    slaFirstResponseMinutes: Number(row.sla_first_response_minutes ?? 60),
    slaResolutionMinutes: Number(row.sla_resolution_minutes ?? 480),
    slug: row.slug,
    status: row.status,
  };
}

function mapTicketProfileRow(
  row: any,
  queue?: IrisQueueConfig | null,
): IrisTicketProfileConfig {
  return {
    category: row.category ?? "Atendimento",
    description: row.description ?? null,
    id: row.id,
    name: row.name ?? "Sem nome",
    priority: normalizePriority(row.priority),
    queueId: row.queue_id ?? null,
    queueLabel: queue?.name ?? "Sem fila",
    requiredFields: normalizeRequiredFields(row.required_fields),
    slaFirstResponseMinutes: Number(row.sla_first_response_minutes ?? 60),
    slaResolutionMinutes: Number(row.sla_resolution_minutes ?? 480),
    slug: row.slug ?? "",
    status: row.status ?? "active",
  };
}

function mapTicketRow(input: {
  assignedUser?: any;
  channel: any;
  contact: any;
  messages: IrisMessage[];
  profile: any;
  queue: IrisQueueConfig | null;
  row: any;
}): IrisTicket {
  const lastMessage = input.messages[input.messages.length - 1];
  const sourceModule = String(input.row.source_module ?? "").trim();

  return {
    assignedToLabel: readTicketAssignedToLabel(
      input.assignedUser,
      input.messages,
    ),
    channelId: input.row.channel_id,
    channelLabel: input.channel?.name ?? "Canal nao definido",
    contactAvatarUrl: getContactAvatarUrl(input.contact),
    contactDocument: input.contact?.document ?? null,
    contactEmail: input.contact?.email ?? null,
    contactId: input.row.contact_id,
    contactLabel: input.contact?.display_name ?? "Cliente sem cadastro",
    contactPhone: input.contact?.whatsapp_phone ?? input.contact?.phone ?? null,
    closedAt: input.row.closed_at,
    createdAt: input.row.created_at,
    firstRespondedAt: input.row.first_responded_at,
    firstResponseDueAt: input.row.first_response_due_at,
    id: input.row.id,
    lastMessageAt:
      lastMessage?.createdAt ?? input.row.updated_at ?? input.row.opened_at,
    lastMessagePreview: lastMessage
      ? irisMessagePreview(lastMessage)
      : "Sem mensagens registradas",
    metadata:
      input.row.metadata && typeof input.row.metadata === "object"
        ? input.row.metadata
        : null,
    messages: input.messages,
    openedAt: input.row.opened_at,
    priority: normalizePriority(input.row.priority),
    profileLabel: input.profile?.name ?? "Sem perfil",
    protocol: input.row.protocol,
    queueLabel: input.queue?.name ?? "Sem fila",
    queueSlug: input.queue?.slug ?? null,
    resolutionDueAt: input.row.resolution_due_at,
    resolvedAt: input.row.resolved_at,
    sourceContext:
      input.row.source_context && typeof input.row.source_context === "object"
        ? input.row.source_context
        : null,
    sourceLabel: sourceModule ? labelForSource(sourceModule) : "Entrada direta",
    status: normalizeStatus(input.row.status),
    subject:
      input.row.subject ?? input.profile?.category ?? "Atendimento ao cliente",
    unread: Boolean(
      lastMessage &&
      lastMessage.direction === "inbound" &&
      !["closed", "resolved", "cancelled"].includes(input.row.status),
    ),
  };
}

function mapMessageRow(row: any): IrisMessage {
  return {
    audioDurationMs: readMessageAudioDuration(row),
    audioMimeType: readMessageAudioMimeType(row),
    audioUrl: readMessageAudioUrl(row),
    body: row.body ?? "",
    createdAt: row.created_at,
    deliveryStatus: row.delivery_status ?? "queued",
    direction: row.direction ?? "internal",
    editedAt: readMessageEditedAt(row),
    deliveredAt: row.delivered_at ?? null,
    externalMessageId: row.external_message_id ?? null,
    id: row.id,
    messageType: row.message_type ?? readMessageType(row),
    operatorAvatarUrl: readMessageOperatorAvatarUrl(row),
    readAt: row.read_at ?? null,
    reactions: readMessageReactions(row),
    replyTo: readMessageReplyPreview(row),
    senderLabel: readMessageSenderLabel(row),
    senderType: row.sender_type ?? "system",
    sentAt: row.sent_at ?? null,
  };
}

function readMessageSenderLabel(row: any) {
  const payload = row?.provider_payload;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const operatorLabel = (payload as Record<string, unknown>).operatorLabel;
    const displayLabel = maybeIrisOperatorLabel(operatorLabel);

    if (displayLabel) {
      return displayLabel;
    }
  }

  const nestedUser = row?.sender_user;

  if (
    nestedUser &&
    typeof nestedUser === "object" &&
    !Array.isArray(nestedUser) &&
    typeof nestedUser.display_name === "string" &&
    nestedUser.display_name.trim()
  ) {
    return maybeIrisOperatorLabel(nestedUser.display_name) ?? "Operador Iris";
  }

  if (typeof row?.sender_label === "string" && row.sender_label.trim()) {
    return row?.sender_type === "operator"
      ? formatIrisOperatorLabel(row.sender_label)
      : row.sender_label.trim();
  }

  return row?.sender_type === "operator" ? "Operador Iris" : null;
}

function readMessageOperatorAvatarUrl(row: any) {
  const payload = row?.provider_payload;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const avatarUrl = (payload as Record<string, unknown>).operatorAvatarUrl;

    if (isUsableUrl(avatarUrl)) {
      return avatarUrl;
    }
  }

  const nestedUser = row?.sender_user;

  if (
    nestedUser &&
    typeof nestedUser === "object" &&
    !Array.isArray(nestedUser) &&
    isUsableUrl(nestedUser.avatar_url)
  ) {
    return nestedUser.avatar_url;
  }

  return null;
}

function readMessageType(row: any) {
  const payload = row?.provider_payload;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const media = (payload as Record<string, unknown>).media;

    if (media && typeof media === "object" && !Array.isArray(media)) {
      const type = (media as Record<string, unknown>).type;

      if (typeof type === "string" && type.trim()) {
        return type.trim();
      }
    }
  }

  return "text";
}

function readMessageEditedAt(row: any) {
  const payload = row?.provider_payload;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const editedAt = (payload as Record<string, unknown>).editedAt;

    if (typeof editedAt === "string" && editedAt.trim()) {
      return editedAt.trim();
    }
  }

  return null;
}

function readMessageReplyPreview(row: any): IrisReplyPreview | null {
  const payload = row?.provider_payload;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const reply = (payload as Record<string, unknown>).replyTo;

  if (!reply || typeof reply !== "object" || Array.isArray(reply)) {
    return null;
  }

  const record = reply as Record<string, unknown>;
  const messageId = typeof record.messageId === "string" ? record.messageId : "";

  if (!messageId) {
    return null;
  }

  return {
    body: typeof record.body === "string" ? record.body : "Mensagem selecionada",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
    direction:
      record.direction === "inbound" ||
      record.direction === "outbound" ||
      record.direction === "internal"
        ? record.direction
        : null,
    externalMessageId:
      typeof record.externalMessageId === "string"
        ? record.externalMessageId
        : null,
    messageId,
    senderLabel:
      typeof record.senderLabel === "string" && record.senderLabel.trim()
        ? record.senderLabel.trim()
        : null,
  };
}

function readMessageReactions(row: any): IrisMessageReaction[] {
  const payload = row?.provider_payload;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const reactions = (payload as Record<string, unknown>).reactions;

  if (!Array.isArray(reactions)) {
    return [];
  }

  return reactions
    .map((reaction) => {
      if (!reaction || typeof reaction !== "object" || Array.isArray(reaction)) {
        return null;
      }

      const record = reaction as Record<string, unknown>;
      const emoji = typeof record.emoji === "string" ? record.emoji.trim() : "";

      if (!emoji) {
        return null;
      }

      return {
        actorAvatarUrl: isUsableUrl(record.actorAvatarUrl)
          ? record.actorAvatarUrl
          : null,
        actorLabel:
          typeof record.actorLabel === "string" && record.actorLabel.trim()
            ? record.actorLabel.trim()
            : null,
        actorUserId:
          typeof record.actorUserId === "string" && record.actorUserId.trim()
            ? record.actorUserId.trim()
            : null,
        createdAt:
          typeof record.createdAt === "string" && record.createdAt.trim()
            ? record.createdAt.trim()
            : null,
        emoji,
      } satisfies IrisMessageReaction;
    })
    .filter(Boolean) as IrisMessageReaction[];
}

function readMessageAudioDuration(row: any) {
  const media = readMessageMediaPayload(row);
  const duration = media?.durationMs;

  return typeof duration === "number" && Number.isFinite(duration)
    ? duration
    : null;
}

function readMessageAudioMimeType(row: any) {
  const media = readMessageMediaPayload(row);
  const mimeType = media?.mimeType;

  return typeof mimeType === "string" && mimeType.trim()
    ? mimeType.trim()
    : null;
}

function readMessageAudioUrl(row: any) {
  const media = readMessageMediaPayload(row);
  const url = media?.url ?? media?.externalUrl;

  return isUsableUrl(url) ? url : null;
}

function readMessageMediaPayload(row: any): Record<string, unknown> | null {
  const payload = row?.provider_payload;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const media = (payload as Record<string, unknown>).media;

  return media && typeof media === "object" && !Array.isArray(media)
    ? (media as Record<string, unknown>)
    : null;
}

function ensureOperatorIdentity(
  message: IrisMessage,
  operatorLabel: string,
  operatorAvatarUrl?: string | null,
) {
  if (message.direction !== "outbound") {
    return message;
  }

  return {
    ...message,
    operatorAvatarUrl: message.operatorAvatarUrl ?? operatorAvatarUrl ?? null,
    senderLabel:
      maybeIrisOperatorLabel(message.senderLabel) ??
      formatIrisOperatorLabel(operatorLabel),
  };
}

function groupMessagesByTicket(rows: any[]) {
  const groups = new Map<string, IrisMessage[]>();

  rows.forEach((row) => {
    const ticketId = row.ticket_id;
    if (!ticketId) {
      return;
    }

    const current = groups.get(ticketId) ?? [];
    current.push(mapMessageRow(row));
    groups.set(ticketId, current);
  });

  return groups;
}

function buildIrisSnapshot(data: IrisData, onlineOperators = 0) {
  const tickets = data.tickets;
  const total = tickets.length;
  const openTickets = tickets.filter((ticket) => !isClosedTicket(ticket));
  const critical = tickets.filter(
    (ticket) => ticket.priority === "critical" || isSlaCritical(ticket),
  ).length;
  const slaCritical = tickets.filter(isSlaCritical).length;
  const unanswered = tickets.filter(isWaitingForIris).length;
  const waitingOperator = tickets.filter(
    (ticket) =>
      effectiveIrisStatus(ticket) === "waiting_operator" ||
      ticket.assignedToLabel === "Sem responsavel",
  ).length;
  const inbox = tickets.filter(
    (ticket) =>
      effectiveIrisStatus(ticket) === "new" ||
      effectiveIrisStatus(ticket) === "waiting_operator" ||
      effectiveIrisStatus(ticket) === "pending",
  ).length;
  const contacts = unique(
    tickets.map((ticket) => ticket.contactId).filter(Boolean),
  ).length;
  const messages = tickets.reduce(
    (totalMessages, ticket) => totalMessages + ticket.messages.length,
    0,
  );
  const topTicket = [...tickets].sort(scoreTicketForAction)[0] ?? null;

  return {
    aiActions: Math.max(critical + unanswered + waitingOperator, 0),
    contacts,
    critical,
    averageHandlingTimeLabel: estimateAverageHandlingTime(tickets),
    firstResponseLabel: estimateFirstResponse(tickets),
    followUpsToday: unanswered + slaCritical,
    inbox,
    messages,
    onlineOperators,
    open: openTickets.length,
    responseTimeLabel: estimateAverageResponse(tickets),
    slaCritical,
    topTicket,
    total,
    unanswered,
    waitingOperator,
  };
}

function scoreTicketForAction(first: IrisTicket, second: IrisTicket) {
  return ticketScore(second) - ticketScore(first);
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

function readTicketAssignedToLabel(assignedUser: any, messages: IrisMessage[]) {
  const assignedLabel = maybeIrisOperatorLabel(assignedUser?.display_name);

  if (assignedLabel) {
    return assignedLabel;
  }

  const latestOperatorMessage = [...messages]
    .reverse()
    .find(
      (message) =>
        message.direction === "outbound" &&
        message.senderType === "operator" &&
        Boolean(maybeIrisOperatorLabel(message.senderLabel)),
    );
  const latestOperatorLabel = maybeIrisOperatorLabel(
    latestOperatorMessage?.senderLabel,
  );

  return latestOperatorLabel ?? "Sem responsavel";
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
  return Boolean(ticket.firstRespondedAt) || getFirstCareliResponseAt(ticket) > 0;
}

function ticketOrigin(ticket: IrisTicket): IrisOrigin {
  const firstMessage = sortedTicketMessages(ticket)
    .filter((message) => message.direction !== "internal")[0];

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

  if (isTicketMarkedForOperator(ticket) || isActiveContactOriginTicket(ticket)) {
    return false;
  }

  const assignedToCaca = normalizeIrisOwnerKey(ticket.assignedToLabel) === "caca";
  const cacaAutomation = readCacaAutomationFromTicket(ticket);

  if (readTicketRecordBoolean(cacaAutomation, "handoffRequired")) {
    return false;
  }

  if (assignedToCaca || cacaAutomation) {
    return true;
  }

  return effectiveIrisStatus(ticket) === "waiting_customer" && ticketOrigin(ticket) === "passive";
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

  if (status === "waiting_operator" || status === "open" || status === "pending") {
    return true;
  }

  const cacaAutomation = readCacaAutomationFromTicket(ticket);

  if (readTicketRecordBoolean(cacaAutomation, "handoffRequired")) {
    return true;
  }

  const assignedOwner = normalizeIrisOwnerKey(ticket.assignedToLabel);

  return (
    assignedOwner !== "sem-responsavel" &&
    assignedOwner !== "caca"
  );
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

function getIrisCustomerServiceWindow(ticket: IrisTicket, tickets: IrisTicket[]) {
  const relatedTickets = getRelatedTicketsForCustomerServiceWindow(ticket, tickets);
  const lastCustomerMessageAt = relatedTickets
    .map((currentTicket) => {
      const metadataLastMessageAt = readTicketRecordString(
        currentTicket.metadata,
        "lastCustomerMessageAt",
      );
      const metadataOpenedAt = readTicketRecordString(
        currentTicket.metadata,
        "customerServiceWindowOpenedAt",
      );
      const inboundMessages = sortedTicketMessages(currentTicket).filter(
        isCustomerMessage,
      );
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

    if (isCareliMessage(message) && waitingFrom !== null && createdAt >= waitingFrom) {
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
    return "bg-slate-50 text-slate-600 ring-slate-200";
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

  if (status === "waiting_operator" || status === "pending" || status === "open") {
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
      const closedAt = dateValue(ticket.closedAt) || dateValue(ticket.resolvedAt);

      return openedAt && closedAt ? Math.max(0, closedAt - openedAt) / 60000 : null;
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

function formatAudioDuration(durationMs?: number | null) {
  if (!durationMs || !Number.isFinite(durationMs)) {
    return "0:00";
  }

  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getContactAvatarUrl(contact: any) {
  const candidates = [
    contact?.metadata?.avatar_url,
    contact?.metadata?.avatarUrl,
    contact?.metadata?.profile_picture_url,
    contact?.metadata?.profilePictureUrl,
    contact?.metadata?.profile_photo_url,
    contact?.metadata?.profilePhotoUrl,
    contact?.metadata?.picture,
    contact?.metadata?.image,
    contact?.c2x_payload?.avatar_url,
    contact?.c2x_payload?.avatarUrl,
    contact?.c2x_payload?.profile_picture_url,
    contact?.c2x_payload?.profilePictureUrl,
    contact?.c2x_payload?.picture,
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
        : event.date ?? "Sem data",
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
            : installment.paidAt ?? installment.dueDate ?? "Sem data",
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
        : signal.lastEvent ?? "Sem data",
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
          createdByLabel: normalizeIrisText(record.createdByLabel) ?? "Operador Iris",
          id: normalizeIrisText(record.id) ?? `ctx-event-${index}-${scheduledAt}`,
          kind: normalizeIrisText(record.kind) ?? "atividade",
          notes: normalizeIrisText(record.notes),
          scheduledAt,
          status: normalizeIrisText(record.status) ?? "planned",
          title,
        };
      })
      .filter(
        (
          event,
        ): event is IrisTicketContextAgendaEvent => Boolean(event),
      ),
  );
}

function sortIrisTicketContextAgendaEvents(events: IrisTicketContextAgendaEvent[]) {
  return [...events].sort(
    (first, second) => dateValue(second.scheduledAt) - dateValue(first.scheduledAt),
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
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
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
