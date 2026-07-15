"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Bot, Inbox, Mail, Plus, Search } from "lucide-react";
import { Tooltip } from "@repo/uix";

import { EmptyState, FilterSelect } from "../shared/iris-ui";

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
  assignedToAvatarUrl?: string | null;
  assignedToLabel: string;
  channelKind?: string | null;
  channelLabel: string;
  closedAt?: string | null;
  contactAvatarUrl?: string | null;
  contactLabel: string;
  crm360Registration?: unknown;
  // Conversa de grupo de WhatsApp (monitoramento CACÁ, read-only).
  isGroup?: boolean;
  firstRespondedAt?: string | null;
  firstResponseDueAt?: string | null;
  hasDeliveryError?: boolean;
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
  unreadCount?: number;
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
  isCacaOwned: (ticket: IrisBoardTicket) => boolean;
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
  canSeeCacaQueue = true,
  helpers,
  onOpenAttendance,
  onSelectTicket,
  onStartAttendance,
  renderers,
  tickets,
}: {
  canSeeCacaQueue?: boolean;
  helpers: IrisTicketQueueHelpers;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  onStartAttendance: (queueLabel?: string) => void;
  renderers: IrisTicketQueueRenderers;
  tickets: IrisBoardTicket[];
}) {
  const [ownerView, setOwnerView] =
    useState<IrisTicketQueueOwnerView>("Todos");
  // A aba/fila da Caca so aparece p/ lider/coordenador/admin.
  const ownerViewOptions: readonly IrisTicketQueueOwnerView[] = canSeeCacaQueue
    ? ownerOptions
    : ownerOptions.filter((option) => option !== cacaOwnerLabel);
  const effectiveOwnerView: IrisTicketQueueOwnerView =
    ownerViewOptions.includes(ownerView) ? ownerView : "Todos";
  const [queue, setQueue] = useState("Todos");
  const [status, setStatus] = useState("Todos");
  const [priority, setPriority] = useState("Todas");
  const [search, setSearch] = useState("");
  const ownerScopedTickets = useMemo(
    () => helpers.filterTicketsByBoardOwner(tickets, effectiveOwnerView),
    [effectiveOwnerView, helpers, tickets],
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
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line/70 bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="shrink-0 border-b border-line px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">
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
                className="inline-flex size-9 items-center justify-center rounded-lg bg-[#101820] text-white shadow-sm transition-colors hover:bg-[#1f2c3a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d0ad69] dark:bg-white/[0.12] dark:text-ink dark:shadow-none dark:hover:bg-white/[0.18]"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
          <div
            className={[
              "grid gap-2 rounded-xl border border-line/70 bg-subtle/70 p-1.5",
              ownerViewOptions.length === 3 ? "grid-cols-3" : "grid-cols-2",
            ].join(" ")}
          >
            {ownerViewOptions.map((option) => {
              const active = effectiveOwnerView === option;

              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setOwnerView(option)}
                  className={[
                    "inline-flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-colors",
                    active
                      ? "bg-[#101820] text-white shadow-sm dark:bg-white/[0.14] dark:text-ink dark:shadow-none"
                      : "bg-surface text-ink-soft ring-1 ring-slate-200 hover:text-[#7A5E2C] dark:ring-white/10 dark:hover:text-[#d9b877]",
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
          <div className="grid gap-2 rounded-xl border border-line/70 bg-subtle/60 p-2 lg:grid-cols-[minmax(0,1fr)_150px_150px_150px]">
            <label className="flex h-10 items-center gap-2 rounded-lg border border-line/70 bg-surface px-3 text-sm text-ink-muted">
              <Search className="size-4 text-[#A07C3B]" aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar protocolo, cliente ou assunto..."
                className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none placeholder:text-ink-muted"
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

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line/70">
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

// Inbox: sem cabecalho de colunas (cada linha e um cartao de conversa).
// Mantido como no-op pra nao quebrar os callers (board/historico).
export function IrisTicketListHeader(_props: { showChatTitle?: boolean }) {
  return null;
}

// Iniciais do operador (1a + ultima palavra) pro avatar pequeno do responsavel.
export function operatorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (!parts.length) {
    return "?";
  }

  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";

  return (first + last).toUpperCase() || "?";
}

// Cor da pílula por fila — pra diferenciar Atendimento / Cobrança / Gurgel / Jurídico.
export function queueChipClasses(queueLabel: string): string {
  const key = queueLabel.trim().toLowerCase();

  if (key.includes("cobran")) {
    return "border-[#A07C3B]/25 bg-[#A07C3B]/10 text-[#7A5E2C] dark:border-[#A07C3B]/35 dark:bg-[#A07C3B]/15 dark:text-[#d9b877]";
  }
  if (key.includes("gurgel")) {
    return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/15 dark:text-violet-300";
  }
  if (key.includes("jurid") || key.includes("juríd")) {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/15 dark:text-rose-300";
  }
  if (key.includes("atend")) {
    return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/15 dark:text-sky-300";
  }
  if (key.includes("grupo") || key.includes("relacionament")) {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-300";
  }

  return "border-line bg-subtle text-ink-muted dark:border-white/10 dark:bg-white/[0.06] dark:text-ink-muted";
}

// Nome da CAIXA (fila) de e-mail a partir do rótulo do canal: cada caixa (contato@,
// cobranca@...) é uma fila. "E-mail Contato" -> "Contato". Regra do Lucas: mostrar a caixa,
// não o "Atendimento" genérico.
export function emailBoxLabel(channelLabel: string): string {
  const cleaned = channelLabel
    .replace(/^\s*e-?mail\s*/i, "")
    .replace(/\s*careli\s*$/i, "")
    .trim();

  return cleaned || channelLabel.trim() || "E-mail";
}

// Ticket é de e-mail? (kind do canal, com heurística no rótulo como reforço.)
export function isEmailBoardTicket(ticket: {
  channelKind?: string | null;
  channelLabel?: string | null;
}): boolean {
  return (
    ticket.channelKind === "email" ||
    Boolean(ticket.channelLabel?.toLowerCase().includes("mail"))
  );
}

// Selo de canal E-MAIL (envelope + caixa/fila), visualmente distinto do WhatsApp.
// Deixa claro "é e-mail" e de qual caixa (Contato, Cobrança...).
export function EmailChannelChip({
  boxLabel,
  size = "sm",
}: {
  boxLabel: string;
  size?: "sm" | "xs";
}) {
  return (
    <span
      title={`E-mail · ${boxLabel}`}
      className={[
        "inline-flex shrink-0 items-center gap-1 rounded-full border font-semibold uppercase tracking-wide",
        "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/15 dark:text-indigo-300",
        size === "xs"
          ? "px-1.5 py-0.5 text-[9px]"
          : "px-2 py-0.5 text-[10px]",
      ].join(" ")}
    >
      <Mail
        className={size === "xs" ? "size-3" : "size-3.5"}
        aria-hidden="true"
      />
      <span>E-mail · {boxLabel}</span>
    </span>
  );
}

// Papel do contato pro card, a partir do CRM360 do Apolo (crm360Registration).
// Regra Careli: cliente vira Comprador (tem carteira = snapshot financeiro) ou
// Prospect (sem). Demais papéis: nome curto (Imob./Incorp./Forn./Parc.).
// A bolinha de adimplência (verde/vermelho) só existe pro Comprador.
const PROFILE_PRIORITY = [
  "usuario",
  "incorporador",
  "imobiliaria",
  "corretor",
  "colaborador",
  "fornecedor",
  "parceiro",
];

const PROFILE_LABELS: Record<string, string> = {
  imobiliaria: "Imob.",
  corretor: "Corretor",
  incorporador: "Incorp.",
  colaborador: "Colab.",
  fornecedor: "Forn.",
  parceiro: "Parc.",
};

function normalizeProfileKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export type BoardCrmChip = {
  dotColor: "green" | "red" | null;
  label: string | null;
};

export function readBoardTicketCrm(value: unknown): BoardCrmChip {
  if (!value || typeof value !== "object") {
    return { dotColor: null, label: null };
  }

  const record = value as {
    delinquency?: unknown;
    profileLabel?: unknown;
    profiles?: unknown;
    status?: unknown;
  };

  if (record.status !== "registered") {
    return { dotColor: null, label: null };
  }

  const profileKeys = new Set<string>();
  if (Array.isArray(record.profiles)) {
    for (const profile of record.profiles) {
      if (typeof profile === "string" && profile.trim()) {
        profileKeys.add(normalizeProfileKey(profile));
      }
    }
  }
  if (typeof record.profileLabel === "string" && record.profileLabel.trim()) {
    profileKeys.add(normalizeProfileKey(record.profileLabel));
  }

  const delinquency =
    record.delinquency === "adimplente" || record.delinquency === "inadimplente"
      ? record.delinquency
      : null;

  const role = PROFILE_PRIORITY.find((candidate) => profileKeys.has(candidate));

  if (role === "usuario") {
    if (delinquency) {
      return {
        dotColor: delinquency === "inadimplente" ? "red" : "green",
        label: "Comprador",
      };
    }
    return { dotColor: null, label: "Prospect" };
  }

  if (role && PROFILE_LABELS[role]) {
    return { dotColor: null, label: PROFILE_LABELS[role] };
  }

  return { dotColor: null, label: null };
}

export function BoardProfileChip({ crm }: { crm: BoardCrmChip }) {
  if (!crm.label) {
    return null;
  }

  const tone =
    crm.dotColor === "red"
      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300"
      : crm.dotColor === "green"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
        : "border-line bg-surface text-ink-soft";

  return (
    <span
      title={crm.label}
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${tone}`}
    >
      {crm.label}
    </span>
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
  const slaCritical = helpers.isSlaCritical(ticket);
  // Cliente esperando a gente = ultima fala foi dele (sem prefixo).
  // Caso contrario, a ultima fala foi nossa (prefixa "Voce:"/"Caca:").
  const waitingForUs = helpers.isWaitingForIris(ticket);
  const assigneeName = (ticket.assignedToLabel ?? "").trim();
  const handledByCaca = assigneeName === "" || assigneeName === cacaOwnerLabel;
  const previewPrefix = waitingForUs ? "" : handledByCaca ? "Cacá: " : "Você: ";
  const contactName = helpers.ticketContactLabel(ticket);
  const crm = readBoardTicketCrm(ticket.crm360Registration);
  const lastMessageAt = helpers.formatDateTime(
    ticket.lastMessageAt ?? ticket.openedAt,
  );
  const timelineStartedAt = helpers.formatDateTime(ticket.openedAt);
  const timelineClosedAt = helpers.formatDateTime(
    ticket.closedAt ?? ticket.resolvedAt ?? ticket.lastMessageAt,
  );

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => {
        onSelectTicket(ticket.id);
        onOpenAttendance(ticket.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectTicket(ticket.id);
          onOpenAttendance(ticket.id);
        }
      }}
      className={`flex min-w-0 cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 transition-colors last:border-b-0 hover:bg-subtle/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#A07C3B]/30 ${
        ticket.unread ? "bg-[#A07C3B]/5 shadow-[inset_3px_0_0_#A07C3B]" : ""
      }`}
    >
      <div className="shrink-0">{renderers.renderContactAvatar(ticket, "sm")}</div>

      <div className="min-w-0 flex-1">
        {ticket.protocol ? (
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#A07C3B] tabular-nums">
            {ticket.protocol}
          </p>
        ) : null}
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`truncate text-sm text-ink ${
              ticket.unread ? "font-bold" : "font-medium"
            }`}
            title={contactName}
          >
            {contactName}
          </span>
          <BoardProfileChip crm={crm} />
          {isEmailBoardTicket(ticket) ? (
            <EmailChannelChip boxLabel={emailBoxLabel(ticket.channelLabel)} />
          ) : (
            <span
              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${queueChipClasses(
                ticket.queueLabel,
              )}`}
            >
              {ticket.queueLabel}
            </span>
          )}
          {ticket.unread ? (
            <span
              className="ml-auto size-2 shrink-0 rounded-full bg-[#A07C3B]"
              aria-label="Nao lida"
              title="Nao lida"
            />
          ) : null}
        </div>
        <p
          className={`mt-0.5 truncate text-xs ${
            ticket.unread ? "font-medium text-ink-soft" : "text-ink-muted"
          }`}
          title={ticket.lastMessagePreview}
        >
          {previewPrefix}
          {ticket.lastMessagePreview}
        </p>
        {showTimeline ? (
          <p className="mt-1 truncate text-[11px] font-medium text-ink-muted">
            Inicio: {timelineStartedAt} | Encerramento: {timelineClosedAt}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={`text-[11px] tabular-nums ${
            slaCritical ? "font-semibold text-rose-500" : "text-ink-muted"
          }`}
          title={`Última mensagem: ${lastMessageAt}`}
        >
          {lastMessageAt}
        </span>
        <div className="flex items-center gap-1.5">
          {slaCritical ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-rose-500">
              Vencido
            </span>
          ) : null}
          {renderers.renderStatusPill({
            label: helpers.statusLabel[effectiveStatus],
            tone: helpers.statusTone(effectiveStatus),
          })}
        </div>
      </div>

      <div className="shrink-0" title={handledByCaca ? "Cacá" : assigneeName}>
        {handledByCaca ? (
          <span className="flex size-6 items-center justify-center rounded-full bg-[#A07C3B]/10 text-[#7A5E2C]">
            <Bot className="size-3.5" aria-hidden="true" />
          </span>
        ) : ticket.assignedToAvatarUrl ? (
          // avatar externo (URL assinada do WhatsApp) — next/image nao se aplica
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ticket.assignedToAvatarUrl}
            alt={assigneeName}
            className="size-6 rounded-full object-cover"
          />
        ) : (
          <span className="flex size-6 items-center justify-center rounded-full border border-line bg-subtle text-[9px] font-bold text-ink-soft">
            {operatorInitials(assigneeName)}
          </span>
        )}
      </div>
    </article>
  );
}
