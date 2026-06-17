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
  type HubItTicket,
  type HubItTicketAttachmentInput,
  type HubItTicketStatus,
} from "@/lib/hub-it-tickets/types";
import { Badge, Surface, Tooltip } from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";
import {
  AlertTriangle,
  AtSign,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  History,
  ImageIcon,
  Inbox,
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
  status: "em_tratativa",
};

type DeliveryFilter = "todos" | "hoje" | "proximos" | "folga" | "sem_data";
type TicketQueueView = "fila" | "historico";
type TicketWorkflowStage =
  | "finalizado"
  | "novo"
  | "revisao"
  | "tratativa"
  | "validacao";
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

const activeWorkflowStages = [
  "novo",
  "tratativa",
  "validacao",
  "revisao",
] as const satisfies readonly TicketWorkflowStage[];

const historyWorkflowStages = [
  "finalizado",
] as const satisfies readonly TicketWorkflowStage[];

const workflowStageLabels = {
  finalizado: "Finalizado",
  novo: "Novo",
  revisao: "Revisao",
  tratativa: "Em tratativa",
  validacao: "Validacao",
} as const satisfies Record<TicketWorkflowStage, string>;

export function HubItTicketsBoard({
  accessToken,
  isActive,
  onOpenPoAi,
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
  const [loadedDetailProtocols, setLoadedDetailProtocols] = useState<
    readonly string[]
  >([]);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueView, setQueueView] = useState<TicketQueueView>("fila");
  const [searchQuery, setSearchQuery] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<
    HubItTicketAttachmentInput[]
  >([]);
  const [attentionToast, setAttentionToast] = useState<string | null>(null);
  const attentionKeysRef = useRef<ReadonlySet<string>>(new Set());

  const activeQueueTickets = useMemo(
    () => tickets.filter(isTicketInActiveQueue),
    [tickets],
  );
  const historyTickets = useMemo(
    () => tickets.filter(isTicketInHistory),
    [tickets],
  );
  const visibleQueueTickets =
    queueView === "fila" ? activeQueueTickets : historyTickets;
  const filteredQueueTickets = useMemo(
    () => filterTicketsBySearch(visibleQueueTickets, searchQuery),
    [searchQuery, visibleQueueTickets],
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
  const historyBuckets = useMemo(() => {
    return {
      finalizados: historyTickets.length,
    };
  }, [historyTickets]);
  const workflowCounts = useMemo(
    () => countTicketsByWorkflowStage(tickets),
    [tickets],
  );
  const operatorAttentionTickets = useMemo(
    () =>
      activeQueueTickets.filter((ticket) => {
        const stage = getTicketWorkflowStage(ticket.status);

        return stage === "novo" || stage === "tratativa" || stage === "revisao";
      }),
    [activeQueueTickets],
  );
  const ticketsByDelivery = useMemo(() => {
    if (queueView === "historico") {
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
    ticketsByDelivery.find((ticket) => ticket.protocol === selectedProtocol) ??
    ticketsByDelivery[0] ??
    null;
  const selectedTicketDraftProtocol = selectedTicket?.protocol ?? null;
  const selectedTicketDraftStatus = selectedTicket?.status ?? null;
  const selectedTicketDraftApprovedDeliveryDate =
    selectedTicket?.approvedDeliveryDate ?? null;
  const selectedTicketDraftRequestedDeliveryDate =
    selectedTicket?.requestedDeliveryDate ?? null;

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
    onTicketCountChange?.(activeQueueTickets.length);
  }, [activeQueueTickets.length, onTicketCountChange]);

  useEffect(() => {
    onTicketAttentionCountChange?.(operatorAttentionTickets.length);
  }, [onTicketAttentionCountChange, operatorAttentionTickets.length]);

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
    if (!selectedTicketDraftProtocol || !selectedTicketDraftStatus) {
      setDraft(emptyDraft);
      setReplyAttachments([]);
      return;
    }

    setReplyAttachments([]);
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
          ? "em_tratativa"
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

  async function saveReply(nextStatus: HubItTicketStatus = "em_tratativa") {
    if (!selectedTicket) {
      return;
    }

    const hasDeliveryDecision = draft.deliveryDecision !== "manter";

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
      replyAttachments.length === 0
    ) {
      setError("Escreva uma devolutiva, resumo, decisao de data ou anexe uma evidencia.");
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
          deliveryDecision:
            draft.deliveryDecision === "manter"
              ? undefined
              : draft.deliveryDecision,
          deliveryDecisionNote: hasDeliveryDecision
            ? draft.deliveryDecisionNote
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
      setDraft({
        ...emptyDraft,
        approvedDeliveryDate:
          updatedTicket.approvedDeliveryDate ??
          updatedTicket.requestedDeliveryDate ??
          "",
        status:
          updatedTicket.status === "novo"
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
        className="border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        <div className="grid min-h-[calc(100vh-13rem)] grid-cols-1 xl:grid-cols-[minmax(19rem,23rem)_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-slate-200/70 bg-slate-50/60 xl:sticky xl:top-4 xl:max-h-[calc(100vh-8rem)] xl:border-b-0 xl:border-r">
            <div className="border-b border-slate-200/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="m-0 text-xs font-semibold uppercase text-slate-500">
                    HelpDesk
                  </p>
                  <h2 className="m-0 mt-1 text-base font-semibold text-slate-950">
                    {queueView === "fila" ? "Fila ativa" : "Historico"}
                  </h2>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {onOpenPoAi ? (
                    <Tooltip content="PO AI" placement="left">
                      <button
                        aria-label="Abrir PO AI"
                        className="grid size-9 place-items-center rounded-lg border border-[#A07C3B]/25 bg-white text-[#7A5E2C] transition hover:border-[#A07C3B]/40 hover:bg-[#A07C3B]/5"
                        onClick={onOpenPoAi}
                        type="button"
                      >
                        <Sparkles className="size-4" />
                      </button>
                    </Tooltip>
                  ) : null}
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
              </div>
              <label className="mt-3 flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.03)] focus-within:border-[#A07C3B]/45 focus-within:ring-2 focus-within:ring-[#A07C3B]/10">
                <Search className="size-4 shrink-0 text-slate-400" />
                <input
                  aria-label="Buscar ticket, colaborador ou assunto"
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Ticket, colaborador ou assunto"
                  type="search"
                  value={searchQuery}
                />
                {searchQuery.trim() ? (
                  <button
                    aria-label="Limpar busca"
                    className="grid size-6 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => setSearchQuery("")}
                    type="button"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </label>
            </div>

            {queueView === "fila" ? (
              <QueueDisclosureSection
                isExpanded={isQueueDatesExpanded}
                onToggle={() => setIsQueueDatesExpanded((current) => !current)}
                summary={getDeliveryFilterSummary(
                  deliveryFilter,
                  activeQueueTickets.length,
                  deliveryBuckets,
                )}
                title="Entrega"
              >
                <div className="grid grid-cols-2 gap-2">
                  <DeliveryFilterButton
                    active={deliveryFilter === "todos"}
                    label={`Todos ${activeQueueTickets.length}`}
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
            ) : null}

            <div className="border-b border-slate-200/70 p-3">
              <div className="grid grid-cols-2 gap-2">
                <QueueViewButton
                  active={queueView === "fila"}
                  icon={<Inbox className="size-4" />}
                  label="Fila"
                  onClick={() => setQueueView("fila")}
                  value={activeQueueTickets.length}
                />
                <QueueViewButton
                  active={queueView === "historico"}
                  icon={<History className="size-4" />}
                  label="Historico"
                  onClick={() => setQueueView("historico")}
                  value={historyTickets.length}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <QueueSummaryPill
                  label={searchQuery.trim() ? "resultado" : queueView === "fila" ? "ativos" : "historico"}
                  value={ticketsByDelivery.length}
                />
                {queueView === "fila" ? (
                  <>
                    <QueueSummaryPill
                      label="data"
                      tone="danger"
                      value={deliveryBuckets.hoje}
                    />
                    <QueueSummaryPill
                      label="validacao"
                      tone="success"
                      value={workflowCounts.validacao}
                    />
                    <QueueSummaryPill
                      label="revisao"
                      tone="warning"
                      value={workflowCounts.revisao}
                    />
                  </>
                ) : (
                  <>
                    <QueueSummaryPill
                      label="finalizados"
                      tone="success"
                      value={historyBuckets.finalizados}
                    />
                  </>
                )}
              </div>
            </div>

            <QueueDisclosureSection
              isExpanded={isQueueMetricsExpanded}
              onToggle={() =>
                setIsQueueMetricsExpanded((current) => !current)
              }
              summary={`${filteredQueueTickets.length} ${queueView === "fila" ? "em acao" : "no historico"}`}
              title="Fluxo"
            >
              <WorkflowSummaryGrid counts={workflowCounts} />
            </QueueDisclosureSection>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-6">
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
                <EmptyQueue isLoading={isLoading} view={queueView} />
              )}
            </div>
          </aside>

          <div className="min-w-0">
            {error ? (
              <OperationalErrorBanner message={error} />
            ) : null}

            {queueView === "historico" ? (
              <TicketHistoryTable
                onSelectTicket={setSelectedProtocol}
                selectedProtocol={selectedTicket?.protocol ?? null}
                tickets={ticketsByDelivery}
              />
            ) : (
              <TicketKanbanBoard
                onSelectTicket={setSelectedProtocol}
                queueView={queueView}
                selectedProtocol={selectedTicket?.protocol ?? null}
                tickets={ticketsByDelivery}
              />
            )}

            {selectedTicket ? (
              <TicketWorkspace
                accessToken={accessToken}
                draft={draft}
                isDetailLoading={isDetailLoading}
                isSaving={isSaving}
                onDraftChange={setDraft}
                onReplyAttachmentsChange={setReplyAttachments}
                onSave={(nextStatus) => void saveReply(nextStatus)}
                replyAttachments={replyAttachments}
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

function WorkflowSummaryGrid({
  counts,
}: {
  counts: Record<TicketWorkflowStage, number>;
}) {
  const items = [
    { stage: "novo", tone: "neutral" },
    { stage: "tratativa", tone: "danger" },
    { stage: "validacao", tone: "success" },
    { stage: "revisao", tone: "warning" },
    { stage: "finalizado", tone: "success" },
  ] as const satisfies readonly {
    stage: TicketWorkflowStage;
    tone: "danger" | "neutral" | "success" | "warning";
  }[];

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <QueueMetric
          key={item.stage}
          label={workflowStageLabels[item.stage]}
          tone={item.tone}
          value={counts[item.stage]}
        />
      ))}
    </div>
  );
}

function TicketKanbanBoard({
  onSelectTicket,
  queueView,
  selectedProtocol,
  tickets,
}: {
  onSelectTicket: (protocol: string) => void;
  queueView: TicketQueueView;
  selectedProtocol: string | null;
  tickets: HubItTicket[];
}) {
  const stages =
    queueView === "fila" ? activeWorkflowStages : historyWorkflowStages;

  return (
    <div className="border-b border-slate-200/70 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 mt-1 text-base font-semibold text-slate-950">
            {queueView === "fila"
              ? "Novo / Tratativa / Validacao / Revisao"
              : "Historico de finalizados"}
          </h3>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {tickets.length} ticket(s)
        </span>
      </div>
      <div
        className={`grid gap-3 ${
          queueView === "fila"
            ? "lg:grid-cols-4"
            : "lg:grid-cols-1"
        }`}
      >
        {stages.map((stage) => {
          const columnTickets = tickets.filter(
            (ticket) => getTicketWorkflowStage(ticket.status) === stage,
          );

          return (
            <KanbanColumn
              key={stage}
              onSelectTicket={onSelectTicket}
              selectedProtocol={selectedProtocol}
              stage={stage}
              tickets={columnTickets}
            />
          );
        })}
      </div>
    </div>
  );
}

function TicketHistoryTable({
  onSelectTicket,
  selectedProtocol,
  tickets,
}: {
  onSelectTicket: (protocol: string) => void;
  selectedProtocol: string | null;
  tickets: HubItTicket[];
}) {
  return (
    <div className="border-b border-slate-200/70 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="m-0 text-base font-semibold text-slate-950">
          Historico de finalizados
        </h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {tickets.length} ticket(s)
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div
          className="hidden grid-cols-[9rem_minmax(12rem,1fr)_12rem_9rem_9rem] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[0.68rem] font-semibold uppercase text-slate-500 lg:grid"
          role="row"
        >
          <span>Ticket</span>
          <span>Assunto</span>
          <span>Colaborador</span>
          <span>Evidencias</span>
          <span>Atualizacao</span>
        </div>
        {tickets.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {tickets.map((ticket) => {
              const isSelected = ticket.protocol === selectedProtocol;

              return (
                <button
                  className={`grid w-full gap-2 px-3 py-3 text-left transition lg:grid-cols-[9rem_minmax(12rem,1fr)_12rem_9rem_9rem] lg:items-center lg:gap-3 ${
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
                    <span className="mt-1 block text-[0.68rem] font-semibold uppercase text-slate-400 lg:hidden">
                      Ticket
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {ticket.title}
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-500">
                      {ticket.module} / {hubItTicketCategoryLabels[ticket.category]}
                    </span>
                  </span>
                  <span className="min-w-0 text-sm font-medium">
                    <span className="block truncate">{ticket.requester.name}</span>
                    <span className="mt-1 block truncate text-xs text-slate-400">
                      {ticket.assignedTo?.name ?? "Sem responsavel"}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-slate-600">
                    {getTicketEvidenceCount(ticket)}
                  </span>
                  <span className="text-xs font-medium text-slate-500">
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
                Historico vazio.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({
  onSelectTicket,
  selectedProtocol,
  stage,
  tickets,
}: {
  onSelectTicket: (protocol: string) => void;
  selectedProtocol: string | null;
  stage: TicketWorkflowStage;
  tickets: HubItTicket[];
}) {
  return (
    <section className="min-h-40 rounded-xl border border-slate-200 bg-slate-50/70 p-2">
      <div className="flex items-center justify-between gap-2 px-1 py-1">
        <p className="m-0 text-xs font-semibold uppercase text-slate-500">
          {workflowStageLabels[stage]}
        </p>
        <span className="rounded-full bg-white px-2 py-0.5 text-[0.68rem] font-semibold text-slate-500 ring-1 ring-slate-200">
          {tickets.length}
        </span>
      </div>
      <div className="mt-2 grid max-h-[22rem] gap-2 overflow-y-auto pr-1">
        {tickets.length > 0 ? (
          tickets.map((ticket) => (
            <KanbanTicketCard
              isActive={ticket.protocol === selectedProtocol}
              key={ticket.id}
              onClick={() => onSelectTicket(ticket.protocol)}
              ticket={ticket}
            />
          ))
        ) : (
          <p className="m-0 rounded-lg border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-xs font-semibold text-slate-400">
            Sem tickets aqui.
          </p>
        )}
      </div>
    </section>
  );
}

function KanbanTicketCard({
  isActive,
  onClick,
  ticket,
}: {
  isActive: boolean;
  onClick: () => void;
  ticket: HubItTicket;
}) {
  const stage = getTicketWorkflowStage(ticket.status);
  const stageClass =
    stage === "validacao" || stage === "finalizado"
      ? "border-emerald-100 bg-emerald-50/70"
      : stage === "revisao"
        ? "border-amber-100 bg-amber-50/70"
        : "border-slate-200 bg-white";

  return (
    <button
      className={`rounded-lg border p-3 text-left transition hover:border-[#A07C3B]/30 ${
        isActive ? "ring-2 ring-[#A07C3B]/25" : stageClass
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="mb-2">
        <DeliveryDueBadge ticket={ticket} variant="prominent" />
      </div>
      <div className="flex items-start justify-between gap-2">
        <p className="m-0 font-mono text-xs font-semibold text-[#7A5E2C]">
          {ticket.protocol}
        </p>
      </div>
      <p className="m-0 mt-2 line-clamp-2 text-sm font-semibold text-slate-950">
        {ticket.title}
      </p>
      <p className="m-0 mt-2 truncate text-xs text-slate-500">
        {ticket.requester.name}
      </p>
    </button>
  );
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

function QueueViewButton({
  active,
  icon,
  label,
  onClick,
  value,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  value: number;
}) {
  return (
    <button
      aria-pressed={active}
      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition ${
        active
          ? "border-[#A07C3B]/40 bg-[#A07C3B]/10 text-slate-950 shadow-sm"
          : "border-slate-200 bg-white text-slate-500 hover:border-[#A07C3B]/25 hover:text-slate-950"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        <span
          className={`grid size-7 shrink-0 place-items-center rounded-lg ${
            active ? "bg-[#101820] text-white" : "bg-slate-100 text-slate-500"
          }`}
        >
          {icon}
        </span>
        <span className="truncate text-xs font-semibold uppercase">
          {label}
        </span>
      </span>
      <span className="font-mono text-sm font-semibold">{value}</span>
    </button>
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
  const queueTone = getTicketQueueToneClass(ticket, isActive);

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
      <div className="mb-2 pl-3">
        <DeliveryDueBadge ticket={ticket} variant="prominent" />
      </div>
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
            onReplyAttachmentsChange={onReplyAttachmentsChange}
            onSave={onSave}
            replyAttachments={replyAttachments}
            ticketProtocol={ticket.protocol}
          />
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
    { id: "novo", label: "Novo" },
    { id: "em_tratativa", label: "Em tratativa" },
    { id: "aguardando_cliente", label: "Validacao" },
    { id: "em_revisao", label: "Revisao" },
    { id: "fechado", label: "Finalizado" },
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
          {event.message}
        </p>
      </div>
    </div>
  );
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
  onReplyAttachmentsChange,
  onSave,
  replyAttachments,
  ticketProtocol,
}: {
  accessToken: string | null;
  draft: TicketDraft;
  isSaving: boolean;
  onDraftChange: (draft: TicketDraft) => void;
  onReplyAttachmentsChange: Dispatch<
    SetStateAction<HubItTicketAttachmentInput[]>
  >;
  onSave: (nextStatus: HubItTicketStatus) => void;
  replyAttachments: HubItTicketAttachmentInput[];
  ticketProtocol: string;
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
  }, [stopRecording, ticketProtocol]);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, [stopRecording]);

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
        <Tooltip content="Registrar devolutiva" placement="left">
          <button
            aria-label="Registrar devolutiva"
            className="grid size-9 place-items-center rounded-lg bg-[#101820] text-white transition hover:bg-[#1d2634] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            onClick={() => onSave("em_tratativa")}
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
        <Tooltip content="Manter em tratativa" placement="top">
          <button
            aria-label="Manter em tratativa"
            className="grid size-10 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:border-[#A07C3B]/30 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            onClick={() => onSave("em_tratativa")}
            type="button"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
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

function EmptyQueue({
  isLoading,
  view,
}: {
  isLoading: boolean;
  view: TicketQueueView;
}) {
  const message =
    view === "fila" ? "Fila vazia." : "Historico vazio.";

  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-5 text-center">
      {isLoading ? (
        <Loader2 className="mx-auto size-5 animate-spin text-slate-400" />
      ) : (
        <Inbox className="mx-auto size-6 text-slate-300" />
      )}
      <p className="m-0 mt-3 text-sm font-semibold text-slate-500">
        {isLoading ? "Carregando HelpDesk." : message}
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
  const stage = getTicketWorkflowStage(status);

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

function filterTicketsBySearch(tickets: HubItTicket[], query: string) {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery) {
    return tickets;
  }

  return tickets.filter((ticket) =>
    getTicketSearchText(ticket).includes(normalizedQuery),
  );
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

function getTicketEvidenceCount(ticket: HubItTicket) {
  return ticket.attachments.length;
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

function sortTicketsByUpdatedAt(tickets: HubItTicket[]) {
  return [...tickets].sort(
    (firstTicket, secondTicket) =>
      new Date(secondTicket.updatedAt).getTime() -
      new Date(firstTicket.updatedAt).getTime(),
  );
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
  const stage = getTicketWorkflowStage(status);

  if (stage === "tratativa") {
    return "em_tratativa";
  }

  if (stage === "validacao") {
    return "aguardando_cliente";
  }

  if (stage === "revisao") {
    return "em_revisao";
  }

  if (stage === "finalizado") {
    return "fechado";
  }

  return "novo";
}

function getTicketWorkflowStage(status: HubItTicketStatus): TicketWorkflowStage {
  if (status === "novo") {
    return "novo";
  }

  if (status === "aguardando_cliente" || status === "resolvido") {
    return "validacao";
  }

  if (status === "em_revisao") {
    return "revisao";
  }

  if (status === "fechado") {
    return "finalizado";
  }

  return "tratativa";
}

function countTicketsByWorkflowStage(
  tickets: HubItTicket[],
): Record<TicketWorkflowStage, number> {
  return tickets.reduce<Record<TicketWorkflowStage, number>>(
    (counts, ticket) => {
      counts[getTicketWorkflowStage(ticket.status)] += 1;

      return counts;
    },
    {
      finalizado: 0,
      novo: 0,
      revisao: 0,
      tratativa: 0,
      validacao: 0,
    },
  );
}

function isTicketInHistory(ticket: HubItTicket) {
  return !isTicketInActiveQueue(ticket);
}

function isTicketInActiveQueue(ticket: HubItTicket) {
  const stage = getTicketWorkflowStage(ticket.status);

  return (
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
  const stage = getTicketWorkflowStage(ticket.status);

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

function getTicketQueueToneClass(
  ticket: HubItTicket,
  isActive: boolean,
) {
  const stage = getTicketWorkflowStage(ticket.status);

  if (stage === "validacao" || stage === "finalizado") {
    return {
      container: isActive
        ? "border-emerald-300 bg-emerald-50 shadow-sm"
        : "border-emerald-100 bg-white hover:border-emerald-200 hover:bg-emerald-50/50",
      stripe: "bg-emerald-500",
    };
  }

  const bucket = getTicketDeliveryBucket(ticket);

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
