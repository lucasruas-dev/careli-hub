"use client";

import {
  isHubItTicketsMigrationPendingMessage,
  loadHubItTickets,
  updateHubItTicket,
} from "@/lib/hub-it-tickets/client";
import {
  mergeTicketListWithExistingDetails,
  upsertTicketWithDetails,
} from "@/lib/hub-it-tickets/merge";
import { HelpDeskAttachmentMigrationCard } from "@/modules/squadops/blocks/helpdesk/helpdesk-attachment-migration-card";
import {
  hubItTicketCategoryLabels,
  hubItTicketPriorityLabels,
  hubItTicketRoadmapTypeLabels,
  hubItTicketStatusLabels,
  type HubItTicket,
  type HubItTicketAttachmentInput,
  type HubItTicketBacklogInput,
  type HubItTicketCategory,
  type HubItTicketPriority,
  type HubItTicketRoadmapType,
  type HubItTicketStatus,
} from "@/lib/hub-it-tickets/types";
import {
  countTicketsByWorkflowStage,
  getTicketWorkflowStage,
  getTicketWorkflowStageFromStatus,
  isTicketBacklog,
  ticketWorkflowStageLabels as workflowStageLabels,
  ticketWorkflowStageOrder as workflowStageOptions,
  type TicketWorkflowStage,
} from "@/lib/hub-it-tickets/workflow";
import { Badge, Surface, Tooltip } from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";
import {
  AlertTriangle,
  Archive,
  ArrowUpDown,
  AtSign,
  BarChart3,
  Bug,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  ClipboardList,
  ExternalLink,
  FileText,
  History,
  ImageIcon,
  Inbox,
  LineChart,
  Loader2,
  Maximize2,
  MessageSquareReply,
  Mic,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Square,
  UserRound,
  Video,
  Wrench,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

type HubItTicketsBoardProps = {
  accessToken: string | null;
  isActive: boolean;
  onOpenPoAi?: () => void;
  onTicketAttentionCountChange?: (count: number) => void;
  onTicketCountChange?: (count: number) => void;
};

type TicketDraft = {
  adminResponse: string;
  approvedDeliveryDate: string;
  category: HubItTicketCategory;
  deliveryDecision: "manter" | "approve_requested" | "reject_with_new_date";
  deliveryDecisionNote: string;
  priority: HubItTicketPriority;
  resolutionSummary: string;
  status: HubItTicketStatus;
};

const emptyDraft: TicketDraft = {
  adminResponse: "",
  approvedDeliveryDate: "",
  category: "erro",
  deliveryDecision: "manter",
  deliveryDecisionNote: "",
  priority: "media",
  resolutionSummary: "",
  status: "em_tratativa",
};

type BacklogFormState = {
  module: string;
  note: string;
  priority: HubItTicket["priority"];
  screen: string;
  type: HubItTicketRoadmapType;
};

type DeliveryFilter = "todos" | "hoje" | "proximos" | "folga" | "sem_data";
type QueueFilterValue = "todos";
type TicketQueueView = "fila" | "historico" | "gestao";
type TicketQueueDisplayMode = "calendario" | "kanban" | "lista";
type TicketQueueFilters = {
  collaborator: QueueFilterValue | string;
  department: QueueFilterValue | string;
  priority: QueueFilterValue | HubItTicket["priority"];
  workflow: QueueFilterValue | TicketWorkflowStage;
};
type HistorySortDirection = "asc" | "desc";
type HistorySortKey =
  | "collaborator"
  | "createdAt"
  | "department"
  | "deliveryDate"
  | "module"
  | "priority"
  | "protocol"
  | "status"
  | "title"
  | "updatedAt";
type TicketInsightModalState = {
  groupBy?: TicketInsightGroupMode;
  tickets: HubItTicket[];
  title: string;
} | null;
type TicketInsightGroupMode = "category" | "collaborator" | "workflow";
type TicketInsightGroup = {
  key: string;
  label: string;
  tickets: HubItTicket[];
};
type TicketWorkspaceSection =
  | "actual"
  | "context"
  | "delivery"
  | "description"
  | "expected";

type MentionUser = {
  avatarUrl?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  email?: string | null;
  id: string;
  name: string;
  role?: string | null;
  sectorId?: string | null;
  sectorName?: string | null;
  status?: string | null;
};

type SetupUsersStatus = "idle" | "loading" | "ready" | "error";

type TicketManagementStats = {
  active: number;
  activeTickets: HubItTicket[];
  allTickets: HubItTicket[];
  backlog: number;
  backlogTickets: HubItTicket[];
  categories: TicketDimensionStats[];
  closedTodayTickets: HubItTicket[];
  collaborators: TicketCollaboratorStats[];
  createdTodayTickets: HubItTicket[];
  dailyVolume: TicketDailyVolumeStats[];
  departmentByTicketProtocol: ReadonlyMap<string, string>;
  departments: TicketDepartmentStats[];
  doneTickets: HubItTicket[];
  finalized: number;
  finalizedTickets: HubItTicket[];
  firstResponseAverageHours: number | null;
  highPriorityTickets: HubItTicket[];
  inProgress: number;
  lastUpdatedTicket: HubItTicket | null;
  meetingBacklogTickets: HubItTicket[];
  meetingTreatmentTickets: HubItTicket[];
  modules: TicketDimensionStats[];
  newTickets: number;
  repliedTodayTickets: HubItTicket[];
  resolutionAverageHours: number | null;
  review: number;
  treatmentTickets: HubItTicket[];
  total: number;
  validation: number;
};

type TicketDepartmentStats = {
  backlog: number;
  department: string;
  finalized: number;
  highPriority: number;
  inProgress: number;
  latestTicket: HubItTicket | null;
  modules: string[];
  requesterCount: number;
  tickets: HubItTicket[];
  total: number;
  validation: number;
};

type TicketDimensionStats = {
  backlog: number;
  finalized: number;
  inProgress: number;
  key: string;
  label: string;
  latestTicket: HubItTicket | null;
  tickets: HubItTicket[];
  total: number;
};

type TicketCollaboratorStats = TicketDimensionStats & {
  department: string;
  highPriority: number;
  modules: string[];
  requester: HubItTicket["requester"];
};

type TicketDailyVolumeStats = {
  closed: number;
  created: number;
  day: string;
  treated: number;
  validation: number;
};
type ManagementPanelFilters = {
  category: QueueFilterValue | HubItTicket["category"];
  collaborator: QueueFilterValue | string;
  department: QueueFilterValue | string;
  priority: QueueFilterValue | HubItTicket["priority"];
  query: string;
  workflow: QueueFilterValue | TicketWorkflowStage;
};

type TicketQueueFilterOptions = {
  collaborators: {
    count: number;
    key: string;
    label: string;
  }[];
  departments: {
    count: number;
    key: string;
    label: string;
  }[];
};

type HelpDeskViewState = {
  deliveryFilter?: DeliveryFilter;
  detailModalProtocol?: string | null;
  isQueueDatesExpanded?: boolean;
  queueDisplayMode?: TicketQueueDisplayMode;
  queueFilters?: TicketQueueFilters;
  queueView?: TicketQueueView;
  searchQuery?: string;
  selectedProtocol?: string | null;
};

type SetupUsersApiResponse = {
  data?: unknown;
  error?: string;
};


const roadmapTypeOptions = [
  "melhoria",
  "bug",
  "divida_tecnica",
  "automacao_integracao",
] as const satisfies readonly HubItTicketRoadmapType[];

const priorityOptions = [
  "baixa",
  "media",
  "alta",
  "critica",
] as const satisfies readonly HubItTicket["priority"][];

const deliveryFilterOptions = [
  "todos",
  "hoje",
  "proximos",
  "folga",
  "sem_data",
] as const satisfies readonly DeliveryFilter[];

const queueViewOptions = [
  "fila",
  "historico",
  "gestao",
] as const satisfies readonly TicketQueueView[];

const queueDisplayModeOptions = [
  "calendario",
  "kanban",
  "lista",
] as const satisfies readonly TicketQueueDisplayMode[];

const ticketDraftStorageKey = "careli-hub:zeus-helpdesk:drafts:v1";
const helpDeskViewStorageKey = "careli-hub:zeus-helpdesk:view:v2";
const emptyQueueFilters: TicketQueueFilters = {
  collaborator: "todos",
  department: "todos",
  priority: "todos",
  workflow: "todos",
};

export function HubItTicketsBoard({
  accessToken,
  isActive,
  onOpenPoAi,
  onTicketAttentionCountChange,
  onTicketCountChange,
}: HubItTicketsBoardProps) {
  const [initialViewState] = useState(readStoredHelpDeskViewState);
  const [tickets, setTickets] = useState<HubItTicket[]>([]);
  const [selectedProtocol, setSelectedProtocol] = useState<string | null>(
    () => initialViewState.selectedProtocol ?? null,
  );
  const [draft, setDraft] = useState<TicketDraft>(emptyDraft);
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>(
    () => initialViewState.deliveryFilter ?? "todos",
  );
  const [isQueueDatesExpanded, setIsQueueDatesExpanded] = useState(
    () => initialViewState.isQueueDatesExpanded ?? false,
  );
  const [detailModalProtocol, setDetailModalProtocol] = useState<
    string | null
  >(() => initialViewState.detailModalProtocol ?? null);
  const [insightModal, setInsightModal] = useState<TicketInsightModalState>(null);
  const [backlogModalProtocol, setBacklogModalProtocol] = useState<
    string | null
  >(null);
  const [loadedDetailProtocols, setLoadedDetailProtocols] = useState<
    readonly string[]
  >([]);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueView, setQueueView] = useState<TicketQueueView>(
    () => initialViewState.queueView ?? "fila",
  );
  const [queueDisplayMode, setQueueDisplayMode] =
    useState<TicketQueueDisplayMode>("kanban");
  const [queueFilters, setQueueFilters] = useState<TicketQueueFilters>(
    () => initialViewState.queueFilters ?? emptyQueueFilters,
  );
  const [searchQuery, setSearchQuery] = useState(
    () => initialViewState.searchQuery ?? "",
  );
  const [replyAttachments, setReplyAttachments] = useState<
    HubItTicketAttachmentInput[]
  >([]);
  const [attentionToast, setAttentionToast] = useState<string | null>(null);
  const [setupUsers, setSetupUsers] = useState<MentionUser[]>([]);
  const [setupUsersStatus, setSetupUsersStatus] =
    useState<SetupUsersStatus>("idle");
  const [setupUsersError, setSetupUsersError] = useState<string | null>(null);
  const attentionKeysRef = useRef<ReadonlySet<string>>(new Set());
  const isHydratingDraftRef = useRef(false);

  const activeQueueTickets = useMemo(
    () => tickets.filter(isTicketInActiveQueue),
    [tickets],
  );
  const historyTickets = useMemo(
    () => tickets.filter(isTicketInHistory),
    [tickets],
  );
  const setupUsersByLookup = useMemo(
    () => buildSetupUserLookup(setupUsers),
    [setupUsers],
  );
  const queueFilterOptions = useMemo(
    () => buildTicketQueueFilterOptions(activeQueueTickets, setupUsersByLookup),
    [activeQueueTickets, setupUsersByLookup],
  );
  const visibleQueueTickets =
    queueView === "historico"
      ? historyTickets
      : queueView === "gestao"
        ? tickets
        : activeQueueTickets;
  const searchFilteredQueueTickets = useMemo(
    () => filterTicketsBySearch(visibleQueueTickets, searchQuery),
    [searchQuery, visibleQueueTickets],
  );
  const filteredQueueTickets = useMemo(
    () =>
      queueView === "fila"
        ? filterTicketsByQueueFilters(
            searchFilteredQueueTickets,
            queueFilters,
            setupUsersByLookup,
          )
        : searchFilteredQueueTickets,
    [queueFilters, queueView, searchFilteredQueueTickets, setupUsersByLookup],
  );
  const managementSourceTickets =
    queueView === "gestao" && searchQuery.trim()
      ? searchFilteredQueueTickets
      : tickets;
  const managementStats = useMemo(
    () => buildTicketManagementStats(managementSourceTickets, setupUsersByLookup),
    [managementSourceTickets, setupUsersByLookup],
  );
  const deliveryBuckets = useMemo(() => {
    return {
      folga: activeQueueTickets.filter(
        (ticket) => getTicketDeliveryBucket(ticket) === "folga",
      )
        .length,
      hoje: activeQueueTickets.filter(
        (ticket) => getTicketDeliveryBucket(ticket) === "hoje",
      )
        .length,
      proximos: activeQueueTickets.filter(
        (ticket) => getTicketDeliveryBucket(ticket) === "proximos",
      ).length,
      semData: activeQueueTickets.filter(
        (ticket) => getTicketDeliveryBucket(ticket) === "sem_data",
      ).length,
    };
  }, [activeQueueTickets]);
  const workflowCounts = useMemo(
    () => countTicketsByWorkflowStage(tickets),
    [tickets],
  );
  const operatorAttentionTickets = useMemo(
    () =>
      activeQueueTickets.filter((ticket) => {
        const stage = getTicketWorkflowStage(ticket);

        return stage === "novo" || stage === "tratativa" || stage === "revisao";
      }),
    [activeQueueTickets],
  );
  const ticketsByDelivery = useMemo(() => {
    if (queueView === "historico" || queueView === "gestao") {
      return sortTicketsByUpdatedAt(filteredQueueTickets);
    }

    return sortTicketsByDeliveryDate(
      deliveryFilter === "todos"
        ? filteredQueueTickets
        : filteredQueueTickets.filter(
            (ticket) => getTicketDeliveryBucket(ticket) === deliveryFilter,
          ),
    );
  }, [deliveryFilter, filteredQueueTickets, queueView]);
  const selectedTicket =
    tickets.find((ticket) => ticket.protocol === selectedProtocol) ??
    ticketsByDelivery.find((ticket) => ticket.protocol === selectedProtocol) ??
    ticketsByDelivery[0] ??
    null;
  const detailModalTicket =
    detailModalProtocol
      ? tickets.find((ticket) => ticket.protocol === detailModalProtocol) ??
        null
      : null;
  const backlogModalTicket =
    backlogModalProtocol
      ? tickets.find((ticket) => ticket.protocol === backlogModalProtocol) ??
        null
      : null;
  const selectedTicketDraftProtocol = selectedTicket?.protocol ?? null;
  const selectedTicketDraftStatus = selectedTicket?.status ?? null;
  const selectedTicketDraftApprovedDeliveryDate =
    selectedTicket?.approvedDeliveryDate ?? null;
  const selectedTicketDraftRequestedDeliveryDate =
    selectedTicket?.requestedDeliveryDate ?? null;
  const selectedTicketDraftIsBacklog = selectedTicket?.roadmap?.active === true;
  const selectedTicketDraftCategory = selectedTicket?.category ?? null;
  const selectedTicketDraftPriority = selectedTicket?.priority ?? null;

  const refreshTickets = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const nextTickets = await loadHubItTickets({
        accessToken,
        details: "list",
        scope: "all",
      });
      setTickets((currentTickets) =>
        mergeTicketListWithExistingDetails(nextTickets, currentTickets),
      );
      setSelectedProtocol((currentProtocol) =>
        currentProtocol &&
        nextTickets.some((ticket) => ticket.protocol === currentProtocol)
          ? currentProtocol
          : (nextTickets[0]?.protocol ?? null),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Nao foi possivel carregar a fila HelpDesk.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  const loadSetupUsersForManagement = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setSetupUsersStatus("loading");
    setSetupUsersError(null);

    try {
      const response = await fetch("/api/setup/users", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as
        | SetupUsersApiResponse
        | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel carregar usuarios do Setup.",
        );
      }

      setSetupUsers(parseMentionUsers(payload?.data));
      setSetupUsersStatus("ready");
    } catch (loadError) {
      setSetupUsersStatus("error");
      setSetupUsersError(
        loadError instanceof Error
          ? loadError.message
          : "Nao foi possivel carregar usuarios do Setup.",
      );
    }
  }, [accessToken]);

  useEffect(() => {
    if (!isActive || !accessToken) {
      return;
    }

    void refreshTickets();
  }, [accessToken, isActive, refreshTickets]);

  useEffect(() => {
    if (!isActive || !accessToken || setupUsersStatus !== "idle") {
      return;
    }

    void loadSetupUsersForManagement();
  }, [accessToken, isActive, loadSetupUsersForManagement, setupUsersStatus]);

  useEffect(() => {
    onTicketCountChange?.(activeQueueTickets.length);
  }, [activeQueueTickets.length, onTicketCountChange]);

  useEffect(() => {
    onTicketAttentionCountChange?.(operatorAttentionTickets.length);
  }, [onTicketAttentionCountChange, operatorAttentionTickets.length]);

  useEffect(() => {
    if (queueView === "fila") {
      setQueueDisplayMode("kanban");
    }
  }, [queueView]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const nextKeys = new Set(
      operatorAttentionTickets.map(
        (ticket) => `${ticket.protocol}:${ticket.updatedAt}`,
      ),
    );
    const previousKeys = attentionKeysRef.current;

    if (previousKeys.size > 0) {
      const newAttentionTicket = operatorAttentionTickets.find(
        (ticket) => !previousKeys.has(`${ticket.protocol}:${ticket.updatedAt}`),
      );

      if (newAttentionTicket) {
        setAttentionToast(
          `${newAttentionTicket.protocol} tem nova mensagem ou revisao para tratar.`,
        );
      }
    }

    attentionKeysRef.current = nextKeys;
  }, [isActive, operatorAttentionTickets]);

  useEffect(() => {
    if (!attentionToast) {
      return;
    }

    const timeoutId = window.setTimeout(() => setAttentionToast(null), 7000);

    return () => window.clearTimeout(timeoutId);
  }, [attentionToast]);

  useEffect(() => {
    writeStoredHelpDeskViewState({
      deliveryFilter,
      detailModalProtocol,
      isQueueDatesExpanded,
      queueFilters,
      queueView,
      searchQuery,
      selectedProtocol,
    });
  }, [
    deliveryFilter,
    detailModalProtocol,
    isQueueDatesExpanded,
    queueFilters,
    queueView,
    searchQuery,
    selectedProtocol,
  ]);

  useEffect(() => {
    if (!selectedTicketDraftProtocol || !selectedTicketDraftStatus) {
      isHydratingDraftRef.current = true;
      setDraft(emptyDraft);
      setReplyAttachments([]);
      return;
    }

    const persistedDraft = readStoredTicketDraft(selectedTicketDraftProtocol);

    const defaultDraft = createDefaultTicketDraft({
      approvedDeliveryDate: selectedTicketDraftApprovedDeliveryDate,
      category: selectedTicketDraftCategory,
      isBacklog: selectedTicketDraftIsBacklog,
      priority: selectedTicketDraftPriority,
      requestedDeliveryDate: selectedTicketDraftRequestedDeliveryDate,
      status: selectedTicketDraftStatus,
    });

    isHydratingDraftRef.current = true;
    setReplyAttachments([]);
    // Rascunho salvo pode ser de antes do tipo/impacto existirem no draft;
    // o default do ticket preenche o que faltar.
    setDraft(persistedDraft ? { ...defaultDraft, ...persistedDraft } : defaultDraft);
  }, [
    selectedTicketDraftApprovedDeliveryDate,
    selectedTicketDraftCategory,
    selectedTicketDraftIsBacklog,
    selectedTicketDraftPriority,
    selectedTicketDraftProtocol,
    selectedTicketDraftRequestedDeliveryDate,
    selectedTicketDraftStatus,
  ]);

  useEffect(() => {
    if (isHydratingDraftRef.current) {
      isHydratingDraftRef.current = false;
      return;
    }

    if (!selectedTicketDraftProtocol || !selectedTicket) {
      return;
    }

    const defaultDraft = createDefaultTicketDraft({
      approvedDeliveryDate: selectedTicket.approvedDeliveryDate ?? null,
      category: selectedTicket.category ?? null,
      isBacklog: selectedTicket.roadmap?.active === true,
      priority: selectedTicket.priority ?? null,
      requestedDeliveryDate: selectedTicket.requestedDeliveryDate ?? null,
      status: selectedTicket.status,
    });

    writeStoredTicketDraft(selectedTicketDraftProtocol, draft, defaultDraft);
  }, [draft, selectedTicket, selectedTicketDraftProtocol]);

  useEffect(() => {
    if (!selectedProtocol || !accessToken) {
      return;
    }

    const detailProtocol = selectedProtocol;

    if (loadedDetailProtocols.includes(detailProtocol)) {
      return;
    }

    let isActiveRequest = true;

    async function loadSelectedTicketDetail() {
      setIsDetailLoading(true);

      try {
        const [ticketDetail] = await loadHubItTickets({
          accessToken,
          details: "full",
          protocol: detailProtocol,
          scope: "all",
        });

        if (!isActiveRequest || !ticketDetail) {
          return;
        }

        setTickets((currentTickets) =>
          upsertTicketWithDetails(currentTickets, ticketDetail),
        );
        setLoadedDetailProtocols((currentProtocols) =>
          currentProtocols.includes(detailProtocol)
            ? currentProtocols
            : [...currentProtocols, detailProtocol],
        );
      } catch (loadError) {
        if (!isActiveRequest) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Nao foi possivel carregar os detalhes do HelpDesk.",
        );
      } finally {
        if (isActiveRequest) {
          setIsDetailLoading(false);
        }
      }
    }

    void loadSelectedTicketDetail();

    return () => {
      isActiveRequest = false;
    };
  }, [accessToken, loadedDetailProtocols, selectedProtocol]);

  useEffect(() => {
    if (
      selectedProtocol &&
      !ticketsByDelivery.some((ticket) => ticket.protocol === selectedProtocol)
    ) {
      setSelectedProtocol(ticketsByDelivery[0]?.protocol ?? null);
    }
  }, [selectedProtocol, ticketsByDelivery]);

  async function saveReply(nextStatus: HubItTicketStatus = "em_tratativa") {
    if (!selectedTicket) {
      return;
    }

    const hasDeliveryDecision = draft.deliveryDecision !== "manter";
    const hasReclassification =
      draft.category !== selectedTicket.category ||
      draft.priority !== selectedTicket.priority;

    if (
      draft.deliveryDecision === "reject_with_new_date" &&
      !draft.approvedDeliveryDate
    ) {
      setError("Informe a nova data proposta.");
      return;
    }

    if (
      !draft.adminResponse.trim() &&
      !draft.resolutionSummary.trim() &&
      !hasDeliveryDecision &&
      !hasReclassification &&
      replyAttachments.length === 0
    ) {
      setError("Escreva uma devolutiva, resumo, decisao de data, reclassifique ou anexe uma evidencia.");
      return;
    }

    // Sem o resumo da resolucao o HelpDesk nao acumula conhecimento: o servidor
    // recusa, entao avisamos antes de mandar.
    const nextStage = getTicketWorkflowStageFromStatus(nextStatus);

    if (
      (nextStage === "validacao" || nextStage === "finalizado") &&
      !draft.resolutionSummary.trim() &&
      !selectedTicket.resolutionSummary?.trim()
    ) {
      setError(
        "Descreva a resolucao antes de enviar o ticket para validacao ou fecha-lo.",
      );
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const updatedTicket = await updateHubItTicket({
        accessToken,
        input: {
          adminResponse: draft.adminResponse,
          attachments:
            replyAttachments.length > 0 ? replyAttachments : undefined,
          approvedDeliveryDate:
            hasDeliveryDecision && draft.approvedDeliveryDate
              ? draft.approvedDeliveryDate
              : undefined,
          // So manda se o Zeus mudou a classificacao (poupa update a toa).
          category:
            draft.category !== selectedTicket.category
              ? draft.category
              : undefined,
          deliveryDecision:
            draft.deliveryDecision === "manter"
              ? undefined
              : draft.deliveryDecision,
          deliveryDecisionNote: hasDeliveryDecision
            ? draft.deliveryDecisionNote
            : undefined,
          priority:
            draft.priority !== selectedTicket.priority
              ? draft.priority
              : undefined,
          protocol: selectedTicket.protocol,
          resolutionSummary: draft.resolutionSummary,
          status: nextStatus,
        },
      });

      setTickets((currentTickets) =>
        currentTickets.map((ticket) =>
          ticket.id === updatedTicket.id ? updatedTicket : ticket,
        ),
      );
      setSelectedProtocol(updatedTicket.protocol);
      setReplyAttachments([]);
      setLoadedDetailProtocols((currentProtocols) =>
        currentProtocols.includes(updatedTicket.protocol)
          ? currentProtocols
          : [...currentProtocols, updatedTicket.protocol],
      );
      clearStoredTicketDraft(updatedTicket.protocol);
      setDraft({
        ...emptyDraft,
        approvedDeliveryDate:
          updatedTicket.approvedDeliveryDate ??
          updatedTicket.requestedDeliveryDate ??
          "",
        category: updatedTicket.category,
        priority: updatedTicket.priority,
        status: updatedTicket.roadmap?.active
          ? "em_analise"
          : updatedTicket.status === "novo"
            ? "em_tratativa"
            : updatedTicket.status,
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Nao foi possivel salvar a devolutiva.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function openHistoryTicket(protocol: string) {
    setSelectedProtocol(protocol);
    setDetailModalProtocol(protocol);
  }

  function openBacklogForm(protocol: string) {
    setSelectedProtocol(protocol);
    setBacklogModalProtocol(protocol);
  }

  function openTicketDetail(protocol: string) {
    setSelectedProtocol(protocol);
    setDetailModalProtocol(protocol);
  }

  async function saveBacklog(input: HubItTicketBacklogInput) {
    if (!backlogModalTicket) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const updatedTicket = await updateHubItTicket({
        accessToken,
        input: {
          backlog: input,
          protocol: backlogModalTicket.protocol,
          status: "em_analise",
        },
      });

      setTickets((currentTickets) =>
        currentTickets.map((ticket) =>
          ticket.id === updatedTicket.id ? updatedTicket : ticket,
        ),
      );
      setSelectedProtocol(updatedTicket.protocol);
      setBacklogModalProtocol(null);
      setLoadedDetailProtocols((currentProtocols) =>
        currentProtocols.includes(updatedTicket.protocol)
          ? currentProtocols
          : [...currentProtocols, updatedTicket.protocol],
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Nao foi possivel mover o ticket para Backlog.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (!accessToken) {
    return (
      <Surface bordered className="border-amber-100 bg-amber-50 p-5">
        <div className="flex items-center gap-3 text-sm font-semibold text-amber-800">
          <AlertTriangle className="size-4" />
          Sessao ausente para abrir o HelpDesk.
        </div>
      </Surface>
    );
  }

  return (
    <section className="min-w-0">
      <Surface
        bordered
        className="overflow-x-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        <HelpDeskBoardToolbar
          activeTickets={activeQueueTickets.length}
          deliveryBuckets={deliveryBuckets}
          deliveryFilter={deliveryFilter}
          historyTickets={historyTickets.length}
          isDatesExpanded={isQueueDatesExpanded}
          isLoading={isLoading}
          onClearQueueFilters={() => setQueueFilters(emptyQueueFilters)}
          onDeliveryFilterChange={setDeliveryFilter}
          onOpenPoAi={onOpenPoAi}
          onQueueDisplayModeChange={setQueueDisplayMode}
          onQueueFilterChange={setQueueFilters}
          onRefresh={() => void refreshTickets()}
          onSearchChange={setSearchQuery}
          onToggleDates={() =>
            setIsQueueDatesExpanded((currentValue) => !currentValue)
          }
          onViewChange={setQueueView}
          searchQuery={searchQuery}
          queueDisplayMode={queueDisplayMode}
          queueFilterOptions={queueFilterOptions}
          queueFilters={queueFilters}
          selectedView={queueView}
          totalTickets={tickets.length}
          workflowCounts={workflowCounts}
        />

        {error ? <OperationalErrorBanner message={error} /> : null}

        <HelpDeskAttachmentMigrationCard accessToken={accessToken} />

        {queueView === "gestao" ? (
          <HelpDeskManagementPanel
            onOpenTicket={(ticket) => openTicketDetail(ticket.protocol)}
            onOpenTicketGroup={(title, groupTickets, groupBy) =>
              setInsightModal({ groupBy, tickets: groupTickets, title })
            }
            setupUsersError={setupUsersError}
            setupUsersStatus={setupUsersStatus}
            stats={managementStats}
          />
        ) : (
          <TicketQueueContent
            departmentByTicketProtocol={managementStats.departmentByTicketProtocol}
            displayMode={queueView === "fila" ? queueDisplayMode : "lista"}
            emptyView={queueView}
            onSelectTicket={
              queueView === "historico" ? openHistoryTicket : openTicketDetail
            }
            selectedProtocol={selectedTicket?.protocol ?? null}
            tickets={ticketsByDelivery}
            title={queueView === "historico" ? "Historico" : "Desk"}
          />
        )}
      </Surface>
      {detailModalTicket ? (
        <TicketDetailModal
          accessToken={accessToken}
          draft={draft}
          isDetailLoading={isDetailLoading}
          isSaving={isSaving}
          onClose={() => setDetailModalProtocol(null)}
          onDraftChange={setDraft}
          onOpenBacklogForm={openBacklogForm}
          onReplyAttachmentsChange={setReplyAttachments}
          onSave={(nextStatus) => void saveReply(nextStatus)}
          replyAttachments={replyAttachments}
          ticket={detailModalTicket}
        />
      ) : null}
      {insightModal ? (
        <TicketInsightModal
          departmentByTicketProtocol={managementStats.departmentByTicketProtocol}
          groupBy={insightModal.groupBy}
          onClose={() => setInsightModal(null)}
          onOpenTicket={(ticket) => {
            setInsightModal(null);
            openTicketDetail(ticket.protocol);
          }}
          tickets={insightModal.tickets}
          title={insightModal.title}
        />
      ) : null}
      {backlogModalTicket ? (
        <BacklogFormModal
          isSaving={isSaving}
          onClose={() => setBacklogModalProtocol(null)}
          onSubmit={(input) => void saveBacklog(input)}
          ticket={backlogModalTicket}
        />
      ) : null}
      {attentionToast ? (
        <div className="fixed bottom-6 right-6 z-[70] max-w-sm rounded-xl border border-[#A07C3B]/25 bg-white p-4 text-sm font-semibold text-slate-800 shadow-2xl">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#101820] text-white">
              <MessageSquareReply className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="m-0 text-xs uppercase text-[#7A5E2C]">
                HelpDesk
              </p>
              <p className="m-0 mt-1 leading-5">{attentionToast}</p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OperationalErrorBanner({ message }: { message: string }) {
  const isMigrationPending = isHubItTicketsMigrationPendingMessage(message);
  const className = isMigrationPending
    ? "border-b border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800"
    : "border-b border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700";

  return <div className={className}>{message}</div>;
}

function TicketDetailModal({
  accessToken,
  draft,
  isDetailLoading,
  isSaving,
  onClose,
  onDraftChange,
  onOpenBacklogForm,
  onReplyAttachmentsChange,
  onSave,
  replyAttachments,
  ticket,
}: {
  accessToken: string | null;
  draft: TicketDraft;
  isDetailLoading: boolean;
  isSaving: boolean;
  onClose: () => void;
  onDraftChange: (draft: TicketDraft) => void;
  onOpenBacklogForm: (protocol: string) => void;
  onReplyAttachmentsChange: Dispatch<
    SetStateAction<HubItTicketAttachmentInput[]>
  >;
  onSave: (nextStatus: HubItTicketStatus) => void;
  replyAttachments: HubItTicketAttachmentInput[];
  ticket: HubItTicket;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#101820]/45 p-4">
      <button
        aria-label="Fechar detalhe do ticket"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div
        aria-modal="true"
        className="relative flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <p className="m-0 text-[0.68rem] font-semibold uppercase text-slate-500">
              Historico / detalhe
            </p>
            <p className="m-0 truncate font-mono text-sm font-semibold text-[#7A5E2C]">
              {ticket.protocol}
            </p>
          </div>
          <Tooltip content="Fechar" placement="left">
            <button
              aria-label="Fechar detalhe do ticket"
              className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-[#A07C3B]/30 hover:text-slate-950"
              onClick={onClose}
              type="button"
            >
              <X className="size-4" />
            </button>
          </Tooltip>
        </div>
        <div className="min-h-0 overflow-x-hidden overflow-y-auto">
          <TicketWorkspace
            accessToken={accessToken}
            draft={draft}
            isDetailLoading={isDetailLoading}
            isSaving={isSaving}
            onDraftChange={onDraftChange}
            onOpenBacklogForm={onOpenBacklogForm}
            onReplyAttachmentsChange={onReplyAttachmentsChange}
            onSave={onSave}
            replyAttachments={replyAttachments}
            ticket={ticket}
          />
        </div>
      </div>
    </div>
  );
}

function TicketInsightModal({
  departmentByTicketProtocol,
  groupBy,
  onClose,
  onOpenTicket,
  tickets,
  title,
}: {
  departmentByTicketProtocol: ReadonlyMap<string, string>;
  groupBy?: TicketInsightGroupMode;
  onClose: () => void;
  onOpenTicket: (ticket: HubItTicket) => void;
  tickets: HubItTicket[];
  title: string;
}) {
  const [filters, setFilters] = useState<ManagementPanelFilters>({
    category: "todos",
    collaborator: "todos",
    department: "todos",
    priority: "todos",
    query: "",
    workflow: "todos",
  });
  const filteredTickets = useMemo(
    () =>
      filterTicketsByManagementFilters(
        tickets,
        filters,
        departmentByTicketProtocol,
      ),
    [departmentByTicketProtocol, filters, tickets],
  );
  const groups = useMemo(
    () => (groupBy ? buildTicketInsightGroups(filteredTickets, groupBy) : []),
    [filteredTickets, groupBy],
  );
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const groupKeySignature = groups.map((group) => group.key).join("|");
  const collaboratorOptions = useMemo(
    () => buildManagementCollaboratorOptions(tickets),
    [tickets],
  );
  const categoryOptions = useMemo(
    () => buildManagementCategoryOptions(tickets),
    [tickets],
  );
  const departmentOptions = useMemo(
    () => buildManagementDepartmentOptions(tickets, departmentByTicketProtocol),
    [departmentByTicketProtocol, tickets],
  );
  const hasFilters =
    filters.category !== "todos" ||
    filters.collaborator !== "todos" ||
    filters.department !== "todos" ||
    filters.priority !== "todos" ||
    filters.query.trim().length > 0 ||
    filters.workflow !== "todos";
  const updateFilter = useCallback(
    <Key extends keyof ManagementPanelFilters>(
      key: Key,
      value: ManagementPanelFilters[Key],
    ) => {
      setFilters((currentFilters) => ({
        ...currentFilters,
        [key]: value,
      }));
    },
    [],
  );

  useEffect(() => {
    setFilters({
      category: "todos",
      collaborator: "todos",
      department: "todos",
      priority: "todos",
      query: "",
      workflow: "todos",
    });
  }, [title, tickets]);

  useEffect(() => {
    setExpandedGroups(new Set(groups.map((group) => group.key)));
  }, [groupKeySignature, groups]);

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-[#101820]/45 p-4">
      <button
        aria-label="Fechar lista de tickets"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div
        aria-modal="true"
        className="relative flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <p className="m-0 text-[0.68rem] font-semibold uppercase text-[#7A5E2C]">
              Indicador
            </p>
            <h3 className="m-0 truncate text-base font-semibold text-slate-950">
              {title}
            </h3>
          </div>
          <Tooltip content="Fechar" placement="left">
            <button
              aria-label="Fechar lista de tickets"
              className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-[#A07C3B]/30 hover:text-slate-950"
              onClick={onClose}
              type="button"
            >
              <X className="size-4" />
            </button>
          </Tooltip>
        </div>
        <div className="grid gap-3 border-b border-slate-100 bg-white px-4 py-3">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[1.2fr_repeat(5,minmax(0,0.82fr))]">
            <ManagementSearchInput
              label="Ticket"
              onChange={(value) => updateFilter("query", value)}
              placeholder="Ticket, assunto ou modulo"
              value={filters.query}
            />
            <QueueFilterSelect
              label="Workflow"
              onChange={(value) =>
                updateFilter(
                  "workflow",
                  value as ManagementPanelFilters["workflow"],
                )
              }
              value={filters.workflow}
            >
              <option value="todos">Todos</option>
              {workflowStageOptions.map((stage) => (
                <option key={stage} value={stage}>
                  {workflowStageLabels[stage]}
                </option>
              ))}
            </QueueFilterSelect>
            <QueueFilterSelect
              label="Prioridade"
              onChange={(value) =>
                updateFilter(
                  "priority",
                  value as ManagementPanelFilters["priority"],
                )
              }
              value={filters.priority}
            >
              <option value="todos">Todas</option>
              {priorityOptions.map((priority) => (
                <option key={priority} value={priority}>
                  {hubItTicketPriorityLabels[priority]}
                </option>
              ))}
            </QueueFilterSelect>
            <QueueFilterSelect
              label="Tipo"
              onChange={(value) =>
                updateFilter(
                  "category",
                  value as ManagementPanelFilters["category"],
                )
              }
              value={filters.category}
            >
              <option value="todos">Todos</option>
              {categoryOptions.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </QueueFilterSelect>
            <QueueFilterSelect
              label="Colaborador"
              onChange={(value) => updateFilter("collaborator", value)}
              value={filters.collaborator}
            >
              <option value="todos">Todos</option>
              {collaboratorOptions.map((collaborator) => (
                <option key={collaborator.key} value={collaborator.key}>
                  {collaborator.label}
                </option>
              ))}
            </QueueFilterSelect>
            <QueueFilterSelect
              label="Departamento"
              onChange={(value) => updateFilter("department", value)}
              value={filters.department}
            >
              <option value="todos">Todos</option>
              {departmentOptions.map((department) => (
                <option key={department.key} value={department.key}>
                  {department.label}
                </option>
              ))}
            </QueueFilterSelect>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
              {filteredTickets.length} ticket(s)
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {groups.length > 0 ? (
                <>
                  <button
                    className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:border-[#A07C3B]/30 hover:text-slate-950"
                    onClick={() =>
                      setExpandedGroups(new Set(groups.map((group) => group.key)))
                    }
                    type="button"
                  >
                    <ChevronDown className="size-3.5" />
                    Expandir
                  </button>
                  <button
                    className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:border-[#A07C3B]/30 hover:text-slate-950"
                    onClick={() => setExpandedGroups(new Set())}
                    type="button"
                  >
                    <ChevronUp className="size-3.5" />
                    Recolher
                  </button>
                </>
              ) : null}
              <button
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition ${
                  hasFilters
                    ? "cursor-pointer border-[#A07C3B]/30 bg-[#A07C3B]/10 text-[#7A5E2C] hover:border-[#A07C3B]/50"
                    : "cursor-default border-slate-200 bg-slate-50 text-slate-400"
                }`}
                disabled={!hasFilters}
                onClick={() =>
                  setFilters({
                    category: "todos",
                    collaborator: "todos",
                    department: "todos",
                    priority: "todos",
                    query: "",
                    workflow: "todos",
                  })
                }
                type="button"
              >
                <X className="size-3.5" />
                Limpar
              </button>
            </div>
          </div>
        </div>
        <div className="min-h-0 overflow-x-hidden overflow-y-auto p-4">
          {groups.length > 0 ? (
            <div className="grid gap-4">
              {groups.map((group) => {
                const isExpanded = expandedGroups.has(group.key);

                return (
                  <section
                    className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60"
                    key={group.key}
                  >
                    <button
                      className="flex w-full cursor-pointer items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2 text-left transition hover:bg-slate-50"
                      onClick={() =>
                        setExpandedGroups((currentGroups) => {
                          const nextGroups = new Set(currentGroups);

                          if (nextGroups.has(group.key)) {
                            nextGroups.delete(group.key);
                          } else {
                            nextGroups.add(group.key);
                          }

                          return nextGroups;
                        })
                      }
                      type="button"
                    >
                      <h4 className="m-0 truncate text-sm font-semibold text-slate-950">
                        {group.label}
                      </h4>
                      <span className="inline-flex items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                          {group.tickets.length}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="size-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="size-4 text-slate-400" />
                        )}
                      </span>
                    </button>
                    {isExpanded ? (
                      <div className="grid gap-2 p-2">
                        {sortTicketsByUpdatedAt(group.tickets).map((ticket) => (
                          <InsightTicketButton
                            departmentByTicketProtocol={
                              departmentByTicketProtocol
                            }
                            key={ticket.id}
                            onOpenTicket={onOpenTicket}
                            ticket={ticket}
                          />
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : filteredTickets.length > 0 ? (
            <div className="grid gap-2">
              {sortTicketsByUpdatedAt(filteredTickets).map((ticket) => (
                <InsightTicketButton
                  departmentByTicketProtocol={departmentByTicketProtocol}
                  key={ticket.id}
                  onOpenTicket={onOpenTicket}
                  ticket={ticket}
                />
              ))}
            </div>
          ) : (
            <div className="grid min-h-40 place-items-center text-center">
              <div>
                <Inbox className="mx-auto size-7 text-slate-300" />
                <p className="m-0 mt-2 text-sm font-semibold text-slate-500">
                  Nenhum ticket neste indicador.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InsightTicketButton({
  departmentByTicketProtocol,
  onOpenTicket,
  ticket,
}: {
  departmentByTicketProtocol: ReadonlyMap<string, string>;
  onOpenTicket: (ticket: HubItTicket) => void;
  ticket: HubItTicket;
}) {
  return (
    <button
      className="grid cursor-pointer gap-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-left transition hover:-translate-y-0.5 hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5 hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)] md:grid-cols-[7.5rem_minmax(0,1fr)_7rem_7rem_7rem] md:items-center"
      onClick={() => onOpenTicket(ticket)}
      type="button"
    >
      <span className="font-mono text-xs font-semibold text-[#7A5E2C]">
        {ticket.protocol}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-950">
          {ticket.title}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {ticket.requester.name} /{" "}
          {departmentByTicketProtocol.get(ticket.protocol) ??
            "Sem departamento"}{" "}
          /{" "}
          {normalizeTicketModuleLabel(ticket.roadmap?.module || ticket.module)}
        </span>
      </span>
      <StatusBadge status={ticket.status} ticket={ticket} />
      <Badge variant={priorityVariant(ticket.priority)}>
        {hubItTicketPriorityLabels[ticket.priority]}
      </Badge>
      <span className="text-xs font-medium text-slate-500">
        {formatDateShort(ticket.updatedAt)}
      </span>
    </button>
  );
}

function BacklogFormModal({
  isSaving,
  onClose,
  onSubmit,
  ticket,
}: {
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (input: HubItTicketBacklogInput) => void;
  ticket: HubItTicket;
}) {
  const [form, setForm] = useState<BacklogFormState>(() =>
    getBacklogFormInitialState(ticket),
  );

  useEffect(() => {
    setForm(getBacklogFormInitialState(ticket));
  }, [ticket]);

  const canSubmit = form.module.trim() && form.screen.trim();

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#101820]/50 p-4">
      <button
        aria-label="Fechar formulario de Backlog"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <form
        aria-label="Formulario de Backlog"
        className="relative w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();

          if (!canSubmit) {
            return;
          }

          onSubmit({
            module: form.module.trim(),
            note: form.note.trim() || undefined,
            priority: form.priority,
            screen: form.screen.trim(),
            type: form.type,
          });
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <p className="m-0 text-[0.68rem] font-semibold uppercase text-[#7A5E2C]">
              Backlog
            </p>
            <h3 className="m-0 mt-1 truncate text-base font-semibold text-slate-950">
              {ticket.protocol} / {ticket.title}
            </h3>
          </div>
          <Tooltip content="Fechar" placement="left">
            <button
              aria-label="Fechar formulario de Backlog"
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-[#A07C3B]/30 hover:text-slate-950"
              onClick={onClose}
              type="button"
            >
              <X className="size-4" />
            </button>
          </Tooltip>
        </div>
        <div className="grid gap-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Tipo
              </span>
              <select
                className={fieldClassName}
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    type: event.target.value as HubItTicketRoadmapType,
                  }))
                }
                value={form.type}
              >
                {roadmapTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {hubItTicketRoadmapTypeLabels[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Prioridade
              </span>
              <select
                className={fieldClassName}
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    priority: event.target.value as HubItTicket["priority"],
                  }))
                }
                value={form.priority}
              >
                {priorityOptions.map((priority) => (
                  <option key={priority} value={priority}>
                    {hubItTicketPriorityLabels[priority]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Modulo
              </span>
              <input
                className={fieldClassName}
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    module: event.target.value,
                  }))
                }
                value={form.module}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Tela / fluxo
              </span>
              <input
                className={fieldClassName}
                onChange={(event) =>
                  setForm((currentForm) => ({
                    ...currentForm,
                    screen: event.target.value,
                  }))
                }
                value={form.screen}
              />
            </label>
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Observacao
            </span>
            <textarea
              className={`${fieldClassName} min-h-24 resize-none py-2 leading-6`}
              onChange={(event) =>
                setForm((currentForm) => ({
                  ...currentForm,
                  note: event.target.value,
                }))
              }
              placeholder="Contexto para roadmap, impacto ou criterio futuro."
              value={form.note}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-600">
              {getBacklogTypeIcon(form.type)}
              <span className="truncate">
                {hubItTicketRoadmapTypeLabels[form.type]} /{" "}
                {hubItTicketPriorityLabels[form.priority]}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                disabled={isSaving}
                onClick={onClose}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#101820] px-3 text-xs font-semibold text-white transition hover:bg-[#1d2634] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSaving || !canSubmit}
                type="submit"
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Archive className="size-4" />
                )}
                Salvar Backlog
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function HelpDeskBoardToolbar({
  activeTickets,
  deliveryBuckets,
  deliveryFilter,
  historyTickets,
  isDatesExpanded,
  isLoading,
  onClearQueueFilters,
  onOpenPoAi,
  onDeliveryFilterChange,
  onQueueDisplayModeChange,
  onQueueFilterChange,
  onRefresh,
  onSearchChange,
  onToggleDates,
  onViewChange,
  queueDisplayMode,
  queueFilterOptions,
  queueFilters,
  searchQuery,
  selectedView,
  totalTickets,
  workflowCounts,
}: {
  activeTickets: number;
  deliveryBuckets: {
    folga: number;
    hoje: number;
    proximos: number;
    semData: number;
  };
  deliveryFilter: DeliveryFilter;
  historyTickets: number;
  isDatesExpanded: boolean;
  isLoading: boolean;
  onClearQueueFilters: () => void;
  onOpenPoAi?: () => void;
  onDeliveryFilterChange: (filter: DeliveryFilter) => void;
  onQueueDisplayModeChange: (mode: TicketQueueDisplayMode) => void;
  onQueueFilterChange: (filters: TicketQueueFilters) => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onToggleDates: () => void;
  onViewChange: (view: TicketQueueView) => void;
  queueDisplayMode: TicketQueueDisplayMode;
  queueFilterOptions: TicketQueueFilterOptions;
  queueFilters: TicketQueueFilters;
  searchQuery: string;
  selectedView: TicketQueueView;
  totalTickets: number;
  workflowCounts: Record<TicketWorkflowStage, number>;
}) {
  const hasQueueFilters = hasActiveQueueFilters(queueFilters);
  const tabs = [
    {
      count: totalTickets,
      icon: <BarChart3 className="size-4" />,
      id: "gestao",
      label: "Gestao",
    },
    {
      count: activeTickets,
      icon: <Inbox className="size-4" />,
      id: "fila",
      label: "Desk",
    },
    {
      count: historyTickets,
      icon: <History className="size-4" />,
      id: "historico",
      label: "Historico",
    },
  ] as const satisfies readonly {
    count: number;
    icon: ReactNode;
    id: TicketQueueView;
    label: string;
  }[];

  return (
    <div className="border-b border-slate-200/70 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="m-0 text-[0.68rem] font-semibold uppercase text-[#7A5E2C]">
            Zeus HelpDesk
          </p>
          <h2 className="m-0 mt-1 text-base font-semibold text-slate-950">
            {selectedView === "gestao"
              ? "Gestao executiva"
              : selectedView === "historico"
                ? "Historico de tickets"
                : "Desk"}
          </h2>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          <label className="flex h-9 w-full min-w-56 max-w-md items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.03)] focus-within:border-[#A07C3B]/45 focus-within:ring-2 focus-within:ring-[#A07C3B]/10">
            <Search className="size-4 shrink-0 text-slate-400" />
            <input
              aria-label="Buscar ticket, colaborador, modulo ou assunto"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Ticket, colaborador, modulo ou assunto"
              type="search"
              value={searchQuery}
            />
            {searchQuery.trim() ? (
              <button
                aria-label="Limpar busca"
                className="grid size-6 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                onClick={() => onSearchChange("")}
                type="button"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </label>
          {onOpenPoAi ? (
            <Tooltip content="PO AI" placement="bottom">
              <button
                aria-label="Abrir PO AI"
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#A07C3B]/25 bg-white text-[#7A5E2C] transition hover:border-[#A07C3B]/40 hover:bg-[#A07C3B]/5"
                onClick={onOpenPoAi}
                type="button"
              >
                <Sparkles className="size-4" />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip content="Atualizar HelpDesk" placement="bottom">
            <button
              aria-label="Atualizar HelpDesk"
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-[#A07C3B]/25 hover:text-slate-950"
              onClick={onRefresh}
              type="button"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
          {tabs.map((tab) => (
            <button
              className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold transition ${
                selectedView === tab.id
                  ? "bg-[#101820] text-white shadow-sm"
                  : "text-slate-600 hover:bg-white hover:text-slate-950"
              }`}
              key={tab.id}
              onClick={() => onViewChange(tab.id)}
              type="button"
            >
              <span
                className={
                  selectedView === tab.id ? "text-[#D7B46A]" : "text-slate-400"
                }
              >
                {tab.icon}
              </span>
              {tab.label}
              <span
                className={`rounded-full px-1.5 py-0.5 font-mono text-[0.65rem] ${
                  selectedView === tab.id
                    ? "bg-white/12 text-white"
                    : "bg-white text-slate-500 ring-1 ring-slate-200"
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {selectedView === "fila" ? (
          <div className="flex flex-wrap items-center gap-2">
            <QueueSummaryPill
              label="backlog"
              value={workflowCounts.backlog}
            />
            <QueueSummaryPill
              label="hoje"
              tone="danger"
              value={deliveryBuckets.hoje}
            />
            <QueueSummaryPill
              label="validacao"
              tone="success"
              value={workflowCounts.validacao}
            />
            <button
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:border-[#A07C3B]/25 hover:text-slate-950"
              onClick={onToggleDates}
              type="button"
            >
              Entrega
              {isDatesExpanded ? (
                <ChevronUp className="size-3.5" />
              ) : (
                <ChevronDown className="size-3.5" />
              )}
            </button>
          </div>
        ) : null}
      </div>

      {selectedView === "fila" && isDatesExpanded ? (
        <div className="grid gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-3 sm:grid-cols-5">
          <DeliveryFilterButton
            active={deliveryFilter === "todos"}
            label={`Todos ${activeTickets}`}
            onClick={() => onDeliveryFilterChange("todos")}
          />
          <DeliveryFilterButton
            active={deliveryFilter === "hoje"}
            label={`Hoje ${deliveryBuckets.hoje}`}
            onClick={() => onDeliveryFilterChange("hoje")}
            tone="danger"
          />
          <DeliveryFilterButton
            active={deliveryFilter === "proximos"}
            label={`1-2 dias ${deliveryBuckets.proximos}`}
            onClick={() => onDeliveryFilterChange("proximos")}
            tone="warning"
          />
          <DeliveryFilterButton
            active={deliveryFilter === "folga"}
            label={`3+ dias ${deliveryBuckets.folga}`}
            onClick={() => onDeliveryFilterChange("folga")}
            tone="success"
          />
          <DeliveryFilterButton
            active={deliveryFilter === "sem_data"}
            label={`Sem data ${deliveryBuckets.semData}`}
            onClick={() => onDeliveryFilterChange("sem_data")}
          />
        </div>
      ) : null}

      {selectedView === "fila" ? (
        <div className="grid gap-3 border-t border-slate-100 bg-white px-4 py-3 xl:grid-cols-[auto_minmax(0,1fr)] xl:items-center">
          <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-1">
            <QueueModeButton
              active={queueDisplayMode === "lista"}
              icon={<ClipboardList className="size-3.5" />}
              label="Lista"
              onClick={() => onQueueDisplayModeChange("lista")}
            />
            <QueueModeButton
              active={queueDisplayMode === "kanban"}
              icon={<Square className="size-3.5" />}
              label="Kanban"
              onClick={() => onQueueDisplayModeChange("kanban")}
            />
            <QueueModeButton
              active={queueDisplayMode === "calendario"}
              icon={<CalendarDays className="size-3.5" />}
              label="Calendario"
              onClick={() => onQueueDisplayModeChange("calendario")}
            />
          </div>

          <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
            <QueueFilterSelect
              label="Workflow"
              onChange={(value) =>
                onQueueFilterChange({
                  ...queueFilters,
                  workflow: value as TicketQueueFilters["workflow"],
                })
              }
              value={queueFilters.workflow}
            >
              <option value="todos">Todos</option>
              {(
                [
                  "backlog",
                  "novo",
                  "tratativa",
                  "validacao",
                  "revisao",
                ] as const satisfies readonly TicketWorkflowStage[]
              ).map((stage) => (
                <option key={stage} value={stage}>
                  {workflowStageLabels[stage]} ({workflowCounts[stage]})
                </option>
              ))}
            </QueueFilterSelect>
            <QueueFilterSelect
              label="Prioridade"
              onChange={(value) =>
                onQueueFilterChange({
                  ...queueFilters,
                  priority: value as TicketQueueFilters["priority"],
                })
              }
              value={queueFilters.priority}
            >
              <option value="todos">Todas</option>
              {priorityOptions.map((priority) => (
                <option key={priority} value={priority}>
                  {hubItTicketPriorityLabels[priority]}
                </option>
              ))}
            </QueueFilterSelect>
            <QueueFilterSelect
              label="Departamento"
              onChange={(value) =>
                onQueueFilterChange({
                  ...queueFilters,
                  department: value,
                })
              }
              value={queueFilters.department}
            >
              <option value="todos">Todos</option>
              {queueFilterOptions.departments.map((department) => (
                <option key={department.key} value={department.key}>
                  {department.label} ({department.count})
                </option>
              ))}
            </QueueFilterSelect>
            <QueueFilterSelect
              label="Colaborador"
              onChange={(value) =>
                onQueueFilterChange({
                  ...queueFilters,
                  collaborator: value,
                })
              }
              value={queueFilters.collaborator}
            >
              <option value="todos">Todos</option>
              {queueFilterOptions.collaborators.map((collaborator) => (
                <option key={collaborator.key} value={collaborator.key}>
                  {collaborator.label} ({collaborator.count})
                </option>
              ))}
            </QueueFilterSelect>
            <button
              className={`inline-flex h-9 items-center justify-center gap-2 self-end rounded-lg border px-3 text-xs font-semibold transition ${
                hasQueueFilters
                  ? "cursor-pointer border-[#A07C3B]/30 bg-[#A07C3B]/10 text-[#7A5E2C] hover:border-[#A07C3B]/50"
                  : "cursor-default border-slate-200 bg-slate-50 text-slate-400"
              }`}
              disabled={!hasQueueFilters}
              onClick={onClearQueueFilters}
              type="button"
            >
              <X className="size-3.5" />
              Limpar filtros
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function QueueModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${
        active
          ? "bg-[#101820] text-white shadow-sm"
          : "text-slate-600 hover:bg-white hover:text-slate-950"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className={active ? "text-[#D7B46A]" : "text-slate-400"}>
        {icon}
      </span>
      {label}
    </button>
  );
}

function QueueFilterSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-[0.66rem] font-semibold uppercase text-slate-500">
        {label}
      </span>
      <select
        className="h-9 w-full min-w-0 cursor-pointer rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 outline-none transition hover:border-[#A07C3B]/30 focus:border-[#A07C3B]/50 focus:ring-2 focus:ring-[#A07C3B]/10"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function ManagementSearchInput({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[0.66rem] font-semibold uppercase text-slate-500">
        {label}
      </span>
      <span className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 transition focus-within:border-[#A07C3B]/50 focus-within:ring-2 focus-within:ring-[#A07C3B]/10">
        <Search className="size-3.5 shrink-0 text-slate-400" />
        <input
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xs font-semibold outline-none placeholder:text-slate-400"
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type="search"
          value={value}
        />
        {value.trim() ? (
          <button
            aria-label="Limpar filtro"
            className="grid size-5 shrink-0 place-items-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={() => onChange("")}
            type="button"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </span>
    </label>
  );
}

function HelpDeskManagementPanel({
  onOpenTicketGroup,
  onOpenTicket,
  setupUsersError,
  setupUsersStatus,
  stats,
}: {
  onOpenTicketGroup: (
    title: string,
    tickets: HubItTicket[],
    groupBy?: TicketInsightGroupMode,
  ) => void;
  onOpenTicket: (ticket: HubItTicket) => void;
  setupUsersError: string | null;
  setupUsersStatus: SetupUsersStatus;
  stats: TicketManagementStats;
}) {
  const departmentStatus =
    setupUsersStatus === "ready"
      ? "Departamentos do Setup"
      : setupUsersStatus === "loading"
        ? "Carregando departamentos"
        : setupUsersStatus === "error"
          ? "Departamento parcial"
          : "Aguardando departamentos";
  const resolutionRate =
    stats.total > 0 ? Math.round((stats.finalized / stats.total) * 100) : 0;
  const leadingDepartment = stats.departments[0];
  const leadingModule = stats.modules[0];
  const firstResponseLabel = formatHoursKpi(stats.firstResponseAverageHours);
  const resolutionLabel = formatHoursKpi(stats.resolutionAverageHours);

  return (
    <div className="bg-slate-50/50 p-4 xl:p-5">
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <ExecutiveKpi
          label="Hoje"
          supporting={`${stats.repliedTodayTickets.length} respondido(s)`}
          value={`${stats.createdTodayTickets.length} novo(s)`}
        />
        <ExecutiveKpi
          label="Primeira resposta"
          supporting="media dos tickets com resposta"
          value={firstResponseLabel}
        />
        <ExecutiveKpi
          label="Resolucao"
          supporting={`${stats.closedTodayTickets.length} fechado(s) hoje`}
          value={resolutionLabel}
        />
        <ExecutiveKpi
          label="Criticidade"
          supporting="alta ou critica"
          value={`${stats.highPriorityTickets.length}`}
        />
      </div>

      {setupUsersStatus !== "ready" ? (
        <div className="mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
          <Building2 className="size-4 text-[#A07C3B]" />
          {departmentStatus}
        </div>
      ) : null}

      {setupUsersError ? (
        <div className="mb-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
          {setupUsersError}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <ManagementMetricTile
          hint={`${stats.active} em fila`}
          icon={<ClipboardList className="size-4" />}
          label="Tickets"
          onClick={() => onOpenTicketGroup("Todos os tickets", stats.allTickets)}
          value={stats.total}
        />
        <ManagementMetricTile
          hint={`${resolutionRate}% do volume`}
          icon={<CheckCircle2 className="size-4" />}
          label="Finalizados"
          onClick={() =>
            onOpenTicketGroup("Tickets finalizados", stats.finalizedTickets)
          }
          tone="success"
          value={stats.finalized}
        />
        <ManagementMetricTile
          hint={`${stats.newTickets} novo(s), ${stats.review} revisao`}
          icon={<CircleDot className="size-4" />}
          label="Tratando"
          onClick={() =>
            onOpenTicketGroup("Tickets em tratamento", stats.treatmentTickets)
          }
          tone="warning"
          value={stats.inProgress}
        />
        <ManagementMetricTile
          hint={leadingDepartment?.department ?? "Sem departamento"}
          icon={<Building2 className="size-4" />}
          label="Maior area"
          onClick={() =>
            onOpenTicketGroup(
              leadingDepartment?.department ?? "Maior area",
              leadingDepartment?.tickets ?? [],
            )
          }
          value={leadingDepartment?.total ?? 0}
        />
        <ManagementMetricTile
          hint={leadingModule?.label ?? "Sem modulo"}
          icon={<Archive className="size-4" />}
          label="Roadmap"
          onClick={() =>
            onOpenTicketGroup("Tickets em Backlog", stats.backlogTickets)
          }
          value={stats.backlog}
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.36fr)]">
        <DailyVolumePanel dailyVolume={stats.dailyVolume} />
        <section className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="m-0 text-sm font-semibold text-slate-950">
              Performance
            </h4>
            <LineChart className="size-4 text-[#A07C3B]" />
          </div>
          <div className="grid gap-2">
            <PerformanceLine
              label="Tratados hoje"
              value={stats.repliedTodayTickets.length}
            />
            <PerformanceLine
              label="Fechados hoje"
              value={stats.closedTodayTickets.length}
            />
            <PerformanceLine
              label="Validação"
              value={stats.validation}
            />
          </div>
        </section>
      </div>

      <div className="mt-4 grid gap-4 2xl:grid-cols-2">
        <DepartmentDemandTable
          departments={stats.departments}
          onOpenDepartment={(department) =>
            onOpenTicketGroup(
              `Departamento: ${department.department}`,
              department.tickets,
              "collaborator",
            )
          }
        />
        <CollaboratorDemandTable
          collaborators={stats.collaborators}
          onOpenCollaborator={(collaborator) =>
            onOpenTicketGroup(
              `Colaborador: ${collaborator.label}`,
              collaborator.tickets,
              "category",
            )
          }
        />
      </div>

      <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="grid gap-4 xl:grid-cols-2">
          <DemandDimensionPanel
            items={stats.categories}
            onOpenItem={(item) =>
              onOpenTicketGroup(`Tipo: ${item.label}`, item.tickets, "workflow")
            }
            title="Tipos de demanda"
          />
          <DemandDimensionPanel
            items={stats.modules}
            onOpenItem={(item) =>
              onOpenTicketGroup(`Modulo: ${item.label}`, item.tickets, "workflow")
            }
            title="Modulos"
          />
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          <MeetingTicketDisclosure
            departmentByTicketProtocol={stats.departmentByTicketProtocol}
            emptyMessage="Sem finalizados."
            icon={<CheckCircle2 className="size-4" />}
            onOpenTicket={onOpenTicket}
            tickets={stats.doneTickets}
            title="Foi feito"
            tone="success"
          />
          <MeetingTicketDisclosure
            departmentByTicketProtocol={stats.departmentByTicketProtocol}
            emptyMessage="Sem tratamento."
            icon={<MessageSquareReply className="size-4" />}
            onOpenTicket={onOpenTicket}
            tickets={stats.meetingTreatmentTickets}
            title="Tratando"
            tone="warning"
          />
          <MeetingTicketDisclosure
            departmentByTicketProtocol={stats.departmentByTicketProtocol}
            emptyMessage="Sem Backlog."
            icon={<Archive className="size-4" />}
            onOpenTicket={onOpenTicket}
            tickets={stats.meetingBacklogTickets}
            title="Backlog"
          />
        </div>
      </div>
    </div>
  );
}

function ManagementMetricTile({
  hint,
  icon,
  label,
  onClick,
  tone = "neutral",
  value,
}: {
  hint: string;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  tone?: "neutral" | "success" | "warning";
  value: number;
}) {
  const toneClassName =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : tone === "warning"
        ? "bg-amber-50 text-amber-700 ring-amber-100"
        : "bg-slate-50 text-slate-700 ring-slate-200";

  return (
    <button
      className="rounded-lg border border-slate-200/70 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-[#A07C3B]/30 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)] disabled:hover:translate-y-0 disabled:hover:border-slate-200/70 disabled:hover:shadow-none"
      disabled={!onClick}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={`grid size-9 place-items-center rounded-lg ring-1 ${toneClassName}`}
        >
          {icon}
        </span>
        <span className="font-mono text-2xl font-semibold text-slate-950">
          {value}
        </span>
      </div>
      <p className="m-0 mt-3 text-xs font-semibold uppercase text-slate-500">
        {label}
      </p>
      <p className="m-0 mt-1 truncate text-xs text-slate-500">{hint}</p>
    </button>
  );
}

function ExecutiveKpi({
  label,
  supporting,
  value,
}: {
  label: string;
  supporting: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="m-0 text-[0.68rem] font-semibold uppercase text-slate-500">
        {label}
      </p>
      <p className="m-0 mt-2 text-lg font-semibold text-slate-950">{value}</p>
      <p className="m-0 mt-1 truncate text-xs text-slate-500">{supporting}</p>
    </div>
  );
}

function DailyVolumePanel({
  dailyVolume,
}: {
  dailyVolume: TicketDailyVolumeStats[];
}) {
  const maxValue = Math.max(
    1,
    ...dailyVolume.flatMap((item) => [
      item.created,
      item.treated,
      item.validation,
    ]),
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="m-0 text-sm font-semibold text-slate-950">
          Movimento por dia
        </h4>
        <Tooltip content="Recebidos, tratados e enviados para validacao nos ultimos dias.">
          <span className="grid size-6 place-items-center rounded-md text-slate-400">
            <LineChart className="size-4" />
          </span>
        </Tooltip>
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-[0.66rem] font-semibold uppercase text-slate-500">
        <ChartLegendDot className="bg-[#101820]" label="Recebido" />
        <ChartLegendDot className="bg-[#A07C3B]" label="Tratado" />
        <ChartLegendDot className="bg-emerald-500" label="Validacao" />
      </div>
      <div className="grid gap-2">
        {dailyVolume.map((item) => {
          const total = item.created + item.treated + item.validation;

          return (
            <div
              aria-label={`${formatDayLabel(item.day)}: ${item.created} recebido(s), ${item.treated} tratado(s), ${item.validation} em validacao`}
              className="group relative grid cursor-help gap-3 rounded-lg bg-slate-50 px-3 py-2 transition hover:bg-slate-100/80 lg:grid-cols-[4.8rem_minmax(0,1fr)_2.5rem] lg:items-center"
              key={item.day}
            >
              <div>
                <p className="m-0 text-[0.68rem] font-semibold text-slate-500">
                  {formatDayLabel(item.day)}
                </p>
                <p className="m-0 text-xs font-semibold text-slate-950">
                  {total}
                </p>
              </div>
              <div className="grid min-w-0 gap-1.5">
                <DailyVolumeBar
                  className="bg-[#101820]"
                  maxValue={maxValue}
                  value={item.created}
                />
                <DailyVolumeBar
                  className="bg-[#A07C3B]"
                  maxValue={maxValue}
                  value={item.treated}
                />
                <DailyVolumeBar
                  className="bg-emerald-500"
                  maxValue={maxValue}
                  value={item.validation}
                />
              </div>
              <span className="text-right font-mono text-xs font-semibold text-slate-500">
                {total}
              </span>
              <span className="pointer-events-none absolute left-20 top-2 z-20 rounded-lg bg-[#101820] px-3 py-2 text-[0.68rem] font-semibold text-white opacity-0 shadow-xl transition group-hover:opacity-100">
                {item.created} recebido(s), {item.treated} tratado(s),{" "}
                {item.validation} em validacao
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DailyVolumeBar({
  className,
  maxValue,
  value,
}: {
  className: string;
  maxValue: number;
  value: number;
}) {
  return (
    <span className="block h-2 overflow-hidden rounded-full bg-slate-200">
      <span
        className={`block h-full rounded-full ${className}`}
        style={{ width: getChartBarWidth(value, maxValue) }}
      />
    </span>
  );
}

function ChartLegendDot({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`size-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}

function PerformanceLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <span className="font-mono text-sm font-semibold text-slate-950">
        {value}
      </span>
    </div>
  );
}

function DepartmentDemandTable({
  departments,
  onOpenDepartment,
}: {
  departments: TicketDepartmentStats[];
  onOpenDepartment: (department: TicketDepartmentStats) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [filters, setFilters] = useState<ManagementPanelFilters>({
    category: "todos",
    collaborator: "todos",
    department: "todos",
    priority: "todos",
    query: "",
    workflow: "todos",
  });
  const collaboratorOptions = useMemo(
    () =>
      buildManagementCollaboratorOptions(
        departments.flatMap((department) => department.tickets),
      ),
    [departments],
  );
  const visibleDepartments = useMemo(
    () =>
      departments
        .map((department) =>
          summarizeDepartmentForTickets(
            department,
            filterTicketsByManagementFilters(department.tickets, filters),
          ),
        )
        .filter((department) => department.tickets.length > 0),
    [departments, filters],
  );
  const updateFilter = useCallback(
    <Key extends keyof ManagementPanelFilters>(
      key: Key,
      value: ManagementPanelFilters[Key],
    ) => {
      setFilters((currentFilters) => ({
        ...currentFilters,
        [key]: value,
      }));
    },
    [],
  );

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div>
          <h4 className="m-0 text-sm font-semibold text-slate-950">
            Tickets por departamento
          </h4>
        </div>
        <button
          className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:border-[#A07C3B]/30 hover:text-slate-950"
          onClick={() => setIsExpanded((currentValue) => !currentValue)}
          type="button"
        >
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[0.65rem]">
            {visibleDepartments.length}
          </span>
          {isExpanded ? "Recolher" : "Expandir"}
          {isExpanded ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>
      </div>
      {isExpanded ? (
        <>
          <div className="grid gap-2 border-b border-slate-100 bg-white px-3 py-3 md:grid-cols-4">
            <ManagementSearchInput
              label="Ticket"
              onChange={(value) => updateFilter("query", value)}
              placeholder="ticket ou assunto"
              value={filters.query}
            />
            <QueueFilterSelect
              label="Workflow"
              onChange={(value) =>
                updateFilter("workflow", value as ManagementPanelFilters["workflow"])
              }
              value={filters.workflow}
            >
              <option value="todos">Todos</option>
              {workflowStageOptions.map((stage) => (
                <option key={stage} value={stage}>
                  {workflowStageLabels[stage]}
                </option>
              ))}
            </QueueFilterSelect>
            <QueueFilterSelect
              label="Colaborador"
              onChange={(value) => updateFilter("collaborator", value)}
              value={filters.collaborator}
            >
              <option value="todos">Todos</option>
              {collaboratorOptions.map((collaborator) => (
                <option key={collaborator.key} value={collaborator.key}>
                  {collaborator.label}
                </option>
              ))}
            </QueueFilterSelect>
            <QueueFilterSelect
              label="Prioridade"
              onChange={(value) =>
                updateFilter("priority", value as ManagementPanelFilters["priority"])
              }
              value={filters.priority}
            >
              <option value="todos">Todas</option>
              {priorityOptions.map((priority) => (
                <option key={priority} value={priority}>
                  {hubItTicketPriorityLabels[priority]}
                </option>
              ))}
            </QueueFilterSelect>
          </div>
          <div
            className="hidden grid-cols-[minmax(10rem,1fr)_4rem_4rem_5rem_5rem_5rem_6rem_minmax(9rem,0.7fr)] gap-3 border-b border-slate-100 px-3 py-2 text-[0.68rem] font-semibold uppercase text-slate-500 xl:grid"
            role="row"
          >
            <span>Departamento</span>
            <span>Total</span>
            <span>Feitos</span>
            <span>Tratando</span>
            <span>Backlog</span>
            <span>Solic.</span>
            <span>Prioridade</span>
            <span>Ultimo</span>
          </div>
          {visibleDepartments.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {visibleDepartments.map((department) => (
                <button
                  className="grid w-full cursor-pointer gap-2 px-3 py-3 text-left text-sm transition hover:-translate-y-0.5 hover:bg-[#A07C3B]/5 hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)] xl:grid-cols-[minmax(10rem,1fr)_4rem_4rem_5rem_5rem_5rem_6rem_minmax(9rem,0.7fr)] xl:items-center xl:gap-3"
                  key={department.department}
                  onClick={() => onOpenDepartment(department)}
                  type="button"
                >
                  <span className="min-w-0 font-semibold text-slate-950">
                    <span className="block truncate">{department.department}</span>
                    <span className="mt-1 block text-xs font-medium text-slate-500 lg:hidden">
                      {department.total} total / {department.backlog} backlog /{" "}
                      {department.modules.slice(0, 2).join(", ") || "sem modulo"}
                    </span>
                  </span>
                  <MetricCell value={department.total} />
                  <MetricCell tone="success" value={department.finalized} />
                  <MetricCell tone="warning" value={department.inProgress} />
                  <MetricCell value={department.backlog} />
                  <MetricCell value={department.requesterCount} />
                  <MetricCell tone="danger" value={department.highPriority} />
                  {department.latestTicket ? (
                    <span className="min-w-0 rounded-lg px-2 py-1 text-left text-xs font-semibold text-[#7A5E2C]">
                      <span className="block truncate">
                        {department.latestTicket.protocol}
                      </span>
                      <span className="block truncate font-medium text-slate-500">
                        {formatDateShort(department.latestTicket.updatedAt)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">-</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid min-h-32 place-items-center px-4 py-8 text-center">
              <div>
                <Building2 className="mx-auto size-7 text-slate-300" />
                <p className="m-0 mt-2 text-sm font-semibold text-slate-500">
                  Sem departamentos para exibir.
                </p>
              </div>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function CollaboratorDemandTable({
  collaborators,
  onOpenCollaborator,
}: {
  collaborators: TicketCollaboratorStats[];
  onOpenCollaborator: (collaborator: TicketCollaboratorStats) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [filters, setFilters] = useState<ManagementPanelFilters>({
    category: "todos",
    collaborator: "todos",
    department: "todos",
    priority: "todos",
    query: "",
    workflow: "todos",
  });
  const categoryOptions = useMemo(
    () =>
      buildManagementCategoryOptions(
        collaborators.flatMap((collaborator) => collaborator.tickets),
      ),
    [collaborators],
  );
  const visibleCollaborators = useMemo(
    () =>
      collaborators
        .map((collaborator) =>
          summarizeCollaboratorForTickets(
            collaborator,
            filterTicketsByManagementFilters(collaborator.tickets, filters),
          ),
        )
        .filter((collaborator) => collaborator.tickets.length > 0),
    [collaborators, filters],
  );
  const updateFilter = useCallback(
    <Key extends keyof ManagementPanelFilters>(
      key: Key,
      value: ManagementPanelFilters[Key],
    ) => {
      setFilters((currentFilters) => ({
        ...currentFilters,
        [key]: value,
      }));
    },
    [],
  );

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center gap-2">
          <h4 className="m-0 text-sm font-semibold text-slate-950">
            Colaboradores
          </h4>
        </div>
        <button
          className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition hover:border-[#A07C3B]/30 hover:text-slate-950"
          onClick={() => setIsExpanded((currentValue) => !currentValue)}
          type="button"
        >
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-mono text-[0.65rem]">
            {visibleCollaborators.length}
          </span>
          {isExpanded ? "Recolher" : "Expandir"}
          {isExpanded ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>
      </div>
      {isExpanded ? (
        <>
          <div className="grid gap-2 border-b border-slate-100 bg-white px-3 py-3 md:grid-cols-4">
            <ManagementSearchInput
              label="Ticket"
              onChange={(value) => updateFilter("query", value)}
              placeholder="ticket ou assunto"
              value={filters.query}
            />
            <QueueFilterSelect
              label="Tipo"
              onChange={(value) =>
                updateFilter("category", value as ManagementPanelFilters["category"])
              }
              value={filters.category}
            >
              <option value="todos">Todos</option>
              {categoryOptions.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </QueueFilterSelect>
            <QueueFilterSelect
              label="Workflow"
              onChange={(value) =>
                updateFilter("workflow", value as ManagementPanelFilters["workflow"])
              }
              value={filters.workflow}
            >
              <option value="todos">Todos</option>
              {workflowStageOptions.map((stage) => (
                <option key={stage} value={stage}>
                  {workflowStageLabels[stage]}
                </option>
              ))}
            </QueueFilterSelect>
            <QueueFilterSelect
              label="Prioridade"
              onChange={(value) =>
                updateFilter("priority", value as ManagementPanelFilters["priority"])
              }
              value={filters.priority}
            >
              <option value="todos">Todas</option>
              {priorityOptions.map((priority) => (
                <option key={priority} value={priority}>
                  {hubItTicketPriorityLabels[priority]}
                </option>
              ))}
            </QueueFilterSelect>
          </div>
          <div
            className="hidden grid-cols-[minmax(14rem,1fr)_4rem_4rem_5rem_5rem_6rem_7rem_minmax(8rem,0.7fr)] gap-3 border-b border-slate-100 px-3 py-2 text-[0.68rem] font-semibold uppercase text-slate-500 xl:grid"
            role="row"
          >
            <span>Colaborador</span>
            <span>Total</span>
            <span>Feitos</span>
            <span>Tratando</span>
            <span>Backlog</span>
            <span>Prioridade</span>
            <span>Modulo</span>
            <span>Ultimo</span>
          </div>
          {visibleCollaborators.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {visibleCollaborators.slice(0, 12).map((collaborator) => (
                <button
                  className="grid w-full cursor-pointer gap-2 px-3 py-3 text-left transition hover:-translate-y-0.5 hover:bg-[#A07C3B]/5 hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)] xl:grid-cols-[minmax(14rem,1fr)_4rem_4rem_5rem_5rem_6rem_7rem_minmax(8rem,0.7fr)] xl:items-center"
                  key={collaborator.key}
                  onClick={() => onOpenCollaborator(collaborator)}
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <RequesterAvatar
                      requester={collaborator.requester}
                      size="xs"
                      variant="gold"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-950">
                        {collaborator.label}
                      </span>
                      <span className="block truncate text-xs font-medium text-slate-500">
                        {collaborator.department}
                      </span>
                    </span>
                  </span>
                  <MetricCell value={collaborator.total} />
                  <MetricCell tone="success" value={collaborator.finalized} />
                  <MetricCell tone="warning" value={collaborator.inProgress} />
                  <MetricCell value={collaborator.backlog} />
                  <MetricCell tone="danger" value={collaborator.highPriority} />
                  <span className="truncate text-xs font-semibold text-slate-600">
                    {collaborator.modules[0] ?? "Panteon"}
                  </span>
                  {collaborator.latestTicket ? (
                    <span className="min-w-0 text-xs font-semibold text-[#7A5E2C]">
                      <span className="block truncate">
                        {collaborator.latestTicket.protocol}
                      </span>
                      <span className="block truncate font-medium text-slate-500">
                        {formatDateShort(collaborator.latestTicket.updatedAt)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">-</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid min-h-32 place-items-center px-4 py-8 text-center">
              <div>
                <UserRound className="mx-auto size-7 text-slate-300" />
                <p className="m-0 mt-2 text-sm font-semibold text-slate-500">
                  Sem colaboradores para exibir.
                </p>
              </div>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function DemandDimensionPanel({
  items,
  onOpenItem,
  title,
}: {
  items: TicketDimensionStats[];
  onOpenItem?: (item: TicketDimensionStats) => void;
  title: string;
}) {
  const maxTotal = Math.max(1, ...items.map((item) => item.total));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h4 className="m-0 text-sm font-semibold text-slate-950">{title}</h4>
          <Tooltip content="Distribuicao do recorte atual." placement="top">
            <span className="grid size-6 place-items-center rounded-md text-slate-400">
              <BarChart3 className="size-4" />
            </span>
          </Tooltip>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
          {items.length}
        </span>
      </div>

      {items.length > 0 ? (
        <div className="grid gap-3">
          {items.slice(0, 7).map((item) => {
            const percentage = Math.max(6, Math.round((item.total / maxTotal) * 100));

            return (
              <button
                className="grid cursor-pointer gap-1.5 rounded-lg p-2 text-left transition hover:-translate-y-0.5 hover:bg-[#A07C3B]/5 hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
                key={item.key}
                onClick={() => onOpenItem?.(item)}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-semibold text-slate-800">
                    {item.label}
                  </span>
                  <span className="font-mono text-sm font-semibold text-slate-950">
                    {item.total}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-[#A07C3B]"
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 text-[0.68rem] font-semibold text-slate-500">
                  <span>{item.finalized} feitos</span>
                  <span>{item.inProgress} tratando</span>
                  <span>{item.backlog} backlog</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="m-0 rounded-lg bg-slate-50 px-3 py-4 text-center text-sm font-semibold text-slate-500">
          Sem dados para exibir.
        </p>
      )}
    </section>
  );
}

function MetricCell({
  tone = "neutral",
  value,
}: {
  tone?: "danger" | "neutral" | "success" | "warning";
  value: number;
}) {
  const className =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "bg-amber-50 text-amber-700"
        : tone === "danger"
          ? "bg-red-50 text-red-700"
          : "bg-slate-100 text-slate-700";

  return (
    <span
      className={`inline-flex h-7 w-fit min-w-8 items-center justify-center rounded-md px-2 text-xs font-semibold ${className}`}
    >
      {value}
    </span>
  );
}

function MeetingTicketDisclosure({
  departmentByTicketProtocol,
  emptyMessage,
  icon,
  onOpenTicket,
  tickets,
  title,
  tone = "neutral",
}: {
  departmentByTicketProtocol: ReadonlyMap<string, string>;
  emptyMessage: string;
  icon: ReactNode;
  onOpenTicket: (ticket: HubItTicket) => void;
  tickets: HubItTicket[];
  title: string;
  tone?: "neutral" | "success" | "warning";
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const iconClassName =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : tone === "warning"
        ? "bg-amber-50 text-amber-700 ring-amber-100"
        : "bg-slate-50 text-slate-700 ring-slate-200";

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <button
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-3 text-left transition hover:bg-[#A07C3B]/5"
        onClick={() => setIsExpanded((currentValue) => !currentValue)}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`grid size-8 shrink-0 place-items-center rounded-lg ring-1 ${iconClassName}`}
          >
            {icon}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-slate-950">
              {title}
            </span>
            <span className="block truncate text-xs font-medium text-slate-500">
              Clique para {isExpanded ? "ocultar" : "abrir"}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
            {tickets.length}
          </span>
          {isExpanded ? (
            <ChevronUp className="size-4 text-slate-400" />
          ) : (
            <ChevronDown className="size-4 text-slate-400" />
          )}
        </span>
      </button>
      {isExpanded ? (
        <div className="border-t border-slate-100 p-3">
          {tickets.length > 0 ? (
            <div className="grid gap-2">
              {tickets.map((ticket) => (
                <button
                  className="grid min-w-0 cursor-pointer gap-1 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-left transition hover:-translate-y-0.5 hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
                  key={ticket.id}
                  onClick={() => onOpenTicket(ticket)}
                  type="button"
                >
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs font-semibold text-[#7A5E2C]">
                      {ticket.protocol}
                    </span>
                    <StatusBadge status={ticket.status} ticket={ticket} />
                  </span>
                  <span className="truncate text-sm font-semibold text-slate-950">
                    {ticket.title}
                  </span>
                  <span className="truncate text-xs text-slate-500">
                    {departmentByTicketProtocol.get(ticket.protocol) ??
                      "Sem departamento"}{" "}
                    / {formatDateShort(ticket.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="m-0 rounded-lg bg-slate-50 px-3 py-4 text-center text-sm font-semibold text-slate-500">
              {emptyMessage}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function TicketQueueContent({
  departmentByTicketProtocol,
  displayMode,
  emptyView,
  onSelectTicket,
  selectedProtocol,
  tickets,
  title,
}: {
  departmentByTicketProtocol: ReadonlyMap<string, string>;
  displayMode: TicketQueueDisplayMode;
  emptyView: TicketQueueView;
  onSelectTicket: (protocol: string) => void;
  selectedProtocol: string | null;
  tickets: HubItTicket[];
  title: string;
}) {
  if (displayMode === "kanban" && emptyView === "fila") {
    return (
      <TicketWorkflowKanban
        onSelectTicket={onSelectTicket}
        selectedProtocol={selectedProtocol}
        tickets={tickets}
      />
    );
  }

  if (displayMode === "calendario" && emptyView === "fila") {
    return (
      <TicketDeliveryCalendar
        onSelectTicket={onSelectTicket}
        selectedProtocol={selectedProtocol}
        tickets={tickets}
      />
    );
  }

  return (
    <TicketOperationsTable
      departmentByTicketProtocol={departmentByTicketProtocol}
      emptyView={emptyView}
      onSelectTicket={onSelectTicket}
      selectedProtocol={selectedProtocol}
      tickets={tickets}
      title={title}
    />
  );
}

function TicketWorkflowKanban({
  onSelectTicket,
  selectedProtocol,
  tickets,
}: {
  onSelectTicket: (protocol: string) => void;
  selectedProtocol: string | null;
  tickets: HubItTicket[];
}) {
  const columns = (
    ["backlog", "novo", "tratativa", "validacao", "revisao"] as const
  ).map((stage) => ({
    stage,
    tickets: sortTicketsByDeliveryDate(
      tickets.filter((ticket) => getTicketWorkflowStage(ticket) === stage),
    ),
  }));

  return (
    <div className="bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 text-base font-semibold text-slate-950">
            Kanban da fila
          </h3>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {tickets.length} ticket(s)
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-5">
        {columns.map((column) => (
          <section
            className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70"
            key={column.stage}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
              <h4 className="m-0 text-sm font-semibold text-slate-950">
                {workflowStageLabels[column.stage]}
              </h4>
              <span className="rounded-full bg-white px-2 py-0.5 font-mono text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                {column.tickets.length}
              </span>
            </div>
            <div className="grid max-h-[34rem] gap-2 overflow-y-auto p-2">
              {column.tickets.length > 0 ? (
                column.tickets.map((ticket) => (
                  <TicketQueueCompactCard
                    isSelected={ticket.protocol === selectedProtocol}
                    key={ticket.id}
                    onSelectTicket={onSelectTicket}
                    ticket={ticket}
                  />
                ))
              ) : (
                <p className="m-0 rounded-lg border border-dashed border-slate-200 bg-white px-3 py-5 text-center text-xs font-semibold text-slate-400">
                  Sem tickets.
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function TicketDeliveryCalendar({
  onSelectTicket,
  selectedProtocol,
  tickets,
}: {
  onSelectTicket: (protocol: string) => void;
  selectedProtocol: string | null;
  tickets: HubItTicket[];
}) {
  const calendar = useMemo(() => buildTicketDeliveryCalendar(tickets), [tickets]);

  return (
    <div className="bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 text-base font-semibold text-slate-950">
            Calendario de entrega
          </h3>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {calendar.visibleCount} ticket(s)
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-7">
        {calendar.dateGroups.map((day) => (
          <section
            className={`min-h-44 rounded-xl border p-2 ${
              day.isToday
                ? "border-[#A07C3B]/35 bg-[#A07C3B]/5"
                : "border-slate-200 bg-slate-50/70"
            }`}
            key={day.key}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="m-0 text-[0.66rem] font-semibold uppercase text-slate-500">
                  {day.weekday}
                </p>
                <h4 className="m-0 text-sm font-semibold text-slate-950">
                  {day.label}
                </h4>
              </div>
              <span className="rounded-full bg-white px-2 py-0.5 font-mono text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                {day.tickets.length}
              </span>
            </div>
            <div className="grid gap-2">
              {day.tickets.slice(0, 4).map((ticket) => (
                <TicketCalendarItem
                  isSelected={ticket.protocol === selectedProtocol}
                  key={ticket.id}
                  onSelectTicket={onSelectTicket}
                  ticket={ticket}
                />
              ))}
              {day.tickets.length > 4 ? (
                <span className="rounded-lg bg-white px-2 py-1 text-center text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
                  +{day.tickets.length - 4} ticket(s)
                </span>
              ) : null}
              {day.tickets.length === 0 ? (
                <p className="m-0 rounded-lg border border-dashed border-slate-200 bg-white px-2 py-5 text-center text-xs font-semibold text-slate-400">
                  Sem entregas
                </p>
              ) : null}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-3 grid gap-3">
        {calendar.laterTickets.length > 0 ? (
          <CalendarSpecialLane
            label="Depois da semana"
            onSelectTicket={onSelectTicket}
            selectedProtocol={selectedProtocol}
            tickets={calendar.laterTickets}
          />
        ) : null}
        {calendar.noDateTickets.length > 0 ? (
          <CalendarSpecialLane
            label="Sem data"
            onSelectTicket={onSelectTicket}
            selectedProtocol={selectedProtocol}
            tickets={calendar.noDateTickets}
          />
        ) : null}
      </div>
      {calendar.visibleCount === 0 ? (
        <div className="grid min-h-36 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <p className="m-0 text-sm font-semibold text-slate-500">
            Sem entregas futuras no calendario.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function CalendarSpecialLane({
  label,
  onSelectTicket,
  selectedProtocol,
  tickets,
  tone = "neutral",
}: {
  label: string;
  onSelectTicket: (protocol: string) => void;
  selectedProtocol: string | null;
  tickets: HubItTicket[];
  tone?: "danger" | "neutral";
}) {
  return (
    <section
      className={`mb-3 rounded-xl border p-3 ${
        tone === "danger"
          ? "border-red-100 bg-red-50"
          : "border-slate-200 bg-slate-50/70"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4
          className={`m-0 text-sm font-semibold ${
            tone === "danger" ? "text-red-700" : "text-slate-950"
          }`}
        >
          {label}
        </h4>
        <span className="rounded-full bg-white px-2 py-0.5 font-mono text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
          {tickets.length}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {sortTicketsByDeliveryDate(tickets)
          .slice(0, 6)
          .map((ticket) => (
            <TicketCalendarItem
              isSelected={ticket.protocol === selectedProtocol}
              key={ticket.id}
              onSelectTicket={onSelectTicket}
              ticket={ticket}
            />
          ))}
      </div>
    </section>
  );
}

function TicketQueueCompactCard({
  isSelected,
  onSelectTicket,
  ticket,
}: {
  isSelected: boolean;
  onSelectTicket: (protocol: string) => void;
  ticket: HubItTicket;
}) {
  return (
    <button
      className={`grid cursor-pointer gap-2 rounded-lg border px-3 py-3 text-left transition hover:-translate-y-0.5 hover:border-[#A07C3B]/30 hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)] ${
        isSelected
          ? "border-[#A07C3B]/35 bg-[#A07C3B]/10"
          : "border-slate-200 bg-white"
      }`}
      onClick={() => onSelectTicket(ticket.protocol)}
      type="button"
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate font-mono text-xs font-semibold text-[#7A5E2C]">
          {ticket.protocol}
        </span>
        <Badge variant={priorityVariant(ticket.priority)}>
          {hubItTicketPriorityLabels[ticket.priority]}
        </Badge>
      </span>
      <span className="line-clamp-2 text-sm font-semibold text-slate-950">
        {ticket.title}
      </span>
      <span className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
        <RequesterAvatar requester={ticket.requester} size="xs" variant="gold" />
        <span className="min-w-0 truncate">{ticket.requester.name}</span>
      </span>
      <span className="grid gap-1 text-[0.68rem] font-semibold text-slate-500">
        <span>Recepcao {formatDateShort(ticket.createdAt)}</span>
        <span>
          Entrega{" "}
          {getTicketEffectiveDeliveryDate(ticket)
            ? formatDateOnly(getTicketEffectiveDeliveryDate(ticket) ?? "")
            : "sem data"}
        </span>
      </span>
    </button>
  );
}

function TicketCalendarItem({
  isSelected,
  onSelectTicket,
  ticket,
}: {
  isSelected: boolean;
  onSelectTicket: (protocol: string) => void;
  ticket: HubItTicket;
}) {
  return (
    <button
      className={`grid cursor-pointer gap-1 rounded-lg border px-2 py-2 text-left transition hover:-translate-y-0.5 hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5 ${
        isSelected
          ? "border-[#A07C3B]/35 bg-[#A07C3B]/10"
          : "border-slate-200 bg-white"
      }`}
      onClick={() => onSelectTicket(ticket.protocol)}
      type="button"
    >
      <span className="truncate font-mono text-[0.68rem] font-semibold text-[#7A5E2C]">
        {ticket.protocol}
      </span>
      <span className="line-clamp-2 text-xs font-semibold text-slate-950">
        {ticket.title}
      </span>
      <span className="truncate text-[0.66rem] font-medium text-slate-500">
        {ticket.requester.name}
      </span>
    </button>
  );
}

function TicketOperationsTable({
  departmentByTicketProtocol,
  emptyView,
  onSelectTicket,
  selectedProtocol,
  tickets,
  title,
}: {
  departmentByTicketProtocol: ReadonlyMap<string, string>;
  emptyView: TicketQueueView;
  onSelectTicket: (protocol: string) => void;
  selectedProtocol: string | null;
  tickets: HubItTicket[];
  title: string;
}) {
  const [sortKey, setSortKey] = useState<HistorySortKey>("updatedAt");
  const [sortDirection, setSortDirection] =
    useState<HistorySortDirection>("desc");
  const sortedTickets = useMemo(
    () =>
      sortHistoryTickets(
        tickets,
        sortKey,
        sortDirection,
        departmentByTicketProtocol,
      ),
    [departmentByTicketProtocol, sortDirection, sortKey, tickets],
  );
  const handleSort = useCallback((nextKey: HistorySortKey) => {
    setSortKey((currentKey) => {
      if (currentKey === nextKey) {
        setSortDirection((currentDirection) =>
          currentDirection === "asc" ? "desc" : "asc",
        );

        return currentKey;
      }

      setSortDirection(nextKey === "updatedAt" ? "desc" : "asc");

      return nextKey;
    });
  }, []);

  return (
    <div className="bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 text-base font-semibold text-slate-950">
            {title}
          </h3>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {tickets.length} ticket(s)
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div
          className="hidden grid-cols-[5.6rem_minmax(0,1.45fr)_6.5rem_minmax(0,0.65fr)_minmax(0,0.6fr)_minmax(0,0.58fr)_5rem_5.1rem_5.4rem_5.4rem] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[0.66rem] font-semibold uppercase text-slate-500 xl:grid"
          role="row"
        >
          <HistorySortHeader
            active={sortKey === "protocol"}
            direction={sortDirection}
            label="Ticket"
            onClick={() => handleSort("protocol")}
          />
          <HistorySortHeader
            active={sortKey === "title"}
            direction={sortDirection}
            label="Assunto"
            onClick={() => handleSort("title")}
          />
          <HistorySortHeader
            active={sortKey === "status"}
            direction={sortDirection}
            label="Workflow"
            onClick={() => handleSort("status")}
          />
          <HistorySortHeader
            active={sortKey === "collaborator"}
            direction={sortDirection}
            label="Colaborador"
            onClick={() => handleSort("collaborator")}
          />
          <HistorySortHeader
            active={sortKey === "department"}
            direction={sortDirection}
            label="Depto."
            onClick={() => handleSort("department")}
          />
          <HistorySortHeader
            active={sortKey === "module"}
            direction={sortDirection}
            label="Modulo"
            onClick={() => handleSort("module")}
          />
          <HistorySortHeader
            active={sortKey === "priority"}
            direction={sortDirection}
            label="Prioridade"
            onClick={() => handleSort("priority")}
          />
          <HistorySortHeader
            active={sortKey === "createdAt"}
            direction={sortDirection}
            label="Recepcao"
            onClick={() => handleSort("createdAt")}
          />
          <HistorySortHeader
            active={sortKey === "deliveryDate"}
            direction={sortDirection}
            label="Entrega"
            onClick={() => handleSort("deliveryDate")}
          />
          <HistorySortHeader
            active={sortKey === "updatedAt"}
            direction={sortDirection}
            label="Atualizacao"
            onClick={() => handleSort("updatedAt")}
          />
        </div>
        {sortedTickets.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {sortedTickets.map((ticket) => {
              const isSelected = ticket.protocol === selectedProtocol;
              const moduleLabel = normalizeTicketModuleLabel(
                ticket.roadmap?.module || ticket.module,
              );
              const departmentLabel =
                departmentByTicketProtocol.get(ticket.protocol) ??
                "Sem departamento";

              return (
                <button
                  className={`grid w-full cursor-pointer gap-2 px-3 py-3 text-left transition xl:grid-cols-[5.6rem_minmax(0,1.45fr)_6.5rem_minmax(0,0.65fr)_minmax(0,0.6fr)_minmax(0,0.58fr)_5rem_5.1rem_5.4rem_5.4rem] xl:items-center xl:gap-3 ${
                    isSelected
                      ? "bg-[#A07C3B]/10 text-slate-950"
                      : "bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  key={ticket.id}
                  onClick={() => onSelectTicket(ticket.protocol)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-semibold text-slate-950">
                      {ticket.protocol}
                    </span>
                    <span className="mt-1 block text-[0.68rem] font-semibold uppercase text-slate-400 xl:hidden">
                      {workflowStageLabels[getTicketWorkflowStage(ticket)]}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {ticket.title}
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {departmentLabel} / {moduleLabel} /{" "}
                      {hubItTicketCategoryLabels[ticket.category]}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <StatusBadge status={ticket.status} ticket={ticket} />
                  </span>
                  <span className="min-w-0 text-sm font-medium">
                    <span className="block truncate">{ticket.requester.name}</span>
                    <span className="mt-1 block truncate text-xs text-slate-400">
                      {ticket.assignedTo?.name ?? "Sem responsavel"}
                    </span>
                  </span>
                  <span className="truncate text-sm font-semibold text-slate-600">
                    {departmentLabel}
                  </span>
                  <span className="truncate text-sm font-semibold text-slate-600">
                    {moduleLabel}
                  </span>
                  <span>
                    <Badge variant={priorityVariant(ticket.priority)}>
                      {hubItTicketPriorityLabels[ticket.priority]}
                    </Badge>
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    {formatDateShort(ticket.createdAt)}
                  </span>
                  <DeliveryDateCell ticket={ticket} />
                  <span className="truncate text-xs font-medium text-slate-500">
                    {formatDateShort(ticket.updatedAt)}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-36 place-items-center px-4 py-8 text-center">
            <div>
              <History className="mx-auto size-7 text-slate-300" />
              <p className="m-0 mt-2 text-sm font-semibold text-slate-500">
                {emptyView === "historico"
                  ? "Historico vazio."
                  : "Nenhum ticket na fila."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DeliveryDateCell({ ticket }: { ticket: HubItTicket }) {
  const deliveryState = getTicketDeliveryDateTone(ticket);

  return (
    <Tooltip content={deliveryState.statusLabel} placement="top">
      <span
        className={`inline-flex w-fit rounded-lg px-2 py-1 text-left text-[0.68rem] font-semibold ring-1 ${deliveryState.className}`}
      >
        {deliveryState.dateLabel}
      </span>
    </Tooltip>
  );
}

function HistorySortHeader({
  active,
  direction,
  label,
  onClick,
}: {
  active: boolean;
  direction: HistorySortDirection;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={`Ordenar por ${label}`}
      className={`inline-flex items-center gap-1 text-left font-semibold uppercase transition ${
        active ? "text-[#7A5E2C]" : "text-slate-500 hover:text-slate-800"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
      <ArrowUpDown className="size-3" />
      {active ? (
        <span className="font-mono text-[0.58rem]">
          {direction === "asc" ? "ASC" : "DESC"}
        </span>
      ) : null}
    </button>
  );
}

function QueueSummaryPill({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "danger" | "neutral" | "success" | "warning";
  value: number | string;
}) {
  const toneClass = {
    danger: "bg-red-50 text-red-700 ring-red-100",
    neutral: "bg-slate-100 text-slate-700 ring-slate-200",
    success: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    warning: "bg-amber-50 text-amber-700 ring-amber-100",
  }[tone];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.68rem] font-semibold uppercase ring-1 ${toneClass}`}
    >
      <strong className="font-mono text-xs">{value}</strong>
      {label}
    </span>
  );
}

function TicketWorkspace({
  accessToken,
  draft,
  isDetailLoading,
  isSaving,
  onDraftChange,
  onOpenBacklogForm,
  onReplyAttachmentsChange,
  onSave,
  replyAttachments,
  ticket,
}: {
  accessToken: string | null;
  draft: TicketDraft;
  isDetailLoading: boolean;
  isSaving: boolean;
  onDraftChange: (draft: TicketDraft) => void;
  onOpenBacklogForm: (protocol: string) => void;
  onReplyAttachmentsChange: Dispatch<
    SetStateAction<HubItTicketAttachmentInput[]>
  >;
  onSave: (nextStatus: HubItTicketStatus) => void;
  replyAttachments: HubItTicketAttachmentInput[];
  ticket: HubItTicket;
}) {
  const [expandedSections, setExpandedSections] = useState<
    ReadonlySet<TicketWorkspaceSection>
  >(() => new Set(["delivery"]));

  useEffect(() => {
    setExpandedSections(new Set(["delivery"]));
  }, [ticket.protocol]);

  const isSectionExpanded = useCallback(
    (section: TicketWorkspaceSection) => expandedSections.has(section),
    [expandedSections],
  );
  const toggleSection = useCallback((section: TicketWorkspaceSection) => {
    setExpandedSections((currentSections) => {
      const nextSections = new Set(currentSections);

      if (nextSections.has(section)) {
        nextSections.delete(section);
      } else {
        nextSections.add(section);
      }

      return nextSections;
    });
  }, []);

  return (
    <div className="grid min-w-0 gap-4 overflow-x-hidden p-4 xl:p-5">
      <header className="grid gap-4 border-b border-slate-100 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-[#7A5E2C]">
                {ticket.protocol}
              </span>
              <StatusBadge status={ticket.status} ticket={ticket} />
              {ticket.roadmap?.active ? (
                <Badge variant="neutral">
                  {hubItTicketRoadmapTypeLabels[ticket.roadmap.type]} /{" "}
                  {hubItTicketPriorityLabels[ticket.roadmap.priority]}
                </Badge>
              ) : null}
              <Badge variant={priorityVariant(ticket.priority)}>
                {hubItTicketPriorityLabels[ticket.priority]}
              </Badge>
              {isDetailLoading ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[0.68rem] font-semibold text-slate-500">
                  <Loader2 className="size-3 animate-spin" />
                  detalhes
                </span>
              ) : null}
            </div>
            <h2 className="m-0 mt-2 text-xl font-semibold tracking-normal text-slate-950 xl:text-2xl">
              {ticket.title}
            </h2>
            <p className="m-0 mt-2 text-sm text-slate-500">
              {ticket.module} / aberto em {formatDateTime(ticket.createdAt)}
            </p>
          </div>
          <ClassificationEditor
            draft={draft}
            isSaving={isSaving}
            onDraftChange={onDraftChange}
            onSave={onSave}
            ticket={ticket}
          />
        </div>
        <WorkflowStepper ticket={ticket} />
        <CollapsiblePanel
          icon={<UserRound className="size-4" />}
          isExpanded={isSectionExpanded("context")}
          onToggle={() => toggleSection("context")}
          title="Contexto do atendimento"
        >
          <div className="grid gap-2 md:grid-cols-3">
            <DeliverySummaryCard ticket={ticket} />
            <UserSummaryCard
              label="Solicitante"
              user={ticket.requester}
              variant="dark"
            />
            <UserSummaryCard
              label="Tratando"
              user={ticket.assignedTo}
              fallback="Aguardando operador"
            />
          </div>
        </CollapsiblePanel>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.38fr)]">
        <div className="grid gap-4">
          <WorkspaceDisclosureBlock
            isExpanded={isSectionExpanded("description")}
            onToggle={() => toggleSection("description")}
            summary={getDetailPreview(ticket.userDescription)}
            title="Relato do usuario"
            visual={<RequesterAvatar requester={ticket.requester} size="xs" />}
          >
            <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {ticket.userDescription}
            </p>
          </WorkspaceDisclosureBlock>
          <DetailBlock
            icon={<Sparkles className="size-4" />}
            label="Leitura tecnica do Zeus"
            value={ticket.technicalSummary}
          />
          <AttachmentsPanel attachments={ticket.attachments} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <WorkspaceDisclosureBlock
              isExpanded={isSectionExpanded("expected")}
              onToggle={() => toggleSection("expected")}
              summary={getDetailPreview(ticket.expectedResult)}
              title="Como deveria funcionar"
              visual={<CheckCircle2 className="size-4" />}
            >
              <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {ticket.expectedResult || "Nao informado."}
              </p>
            </WorkspaceDisclosureBlock>
            <WorkspaceDisclosureBlock
              isExpanded={isSectionExpanded("actual")}
              onToggle={() => toggleSection("actual")}
              summary={getDetailPreview(ticket.actualResult)}
              title="O que ocorreu"
              visual={<AlertTriangle className="size-4" />}
            >
              <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {ticket.actualResult || "Nao informado."}
              </p>
            </WorkspaceDisclosureBlock>
          </div>
        </div>

        <aside className="grid content-start gap-4">
          <CollapsiblePanel
            icon={<CalendarDays className="size-4" />}
            isExpanded={isSectionExpanded("delivery")}
            onToggle={() => toggleSection("delivery")}
            title="Data de entrega"
          >
            <DeliveryDecisionPanel
              draft={draft}
              onDraftChange={onDraftChange}
              ticket={ticket}
            />
          </CollapsiblePanel>

          <TicketHistory isLoading={isDetailLoading} ticket={ticket} />

          <TicketReplyForm
            accessToken={accessToken}
            draft={draft}
            isSaving={isSaving}
            onDraftChange={onDraftChange}
            onOpenBacklogForm={() => onOpenBacklogForm(ticket.protocol)}
            onReplyAttachmentsChange={onReplyAttachmentsChange}
            onSave={onSave}
            replyAttachments={replyAttachments}
            ticket={ticket}
          />
        </aside>
      </div>
    </div>
  );
}

// Reclassificacao pelo Zeus, no cabecalho do detalhe. O tipo/impacto agora
// respeitam a escolha (o form parou de sobrescrever), mas quando a inferencia
// erra e o ticket ja esta aberto, o operador corrige aqui e salva na hora.
function ClassificationEditor({
  draft,
  isSaving,
  onDraftChange,
  onSave,
  ticket,
}: {
  draft: TicketDraft;
  isSaving: boolean;
  onDraftChange: (draft: TicketDraft) => void;
  onSave: (nextStatus: HubItTicketStatus) => void;
  ticket: HubItTicket;
}) {
  const changed =
    draft.category !== ticket.category || draft.priority !== ticket.priority;

  return (
    <div className="grid w-full gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:w-auto sm:min-w-[15rem]">
      <div className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase text-slate-500">
        <Sparkles className="size-3.5 text-[#A07C3B]" />
        Classificacao
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <ClassificationSelect
          label="Tipo"
          onChange={(value) =>
            onDraftChange({ ...draft, category: value as HubItTicketCategory })
          }
          options={hubItTicketCategoryLabels}
          value={draft.category}
        />
        <ClassificationSelect
          label="Impacto"
          onChange={(value) =>
            onDraftChange({ ...draft, priority: value as HubItTicketPriority })
          }
          options={hubItTicketPriorityLabels}
          value={draft.priority}
        />
      </div>
      {changed ? (
        <button
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-[#A07C3B] bg-[#A07C3B] px-3 text-xs font-semibold text-white transition hover:bg-[#8f6f35] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={isSaving}
          onClick={() => onSave(draft.status)}
          type="button"
        >
          <CheckCircle2 className="size-3.5" />
          Salvar classificacao
        </button>
      ) : null}
    </div>
  );
}

function ClassificationSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Record<string, string>;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-[0.68rem] font-semibold uppercase text-slate-500">
      {label}
      <select
        className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold normal-case text-slate-800 outline-none transition focus:border-[#A07C3B]/50"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {Object.entries(options).map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function DeliverySummaryCard({ ticket }: { ticket: HubItTicket }) {
  const effectiveDate = getTicketEffectiveDeliveryDate(ticket);
  const decisionLabel = getDeliveryDecisionLabel(ticket);

  return (
    <div className="flex min-w-[12rem] items-center gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
      <span className="grid size-10 place-items-center rounded-full bg-emerald-50 text-emerald-700">
        <CalendarDays className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="m-0 truncate text-xs font-semibold uppercase text-slate-500">
          Entrega
        </p>
        <p className="m-0 truncate text-sm font-semibold text-slate-950">
          {effectiveDate ? formatDateOnly(effectiveDate) : "Sem data"}
        </p>
        <p className="m-0 truncate text-xs text-slate-500">
          {decisionLabel}
        </p>
      </div>
    </div>
  );
}

function UserSummaryCard({
  fallback = "Sem responsavel",
  label,
  user,
  variant = "gold",
}: {
  fallback?: string;
  label: string;
  user: HubItTicket["assignedTo"] | HubItTicket["requester"];
  variant?: "dark" | "gold";
}) {
  return (
    <div className="flex min-w-[12rem] items-center gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
      <RequesterAvatar requester={user ?? null} size="md" variant={variant} />
      <div className="min-w-0">
        <p className="m-0 truncate text-xs font-semibold uppercase text-slate-500">
          {label}
        </p>
        <p className="m-0 truncate text-sm font-semibold text-slate-950">
          {user?.name ?? fallback}
        </p>
        <p className="m-0 truncate text-xs text-slate-500">
          {user?.email ?? "sem e-mail"}
        </p>
      </div>
    </div>
  );
}

function WorkflowStepper({ ticket }: { ticket: HubItTicket }) {
  const steps = [
    { id: "backlog", label: "Backlog" },
    { id: "novo", label: "Novo" },
    { id: "tratativa", label: "Em tratativa" },
    { id: "validacao", label: "Validacao" },
    { id: "revisao", label: "Revisao" },
    { id: "finalizado", label: "Finalizado" },
  ] as const satisfies readonly { id: TicketWorkflowStage; label: string }[];
  const activeStage = getTicketWorkflowStage(ticket);
  const activeIndex = Math.max(
    steps.findIndex((step) => step.id === activeStage),
    0,
  );

  return (
    <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {steps.map((step, index) => {
        const isDone = index < activeIndex || activeStage === "finalizado";
        const isActive = index === activeIndex && activeStage !== "finalizado";

        return (
          <div
            className={`min-w-0 rounded-lg border px-3 py-2 ${
              isDone
                ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                : isActive
                  ? "border-[#A07C3B]/30 bg-[#A07C3B]/10 text-[#7A5E2C]"
                  : "border-slate-200 bg-slate-50 text-slate-500"
            }`}
            key={step.id}
          >
            <p className="m-0 text-[0.68rem] font-semibold uppercase">
              {step.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function DeliveryDecisionPanel({
  draft,
  onDraftChange,
  ticket,
}: {
  draft: TicketDraft;
  onDraftChange: (draft: TicketDraft) => void;
  ticket: HubItTicket;
}) {
  const decisionStatus = ticket.deliveryDecisionStatus ?? "pendente";

  return (
    <div>
      <div className="flex justify-end">
        <DeliveryDueBadge ticket={ticket} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <InfoPill
          label="Solicitada"
          value={
            ticket.requestedDeliveryDate
              ? formatDateOnly(ticket.requestedDeliveryDate)
              : "sem data"
          }
        />
        <InfoPill
          label={decisionStatus === "reprogramada" ? "Nova" : "Aprovada"}
          value={
            ticket.approvedDeliveryDate
              ? formatDateOnly(ticket.approvedDeliveryDate)
              : "pendente"
          }
        />
      </div>

      <label className="mt-3 grid gap-1.5">
        <span className="text-xs font-semibold uppercase text-slate-500">
          Decisao
        </span>
        <select
          className={fieldClassName}
          onChange={(event) =>
            onDraftChange({
              ...draft,
              deliveryDecision: event.target
                .value as TicketDraft["deliveryDecision"],
            })
          }
          value={draft.deliveryDecision}
        >
          <option value="manter">Manter pendente</option>
          <option value="approve_requested">Aprovar data solicitada</option>
          <option value="reject_with_new_date">
            Rejeitar e propor nova data
          </option>
        </select>
      </label>

      {draft.deliveryDecision === "reject_with_new_date" ? (
        <label className="mt-3 grid gap-1.5">
          <span className="text-xs font-semibold uppercase text-slate-500">
            Nova data
          </span>
          <input
            className={fieldClassName}
            min={getTodayDateInput()}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                approvedDeliveryDate: event.target.value,
              })
            }
            type="date"
            value={draft.approvedDeliveryDate}
          />
        </label>
      ) : null}

      {draft.deliveryDecision !== "manter" ? (
        <label className="mt-3 grid gap-1.5">
          <span className="text-xs font-semibold uppercase text-slate-500">
            Observacao de prazo
          </span>
          <textarea
            className={`${fieldClassName} min-h-20 resize-none py-2 leading-5`}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                deliveryDecisionNote: event.target.value,
              })
            }
            placeholder="Explique o aceite ou a reprogramacao, se necessario."
            value={draft.deliveryDecisionNote}
          />
        </label>
      ) : null}

      {ticket.deliveryDecisionBy || ticket.deliveryDecisionAt ? (
        <p className="m-0 mt-3 text-xs leading-5 text-slate-500">
          Ultima decisao: {ticket.deliveryDecisionBy?.name ?? "Operador"} em{" "}
          {ticket.deliveryDecisionAt
            ? formatDateTime(ticket.deliveryDecisionAt)
            : "--"}
        </p>
      ) : null}
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="m-0 font-semibold uppercase text-slate-500">{label}</p>
      <p className="m-0 mt-1 font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function DetailBlock({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Surface bordered className="border-slate-200/70 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
        <span className="text-[#A07C3B]">{icon}</span>
        {label}
      </div>
      <p className="m-0 mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {value}
      </p>
    </Surface>
  );
}

function CollapsiblePanel({
  children,
  icon,
  isExpanded,
  onToggle,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <Surface bordered className="border-slate-200/70 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <span className="text-[#A07C3B]">{icon}</span>
          {title}
        </div>
        <Tooltip
          content={isExpanded ? `Recolher ${title}` : `Expandir ${title}`}
          placement="left"
        >
          <button
            aria-label={isExpanded ? `Recolher ${title}` : `Expandir ${title}`}
            className="grid size-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-[#A07C3B]/30 hover:text-slate-950"
            onClick={onToggle}
            type="button"
          >
            {isExpanded ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </button>
        </Tooltip>
      </div>
      {isExpanded ? <div className="mt-3">{children}</div> : null}
    </Surface>
  );
}

function WorkspaceDisclosureBlock({
  children,
  isExpanded,
  onToggle,
  summary,
  title,
  visual,
}: {
  children: ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  summary: string;
  title: string;
  visual: ReactNode;
}) {
  return (
    <Surface bordered className="border-slate-200/70 bg-white p-0">
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid shrink-0 place-items-center text-[#A07C3B]">
            {visual}
          </span>
          <div className="min-w-0">
            <p className="m-0 text-[0.68rem] font-semibold uppercase text-slate-500">
              {title}
            </p>
            <p className="m-0 mt-0.5 truncate text-xs font-medium text-slate-500">
              {summary}
            </p>
          </div>
        </div>
        <Tooltip
          content={isExpanded ? `Recolher ${title}` : `Expandir ${title}`}
          placement="left"
        >
          <button
            aria-label={isExpanded ? `Recolher ${title}` : `Expandir ${title}`}
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-[#A07C3B]/30 hover:text-slate-950"
            onClick={onToggle}
            type="button"
          >
            {isExpanded ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </button>
        </Tooltip>
      </div>
      {isExpanded ? (
        <div className="border-t border-slate-100 px-3 py-3">{children}</div>
      ) : null}
    </Surface>
  );
}

function TicketHistory({
  isLoading,
  ticket,
}: {
  isLoading: boolean;
  ticket: HubItTicket;
}) {
  return (
    <Surface bordered className="border-slate-200/70 bg-slate-50/70 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <History className="size-4 text-[#A07C3B]" />
          Timeline
        </div>
        {isLoading ? <Loader2 className="size-4 animate-spin text-slate-400" /> : null}
      </div>
      <div className="mt-3 grid max-h-[20rem] gap-2 overflow-y-auto pr-1">
        {ticket.events.length > 0 ? (
          ticket.events.map((event) => (
            <TicketHistoryEvent event={event} key={event.id} ticket={ticket} />
          ))
        ) : (
          <p className="m-0 text-sm text-slate-500">
            {isLoading ? "Carregando historico." : "Sem historico registrado."}
          </p>
        )}
      </div>
    </Surface>
  );
}

function TicketHistoryEvent({
  event,
  ticket,
}: {
  event: HubItTicket["events"][number];
  ticket: HubItTicket;
}) {
  const actor = getTicketHistoryActor(event, ticket);
  const isZeus = actor.kind === "zeus";
  const message = getTicketEventDisplayMessage(event);

  return (
    <div
      className={`flex gap-3 rounded-lg border px-3 py-2 text-xs leading-5 ${
        isZeus
          ? "border-[#101820]/10 bg-[#101820]/[0.03]"
          : "border-slate-200 bg-white"
      }`}
    >
      <RequesterAvatar requester={actor.user} size="xs" variant={actor.variant} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">
            {actor.user.name}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.62rem] font-semibold uppercase text-slate-500">
            {getTicketEventTypeLabel(event.type)}
          </span>
          <span className="font-mono text-[0.62rem] text-slate-400">
            {formatDateTime(event.createdAt)}
          </span>
        </div>
        <p className="m-0 mt-1 whitespace-pre-wrap text-slate-700">
          {message}
        </p>
      </div>
    </div>
  );
}

function getTicketEventDisplayMessage(event: HubItTicket["events"][number]) {
  const normalizedMessage = normalizeSearchText(event.message);

  if (
    event.type === "closed" &&
    (normalizedMessage.includes("finalizado automaticamente") ||
      normalizedMessage.includes("falta de retorno") ||
      normalizedMessage.includes("3 dias em validacao"))
  ) {
    return "Ticket encerrado";
  }

  return event.message;
}

function getTicketEventTypeLabel(eventType: HubItTicket["events"][number]["type"]) {
  if (eventType === "admin_reply") {
    return "resposta";
  }

  if (eventType === "attachment_added") {
    return "evidencia";
  }

  if (eventType === "closed") {
    return "fechamento";
  }

  if (eventType === "created") {
    return "abertura";
  }

  if (eventType === "resolved") {
    return "validacao";
  }

  if (eventType === "review_requested") {
    return "revisao";
  }

  if (eventType === "status_changed") {
    return "status";
  }

  if (eventType === "triaged") {
    return "triagem";
  }

  return "comentario";
}

function TicketReplyForm({
  accessToken,
  draft,
  isSaving,
  onDraftChange,
  onOpenBacklogForm,
  onReplyAttachmentsChange,
  onSave,
  replyAttachments,
  ticket,
}: {
  accessToken: string | null;
  draft: TicketDraft;
  isSaving: boolean;
  onDraftChange: (draft: TicketDraft) => void;
  onOpenBacklogForm: () => void;
  onReplyAttachmentsChange: Dispatch<
    SetStateAction<HubItTicketAttachmentInput[]>
  >;
  onSave: (nextStatus: HubItTicketStatus) => void;
  replyAttachments: HubItTicketAttachmentInput[];
  ticket: HubItTicket;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingTypeRef = useRef<HubItTicketAttachmentInput["type"]>("video");
  const recordingPrefixRef = useRef("gravacao");
  const [isMentionPickerOpen, setIsMentionPickerOpen] = useState(false);
  const [isMentionLoading, setIsMentionLoading] = useState(false);
  const [mentionError, setMentionError] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionUsers, setMentionUsers] = useState<MentionUser[]>([]);
  const [recordingKind, setRecordingKind] = useState<"audio" | "screen" | null>(
    null,
  );
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const filteredMentionUsers = useMemo(() => {
    const normalizedQuery = normalizeSearchText(mentionQuery);

    return mentionUsers
      .filter((user) => {
        if (!normalizedQuery) {
          return true;
        }

        return (
          normalizeSearchText(user.name).includes(normalizedQuery) ||
          normalizeSearchText(user.email ?? "").includes(normalizedQuery)
        );
      })
      .slice(0, 8);
  }, [mentionQuery, mentionUsers]);
  const loadMentionUsers = useCallback(async () => {
    if (!accessToken || isMentionLoading || mentionUsers.length > 0) {
      return;
    }

    setIsMentionLoading(true);
    setMentionError(null);

    try {
      const response = await fetch("/api/setup/users", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as
        | SetupUsersApiResponse
        | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel carregar usuarios.",
        );
      }

      setMentionUsers(parseMentionUsers(payload?.data));
    } catch (error) {
      setMentionError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel carregar usuarios.",
      );
    } finally {
      setIsMentionLoading(false);
    }
  }, [accessToken, isMentionLoading, mentionUsers.length]);
  const stopRecording = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    recordingChunksRef.current = [];
    recordingStartedAtRef.current = null;
    setRecordingKind(null);
  }, []);

  useEffect(() => {
    setEvidenceError(null);
    stopRecording();
  }, [stopRecording, ticket.protocol]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

  const replyStatus = isTicketBacklog(ticket) ? "em_analise" : "em_tratativa";
  const replyTooltip = isTicketBacklog(ticket)
    ? "Responder e manter no Backlog"
    : "Registrar devolutiva";
  const treatmentTooltip = isTicketBacklog(ticket)
    ? "Manter no Backlog"
    : "Manter em tratativa";

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    await addEvidenceFiles(files);
  }

  async function addEvidenceFiles(files: File[]) {
    const nextAttachments: HubItTicketAttachmentInput[] = [];

    for (const file of files) {
      if (file.size > maxReplyEvidenceBytes) {
        setEvidenceError("Arquivo acima de 6 MB.");
        continue;
      }

      nextAttachments.push(
        await createReplyAttachment(file, {
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      );
    }

    if (nextAttachments.length > 0) {
      onReplyAttachmentsChange((currentAttachments) => [
        ...currentAttachments,
        ...nextAttachments,
      ]);
      setEvidenceError(null);
    }
  }

  async function handleCapturePrint() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setEvidenceError("Captura de tela indisponivel neste navegador.");
      return;
    }

    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: true,
      });
      const video = document.createElement("video");

      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      const canvas = document.createElement("canvas");

      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas
        .getContext("2d")
        ?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png", 0.92),
      );

      if (!blob) {
        throw new Error("print-unavailable");
      }

      const attachment = await createReplyAttachment(blob, {
        fileName: `print-helpdesk-${formatEvidenceFileTime(new Date())}.png`,
        mimeType: "image/png",
        sizeBytes: blob.size,
        type: "image",
      });

      onReplyAttachmentsChange((currentAttachments) => [
        attachment,
        ...currentAttachments,
      ]);
      setEvidenceError(null);
    } catch {
      setEvidenceError("Nao foi possivel capturar o print.");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function handleToggleRecording(kind: "audio" | "screen") {
    if (recordingKind === kind) {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (recordingKind) {
      setEvidenceError("Finalize a gravacao atual antes de iniciar outra.");
      return;
    }

    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices) {
      setEvidenceError("Gravacao indisponivel neste navegador.");
      return;
    }

    try {
      const stream =
        kind === "audio"
          ? await navigator.mediaDevices.getUserMedia({ audio: true })
          : await navigator.mediaDevices.getDisplayMedia({
              audio: true,
              video: true,
            });
      const recorder = new MediaRecorder(stream);

      recordingChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      recordingTypeRef.current = kind === "audio" ? "audio" : "video";
      recordingPrefixRef.current = kind === "audio" ? "audio" : "video";
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        void finalizeRecording(recorder.mimeType);
      });

      recorder.start();
      setRecordingKind(kind);
      setEvidenceError(null);
    } catch {
      stopRecording();
      setEvidenceError(
        kind === "audio"
          ? "Permita o microfone para gravar audio."
          : "Permita a tela para gravar video.",
      );
    }
  }

  async function finalizeRecording(mimeType: string) {
    const durationSeconds = recordingStartedAtRef.current
      ? Math.max(
          1,
          Math.round((Date.now() - recordingStartedAtRef.current) / 1000),
        )
      : undefined;
    const type = recordingTypeRef.current;
    const blob = new Blob(recordingChunksRef.current, {
      type: mimeType || (type === "audio" ? "audio/webm" : "video/webm"),
    });

    stopRecording();

    if (blob.size > maxReplyEvidenceBytes) {
      setEvidenceError("Gravacao acima de 6 MB.");
      return;
    }

    try {
      const attachment = await createReplyAttachment(blob, {
        durationSeconds,
        fileName: `${recordingPrefixRef.current}-helpdesk-${formatEvidenceFileTime(new Date())}.webm`,
        mimeType: blob.type,
        sizeBytes: blob.size,
        type,
      });

      onReplyAttachmentsChange((currentAttachments) => [
        attachment,
        ...currentAttachments,
      ]);
      setEvidenceError(null);
    } catch {
      setEvidenceError("Nao foi possivel preparar a gravacao.");
    }
  }

  function insertMention(user: MentionUser) {
    const mention = `@${user.name}`;
    const nextResponse = draft.adminResponse.trimEnd()
      ? `${draft.adminResponse.trimEnd()} ${mention} `
      : `${mention} `;

    onDraftChange({
      ...draft,
      adminResponse: nextResponse,
    });
    setIsMentionPickerOpen(false);
    setMentionQuery("");
  }

  return (
    <Surface bordered className="border-slate-200/70 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <MessageSquareReply className="size-4 text-[#A07C3B]" />
          Devolutiva
        </div>
        <Tooltip content={replyTooltip} placement="left">
          <button
            aria-label={replyTooltip}
            className="grid size-9 place-items-center rounded-lg bg-[#101820] text-white transition hover:bg-[#1d2634] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            onClick={() => onSave(replyStatus)}
            type="button"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </button>
        </Tooltip>
      </div>
      <input
        accept="audio/*,image/*,video/*,.doc,.docx,.pdf,.ppt,.pptx,.xls,.xlsx,.txt"
        className="hidden"
        multiple
        onChange={(event) => void handleFileChange(event)}
        ref={fileInputRef}
        type="file"
      />
      <div className="mt-3 grid gap-1.5">
        <span className="flex items-center justify-between gap-2">
          <label
            className="text-xs font-semibold uppercase text-slate-500"
            htmlFor="ticket-admin-response"
          >
            Resposta para o usuario
          </label>
          <Tooltip content="Mencionar usuario cadastrado" placement="left">
            <button
              aria-label="Mencionar usuario cadastrado"
              className="inline-grid size-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-[#A07C3B]/30 hover:text-slate-950"
              onClick={(event) => {
                event.preventDefault();
                setIsMentionPickerOpen((current) => !current);
                void loadMentionUsers();
              }}
              type="button"
            >
              <AtSign className="size-4" />
            </button>
          </Tooltip>
        </span>
        {isMentionPickerOpen ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2">
              <Search className="size-4 text-slate-400" />
              <input
                className="h-9 min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400"
                onChange={(event) => setMentionQuery(event.target.value)}
                placeholder="Buscar usuario cadastrado"
                value={mentionQuery}
              />
              {isMentionLoading ? (
                <Loader2 className="size-4 animate-spin text-slate-400" />
              ) : null}
            </div>
            <div className="mt-2 grid max-h-52 gap-1 overflow-y-auto">
              {mentionError ? (
                <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                  {mentionError}
                </p>
              ) : null}
              {!mentionError && filteredMentionUsers.length === 0 ? (
                <p className="m-0 rounded-lg bg-white px-3 py-2 text-xs font-medium text-slate-500">
                  {isMentionLoading
                    ? "Carregando usuarios."
                    : "Nenhum usuario encontrado."}
                </p>
              ) : null}
              {filteredMentionUsers.map((user) => (
                <button
                  className="flex items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-white"
                  key={user.id}
                  onClick={(event) => {
                    event.preventDefault();
                    insertMention(user);
                  }}
                  type="button"
                >
                  <RequesterAvatar
                    requester={{
                      avatarUrl: user.avatarUrl,
                      email: user.email,
                      id: user.id,
                      name: user.name,
                    }}
                    size="sm"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-950">
                      {user.name}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {user.email ?? "sem e-mail"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <textarea
          id="ticket-admin-response"
          className={`${fieldClassName} min-h-28 resize-none py-2 leading-6`}
          onChange={(event) =>
            onDraftChange({
              ...draft,
              adminResponse: event.target.value,
            })
          }
          placeholder="Registre a devolutiva deste atendimento."
          value={draft.adminResponse}
        />
      </div>
      <label className="mt-3 grid gap-1.5">
        <span className="text-xs font-semibold uppercase text-slate-500">
          O que foi feito
        </span>
        <textarea
          className={`${fieldClassName} min-h-20 resize-none py-2 leading-6`}
          onChange={(event) =>
            onDraftChange({
              ...draft,
              resolutionSummary: event.target.value,
            })
          }
          placeholder="Anote investigacao, ajuste, bloqueio ou proxima acao."
          value={draft.resolutionSummary}
        />
      </label>
      <div className="mt-3 grid gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="m-0 text-xs font-semibold uppercase text-slate-500">
              Evidencias
            </p>
          </div>
          <span className="rounded-full bg-white px-2 py-1 text-[0.68rem] font-semibold text-slate-500 ring-1 ring-slate-200">
            {replyAttachments.length}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <EvidenceButton
            icon={<Camera className="size-4" />}
            label="Print"
            onClick={() => void handleCapturePrint()}
          />
          <EvidenceButton
            active={recordingKind === "screen"}
            icon={
              recordingKind === "screen" ? (
                <Square className="size-4" />
              ) : (
                <Video className="size-4" />
              )
            }
            label={recordingKind === "screen" ? "Parar" : "Gravar tela"}
            onClick={() => void handleToggleRecording("screen")}
          />
          <EvidenceButton
            active={recordingKind === "audio"}
            icon={
              recordingKind === "audio" ? (
                <Square className="size-4" />
              ) : (
                <Mic className="size-4" />
              )
            }
            label={recordingKind === "audio" ? "Parar" : "Audio"}
            onClick={() => void handleToggleRecording("audio")}
          />
          <EvidenceButton
            icon={<Paperclip className="size-4" />}
            label="Arquivo"
            onClick={() => fileInputRef.current?.click()}
          />
        </div>
        <ReplyEvidenceList
          attachments={replyAttachments}
          onRemove={(fileName) =>
            onReplyAttachmentsChange((currentAttachments) =>
              currentAttachments.filter(
                (attachment) => attachment.fileName !== fileName,
              ),
            )
          }
        />
        {evidenceError ? (
          <p className="m-0 text-xs font-semibold text-red-600">
            {evidenceError}
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Tooltip content="Mover para Backlog" placement="top">
          <button
            aria-label="Mover para Backlog"
            className="grid size-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:border-[#A07C3B]/30 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            onClick={onOpenBacklogForm}
            type="button"
          >
            <Archive className="size-4" />
          </button>
        </Tooltip>
        <Tooltip content={treatmentTooltip} placement="top">
          <button
            aria-label={treatmentTooltip}
            className="grid size-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:border-[#A07C3B]/30 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            onClick={() => onSave(replyStatus)}
            type="button"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isTicketBacklog(ticket) ? (
              <Archive className="size-4" />
            ) : (
              <MessageSquareReply className="size-4" />
            )}
          </button>
        </Tooltip>
        <Tooltip content="Enviar para validacao" placement="top">
          <button
            aria-label="Enviar para validacao"
            className="grid size-10 place-items-center rounded-lg bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            onClick={() => onSave("aguardando_cliente")}
            type="button"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
          </button>
        </Tooltip>
      </div>
    </Surface>
  );
}

function EvidenceButton({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} placement="top">
      <button
        aria-label={label}
        aria-pressed={active || undefined}
        className={`grid size-9 place-items-center rounded-lg border text-sm font-semibold transition ${
          active
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-slate-200 bg-white text-slate-600 hover:border-[#A07C3B]/30 hover:text-slate-950"
        }`}
        onClick={onClick}
        type="button"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

function ReplyEvidenceList({
  attachments,
  onRemove,
}: {
  attachments: HubItTicketAttachmentInput[];
  onRemove: (fileName: string) => void;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2">
      {attachments.map((attachment) => (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
          key={attachment.fileName}
        >
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-slate-950">
              {attachment.fileName}
            </p>
            <p className="m-0 text-xs text-slate-500">
              {attachment.type} / {formatBytes(attachment.sizeBytes)}
            </p>
          </div>
          <button
            aria-label="Remover evidencia"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-50 hover:text-slate-950"
            onClick={() => onRemove(attachment.fileName)}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function AttachmentsPanel({
  attachments,
}: {
  attachments: HubItTicket["attachments"];
}) {
  const [expandedAttachmentId, setExpandedAttachmentId] = useState<string | null>(
    null,
  );
  const expandedAttachment =
    attachments.find((attachment) => attachment.id === expandedAttachmentId) ??
    null;

  return (
    <>
      <Surface bordered className="border-slate-200/70 bg-white p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
          <Paperclip className="size-4 text-[#A07C3B]" />
          Evidencias anexadas
        </div>
        {attachments.length > 0 ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {attachments.map((attachment) => (
              <AttachmentCard
                attachment={attachment}
                key={attachment.id}
                onOpen={() => setExpandedAttachmentId(attachment.id)}
              />
            ))}
          </div>
        ) : (
          <p className="m-0 mt-3 text-sm text-slate-500">
            Nenhum print, gravacao ou arquivo anexado.
          </p>
        )}
      </Surface>

      {expandedAttachment?.dataUrl ? (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/90 p-2 md:p-4"
          onClick={() => setExpandedAttachmentId(null)}
          role="presentation"
        >
          <div
            className="relative h-[96vh] w-[98vw] overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <p className="m-0 truncate text-sm font-semibold text-slate-950">
                {expandedAttachment.fileName}
              </p>
              <Tooltip content="Fechar evidencia" placement="left">
                <button
                  aria-label="Fechar evidencia"
                  className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:text-slate-950"
                  onClick={() => setExpandedAttachmentId(null)}
                  type="button"
                >
                  <X className="size-4" />
                </button>
              </Tooltip>
            </div>
            {expandedAttachment.type === "image" ? (
              <Image
                alt={expandedAttachment.fileName}
                className="h-[calc(96vh-4rem)] w-full object-contain"
                height={1200}
                unoptimized
                width={1920}
                src={expandedAttachment.dataUrl}
              />
            ) : null}
            {expandedAttachment.type === "video" ? (
              <video
                className="h-[calc(96vh-4rem)] w-full bg-slate-950 object-contain"
                controls
                src={expandedAttachment.dataUrl}
              />
            ) : null}
            {expandedAttachment.type === "audio" ? (
              <div className="grid min-h-48 place-items-center p-6">
                <audio className="w-full" controls src={expandedAttachment.dataUrl} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function AttachmentCard({
  attachment,
  onOpen,
}: {
  attachment: HubItTicket["attachments"][number];
  onOpen: () => void;
}) {
  const canPreview =
    Boolean(attachment.dataUrl) &&
    (attachment.type === "image" ||
      attachment.type === "video" ||
      attachment.type === "audio");
  const canOpenFile = Boolean(attachment.dataUrl) && attachment.type === "file";

  return (
    <div className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left transition hover:border-[#A07C3B]/30">
      {attachment.type === "image" && attachment.dataUrl ? (
        <button
          aria-label="Abrir imagem em tela grande"
          className="relative block w-full"
          onClick={onOpen}
          type="button"
        >
          <Image
            alt={attachment.fileName}
            className="h-36 w-full object-cover"
            height={144}
            unoptimized
            width={320}
            src={attachment.dataUrl}
          />
          <span className="absolute right-2 top-2 grid size-8 place-items-center rounded-lg bg-slate-950/80 text-white">
            <Maximize2 className="size-4" />
          </span>
        </button>
      ) : null}
      {attachment.type === "video" && attachment.dataUrl ? (
        <button
          aria-label="Abrir video em tela grande"
          className="relative block w-full"
          onClick={onOpen}
          type="button"
        >
          <video
            className="h-36 w-full bg-slate-950 object-contain"
            src={attachment.dataUrl}
          />
          <span className="absolute right-2 top-2 grid size-8 place-items-center rounded-lg bg-slate-950/80 text-white">
            <Maximize2 className="size-4" />
          </span>
        </button>
      ) : null}
      {attachment.type === "audio" && attachment.dataUrl ? (
        <div className="grid h-36 place-items-center bg-slate-100 p-3">
          <audio className="w-full" controls src={attachment.dataUrl} />
        </div>
      ) : null}
      {!attachment.dataUrl || attachment.type === "file" ? (
        <div className="grid h-36 place-items-center bg-slate-100 text-slate-400">
          {attachment.type === "image" ? (
            <ImageIcon className="size-7" />
          ) : attachment.type === "file" ? (
            <FileText className="size-7" />
          ) : (
            <Paperclip className="size-7" />
          )}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-slate-950">
            {attachment.fileName}
          </p>
          <p className="m-0 mt-1 text-xs text-slate-500">
            {attachment.type} / {formatBytes(attachment.sizeBytes)}
          </p>
        </div>
        {canPreview ? (
          <Tooltip content="Ampliar evidencia" placement="left">
            <button
              aria-label="Ampliar evidencia"
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:text-slate-950"
              onClick={onOpen}
              type="button"
            >
              <Maximize2 className="size-4" />
            </button>
          </Tooltip>
        ) : null}
        {canOpenFile ? (
          <Tooltip content="Abrir arquivo" placement="left">
            <a
              aria-label="Abrir arquivo anexado"
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:text-slate-950"
              download={attachment.fileName}
              href={attachment.dataUrl ?? undefined}
              rel="noopener noreferrer"
              target="_blank"
            >
              <ExternalLink className="size-4" />
            </a>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
  ticket,
}: {
  status: HubItTicketStatus;
  ticket?: HubItTicket;
}) {
  const isBacklog = ticket ? isTicketBacklog(ticket) : false;

  return (
    <Badge variant={isBacklog ? "neutral" : statusVariant(status)}>
      {isBacklog ? "Backlog" : hubItTicketStatusLabels[status]}
    </Badge>
  );
}

function RequesterAvatar({
  requester,
  size,
  variant = "dark",
}: {
  requester: HubItTicket["requester"] | HubItTicket["assignedTo"] | null;
  size: "md" | "sm" | "xs";
  variant?: "dark" | "gold";
}) {
  const sizeClass =
    size === "md"
      ? "size-10 text-xs"
      : size === "sm"
        ? "size-9 text-[0.68rem]"
        : "size-8 text-[0.62rem]";
  const imageSize = size === "md" ? 40 : size === "sm" ? 36 : 32;
  const fallbackClass =
    variant === "dark"
      ? "bg-[#101820] text-white"
      : "bg-[#A07C3B]/15 text-[#7A5E2C]";

  if (requester?.avatarUrl) {
    return (
      <Image
        alt={requester.name}
        className={`${sizeClass} shrink-0 rounded-full object-cover ring-1 ring-slate-200`}
        height={imageSize}
        unoptimized
        width={imageSize}
        src={requester.avatarUrl}
      />
    );
  }

  return (
    <span
      className={`grid ${sizeClass} shrink-0 place-items-center rounded-full font-semibold ${fallbackClass}`}
    >
      {requester ? getInitials(requester.name) : "--"}
    </span>
  );
}

function MiniBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.68rem] font-semibold text-slate-500">
      {children}
    </span>
  );
}

function DeliveryFilterButton({
  active,
  label,
  onClick,
  tone = "neutral",
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  tone?: "danger" | "neutral" | "success" | "warning";
}) {
  const toneClass = {
    danger: active
      ? "border-red-300 bg-red-50 text-red-700"
      : "border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:text-red-700",
    neutral: active
      ? "border-[#A07C3B]/45 bg-[#A07C3B]/10 text-[#7A5E2C]"
      : "border-slate-200 bg-white text-slate-500 hover:border-[#A07C3B]/30",
    success: active
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : "border-slate-200 bg-white text-slate-500 hover:border-emerald-200 hover:text-emerald-700",
    warning: active
      ? "border-amber-300 bg-amber-50 text-amber-700"
      : "border-slate-200 bg-white text-slate-500 hover:border-amber-200 hover:text-amber-700",
  }[tone];

  return (
    <button
      className={`h-8 rounded-lg border px-2 text-xs font-semibold transition ${toneClass}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function DeliveryDueBadge({
  ticket,
  variant = "compact",
}: {
  ticket: HubItTicket;
  variant?: "compact" | "prominent";
}) {
  const deliveryState = getTicketDeliveryState(ticket);
  const baseClass =
    variant === "prominent"
      ? "inline-flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[0.72rem] font-semibold"
      : "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold";

  if (!deliveryState.date && deliveryState.label === "Sem data") {
    if (variant === "prominent") {
      return (
        <span className={`${baseClass} bg-slate-100 text-slate-500`}>
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="size-3.5" />
            Entrega
          </span>
          <span>Sem data</span>
        </span>
      );
    }

    return <MiniBadge>Sem data</MiniBadge>;
  }

  return (
    <span
      className={`${baseClass} ${deliveryState.className}`}
    >
      <span className="inline-flex items-center gap-1">
        <CalendarDays
          className={variant === "prominent" ? "size-3.5" : "size-3"}
        />
        {variant === "prominent" ? "Entrega" : null}
      </span>
      <span>{deliveryState.label}</span>
    </span>
  );
}

function statusVariant(status: HubItTicketStatus): BadgeVariant {
  const stage = getTicketWorkflowStageFromStatus(status);

  if (stage === "validacao" || stage === "finalizado") {
    return "success";
  }

  if (stage === "revisao") {
    return "warning";
  }

  if (stage === "tratativa") {
    return "info";
  }

  return "neutral";
}

function priorityVariant(priority: HubItTicket["priority"]): BadgeVariant {
  if (priority === "critica") {
    return "danger";
  }

  if (priority === "alta") {
    return "warning";
  }

  if (priority === "baixa") {
    return "neutral";
  }

  return "info";
}

function getTicketHistoryActor(
  event: HubItTicket["events"][number],
  ticket: HubItTicket,
) {
  const fallbackOperator =
    ticket.assignedTo ??
    ticket.deliveryDecisionBy ??
    ticket.lastResponseBy ??
    ({
      avatarUrl: null,
      email: null,
      id: "operator",
      name: "Operador",
    } satisfies HubItTicket["requester"]);
  const zeusAutomation = {
    avatarUrl: null,
    email: null,
    id: "zeus",
    name: "Zeus",
  } satisfies HubItTicket["requester"];
  const operatorEvent =
    event.type === "admin_reply" ||
    event.type === "closed" ||
    event.type === "status_changed" ||
    event.type === "resolved";

  if (
    event.type === "triaged" ||
    (!event.actor &&
      (event.type === "closed" ||
        event.message.trim().toLowerCase().startsWith("zeus:")))
  ) {
    return {
      kind: "zeus" as const,
      user: zeusAutomation,
      variant: "dark" as const,
    };
  }

  if (event.actor) {
    return {
      kind: operatorEvent ? ("operator" as const) : ("requester" as const),
      user: event.actor,
      variant: operatorEvent ? ("dark" as const) : ("gold" as const),
    };
  }

  const operator =
    ticket.lastResponseBy?.id === ticket.requester.id
      ? fallbackOperator
      : (ticket.lastResponseBy ?? fallbackOperator);

  if (operatorEvent) {
    return {
      kind: "operator" as const,
      user: operator,
      variant: "dark" as const,
    };
  }

  return {
    kind: "requester" as const,
    user: ticket.requester,
    variant: "gold" as const,
  };
}

function getInitials(name: string) {
  const [first = "", second = ""] = name.trim().split(/\s+/);

  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || "--";
}

function getDetailPreview(value?: string | null) {
  const normalized = value?.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "Nao informado.";
  }

  return normalized.length > 92 ? `${normalized.slice(0, 89)}...` : normalized;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatDateShort(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-");

  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
}

function getUnknownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getSetupRelationName(value: unknown) {
  const record = Array.isArray(value)
    ? getUnknownRecord(value[0])
    : getUnknownRecord(value);

  return getOptionalString(record?.name);
}

function getSetupPrimaryAssignment(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const assignments = value
    .map(getUnknownRecord)
    .filter((assignment): assignment is Record<string, unknown> =>
      Boolean(assignment),
    );

  return (
    assignments.find((assignment) => assignment.status === "active") ??
    assignments[0] ??
    null
  );
}

function parseMentionUsers(value: unknown): MentionUser[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const user = item as {
      avatar_url?: unknown;
      display_name?: unknown;
      email?: unknown;
      hub_user_assignments?: unknown;
      id?: unknown;
      name?: unknown;
      role?: unknown;
      status?: unknown;
    };
    const id = typeof user.id === "string" ? user.id : "";
    const name =
      typeof user.display_name === "string" && user.display_name.trim()
        ? user.display_name.trim()
        : typeof user.name === "string" && user.name.trim()
          ? user.name.trim()
          : "";

    if (!id || !name) {
      return [];
    }

    const assignment = getSetupPrimaryAssignment(user.hub_user_assignments);

    return [
      {
        avatarUrl:
          typeof user.avatar_url === "string" ? user.avatar_url : null,
        departmentId: getOptionalString(assignment?.department_id),
        departmentName: getSetupRelationName(assignment?.hub_departments),
        email: typeof user.email === "string" ? user.email : null,
        id,
        name,
        role: typeof user.role === "string" ? user.role : null,
        sectorId: getOptionalString(assignment?.sector_id),
        sectorName: getSetupRelationName(assignment?.hub_sectors),
        status: typeof user.status === "string" ? user.status : null,
      } satisfies MentionUser,
    ];
  });
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function buildSetupUserLookup(users: MentionUser[]) {
  const lookup = new Map<string, MentionUser>();

  for (const user of users) {
    lookup.set(`id:${user.id}`, user);

    if (user.email) {
      lookup.set(`email:${normalizeSearchText(user.email)}`, user);
    }
  }

  return lookup;
}

function buildTicketManagementStats(
  tickets: HubItTicket[],
  setupUsersByLookup: ReadonlyMap<string, MentionUser>,
): TicketManagementStats {
  const workflowCounts = countTicketsByWorkflowStage(tickets);
  const activeTickets = tickets.filter(isTicketInActiveQueue);
  const finalizedTickets = tickets.filter(
    (ticket) => getTicketWorkflowStage(ticket) === "finalizado",
  );
  const backlogTickets = tickets.filter(
    (ticket) => getTicketWorkflowStage(ticket) === "backlog",
  );
  const treatmentTickets = tickets.filter((ticket) => {
    const stage = getTicketWorkflowStage(ticket);

    return (
      stage === "novo" ||
      stage === "tratativa" ||
      stage === "validacao" ||
      stage === "revisao"
    );
  });
  const categoriesByKey = new Map<string, TicketDimensionStats>();
  const collaboratorsByKey = new Map<string, TicketCollaboratorStats>();
  const departmentByTicketProtocol = new Map<string, string>();
  const departmentsByName = new Map<string, TicketDepartmentStats>();
  const modulesByKey = new Map<string, TicketDimensionStats>();
  const requesterKeysByDepartment = new Map<string, Set<string>>();
  const modulesByDepartment = new Map<string, Set<string>>();
  const sortedByUpdate = sortTicketsByUpdatedAt(tickets);
  const doneTickets = sortTicketsByUpdatedAt(finalizedTickets).slice(0, 6);
  const meetingBacklogTickets = sortTicketsByUpdatedAt(backlogTickets).slice(0, 6);
  const meetingTreatmentTickets = sortTicketsByUpdatedAt(treatmentTickets).slice(0, 6);
  const highPriorityTickets = tickets.filter(
    (ticket) => ticket.priority === "alta" || ticket.priority === "critica",
  );
  const createdTodayTickets = tickets.filter((ticket) =>
    isSameLocalDate(ticket.createdAt, new Date()),
  );
  const closedTodayTickets = finalizedTickets.filter((ticket) =>
    isTicketClosedOnDate(ticket, new Date()),
  );
  const repliedTodayTickets = tickets.filter((ticket) =>
    ticket.events.some(
      (event) =>
        event.type === "admin_reply" && isSameLocalDate(event.createdAt, new Date()),
    ),
  );

  for (const ticket of tickets) {
    const department = getTicketRequesterDepartment(ticket, setupUsersByLookup);
    const stage = getTicketWorkflowStage(ticket);
    const categoryKey = ticket.category;
    const moduleLabel = normalizeTicketModuleLabel(
      ticket.roadmap?.module || ticket.module,
    );
    const moduleKey = normalizeSearchText(moduleLabel);
    const collaboratorKey =
      ticket.requester.id ||
      ticket.requester.email ||
      normalizeSearchText(ticket.requester.name);
    const requesterKey =
      ticket.requester.id ||
      ticket.requester.email ||
      normalizeSearchText(ticket.requester.name);
    const currentDepartment = departmentsByName.get(department) ?? {
      backlog: 0,
      department,
      finalized: 0,
      highPriority: 0,
      inProgress: 0,
      latestTicket: null,
      modules: [],
      requesterCount: 0,
      tickets: [],
      total: 0,
      validation: 0,
    };
    const currentCategory = categoriesByKey.get(categoryKey) ?? {
      backlog: 0,
      finalized: 0,
      inProgress: 0,
      key: categoryKey,
      label: hubItTicketCategoryLabels[ticket.category],
      latestTicket: null,
      tickets: [],
      total: 0,
    };
    const currentModule = modulesByKey.get(moduleKey) ?? {
      backlog: 0,
      finalized: 0,
      inProgress: 0,
      key: moduleKey,
      label: moduleLabel,
      latestTicket: null,
      tickets: [],
      total: 0,
    };
    const currentCollaborator = collaboratorsByKey.get(collaboratorKey) ?? {
      backlog: 0,
      department,
      finalized: 0,
      highPriority: 0,
      inProgress: 0,
      key: collaboratorKey,
      label: ticket.requester.name,
      latestTicket: null,
      modules: [],
      requester: ticket.requester,
      tickets: [],
      total: 0,
    };

    applyTicketToDimension(currentDepartment, stage, ticket);
    applyTicketToDimension(currentCategory, stage, ticket);
    applyTicketToDimension(currentModule, stage, ticket);
    applyTicketToDimension(currentCollaborator, stage, ticket);

    if (ticket.priority === "alta" || ticket.priority === "critica") {
      currentDepartment.highPriority += 1;
      currentCollaborator.highPriority += 1;
    }

    if (stage === "validacao") {
      currentDepartment.validation += 1;
    }

    const departmentRequesterKeys =
      requesterKeysByDepartment.get(department) ?? new Set<string>();
    departmentRequesterKeys.add(requesterKey);
    requesterKeysByDepartment.set(department, departmentRequesterKeys);

    const departmentModules =
      modulesByDepartment.get(department) ?? new Set<string>();
    departmentModules.add(moduleLabel);
    modulesByDepartment.set(department, departmentModules);

    currentCollaborator.modules = addUniqueSortedLabel(
      currentCollaborator.modules,
      moduleLabel,
    );

    departmentsByName.set(department, currentDepartment);
    categoriesByKey.set(categoryKey, currentCategory);
    modulesByKey.set(moduleKey, currentModule);
    collaboratorsByKey.set(collaboratorKey, currentCollaborator);
    departmentByTicketProtocol.set(ticket.protocol, department);
  }

  const departments = [...departmentsByName.values()].map((department) => ({
    ...department,
    modules: [...(modulesByDepartment.get(department.department) ?? [])].sort(
      sortLabels,
    ),
    requesterCount:
      requesterKeysByDepartment.get(department.department)?.size ?? 0,
  }));

  return {
    active: activeTickets.length,
    activeTickets,
    allTickets: tickets,
    backlog: workflowCounts.backlog,
    backlogTickets,
    categories: sortManagementDimensions([...categoriesByKey.values()]),
    closedTodayTickets,
    collaborators: sortManagementDimensions([...collaboratorsByKey.values()]),
    createdTodayTickets,
    dailyVolume: buildDailyVolumeStats(tickets),
    departmentByTicketProtocol,
    departments: sortDepartmentDimensions(departments),
    doneTickets,
    finalized: workflowCounts.finalizado,
    finalizedTickets,
    firstResponseAverageHours: averageHours(
      tickets.map(getTicketFirstResponseHours).filter(isNumber),
    ),
    highPriorityTickets,
    inProgress:
      workflowCounts.novo +
      workflowCounts.tratativa +
      workflowCounts.validacao +
      workflowCounts.revisao,
    lastUpdatedTicket: sortedByUpdate[0] ?? null,
    meetingBacklogTickets,
    meetingTreatmentTickets,
    modules: sortManagementDimensions([...modulesByKey.values()]),
    newTickets: workflowCounts.novo,
    repliedTodayTickets,
    resolutionAverageHours: averageHours(
      finalizedTickets.map(getTicketResolutionHours).filter(isNumber),
    ),
    review: workflowCounts.revisao,
    treatmentTickets,
    total: tickets.length,
    validation: workflowCounts.validacao,
  };
}

function applyTicketToDimension(
  dimension: Pick<
    TicketDimensionStats,
    | "backlog"
    | "finalized"
    | "inProgress"
    | "latestTicket"
    | "tickets"
    | "total"
  >,
  stage: TicketWorkflowStage,
  ticket: HubItTicket,
) {
  if (stage === "finalizado") {
    dimension.finalized += 1;
  } else if (stage === "backlog") {
    dimension.backlog += 1;
  } else {
    dimension.inProgress += 1;
  }

  dimension.total =
    dimension.finalized + dimension.inProgress + dimension.backlog;
  dimension.tickets.push(ticket);

  if (
    !dimension.latestTicket ||
    new Date(ticket.updatedAt).getTime() >
      new Date(dimension.latestTicket.updatedAt).getTime()
  ) {
    dimension.latestTicket = ticket;
  }
}

function sortManagementDimensions<
  Dimension extends Pick<TicketDimensionStats, "label" | "total">,
>(items: Dimension[]) {
  return items.sort(
    (firstItem, secondItem) =>
      secondItem.total - firstItem.total ||
      firstItem.label.localeCompare(secondItem.label, "pt-BR", {
        sensitivity: "base",
      }),
  );
}

function sortDepartmentDimensions(items: TicketDepartmentStats[]) {
  return items.sort(
    (firstDepartment, secondDepartment) =>
      secondDepartment.total - firstDepartment.total ||
      firstDepartment.department.localeCompare(
        secondDepartment.department,
        "pt-BR",
        { sensitivity: "base" },
      ),
  );
}

function addUniqueSortedLabel(items: string[], label: string) {
  return Array.from(new Set([...items, label])).sort(sortLabels);
}

function sortLabels(firstLabel: string, secondLabel: string) {
  return firstLabel.localeCompare(secondLabel, "pt-BR", {
    sensitivity: "base",
  });
}

function normalizeTicketModuleLabel(moduleName: string | null | undefined) {
  const normalizedModule = normalizeSearchText(moduleName ?? "");

  if (!normalizedModule) {
    return "Panteon";
  }

  if (
    normalizedModule.includes("pulsex") ||
    normalizedModule.includes("pulse x") ||
    normalizedModule.includes("hermes")
  ) {
    return "Hermes";
  }

  if (normalizedModule === "hub" || normalizedModule.includes("panteon")) {
    return "Panteon";
  }

  if (normalizedModule.includes("hubops")) {
    return "Zeus";
  }

  return moduleName?.trim() || "Panteon";
}

function buildDailyVolumeStats(tickets: HubItTicket[]): TicketDailyVolumeStats[] {
  const today = new Date();

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const day = toLocalDateKey(date);

    return {
      closed: tickets.filter((ticket) => isTicketClosedOnDate(ticket, date))
        .length,
      created: tickets.filter((ticket) => isSameLocalDate(ticket.createdAt, date))
        .length,
      day,
      treated: tickets.filter((ticket) =>
        ticket.events.some(
          (event) =>
            event.type === "admin_reply" && isSameLocalDate(event.createdAt, date),
        ),
      ).length,
      validation: tickets.filter((ticket) =>
        isTicketSentToValidationOnDate(ticket, date),
      ).length,
    };
  });
}

function isTicketSentToValidationOnDate(ticket: HubItTicket, date: Date) {
  return (
    ticket.events.some(
      (event) =>
        (event.type === "resolved" || event.type === "review_requested") &&
        isSameLocalDate(event.createdAt, date),
    ) ||
    (getTicketWorkflowStage(ticket) === "validacao" &&
      isSameLocalDate(ticket.updatedAt, date))
  );
}

function getChartBarWidth(value: number, maxValue: number) {
  if (value <= 0) {
    return "0%";
  }

  return `${Math.max(6, Math.round((value / maxValue) * 100))}%`;
}

function isTicketClosedOnDate(ticket: HubItTicket, date: Date) {
  return (
    (ticket.resolvedAt ? isSameLocalDate(ticket.resolvedAt, date) : false) ||
    ticket.events.some(
      (event) =>
        (event.type === "closed" || event.type === "resolved") &&
        isSameLocalDate(event.createdAt, date),
    )
  );
}

function isSameLocalDate(value: string, date: Date) {
  return toLocalDateKey(new Date(value)) === toLocalDateKey(date);
}

function toLocalDateKey(date: Date) {
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const dateParts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((parts, part) => {
      if (part.type !== "literal") {
        parts[part.type] = part.value;
      }

      return parts;
    }, {});

  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function getTicketFirstResponseHours(ticket: HubItTicket) {
  const firstResponse = [...ticket.events]
    .filter((event) => event.type === "admin_reply")
    .sort(
      (firstEvent, secondEvent) =>
        new Date(firstEvent.createdAt).getTime() -
        new Date(secondEvent.createdAt).getTime(),
    )[0];

  if (!firstResponse) {
    return null;
  }

  return hoursBetween(ticket.createdAt, firstResponse.createdAt);
}

function getTicketResolutionHours(ticket: HubItTicket) {
  const resolutionDate =
    ticket.resolvedAt ??
    [...ticket.events]
      .filter((event) => event.type === "closed" || event.type === "resolved")
      .sort(
        (firstEvent, secondEvent) =>
          new Date(secondEvent.createdAt).getTime() -
          new Date(firstEvent.createdAt).getTime(),
      )[0]?.createdAt;

  return resolutionDate ? hoursBetween(ticket.createdAt, resolutionDate) : null;
}

function hoursBetween(start: string, end: string) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime < startTime) {
    return null;
  }

  return (endTime - startTime) / (60 * 60 * 1000);
}

function averageHours(values: number[]) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatHoursKpi(value: number | null) {
  if (value === null) {
    return "--";
  }

  if (value < 24) {
    return `${Math.max(1, Math.round(value))}h`;
  }

  return `${(value / 24).toFixed(value >= 240 ? 0 : 1)}d`;
}

function formatDayLabel(day: string) {
  const date = new Date(`${day}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function getTicketRequesterDepartment(
  ticket: HubItTicket,
  setupUsersByLookup: ReadonlyMap<string, MentionUser>,
) {
  const userById = setupUsersByLookup.get(`id:${ticket.requester.id}`);
  const userByEmail = ticket.requester.email
    ? setupUsersByLookup.get(`email:${normalizeSearchText(ticket.requester.email)}`)
    : null;

  return (
    userById?.departmentName ??
    userByEmail?.departmentName ??
    "Sem departamento"
  );
}

function filterTicketsBySearch(tickets: HubItTicket[], query: string) {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return tickets;
  }

  return tickets.filter((ticket) =>
    getTicketSearchText(ticket).includes(normalizedQuery),
  );
}

function filterTicketsByQueueFilters(
  tickets: HubItTicket[],
  filters: TicketQueueFilters,
  setupUsersByLookup: ReadonlyMap<string, MentionUser>,
) {
  return tickets.filter((ticket) => {
    if (
      filters.workflow !== "todos" &&
      getTicketWorkflowStage(ticket) !== filters.workflow
    ) {
      return false;
    }

    if (filters.priority !== "todos" && ticket.priority !== filters.priority) {
      return false;
    }

    if (
      filters.collaborator !== "todos" &&
      getTicketRequesterFilterKey(ticket) !== filters.collaborator
    ) {
      return false;
    }

    if (
      filters.department !== "todos" &&
      getTicketRequesterDepartment(ticket, setupUsersByLookup) !==
        filters.department
    ) {
      return false;
    }

    return true;
  });
}

function buildTicketQueueFilterOptions(
  tickets: HubItTicket[],
  setupUsersByLookup: ReadonlyMap<string, MentionUser>,
): TicketQueueFilterOptions {
  const collaborators = new Map<
    string,
    {
      count: number;
      key: string;
      label: string;
    }
  >();
  const departments = new Map<
    string,
    {
      count: number;
      key: string;
      label: string;
    }
  >();

  for (const ticket of tickets) {
    const key = getTicketRequesterFilterKey(ticket);
    const current = collaborators.get(key) ?? {
      count: 0,
      key,
      label: ticket.requester.name,
    };

    current.count += 1;
    collaborators.set(key, current);

    const department = getTicketRequesterDepartment(ticket, setupUsersByLookup);
    const currentDepartment = departments.get(department) ?? {
      count: 0,
      key: department,
      label: department,
    };

    currentDepartment.count += 1;
    departments.set(department, currentDepartment);
  }

  return {
    collaborators: [...collaborators.values()].sort(
      (firstCollaborator, secondCollaborator) =>
        firstCollaborator.label.localeCompare(
          secondCollaborator.label,
          "pt-BR",
          { sensitivity: "base" },
        ),
    ),
    departments: [...departments.values()].sort(
      (firstDepartment, secondDepartment) =>
        firstDepartment.label.localeCompare(secondDepartment.label, "pt-BR", {
          sensitivity: "base",
        }),
    ),
  };
}

function hasActiveQueueFilters(filters: TicketQueueFilters) {
  return (
    filters.collaborator !== "todos" ||
    filters.department !== "todos" ||
    filters.priority !== "todos" ||
    filters.workflow !== "todos"
  );
}

function getTicketRequesterFilterKey(ticket: HubItTicket) {
  return (
    ticket.requester.id ||
    ticket.requester.email ||
    normalizeSearchText(ticket.requester.name)
  );
}

function buildTicketInsightGroups(
  tickets: HubItTicket[],
  groupBy: TicketInsightGroupMode,
): TicketInsightGroup[] {
  const groupsByKey = new Map<string, TicketInsightGroup>();

  for (const ticket of tickets) {
    const group = getTicketInsightGroup(ticket, groupBy);
    const currentGroup = groupsByKey.get(group.key) ?? {
      key: group.key,
      label: group.label,
      tickets: [],
    };

    currentGroup.tickets.push(ticket);
    groupsByKey.set(group.key, currentGroup);
  }

  return [...groupsByKey.values()].sort(
    (firstGroup, secondGroup) =>
      secondGroup.tickets.length - firstGroup.tickets.length ||
      firstGroup.label.localeCompare(secondGroup.label, "pt-BR", {
        sensitivity: "base",
      }),
  );
}

function getTicketInsightGroup(
  ticket: HubItTicket,
  groupBy: TicketInsightGroupMode,
) {
  if (groupBy === "category") {
    return {
      key: ticket.category,
      label: hubItTicketCategoryLabels[ticket.category],
    };
  }

  if (groupBy === "workflow") {
    const stage = getTicketWorkflowStage(ticket);

    return {
      key: stage,
      label: workflowStageLabels[stage],
    };
  }

  return {
    key: getTicketRequesterFilterKey(ticket),
    label: ticket.requester.name,
  };
}

function buildTicketDeliveryCalendar(tickets: HubItTicket[]) {
  const today = new Date();
  const todayKey = toLocalDateKey(today);
  const groupsByDate = new Map<
    string,
    {
      isToday: boolean;
      key: string;
      label: string;
      tickets: HubItTicket[];
      weekday: string;
    }
  >();
  const laterTickets: HubItTicket[] = [];
  const noDateTickets: HubItTicket[] = [];
  const businessDays = getNextBusinessDays(today, 5);
  const weekEndKey = businessDays[businessDays.length - 1]?.key ?? todayKey;

  for (const businessDay of businessDays) {
    const parsedDate = parseDateOnly(businessDay.key);

    if (!businessDay.key || !parsedDate) {
      continue;
    }

    groupsByDate.set(businessDay.key, {
      isToday: businessDay.key === todayKey,
      key: businessDay.key,
      label: formatDayLabel(businessDay.key),
      tickets: [],
      weekday: formatWeekdayLabel(parsedDate),
    });
  }

  for (const ticket of tickets) {
    const deliveryDate = getTicketEffectiveDeliveryDate(ticket);

    if (!deliveryDate) {
      noDateTickets.push(ticket);
      continue;
    }

    const deliveryKey = toLocalDateKey(new Date(deliveryDate));
    const parsedDate = parseDateOnly(deliveryKey);

    if (!deliveryKey || !parsedDate) {
      noDateTickets.push(ticket);
      continue;
    }

    if (deliveryKey < todayKey) {
      continue;
    }

    if (deliveryKey > weekEndKey) {
      laterTickets.push(ticket);
      continue;
    }

    const group = groupsByDate.get(deliveryKey);

    if (!group) {
      laterTickets.push(ticket);
      continue;
    }

    group.tickets.push(ticket);
  }

  const dateGroups = [...groupsByDate.values()].sort((firstDay, secondDay) =>
    firstDay.key.localeCompare(secondDay.key),
  );

  for (const day of dateGroups) {
    day.tickets = sortTicketsByDeliveryDate(day.tickets);
  }

  return {
    dateGroups,
    laterTickets: sortTicketsByDeliveryDate(laterTickets),
    noDateTickets: sortTicketsByUpdatedAt(noDateTickets),
    visibleCount:
      dateGroups.reduce((total, day) => total + day.tickets.length, 0) +
      laterTickets.length +
      noDateTickets.length,
  };
}

function addLocalDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);

  return nextDate;
}

function getNextBusinessDays(startDate: Date, count: number) {
  const days: { key: string }[] = [];
  let cursor = new Date(startDate);
  let guard = 0;

  while (days.length < count && guard < count + 10) {
    if (isBusinessDay(cursor)) {
      const key = toLocalDateKey(cursor);

      if (key) {
        days.push({ key });
      }
    }

    cursor = addLocalDays(cursor, 1);
    guard += 1;
  }

  return days;
}

function isBusinessDay(date: Date) {
  const weekday = date.getDay();

  return weekday !== 0 && weekday !== 6;
}

function formatWeekdayLabel(date: Date) {
  return date
    .toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "short",
    })
    .replace(".", "");
}

function getTicketSearchText(ticket: HubItTicket) {
  return [
    ticket.protocol,
    ticket.title,
    ticket.requester.name,
    ticket.requester.email,
    ticket.assignedTo?.name,
    ticket.assignedTo?.email,
    ticket.module,
    hubItTicketCategoryLabels[ticket.category],
    hubItTicketStatusLabels[ticket.status],
    ticket.technicalSummary,
    ticket.userDescription,
  ]
    .map((value) => normalizeSearchText(value ?? ""))
    .join(" ");
}

function filterTicketsByManagementFilters(
  tickets: HubItTicket[],
  filters: ManagementPanelFilters,
  departmentByTicketProtocol?: ReadonlyMap<string, string>,
) {
  const normalizedQuery = normalizeSearchText(filters.query);

  return tickets.filter((ticket) => {
    if (normalizedQuery && !getTicketSearchText(ticket).includes(normalizedQuery)) {
      return false;
    }

    if (
      filters.workflow !== "todos" &&
      getTicketWorkflowStage(ticket) !== filters.workflow
    ) {
      return false;
    }

    if (filters.priority !== "todos" && ticket.priority !== filters.priority) {
      return false;
    }

    if (filters.category !== "todos" && ticket.category !== filters.category) {
      return false;
    }

    if (
      filters.collaborator !== "todos" &&
      getTicketRequesterFilterKey(ticket) !== filters.collaborator
    ) {
      return false;
    }

    if (
      filters.department !== "todos" &&
      (departmentByTicketProtocol?.get(ticket.protocol) ?? "Sem departamento") !==
        filters.department
    ) {
      return false;
    }

    return true;
  });
}

function buildManagementCollaboratorOptions(tickets: HubItTicket[]) {
  const options = new Map<string, { key: string; label: string }>();

  for (const ticket of tickets) {
    const key = getTicketRequesterFilterKey(ticket);

    if (!options.has(key)) {
      options.set(key, {
        key,
        label: ticket.requester.name,
      });
    }
  }

  return [...options.values()].sort((firstOption, secondOption) =>
    firstOption.label.localeCompare(secondOption.label, "pt-BR", {
      sensitivity: "base",
    }),
  );
}

function buildManagementCategoryOptions(tickets: HubItTicket[]) {
  const categories = new Set(tickets.map((ticket) => ticket.category));

  return [...categories]
    .map((category) => ({
      key: category,
      label: hubItTicketCategoryLabels[category],
    }))
    .sort((firstOption, secondOption) =>
      firstOption.label.localeCompare(secondOption.label, "pt-BR", {
        sensitivity: "base",
      }),
    );
}

function buildManagementDepartmentOptions(
  tickets: HubItTicket[],
  departmentByTicketProtocol: ReadonlyMap<string, string>,
) {
  const options = new Map<string, { key: string; label: string }>();

  for (const ticket of tickets) {
    const department =
      departmentByTicketProtocol.get(ticket.protocol) ?? "Sem departamento";

    if (!options.has(department)) {
      options.set(department, {
        key: department,
        label: department,
      });
    }
  }

  return [...options.values()].sort((firstOption, secondOption) =>
    firstOption.label.localeCompare(secondOption.label, "pt-BR", {
      sensitivity: "base",
    }),
  );
}

function summarizeDepartmentForTickets(
  department: TicketDepartmentStats,
  tickets: HubItTicket[],
): TicketDepartmentStats {
  const workflowCounts = countTicketsByWorkflowStage(tickets);
  const modules = Array.from(
    new Set(
      tickets.map((ticket) =>
        normalizeTicketModuleLabel(ticket.roadmap?.module || ticket.module),
      ),
    ),
  ).sort(sortLabels);
  const requesterCount = new Set(tickets.map(getTicketRequesterFilterKey)).size;

  return {
    ...department,
    backlog: workflowCounts.backlog,
    finalized: workflowCounts.finalizado,
    highPriority: countHighPriorityTickets(tickets),
    inProgress:
      workflowCounts.novo +
      workflowCounts.tratativa +
      workflowCounts.validacao +
      workflowCounts.revisao,
    latestTicket: sortTicketsByUpdatedAt(tickets)[0] ?? null,
    modules,
    requesterCount,
    tickets,
    total: tickets.length,
    validation: workflowCounts.validacao,
  };
}

function summarizeCollaboratorForTickets(
  collaborator: TicketCollaboratorStats,
  tickets: HubItTicket[],
): TicketCollaboratorStats {
  const workflowCounts = countTicketsByWorkflowStage(tickets);
  const modules = Array.from(
    new Set(
      tickets.map((ticket) =>
        normalizeTicketModuleLabel(ticket.roadmap?.module || ticket.module),
      ),
    ),
  ).sort(sortLabels);

  return {
    ...collaborator,
    backlog: workflowCounts.backlog,
    finalized: workflowCounts.finalizado,
    highPriority: countHighPriorityTickets(tickets),
    inProgress:
      workflowCounts.novo +
      workflowCounts.tratativa +
      workflowCounts.validacao +
      workflowCounts.revisao,
    latestTicket: sortTicketsByUpdatedAt(tickets)[0] ?? null,
    modules,
    tickets,
    total: tickets.length,
  };
}

function countHighPriorityTickets(tickets: HubItTicket[]) {
  return tickets.filter(
    (ticket) => ticket.priority === "alta" || ticket.priority === "critica",
  ).length;
}

function createDefaultTicketDraft({
  approvedDeliveryDate,
  category,
  isBacklog,
  priority,
  requestedDeliveryDate,
  status,
}: {
  approvedDeliveryDate: string | null;
  category: HubItTicketCategory | null;
  isBacklog: boolean;
  priority: HubItTicketPriority | null;
  requestedDeliveryDate: string | null;
  status: HubItTicketStatus;
}): TicketDraft {
  return {
    adminResponse: "",
    approvedDeliveryDate: approvedDeliveryDate ?? requestedDeliveryDate ?? "",
    category: category ?? "erro",
    deliveryDecision: "manter",
    deliveryDecisionNote: "",
    priority: priority ?? "media",
    resolutionSummary: "",
    status: isBacklog ? "em_analise" : status === "novo" ? "em_tratativa" : status,
  };
}

function readStoredHelpDeskViewState(): HelpDeskViewState {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(helpDeskViewStorageKey);

    return parseStoredHelpDeskViewState(rawValue ? JSON.parse(rawValue) : null);
  } catch {
    return {};
  }
}

function writeStoredHelpDeskViewState(state: HelpDeskViewState) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(helpDeskViewStorageKey, JSON.stringify(state));
  } catch {
    // A memoria de interface nao deve bloquear o uso do HelpDesk.
  }
}

function parseStoredHelpDeskViewState(value: unknown): HelpDeskViewState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const storedState = value as Record<string, unknown>;
  const queueFilters = parseStoredQueueFilters(storedState.queueFilters);
  const state: HelpDeskViewState = {};

  if (isStringOrNull(storedState.selectedProtocol)) {
    state.selectedProtocol = storedState.selectedProtocol;
  }

  if (isStringOrNull(storedState.detailModalProtocol)) {
    state.detailModalProtocol = storedState.detailModalProtocol;
  }

  if (
    typeof storedState.deliveryFilter === "string" &&
    deliveryFilterOptions.includes(storedState.deliveryFilter as DeliveryFilter)
  ) {
    state.deliveryFilter = storedState.deliveryFilter as DeliveryFilter;
  }

  if (
    typeof storedState.queueView === "string" &&
    queueViewOptions.includes(storedState.queueView as TicketQueueView)
  ) {
    state.queueView = storedState.queueView as TicketQueueView;
  }

  if (
    typeof storedState.queueDisplayMode === "string" &&
    queueDisplayModeOptions.includes(
      storedState.queueDisplayMode as TicketQueueDisplayMode,
    )
  ) {
    state.queueDisplayMode =
      storedState.queueDisplayMode as TicketQueueDisplayMode;
  }

  if (queueFilters) {
    state.queueFilters = queueFilters;
  }

  if (typeof storedState.searchQuery === "string") {
    state.searchQuery = storedState.searchQuery;
  }

  if (typeof storedState.isQueueDatesExpanded === "boolean") {
    state.isQueueDatesExpanded = storedState.isQueueDatesExpanded;
  }

  return state;
}

function parseStoredQueueFilters(value: unknown): TicketQueueFilters | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const filters = value as Record<string, unknown>;
  const workflow =
    typeof filters.workflow === "string" &&
    workflowStageOptions.includes(filters.workflow as TicketWorkflowStage)
      ? (filters.workflow as TicketWorkflowStage)
      : "todos";
  const priority =
    typeof filters.priority === "string" &&
    priorityOptions.includes(filters.priority as HubItTicket["priority"])
      ? (filters.priority as HubItTicket["priority"])
      : "todos";

  return {
    collaborator:
      typeof filters.collaborator === "string" ? filters.collaborator : "todos",
    department:
      typeof filters.department === "string" ? filters.department : "todos",
    priority,
    workflow,
  };
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function readStoredTicketDraft(protocol: string): TicketDraft | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(ticketDraftStorageKey);
    const drafts = rawValue ? (JSON.parse(rawValue) as unknown) : null;

    if (!drafts || typeof drafts !== "object" || Array.isArray(drafts)) {
      return null;
    }

    return parseStoredTicketDraft(
      (drafts as Record<string, unknown>)[protocol],
    );
  } catch {
    return null;
  }
}

function writeStoredTicketDraft(
  protocol: string,
  draft: TicketDraft,
  defaultDraft: TicketDraft,
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const rawValue = window.localStorage.getItem(ticketDraftStorageKey);
    const drafts =
      rawValue && typeof rawValue === "string"
        ? (JSON.parse(rawValue) as Record<string, unknown>)
        : {};

    if (!hasMeaningfulTicketDraft(draft, defaultDraft)) {
      delete drafts[protocol];
    } else {
      drafts[protocol] = draft;
    }

    window.localStorage.setItem(ticketDraftStorageKey, JSON.stringify(drafts));
  } catch {
    // O rascunho local e uma melhoria de experiencia; falha nele nao bloqueia o ticket.
  }
}

function clearStoredTicketDraft(protocol: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const rawValue = window.localStorage.getItem(ticketDraftStorageKey);
    const drafts =
      rawValue && typeof rawValue === "string"
        ? (JSON.parse(rawValue) as Record<string, unknown>)
        : {};

    delete drafts[protocol];
    window.localStorage.setItem(ticketDraftStorageKey, JSON.stringify(drafts));
  } catch {
    // Mantem o fluxo de salvamento mesmo se o armazenamento local falhar.
  }
}

function parseStoredTicketDraft(value: unknown): TicketDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const draft = value as Partial<Record<keyof TicketDraft, unknown>>;

  if (typeof draft.status !== "string") {
    return null;
  }

  return {
    adminResponse:
      typeof draft.adminResponse === "string" ? draft.adminResponse : "",
    approvedDeliveryDate:
      typeof draft.approvedDeliveryDate === "string"
        ? draft.approvedDeliveryDate
        : "",
    deliveryDecision:
      draft.deliveryDecision === "approve_requested" ||
      draft.deliveryDecision === "reject_with_new_date"
        ? draft.deliveryDecision
        : "manter",
    deliveryDecisionNote:
      typeof draft.deliveryDecisionNote === "string"
        ? draft.deliveryDecisionNote
        : "",
    category:
      typeof draft.category === "string" &&
      draft.category in hubItTicketCategoryLabels
        ? (draft.category as HubItTicketCategory)
        : "erro",
    priority:
      typeof draft.priority === "string" &&
      draft.priority in hubItTicketPriorityLabels
        ? (draft.priority as HubItTicketPriority)
        : "media",
    resolutionSummary:
      typeof draft.resolutionSummary === "string"
        ? draft.resolutionSummary
        : "",
    status: draft.status as HubItTicketStatus,
  };
}

function hasMeaningfulTicketDraft(draft: TicketDraft, defaultDraft: TicketDraft) {
  return (
    draft.adminResponse.trim().length > 0 ||
    draft.resolutionSummary.trim().length > 0 ||
    draft.deliveryDecisionNote.trim().length > 0 ||
    draft.deliveryDecision !== defaultDraft.deliveryDecision ||
    draft.approvedDeliveryDate !== defaultDraft.approvedDeliveryDate ||
    draft.category !== defaultDraft.category ||
    draft.priority !== defaultDraft.priority ||
    draft.status !== defaultDraft.status
  );
}

function getBacklogFormInitialState(ticket: HubItTicket): BacklogFormState {
  return {
    module: ticket.roadmap?.module ?? ticket.module,
    note: ticket.roadmap?.note ?? "",
    priority: ticket.roadmap?.priority ?? ticket.priority,
    screen:
      ticket.roadmap?.screen ??
      getBacklogScreenFromTicket(ticket) ??
      "Tela nao informada",
    type: ticket.roadmap?.type ?? getDefaultBacklogType(ticket),
  };
}

function getBacklogScreenFromTicket(ticket: HubItTicket) {
  const source = ticket.sourcePath || ticket.sourceUrl || "";

  if (!source) {
    return null;
  }

  try {
    const url = source.startsWith("http") ? new URL(source) : null;

    return url?.pathname || source;
  } catch {
    return source;
  }
}

function getDefaultBacklogType(
  ticket: HubItTicket,
): HubItTicketRoadmapType {
  if (ticket.category === "bug" || ticket.category === "erro") {
    return "bug";
  }

  if (ticket.category === "performance") {
    return "divida_tecnica";
  }

  return "melhoria";
}

function getBacklogTypeIcon(type: HubItTicketRoadmapType) {
  if (type === "bug") {
    return <Bug className="size-4 text-red-600" />;
  }

  if (type === "divida_tecnica") {
    return <Wrench className="size-4 text-amber-600" />;
  }

  if (type === "automacao_integracao") {
    return <ClipboardList className="size-4 text-slate-600" />;
  }

  return <Sparkles className="size-4 text-[#7A5E2C]" />;
}

function getTodayDateInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function sortTicketsByDeliveryDate(tickets: HubItTicket[]) {
  return [...tickets].sort((firstTicket, secondTicket) => {
    const firstDate = getTicketEffectiveDeliveryDate(firstTicket);
    const secondDate = getTicketEffectiveDeliveryDate(secondTicket);

    if (!firstDate && !secondDate) {
      return secondTicket.updatedAt.localeCompare(firstTicket.updatedAt);
    }

    if (!firstDate) {
      return 1;
    }

    if (!secondDate) {
      return -1;
    }

    const dateComparison = firstDate.localeCompare(secondDate);

    return dateComparison === 0
      ? secondTicket.updatedAt.localeCompare(firstTicket.updatedAt)
      : dateComparison;
  });
}

function sortTicketsByUpdatedAt(tickets: HubItTicket[]) {
  return [...tickets].sort(
    (firstTicket, secondTicket) =>
      new Date(secondTicket.updatedAt).getTime() -
      new Date(firstTicket.updatedAt).getTime(),
  );
}

function sortHistoryTickets(
  tickets: HubItTicket[],
  key: HistorySortKey,
  direction: HistorySortDirection,
  departmentByTicketProtocol: ReadonlyMap<string, string>,
) {
  const multiplier = direction === "asc" ? 1 : -1;

  return [...tickets].sort((firstTicket, secondTicket) => {
    const comparison = compareHistoryTicketValue(
      firstTicket,
      secondTicket,
      key,
      departmentByTicketProtocol,
    );

    if (comparison !== 0) {
      return comparison * multiplier;
    }

    return secondTicket.updatedAt.localeCompare(firstTicket.updatedAt);
  });
}

function compareHistoryTicketValue(
  firstTicket: HubItTicket,
  secondTicket: HubItTicket,
  key: HistorySortKey,
  departmentByTicketProtocol: ReadonlyMap<string, string>,
) {
  if (key === "priority") {
    return (
      priorityScore(firstTicket.priority) - priorityScore(secondTicket.priority)
    );
  }

  if (key === "createdAt") {
    return (
      new Date(firstTicket.createdAt).getTime() -
      new Date(secondTicket.createdAt).getTime()
    );
  }

  if (key === "deliveryDate") {
    return compareOptionalDate(
      getTicketEffectiveDeliveryDate(firstTicket),
      getTicketEffectiveDeliveryDate(secondTicket),
    );
  }

  if (key === "updatedAt") {
    return (
      new Date(firstTicket.updatedAt).getTime() -
      new Date(secondTicket.updatedAt).getTime()
    );
  }

  const firstValue = getHistoryTicketStringValue(
    firstTicket,
    key,
    departmentByTicketProtocol,
  );
  const secondValue = getHistoryTicketStringValue(
    secondTicket,
    key,
    departmentByTicketProtocol,
  );

  return firstValue.localeCompare(secondValue, "pt-BR", {
    numeric: true,
    sensitivity: "base",
  });
}

function getHistoryTicketStringValue(
  ticket: HubItTicket,
  key: Exclude<
    HistorySortKey,
    "createdAt" | "deliveryDate" | "priority" | "updatedAt"
  >,
  departmentByTicketProtocol: ReadonlyMap<string, string>,
) {
  if (key === "collaborator") {
    return ticket.requester.name;
  }

  if (key === "department") {
    return departmentByTicketProtocol.get(ticket.protocol) ?? "Sem departamento";
  }

  if (key === "module") {
    return normalizeTicketModuleLabel(ticket.roadmap?.module || ticket.module);
  }

  if (key === "protocol") {
    return ticket.protocol;
  }

  if (key === "status") {
    return workflowStageLabels[getTicketWorkflowStage(ticket)];
  }

  return ticket.title;
}

function priorityScore(priority: HubItTicket["priority"]) {
  const scores = {
    baixa: 1,
    media: 2,
    alta: 3,
    critica: 4,
  } as const satisfies Record<HubItTicket["priority"], number>;

  return scores[priority];
}

function compareOptionalDate(
  firstDate: string | null,
  secondDate: string | null,
) {
  if (!firstDate && !secondDate) {
    return 0;
  }

  if (!firstDate) {
    return 1;
  }

  if (!secondDate) {
    return -1;
  }

  return new Date(firstDate).getTime() - new Date(secondDate).getTime();
}

function isTicketInHistory(ticket: HubItTicket) {
  return !isTicketInActiveQueue(ticket);
}

function isTicketInActiveQueue(ticket: HubItTicket) {
  const stage = getTicketWorkflowStage(ticket);

  return (
    stage === "backlog" ||
    stage === "novo" ||
    stage === "tratativa" ||
    stage === "validacao" ||
    stage === "revisao"
  );
}

function getTicketEffectiveDeliveryDate(ticket: HubItTicket) {
  return ticket.approvedDeliveryDate ?? ticket.requestedDeliveryDate ?? null;
}

function getTicketDeliveryBucket(ticket: HubItTicket): DeliveryFilter {
  if (isTicketInHistory(ticket)) {
    return "folga";
  }

  const deliveryState = getTicketDeliveryState(ticket);

  if (!deliveryState.date) {
    return "sem_data";
  }

  if (deliveryState.days <= 0) {
    return "hoje";
  }

  if (deliveryState.days <= 2) {
    return "proximos";
  }

  return "folga";
}

function getTicketDeliveryState(ticket: HubItTicket) {
  const date = getTicketEffectiveDeliveryDate(ticket);
  const stage = getTicketWorkflowStage(ticket);

  if (stage === "backlog") {
    return {
      className: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
      date,
      days: Number.POSITIVE_INFINITY,
      label: "Backlog",
    };
  }

  if (stage === "validacao") {
    return {
      className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
      date,
      days: Number.POSITIVE_INFINITY,
      label: "Validacao",
    };
  }

  if (stage === "finalizado") {
    return {
      className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
      date,
      days: Number.POSITIVE_INFINITY,
      label: hubItTicketStatusLabels[ticket.status],
    };
  }

  if (!date) {
    return {
      className: "",
      date: null,
      days: Number.POSITIVE_INFINITY,
      label: "Sem data",
    };
  }

  const days = getDaysUntilDate(date);

  if (days <= 0) {
    return {
      className: "bg-red-50 text-red-700 ring-1 ring-red-100",
      date,
      days,
      label: days < 0 ? `Atrasado ${Math.abs(days)}d` : "Hoje",
    };
  }

  if (days <= 2) {
    return {
      className: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
      date,
      days,
      label: `${days} dia${days > 1 ? "s" : ""}`,
    };
  }

  return {
    className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
    date,
    days,
    label: `${days} dias`,
  };
}

function getTicketDeliveryDateTone(ticket: HubItTicket) {
  const date = getTicketEffectiveDeliveryDate(ticket);

  if (!date) {
    return {
      className: "bg-slate-100 text-slate-500 ring-slate-200",
      dateLabel: "Sem data",
      statusLabel: "Pendente",
    };
  }

  const days = getDaysUntilDate(date);

  if (days < 0) {
    return {
      className: "bg-red-50 text-red-700 ring-red-100",
      dateLabel: formatDateOnly(date),
      statusLabel: "Vencido",
    };
  }

  if (days <= 2) {
    return {
      className: "bg-amber-50 text-amber-700 ring-amber-100",
      dateLabel: formatDateOnly(date),
      statusLabel: days === 0 ? "Hoje" : "Perto",
    };
  }

  return {
    className: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    dateLabel: formatDateOnly(date),
    statusLabel: "Com folga",
  };
}

function getDaysUntilDate(value: string) {
  const date = parseDateOnly(value);

  if (!date) {
    return Number.POSITIVE_INFINITY;
  }

  const today = new Date();
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  return Math.round((date.getTime() - todayStart.getTime()) / 86_400_000);
}

function parseDateOnly(value: string) {
  const [year = 0, month = 0, day = 0] = value
    .split("-")
    .map((part) => Number(part));
  const date = new Date(year, month - 1, day);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getDeliveryDecisionLabel(ticket: HubItTicket) {
  if (ticket.deliveryDecisionStatus === "aprovada") {
    return "data aprovada";
  }

  if (ticket.deliveryDecisionStatus === "reprogramada") {
    return "reprogramada";
  }

  return "aguardando decisao";
}

const maxReplyEvidenceBytes = 6_000_000;
async function createReplyAttachment(
  blob: Blob,
  options: {
    durationSeconds?: number;
    fileName: string;
    mimeType?: string;
    sizeBytes?: number;
    type?: HubItTicketAttachmentInput["type"];
  },
): Promise<HubItTicketAttachmentInput> {
  const mimeType = options.mimeType || blob.type || "application/octet-stream";

  return {
    capturedAt: new Date().toISOString(),
    dataUrl: await readBlobAsDataUrl(blob),
    fileName: options.fileName,
    mimeType,
    sizeBytes: options.sizeBytes ?? blob.size,
    type: options.type ?? getAttachmentTypeFromMime(mimeType),
  };
}

function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function getAttachmentTypeFromMime(
  mimeType: string,
): HubItTicketAttachmentInput["type"] {
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  return "file";
}

function formatEvidenceFileTime(value: Date) {
  return value
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "-")
    .slice(0, 19);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;

  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes >= 100 ? 0 : 1)} KB`;
  }

  const megabytes = kilobytes / 1024;

  return `${megabytes.toFixed(megabytes >= 10 ? 1 : 2)} MB`;
}

const fieldClassName =
  "w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10";
