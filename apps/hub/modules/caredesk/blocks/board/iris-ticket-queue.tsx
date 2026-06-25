"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Inbox,
  MessageCircle,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  TicketCheck,
} from "lucide-react";
import { Tooltip } from "@repo/uix";

import { EmptyState, FilterSelect, KpiCard } from "../shared/iris-ui";

const cacaOwnerLabel = "Cac\u00e1";
const ownerOptions = ["Todos", cacaOwnerLabel, "Operadores"] as const;
const priorityOptions = ["Todas", "Critica", "Alta", "Media", "Baixa"];

export type IrisBoardTicketStatus =
  | "cancelled"
  | "closed"
  | "new"
  | "open"
  | "pending"
  | "resolved"
  | "waiting_customer"
  | "waiting_operator";

export type IrisBoardTicketPriority = "critical" | "high" | "low" | "medium";
export type IrisBoardTicketOrigin = "active" | "passive";
export type IrisTicketQueueOwnerView = (typeof ownerOptions)[number];
export type IrisTicketStatusTone =
  | "blue"
  | "danger"
  | "gold"
  | "green"
  | "neutral";

export type IrisBoardTicket = {
  assignedToLabel: string;
  channelLabel: string;
  closedAt?: string | null;
  contactAvatarUrl?: string | null;
  contactLabel: string;
  crm360Registration?: unknown;
  firstRespondedAt?: string | null;
  firstResponseDueAt?: string | null;
  id: string;
  lastMessageAt?: string | null;
  lastMessagePreview: string;
  metadata?: Record<string, unknown> | null;
  openedAt?: string | null;
  priority: IrisBoardTicketPriority;
  profileLabel: string;
  protocol: string;
  queueLabel: string;
  resolutionDueAt?: string | null;
  resolvedAt?: string | null;
  sourceLabel: string;
  status: IrisBoardTicketStatus;
  subject: string;
  unread?: boolean;
};

export type IrisTicketQueueHelpers = {
  effectiveIrisStatus: (ticket: IrisBoardTicket) => IrisBoardTicketStatus;
  estimateAverageResponse: (tickets: IrisBoardTicket[]) => string;
  estimateFirstResponse: (tickets: IrisBoardTicket[]) => string;
  filterTicketsByBoardOwner: (
    tickets: IrisBoardTicket[],
    ownerView: IrisTicketQueueOwnerView,
  ) => IrisBoardTicket[];
  formatDateTime: (value?: string | null) => string;
  formatIrisChannelLabel: (value: string) => string;
  isClosedTicket: (ticket: IrisBoardTicket) => boolean;
  isClosedToday: (ticket: IrisBoardTicket) => boolean;
  isSlaCritical: (ticket: IrisBoardTicket) => boolean;
  isWaitingForIris: (ticket: IrisBoardTicket) => boolean;
  priorityLabel: Record<IrisBoardTicketPriority, string>;
  slaClasses: (ticket: IrisBoardTicket) => string;
  slaLabel: (ticket: IrisBoardTicket) => string;
  sortIrisTickets: (first: IrisBoardTicket, second: IrisBoardTicket) => number;
  statusLabel: Record<IrisBoardTicketStatus, string>;
  statusTone: (status: IrisBoardTicketStatus) => IrisTicketStatusTone;
  ticketContactLabel: (ticket: IrisBoardTicket) => string;
  ticketCrmSubtitle: (ticket: IrisBoardTicket) => string;
  ticketOrigin: (ticket: IrisBoardTicket) => IrisBoardTicketOrigin;
  ticketResponseTimeLabel: (ticket: IrisBoardTicket) => string;
  ticketResponseTimeState: (ticket: IrisBoardTicket) => string;
  unique: (values: string[]) => string[];
};

export type IrisTicketQueueRenderers = {
  renderContactAvatar: (
    ticket: IrisBoardTicket,
    size: "sm" | "md" | "lg",
  ) => ReactNode;
  renderCrm360Badge: (registration: unknown, compact?: boolean) => ReactNode;
  renderOriginPill: (origin: IrisBoardTicketOrigin) => ReactNode;
  renderPriorityPill: (priority: IrisBoardTicketPriority) => ReactNode;
  renderStatusPill: (input: {
    label: string;
    tone: IrisTicketStatusTone;
  }) => ReactNode;
};

