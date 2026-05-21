"use client";

import {
  isHubItTicketsMigrationPendingMessage,
  loadHubItTickets,
  updateHubItTicket,
} from "@/lib/hub-it-tickets/client";
import {
  hubItTicketCategoryLabels,
  hubItTicketPriorityLabels,
  hubItTicketStatusLabels,
  hubItTicketStatuses,
  type HubItTicket,
  type HubItTicketStatus,
} from "@/lib/hub-it-tickets/types";
import { Badge, Surface, Tooltip } from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";
import {
  AlertTriangle,
  AtSign,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  History,
  ImageIcon,
  Inbox,
  Loader2,
  Maximize2,
  MessageSquareReply,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type HubItTicketsBoardProps = {
  accessToken: string | null;
  isActive: boolean;
  onTicketAttentionCountChange?: (count: number) => void;
  onTicketCountChange?: (count: number) => void;
};

type TicketDraft = {
  adminResponse: string;
  approvedDeliveryDate: string;
  deliveryDecision: "manter" | "approve_requested" | "reject_with_new_date";
  deliveryDecisionNote: string;
  resolutionSummary: string;
  status: HubItTicketStatus;
};

const emptyDraft: TicketDraft = {
  adminResponse: "",
  approvedDeliveryDate: "",
  deliveryDecision: "manter",
  deliveryDecisionNote: "",
  resolutionSummary: "",
  status: "em_analise",
};

type DeliveryFilter = "todos" | "hoje" | "proximos" | "folga" | "sem_data";
type TicketWorkspaceSection =
  | "actual"
  | "context"
  | "delivery"
  | "description"
  | "expected";

type MentionUser = {
  avatarUrl?: string | null;
  email?: string | null;
  id: string;
  name: string;
  role?: string | null;
  status?: string | null;
};

type SetupUsersApiResponse = {
  data?: unknown;
  error?: string;
};

export function HubItTicketsBoard({
  accessToken,
  isActive,
  onTicketAttentionCountChange,
  onTicketCountChange,
}: HubItTicketsBoardProps) {
  const [tickets, setTickets] = useState<HubItTicket[]>([]);
  const [selectedProtocol, setSelectedProtocol] = useState<string | null>(null);
  const [draft, setDraft] = useState<TicketDraft>(emptyDraft);
  const [deliveryFilter, setDeliveryFilter] =
    useState<DeliveryFilter>("todos");
  const [isQueueDatesExpanded, setIsQueueDatesExpanded] = useState(false);
  const [isQueueMetricsExpanded, setIsQueueMetricsExpanded] = useState(false);
  const [isQueueStatusExpanded, setIsQueueStatusExpanded] = useState(false);
  const [loadedDetailProtocols, setLoadedDetailProtocols] = useState<
    readonly string[]
  >([]);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openTickets = tickets.filter(
    (ticket) => ticket.status !== "resolvido" && ticket.status !== "fechado",
  );
  const ticketsWaitingForZeus = tickets.filter(
    (ticket) =>
      ticket.status === "novo" ||
      ticket.status === "em_analise" ||
      ticket.status === "em_revisao",
  );
  const deliveryBuckets = useMemo(() => {
    return {
      folga: tickets.filter((ticket) => getTicketDeliveryBucket(ticket) === "folga")
        .length,
      hoje: tickets.filter((ticket) => getTicketDeliveryBucket(ticket) === "hoje")
        .length,
      proximos: tickets.filter(
        (ticket) => getTicketDeliveryBucket(ticket) === "proximos",
      ).length,
      semData: tickets.filter(
        (ticket) => getTicketDeliveryBucket(ticket) === "sem_data",
      ).length,
    };
  }, [tickets]);
  const ticketsByDelivery = useMemo(() => {
    return sortTicketsByDeliveryDate(
      deliveryFilter === "todos"
        ? tickets
        : tickets.filter(
            (ticket) => getTicketDeliveryBucket(ticket) === deliveryFilter,
          ),
    );
  }, [deliveryFilter, tickets]);
  const selectedTicket =
    ticketsByDelivery.find((ticket) => ticket.protocol === selectedProtocol) ??
    ticketsByDelivery[0] ??
    null;
  const selectedTicketDraftProtocol = selectedTicket?.protocol ?? null;
  const selectedTicketDraftStatus = selectedTicket?.status ?? null;
  const selectedTicketDraftApprovedDeliveryDate =
    selectedTicket?.approvedDeliveryDate ?? null;
  const selectedTicketDraftRequestedDeliveryDate =
    selectedTicket?.requestedDeliveryDate ?? null;

  const ticketsByStatus = useMemo(() => {
    return hubItTicketStatuses.map((status) => ({
      count: tickets.filter((ticket) => ticket.status === status).length,
      status,
    }));
  }, [tickets]);

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

  useEffect(() => {
    if (!isActive || !accessToken) {
      return;
    }

    void refreshTickets();
  }, [accessToken, isActive, refreshTickets]);

  useEffect(() => {
    onTicketCountChange?.(openTickets.length);
  }, [onTicketCountChange, openTickets.length]);

  useEffect(() => {
    onTicketAttentionCountChange?.(ticketsWaitingForZeus.length);
  }, [onTicketAttentionCountChange, ticketsWaitingForZeus.length]);

  useEffect(() => {
    if (!selectedTicketDraftProtocol || !selectedTicketDraftStatus) {
      setDraft(emptyDraft);
      return;
    }

    setDraft({
      adminResponse: "",
      approvedDeliveryDate:
        selectedTicketDraftApprovedDeliveryDate ??
        selectedTicketDraftRequestedDeliveryDate ??
        "",
      deliveryDecision: "manter",
      deliveryDecisionNote: "",
      resolutionSummary: "",
      status:
        selectedTicketDraftStatus === "novo"
          ? "em_analise"
          : selectedTicketDraftStatus,
    });
  }, [
    selectedTicketDraftApprovedDeliveryDate,
    selectedTicketDraftProtocol,
    selectedTicketDraftRequestedDeliveryDate,
    selectedTicketDraftStatus,
  ]);

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

  async function saveReply() {
    if (!selectedTicket) {
      return;
    }

    const hasDeliveryDecision = draft.deliveryDecision !== "manter";

    if (
      draft.deliveryDecision === "reject_with_new_date" &&
      !draft.approvedDeliveryDate
    ) {
      setError("Informe a nova data proposta por Zeus.");
      return;
    }

    if (
      !draft.adminResponse.trim() &&
      !draft.resolutionSummary.trim() &&
      !hasDeliveryDecision
    ) {
      setError("Escreva uma devolutiva, resumo ou decisao de data.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const updatedTicket = await updateHubItTicket({
        accessToken,
        input: {
          adminResponse: draft.adminResponse,
          approvedDeliveryDate:
            hasDeliveryDecision && draft.approvedDeliveryDate
              ? draft.approvedDeliveryDate
              : undefined,
          deliveryDecision:
            draft.deliveryDecision === "manter"
              ? undefined
              : draft.deliveryDecision,
          deliveryDecisionNote: hasDeliveryDecision
            ? draft.deliveryDecisionNote
            : undefined,
          protocol: selectedTicket.protocol,
          resolutionSummary: draft.resolutionSummary,
          status: draft.status,
        },
      });

      setTickets((currentTickets) =>
        currentTickets.map((ticket) =>
          ticket.id === updatedTicket.id ? updatedTicket : ticket,
        ),
      );
      setSelectedProtocol(updatedTicket.protocol);
      setLoadedDetailProtocols((currentProtocols) =>
        currentProtocols.includes(updatedTicket.protocol)
          ? currentProtocols
          : [...currentProtocols, updatedTicket.protocol],
      );
      setDraft({
        ...emptyDraft,
        approvedDeliveryDate:
          updatedTicket.approvedDeliveryDate ??
          updatedTicket.requestedDeliveryDate ??
          "",
        status:
          updatedTicket.status === "novo"
            ? "em_analise"
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
        className="overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        <div className="grid min-h-[calc(100vh-13rem)] grid-cols-1 xl:grid-cols-[minmax(19rem,23rem)_minmax(0,1fr)]">
          <aside className="border-b border-slate-200/70 bg-slate-50/60 xl:border-b-0 xl:border-r">
            <div className="border-b border-slate-200/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="m-0 text-xs font-semibold uppercase text-slate-500">
                    Fila Zeus
                  </p>
                  <h2 className="m-0 mt-1 text-base font-semibold text-slate-950">
                    HelpDesk
                  </h2>
                </div>
                <Tooltip content="Atualizar HelpDesk" placement="left">
                  <button
                    aria-label="Atualizar HelpDesk"
                    className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-[#A07C3B]/25 hover:text-slate-950"
                    onClick={() => void refreshTickets()}
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
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <QueueSummaryPill label="abertos" value={openTickets.length} />
                <QueueSummaryPill
                  label="hoje"
                  tone="danger"
                  value={deliveryBuckets.hoje}
                />
                <QueueSummaryPill
                  label="1-2d"
                  tone="warning"
                  value={deliveryBuckets.proximos}
                />
                <QueueSummaryPill
                  label="3+d"
                  tone="success"
                  value={deliveryBuckets.folga}
                />
              </div>
            </div>

            <QueueDisclosureSection
              isExpanded={isQueueMetricsExpanded}
              onToggle={() =>
                setIsQueueMetricsExpanded((current) => !current)
              }
              summary={`${openTickets.length} abertos`}
              title="Indicadores"
            >
              <div className="grid grid-cols-4 gap-2">
                <QueueMetric label="abertos" value={openTickets.length} />
                <QueueMetric
                  label="hoje"
                  tone="danger"
                  value={deliveryBuckets.hoje}
                />
                <QueueMetric
                  label="1-2d"
                  tone="warning"
                  value={deliveryBuckets.proximos}
                />
                <QueueMetric
                  label="3+d"
                  tone="success"
                  value={deliveryBuckets.folga}
                />
              </div>
            </QueueDisclosureSection>

            <QueueDisclosureSection
              isExpanded={isQueueDatesExpanded}
              onToggle={() => setIsQueueDatesExpanded((current) => !current)}
              summary={getDeliveryFilterSummary(
                deliveryFilter,
                tickets.length,
                deliveryBuckets,
              )}
              title="Visao por data"
            >
              <div className="grid grid-cols-2 gap-2">
                <DeliveryFilterButton
                  active={deliveryFilter === "todos"}
                  label={`Todos ${tickets.length}`}
                  onClick={() => setDeliveryFilter("todos")}
                />
                <DeliveryFilterButton
                  active={deliveryFilter === "hoje"}
                  label={`Hoje ${deliveryBuckets.hoje}`}
                  tone="danger"
                  onClick={() => setDeliveryFilter("hoje")}
                />
                <DeliveryFilterButton
                  active={deliveryFilter === "proximos"}
                  label={`1-2 dias ${deliveryBuckets.proximos}`}
                  tone="warning"
                  onClick={() => setDeliveryFilter("proximos")}
                />
                <DeliveryFilterButton
                  active={deliveryFilter === "folga"}
                  label={`3+ dias ${deliveryBuckets.folga}`}
                  tone="success"
                  onClick={() => setDeliveryFilter("folga")}
                />
              </div>
              {deliveryBuckets.semData > 0 ? (
                <div className="mt-2">
                  <DeliveryFilterButton
                    active={deliveryFilter === "sem_data"}
                    label={`Sem data ${deliveryBuckets.semData}`}
                    onClick={() => setDeliveryFilter("sem_data")}
                  />
                </div>
              ) : null}
            </QueueDisclosureSection>

            <QueueDisclosureSection
              isExpanded={isQueueStatusExpanded}
              onToggle={() => setIsQueueStatusExpanded((current) => !current)}
              summary={`${ticketsWaitingForZeus.length} aguardando Zeus`}
              title="Status da fila"
            >
              <div className="grid grid-cols-2 gap-1.5">
                {ticketsByStatus.map((item) => (
                  <div
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-2"
                    key={item.status}
                  >
                    <p className="m-0 truncate text-[0.64rem] font-semibold text-slate-500">
                      {hubItTicketStatusLabels[item.status]}
                    </p>
                    <p className="m-0 mt-0.5 text-base font-semibold text-slate-950">
                      {item.count}
                    </p>
                  </div>
                ))}
              </div>
            </QueueDisclosureSection>

            <div className="max-h-[calc(100vh-24rem)] min-h-[28rem] overflow-y-auto p-3">
              {ticketsByDelivery.length > 0 ? (
                <div className="grid gap-2">
                  {ticketsByDelivery.map((ticket) => (
                    <TicketQueueItem
                      isActive={ticket.protocol === selectedTicket?.protocol}
                      key={ticket.id}
                      onClick={() => setSelectedProtocol(ticket.protocol)}
                      ticket={ticket}
                    />
                  ))}
                </div>
              ) : (
                <EmptyQueue isLoading={isLoading} />
              )}
            </div>
          </aside>

          <div className="min-w-0">
            {error ? (
              <OperationalErrorBanner message={error} />
            ) : null}

            {selectedTicket ? (
              <TicketWorkspace
                accessToken={accessToken}
                draft={draft}
                isDetailLoading={isDetailLoading}
                isSaving={isSaving}
                onDraftChange={setDraft}
                onSave={() => void saveReply()}
                ticket={selectedTicket}
              />
            ) : (
              <div className="grid min-h-[28rem] place-items-center p-6 text-center">
                <div>
                  <Inbox className="mx-auto size-8 text-slate-300" />
                  <p className="m-0 mt-3 text-sm font-semibold text-slate-500">
                    Nenhum protocolo HelpDesk encontrado.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </Surface>
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

function QueueMetric({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "danger" | "neutral" | "success" | "warning";
  value: number | string;
}) {
  const toneClass = {
    danger: "border-red-100 bg-red-50 text-red-700",
    neutral: "border-slate-200 bg-white text-slate-700",
    success: "border-emerald-100 bg-emerald-50 text-emerald-700",
    warning: "border-amber-100 bg-amber-50 text-amber-700",
  }[tone];

  return (
    <div className={`rounded-lg border px-2 py-1.5 ${toneClass}`}>
      <p className="m-0 text-base font-semibold leading-none">{value}</p>
      <p className="m-0 mt-1 truncate text-[0.62rem] font-semibold uppercase">
        {label}
      </p>
    </div>
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

function QueueDisclosureSection({
  children,
  isExpanded,
  onToggle,
  summary,
  title,
}: {
  children: ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  summary: string;
  title: string;
}) {
  return (
    <div className="border-b border-slate-200/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[0.68rem] font-semibold uppercase text-slate-500">
            {title}
          </p>
          <p className="m-0 mt-0.5 truncate text-xs font-medium text-slate-500">
            {summary}
          </p>
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
      {isExpanded ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

function TicketQueueItem({
  isActive,
  onClick,
  ticket,
}: {
  isActive: boolean;
  onClick: () => void;
  ticket: HubItTicket;
}) {
  const queueTone = getTicketQueueToneClass(getTicketDeliveryBucket(ticket), isActive);

  return (
    <button
      className={`relative w-full overflow-hidden rounded-xl border p-3 text-left transition ${queueTone.container}`}
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden
        className={`absolute bottom-3 left-0 top-3 w-1 rounded-r-full ${queueTone.stripe}`}
      />
      <div className="flex items-start gap-3">
        <RequesterAvatar requester={ticket.requester} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-1.5">
            <p className="m-0 font-mono text-xs font-semibold text-[#7A5E2C]">
              {ticket.protocol}
            </p>
            <StatusBadge status={ticket.status} />
          </div>
          <p className="m-0 mt-1 line-clamp-2 text-sm font-semibold text-slate-950">
            {ticket.title}
          </p>
          <p className="m-0 mt-1 truncate text-xs text-slate-500">
            {ticket.requester.name}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <DeliveryDueBadge ticket={ticket} />
        <MiniBadge>{ticket.module}</MiniBadge>
        <MiniBadge>{hubItTicketPriorityLabels[ticket.priority]}</MiniBadge>
        {ticket.attachments.length > 0 ? (
          <MiniBadge>{ticket.attachments.length} anexo(s)</MiniBadge>
        ) : null}
      </div>
    </button>
  );
}

function TicketWorkspace({
  accessToken,
  draft,
  isDetailLoading,
  isSaving,
  onDraftChange,
  onSave,
  ticket,
}: {
  accessToken: string | null;
  draft: TicketDraft;
  isDetailLoading: boolean;
  isSaving: boolean;
  onDraftChange: (draft: TicketDraft) => void;
  onSave: () => void;
  ticket: HubItTicket;
}) {
  const [expandedSections, setExpandedSections] = useState<
    ReadonlySet<TicketWorkspaceSection>
  >(() => new Set());

  useEffect(() => {
    setExpandedSections(new Set());
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
    <div className="grid min-w-0 gap-4 p-4 xl:p-5">
      <header className="grid gap-4 border-b border-slate-100 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-[#7A5E2C]">
                {ticket.protocol}
              </span>
              <StatusBadge status={ticket.status} />
              <Badge variant={priorityVariant(ticket.priority)}>
                {hubItTicketPriorityLabels[ticket.priority]}
              </Badge>
              <DeliveryDueBadge ticket={ticket} />
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
              {ticket.module} / {hubItTicketCategoryLabels[ticket.category]} /
              aberto em {formatDateTime(ticket.createdAt)}
            </p>
          </div>
        </div>
        <WorkflowStepper status={ticket.status} />
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
              fallback="Aguardando Zeus"
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
            label="Leitura tecnica da Athena"
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
          <TicketHistory isLoading={isDetailLoading} ticket={ticket} />

          <TicketReplyForm
            accessToken={accessToken}
            draft={draft}
            isSaving={isSaving}
            onDraftChange={onDraftChange}
            onSave={onSave}
          />

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
        </aside>
      </div>
    </div>
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

function WorkflowStepper({ status }: { status: HubItTicketStatus }) {
  const steps = [
    { id: "novo", label: "Entrada" },
    { id: "em_analise", label: "Analise" },
    { id: "em_triagem", label: "Triagem" },
    { id: "em_tratativa", label: "Tratativa" },
    { id: "em_execucao", label: "Execucao" },
    { id: "em_homologacao", label: "Homologacao" },
    { id: "em_producao", label: "Producao" },
    { id: "aguardando_cliente", label: "Cliente" },
    { id: "em_revisao", label: "Revisao" },
    { id: "resolvido", label: "Resolvido" },
  ] as const satisfies readonly { id: HubItTicketStatus; label: string }[];
  const activeIndex = Math.max(
    steps.findIndex((step) => step.id === normalizeWorkflowStatus(status)),
    0,
  );

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {steps.map((step, index) => {
        const isDone = index < activeIndex || status === "fechado";
        const isActive = index === activeIndex && status !== "fechado";

        return (
          <div
            className={`min-w-[7.25rem] rounded-lg border px-3 py-2 ${
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
          label={decisionStatus === "reprogramada" ? "Zeus" : "Aprovada"}
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
            Nova data Zeus
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
          Ultima decisao: {ticket.deliveryDecisionBy?.name ?? "Zeus"} em{" "}
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
          Historico
        </div>
        {isLoading ? <Loader2 className="size-4 animate-spin text-slate-400" /> : null}
      </div>
      <div className="mt-3 grid max-h-[17rem] gap-2 overflow-y-auto pr-1">
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
  const isOperator = actor.kind === "operator";
  const isAthena = actor.kind === "athena";
  const bubbleClass = isOperator
    ? "border-[#3f4c5d] bg-[#3f4c5d] text-white"
    : isAthena
      ? "border-[#A07C3B]/20 bg-[#A07C3B]/10 text-slate-800"
      : "border-slate-200 bg-white text-slate-700";
  const timestampClass = isOperator ? "text-white/65" : "text-slate-400";

  return (
    <div className={`flex gap-2 ${isOperator ? "justify-end" : "justify-start"}`}>
      {!isOperator ? (
        <RequesterAvatar requester={actor.user} size="xs" variant={actor.variant} />
      ) : null}
      <div
        className={`max-w-[88%] rounded-2xl border px-3 py-2 text-xs leading-5 shadow-sm ${bubbleClass}`}
      >
        <p className="m-0 whitespace-pre-wrap">{event.message}</p>
        <p className={`m-0 mt-1 font-mono text-[0.62rem] ${timestampClass}`}>
          {formatDateTime(event.createdAt)}
        </p>
      </div>
      {isOperator ? (
        <RequesterAvatar requester={actor.user} size="xs" variant="dark" />
      ) : null}
    </div>
  );
}

function TicketReplyForm({
  accessToken,
  draft,
  isSaving,
  onDraftChange,
  onSave,
}: {
  accessToken: string | null;
  draft: TicketDraft;
  isSaving: boolean;
  onDraftChange: (draft: TicketDraft) => void;
  onSave: () => void;
}) {
  const [isMentionPickerOpen, setIsMentionPickerOpen] = useState(false);
  const [isMentionLoading, setIsMentionLoading] = useState(false);
  const [mentionError, setMentionError] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionUsers, setMentionUsers] = useState<MentionUser[]>([]);
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
        <Tooltip content="Registrar devolutiva" placement="left">
          <button
            aria-label="Registrar devolutiva"
            className="grid size-9 place-items-center rounded-lg bg-[#101820] text-white transition hover:bg-[#1d2634] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            onClick={onSave}
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
      <label className="mt-4 grid gap-1.5">
        <span className="text-xs font-semibold uppercase text-slate-500">
          Etapa
        </span>
        <select
          className={fieldClassName}
          onChange={(event) =>
            onDraftChange({
              ...draft,
              status: event.target.value as HubItTicketStatus,
            })
          }
          value={draft.status}
        >
          {hubItTicketStatuses.map((status) => (
            <option key={status} value={status}>
              {hubItTicketStatusLabels[status]}
            </option>
          ))}
        </select>
      </label>
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
    </Surface>
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
            Nenhum print ou gravacao anexado.
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
      </div>
    </div>
  );
}

function EmptyQueue({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-5 text-center">
      {isLoading ? (
        <Loader2 className="mx-auto size-5 animate-spin text-slate-400" />
      ) : (
        <Inbox className="mx-auto size-6 text-slate-300" />
      )}
      <p className="m-0 mt-3 text-sm font-semibold text-slate-500">
        {isLoading ? "Carregando HelpDesk." : "Fila vazia no Zeus."}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: HubItTicketStatus }) {
  return (
    <Badge variant={statusVariant(status)}>
      {hubItTicketStatusLabels[status]}
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

function DeliveryDueBadge({ ticket }: { ticket: HubItTicket }) {
  const deliveryState = getTicketDeliveryState(ticket);

  if (!deliveryState.date) {
    return <MiniBadge>Sem data</MiniBadge>;
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${deliveryState.className}`}
    >
      <CalendarDays className="size-3" />
      {deliveryState.label}
    </span>
  );
}

function statusVariant(status: HubItTicketStatus): BadgeVariant {
  if (status === "resolvido" || status === "fechado") {
    return "success";
  }

  if (status === "em_producao") {
    return "success";
  }

  if (
    status === "em_analise" ||
    status === "em_execucao" ||
    status === "em_homologacao" ||
    status === "em_revisao" ||
    status === "em_tratativa"
  ) {
    return "info";
  }

  if (status === "aguardando_cliente") {
    return "warning";
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
      id: "zeus",
      name: "Zeus",
    } satisfies HubItTicket["requester"]);
  const operatorEvent =
    event.type === "admin_reply" ||
    event.type === "status_changed" ||
    event.type === "resolved";

  if (event.type === "triaged") {
    return {
      kind: "athena" as const,
      user: event.actor ?? {
        avatarUrl: null,
        email: null,
        id: "athena",
        name: "Athena",
      },
      variant: "gold" as const,
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

function formatDateOnly(value: string) {
  const [year, month, day] = value.split("-");

  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
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

    return [
      {
        avatarUrl:
          typeof user.avatar_url === "string" ? user.avatar_url : null,
        email: typeof user.email === "string" ? user.email : null,
        id,
        name,
        role: typeof user.role === "string" ? user.role : null,
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

function getTodayDateInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getDeliveryFilterSummary(
  filter: DeliveryFilter,
  total: number,
  buckets: {
    folga: number;
    hoje: number;
    proximos: number;
    semData: number;
  },
) {
  if (filter === "hoje") {
    return `${buckets.hoje} vencem hoje`;
  }

  if (filter === "proximos") {
    return `${buckets.proximos} em 1-2 dias`;
  }

  if (filter === "folga") {
    return `${buckets.folga} com 3+ dias`;
  }

  if (filter === "sem_data") {
    return `${buckets.semData} sem data`;
  }

  return `${total} tickets`;
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

function mergeTicketListWithExistingDetails(
  nextTickets: HubItTicket[],
  currentTickets: HubItTicket[],
) {
  const currentByProtocol = new Map(
    currentTickets.map((ticket) => [ticket.protocol, ticket]),
  );

  return nextTickets.map((ticket) => {
    const currentTicket = currentByProtocol.get(ticket.protocol);

    if (
      currentTicket &&
      (currentTicket.attachments.length > 0 || currentTicket.events.length > 0)
    ) {
      return {
        ...ticket,
        attachments: currentTicket.attachments,
        events: currentTicket.events,
      };
    }

    return ticket;
  });
}

function upsertTicketWithDetails(
  currentTickets: HubItTicket[],
  ticketDetail: HubItTicket,
) {
  if (
    !currentTickets.some((ticket) => ticket.protocol === ticketDetail.protocol)
  ) {
    return [ticketDetail, ...currentTickets];
  }

  return currentTickets.map((ticket) =>
    ticket.protocol === ticketDetail.protocol ? ticketDetail : ticket,
  );
}

function normalizeWorkflowStatus(status: HubItTicketStatus): HubItTicketStatus {
  if (status === "fechado") {
    return "resolvido";
  }

  return status;
}

function getTicketEffectiveDeliveryDate(ticket: HubItTicket) {
  return ticket.approvedDeliveryDate ?? ticket.requestedDeliveryDate ?? null;
}

function getTicketDeliveryBucket(ticket: HubItTicket): DeliveryFilter {
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

function getTicketQueueToneClass(
  bucket: DeliveryFilter,
  isActive: boolean,
) {
  if (bucket === "hoje") {
    return {
      container: isActive
        ? "border-red-300 bg-red-50 shadow-sm"
        : "border-red-100 bg-white hover:border-red-200 hover:bg-red-50/50",
      stripe: "bg-red-500",
    };
  }

  if (bucket === "proximos") {
    return {
      container: isActive
        ? "border-amber-300 bg-amber-50 shadow-sm"
        : "border-amber-100 bg-white hover:border-amber-200 hover:bg-amber-50/50",
      stripe: "bg-amber-500",
    };
  }

  if (bucket === "folga") {
    return {
      container: isActive
        ? "border-emerald-300 bg-emerald-50 shadow-sm"
        : "border-emerald-100 bg-white hover:border-emerald-200 hover:bg-emerald-50/50",
      stripe: "bg-emerald-500",
    };
  }

  return {
    container: isActive
      ? "border-[#A07C3B]/35 bg-white shadow-sm"
      : "border-slate-200/70 bg-white/70 hover:border-[#A07C3B]/25 hover:bg-white",
    stripe: "bg-slate-300",
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
    return "reprogramada por Zeus";
  }

  return "aguardando decisao";
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
