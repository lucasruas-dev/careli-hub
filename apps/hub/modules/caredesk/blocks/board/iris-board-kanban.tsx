"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  Inbox,
  LayoutGrid,
  List,
  Mail,
  MessageCircle,
  Plus,
  Search,
} from "lucide-react";
import { Tooltip } from "@repo/uix";

import type { IrisBoardMetrics } from "./iris-board-view";
import {
  BoardProfileChip,
  type IrisBoardTicket,
  type IrisTicketQueueHelpers,
  type IrisTicketQueueRenderers,
  IrisTicketRow,
  operatorInitials,
  queueChipClasses,
  readBoardTicketCrm,
} from "./iris-ticket-queue";
import { EmptyState, FilterSelect } from "../shared/iris-ui";

const SORT_OPTIONS = [
  "Mais recentes",
  "Mais antigos",
  "SLA vencido",
  "Prioridade",
  "Nome (A-Z)",
] as const;

type SortMode = (typeof SORT_OPTIONS)[number];

const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const cacaOwnerLabel = "Cacá";

type GroupMode = "status" | "fila" | "canal" | "operador";

const groupModes: { key: GroupMode; label: string }[] = [
  { key: "status", label: "Status" },
  { key: "fila", label: "Fila" },
  { key: "canal", label: "Canal" },
  { key: "operador", label: "Operador" },
];

type BoardColumn = {
  accent: string;
  key: string;
  label: string;
  tickets: IrisBoardTicket[];
};

// Colunas fixas do fluxo (modo status). O card "anda" sozinho conforme o status real.
const STATUS_FLOW: { accent: string; key: string; label: string }[] = [
  { accent: "#DC2626", key: "erro", label: "Erro de envio" },
  { accent: "#A07C3B", key: "caca", label: "Com a Cacá" },
  { accent: "#B45309", key: "pendente", label: "Pendente" },
  { accent: "#0F6E56", key: "aguardando", label: "Aguardando cliente" },
  { accent: "#64748B", key: "resolvido", label: "Resolvido hoje" },
];

