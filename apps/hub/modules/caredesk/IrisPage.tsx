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
  FileText,
  Headphones,
  Inbox,
  LayoutDashboard,
  LayoutGrid,
  LockKeyhole,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  Mic,
  Network,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Route,
  Save,
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
import { Tooltip } from "@repo/uix";

import { PanteonTopbarUser } from "@/components/panteon/panteon-topbar-user";
import {
  playIrisInboundSound,
  registerIrisNotificationPermissionIntent,
  showBrowserIrisNotification,
} from "@/lib/iris/notification-effects";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/auth-provider";

type IrisPageProps = {
  embedded?: boolean;
  initialTickets?: IrisTicket[];
  loadFromSupabase?: boolean;
};

type IrisView =
  | "gestao"
  | "atendimento"
  | "disparos"
  | "setup"
  | "relatorios";

type IrisTone = "gold" | "green" | "red" | "blue" | "neutral";
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
  body: string;
  createdAt: string;
  deliveryStatus: string;
  direction: "inbound" | "outbound" | "internal";
  externalMessageId?: string | null;
  id: string;
  readAt?: string | null;
  deliveredAt?: string | null;
  senderLabel?: string | null;
  senderType: "customer" | "operator" | "agent" | "system";
  sentAt?: string | null;
};

type IrisTicket = {
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
  messages: IrisMessage[];
  openedAt: string;
  priority: IrisPriority;
  profileLabel: string;
  protocol: string;
  queueLabel: string;
  queueSlug?: string | null;
  resolutionDueAt?: string | null;
  sourceLabel: string;
  status: IrisStatus;
  subject: string;
  unread: boolean;
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
  category: string;
  channelKind: string;
  id: string;
  name: string;
  slug: string;
  status: string;
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

const emptyIrisData: IrisData = {
  broadcasts: [],
  channels: [],
  profiles: [],
  queues: [],
  templates: [],
  tickets: [],
};
const emptyIrisTickets: IrisTicket[] = [];
const IRIS_REFRESH_INTERVAL_MS = 4000;

const navigationItems: Array<{
  id: IrisView;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "gestao", label: "Board", icon: LayoutDashboard },
  { id: "disparos", label: "Disparos", icon: Megaphone },
  { id: "setup", label: "Setup", icon: Settings2 },
  { id: "relatorios", label: "Relatorios", icon: BarChart3 },
];

