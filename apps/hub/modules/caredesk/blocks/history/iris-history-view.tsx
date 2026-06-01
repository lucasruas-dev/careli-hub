"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3, Search } from "lucide-react";

import {
  IrisTicketListHeader,
  IrisTicketRow,
  type IrisBoardTicket,
  type IrisTicketQueueHelpers,
  type IrisTicketQueueRenderers,
} from "../board/iris-ticket-queue";
import { EmptyState, FilterSelect } from "../shared/iris-ui";

export type IrisHistoryFocus = {
  contactId?: string | null;
  contactLabel?: string | null;
  contactPhone?: string | null;
  requestedAt: number;
};

export type IrisHistoryTicket = IrisBoardTicket & {
  contactId?: string | null;
  contactPhone?: string | null;
};

export type IrisHistoryViewHelpers = {
  dateValue: (value?: string | null) => number;
  formatCount: (value: number) => string;
  isClosedTicket: (ticket: IrisHistoryTicket) => boolean;
  ticketContactLabel: (ticket: IrisHistoryTicket) => string;
  ticketCrmSubtitle: (ticket: IrisHistoryTicket) => string;
  ticketMatchesHistoryFocus: (
    ticket: IrisHistoryTicket,
    focus: IrisHistoryFocus | null,
  ) => boolean;
  unique: <T>(values: T[]) => T[];
};

const emptyHistoryTickets: IrisHistoryTicket[] = [];

export function IrisHistoryView({
  focus,
  helpers,
  onClearFocus,
  onOpenAttendance,
  onSelectTicket,
  renderers,
  ticketQueueHelpers,
  tickets,
}: {
  focus: IrisHistoryFocus | null;
  helpers: IrisHistoryViewHelpers;
  onClearFocus: () => void;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  renderers: IrisTicketQueueRenderers;
  ticketQueueHelpers: IrisTicketQueueHelpers;
  tickets: IrisHistoryTicket[];
}) {
  const [queue, setQueue] = useState("Todas as filas");
  const [search, setSearch] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const closedTickets = useMemo(
    () => tickets.filter((ticket) => helpers.isClosedTicket(ticket)),
    [helpers, tickets],
  );
  const focusTickets = useMemo(() => {
    if (!focus) {
      return emptyHistoryTickets;
    }

    return tickets.filter((ticket) =>
      helpers.ticketMatchesHistoryFocus(ticket, focus),
    );
  }, [focus, helpers, tickets]);
  const sourceTickets = focus ? focusTickets : closedTickets;
  const focusedContactClosedCount = useMemo(
    () => focusTickets.filter((ticket) => helpers.isClosedTicket(ticket)).length,
    [focusTickets, helpers],
  );
  const queues = useMemo(
    () => [
      "Todas as filas",
      ...helpers.unique(sourceTickets.map((ticket) => ticket.queueLabel)),
    ],
    [helpers, sourceTickets],
  );

  useEffect(() => {
    if (!focus) {
      return;
    }

    setQueue("Todas as filas");
    setSearch(focus.contactLabel ?? focus.contactPhone ?? "");
  }, [focus]);

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
        const displayLabel = helpers.ticketContactLabel(ticket).toLowerCase();
        const crmSubtitle = helpers.ticketCrmSubtitle(ticket).toLowerCase();
        const ticketStartAt = helpers.dateValue(ticket.openedAt);
        const ticketEndAt = helpers.dateValue(
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
          helpers.dateValue(
            second.closedAt ??
              second.resolvedAt ??
              second.lastMessageAt ??
              second.openedAt,
          ) -
          helpers.dateValue(
            first.closedAt ??
              first.resolvedAt ??
              first.lastMessageAt ??
              first.openedAt,
          ),
      );
  }, [helpers, periodEnd, periodStart, queue, search, sourceTickets]);

  const focusedContactLabel =
    focus?.contactLabel ?? focus?.contactPhone ?? null;
  const headerDescription = focus
    ? "Tickets do cliente em andamento e encerrados no Iris."
    : "Tickets encerrados saem do Board e ficam consultaveis aqui.";
  const headerBadgeLabel = focus
    ? `${helpers.formatCount(sourceTickets.length)} tickets do cliente`
    : `${helpers.formatCount(closedTickets.length)} encerrados`;

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
              {helpers.formatCount(focusedContactClosedCount)}.
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
          <IrisTicketListHeader />
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
            {filteredTickets.length > 0 ? (
              filteredTickets.map((ticket) => (
                <IrisTicketRow
                  key={ticket.id}
                  helpers={ticketQueueHelpers}
                  ticket={ticket}
                  onOpenAttendance={onOpenAttendance}
                  onSelectTicket={onSelectTicket}
                  renderers={renderers}
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
