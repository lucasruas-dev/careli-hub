/* eslint-disable */
// @ts-nocheck
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ClipboardList,
  DatabaseZap,
  FileText,
  Headphones,
  Inbox,
  LayoutDashboard,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  Mic,
  Network,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  Smile,
  Sparkles,
  TicketCheck,
  UsersRound,
  Workflow,
  Wifi,
} from "lucide-react";

import { getHubSupabaseClient } from "@/lib/supabase/client";

type CareDeskPageProps = {
  embedded?: boolean;
  initialTickets?: CareDeskTicket[];
  loadFromSupabase?: boolean;
};

type CareDeskView =
  | "gestao"
  | "atendimento"
  | "disparos"
  | "setup"
  | "relatorios";

type CareDeskTone = "gold" | "green" | "red" | "blue" | "neutral";
type CareDeskPriority = "low" | "medium" | "high" | "critical";
type CareDeskStatus =
  | "new"
  | "open"
  | "waiting_customer"
  | "waiting_operator"
  | "pending"
  | "resolved"
  | "closed"
  | "cancelled";

type CareDeskMessage = {
  body: string;
  createdAt: string;
  deliveryStatus: string;
  direction: "inbound" | "outbound" | "internal";
  id: string;
  senderType: "customer" | "operator" | "agent" | "system";
};

type CareDeskTicket = {
  assignedToLabel: string;
  channelId?: string | null;
  channelLabel: string;
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
  messages: CareDeskMessage[];
  openedAt: string;
  priority: CareDeskPriority;
  profileLabel: string;
  protocol: string;
  queueLabel: string;
  queueSlug?: string | null;
  resolutionDueAt?: string | null;
  sourceLabel: string;
  status: CareDeskStatus;
  subject: string;
  unread: boolean;
};

type CareDeskQueueConfig = {
  assignmentStrategy: string;
  color: string;
  defaultPriority: CareDeskPriority;
  id: string;
  name: string;
  routingStrategy: string;
  slaFirstResponseMinutes: number;
  slaResolutionMinutes: number;
  slug: string;
  status: string;
};

type CareDeskTemplate = {
  category: string;
  channelKind: string;
  id: string;
  name: string;
  slug: string;
  status: string;
};

type CareDeskBroadcast = {
  id: string;
  name: string;
  scheduledAt?: string | null;
  status: string;
};

type CareDeskData = {
  broadcasts: CareDeskBroadcast[];
  channels: Array<{ id: string; kind: string; name: string; status: string }>;
  queues: CareDeskQueueConfig[];
  templates: CareDeskTemplate[];
  tickets: CareDeskTicket[];
};

const emptyCareDeskData: CareDeskData = {
  broadcasts: [],
  channels: [],
  queues: [],
  templates: [],
  tickets: [],
};
const emptyCareDeskTickets: CareDeskTicket[] = [];

const navigationItems: Array<{
  id: CareDeskView;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "gestao", label: "Board", icon: LayoutDashboard },
  { id: "disparos", label: "Disparos", icon: Megaphone },
  { id: "setup", label: "Setup", icon: Settings2 },
  { id: "relatorios", label: "Relatorios", icon: BarChart3 },
];

const statusLabel: Record<CareDeskStatus, string> = {
  cancelled: "Cancelado",
  closed: "Fechado",
  new: "Novo",
  open: "Em atendimento",
  pending: "Pendente",
  resolved: "Resolvido",
  waiting_customer: "Aguardando cliente",
  waiting_operator: "Aguardando operador",
};

const priorityLabel: Record<CareDeskPriority, string> = {
  critical: "Critica",
  high: "Alta",
  low: "Baixa",
  medium: "Media",
};