export function IrisBoardKanban({
  helpers,
  metrics,
  onOpenAttendance,
  onSelectTicket,
  onStartAttendance,
  renderers,
  tickets,
}: {
  helpers: IrisTicketQueueHelpers;
  metrics: IrisBoardMetrics;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  onStartAttendance: (queueLabel?: string) => void;
  renderers: IrisTicketQueueRenderers;
  tickets: IrisBoardTicket[];
}) {
  const [groupMode, setGroupMode] = useState<GroupMode>("status");
  const [sortMode, setSortMode] = useState<SortMode>("Mais recentes");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"kanban" | "lista">("kanban");

  const indicators = useMemo<
    { label: string; title?: string; tone?: "danger" | "gold"; value: string }[]
  >(
    () => [
      {
        label: "Abertos",
        value: `${tickets.filter((ticket) => !helpers.isClosedTicket(ticket)).length}`,
      },
      {
        label: "SLA crítico",
        tone: "danger",
        value: `${tickets.filter(helpers.isSlaCritical).length}`,
      },
      {
        label: "1ª resposta",
        title: "Tempo até a PRIMEIRA resposta (TPR)",
        value: metrics.firstResponseLabel,
      },
      {
        label: "TDR",
        title:
          "Tempo de resposta: média de toda vez que o cliente escreve até a gente responder",
        value: metrics.responseTimeLabel,
      },
      {
        label: "Tempo médio",
        title: "Tempo médio de atendimento (TMA): da abertura ao encerramento",
        value: metrics.averageHandlingTimeLabel,
      },
      {
        label: "Sem resposta",
        tone: "gold",
        value: `${tickets.filter(helpers.isWaitingForIris).length}`,
      },
      {
        label: "Resolvido hoje",
        value: `${tickets.filter(helpers.isClosedToday).length}`,
      },
    ],
    [helpers, metrics, tickets],
  );

  const visibleTickets = useMemo(
    () => sortTickets(filterTickets(tickets, search, helpers), sortMode, helpers),
    [helpers, search, sortMode, tickets],
  );

  const columns = useMemo(
    () => buildColumns(groupMode, visibleTickets, helpers),
    [groupMode, helpers, visibleTickets],
  );

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-7">
        {indicators.map((indicator) => (
          <div
            key={indicator.label}
            title={indicator.title}
            className={`rounded-xl border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
              indicator.tone === "danger"
                ? "border-rose-100"
                : "border-slate-200/70"
            }`}
          >
            <p
              className={`truncate text-[10px] font-semibold uppercase tracking-normal ${
                indicator.tone === "danger"
                  ? "text-rose-600"
                  : indicator.tone === "gold"
                    ? "text-[#7A5E2C]"
                    : "text-slate-400"
              }`}
            >
              {indicator.label}
            </p>
            <p
              className={`mt-1 truncate text-xl font-semibold leading-none ${
                indicator.tone === "danger" ? "text-rose-600" : "text-slate-950"
              }`}
            >
              {indicator.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3">
          <Search className="size-4 shrink-0 text-[#A07C3B]" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar cliente, protocolo, assunto..."
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
          />
        </label>
        <div className="w-[168px] shrink-0">
          <FilterSelect
            label="Ordenar"
            value={sortMode}
            options={[...SORT_OPTIONS]}
            onChange={(value) => setSortMode(value as SortMode)}
          />
        </div>
        <div className="inline-flex shrink-0 rounded-lg border border-slate-200/70 bg-slate-50/70 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("kanban")}
            aria-label="Visão kanban"
            title="Kanban"
            className={[
              "flex size-7 items-center justify-center rounded-md transition-colors",
              viewMode === "kanban"
                ? "bg-[#101820] text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            ].join(" ")}
          >
            <LayoutGrid className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("lista")}
            aria-label="Visão lista"
            title="Lista"
            className={[
              "flex size-7 items-center justify-center rounded-md transition-colors",
              viewMode === "lista"
                ? "bg-[#101820] text-white shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            ].join(" ")}
          >
            <List className="size-4" aria-hidden="true" />
          </button>
        </div>
        {viewMode === "kanban" ? (
          <div className="inline-flex shrink-0 rounded-lg border border-slate-200/70 bg-slate-50/70 p-0.5">
            {groupModes.map((mode) => {
              const active = mode.key === groupMode;

              return (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => setGroupMode(mode.key)}
                  className={[
                    "rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
                    active
                      ? "bg-[#101820] text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-700",
                  ].join(" ")}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>
        ) : null}
        <Tooltip content="Novo atendimento" placement="left">
          <button
            type="button"
            aria-label="Novo atendimento"
            onClick={() => onStartAttendance()}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#101820] text-white shadow-sm transition-colors hover:bg-[#1f2c3a]"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      {viewMode === "kanban" ? (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          {columns.map((column) => (
            <BoardColumnView
              key={column.key}
              column={column}
              helpers={helpers}
              onOpenAttendance={onOpenAttendance}
              onSelectTicket={onSelectTicket}
              renderers={renderers}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white">
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
            {visibleTickets.length > 0 ? (
              visibleTickets.map((ticket) => (
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
                title="Nenhum atendimento"
                description="Quando um ticket entrar na fila, ele aparece aqui."
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function BoardColumnView({
  column,
  helpers,
  onOpenAttendance,
  onSelectTicket,
  renderers,
}: {
  column: BoardColumn;
  helpers: IrisTicketQueueHelpers;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  renderers: IrisTicketQueueRenderers;
}) {
  return (
    <div className="flex w-[264px] shrink-0 flex-col rounded-xl border border-slate-200/70 bg-slate-50/50">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: column.accent }}
            aria-hidden="true"
          />
          <span className="truncate text-xs font-semibold uppercase tracking-normal text-slate-500">
            {column.label}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
          {column.tickets.length}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
        {column.tickets.length > 0 ? (
          column.tickets.map((ticket) => (
            <BoardCard
              key={ticket.id}
              helpers={helpers}
              onOpenAttendance={onOpenAttendance}
              onSelectTicket={onSelectTicket}
              renderers={renderers}
              ticket={ticket}
            />
          ))
        ) : (
          <p className="px-1 py-6 text-center text-[11px] text-slate-300">
            Nada por aqui
          </p>
        )}
      </div>
    </div>
  );
}

// Cor da borda do card = a FILA (pra diferenciar a fila dentro de qualquer coluna).
function queueAccentColor(queueLabel: string): string {
  const key = queueLabel.trim().toLowerCase();

  if (key.includes("cobran")) {
    return "#A07C3B";
  }
  if (key.includes("gurgel")) {
    return "#7C3AED";
  }
  if (key.includes("jurid") || key.includes("juríd")) {
    return "#DC2626";
  }
  if (key.includes("atend")) {
    return "#2563EB";
  }

  return "#94A3B8";
}

function BoardCard({
  helpers,
  onOpenAttendance,
  onSelectTicket,
  renderers,
  ticket,
}: {
  helpers: IrisTicketQueueHelpers;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  renderers: IrisTicketQueueRenderers;
  ticket: IrisBoardTicket;
}) {
  const slaCritical = helpers.isSlaCritical(ticket);
  const assigneeName = (ticket.assignedToLabel ?? "").trim();
  const handledByCaca = assigneeName === "" || assigneeName === cacaOwnerLabel;
  const isEmail = ticket.channelLabel.toLowerCase().includes("mail");
  const subject = (ticket.subject ?? "").trim();
  const crm = readBoardTicketCrm(ticket.crm360Registration);
  const lastMessageAt = helpers.formatDateTime(
    ticket.lastMessageAt ?? ticket.openedAt,
  );

  const open = () => {
    onSelectTicket(ticket.id);
    onOpenAttendance(ticket.id);
  };

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      style={{ borderLeftColor: queueAccentColor(ticket.queueLabel) }}
      className="cursor-pointer rounded-lg border border-slate-200/70 border-l-[3px] bg-white px-2.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-slate-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]/30"
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {isEmail ? (
          <Mail className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
        ) : (
          <MessageCircle
            className="size-3.5 shrink-0 text-emerald-500"
            aria-hidden="true"
          />
        )}
        <span
          className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${queueChipClasses(
            ticket.queueLabel,
          )}`}
        >
          {ticket.queueLabel}
        </span>
        <BoardProfileChip crm={crm} />
      </div>

      <p className="truncate text-sm font-semibold text-slate-950">
        {helpers.ticketContactLabel(ticket)}
      </p>
      {subject ? (
        <p className="mt-0.5 truncate text-xs text-slate-500">{subject}</p>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={`truncate text-[11px] tabular-nums ${
            slaCritical ? "font-semibold text-rose-500" : "text-slate-400"
          }`}
        >
          {slaCritical ? `vencido · ${lastMessageAt}` : lastMessageAt}
        </span>
        <span
          className="shrink-0"
          title={handledByCaca ? "Cacá" : assigneeName}
        >
          {handledByCaca ? (
            <span className="flex size-5 items-center justify-center rounded-full bg-[#A07C3B]/10 text-[#7A5E2C]">
              <Bot className="size-3" aria-hidden="true" />
            </span>
          ) : ticket.assignedToAvatarUrl ? (
            <img
              src={ticket.assignedToAvatarUrl}
              alt={assigneeName}
              className="size-5 rounded-full object-cover"
            />
          ) : (
            <span className="flex size-5 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[8px] font-bold text-slate-600">
              {operatorInitials(assigneeName)}
            </span>
          )}
        </span>
      </div>
    </article>
  );
}

// Em que coluna do fluxo o ticket cai (modo status) — derivado do status real,
// sem nada manual: o card anda sozinho conforme a conversa muda.
function statusColumnKey(
  ticket: IrisBoardTicket,
  helpers: IrisTicketQueueHelpers,
): string {
  if (helpers.isClosedToday(ticket)) {
    return "resolvido";
  }
  if (ticket.hasDeliveryError) {
    return "erro";
  }
  if (helpers.isCacaOwned(ticket)) {
    return "caca";
  }
  if (helpers.effectiveIrisStatus(ticket) === "waiting_customer") {
    return "aguardando";
  }

  return "pendente";
}

function buildColumns(
  mode: GroupMode,
  tickets: IrisBoardTicket[],
  helpers: IrisTicketQueueHelpers,
): BoardColumn[] {
  if (mode === "status") {
    return STATUS_FLOW.map((flow) => ({
      ...flow,
      tickets: tickets.filter(
        (ticket) => statusColumnKey(ticket, helpers) === flow.key,
      ),
    }));
  }

  const keyOf = (ticket: IrisBoardTicket): string => {
    if (mode === "fila") {
      return ticket.queueLabel || "Sem fila";
    }
    if (mode === "canal") {
      return helpers.formatIrisChannelLabel(ticket.channelLabel) || "Canal";
    }
    const name = (ticket.assignedToLabel ?? "").trim();

    return name === "" ? cacaOwnerLabel : name;
  };

  const order: string[] = [];
  const grouped = new Map<string, IrisBoardTicket[]>();

  for (const ticket of tickets) {
    const key = keyOf(ticket);

    if (!grouped.has(key)) {
      grouped.set(key, []);
      order.push(key);
    }

    grouped.get(key)?.push(ticket);
  }

  return order.map((key) => ({
    accent: "#94A3B8",
    key,
    label: key,
    tickets: grouped.get(key) ?? [],
  }));
}

// Busca única: cliente, protocolo, assunto, fila, prévia, operador, perfil.
function filterTickets(
  tickets: IrisBoardTicket[],
  search: string,
  helpers: IrisTicketQueueHelpers,
): IrisBoardTicket[] {
  const query = search.trim().toLowerCase();

  if (!query) {
    return tickets;
  }

  return tickets.filter((ticket) =>
    [
      helpers.ticketContactLabel(ticket),
      ticket.protocol,
      ticket.subject ?? "",
      ticket.queueLabel,
      ticket.lastMessagePreview,
      ticket.assignedToLabel,
      ticket.profileLabel ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

function ticketTime(ticket: IrisBoardTicket): number {
  const value = ticket.lastMessageAt ?? ticket.openedAt;
  const time = value ? new Date(value).getTime() : 0;

  return Number.isNaN(time) ? 0 : time;
}

function sortTickets(
  tickets: IrisBoardTicket[],
  sortMode: SortMode,
  helpers: IrisTicketQueueHelpers,
): IrisBoardTicket[] {
  const list = [...tickets];

  switch (sortMode) {
    case "Mais antigos":
      return list.sort((first, second) => ticketTime(first) - ticketTime(second));
    case "SLA vencido":
      return list.sort((first, second) => {
        const firstCritical = helpers.isSlaCritical(first) ? 0 : 1;
        const secondCritical = helpers.isSlaCritical(second) ? 0 : 1;

        return (
          firstCritical - secondCritical || ticketTime(first) - ticketTime(second)
        );
      });
    case "Prioridade":
      return list.sort(
        (first, second) =>
          (PRIORITY_WEIGHT[first.priority] ?? 9) -
            (PRIORITY_WEIGHT[second.priority] ?? 9) ||
          ticketTime(second) - ticketTime(first),
      );
    case "Nome (A-Z)":
      return list.sort((first, second) =>
        helpers
          .ticketContactLabel(first)
          .localeCompare(helpers.ticketContactLabel(second)),
      );
    case "Mais recentes":
    default:
      return list.sort((first, second) => ticketTime(second) - ticketTime(first));
  }
}