const statusLabel: Record<IrisStatus, string> = {
  cancelled: "Cancelado",
  closed: "Fechado",
  new: "Novo",
  open: "Em atendimento",
  pending: "Pendente",
  resolved: "Resolvido",
  waiting_customer: "Aguardando cliente",
  waiting_operator: "Aguardando operador",
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

export function IrisPage({
  embedded = false,
  initialTickets = emptyIrisTickets,
  loadFromSupabase = true,
}: IrisPageProps) {
  const [irisData, setIrisData] = useState<IrisData>({
    ...emptyIrisData,
    tickets: initialTickets,
  });
  const [selectedTicketId, setSelectedTicketId] = useState<string>(
    initialTickets[0]?.id ?? "",
  );
  const [activeView, setActiveView] = useState<IrisView>("gestao");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(loadFromSupabase);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inboundNotice, setInboundNotice] = useState<IrisInboundNotice | null>(
    null,
  );
  const knownMessageIdsRef = useRef<Set<string>>(
    collectIrisMessageIds({ ...emptyIrisData, tickets: initialTickets }),
  );
  const refreshInFlightRef = useRef(false);

  function notifyInbound(ticket: IrisTicket, message: IrisMessage) {
    const notice = {
      body: message.body || "Nova mensagem recebida no WhatsApp.",
      id: message.id,
      receivedAt: message.createdAt,
      ticketId: ticket.id,
      title: ticket.contactLabel,
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

      refreshInFlightRef.current = true;

      try {
        const nextData = await loadIrisData();
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
    [loadFromSupabase],
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
      setLoading(true);
      setLoadError(null);

      try {
        const nextData = await loadIrisData();

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
  }, [initialTickets, loadFromSupabase]);

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

  const selectedTicket = useMemo(() => {
    return (
      irisData.tickets.find((ticket) => ticket.id === selectedTicketId) ??
      irisData.tickets[0] ??
      null
    );
  }, [irisData.tickets, selectedTicketId]);

  const snapshot = useMemo(
    () => buildIrisSnapshot(irisData),
    [irisData],
  );

  function openAttendance(ticketId?: string) {
    const targetId = ticketId ?? selectedTicket?.id;
    if (!targetId) {
      return;
    }
    setSelectedTicketId(targetId);
    setActiveView("atendimento");
  }

  function handleLocalMessage(ticketId: string, message: IrisMessage) {
    knownMessageIdsRef.current.add(message.id);
    setIrisData((current) => ({
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

  function handleProfilesChanged(profiles: IrisTicketProfileConfig[]) {
    setIrisData((current) => ({
      ...current,
      profiles,
    }));
  }

  function handleOpenModuleLauncher() {
    window.dispatchEvent(new Event("careli:toggle-module-launcher"));
  }

  return (
    <div
      onClick={registerIrisNotificationPermissionIntent}
      className={[
        "h-full min-h-0 overflow-hidden bg-[#f3f6fa] text-[#101820]",
        embedded ? "rounded-2xl border border-[#dbe3ef]" : "",
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
            {navigationItems.map((item) => (
              <IrisNavButton
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
                <MiniStat
                  label="SLA"
                  value={formatCount(snapshot.slaCritical)}
                />
              </div>
            </div>
          ) : (
            <Tooltip
              content="Operacao online"
              placement="right"
              className="mt-auto w-full"
              triggerClassName="w-full"
            >
              <div className="flex h-11 w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-emerald-200">
                <Wifi className="h-4 w-4" />
              </div>
            </Tooltip>
          )}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <IrisTopbar activeView={activeView} snapshot={snapshot} />

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
              />
            ) : activeView === "atendimento" ? (
              <AttendanceView
                ticket={selectedTicket}
                tickets={irisData.tickets}
                selectedTicketId={selectedTicket?.id ?? selectedTicketId}
                onSelectTicket={setSelectedTicketId}
                onClose={() => setActiveView("gestao")}
                onMessageCreated={handleLocalMessage}
              />
            ) : activeView === "disparos" ? (
              <BroadcastView data={irisData} snapshot={snapshot} />
            ) : activeView === "setup" ? (
              <SetupView
                data={irisData}
                snapshot={snapshot}
                onProfilesChanged={handleProfilesChanged}
              />
            ) : (
              <ReportsView data={irisData} snapshot={snapshot} />
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function IrisTopbar({
  activeView,
  snapshot,
}: {
  activeView: IrisView;
  snapshot: ReturnType<typeof buildIrisSnapshot>;
}) {
  const titleByView: Record<IrisView, string> = {
    atendimento: "Atendimento",
    disparos: "Disparos em massa",
    gestao: "Tickets",
    relatorios: "Relatorios",
    setup: "Setup operacional",
  };

  return (
    <header className="sticky top-0 z-20 border-b border-[#dbe3ef] bg-white/95 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-[230px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#A07C3B]">
            Iris
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
          <HeaderMetric
            icon={Wifi}
            label="Operacao"
            value="Online"
            tone="green"
          />
          <HeaderMetric
            icon={TicketCheck}
            label="Tickets"
            value={formatCount(snapshot.total)}
          />
          <HeaderMetric
            icon={ShieldAlert}
            label="SLA critico"
            value={formatCount(snapshot.slaCritical)}
            tone="red"
          />
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
}: {
  data: IrisData;
  loading: boolean;
  snapshot: ReturnType<typeof buildIrisSnapshot>;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
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
          title="Athena"
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

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-3">
        <div className="min-h-0 min-w-0">
          {loading ? (
            <IrisLoading />
          ) : (
            <IrisTicketQueue
              tickets={data.tickets}
              onOpenAttendance={onOpenAttendance}
              onSelectTicket={onSelectTicket}
            />
          )}
        </div>

        <aside className="min-h-0 space-y-3 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          <ActionPanel
            icon={Sparkles}
            title="Athena na fila"
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

function IrisTicketQueue({
  onOpenAttendance,
  onSelectTicket,
  tickets,
}: {
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  tickets: IrisTicket[];
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
    () => [
      "Todos",
      ...unique(tickets.map((ticket) => statusLabel[ticket.status])),
    ],
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
      .sort(sortIrisTickets);
  }, [priority, queue, search, status, tickets]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="shrink-0 border-b border-slate-100 px-4 py-3">
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
              value={`${tickets.filter(isWaitingForIris).length}`}
              tone={tickets.some(isWaitingForIris) ? "danger" : "gold"}
            />
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 p-3 2xl:grid-cols-[minmax(0,1fr)_300px]">
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
            <div className="hidden grid-cols-[1fr_0.75fr_0.75fr_0.75fr_0.9fr_0.75fr_0.75fr] gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2 text-xs font-semibold uppercase tracking-normal text-slate-400 xl:grid">
              <span>Ticket</span>
              <span>Fila</span>
              <span>Canal</span>
              <span>SLA</span>
              <span>Status</span>
              <span>Responsavel</span>
              <span className="text-right">Atendimento</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
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
                  title="Nenhum ticket na fila"
                  description="Quando uma mensagem de cliente chegar ou um operador iniciar um contato, o ticket deve nascer no Iris."
                />
              )}
            </div>
          </div>
        </div>

        <aside className="min-h-0 space-y-3 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          <div className="rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 p-3">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-[#A07C3B]" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-950">
                Athena na fila
              </p>
            </div>
            <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-700">
              Priorizar cliente sem resposta, SLA vencendo e tickets sem
              responsavel. O Iris mede a operacao de atendimento,
              independente do modulo que originou o contato.
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
            value={`${tickets.filter(isWaitingForIris).length}`}
            description="Conversas que dependem de retorno humano."
          />
        </aside>
      </div>
    </section>
  );
}

function IrisTicketRow({
  onOpenAttendance,
  onSelectTicket,
  ticket,
}: {
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  ticket: IrisTicket;
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
        <div className="flex items-start gap-2.5">
          <ContactAvatar ticket={ticket} size="sm" />
          <div className="min-w-0">
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
          </div>
        </div>
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
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${slaClasses(ticket)}`}
        >
          {slaLabel(ticket)}
        </span>
        <p className="mt-1 text-xs text-slate-400">
          {formatDateTime(ticket.openedAt)}
        </p>
      </div>

      <div>
        <StatusPill
          label={statusLabel[ticket.status]}
          tone={statusTone(ticket.status)}
        />
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
  onMessageCreated: (ticketId: string, message: IrisMessage) => void;
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
      onMessageCreated={onMessageCreated}
    />
  );
}

function IrisConversationPanel({
  onClose,
  onMessageCreated,
  onSelectTicket,
  selectedTicketId,
  ticket,
  tickets,
}: {
  onClose: () => void;
  onMessageCreated: (ticketId: string, message: IrisMessage) => void;
  onSelectTicket: (ticketId: string) => void;
  selectedTicketId: string;
  ticket: IrisTicket;
  tickets: IrisTicket[];
}) {
  const [conversationFilter, setConversationFilter] = useState("Abertas");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [search, setSearch] = useState("");
  const [showPreviousTickets, setShowPreviousTickets] = useState(false);
  const [conversationListCollapsed, setConversationListCollapsed] =
    useState(false);
  const repairingOutboundMessageIds = useRef(new Set<string>());
  const { hubUser } = useAuth();
  const operatorLabel = hubUser?.name ?? "Operador Iris";

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
          return [
            "new",
            "waiting_operator",
            "waiting_customer",
            "pending",
          ].includes(item.status);
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
          : item.contactLabel === ticket.contactLabel,
      )
      .sort(
        (first, second) =>
          dateValue(second.openedAt) - dateValue(first.openedAt),
      );
  }, [ticket.contactId, ticket.contactLabel, ticket.id, tickets]);

  const ticketChecklist = buildTicketChecklist(ticket);
  const ticketClosed = isClosedTicket(ticket);
  const ticketIncomplete =
    !ticketClosed &&
    (ticket.status === "new" ||
      ticket.status === "waiting_operator" ||
      ticketChecklist.some((item) => !item.ok));
  const operationReady = !ticketClosed;
  const blockedTooltip = ticketClosed ? "Ticket encerrado" : "Enviar mensagem";

  useEffect(() => {
    if (!operationReady || sending || !ticket.contactPhone) {
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
    operationReady,
    sending,
    ticket.channelId,
    ticket.contactId,
    ticket.contactPhone,
    ticket.id,
    ticket.messages,
  ]);

  async function sendMessage() {
    const body = draft.trim();

    if (!body || sending || !operationReady) {
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
        senderLabel: operatorLabel,
        senderType: "operator",
      };

      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/messages", {
        body: JSON.stringify({
          body,
          channelId: ticket.channelId ?? null,
          contactId: ticket.contactId ?? null,
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
          ensureOperatorLabel(mapMessageRow(payload.message), operatorLabel),
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
          ensureOperatorLabel(mapMessageRow(payload.message), operatorLabel),
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

  return (
    <section className="relative flex h-full min-h-0 w-full overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <aside
        className={[
          "hidden shrink-0 border-r border-slate-100 bg-slate-50/70 transition-all duration-300 lg:flex lg:flex-col",
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
                          {conversation.contactLabel}
                        </p>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {conversationTime(conversation)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-xs text-slate-500">
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

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-slate-100 bg-white">
          <div className="flex flex-col gap-2 px-4 py-2.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <ContactAvatar ticket={ticket} size="md" />
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
                <MessageBubble key={message.id} message={message} />
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

          <div className="mb-2 flex items-center justify-between gap-2">
            <OperationalToolbar disabled={!operationReady} />
            {operationReady ? (
              <TicketChecklist items={ticketChecklist} compact />
            ) : null}
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
            <ComposerIconButton
              disabled={!operationReady}
              label="Anexar arquivo"
              onClick={() => undefined}
            >
              <Paperclip className="size-4" aria-hidden="true" />
            </ComposerIconButton>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                operationReady
                  ? "Escrever mensagem WhatsApp..."
                  : "Ticket encerrado"
              }
              disabled={!operationReady}
              className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            <ComposerIconButton
              disabled={!operationReady}
              label="Enviar audio"
              onClick={() => undefined}
            >
              <Mic className="size-4" aria-hidden="true" />
            </ComposerIconButton>
            <Tooltip
              content={operationReady ? "Enviar mensagem" : blockedTooltip}
              placement="top"
            >
              <button
                type="button"
                disabled={sending || !draft.trim() || !operationReady}
                onClick={sendMessage}
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
                aria-label={operationReady ? "Enviar mensagem" : blockedTooltip}
              >
                <Send className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
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
                  {ticket.contactLabel}
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
            {[FileText, CalendarClock, ClipboardList, Clock3].map(
              (Icon, index) => (
                <Tooltip
                  content="Atalho de contexto"
                  key={index}
                  placement="bottom"
                >
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white hover:text-[#7A5E2C]"
                    aria-label="Atalho de contexto"
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
              ),
            )}
          </div>
        </div>

        <div className="min-h-0 space-y-2 overflow-y-auto p-3 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          <ContextItem label="Cliente" value={ticket.contactLabel} />
          <ContextItem label="Telefone" value={ticket.contactPhone ?? "-"} />
          <ContextItem
            label="Documento"
            value={ticket.contactDocument ?? "-"}
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
          <ContextItem label="Canal" value={ticket.channelLabel} />

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
    </section>
  );
}

function TicketSeparator({
  compact = false,
  ticket,
}: {
  compact?: boolean;
  ticket: IrisTicket;
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
            <p className="mt-2 text-sm font-semibold text-slate-950">
              {ticket.profileLabel}
            </p>
            <p className="mt-1 text-xs font-medium text-slate-500">
              {formatDateTime(ticket.openedAt)} - {ticket.queueLabel} -{" "}
              {ticket.channelLabel}
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
          icon={Bot}
          title="Athena"
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
  onProfilesChanged,
  snapshot,
}: {
  data: IrisData;
  onProfilesChanged: (profiles: IrisTicketProfileConfig[]) => void;
  snapshot: ReturnType<typeof buildIrisSnapshot>;
}) {
  const firstQueueId = data.queues[0]?.id ?? "";
  const queueById = useMemo(
    () => new Map(data.queues.map((queue) => [queue.id, queue])),
    [data.queues],
  );
  const [selectedQueueId, setSelectedQueueId] = useState("all");
  const [editingProfileId, setEditingProfileId] = useState("");
  const [profileForm, setProfileForm] = useState(() =>
    createProfileForm(firstQueueId),
  );
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);

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
        .filter(
          (profile) =>
            selectedQueueId === "all" || profile.queueId === selectedQueueId,
        )
        .sort(sortIrisProfiles),
    [data.profiles, selectedQueueId],
  );
  const activeProfiles = data.profiles.filter(
    (profile) => profile.status === "active",
  ).length;
  const categories = unique(
    data.profiles.map((profile) => profile.category).filter(Boolean),
  );

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

  function startNewProfile() {
    setEditingProfileId("");
    setProfileFeedback(null);
    setProfileForm(createProfileForm(firstQueueId));
  }

  function startEditProfile(profile: IrisTicketProfileConfig) {
    setEditingProfileId(profile.id);
    setProfileFeedback(null);
    setProfileForm(profileToForm(profile));
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!profileForm.queueId) {
      setProfileFeedback("Selecione uma fila antes de salvar o motivo.");
      return;
    }

    if (
      !profileForm.name.trim() ||
      !profileForm.slug.trim() ||
      !profileForm.category.trim()
    ) {
      setProfileFeedback("Preencha nome, slug e categoria do motivo.");
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
      setProfileFeedback("Motivo de atendimento salvo no Iris.");
    } catch (error) {
      setProfileFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel salvar o motivo do Iris.",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="min-w-0 rounded-2xl border border-[#dbe3ef] bg-white p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A07C3B]">
              Motivos e perfis
            </p>
            <h3 className="mt-1 text-base font-semibold text-[#101820]">
              Configuracao operacional do atendimento
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#63708a]">
              Cada motivo define fila, categoria, prioridade e SLA. Essa
              configuracao alimenta triagem, metricas e abertura de ticket sem
              depender de outro modulo.
            </p>
          </div>
          <button
            type="button"
            onClick={startNewProfile}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] transition-colors hover:border-[#A07C3B]/30 hover:text-[#7A5E2C]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Novo motivo
          </button>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-3">
            <div className="grid gap-2 rounded-xl border border-[#e4eaf3] bg-[#fbfcfe] p-2 sm:grid-cols-[minmax(0,1fr)_180px]">
              <label className="flex h-10 items-center gap-2 rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm text-[#63708a]">
                <Search className="h-4 w-4 text-[#A07C3B]" aria-hidden="true" />
                <span className="font-semibold">
                  {formatCount(visibleProfiles.length)} motivos visiveis
                </span>
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

            <div className="max-h-[620px] overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
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
                          : "border-[#e4eaf3] bg-[#fbfcfe] hover:border-[#A07C3B]/30 hover:bg-white",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#101820]">
                            {profile.name}
                          </p>
                          <p className="mt-1 text-xs font-medium text-[#63708a]">
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
                          1a resposta {profile.slaFirstResponseMinutes} min
                        </span>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                          Resolucao{" "}
                          {formatSlaMinutes(profile.slaResolutionMinutes)}
                        </span>
                      </div>
                    </button>
                  ))
                ) : (
                  <EmptyState
                    icon={Route}
                    title="Nenhum motivo configurado"
                    description="Crie motivos de atendimento para padronizar fila, prioridade, SLA e metricas do Iris."
                  />
                )}
              </div>
            </div>
          </div>

          <form
            onSubmit={saveProfile}
            className="rounded-xl border border-[#dbe3ef] bg-[#fbfcfe] p-3"
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fbf6ec] text-[#A07C3B]">
                <Settings2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h4 className="text-sm font-semibold text-[#101820]">
                  {editingProfileId ? "Editar motivo" : "Novo motivo"}
                </h4>
                <p className="text-xs text-[#63708a]">
                  Salvo em caredesk_ticket_profiles
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

              <SetupField label="Nome do motivo">
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
                <SetupField label="SLA 1a resposta">
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
                <SetupField label="SLA resolucao">
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
                  placeholder="contact_id, queue_id, priority"
                />
              </SetupField>

              <SetupField label="Descricao">
                <textarea
                  value={profileForm.description}
                  onChange={(event) =>
                    updateProfileForm("description", event.target.value)
                  }
                  className="min-h-20 w-full resize-none rounded-lg border border-[#dbe3ef] bg-white px-3 py-2 text-sm font-medium text-[#34415a] outline-none"
                  placeholder="Quando usar este motivo no atendimento."
                />
              </SetupField>
            </div>

            {profileFeedback ? (
              <p className="mt-3 rounded-lg border border-[#dbe3ef] bg-white px-3 py-2 text-xs font-semibold text-[#63708a]">
                {profileFeedback}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={savingProfile}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#A07C3B] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {savingProfile ? "Salvando..." : "Salvar motivo"}
            </button>
          </form>
        </div>
      </section>

      <aside className="space-y-4">
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
          title="Motivos"
          items={[
            ["Ativos", `${formatCount(activeProfiles)} motivos`],
            ["Categorias", `${formatCount(categories.length)} categorias`],
            ["Roteamento", "Fila + prioridade + SLA"],
            ["Metricas", "Motivo obrigatorio"],
          ]}
        />
        <SetupSection
          icon={MessageSquareText}
          title="Templates"
          items={
            data.templates.length
              ? data.templates
                  .slice(0, 5)
                  .map((template) => [
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
            [
              "Aguardando operador",
              `${formatCount(snapshot.waitingOperator)} tickets`,
            ],
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
            ["Iris", "Tickets e auditoria"],
            ["Contatos", `${formatCount(snapshot.contacts)} registrados`],
            ["Mensagens", `${formatCount(snapshot.messages)} registradas`],
            ["Disparos", `${formatCount(data.broadcasts.length)} campanhas`],
          ]}
        />
      </aside>
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
          title="Agenda operacional"
          rows={[
            ["Retornos", formatCount(snapshot.followUpsToday)],
            ["Sem resposta", formatCount(snapshot.unanswered)],
            ["Escalados", formatCount(snapshot.waitingOperator)],
            ["Athena", "Ativa"],
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
    <div className="rounded-2xl border border-[#dbe3ef] bg-white p-4 shadow-sm">
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

  if (imageUrl) {
    return (
      <img
        alt={ticket.contactLabel}
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
      {contactInitials(ticket.contactLabel)}
    </span>
  );
}

function MessageBubble({ message }: { message: IrisMessage }) {
  const outbound = message.direction === "outbound";
  const internal =
    message.direction === "internal" || message.senderType === "system";

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
        {outbound && message.senderLabel ? (
          <div className="mb-1.5 flex items-center justify-end">
            <span className="rounded-full border border-[#eadcc2] bg-white/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-[#7A5E2C]">
              {message.senderLabel}
            </span>
          </div>
        ) : null}
        <p className="whitespace-pre-wrap leading-6">{message.body}</p>
        <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-slate-400">
          <span>{formatDateTime(message.createdAt)}</span>
          {outbound ? (
            <MessageDeliveryIndicator message={message} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MessageDeliveryIndicator({ message }: { message: IrisMessage }) {
  const normalized = normalizeDeliveryStatus(message.deliveryStatus);
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
      <p className="mt-1 truncate text-sm font-semibold text-slate-950">
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
    <span
      className={`inline-flex w-fit rounded-full border px-2 py-1 text-xs font-semibold ${classes}`}
    >
      {label}
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

async function loadIrisData(): Promise<IrisData> {
  const supabase = getHubSupabaseClient();

  if (!supabase) {
    return emptyIrisData;
  }

  const [
    ticketsResult,
    queuesResult,
    profilesResult,
    templatesResult,
    channelsResult,
    broadcastsResult,
  ] = await Promise.all([
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
      .from("caredesk_ticket_profiles")
      .select(
        "id,queue_id,name,slug,category,priority,sla_first_response_minutes,sla_resolution_minutes,description,required_fields,status",
      )
      .order("category", { ascending: true })
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

  const [contactsResult, messagesResult] = await Promise.all([
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
            "id,ticket_id,body,direction,sender_type,sender_user_id,delivery_status,provider_payload,created_at,sent_at,delivered_at,read_at,external_message_id",
          )
          .in("ticket_id", ticketIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const failedNestedResult = [contactsResult, messagesResult].find(
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
  const contactById = new Map(
    (contactsResult.data ?? []).map((contact) => [contact.id, contact]),
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
        row: ticket,
      }),
    ),
  };
}

async function saveIrisTicketProfile(
  form: ReturnType<typeof createProfileForm>,
) {
  const supabase = getHubSupabaseClient();

  if (!supabase) {
    throw new Error("Conexao do Supabase indisponivel para salvar o motivo.");
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
      result.error?.message ?? "Nao foi possivel salvar o motivo.",
    );
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
    assignedToLabel: input.row.assigned_to_user_id
      ? "Operador vinculado"
      : "Sem responsavel",
    channelId: input.row.channel_id,
    channelLabel: input.channel?.name ?? "Canal nao definido",
    contactAvatarUrl: getContactAvatarUrl(input.contact),
    contactDocument: input.contact?.document ?? null,
    contactEmail: input.contact?.email ?? null,
    contactId: input.row.contact_id,
    contactLabel: input.contact?.display_name ?? "Cliente sem cadastro",
    contactPhone: input.contact?.whatsapp_phone ?? input.contact?.phone ?? null,
    createdAt: input.row.created_at,
    firstRespondedAt: input.row.first_responded_at,
    firstResponseDueAt: input.row.first_response_due_at,
    id: input.row.id,
    lastMessageAt:
      lastMessage?.createdAt ?? input.row.updated_at ?? input.row.opened_at,
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
    body: row.body ?? "",
    createdAt: row.created_at,
    deliveryStatus: row.delivery_status ?? "queued",
    direction: row.direction ?? "internal",
    deliveredAt: row.delivered_at ?? null,
    externalMessageId: row.external_message_id ?? null,
    id: row.id,
    readAt: row.read_at ?? null,
    senderLabel: readMessageSenderLabel(row),
    senderType: row.sender_type ?? "system",
    sentAt: row.sent_at ?? null,
  };
}

function readMessageSenderLabel(row: any) {
  const payload = row?.provider_payload;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const operatorLabel = (payload as Record<string, unknown>).operatorLabel;

    if (typeof operatorLabel === "string" && operatorLabel.trim()) {
      return operatorLabel.trim();
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
    return nestedUser.display_name.trim();
  }

  if (typeof row?.sender_label === "string" && row.sender_label.trim()) {
    return row.sender_label.trim();
  }

  return row?.sender_type === "operator" ? "Operador Iris" : null;
}

function ensureOperatorLabel(message: IrisMessage, operatorLabel: string) {
  if (message.direction !== "outbound" || message.senderLabel) {
    return message;
  }

  return {
    ...message,
    senderLabel: operatorLabel,
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

function buildIrisSnapshot(data: IrisData) {
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
      ticket.status === "waiting_operator" ||
      ticket.assignedToLabel === "Sem responsavel",
  ).length;
  const inbox = tickets.filter(
    (ticket) => ticket.status === "new" || ticket.status === "waiting_operator",
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

function scoreTicketForAction(first: IrisTicket, second: IrisTicket) {
  return ticketScore(second) - ticketScore(first);
}

function ticketScore(ticket: IrisTicket) {
  return (
    (ticket.priority === "critical" ? 500 : 0) +
    (ticket.priority === "high" ? 250 : 0) +
    (isSlaCritical(ticket) ? 300 : 0) +
    (isWaitingForIris(ticket) ? 180 : 0) +
    (ticket.status === "waiting_operator" ? 120 : 0)
  );
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

  return slug || "motivo-atendimento";
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
  return (
    !isClosedTicket(ticket) &&
    (ticket.unread ||
      ticket.status === "new" ||
      ticket.status === "waiting_operator")
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

function estimateFirstResponse(tickets: IrisTicket[]) {
  const responded = tickets.filter((ticket) => ticket.firstRespondedAt);

  if (!responded.length) {
    return "Sem dados";
  }

  const averageMinutes =
    responded.reduce((total, ticket) => {
      return (
        total +
        Math.max(
          0,
          dateValue(ticket.firstRespondedAt) - dateValue(ticket.openedAt),
        ) /
          60000
      );
    }, 0) / responded.length;

  return formatDuration(averageMinutes);
}

function estimateAverageResponse(tickets: IrisTicket[]) {
  const withMessages = tickets.filter((ticket) => ticket.messages.length > 1);

  if (!withMessages.length) {
    return "Sem dados";
  }

  const averageMinutes =
    withMessages.reduce((total, ticket) => {
      const first = ticket.messages[0];
      const last = ticket.messages[ticket.messages.length - 1];
      return (
        total +
        Math.max(0, dateValue(last.createdAt) - dateValue(first.createdAt)) /
          60000
      );
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

function collectIrisMessageIds(data: IrisData) {
  return new Set(
    data.tickets.flatMap((ticket) =>
      ticket.messages.map((message) => message.id).filter(Boolean),
    ),
  );
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
