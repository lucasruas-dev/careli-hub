"use client";

import {
  HUB_AUTO_LOGOUT_TIMEOUT_MS,
  HUB_IDLE_TIMEOUT_MS,
  normalizeHubPresenceStatus,
  type HubPresenceStatus,
} from "@/lib/hub-presence";
import {
  getHubHomeSnapshot,
  type HubAvailabilitySnapshot,
  type HubHomeSnapshot,
  type HubHomeUser,
} from "@/lib/hub-home";
import {
  getAsanaTeamPerformance,
  type AsanaPerformancePeriodRequest,
  type AsanaCollaboratorPerformance,
  type AsanaTeamPerformanceSnapshot,
} from "@/lib/asana-performance";
import { HubUserTicketsPanel } from "@/components/hub-support/hub-user-tickets-panel";
import { HomeNovidadesPanel } from "@/components/panteon/home-novidades-panel";
import { ProcessosLibrary } from "@/modules/processos/ProcessosLibrary";
import { MeuDiaHomeCard } from "@/modules/agenda/MeuDiaHomeCard";
import {
  PanteonLoadingMark,
  PanteonLoadingState,
} from "@/components/panteon/panteon-loading";
import { HubShell, moduleIconMap } from "@/layouts/hub-shell";
import { useAuth } from "@/providers/auth-provider";
import {
  canAccessModule,
  isHubModuleActive,
  orderedHubModules,
} from "@repo/shared";
import { Badge, Surface, WorkspaceLayout } from "@repo/uix";
import {
  AlertTriangle,
  CalendarCheck2,
  ChevronDown,
  CheckCircle2,
  Clock3,
  FileText,
  LayoutGrid,
  KeyRound,
  RefreshCw,
  Target,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

type HomePresenceStatus = Exclude<HubPresenceStatus, "busy">;
type HomeTab = "availability" | "overview" | "processos" | "tickets";
type AvailabilityEventFilter =
  | "all"
  | "away"
  | "login"
  | "logout"
  | "lunch"
  | "return";
type AvailabilityEventKind = Exclude<AvailabilityEventFilter, "all">;
type JourneyEventRecord = {
  id: string;
  metadata?: Record<string, unknown>;
  nextStatus: HubPresenceStatus;
  previousStatus?: HubPresenceStatus;
  reason: string;
  startedAt: string;
  userId?: string;
  userName?: string;
};
type JourneyEventItem = {
  event: JourneyEventRecord;
  kind: AvailabilityEventKind;
};
type JourneyDateGroup = {
  dateKey: string;
  events: JourneyEventItem[];
  label: string;
};

type HomeTeamMember = {
  avatarUrl?: string;
  id: string;
  initials: string;
  lastSignal: string;
  name: string;
  scopeLabel: string;
  status: HomePresenceStatus;
};

const operationStatusLabel = {
  agenda: "agenda",
  away: "ausente",
  lunch: "almoco",
  offline: "offline",
  online: "online",
} as const satisfies Record<HomePresenceStatus, string>;

const operationStatusStyle = {
  agenda: "border-sky-200 bg-sky-50 text-sky-700",
  away: "border-red-200 bg-red-50 text-red-700",
  lunch: "border-yellow-200 bg-yellow-50 text-yellow-700",
  offline: "border-zinc-200 bg-zinc-50 text-zinc-500",
  online: "border-emerald-200 bg-emerald-50 text-emerald-700",
} as const satisfies Record<HomePresenceStatus, string>;

const availabilityEventFilters = [
  { label: "Todos", value: "all" },
  { label: "Login", value: "login" },
  { label: "Ausente", value: "away" },
  { label: "Almoco", value: "lunch" },
  { label: "Online", value: "return" },
  { label: "Logout", value: "logout" },
] as const satisfies Array<{
  label: string;
  value: AvailabilityEventFilter;
}>;

export default function HomePage() {
  const { hubUser } = useAuth();
  const [activeHomeTab, setActiveHomeTab] = useState<HomeTab>("overview");
  const [snapshot, setSnapshot] = useState<HubHomeSnapshot | null>(null);
  const [asanaSnapshot, setAsanaSnapshot] =
    useState<AsanaTeamPerformanceSnapshot | null>(null);
  const [asanaPeriod, setAsanaPeriod] =
    useState<AsanaPerformancePeriodRequest>(() => createAsanaPeriod("month"));
  const [homeError, setHomeError] = useState<string | null>(null);
  const [asanaError, setAsanaError] = useState<string | null>(null);
  const [isAsanaLoading, setIsAsanaLoading] = useState(false);
  const displayName = getFirstName(hubUser?.name ?? "Operacao");
  const isAdmin = hubUser?.role === "admin";
  const teamMembers = createTeamMembers(snapshot);
  const activeModuleIds = expandPantheonModuleIds(
    (snapshot?.modules ?? [])
      .filter((module) => module.status === "active")
      .map((module) => module.id),
  );
  const enabledModuleIds = expandPantheonModuleIds(
    (snapshot?.departmentModules ?? [])
      .filter((access) => access.status === "enabled")
      .map((access) => access.moduleId),
  );
  const _availableModules = orderedHubModules.filter(
    (hubModule) =>
      hubModule.id !== "zeus" &&
      isHubModuleActive(hubModule) &&
      Boolean(hubUser && canAccessModule(hubUser, hubModule)) &&
      activeModuleIds.has(hubModule.id) &&
      enabledModuleIds.has(hubModule.id),
  );
  const _onlineCount = countTeamStatus(teamMembers, "online");
  const _awayCount = countTeamStatus(teamMembers, "away");
  const _lunchCount = countTeamStatus(teamMembers, "lunch");
  const _agendaCount = countTeamStatus(teamMembers, "agenda");
  const _offlineCount = countTeamStatus(teamMembers, "offline");
  const _taskCount = asanaSnapshot?.totals.total ?? 0;
  const _unreadNotificationsCount = snapshot?.notifications.unreadCount ?? 0;
  const _peopleCount = teamMembers.length;
  const _messagesTodayCount = snapshot?.pulsex.messagesTodayCount ?? 0;

  useEffect(() => {
    if (!isAdmin && activeHomeTab === "availability") {
      setActiveHomeTab("overview");
    }
  }, [activeHomeTab, isAdmin]);

  const loadAsanaPerformance = useCallback((silent = false) => {
    if (!silent) {
      setIsAsanaLoading(true);
    }

    getAsanaTeamPerformance(asanaPeriod)
      .then((nextSnapshot) => {
        setAsanaSnapshot(nextSnapshot);
        setAsanaError(null);
      })
      .catch((error: unknown) => {
        setAsanaError(
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar dados do Asana.",
        );
      })
      .finally(() => {
        if (!silent) {
          setIsAsanaLoading(false);
        }
      });
  }, [asanaPeriod]);

  useEffect(() => {
    let isMounted = true;

    function loadHome() {
      getHubHomeSnapshot()
        .then((nextSnapshot) => {
          if (!isMounted) {
            return;
          }

          setSnapshot(nextSnapshot);
          setHomeError(null);
        })
        .catch((error: unknown) => {
          if (!isMounted) {
            return;
          }

          setHomeError(
            error instanceof Error
              ? error.message
              : "Nao foi possivel carregar dados reais da Home.",
          );
        });
    }

    loadHome();
    const intervalId = window.setInterval(loadHome, 60_000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    loadAsanaPerformance();
    const intervalId = window.setInterval(
      () => loadAsanaPerformance(true),
      180_000,
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadAsanaPerformance]);

  return (
    <HubShell chrome="operational" layoutMode="module">
      <div className="flex h-full min-h-0">
        <HomeModuleRail />
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
          <WorkspaceLayout
            className="careli-home"
            header={
              <h1
                className="m-0 text-[1.4rem] font-semibold tracking-tight"
                style={{ color: "var(--uix-text-primary)" }}
              >
                {`${getGreeting()}, ${displayName}.`}
              </h1>
            }
          >
        {homeError ? (
          <Surface bordered className="border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            {homeError}
          </Surface>
        ) : null}

        <HomeTabs
          activeTab={activeHomeTab}
          isAdmin={isAdmin}
          onTabChange={setActiveHomeTab}
        />

        {activeHomeTab === "tickets" ? (
          <HubUserTicketsPanel title="Meus chamados" />
        ) : activeHomeTab === "processos" ? (
          <ProcessosLibrary />
        ) : activeHomeTab === "availability" && isAdmin ? (
          <AvailabilityAdminPanel snapshot={snapshot?.availability ?? null} />
        ) : (
          <>
            <section className="grid grid-cols-12 gap-5">
              <MeuDiaHomeCard className="col-span-12" />
              <HomeNovidadesPanel />
              <AsanaPerformancePanel
                className="col-span-12 xl:col-span-7"
                error={asanaError}
                isLoading={isAsanaLoading}
                onRefresh={() => loadAsanaPerformance()}
                onPeriodChange={setAsanaPeriod}
                period={asanaPeriod}
                snapshot={asanaSnapshot}
              />
            </section>
          </>
        )}
          </WorkspaceLayout>
        </div>
      </div>
    </HubShell>
  );
}

// Sidebar lateral da Home = lista de modulos (atalho de navegacao). Clicar abre o
// modulo como aba na barra Panteon. Espelha o visual do sidebar dos modulos.
function HomeModuleRail() {
  const { hubUser } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const modules = orderedHubModules
    .filter(
      (hubModule) =>
        isHubModuleActive(hubModule) &&
        hubUser !== null &&
        canAccessModule(hubUser, hubModule),
    )
    .sort((first, second) => first.name.localeCompare(second.name, "pt-BR"));

  return (
    <aside className="panteon-module-sidebar panteon-module-sidebar--themed relative flex h-full w-[15rem] shrink-0 flex-col overflow-y-auto border-r px-4 py-4 text-ink">
      <div className="panteon-module-sidebar__top -mx-4 mb-4 px-4">
        <div className="grid min-h-12 items-center rounded-xl bg-black/[0.03] px-2.5 py-2 dark:bg-white/[0.04]">
          <div className="flex min-w-0 items-center gap-2.5 text-ink">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#A07C3B]/55 bg-[#101820] text-[#cba25a] dark:bg-white/[0.14] dark:text-ink">
              <LayoutGrid aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="min-w-0 truncate text-sm font-semibold leading-tight text-ink">
              Modulos
            </span>
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {modules.map((hubModule) => {
          const active =
            pathname === hubModule.basePath ||
            pathname.startsWith(`${hubModule.basePath}/`);

          return (
            <button
              className={`flex h-11 items-center gap-3 rounded-lg border px-2.5 text-left text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-[#d0ad69] ${
                active
                  ? "border-[#A07C3B]/55 bg-[#A07C3B]/12 text-ink"
                  : "border-transparent text-ink-soft hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/[0.06] hover:text-ink"
              }`}
              key={hubModule.id}
              onClick={() => router.push(hubModule.basePath)}
              type="button"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-black/[0.04] text-ink-soft dark:bg-white/[0.06]">
                {moduleIconMap[hubModule.id] ?? (
                  <FileText aria-hidden="true" size={18} />
                )}
              </span>
              <span className="min-w-0 truncate">{hubModule.name}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function HomeTabs({
  activeTab,
  isAdmin,
  onTabChange,
}: {
  activeTab: HomeTab;
  isAdmin: boolean;
  onTabChange: (tab: HomeTab) => void;
}) {
  const tabClassName = (tab: HomeTab) =>
    `h-9 rounded-md px-4 text-sm font-semibold transition ${
      activeTab === tab
        ? "bg-inverse text-brand-ink dark:bg-white/[0.14] dark:text-ink"
        : "text-ink-muted hover:bg-subtle hover:text-ink"
    }`;

  return (
    <nav
      className={`inline-grid w-fit rounded-lg border border-line bg-surface p-1 shadow-[0_8px_22px_rgb(16_24_32_/_0.05)] ${
        isAdmin ? "grid-cols-4" : "grid-cols-3"
      }`}
    >
      <button
        aria-pressed={activeTab === "overview"}
        className={tabClassName("overview")}
        onClick={() => onTabChange("overview")}
        type="button"
      >
        Início
      </button>
      <button
        aria-pressed={activeTab === "tickets"}
        className={tabClassName("tickets")}
        onClick={() => onTabChange("tickets")}
        type="button"
      >
        HelpDesk
      </button>
      <button
        aria-pressed={activeTab === "processos"}
        className={tabClassName("processos")}
        onClick={() => onTabChange("processos")}
        type="button"
      >
        Processos POP
      </button>
      {isAdmin ? (
        <button
          aria-pressed={activeTab === "availability"}
          className={tabClassName("availability")}
          onClick={() => onTabChange("availability")}
          type="button"
        >
          Disponibilidade
        </button>
      ) : null}
    </nav>
  );
}

function _TeamAvatar({ member }: { member: HomeTeamMember }) {
  return (
    <span
      aria-label={`Foto de ${member.name}`}
      className="grid h-10 w-10 place-items-center rounded-full bg-[#101820] bg-cover bg-center text-xs font-semibold text-white"
      role="img"
      style={
        member.avatarUrl
          ? { backgroundImage: `url(${member.avatarUrl})` }
          : undefined
      }
    >
      {member.avatarUrl ? null : member.initials}
    </span>
  );
}

function _DayMetric({
  label,
  note,
  value,
}: {
  label: string;
  note?: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-line bg-subtle p-3">
      <p className="m-0 text-2xl font-semibold text-ink">{value}</p>
      <p className="m-0 mt-1 text-xs text-ink-muted">{label}</p>
      {note ? (
        <p className="m-0 mt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[#A07C3B]">
          {note}
        </p>
      ) : null}
    </div>
  );
}

function AvailabilityAdminPanel({
  snapshot,
}: {
  snapshot: HubAvailabilitySnapshot | null;
}) {
  const [dateFilter, setDateFilter] = useState("");
  const [eventFilter, setEventFilter] =
    useState<AvailabilityEventFilter>("all");
  const [expandedDateKeys, setExpandedDateKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [selectedUserId, setSelectedUserId] = useState("all");

  if (!snapshot) {
    return (
      <Surface bordered className="border-line bg-surface p-6">
        <div className="mt-4 rounded-md border border-dashed border-line bg-subtle p-5 text-sm text-ink-muted">
          Carregando historico de presenca e disponibilidade.
        </div>
      </Surface>
    );
  }

  const journeyEvents = createJourneyEventItems(snapshot.history)
    .filter((item) =>
      selectedUserId === "all" ? true : item.event.userId === selectedUserId,
    )
    .filter((item) =>
      eventFilter === "all" ? true : item.kind === eventFilter,
    )
    .filter((item) =>
      dateFilter ? getPresenceDateInputValue(item.event.startedAt) === dateFilter : true,
    );
  const dateGroups = groupJourneyEventsByDate(journeyEvents);
  const selectedMember = snapshot.team.find(
    (member) => member.userId === selectedUserId,
  );
  const shouldShowCurrentStatus =
    Boolean(selectedMember) &&
    shouldShowCurrentStatusFallback(
      selectedMember?.currentStatus ?? "offline",
      dateFilter,
      eventFilter,
      snapshot.generatedAt,
    );
  const currentCounts = {
    agenda: snapshot.team.filter((member) => member.currentStatus === "agenda").length,
    away: snapshot.team.filter((member) => member.currentStatus === "away").length,
    lunch: snapshot.team.filter((member) => member.currentStatus === "lunch").length,
    offline: snapshot.team.filter((member) => member.currentStatus === "offline").length,
    online: snapshot.team.filter((member) => member.currentStatus === "online").length,
  };
  const toggleDateGroup = (dateKey: string) => {
    setExpandedDateKeys((current) => {
      const next = new Set(current);

      if (next.has(dateKey)) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }

      return next;
    });
  };

  return (
    <section className="grid grid-cols-12 gap-5">
      <Surface bordered className="col-span-12 border-line bg-surface p-5 shadow-[0_14px_34px_rgb(16_24_32_/_0.07)]">
        <div className="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_12rem_12rem_auto]">
          <label>
            <span className="sr-only">Colaborador</span>
            <select
              className="h-10 rounded-md border border-line bg-surface px-3 text-sm font-semibold normal-case tracking-normal text-ink outline-none focus:border-[#A07C3B]"
              onChange={(event) => setSelectedUserId(event.target.value)}
              value={selectedUserId}
            >
              <option value="all">Todos os colaboradores</option>
              {snapshot.team.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Evento</span>
            <select
              className="h-10 rounded-md border border-line bg-surface px-3 text-sm font-semibold normal-case tracking-normal text-ink outline-none focus:border-[#A07C3B]"
              onChange={(event) =>
                setEventFilter(event.target.value as AvailabilityEventFilter)
              }
              value={eventFilter}
            >
              {availabilityEventFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Data</span>
            <input
              className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-[#A07C3B]"
              onChange={(event) => setDateFilter(event.target.value)}
              type="date"
              value={dateFilter}
            />
          </label>
          <div className="flex min-w-[18rem] items-center justify-between gap-3 rounded-md border border-line bg-subtle px-3 py-2 text-sm font-semibold text-ink">
            <span>
              {currentCounts.online} online / {currentCounts.away} ausentes /{" "}
              {currentCounts.lunch} almoco / {currentCounts.agenda} agenda /{" "}
              {currentCounts.offline} offline
            </span>
            {dateFilter ? (
              <button
                className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-muted transition hover:border-[#A07C3B] hover:text-ink"
                onClick={() => setDateFilter("")}
                type="button"
              >
                Limpar
              </button>
            ) : null}
          </div>
        </div>
      </Surface>

      <Surface bordered className="col-span-12 border-line bg-surface p-5 xl:col-span-4">
        <div className="grid max-h-[38rem] gap-2 overflow-auto pr-1">
          {snapshot.team.map((member) => (
            <button
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border p-3 text-left transition ${
                selectedUserId === member.userId
                  ? "border-[#A07C3B] bg-[#A07C3B]/[0.08]"
                  : "border-line bg-subtle hover:border-line"
              }`}
              key={member.userId}
              onClick={() =>
                setSelectedUserId(
                  selectedUserId === member.userId ? "all" : member.userId,
                )
              }
              type="button"
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${getPresenceDotClassName(member.currentStatus)}`} />
                  <span className="truncate text-sm font-semibold text-ink">
                    {member.displayName}
                  </span>
                </span>
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold ${operationStatusStyle[member.currentStatus]}`}
              >
                {operationStatusLabel[member.currentStatus]}
              </span>
            </button>
          ))}
        </div>
      </Surface>

      <Surface bordered className="col-span-12 border-line bg-surface p-5 xl:col-span-8">
        <div className="grid max-h-[38rem] gap-2 overflow-auto pr-1">
          {dateGroups.length ? (
            dateGroups.map((group) => {
              const isExpanded = expandedDateKeys.has(group.dateKey);

              return (
                <div
                  className="overflow-hidden rounded-md border border-line bg-subtle"
                  key={group.dateKey}
                >
                  <button
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm font-semibold text-ink transition hover:bg-surface"
                    onClick={() => toggleDateGroup(group.dateKey)}
                    type="button"
                  >
                    <span>{group.label}</span>
                    <span className="flex items-center gap-2 text-xs text-ink-muted">
                      {group.events.length}
                      <ChevronDown
                        aria-hidden="true"
                        className={`transition ${isExpanded ? "rotate-180" : ""}`}
                        size={16}
                      />
                    </span>
                  </button>
                  {isExpanded ? (
                    <div className="grid gap-2 border-t border-line bg-surface p-2">
                      {group.events.map(({ event, kind }) => (
                        <article
                          className="grid gap-3 rounded-md border border-line bg-surface p-3 lg:grid-cols-[4.5rem_minmax(0,1fr)_auto]"
                          key={event.id}
                        >
                          <time
                            className="text-sm font-semibold text-ink"
                            dateTime={event.startedAt}
                          >
                            {formatPresenceTime(event.startedAt)}
                          </time>
                          <p className="m-0 min-w-0 truncate text-sm font-semibold text-ink">
                            {formatJourneyMacroText(event, kind)}
                          </p>
                          <Badge variant={getJourneyBadgeVariant(kind)}>
                            {formatJourneyEventLabel(kind)}
                          </Badge>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : shouldShowCurrentStatus && selectedMember ? (
            <div className="overflow-hidden rounded-md border border-line bg-subtle">
              <div className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm font-semibold text-ink">
                <span>{formatPresenceDate(snapshot.generatedAt)}</span>
                <span className="text-xs text-ink-muted">1</span>
              </div>
              <div className="grid gap-2 border-t border-line bg-surface p-2">
                <article className="grid gap-3 rounded-md border border-line bg-surface p-3 lg:grid-cols-[4.5rem_minmax(0,1fr)_auto]">
                  <time
                    className="text-sm font-semibold text-ink"
                    dateTime={snapshot.generatedAt}
                  >
                    {formatPresenceTime(snapshot.generatedAt)}
                  </time>
                  <p className="m-0 min-w-0 truncate text-sm font-semibold text-ink">
                    {formatCurrentStatusText(selectedMember)}
                  </p>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold ${operationStatusStyle[selectedMember.currentStatus]}`}
                  >
                    {operationStatusLabel[selectedMember.currentStatus]}
                  </span>
                </article>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-line bg-subtle p-4 text-sm text-ink-muted">
              Nenhum registro.
            </div>
          )}
        </div>
      </Surface>
    </section>
  );
}

function AsanaPerformancePanel({
  className,
  error,
  isLoading,
  onRefresh,
  onPeriodChange,
  period,
  snapshot,
}: {
  className?: string;
  error: string | null;
  isLoading: boolean;
  onRefresh: () => void;
  onPeriodChange: (period: AsanaPerformancePeriodRequest) => void;
  period: AsanaPerformancePeriodRequest;
  snapshot: AsanaTeamPerformanceSnapshot | null;
}) {
  const totals = snapshot?.totals;
  const shouldShowConfig =
    snapshot?.status === "missing_config" ||
    snapshot?.status === "error" ||
    !snapshot ||
    error;

  return (
    <Surface
      bordered
      className={`border-line bg-surface p-5 shadow-[0_12px_30px_rgb(16_24_32_/_0.06)] ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PanelTitle
          eyebrow="Asana"
          title="Performance dos colaboradores"
        />
        <div className="flex items-center gap-2">
          <Badge variant={snapshot?.status === "configured" ? "success" : "warning"}>
            {snapshot?.status === "configured"
              ? snapshot.source.period.label
              : "configuracao"}
          </Badge>
          <Badge variant="neutral">
            {snapshot?.source.workspaceMode === "filtered"
              ? `${snapshot.source.workspaces.length} espacos`
              : "todos espacos"}
          </Badge>
          <Badge variant="neutral">data de entrega no periodo</Badge>
          <Badge variant="neutral">responsavel</Badge>
          {snapshot?.source.limitReached ? (
            <Badge variant="warning">limite atingido</Badge>
          ) : null}
          <button
            aria-label="Atualizar painel Asana"
            className="grid h-9 w-9 place-items-center rounded-md border border-line bg-surface text-ink-muted transition hover:bg-subtle hover:text-ink"
            disabled={isLoading}
            onClick={onRefresh}
            type="button"
          >
            {isLoading ? (
              <PanteonLoadingMark size="xs" />
            ) : (
              <RefreshCw aria-hidden="true" size={16} />
            )}
          </button>
        </div>
      </div>
      <AsanaPeriodControls
        disabled={isLoading}
        onChange={onPeriodChange}
        period={period}
      />
      {shouldShowConfig ? (
        <AsanaConfigState
          error={error}
          isLoading={isLoading}
          snapshot={snapshot}
        />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <AsanaKpi
              icon={<Target size={16} />}
              label="com entrega"
              value={totals?.total ?? 0}
            />
            <AsanaKpi
              icon={<CalendarCheck2 size={16} />}
              label="a vencer"
              value={totals?.dueSoon ?? 0}
            />
            <AsanaKpi
              icon={<AlertTriangle size={16} />}
              label="vencidas"
              tone="danger"
              value={totals?.overdue ?? 0}
            />
            <AsanaKpi
              icon={<CheckCircle2 size={16} />}
              label="no prazo"
              tone="success"
              value={totals?.completedOnTime ?? 0}
            />
            <AsanaKpi
              icon={<Clock3 size={16} />}
              label="fora prazo"
              tone="danger"
              value={totals?.completedLate ?? 0}
            />
          </div>
          <div className="mt-4 grid gap-2">
            {(snapshot?.collaborators ?? []).map((collaborator) => (
              <AsanaCollaboratorRow
                collaborator={collaborator}
                key={collaborator.hubUserId}
              />
            ))}
          </div>
        </>
      )}
    </Surface>
  );
}

function AsanaPeriodControls({
  disabled,
  onChange,
  period,
}: {
  disabled: boolean;
  onChange: (period: AsanaPerformancePeriodRequest) => void;
  period: AsanaPerformancePeriodRequest;
}) {
  const presets = [
    { label: "Hoje", value: "today" },
    { label: "Semana", value: "week" },
    { label: "Mes", value: "month" },
  ] as const;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-line bg-subtle p-2">
      <div className="inline-flex rounded-md border border-line bg-surface p-1">
        {presets.map((preset) => (
          <button
            aria-pressed={period.preset === preset.value}
            className={`h-8 rounded px-3 text-xs font-semibold transition ${
              period.preset === preset.value
                ? "bg-inverse text-brand-ink dark:bg-white/[0.14] dark:text-ink"
                : "text-ink-muted hover:bg-subtle hover:text-ink"
            }`}
            disabled={disabled}
            key={preset.value}
            onClick={() => onChange(createAsanaPeriod(preset.value))}
            type="button"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
        Inicio
        <input
          className="h-9 rounded-md border border-line bg-surface px-2 text-sm font-semibold normal-case tracking-normal text-ink"
          disabled={disabled}
          onChange={(event) =>
            onChange({
              endDate: period.endDate,
              preset: "custom",
              startDate: event.target.value || period.startDate,
            })
          }
          type="date"
          value={period.startDate}
        />
      </label>
      <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
        Fim
        <input
          className="h-9 rounded-md border border-line bg-surface px-2 text-sm font-semibold normal-case tracking-normal text-ink"
          disabled={disabled}
          onChange={(event) =>
            onChange({
              endDate: event.target.value || period.endDate,
              preset: "custom",
              startDate: period.startDate,
            })
          }
          type="date"
          value={period.endDate}
        />
      </label>
    </div>
  );
}

function AsanaConfigState({
  error,
  isLoading,
  snapshot,
}: {
  error: string | null;
  isLoading: boolean;
  snapshot: AsanaTeamPerformanceSnapshot | null;
}) {
  if (isLoading) {
    return (
      <PanteonLoadingState
        className="mt-4"
        minHeightClassName="min-h-52"
        title="Carregando"
      />
    );
  }

  const missingEnv = snapshot?.source.missingEnv ?? [
    "ASANA_ACCESS_TOKEN",
  ];

  return (
    <div className="mt-4 grid min-h-52 place-items-center rounded-md border border-dashed border-line bg-subtle p-5 text-center">
      <div className="max-w-xl">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#A07C3B]/12 text-[#A07C3B]">
          <KeyRound aria-hidden="true" size={20} />
        </span>
        <p className="m-0 mt-3 text-sm font-semibold text-ink">
          Configurar Asana server-side
        </p>
        <p className="m-0 mt-2 text-xs leading-5 text-ink-muted">
          {error ??
            snapshot?.message ??
            "O token deve ficar somente no ambiente do servidor. Em modo geral, a Home busca todos os espacos de trabalho acessiveis e cruza os colaboradores pelo e-mail cadastrado."}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {missingEnv.map((key) => (
            <code
              className="rounded-md border border-[#eadfc8] bg-surface px-2 py-1 text-xs font-semibold text-[#6f5728]"
              key={key}
            >
              {key}
            </code>
          ))}
          <code className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink-muted">
            ASANA_WORKSPACE_MODE=all
          </code>
          <code className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink-muted">
            ASANA_WORKSPACE_GIDS opcional
          </code>
          <code className="rounded-md border border-line bg-surface px-2 py-1 text-xs font-semibold text-ink-muted">
            ASANA_TASK_WINDOW_DAYS
          </code>
        </div>
      </div>
    </div>
  );
}

function AsanaKpi({
  icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: ReactNode;
  label: string;
  tone?: "danger" | "neutral" | "success";
  value: number | string;
}) {
  const toneClasses: Record<"danger" | "neutral" | "success", string> = {
    danger: "text-red-700",
    neutral: "text-ink",
    success: "text-emerald-700",
  };

  return (
    <div className="rounded-md border border-line bg-subtle p-3">
      <div className={`flex items-center gap-2 text-xs ${toneClasses[tone]}`}>
        {icon}
        <span className="font-semibold uppercase tracking-[0.08em]">
          {label}
        </span>
      </div>
      <p className={`m-0 mt-2 text-xl font-semibold ${toneClasses[tone]}`}>
        {value}
      </p>
    </div>
  );
}

function AsanaCollaboratorRow({
  collaborator,
}: {
  collaborator: AsanaCollaboratorPerformance;
}) {
  const onTimeRate = collaborator.onTimeRate ?? 0;
  const lateRate = collaborator.lateRate ?? 0;
  const overdueRate = collaborator.overdueRate ?? 0;
  const dueSoonRate = collaborator.dueSoonRate ?? 0;

  return (
    <article className="grid grid-cols-2 items-center gap-3 rounded-md border border-line bg-subtle p-3 2xl:grid-cols-[minmax(12rem,1.15fr)_repeat(6,minmax(4.2rem,0.5fr))_minmax(12rem,0.9fr)]">
      <div className="min-w-0">
        <p className="m-0 truncate text-sm font-semibold text-ink">
          {collaborator.name}
        </p>
        <p className="m-0 mt-1 truncate text-xs text-ink-muted">
          {collaborator.matched
            ? `${collaborator.email} / ${formatWorkspaceNames(collaborator.workspaceNames)}`
            : "sem usuario Asana"}
        </p>
        {collaborator.limitReached ? (
          <span className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[0.6875rem] font-semibold text-amber-700">
            limite operacional atingido
          </span>
        ) : null}
      </div>
      <CompactMetric label="com entrega" value={collaborator.total} />
      <CompactMetric label="a vencer" value={collaborator.dueSoon} />
      <CompactMetric
        label="vencidas"
        tone={collaborator.overdue > 0 ? "danger" : "neutral"}
        value={collaborator.overdue}
      />
      <CompactMetric label="no prazo" value={collaborator.completedOnTime} />
      <CompactMetric
        label="fora prazo"
        tone={collaborator.completedLate > 0 ? "danger" : "neutral"}
        value={collaborator.completedLate}
      />
      <CompactMetric
        label="atraso medio"
        value={formatDelayDays(collaborator.averageDelayDays)}
      />
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-ink-soft">
          <span>{formatPercent(collaborator.onTimeRate)} no prazo</span>
          <span>{formatPercent(collaborator.lateRate)} fora</span>
          <span>{formatPercent(collaborator.overdueRate)} venc.</span>
          <span>{formatPercent(collaborator.dueSoonRate)} a vencer</span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-subtle">
          <span
            className="bg-emerald-500"
            style={{ width: `${onTimeRate}%` }}
          />
          <span
            className="bg-rose-500"
            style={{ width: `${lateRate}%` }}
          />
          <span
            className="bg-amber-500"
            style={{ width: `${overdueRate}%` }}
          />
          <span
            className="bg-sky-500"
            style={{ width: `${dueSoonRate}%` }}
          />
        </div>
      </div>
    </article>
  );
}

function CompactMetric({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "danger" | "neutral";
  value: number | string;
}) {
  return (
    <div>
      <p
        className={`m-0 text-sm font-semibold ${
          tone === "danger" ? "text-red-700" : "text-ink"
        }`}
      >
        {value}
      </p>
      <p className="m-0 mt-1 text-[0.6875rem] uppercase tracking-[0.08em] text-ink-muted">
        {label}
      </p>
    </div>
  );
}

function PanelTitle({
  dark = false,
  eyebrow,
  title,
}: {
  dark?: boolean;
  eyebrow: string;
  title: string;
}) {
  return (
    <div>
      <p
        className={`m-0 text-xs font-medium uppercase tracking-[0.14em] ${
          dark ? "text-white/55" : "text-ink-muted"
        }`}
      >
        {eyebrow}
      </p>
      <h2
        className={`m-0 mt-1 text-base font-semibold ${
          dark ? "text-white" : "text-ink"
        }`}
      >
        {title}
      </h2>
    </div>
  );
}

function _PulseMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Surface bordered className="border-line bg-surface p-3 shadow-[0_8px_20px_rgb(16_24_32_/_0.045)]">
      <div className="flex items-center justify-between gap-2 text-[#A07C3B]">
        {icon}
        <span className="h-2 w-2 rounded-full bg-[#A07C3B]" />
      </div>
      <p className="m-0 mt-3 text-2xl font-semibold text-ink">{value}</p>
      <p className="m-0 mt-1 text-xs text-ink-muted">{label}</p>
    </Surface>
  );
}

function _StatusPill({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "away" | "lunch" | "meeting" | "neutral" | "offline" | "online";
}) {
  const classNames = {
    away: "border-red-200 bg-red-50 text-red-700",
    lunch: "border-yellow-200 bg-yellow-50 text-yellow-700",
    meeting: "border-sky-200 bg-sky-50 text-sky-700",
    neutral: "border-zinc-200 bg-zinc-50 text-zinc-600",
    offline: "border-zinc-200 bg-zinc-50 text-zinc-600",
    online: "border-emerald-200 bg-emerald-50 text-emerald-700",
  } as const satisfies Record<typeof variant, string>;

  return (
    <div className={`rounded-md border px-3 py-2 ${classNames[variant]}`}>
      <p className="m-0 text-lg font-semibold">{value}</p>
      <p className="m-0 text-xs">{label}</p>
    </div>
  );
}

function _MiniLightMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-subtle p-2.5">
      <p className="m-0 text-sm font-semibold text-ink">{value}</p>
      <p className="m-0 mt-1 text-xs text-ink-muted">{label}</p>
    </div>
  );
}

function getPresenceDotClassName(status: HubPresenceStatus) {
  const classNames = {
    agenda: "bg-sky-500",
    away: "bg-red-500",
    busy: "bg-sky-500",
    lunch: "bg-yellow-400",
    offline: "bg-zinc-400",
    online: "bg-emerald-500",
  } as const satisfies Record<HubPresenceStatus, string>;

  return classNames[status];
}

function formatPresenceTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPresenceDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function getJourneyEventKind(event: JourneyEventRecord): AvailabilityEventKind | null {
  if (event.reason === "login" && event.nextStatus === "online") {
    return "login";
  }

  if (event.reason === "logout" || event.nextStatus === "offline") {
    return "logout";
  }

  if (event.nextStatus === "away") {
    return "away";
  }

  if (event.nextStatus === "lunch") {
    return "lunch";
  }

  if (
    event.nextStatus === "online" &&
    (event.previousStatus === "away" ||
      event.previousStatus === "lunch")
  ) {
    return "return";
  }

  if (
    event.nextStatus === "online" &&
    (!event.previousStatus || event.previousStatus === "offline")
  ) {
    return "login";
  }

  return null;
}

function formatJourneyEventLabel(kind: AvailabilityEventKind) {
  const labels = {
    away: "Ausente",
    login: "Login",
    logout: "Logout",
    lunch: "Almoco",
    return: "Online",
  } as const satisfies Record<AvailabilityEventKind, string>;

  return labels[kind];
}

function _countJourneyEvents<T extends { kind: AvailabilityEventKind }>(
  events: T[],
  kind: AvailabilityEventKind,
) {
  return events.filter((event) => event.kind === kind).length;
}

function getJourneyBadgeVariant(kind: AvailabilityEventKind) {
  const variants = {
    away: "warning",
    login: "success",
    logout: "danger",
    lunch: "neutral",
    return: "info",
  } as const satisfies Record<
    AvailabilityEventKind,
    "danger" | "info" | "neutral" | "success" | "warning"
  >;

  return variants[kind];
}

function createJourneyEventItems(events: JourneyEventRecord[]) {
  const eventsByUser = new Map<string, JourneyEventItem[]>();
  const normalizedItems: JourneyEventItem[] = [];
  const sortedEvents = [...events].sort(
    (firstEvent, secondEvent) =>
      Date.parse(firstEvent.startedAt) - Date.parse(secondEvent.startedAt),
  );

  for (const event of sortedEvents) {
    const kind = getJourneyEventKind(event);

    if (!kind) {
      continue;
    }

    const userKey = event.userId ?? "__current_user";
    const userItems = eventsByUser.get(userKey) ?? [];

    if (kind === "logout") {
      const syntheticAway = createSyntheticAwayBeforeLogout(event, userItems);

      if (syntheticAway) {
        pushJourneyEventItem({
          eventsByUser,
          item: syntheticAway,
          normalizedItems,
          userKey,
        });
      }
    }

    pushJourneyEventItem({
      eventsByUser,
      item: { event, kind },
      normalizedItems,
      userKey,
    });
  }

  return normalizedItems.sort(
    (firstItem, secondItem) =>
      Date.parse(secondItem.event.startedAt) -
      Date.parse(firstItem.event.startedAt),
  );
}

function pushJourneyEventItem({
  eventsByUser,
  item,
  normalizedItems,
  userKey,
}: {
  eventsByUser: Map<string, JourneyEventItem[]>;
  item: JourneyEventItem;
  normalizedItems: JourneyEventItem[];
  userKey: string;
}) {
  const userItems = eventsByUser.get(userKey) ?? [];
  const previousItem = userItems.at(-1);

  if (previousItem && shouldReplacePreviousJourneyEvent(previousItem, item)) {
    userItems[userItems.length - 1] = item;
    const previousIndex = normalizedItems.indexOf(previousItem);

    if (previousIndex >= 0) {
      normalizedItems[previousIndex] = item;
    }

    eventsByUser.set(userKey, userItems);
    return;
  }

  if (shouldSkipJourneyEvent(previousItem, item)) {
    return;
  }

  userItems.push(item);
  normalizedItems.push(item);
  eventsByUser.set(userKey, userItems);
}

function shouldReplacePreviousJourneyEvent(
  previousItem: JourneyEventItem,
  item: JourneyEventItem,
) {
  return (
    item.kind === "lunch" &&
    previousItem.kind === "return" &&
    getJourneyTimeDeltaMs(previousItem, item) <= 60_000
  );
}

function shouldSkipJourneyEvent(
  previousItem: JourneyEventItem | undefined,
  item: JourneyEventItem,
) {
  if (!previousItem) {
    return false;
  }

  const deltaMs = getJourneyTimeDeltaMs(previousItem, item);

  if (item.kind === previousItem.kind) {
    if (item.kind === "login") {
      return (
        getPresenceDateInputValue(previousItem.event.startedAt) ===
          getPresenceDateInputValue(item.event.startedAt) &&
        deltaMs <= 120_000
      );
    }

    return true;
  }

  if (
    isPositiveJourneyEvent(item.kind) &&
    isPositiveJourneyEvent(previousItem.kind)
  ) {
    return true;
  }

  if (
    item.kind === "return" &&
    previousItem.kind !== "away" &&
    previousItem.kind !== "lunch"
  ) {
    return true;
  }

  if (
    item.kind === "return" &&
    previousItem.kind === "lunch" &&
    item.event.reason !== "manual" &&
    deltaMs <= 60_000
  ) {
    return true;
  }

  if (
    item.kind === "away" &&
    (previousItem.kind === "login" || previousItem.kind === "return") &&
    deltaMs < HUB_IDLE_TIMEOUT_MS &&
    getJourneyIdleMs(item.event) < HUB_IDLE_TIMEOUT_MS
  ) {
    return true;
  }

  return false;
}

function isPositiveJourneyEvent(kind: AvailabilityEventKind) {
  return kind === "login" || kind === "return";
}

function createSyntheticAwayBeforeLogout(
  event: JourneyEventRecord,
  userItems: JourneyEventItem[],
): JourneyEventItem | null {
  const previousItem = userItems.at(-1);

  if (previousItem?.kind === "away" || previousItem?.kind === "lunch") {
    return null;
  }

  const logoutTime = Date.parse(event.startedAt);

  if (Number.isNaN(logoutTime)) {
    return null;
  }

  const idleMs = Math.max(
    getJourneyIdleMs(event),
    HUB_AUTO_LOGOUT_TIMEOUT_MS,
  );
  const startedAt = new Date(
    logoutTime - Math.max(0, idleMs - HUB_IDLE_TIMEOUT_MS),
  ).toISOString();

  if (
    previousItem &&
    (previousItem.kind === "login" || previousItem.kind === "return") &&
    Date.parse(startedAt) - Date.parse(previousItem.event.startedAt) <
      HUB_IDLE_TIMEOUT_MS
  ) {
    return null;
  }

  return {
    event: {
      ...event,
      id: `${event.id}:synthetic-away`,
      metadata: {
        ...event.metadata,
        synthetic: true,
      },
      nextStatus: "away",
      previousStatus: previousItem?.event.nextStatus ?? event.previousStatus,
      reason: "idle",
      startedAt,
    },
    kind: "away",
  };
}

function getJourneyTimeDeltaMs(
  previousItem: JourneyEventItem,
  item: JourneyEventItem,
) {
  return Math.abs(
    Date.parse(item.event.startedAt) - Date.parse(previousItem.event.startedAt),
  );
}

function getJourneyIdleMs(event: JourneyEventRecord) {
  const value = event.metadata?.idleMs;

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function groupJourneyEventsByDate(events: JourneyEventItem[]) {
  const groups = new Map<string, JourneyDateGroup>();

  for (const item of events) {
    const dateKey = getPresenceDateInputValue(item.event.startedAt);
    const group = groups.get(dateKey);

    if (group) {
      group.events.push(item);
    } else {
      groups.set(dateKey, {
        dateKey,
        events: [item],
        label: formatPresenceDate(item.event.startedAt),
      });
    }
  }

  return [...groups.values()];
}

function getPresenceDateInputValue(value: string) {
  const date = new Date(value);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatJourneyMacroText(
  event: JourneyEventRecord & { startedAt: string; userName?: string },
  kind: AvailabilityEventKind,
) {
  const name = event.userName ?? "Usuario";

  const labels = {
    away: `${name} ficou ausente`,
    login: `${name} fez login`,
    logout: `${name} foi deslogado`,
    lunch: `${name} saiu para almoco`,
    return: `${name} ficou online`,
  } as const satisfies Record<AvailabilityEventKind, string>;

  return labels[kind];
}

function shouldShowCurrentStatusFallback(
  status: HomePresenceStatus,
  dateFilter: string,
  eventFilter: AvailabilityEventFilter,
  generatedAt: string,
) {
  if (dateFilter && dateFilter !== getPresenceDateInputValue(generatedAt)) {
    return false;
  }

  if (eventFilter === "all") {
    return true;
  }

  const matchingFilter = {
    agenda: null,
    away: "away",
    lunch: "lunch",
    offline: null,
    online: "return",
  } as const satisfies Record<HomePresenceStatus, AvailabilityEventFilter | null>;

  return matchingFilter[status] === eventFilter;
}

function formatCurrentStatusText(member: HubAvailabilitySnapshot["team"][number]) {
  const labels = {
    agenda: `${member.displayName} esta em agenda`,
    away: `${member.displayName} esta ausente`,
    lunch: `${member.displayName} esta em almoco`,
    offline: `${member.displayName} esta offline`,
    online: `${member.displayName} esta online`,
  } as const satisfies Record<HomePresenceStatus, string>;

  return labels[member.currentStatus];
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "sem prazo";
  }

  return `${value.toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  })}%`;
}

function formatDelayDays(value: number) {
  if (value <= 0) {
    return "0d";
  }

  return `${value.toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  })}d`;
}

function createAsanaPeriod(
  preset: AsanaPerformancePeriodRequest["preset"],
): AsanaPerformancePeriodRequest {
  const now = new Date();
  const start = new Date(now);

  if (preset === "today") {
    return {
      endDate: formatDateInput(now),
      preset,
      startDate: formatDateInput(now),
    };
  }

  if (preset === "week") {
    const day = now.getDay();
    const mondayOffset = day === 0 ? 6 : day - 1;
    start.setDate(now.getDate() - mondayOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    return {
      endDate: formatDateInput(end),
      preset,
      startDate: formatDateInput(start),
    };
  }

  start.setDate(1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    endDate: formatDateInput(end),
    preset: "month",
    startDate: formatDateInput(start),
  };
}

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatWorkspaceNames(workspaceNames: string[]) {
  if (workspaceNames.length === 0) {
    return "sem workspace";
  }

  if (workspaceNames.length <= 2) {
    return workspaceNames.join(", ");
  }

  return `${workspaceNames.slice(0, 2).join(", ")} +${workspaceNames.length - 2}`;
}

function createTeamMembers(snapshot: HubHomeSnapshot | null): HomeTeamMember[] {
  const presenceByUserId = new Map(
    (snapshot?.presence ?? []).map((presence) => [
      presence.userId,
      presence,
    ]),
  );

  return (snapshot?.users ?? [])
    .filter((user) => user.status === "active")
    .map((user) => {
      const presence = presenceByUserId.get(user.id);
      const status = normalizeHomePresenceStatus(presence?.status);

      return {
        avatarUrl: user.avatarUrl,
        id: user.id,
        initials: getInitials(user.displayName),
        lastSignal: formatPresenceSignal(presence?.lastSeenAt, status),
        name: user.displayName,
        scopeLabel: getUserScopeLabel(user),
        status,
      };
    });
}

function normalizeHomePresenceStatus(
  status?: HubPresenceStatus,
): HomePresenceStatus {
  return normalizeHubPresenceStatus(status ?? "offline") as HomePresenceStatus;
}

function countTeamStatus(
  members: readonly HomeTeamMember[],
  status: HomePresenceStatus,
): number {
  return members.filter((member) => member.status === status).length;
}

function expandPantheonModuleIds(moduleIds: string[]) {
  const expandedIds = new Set(moduleIds);
  const legacyToPantheonModuleIds = {
    caredesk: "iris",
    guardian: "hades",
    pulsex: "hermes",
    squadops: "zeus",
  } as const;

  for (const moduleId of moduleIds) {
    const pantheonId =
      legacyToPantheonModuleIds[
        moduleId as keyof typeof legacyToPantheonModuleIds
      ];

    if (pantheonId) {
      expandedIds.add(pantheonId);
    }
  }

  return expandedIds;
}

function formatPresenceSignal(
  value: string | undefined,
  status: HomePresenceStatus,
) {
  if (!value) {
    return "sem registro";
  }

  if (status === "offline") {
    return "offline";
  }

  const diffMs = Date.now() - Date.parse(value);

  if (Number.isNaN(diffMs) || diffMs < 120_000) {
    return "agora";
  }

  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);

  return `${hours}h${(minutes % 60).toString().padStart(2, "0")}`;
}

function getOperationalRoleLabel(user: HubHomeUser) {
  const labels: Record<string, string> = {
    adm: "Administrador",
    admin: "Administrador",
    cdr: "Coordenador",
    ldr: "Lider",
    leader: "Lider",
    op1: "Operador",
    op2: "Operador",
    op3: "Operador",
    operator: "Operador",
    viewer: "Leitura",
  };
  const key = user.operationalProfile ?? user.role;

  return labels[key] ?? key;
}

function getUserScopeLabel(user: HubHomeUser) {
  const roleLabel = getOperationalRoleLabel(user);
  const scope = user.sectorName ?? user.departmentName;

  return scope ? `${roleLabel} / ${scope}` : roleLabel;
}

function getInitials(name: string) {
  const [first = "", second = ""] = name.trim().split(/\s+/);

  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || "--";
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Bom dia";
  }

  if (hour < 18) {
    return "Boa tarde";
  }

  return "Boa noite";
}

function getFirstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}
