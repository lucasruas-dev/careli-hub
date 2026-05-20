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
import { Badge, Surface } from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Inbox,
  Loader2,
  MessageSquareReply,
  Paperclip,
  RefreshCw,
  Send,
  Sparkles,
  UserRound,
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
        scope: "all",
      });
      setTickets(nextTickets);
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
          : "Nao foi possivel carregar a fila TI.",
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
    if (!selectedTicket) {
      setDraft(emptyDraft);
      return;
    }

    setDraft({
      adminResponse: selectedTicket.adminResponse ?? "",
      approvedDeliveryDate:
        selectedTicket.approvedDeliveryDate ??
        selectedTicket.requestedDeliveryDate ??
        "",
      deliveryDecision: "manter",
      deliveryDecisionNote: selectedTicket.deliveryDecisionNote ?? "",
      resolutionSummary: selectedTicket.resolutionSummary ?? "",
      status:
        selectedTicket.status === "novo"
          ? "em_analise"
          : selectedTicket.status,
    });
  }, [selectedTicket]);

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
          Sessao ausente para abrir a fila TI.
        </div>
      </Surface>
    );
  }

  return (
    <section className="grid min-w-0 gap-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <MetricTile
          icon={<Inbox className="size-4" />}
          label="Abertos"
          value={openTickets.length}
        />
        <MetricTile
          icon={<AlertTriangle className="size-4" />}
          label="Vencem hoje"
          tone="danger"
          value={deliveryBuckets.hoje}
        />
        <MetricTile
          icon={<Clock3 className="size-4" />}
          label="1-2 dias"
          tone="warning"
          value={deliveryBuckets.proximos}
        />
        <MetricTile
          icon={<CheckCircle2 className="size-4" />}
          label="3+ dias"
          tone="success"
          value={deliveryBuckets.folga}
        />
      </div>

      <Surface
        bordered
        className="overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        <div className="grid min-h-[34rem] grid-cols-1 xl:grid-cols-[minmax(19rem,0.34fr)_minmax(0,1fr)]">
          <aside className="border-b border-slate-200/70 bg-slate-50/60 xl:border-b-0 xl:border-r">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 p-4">
              <div>
                <p className="m-0 text-xs font-semibold uppercase text-slate-500">
                  Fila Zeus
                </p>
                <h2 className="m-0 mt-1 text-base font-semibold text-slate-950">
                  TI
                </h2>
              </div>
              <button
                aria-label="Atualizar fila de tickets"
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
            </div>

            <div className="border-b border-slate-200/70 p-3">
              <p className="m-0 text-[0.68rem] font-semibold uppercase text-slate-500">
                Visao por data
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
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
            </div>

            <div className="grid grid-cols-2 gap-2 border-b border-slate-200/70 p-3">
              {ticketsByStatus.map((item) => (
                <div
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                  key={item.status}
                >
                  <p className="m-0 text-[0.68rem] font-semibold text-slate-500">
                    {hubItTicketStatusLabels[item.status]}
                  </p>
                  <p className="m-0 mt-1 text-lg font-semibold text-slate-950">
                    {item.count}
                  </p>
                </div>
              ))}
            </div>

            <div className="max-h-[38rem] overflow-y-auto p-3">
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
                draft={draft}
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
                    Nenhum protocolo TI encontrado.
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

function MetricTile({
  icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: ReactNode;
  label: string;
  tone?: "danger" | "info" | "neutral" | "success" | "warning";
  value: number | string;
}) {
  const toneClass = {
    danger: "bg-red-50 text-red-700 ring-red-100",
    info: "bg-sky-50 text-sky-700 ring-sky-100",
    neutral: "bg-slate-50 text-[#A07C3B] ring-slate-200/70",
    success: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    warning: "bg-amber-50 text-amber-700 ring-amber-100",
  }[tone];

  return (
    <Surface bordered className="border-slate-200/70 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <span className={`grid size-9 place-items-center rounded-lg ring-1 ${toneClass}`}>
          {icon}
        </span>
        <p className="m-0 text-right text-xl font-semibold text-slate-950">
          {value}
        </p>
      </div>
      <p className="m-0 mt-3 text-xs font-semibold uppercase text-slate-500">
        {label}
      </p>
    </Surface>
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
  return (
    <button
      className={`w-full rounded-xl border p-3 text-left transition ${
        isActive
          ? "border-[#A07C3B]/35 bg-white shadow-sm"
          : "border-slate-200/70 bg-white/70 hover:border-[#A07C3B]/25 hover:bg-white"
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-mono text-xs font-semibold text-[#7A5E2C]">
            {ticket.protocol}
          </p>
          <p className="m-0 mt-1 line-clamp-2 text-sm font-semibold text-slate-950">
            {ticket.title}
          </p>
        </div>
        <StatusBadge status={ticket.status} />
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
  draft,
  isSaving,
  onDraftChange,
  onSave,
  ticket,
}: {
  draft: TicketDraft;
  isSaving: boolean;
  onDraftChange: (draft: TicketDraft) => void;
  onSave: () => void;
  ticket: HubItTicket;
}) {
  return (
    <div className="grid min-w-0 gap-5 p-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
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
          </div>
          <h2 className="m-0 mt-2 text-2xl font-semibold tracking-normal text-slate-950">
            {ticket.title}
          </h2>
          <p className="m-0 mt-2 text-sm text-slate-500">
            {ticket.module} / {hubItTicketCategoryLabels[ticket.category]} /
            aberto em {formatDateTime(ticket.createdAt)}
          </p>
        </div>
        <DeliverySummaryCard ticket={ticket} />
          <div className="flex min-w-[12rem] items-center gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
          <span className="grid size-10 place-items-center rounded-full bg-[#101820] text-xs font-semibold text-white">
            {getInitials(ticket.requester.name)}
          </span>
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-slate-950">
              {ticket.requester.name}
            </p>
            <p className="m-0 truncate text-xs text-slate-500">
              {ticket.requester.email ?? "sem e-mail"}
            </p>
          </div>
        </div>
        <div className="flex min-w-[12rem] items-center gap-3 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
          <span className="grid size-10 place-items-center rounded-full bg-[#A07C3B]/15 text-xs font-semibold text-[#7A5E2C]">
            {ticket.assignedTo ? getInitials(ticket.assignedTo.name) : "--"}
          </span>
          <div className="min-w-0">
            <p className="m-0 truncate text-xs font-semibold uppercase text-slate-500">
              Tratando
            </p>
            <p className="m-0 truncate text-sm font-semibold text-slate-950">
              {ticket.assignedTo?.name ?? "Nao atribuido"}
            </p>
            <p className="m-0 truncate text-xs text-slate-500">
              {ticket.assignedTo?.email ?? "aguardando Zeus"}
            </p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.38fr)]">
        <div className="grid gap-4">
          <DetailBlock
            icon={<UserRound className="size-4" />}
            label="Relato do usuario"
            value={ticket.userDescription}
          />
          <DetailBlock
            icon={<Sparkles className="size-4" />}
            label="Leitura tecnica da Athena"
            value={ticket.technicalSummary}
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <DetailBlock
              icon={<CheckCircle2 className="size-4" />}
              label="Como deveria funcionar"
              value={ticket.expectedResult || "Nao informado."}
            />
            <DetailBlock
              icon={<AlertTriangle className="size-4" />}
              label="O que ocorreu"
              value={ticket.actualResult || "Nao informado."}
            />
          </div>
          <AttachmentsPanel attachments={ticket.attachments} />
        </div>

        <aside className="grid content-start gap-4">
          <DeliveryDecisionPanel
            draft={draft}
            onDraftChange={onDraftChange}
            ticket={ticket}
          />

          <Surface bordered className="border-slate-200/70 bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <MessageSquareReply className="size-4 text-[#A07C3B]" />
              Devolutiva do Zeus
            </div>
            <label className="mt-4 grid gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Status
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
            <label className="mt-3 grid gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Resposta para o usuario
              </span>
              <textarea
                className={`${fieldClassName} min-h-32 resize-none py-2 leading-6`}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    adminResponse: event.target.value,
                  })
                }
                placeholder="Explique o andamento, pedido de validacao ou devolutiva final."
                value={draft.adminResponse}
              />
            </label>
            <label className="mt-3 grid gap-1.5">
              <span className="text-xs font-semibold uppercase text-slate-500">
                O que foi feito
              </span>
              <textarea
                className={`${fieldClassName} min-h-24 resize-none py-2 leading-6`}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    resolutionSummary: event.target.value,
                  })
                }
                placeholder="Registre ajuste, investigacao, bloqueio ou proxima acao."
                value={draft.resolutionSummary}
              />
            </label>
            <button
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-white transition hover:bg-[#1d2634] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              onClick={onSave}
              type="button"
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Salvar decisao
            </button>
          </Surface>

          <Surface bordered className="border-slate-200/70 bg-slate-50/70 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <FileText className="size-4 text-[#A07C3B]" />
              Historico visivel
            </div>
            <div className="mt-3 grid gap-2">
              {ticket.events.length > 0 ? (
                ticket.events.map((event) => (
                  <div
                    className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600"
                    key={event.id}
                  >
                    <p className="m-0 font-semibold text-slate-950">
                      {formatDateTime(event.createdAt)}
                    </p>
                    <p className="m-0 mt-1">{event.message}</p>
                  </div>
                ))
              ) : (
                <p className="m-0 text-sm text-slate-500">
                  Sem historico registrado.
                </p>
              )}
            </div>
          </Surface>
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
    <Surface bordered className="border-slate-200/70 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <CalendarDays className="size-4 text-[#A07C3B]" />
          Data de entrega
        </div>
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
    </Surface>
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

function AttachmentsPanel({
  attachments,
}: {
  attachments: HubItTicket["attachments"];
}) {
  return (
    <Surface bordered className="border-slate-200/70 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
        <Paperclip className="size-4 text-[#A07C3B]" />
        Evidencias anexadas
      </div>
      {attachments.length > 0 ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {attachments.map((attachment) => (
            <div
              className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left transition hover:border-[#A07C3B]/30"
              key={attachment.id}
            >
              {attachment.type === "image" && attachment.dataUrl ? (
                <Image
                  alt={attachment.fileName}
                  className="h-36 w-full object-cover"
                  height={144}
                  unoptimized
                  width={320}
                  src={attachment.dataUrl}
                />
              ) : null}
              {attachment.type === "video" && attachment.dataUrl ? (
                <video
                  className="h-36 w-full bg-slate-950 object-contain"
                  controls
                  src={attachment.dataUrl}
                />
              ) : null}
              {attachment.type === "audio" && attachment.dataUrl ? (
                <div className="grid h-36 place-items-center bg-slate-100 p-3">
                  <audio className="w-full" controls src={attachment.dataUrl} />
                </div>
              ) : null}
              {!attachment.dataUrl || attachment.type === "file" ? (
                <div className="grid h-36 place-items-center bg-slate-100 text-slate-400">
                  <Paperclip className="size-7" />
                </div>
              ) : null}
              <div className="p-3">
                <p className="m-0 truncate text-sm font-semibold text-slate-950">
                  {attachment.fileName}
                </p>
                <p className="m-0 mt-1 text-xs text-slate-500">
                  {attachment.type} / {formatBytes(attachment.sizeBytes)}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 mt-3 text-sm text-slate-500">
          Nenhum print ou gravacao anexado.
        </p>
      )}
    </Surface>
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
        {isLoading ? "Carregando TI." : "Fila vazia no Zeus."}
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

function getInitials(name: string) {
  const [first = "", second = ""] = name.trim().split(/\s+/);

  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || "--";
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