export function IrisTicketQueue({
  helpers,
  onOpenAttendance,
  onSelectTicket,
  onStartAttendance,
  renderers,
  tickets,
}: {
  helpers: IrisTicketQueueHelpers;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  onStartAttendance: (queueLabel?: string) => void;
  renderers: IrisTicketQueueRenderers;
  tickets: IrisBoardTicket[];
}) {
  const [ownerView, setOwnerView] =
    useState<IrisTicketQueueOwnerView>("Todos");
  const [queue, setQueue] = useState("Todos");
  const [status, setStatus] = useState("Todos");
  const [priority, setPriority] = useState("Todas");
  const [search, setSearch] = useState("");
  const ownerScopedTickets = useMemo(
    () => helpers.filterTicketsByBoardOwner(tickets, ownerView),
    [helpers, ownerView, tickets],
  );
  const ownerCounters = useMemo<Record<IrisTicketQueueOwnerView, number>>(
    () => ({
      [cacaOwnerLabel]: helpers.filterTicketsByBoardOwner(
        tickets,
        cacaOwnerLabel,
      ).length,
      Operadores: helpers.filterTicketsByBoardOwner(tickets, "Operadores").length,
      Todos: helpers.filterTicketsByBoardOwner(tickets, "Todos").length,
    }),
    [helpers, tickets],
  );

  const queues = useMemo(
    () => [
      "Todos",
      ...helpers.unique(ownerScopedTickets.map((ticket) => ticket.queueLabel)),
    ],
    [helpers, ownerScopedTickets],
  );
  const statuses = useMemo(
    () => [
      "Todos",
      ...helpers.unique(
        ownerScopedTickets.map(
          (ticket) => helpers.statusLabel[helpers.effectiveIrisStatus(ticket)],
        ),
      ),
    ],
    [helpers, ownerScopedTickets],
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
        const displayLabel = helpers.ticketContactLabel(ticket).toLowerCase();
        const crmSubtitle = helpers.ticketCrmSubtitle(ticket).toLowerCase();
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
            helpers.statusLabel[helpers.effectiveIrisStatus(ticket)] ===
              status) &&
          (priority === "Todas" ||
            helpers.priorityLabel[ticket.priority] === priority)
        );
      })
      .sort(helpers.sortIrisTickets);
  }, [helpers, ownerScopedTickets, priority, queue, search, status]);

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
              value={`${tickets.filter((ticket) => !helpers.isClosedTicket(ticket)).length}`}
            />
            <KpiCard
              icon={ShieldAlert}
              label="SLA critico"
              shortLabel="SLA"
              value={`${tickets.filter(helpers.isSlaCritical).length}`}
              tone="danger"
            />
            <KpiCard
              icon={Clock3}
              label="Tempo de primeira resposta"
              shortLabel="1a resp."
              value={helpers.estimateFirstResponse(tickets)}
            />
            <KpiCard
              icon={Clock3}
              label="Media de resposta"
              shortLabel="Media"
              value={helpers.estimateAverageResponse(tickets)}
            />
            <KpiCard
              icon={CheckCircle2}
              label="Encerrados hoje"
              shortLabel="Hoje"
              value={`${tickets.filter(helpers.isClosedToday).length}`}
            />
            <KpiCard
              icon={Sparkles}
              label="Sem resposta"
              shortLabel="Sem resp."
              value={`${tickets.filter(helpers.isWaitingForIris).length}`}
              tone={tickets.some(helpers.isWaitingForIris) ? "danger" : "gold"}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200/70 bg-slate-50/70 p-1.5">
            {ownerOptions.map((option) => {
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
              options={priorityOptions}
              onChange={setPriority}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200/70">
            <IrisTicketListHeader showChatTitle />
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              {filteredTickets.length > 0 ? (
                filteredTickets.map((ticket) => (
                  <IrisTicketRow
                    key={ticket.id}
                    helpers={helpers}
                    onOpenAttendance={onOpenAttendance}
                    onSelectTicket={onSelectTicket}
                    renderers={renderers}
                    ticket={ticket}
                  />
                ))
              ) : (
                <EmptyState
                  icon={Inbox}
                  title={
                    ownerView === cacaOwnerLabel
                      ? "Nenhum ticket em atendimento da Cac\u00e1"
                      : ownerView === "Operadores"
                        ? "Nenhum ticket na vis\u00e3o dos operadores"
                        : "Nenhum ticket na fila"
                  }
                  description={
                    ownerView === cacaOwnerLabel
                      ? "Quando a Cac\u00e1 estiver conduzindo atendimento passivo, os tickets aparecerao aqui."
                      : ownerView === "Operadores"
                        ? "Quando houver handoff da Cac\u00e1 ou atendimento humano em andamento, os tickets aparecerao aqui."
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

export function IrisTicketListHeader({
  showChatTitle = false,
}: {
  showChatTitle?: boolean;
}) {
  return (
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
      <span className="text-right" title={showChatTitle ? "Atendimento" : undefined}>
        Chat
      </span>
    </div>
  );
}

export function IrisTicketRow({
  helpers,
  onOpenAttendance,
  onSelectTicket,
  renderers,
  showTimeline = false,
  ticket,
}: {
  helpers: IrisTicketQueueHelpers;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  renderers: IrisTicketQueueRenderers;
  showTimeline?: boolean;
  ticket: IrisBoardTicket;
}) {
  const effectiveStatus = helpers.effectiveIrisStatus(ticket);
  const origin = helpers.ticketOrigin(ticket);
  const timelineStartedAt = helpers.formatDateTime(ticket.openedAt);
  const timelineClosedAt = helpers.formatDateTime(
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
          {renderers.renderContactAvatar(ticket, "sm")}
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
              {renderers.renderPriorityPill(ticket.priority)}
              {renderers.renderCrm360Badge(ticket.crm360Registration, true)}
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-slate-950">
              {helpers.ticketContactLabel(ticket)}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {helpers.ticketCrmSubtitle(ticket)}
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
        <p className="truncate">
          {helpers.formatIrisChannelLabel(ticket.channelLabel)}
        </p>
      </div>

      <div className="min-w-0 overflow-hidden">
        {renderers.renderStatusPill({
          label: helpers.statusLabel[effectiveStatus],
          tone: helpers.statusTone(effectiveStatus),
        })}
        {effectiveStatus === "pending" && ticket.status === "new" ? (
          <p className="mt-1 truncate text-xs text-rose-500">+3 min</p>
        ) : null}
      </div>

      <div className="min-w-0">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${helpers.slaClasses(ticket)}`}
        >
          {helpers.slaLabel(ticket)}
        </span>
        <p className="mt-1 text-xs text-slate-400">
          {helpers.formatDateTime(ticket.openedAt)}
        </p>
      </div>

      <div className="min-w-0">
        {renderers.renderOriginPill(origin)}
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
          {helpers.ticketResponseTimeLabel(ticket)}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {helpers.ticketResponseTimeState(ticket)}
        </p>
      </div>

      <p className="truncate text-sm font-medium text-slate-600">
        {ticket.assignedToLabel}
      </p>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelectTicket(ticket.id);
            onOpenAttendance(ticket.id);
          }}
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