export function CareDeskPage({
  embedded = false,
  initialTickets = emptyCareDeskTickets,
  loadFromSupabase = true,
}: CareDeskPageProps) {
  const [careDeskData, setCareDeskData] = useState<CareDeskData>({
    ...emptyCareDeskData,
    tickets: initialTickets,
  });
  const [selectedTicketId, setSelectedTicketId] = useState<string>(
    initialTickets[0]?.id ?? "",
  );
  const [activeView, setActiveView] = useState<CareDeskView>("gestao");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(loadFromSupabase);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!loadFromSupabase) {
      setCareDeskData((current) => ({
        ...current,
        tickets: initialTickets,
      }));
      setSelectedTicketId((current) => current || initialTickets[0]?.id || "");
      return;
    }

    let active = true;

    async function loadCareDesk() {
      setLoading(true);
      setLoadError(null);

      try {
        const nextData = await loadCareDeskData();

        if (!active) {
          return;
        }

        setCareDeskData(nextData);
        setSelectedTicketId((current) => current || nextData.tickets[0]?.id || "");
      } catch (error) {
        console.error("[caredesk] nao foi possivel carregar a operacao", error);
        if (active) {
          setCareDeskData(emptyCareDeskData);
          setLoadError("Nao foi possivel carregar a operacao do CareDesk.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadCareDesk();

    return () => {
      active = false;
    };
  }, [initialTickets, loadFromSupabase]);

  const selectedTicket = useMemo(() => {
    return (
      careDeskData.tickets.find((ticket) => ticket.id === selectedTicketId) ??
      careDeskData.tickets[0] ??
      null
    );
  }, [careDeskData.tickets, selectedTicketId]);

  const snapshot = useMemo(
    () => buildCareDeskSnapshot(careDeskData),
    [careDeskData],
  );

  function openAttendance(ticketId?: string) {
    const targetId = ticketId ?? selectedTicket?.id;
    if (!targetId) {
      return;
    }
    setSelectedTicketId(targetId);
    setActiveView("atendimento");
  }

  function handleLocalMessage(ticketId: string, message: CareDeskMessage) {
    setCareDeskData((current) => ({
      ...current,
      tickets: current.tickets.map((ticket) =>
        ticket.id === ticketId
          ? {
              ...ticket,
              lastMessageAt: message.createdAt,
              lastMessagePreview: message.body,
              messages: [...ticket.messages, message],
              status: ticket.status === "new" ? "open" : ticket.status,
            }
          : ticket,
      ),
    }));
  }

  return (
    <div
      className={[
        "min-h-[calc(100vh-72px)] bg-[#f3f6fa] text-[#101820]",
        embedded ? "rounded-2xl border border-[#dbe3ef]" : "",
      ].join(" ")}
    >
      <div
        className={[
          "grid min-h-[calc(100vh-72px)] transition-[grid-template-columns] duration-200",
          sidebarCollapsed
            ? "grid-cols-[72px_minmax(0,1fr)]"
            : "grid-cols-[248px_minmax(0,1fr)]",
        ].join(" ")}
      >
        <aside
          className={[
            "relative flex min-h-full flex-col border-r border-white/10 bg-[#30303d] py-4 text-white transition-all duration-200",
            sidebarCollapsed ? "px-3" : "px-4",
          ].join(" ")}
        >
          <div
            className={[
              "mb-5 flex items-center gap-3 px-2",
              sidebarCollapsed ? "flex-col justify-center px-0" : "",
            ].join(" ")}
          >
            <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-[#A07C3B] text-white shadow-sm">
              <Headphones className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#30303d] bg-emerald-400" />
            </div>
            {!sidebarCollapsed ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#c5a263]">
                  CareDesk
                </p>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((current) => !current)}
              aria-label={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
              title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
              className={[
                "grid h-8 w-8 place-items-center rounded-md border border-white/10 text-[var(--uix-text-muted)] outline-none transition hover:bg-white/[0.08] hover:text-[var(--uix-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--uix-color-focus)]",
                sidebarCollapsed ? "" : "ml-auto",
              ].join(" ")}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen aria-hidden="true" size={16} />
              ) : (
                <PanelLeftClose aria-hidden="true" size={16} />
              )}
            </button>
          </div>

          <nav className="space-y-1">
            {navigationItems.map((item) => (
              <CareDeskNavButton
                key={item.id}
                active={activeView === item.id}
                icon={item.icon}
                label={item.label}
                collapsed={sidebarCollapsed}
                onClick={() => setActiveView(item.id)}
              />
            ))}
          </nav>

          {!sidebarCollapsed ? (
            <div className="mt-auto space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/60">Operacao</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-200">
                  <Wifi className="h-3 w-3" />
                  Online
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="Tickets" value={formatCount(snapshot.total)} />
                <MiniStat label="SLA" value={formatCount(snapshot.slaCritical)} />
              </div>
            </div>
          ) : (
            <div
              title="Operacao online"
              className="mt-auto flex h-11 w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-emerald-200"
            >
              <Wifi className="h-4 w-4" />
            </div>
          )}
        </aside>

        <main className="min-w-0">
          <CareDeskTopbar activeView={activeView} snapshot={snapshot} />

          <section className="p-4">
            {loadError ? (
              <div className="rounded-2xl border border-rose-200 bg-white p-8 text-center text-sm font-semibold text-rose-700">
                {loadError}
              </div>
            ) : activeView === "gestao" ? (
              <ManagementView
                data={careDeskData}
                loading={loading}
                snapshot={snapshot}
                onOpenAttendance={openAttendance}
                onSelectTicket={setSelectedTicketId}
              />
            ) : activeView === "atendimento" ? (
              <AttendanceView
                ticket={selectedTicket}
                tickets={careDeskData.tickets}
                selectedTicketId={selectedTicket?.id ?? selectedTicketId}
                onSelectTicket={setSelectedTicketId}
                onClose={() => setActiveView("gestao")}
                onMessageCreated={handleLocalMessage}
              />
            ) : activeView === "disparos" ? (
              <BroadcastView data={careDeskData} snapshot={snapshot} />
            ) : activeView === "setup" ? (
              <SetupView data={careDeskData} snapshot={snapshot} />
            ) : (
              <ReportsView data={careDeskData} snapshot={snapshot} />
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function CareDeskTopbar({
  activeView,
  snapshot,
}: {
  activeView: CareDeskView;
  snapshot: ReturnType<typeof buildCareDeskSnapshot>;
}) {
  const titleByView: Record<CareDeskView, string> = {
    atendimento: "Atendimento",
    disparos: "Disparos em massa",
    gestao: "Tickets",
    relatorios: "Relatorios",
    setup: "Setup operacional",
  };

  return (
    <header className="sticky top-0 z-20 border-b border-[#dbe3ef] bg-white/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-4">
        <div className="min-w-[230px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#A07C3B]">
            CareDesk
          </p>
          <h2 className="text-lg font-semibold text-[#101820]">
            {titleByView[activeView]}
          </h2>
        </div>

        <label className="flex h-10 min-w-[280px] max-w-[520px] flex-1 items-center gap-2 rounded-xl border border-[#dbe3ef] bg-[#f8fafc] px-3 text-sm text-[#63708a]">
          <Search className="h-4 w-4" />
          <input
            className="w-full bg-transparent outline-none placeholder:text-[#8b97ad]"
            placeholder="Buscar ticket, cliente ou protocolo"
          />
        </label>

        <div className="ml-auto flex items-center gap-2">
          <HeaderMetric icon={Wifi} label="Operacao" value="Online" tone="green" />
          <HeaderMetric icon={TicketCheck} label="Tickets" value={formatCount(snapshot.total)} />
          <HeaderMetric
            icon={ShieldAlert}
            label="SLA critico"
            value={formatCount(snapshot.slaCritical)}
            tone="red"
          />
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
}: {
  data: CareDeskData;
  loading: boolean;
  snapshot: ReturnType<typeof buildCareDeskSnapshot>;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <SignalCard
          icon={Inbox}
          title="Entrada"
          value={`${formatCount(snapshot.inbox)} na fila`}
          tone="green"
        />
        <SignalCard
          icon={Clock3}
          title="Primeira resposta"
          value={snapshot.firstResponseLabel}
          tone="gold"
        />
        <SignalCard
          icon={Bot}
          title="Caca"
          value={`${formatCount(snapshot.aiActions)} acoes`}
          tone="blue"
        />
        <SignalCard
          icon={Route}
          title="Handoff"
          value={`${formatCount(snapshot.waitingOperator)} casos`}
          tone="neutral"
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-4">
        <div className="min-w-0">
          {loading ? (
            <CareDeskLoading />
          ) : (
            <CareDeskTicketQueue
              tickets={data.tickets}
              onOpenAttendance={onOpenAttendance}
              onSelectTicket={onSelectTicket}
            />
          )}
        </div>

        <aside className="space-y-3">
          <ActionPanel
            icon={Sparkles}
            title="Caca na fila"
            items={[
              {
                detail: snapshot.topTicket
                  ? `${snapshot.topTicket.queueLabel} | ${priorityLabel[snapshot.topTicket.priority]}`
                  : "Aguardando novos tickets",
                title: "Caso recomendado",
                value: snapshot.topTicket?.contactLabel ?? "Sem fila ativa",
              },
              {
                detail: "SLA vencido ou prioridade critica",
                title: "Tickets prioritarios",
                value: formatCount(snapshot.critical),
              },
              {
                detail: "Cliente aguardando retorno do operador",
                title: "Sem resposta",
                value: formatCount(snapshot.unanswered),
              },
            ]}
          />
          <ActionPanel
            icon={CalendarClock}
            title="Agenda operacional"
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

function CareDeskTicketQueue({
  onOpenAttendance,
  onSelectTicket,
  tickets,
}: {
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  tickets: CareDeskTicket[];
}) {
  const [queue, setQueue] = useState("Todos");
  const [status, setStatus] = useState("Todos");
  const [priority, setPriority] = useState("Todas");
  const [search, setSearch] = useState("");

  const queues = useMemo(
    () => ["Todos", ...unique(tickets.map((ticket) => ticket.queueLabel))],
    [tickets],
  );
  const statuses = useMemo(
    () => ["Todos", ...unique(tickets.map((ticket) => statusLabel[ticket.status]))],
    [tickets],
  );

  const filteredTickets = useMemo(() => {
    const normalized = search.trim().toLowerCase();

    return tickets
      .filter((ticket) => {
        const matchesSearch =
          normalized.length === 0 ||
          ticket.protocol.toLowerCase().includes(normalized) ||
          ticket.contactLabel.toLowerCase().includes(normalized) ||
          ticket.subject.toLowerCase().includes(normalized);

        return (
          matchesSearch &&
          (queue === "Todos" || ticket.queueLabel === queue) &&
          (status === "Todos" || statusLabel[ticket.status] === status) &&
          (priority === "Todas" || priorityLabel[ticket.priority] === priority)
        );
      })
      .sort(sortCareDeskTickets);
  }, [priority, queue, search, status, tickets]);

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="border-b border-slate-100 px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
              Fila operacional de tickets
            </p>
            <h2 className="mt-1 text-base font-semibold text-slate-950">
              Inbox operacional
            </h2>
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
              value={`${tickets.filter(isWaitingForCareDesk).length}`}
              tone={tickets.some(isWaitingForCareDesk) ? "danger" : "gold"}
            />
          </div>
        </div>
      </header>

      <div className="grid gap-3 p-3 2xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-3">
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
            <FilterSelect label="Fila" value={queue} options={queues} onChange={setQueue} />
            <FilterSelect label="Status" value={status} options={statuses} onChange={setStatus} />
            <FilterSelect
              label="Prioridade"
              value={priority}
              options={["Todas", "Critica", "Alta", "Media", "Baixa"]}
              onChange={setPriority}
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200/70">
            <div className="hidden grid-cols-[1fr_0.75fr_0.75fr_0.75fr_0.9fr_0.75fr_0.75fr] gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-xs font-semibold uppercase tracking-normal text-slate-400 xl:grid">
              <span>Ticket</span>
              <span>Fila</span>
              <span>Canal</span>
              <span>SLA</span>
              <span>Status</span>
              <span>Responsavel</span>
              <span className="text-right">Atendimento</span>
            </div>
            <div className="max-h-[430px] overflow-y-auto [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              {filteredTickets.length > 0 ? (
                filteredTickets.map((ticket) => (
                  <CareDeskTicketRow
                    key={ticket.id}
                    ticket={ticket}
                    onOpenAttendance={onOpenAttendance}
                    onSelectTicket={onSelectTicket}
                  />
                ))
              ) : (
                <EmptyState
                  icon={Inbox}
                  title="Nenhum ticket na fila"
                  description="Quando uma mensagem de cliente chegar ou um operador iniciar um contato, o ticket deve nascer no CareDesk."
                />
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 p-3">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-[#A07C3B]" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-950">Caca na fila</p>
            </div>
            <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-700">
              Priorizar cliente sem resposta, SLA vencendo e tickets sem responsavel. O CareDesk mede a operacao de atendimento, independente do modulo que originou o contato.
            </p>
          </div>

          <InsightCard
            title="Tickets prioritarios"
            value={`${tickets.filter((ticket) => ticket.priority === "critical" || isSlaCritical(ticket)).length}`}
            description="Prioridade critica ou SLA em risco."
          />
          <InsightCard
            title="Entrada sem dono"
            value={`${tickets.filter((ticket) => ticket.status === "waiting_operator").length}`}
            description="Tickets aguardando operador assumir."
          />
          <InsightCard
            title="Fila de suporte"
            value={`${tickets.filter((ticket) => ticket.queueSlug === "suporte").length}`}
            description="Duvidas e solicitacoes de clientes."
          />
          <InsightCard
            title="Follow-ups"
            value={`${tickets.filter(isWaitingForCareDesk).length}`}
            description="Conversas que dependem de retorno humano."
          />
        </aside>
      </div>
    </section>
  );
}

function CareDeskTicketRow({
  onOpenAttendance,
  onSelectTicket,
  ticket,
}: {
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  ticket: CareDeskTicket;
}) {
  return (
    <article
      className={`grid gap-3 border-b border-slate-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-slate-50/70 xl:grid-cols-[1fr_0.75fr_0.75fr_0.75fr_0.9fr_0.75fr_0.75fr] xl:items-center ${
        ticket.unread ? "bg-[#A07C3B]/5 shadow-[inset_3px_0_0_#A07C3B]" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => onSelectTicket(ticket.id)}
        className="min-w-0 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-[#7A5E2C]">
            {ticket.protocol}
          </span>
          {ticket.unread ? (
            <span className="rounded-full bg-[#A07C3B] px-2 py-0.5 text-[11px] font-semibold text-white shadow-[0_0_0_3px_rgba(160,124,59,0.12)]">
              nova
            </span>
          ) : null}
          <PriorityPill priority={ticket.priority} />
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-slate-950">
          {ticket.contactLabel}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {ticket.subject}
        </p>
      </button>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800">
          {ticket.queueLabel}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {ticket.profileLabel}
        </p>
      </div>

      <div className="text-sm font-medium text-slate-600">
        <p className="truncate">{ticket.channelLabel}</p>
        <p className="mt-0.5 text-xs text-slate-400">{ticket.sourceLabel}</p>
      </div>

      <div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${slaClasses(ticket)}`}>
          {slaLabel(ticket)}
        </span>
        <p className="mt-1 text-xs text-slate-400">
          {formatDateTime(ticket.openedAt)}
        </p>
      </div>

      <div>
        <StatusPill label={statusLabel[ticket.status]} tone={statusTone(ticket.status)} />
        <p className="mt-1 truncate text-xs text-slate-500">
          {ticket.lastMessagePreview}
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
  onMessageCreated,
  onSelectTicket,
  selectedTicketId,
  ticket,
  tickets,
}: {
  onClose: () => void;
  onMessageCreated: (ticketId: string, message: CareDeskMessage) => void;
  onSelectTicket: (ticketId: string) => void;
  selectedTicketId: string;
  ticket: CareDeskTicket | null;
  tickets: CareDeskTicket[];
}) {
  if (!ticket) {
    return (
      <div className="flex min-h-[620px] items-center justify-center rounded-2xl border border-[#dbe3ef] bg-white">
        <div className="text-center">
          <MessageCircle className="mx-auto h-8 w-8 text-[#A07C3B]" />
          <h3 className="mt-3 text-base font-semibold">Selecione um ticket</h3>
        </div>
      </div>
    );
  }

  return (
    <CareDeskConversationPanel
      ticket={ticket}
      tickets={tickets}
      selectedTicketId={selectedTicketId}
      onSelectTicket={onSelectTicket}
      onClose={onClose}
      onMessageCreated={onMessageCreated}
    />
  );
}

function CareDeskConversationPanel({
  onClose,
  onMessageCreated,
  onSelectTicket,
  selectedTicketId,
  ticket,
  tickets,
}: {
  onClose: () => void;
  onMessageCreated: (ticketId: string, message: CareDeskMessage) => void;
  onSelectTicket: (ticketId: string) => void;
  selectedTicketId: string;
  ticket: CareDeskTicket;
  tickets: CareDeskTicket[];
}) {
  const [conversationFilter, setConversationFilter] = useState("Abertas");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [search, setSearch] = useState("");
  const [showPreviousTickets, setShowPreviousTickets] = useState(false);
  const [conversationListCollapsed, setConversationListCollapsed] = useState(false);

  const conversations = useMemo(() => {
    const normalized = search.trim().toLowerCase();

    return tickets
      .filter((item) => {
        const matchesSearch =
          !normalized ||
          item.contactLabel.toLowerCase().includes(normalized) ||
          item.protocol.toLowerCase().includes(normalized) ||
          item.lastMessagePreview.toLowerCase().includes(normalized);

        if (!matchesSearch) {
          return false;
        }

        if (conversationFilter === "Pendentes") {
          return ["new", "waiting_operator", "waiting_customer", "pending"].includes(item.status);
        }

        if (conversationFilter === "Encerradas") {
          return isClosedTicket(item);
        }

        return !isClosedTicket(item);
      })
      .sort(sortCareDeskTickets);
  }, [conversationFilter, search, tickets]);

  const previousTickets = useMemo(() => {
    return tickets
      .filter((item) => item.id !== ticket.id)
      .filter((item) =>
        ticket.contactId
          ? item.contactId === ticket.contactId
          : item.contactLabel === ticket.contactLabel,
      )
      .sort((first, second) => dateValue(second.openedAt) - dateValue(first.openedAt));
  }, [ticket.contactId, ticket.contactLabel, ticket.id, tickets]);

  const ticketChecklist = buildTicketChecklist(ticket);
  const ticketClosed = isClosedTicket(ticket);
  const ticketIncomplete =
    !ticketClosed &&
    (ticket.status === "new" ||
      ticket.status === "waiting_operator" ||
      ticketChecklist.some((item) => !item.ok));
  const operationReady = !ticketClosed && !ticketIncomplete;
  const blockedTooltip = ticketClosed
    ? "Ticket encerrado"
    : "Complete o ticket para iniciar o atendimento.";

  async function sendMessage() {
    const body = draft.trim();

    if (!body || sending || !operationReady) {
      return;
    }

    setSending(true);
    setFeedback("");

    try {
      const supabase = getHubSupabaseClient();
      const now = new Date().toISOString();
      const optimisticMessage: CareDeskMessage = {
        body,
        createdAt: now,
        deliveryStatus: "queued",
        direction: "outbound",
        id: `local-${now}`,
        senderType: "operator",
      };

      if (supabase) {
        const { data, error } = await supabase
          .from("caredesk_messages")
          .insert({
            body,
            channel_id: ticket.channelId ?? null,
            delivery_status: "queued",
            direction: "outbound",
            message_type: "text",
            sender_type: "operator",
            sent_at: now,
            ticket_id: ticket.id,
          })
          .select("id,body,direction,sender_type,delivery_status,created_at")
          .single();

        if (error) {
          throw error;
        }

        onMessageCreated(ticket.id, mapMessageRow(data));
      } else {
        onMessageCreated(ticket.id, optimisticMessage);
      }

      setDraft("");
      setFeedback("Mensagem registrada no CareDesk.");
    } catch (error) {
      console.error("[caredesk] nao foi possivel registrar mensagem", error);
      setFeedback("Nao foi possivel registrar a mensagem agora.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="relative flex h-[calc(100vh-154px)] min-h-[660px] w-full overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <aside
        className={[
          "hidden shrink-0 border-r border-slate-100 bg-slate-50/70 transition-all duration-300 lg:flex lg:flex-col",
          conversationListCollapsed ? "w-14" : "w-72",
        ].join(" ")}
      >
        <div className={conversationListCollapsed ? "p-2" : "border-b border-slate-100 p-3"}>
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
                  <h2 className="mt-1 text-sm font-semibold text-slate-950">Conversas</h2>
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
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-950">
                      {conversation.contactLabel}
                    </p>
                    <span className="shrink-0 text-[11px] text-slate-400">
                      {conversationTime(conversation)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                    {conversation.lastMessagePreview}
                  </p>
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

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-slate-100 bg-white">
          <div className="flex flex-col gap-2 px-4 py-2.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                <MessageCircle className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-slate-950">
                  {ticket.contactLabel}
                </h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500">
                  <span>{ticket.protocol}</span>
                  <span aria-hidden="true">-</span>
                  <span>{statusLabel[ticket.status]}</span>
                  {ticketIncomplete ? (
                    <>
                      <span aria-hidden="true">-</span>
                      <span
                        title="Ticket criado e aguardando dados operacionais."
                        className="rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15"
                      >
                        Autoaberto
                      </span>
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
              <div className="flex w-fit items-center gap-1 rounded-lg border border-slate-200/70 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <button
                  type="button"
                  onClick={onClose}
                  title="Voltar para o board"
                  aria-label="Voltar para o board"
                  className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#7A5E2C]"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="Protocolo"
                  aria-label="Protocolo"
                  className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#7A5E2C]"
                >
                  <FileText className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="SLA"
                  aria-label="SLA"
                  className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-50 hover:text-[#7A5E2C]"
                >
                  <Clock3 className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </header>

        {feedback ? (
          <div className="mx-4 mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            {feedback}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/40 px-4 py-4 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          <div className="mx-auto max-w-5xl space-y-4">
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
                  <TicketSeparator key={previousTicket.id} ticket={previousTicket} compact />
                ))}
              </div>
            ) : null}

            <TicketSeparator ticket={ticket} />

            {ticket.messages.length > 0 ? (
              ticket.messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))
            ) : (
              <EmptyState
                icon={MessageCircle}
                title="Sem mensagens registradas"
                description="A conversa deste ticket ainda nao possui mensagens no CareDesk."
              />
            )}
          </div>
        </div>

        <footer className="shrink-0 border-t border-slate-100 bg-white p-2.5">
          {!operationReady ? (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
                <LockKeyhole className="size-3.5" aria-hidden="true" />
                <span>
                  {ticketClosed
                    ? "Ticket encerrado"
                    : "Complete o ticket para iniciar o atendimento"}
                </span>
              </div>
              <TicketChecklist items={ticketChecklist} />
            </div>
          ) : null}

          <div className="mb-2 flex items-center justify-between gap-2">
            <OperationalToolbar disabled={!operationReady} />
            {operationReady ? <TicketChecklist items={ticketChecklist} compact /> : null}
          </div>

          <div
            className={[
              "flex items-end gap-2 rounded-xl border border-slate-200/70 bg-slate-50/70 p-2 transition-opacity",
              operationReady ? "opacity-100" : "opacity-55",
            ].join(" ")}
          >
            <ComposerIconButton
              disabled={!operationReady}
              label="Emoji"
              onClick={() => setDraft((current) => `${current}:)`)}
            >
              <Smile className="size-4" aria-hidden="true" />
            </ComposerIconButton>
            <ComposerIconButton disabled={!operationReady} label="Anexar arquivo" onClick={() => undefined}>
              <Paperclip className="size-4" aria-hidden="true" />
            </ComposerIconButton>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={operationReady ? "Escrever mensagem WhatsApp..." : "Ticket incompleto"}
              disabled={!operationReady}
              className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            <ComposerIconButton disabled={!operationReady} label="Enviar audio" onClick={() => undefined}>
              <Mic className="size-4" aria-hidden="true" />
            </ComposerIconButton>
            <button
              type="button"
              disabled={sending || !draft.trim() || !operationReady}
              onClick={sendMessage}
              title={operationReady ? "Enviar mensagem" : blockedTooltip}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
              aria-label={operationReady ? "Enviar mensagem" : blockedTooltip}
            >
              <Send className="size-4" aria-hidden="true" />
            </button>
          </div>
        </footer>
      </main>

      <aside className="hidden w-[330px] shrink-0 border-l border-slate-100 bg-white xl:block">
        <div className="border-b border-slate-100 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                Contexto
              </p>
              <h3 className="mt-1 truncate text-sm font-semibold text-slate-950">
                {ticket.contactLabel}
              </h3>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                {ticket.contactPhone ?? "Sem telefone"}
              </p>
            </div>
            <MessageSquareText className="size-4 text-slate-300" aria-hidden="true" />
          </div>
          <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-slate-100/70 p-1">
            {[FileText, CalendarClock, ClipboardList, Clock3].map((Icon, index) => (
              <button
                key={index}
                type="button"
                className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white hover:text-[#7A5E2C]"
                aria-label="Atalho de contexto"
                title="Atalho de contexto"
              >
                <Icon className="size-4" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 space-y-2 overflow-y-auto p-3 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          <ContextItem label="Cliente" value={ticket.contactLabel} />
          <ContextItem label="Telefone" value={ticket.contactPhone ?? "-"} />
          <ContextItem label="Documento" value={ticket.contactDocument ?? "-"} />
          <ContextItem label="E-mail" value={ticket.contactEmail ?? "-"} />
          <ContextItem label="Fila" value={ticket.queueLabel} />
          <ContextItem label="Operador" value={ticket.assignedToLabel} />
          <ContextItem label="Protocolo" value={ticket.protocol} />
          <ContextItem label="Perfil" value={ticket.profileLabel} />
          <ContextItem label="SLA" value={slaLabel(ticket)} />
          <ContextItem label="Prioridade" value={priorityLabel[ticket.priority]} />
          <ContextItem label="Origem" value={ticket.sourceLabel} />
          <ContextItem label="Canal" value={ticket.channelLabel} />

          <div className="rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 p-3">
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
              Historico CareDesk
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
    </section>
  );
}

function TicketSeparator({
  compact = false,
  ticket,
}: {
  compact?: boolean;
  ticket: CareDeskTicket;
}) {
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
            {statusLabel[ticket.status]}
          </span>
        </div>
        {!compact ? (
          <>
            <p className="mt-2 text-sm font-semibold text-slate-950">{ticket.profileLabel}</p>
            <p className="mt-1 text-xs font-medium text-slate-500">
              {formatDateTime(ticket.openedAt)} - {ticket.queueLabel} - {ticket.channelLabel}
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
        <button
          key={tool.label}
          type="button"
          disabled={disabled}
          title={tool.label}
          aria-label={tool.label}
          className="flex size-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-400 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <tool.icon className="size-4" aria-hidden="true" />
        </button>
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
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-[#7A5E2C] disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
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

function BroadcastView({
  data,
  snapshot,
}: {
  data: CareDeskData;
  snapshot: ReturnType<typeof buildCareDeskSnapshot>;
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
          <SignalCard icon={Clock3} title="Janela" value="09h-18h" tone="blue" />
          <SignalCard icon={CheckCircle2} title="Aprovacao" value="Obrigatoria" tone="green" />
        </div>

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
                      {campaign.scheduledAt ? formatDateTime(campaign.scheduledAt) : "Sem agendamento"}
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
                description="Campanhas e comunicados em massa devem nascer nas tabelas de disparo do CareDesk."
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
            ["Publico", "Base de contatos do CareDesk"],
            ["Regra", "Fila + perfil + consentimento"],
            ["Canal", "Canal ativo"],
            ["Aprovacao", "Equipe Careli"],
          ]}
        />
        <BuilderCard
          icon={Bot}
          title="Caca"
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
  snapshot,
}: {
  data: CareDeskData;
  snapshot: ReturnType<typeof buildCareDeskSnapshot>;
}) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <SetupSection
        icon={Workflow}
        title="Filas"
        items={
          data.queues.length
            ? data.queues.map((queue) => [
                queue.name,
                `${priorityLabel[queue.defaultPriority]} | ${queue.slaFirstResponseMinutes} min`,
              ])
            : [["Nenhuma fila", "Configurar setup"]]
        }
      />
      <SetupSection
        icon={Route}
        title="Roteamento"
        items={[
          ["Prioridade", "Fila + perfil + SLA"],
          ["Handoff", "Modulo origem abre ticket"],
          ["Distribuicao", "Operador online"],
          ["Escalada", "Coordenacao"],
        ]}
      />
      <SetupSection
        icon={MessageSquareText}
        title="Templates"
        items={
          data.templates.length
            ? data.templates.map((template) => [
                template.name,
                `${template.category} | ${template.channelKind}`,
              ])
            : [["Nenhum template", "Configurar setup"]]
        }
      />
      <SetupSection
        icon={Clock3}
        title="SLA"
        items={[
          ["Primeira resposta", snapshot.firstResponseLabel],
          ["Critico", `${formatCount(snapshot.slaCritical)} tickets`],
          ["Sem resposta", `${formatCount(snapshot.unanswered)} tickets`],
          ["Aguardando operador", `${formatCount(snapshot.waitingOperator)} tickets`],
        ]}
      />
      <SetupSection
        icon={Network}
        title="Canais"
        items={
          data.channels.length
            ? data.channels.map((channel) => [channel.name, channel.kind])
            : [
                ["WhatsApp", "Preparado"],
                ["E-mail", "Preparado"],
                ["Web chat", "Preparado"],
                ["Telefonia", "Preparado"],
              ]
        }
      />
      <SetupSection
        icon={DatabaseZap}
        title="Dados"
        items={[
          ["CareDesk", "Tickets e auditoria"],
          ["Contatos", `${formatCount(snapshot.contacts)} registrados`],
          ["Mensagens", `${formatCount(snapshot.messages)} registradas`],
          ["Disparos", `${formatCount(data.broadcasts.length)} campanhas`],
        ]}
      />
    </div>
  );
}

function ReportsView({
  data,
  snapshot,
}: {
  data: CareDeskData;
  snapshot: ReturnType<typeof buildCareDeskSnapshot>;
}) {
  const priorityRows = [
    ["Critica", data.tickets.filter((ticket) => ticket.priority === "critical").length, snapshot.total],
    ["Alta", data.tickets.filter((ticket) => ticket.priority === "high").length, snapshot.total],
    ["Media", data.tickets.filter((ticket) => ticket.priority === "medium").length, snapshot.total],
    ["Baixa", data.tickets.filter((ticket) => ticket.priority === "low").length, snapshot.total],
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4">
      <section className="rounded-2xl border border-[#dbe3ef] bg-white p-4">
        <h3 className="mb-4 text-base font-semibold">Performance operacional</h3>
        <div className="grid grid-cols-4 gap-3">
          <SignalCard icon={TicketCheck} title="Tickets" value={formatCount(snapshot.total)} />
          <SignalCard icon={ShieldAlert} title="Criticos" value={formatCount(snapshot.critical)} tone="red" />
          <SignalCard icon={MessageCircle} title="Sem resposta" value={formatCount(snapshot.unanswered)} tone="gold" />
          <SignalCard icon={Sparkles} title="Acoes IA" value={formatCount(snapshot.aiActions)} tone="blue" />
        </div>
        <div className="mt-5 space-y-3">
          {priorityRows.map(([label, value, total]) => (
            <ProgressLine key={label} label={label} value={value} total={total} />
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
          title="Agenda operacional"
          rows={[
            ["Retornos", formatCount(snapshot.followUpsToday)],
            ["Sem resposta", formatCount(snapshot.unanswered)],
            ["Escalados", formatCount(snapshot.waitingOperator)],
            ["Caca", "Ativa"],
          ]}
        />
      </aside>
    </div>
  );
}

function CareDeskNavButton({
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
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={[
        "flex h-11 w-full items-center rounded-xl text-sm font-semibold transition",
        collapsed ? "justify-center px-0" : "gap-3 px-3",
        active
          ? "bg-[#242431] text-white shadow-[inset_3px_0_0_#A07C3B]"
          : "text-white/70 hover:bg-white/[0.06] hover:text-white",
      ].join(" ")}
    >
      <Icon className={active ? "h-4 w-4 text-[#c8a766]" : "h-4 w-4 text-white/45"} />
      {!collapsed ? <span>{label}</span> : null}
      {active && !collapsed ? (
        <ChevronRight className="ml-auto h-4 w-4 text-white/45" />
      ) : null}
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.06] p-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-white/45">{label}</p>
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
  tone?: CareDeskTone;
  value: string;
}) {
  return (
    <div className="flex h-10 min-w-[118px] items-center gap-2 rounded-xl border border-[#dbe3ef] bg-white px-3">
      <span className={["flex h-7 w-7 items-center justify-center rounded-lg", toneBg(tone)].join(" ")}>
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
  tone?: CareDeskTone;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[#dbe3ef] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className={["flex h-10 w-10 items-center justify-center rounded-xl", toneBg(tone)].join(" ")}>
          <Icon className={["h-5 w-5", toneText(tone)].join(" ")} />
        </span>
        <span className="rounded-full bg-[#f4f6fa] px-2 py-1 text-[11px] font-semibold text-[#63708a]">
          {value}
        </span>
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
    </div>
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
          <div key={item.title} className="rounded-xl border border-[#e4eaf3] bg-[#fbfcfe] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8a96aa]">
              {item.title}
            </p>
            <p className="mt-1 text-sm font-semibold">{item.value}</p>
            <p className="mt-1 line-clamp-2 text-xs text-[#63708a]">{item.detail}</p>
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
          <div key={label} className="flex items-center justify-between gap-4 py-2 text-sm">
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
    <div
      title={`${label}: ${value}`}
      className="group flex min-h-14 items-center gap-2 rounded-lg border border-slate-200/70 bg-slate-50/55 px-3 py-2 transition-colors hover:border-[#A07C3B]/20 hover:bg-white"
    >
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 transition-transform group-hover:scale-105 ${toneClass}`}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold leading-5 text-slate-950">{value}</p>
        <p className="truncate text-[11px] font-semibold uppercase tracking-normal text-slate-400">{shortLabel}</p>
      </div>
    </div>
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
      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">{title}</p>
      <p className="mt-1 text-base font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
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
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function MessageBubble({ message }: { message: CareDeskMessage }) {
  const outbound = message.direction === "outbound";
  const internal = message.direction === "internal" || message.senderType === "system";

  if (internal) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[70%] rounded-full border border-slate-200/70 bg-white px-3 py-1.5 text-center text-xs font-semibold text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          {message.body}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[72%] rounded-2xl px-4 py-3 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.05)]",
          outbound
            ? "border border-[#eadcc2] bg-[#f8f4ed] text-slate-900"
            : "border border-slate-200 bg-white text-slate-800",
        ].join(" ")}
      >
        <p className="whitespace-pre-wrap leading-6">{message.body}</p>
        <p className="mt-2 text-right text-[11px] text-slate-400">
          {formatDateTime(message.createdAt)} | {message.deliveryStatus}
        </p>
      </div>
    </div>
  );
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</p>
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
        <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function StatusPill({
  label,
  tone = "gold",
}: {
  label: string;
  tone?: "danger" | "gold" | "green" | "neutral";
}) {
  const classes =
    tone === "danger"
      ? "border-rose-100 bg-rose-50 text-rose-700"
      : tone === "green"
        ? "border-emerald-100 bg-emerald-50 text-emerald-700"
        : tone === "neutral"
          ? "border-slate-200 bg-slate-50 text-slate-600"
          : "border-[#eadcc2] bg-[#fbf6ec] text-[#8a682f]";

  return (
    <span className={`inline-flex w-fit rounded-full border px-2 py-1 text-xs font-semibold ${classes}`}>
      {label}
    </span>
  );
}

function PriorityPill({ priority }: { priority: CareDeskPriority }) {
  const classes =
    priority === "critical"
      ? "bg-rose-50 text-rose-700 ring-rose-100"
      : priority === "high"
        ? "bg-orange-50 text-orange-700 ring-orange-100"
        : priority === "medium"
          ? "bg-amber-50 text-amber-700 ring-amber-100"
          : "bg-emerald-50 text-emerald-700 ring-emerald-100";

  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${classes}`}>
      {priorityLabel[priority]}
    </span>
  );
}

function buildTicketChecklist(ticket: CareDeskTicket) {
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

function conversationTime(ticket: CareDeskTicket) {
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

function CareDeskLoading() {
  return (
    <div className="rounded-2xl border border-[#dbe3ef] bg-white p-8">
      <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-[#eadcc2] border-t-[#A07C3B]" />
      <p className="mt-3 text-center text-sm font-semibold text-[#63708a]">
        Carregando fila
      </p>
    </div>
  );
}

function toneBg(tone: CareDeskTone) {
  if (tone === "gold") return "bg-[#fbf6ec]";
  if (tone === "green") return "bg-emerald-50";
  if (tone === "red") return "bg-rose-50";
  if (tone === "blue") return "bg-sky-50";
  return "bg-[#f4f6fa]";
}

function toneText(tone: CareDeskTone) {
  if (tone === "gold") return "text-[#A07C3B]";
  if (tone === "green") return "text-emerald-600";
  if (tone === "red") return "text-rose-600";
  if (tone === "blue") return "text-sky-600";
  return "text-[#63708a]";
}

async function loadCareDeskData(): Promise<CareDeskData> {
  const supabase = getHubSupabaseClient();

  if (!supabase) {
    return emptyCareDeskData;
  }

  const [ticketsResult, queuesResult, templatesResult, channelsResult, broadcastsResult] =
    await Promise.all([
      supabase
        .from("caredesk_tickets")
        .select(
          "id,protocol,contact_id,queue_id,profile_id,channel_id,status,priority,subject,source_module,source_entity_type,source_context,assigned_to_user_id,opened_at,first_response_due_at,resolution_due_at,first_responded_at,resolved_at,closed_at,metadata,created_at,updated_at",
        )
        .order("opened_at", { ascending: false })
        .limit(200),
      supabase
        .from("caredesk_queues")
        .select(
          "id,name,slug,color,status,default_priority,sla_first_response_minutes,sla_resolution_minutes,routing_strategy,assignment_strategy",
        )
        .order("name", { ascending: true }),
      supabase
        .from("caredesk_templates")
        .select("id,name,slug,category,channel_kind,status")
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
    queuesResult,
    templatesResult,
    channelsResult,
    broadcastsResult,
  ].find((result) => result.error);

  if (failedResult?.error) {
    throw failedResult.error;
  }

  const ticketsRows = ticketsResult.data ?? [];
  const ticketIds = ticketsRows.map((ticket) => ticket.id);
  const contactIds = unique(ticketsRows.map((ticket) => ticket.contact_id).filter(Boolean));
  const profileIds = unique(ticketsRows.map((ticket) => ticket.profile_id).filter(Boolean));

  const [contactsResult, profilesResult, messagesResult] = await Promise.all([
    contactIds.length
      ? supabase
          .from("caredesk_contacts")
          .select("id,display_name,document,email,phone,whatsapp_phone")
          .in("id", contactIds)
      : Promise.resolve({ data: [], error: null }),
    profileIds.length
      ? supabase
          .from("caredesk_ticket_profiles")
          .select("id,name,category,priority")
          .in("id", profileIds)
      : Promise.resolve({ data: [], error: null }),
    ticketIds.length
      ? supabase
          .from("caredesk_messages")
          .select("id,ticket_id,body,direction,sender_type,delivery_status,created_at,sent_at")
          .in("ticket_id", ticketIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const failedNestedResult = [contactsResult, profilesResult, messagesResult].find(
    (result) => result.error,
  );

  if (failedNestedResult?.error) {
    throw failedNestedResult.error;
  }

  const queues = (queuesResult.data ?? []).map(mapQueueRow);
  const channels = (channelsResult.data ?? []).map((channel) => ({
    id: channel.id,
    kind: channel.kind,
    name: channel.name,
    status: channel.status,
  }));
  const templates = (templatesResult.data ?? []).map((template) => ({
    category: template.category,
    channelKind: template.channel_kind,
    id: template.id,
    name: template.name,
    slug: template.slug,
    status: template.status,
  }));
  const broadcasts = (broadcastsResult.data ?? []).map((broadcast) => ({
    id: broadcast.id,
    name: broadcast.name,
    scheduledAt: broadcast.scheduled_at,
    status: broadcast.status,
  }));
  const queueById = new Map(queues.map((queue) => [queue.id, queue]));
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const contactById = new Map((contactsResult.data ?? []).map((contact) => [contact.id, contact]));
  const profileById = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const messagesByTicket = groupMessagesByTicket(messagesResult.data ?? []);

  return {
    broadcasts,
    channels,
    queues,
    templates,
    tickets: ticketsRows.map((ticket) =>
      mapTicketRow({
        channel: ticket.channel_id ? channelById.get(ticket.channel_id) : null,
        contact: ticket.contact_id ? contactById.get(ticket.contact_id) : null,
        messages: messagesByTicket.get(ticket.id) ?? [],
        profile: ticket.profile_id ? profileById.get(ticket.profile_id) : null,
        queue: ticket.queue_id ? queueById.get(ticket.queue_id) : null,
        row: ticket,
      }),
    ),
  };
}

function mapQueueRow(row: any): CareDeskQueueConfig {
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

function mapTicketRow(input: {
  channel: any;
  contact: any;
  messages: CareDeskMessage[];
  profile: any;
  queue: CareDeskQueueConfig | null;
  row: any;
}): CareDeskTicket {
  const lastMessage = input.messages[input.messages.length - 1];
  const sourceModule = String(input.row.source_module ?? "").trim();

  return {
    assignedToLabel: input.row.assigned_to_user_id ? "Operador vinculado" : "Sem responsavel",
    channelId: input.row.channel_id,
    channelLabel: input.channel?.name ?? "Canal nao definido",
    contactDocument: input.contact?.document ?? null,
    contactEmail: input.contact?.email ?? null,
    contactId: input.row.contact_id,
    contactLabel: input.contact?.display_name ?? "Cliente sem cadastro",
    contactPhone: input.contact?.whatsapp_phone ?? input.contact?.phone ?? null,
    createdAt: input.row.created_at,
    firstRespondedAt: input.row.first_responded_at,
    firstResponseDueAt: input.row.first_response_due_at,
    id: input.row.id,
    lastMessageAt: lastMessage?.createdAt ?? input.row.updated_at ?? input.row.opened_at,
    lastMessagePreview: lastMessage?.body ?? "Sem mensagens registradas",
    messages: input.messages,
    openedAt: input.row.opened_at,
    priority: normalizePriority(input.row.priority),
    profileLabel: input.profile?.name ?? "Sem perfil",
    protocol: input.row.protocol,
    queueLabel: input.queue?.name ?? "Sem fila",
    queueSlug: input.queue?.slug ?? null,
    resolutionDueAt: input.row.resolution_due_at,
    sourceLabel: sourceModule ? labelForSource(sourceModule) : "Entrada direta",
    status: normalizeStatus(input.row.status),
    subject: input.row.subject ?? input.profile?.category ?? "Atendimento ao cliente",
    unread: Boolean(
      lastMessage &&
        lastMessage.direction === "inbound" &&
        !["closed", "resolved", "cancelled"].includes(input.row.status),
    ),
  };
}

function mapMessageRow(row: any): CareDeskMessage {
  return {
    body: row.body ?? "",
    createdAt: row.created_at,
    deliveryStatus: row.delivery_status ?? "queued",
    direction: row.direction ?? "internal",
    id: row.id,
    senderType: row.sender_type ?? "system",
  };
}

function groupMessagesByTicket(rows: any[]) {
  const groups = new Map<string, CareDeskMessage[]>();

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

function buildCareDeskSnapshot(data: CareDeskData) {
  const tickets = data.tickets;
  const total = tickets.length;
  const openTickets = tickets.filter((ticket) => !isClosedTicket(ticket));
  const critical = tickets.filter(
    (ticket) => ticket.priority === "critical" || isSlaCritical(ticket),
  ).length;
  const slaCritical = tickets.filter(isSlaCritical).length;
  const unanswered = tickets.filter(isWaitingForCareDesk).length;
  const waitingOperator = tickets.filter(
    (ticket) => ticket.status === "waiting_operator" || ticket.assignedToLabel === "Sem responsavel",
  ).length;
  const inbox = tickets.filter(
    (ticket) => ticket.status === "new" || ticket.status === "waiting_operator",
  ).length;
  const contacts = unique(tickets.map((ticket) => ticket.contactId).filter(Boolean)).length;
  const messages = tickets.reduce((totalMessages, ticket) => totalMessages + ticket.messages.length, 0);
  const topTicket = [...tickets].sort(scoreTicketForAction)[0] ?? null;

  return {
    aiActions: Math.max(critical + unanswered + waitingOperator, 0),
    contacts,
    critical,
    firstResponseLabel: estimateFirstResponse(tickets),
    followUpsToday: unanswered + slaCritical,
    inbox,
    messages,
    open: openTickets.length,
    slaCritical,
    topTicket,
    total,
    unanswered,
    waitingOperator,
  };
}

function scoreTicketForAction(first: CareDeskTicket, second: CareDeskTicket) {
  return ticketScore(second) - ticketScore(first);
}

function ticketScore(ticket: CareDeskTicket) {
  return (
    (ticket.priority === "critical" ? 500 : 0) +
    (ticket.priority === "high" ? 250 : 0) +
    (isSlaCritical(ticket) ? 300 : 0) +
    (isWaitingForCareDesk(ticket) ? 180 : 0) +
    (ticket.status === "waiting_operator" ? 120 : 0)
  );
}

function sortCareDeskTickets(first: CareDeskTicket, second: CareDeskTicket) {
  const scoreDifference = ticketScore(second) - ticketScore(first);
  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  return dateValue(second.openedAt) - dateValue(first.openedAt);
}

function normalizePriority(value: unknown): CareDeskPriority {
  if (value === "critical" || value === "high" || value === "medium" || value === "low") {
    return value;
  }

  return "medium";
}

function normalizeStatus(value: unknown): CareDeskStatus {
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

function isClosedTicket(ticket: CareDeskTicket) {
  return ["cancelled", "closed", "resolved"].includes(ticket.status);
}

function isClosedToday(ticket: CareDeskTicket) {
  if (!isClosedTicket(ticket)) {
    return false;
  }

  const today = new Date().toDateString();
  return new Date(ticket.lastMessageAt ?? ticket.openedAt).toDateString() === today;
}

function isWaitingForCareDesk(ticket: CareDeskTicket) {
  return (
    !isClosedTicket(ticket) &&
    (ticket.unread || ticket.status === "new" || ticket.status === "waiting_operator")
  );
}

function isSlaCritical(ticket: CareDeskTicket) {
  const due = ticket.firstRespondedAt
    ? ticket.resolutionDueAt
    : ticket.firstResponseDueAt ?? ticket.resolutionDueAt;

  if (!due || isClosedTicket(ticket)) {
    return false;
  }

  return new Date(due).getTime() <= Date.now();
}

function slaLabel(ticket: CareDeskTicket) {
  if (isClosedTicket(ticket)) {
    return "Encerrado";
  }

  const due = ticket.firstRespondedAt
    ? ticket.resolutionDueAt
    : ticket.firstResponseDueAt ?? ticket.resolutionDueAt;

  if (!due) {
    return "Sem SLA";
  }

  const diffMinutes = Math.round((new Date(due).getTime() - Date.now()) / 60000);

  if (diffMinutes <= 0) {
    return "Vencido";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} min`;
  }

  return `${Math.floor(diffMinutes / 60)}h ${diffMinutes % 60}m`;
}

function slaClasses(ticket: CareDeskTicket) {
  if (isClosedTicket(ticket)) {
    return "bg-slate-50 text-slate-600 ring-slate-200";
  }

  if (isSlaCritical(ticket)) {
    return "bg-rose-50 text-rose-700 ring-rose-100";
  }

  return "bg-emerald-50 text-emerald-700 ring-emerald-100";
}

function statusTone(status: CareDeskStatus) {
  if (status === "closed" || status === "resolved") {
    return "green";
  }

  if (status === "cancelled") {
    return "neutral";
  }

  if (status === "waiting_operator" || status === "new") {
    return "danger";
  }

  return "gold";
}

function estimateFirstResponse(tickets: CareDeskTicket[]) {
  const responded = tickets.filter((ticket) => ticket.firstRespondedAt);

  if (!responded.length) {
    return "Sem dados";
  }

  const averageMinutes =
    responded.reduce((total, ticket) => {
      return total + Math.max(0, dateValue(ticket.firstRespondedAt) - dateValue(ticket.openedAt)) / 60000;
    }, 0) / responded.length;

  return formatDuration(averageMinutes);
}

function estimateAverageResponse(tickets: CareDeskTicket[]) {
  const withMessages = tickets.filter((ticket) => ticket.messages.length > 1);

  if (!withMessages.length) {
    return "Sem dados";
  }

  const averageMinutes =
    withMessages.reduce((total, ticket) => {
      const first = ticket.messages[0];
      const last = ticket.messages[ticket.messages.length - 1];
      return total + Math.max(0, dateValue(last.createdAt) - dateValue(first.createdAt)) / 60000;
    }, 0) / withMessages.length;

  return formatDuration(averageMinutes);
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
