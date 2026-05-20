"use client";

import {
  getHubPresenceLabel,
  getHubPresenceTodaySummary,
  normalizeHubPresenceStatus,
  type HubPresenceStatus,
  type HubPresenceSummary,
} from "@/lib/hub-presence";
import {
  getHubHomeSnapshot,
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
import { HubShell } from "@/layouts/hub-shell";
import { useAuth } from "@/providers/auth-provider";
import {
  canAccessModule,
  isHubModuleActive,
  orderedHubModules,
} from "@repo/shared";
import { Badge, Surface, WorkspaceHeader, WorkspaceLayout } from "@repo/uix";
import {
  AlertTriangle,
  Bell,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  KeyRound,
  ListChecks,
  MessageSquareText,
  Percent,
  RefreshCw,
  Target,
  TimerReset,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

type HomePresenceStatus = Exclude<HubPresenceStatus, "busy">;

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
  agenda: "em reuniao",
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

export default function HomePage() {
  const { hubUser } = useAuth();
  const [activeHomeTab, setActiveHomeTab] = useState<"overview" | "tickets">(
    "overview",
  );
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
  const availableModules = orderedHubModules.filter(
    (hubModule) =>
      hubModule.id !== "zeus" &&
      isHubModuleActive(hubModule) &&
      Boolean(hubUser && canAccessModule(hubUser, hubModule)) &&
      activeModuleIds.has(hubModule.id) &&
      enabledModuleIds.has(hubModule.id),
  );
  const onlineCount = countTeamStatus(teamMembers, "online");
  const awayCount = countTeamStatus(teamMembers, "away");
  const lunchCount = countTeamStatus(teamMembers, "lunch");
  const meetingCount = countTeamStatus(teamMembers, "agenda");
  const offlineCount = countTeamStatus(teamMembers, "offline");
  const taskCount = asanaSnapshot?.totals.total ?? 0;
  const unreadNotificationsCount = snapshot?.notifications.unreadCount ?? 0;
  const peopleCount = teamMembers.length;
  const messagesTodayCount = snapshot?.pulsex.messagesTodayCount ?? 0;

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
    <HubShell>
      <WorkspaceLayout
        className="careli-home"
        header={
          <WorkspaceHeader title={`${getGreeting()}, ${displayName}.`} />
        }
      >
        {homeError ? (
          <Surface bordered className="border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
            {homeError}
          </Surface>
        ) : null}

        <HomeTabs
          activeTab={activeHomeTab}
          onTabChange={setActiveHomeTab}
        />

        {activeHomeTab === "tickets" ? (
          <HubUserTicketsPanel title="Meus tickets TI" />
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <PulseMetric icon={<CalendarCheck2 size={18} />} label="reunioes" value={meetingCount} />
              <PulseMetric icon={<ListChecks size={18} />} label="tasks" value={taskCount} />
              <PulseMetric icon={<MessageSquareText size={18} />} label="mensagens hoje" value={messagesTodayCount} />
              <PulseMetric icon={<Bell size={18} />} label="notificacoes" value={unreadNotificationsCount} />
              <PulseMetric icon={<Users size={18} />} label="usuarios ativos" value={peopleCount} />
              <PulseMetric icon={<TimerReset size={18} />} label="modulos ativos" value={availableModules.length} />
            </section>

            <section className="grid grid-cols-12 gap-5">
              <Surface bordered className="col-span-12 border-[#d9e0e7] bg-white p-5 shadow-[0_14px_34px_rgb(16_24_32_/_0.07)] xl:col-span-7">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <PanelTitle
                    eyebrow={isAdmin ? "Central adm" : "Mapa operacional"}
                    title="Ritmo da equipe"
                  />
                  <Badge variant="info">ausente apos 10 min</Badge>
                </div>
                <div className="mt-4 grid grid-cols-5 gap-2">
                  <StatusPill label="online" value={onlineCount} variant="online" />
                  <StatusPill label="ausentes" value={awayCount} variant="away" />
                  <StatusPill label="almoco" value={lunchCount} variant="lunch" />
                  <StatusPill label="reuniao" value={meetingCount} variant="meeting" />
                  <StatusPill label="offline" value={offlineCount} variant="offline" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {teamMembers.map((member) => (
                    <article
                      className="grid min-h-20 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3"
                      key={member.id}
                    >
                      <TeamAvatar member={member} />
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-semibold text-[#17202f]">
                          {member.name}
                        </p>
                        <p className="m-0 mt-1 truncate text-xs text-[#667085]">
                          {member.scopeLabel} / {member.lastSignal}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-1 text-xs font-semibold ${operationStatusStyle[member.status]}`}
                      >
                        {operationStatusLabel[member.status]}
                      </span>
                    </article>
                  ))}
                  {teamMembers.length === 0 ? (
                    <div className="col-span-2 rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-5 text-sm text-[#667085]">
                      Nenhum usuario ativo encontrado no Supabase.
                    </div>
                  ) : null}
                </div>
              </Surface>

              <Surface bordered className="col-span-12 border-[#d9e0e7] bg-white p-5 shadow-[0_18px_42px_rgb(16_24_32_/_0.08)] xl:col-span-5">
                <PanelTitle
                  eyebrow="Rotina"
                  title="Agenda e tarefas"
                />
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <DayMetric label="reunioes agora" value={meetingCount} />
                  <DayMetric label="criadas no periodo" value={taskCount} />
                  <DayMetric
                    label="AT"
                    value={asanaSnapshot?.totals.overdue ?? 0}
                  />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <DayMetric
                    label="CP"
                    value={asanaSnapshot?.totals.completedOnTime ?? 0}
                  />
                  <DayMetric
                    label="CA"
                    value={asanaSnapshot?.totals.completedLate ?? 0}
                  />
                </div>
              </Surface>

              <PresenceTodayPanel className="col-span-12 xl:col-span-4" />
              <AsanaPerformancePanel
                className="col-span-12 xl:col-span-8"
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
    </HubShell>
  );
}

function HomeTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: "overview" | "tickets";
  onTabChange: (tab: "overview" | "tickets") => void;
}) {
  return (
    <nav className="inline-grid w-fit grid-cols-2 rounded-lg border border-[#d9e0e7] bg-white p-1 shadow-[0_8px_22px_rgb(16_24_32_/_0.05)]">
      <button
        aria-pressed={activeTab === "overview"}
        className={`h-9 rounded-md px-4 text-sm font-semibold transition ${
          activeTab === "overview"
            ? "bg-[#101820] text-white"
            : "text-[#667085] hover:bg-[#f5f7fa] hover:text-[#101820]"
        }`}
        onClick={() => onTabChange("overview")}
        type="button"
      >
        Principal
      </button>
      <button
        aria-pressed={activeTab === "tickets"}
        className={`h-9 rounded-md px-4 text-sm font-semibold transition ${
          activeTab === "tickets"
            ? "bg-[#101820] text-white"
            : "text-[#667085] hover:bg-[#f5f7fa] hover:text-[#101820]"
        }`}
        onClick={() => onTabChange("tickets")}
        type="button"
      >
        Ticket TI
      </button>
    </nav>
  );
}

function TeamAvatar({ member }: { member: HomeTeamMember }) {
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

function DayMetric({
  label,
  note,
  value,
}: {
  label: string;
  note?: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3">
      <p className="m-0 text-2xl font-semibold text-[#101820]">{value}</p>
      <p className="m-0 mt-1 text-xs text-[#667085]">{label}</p>
      {note ? (
        <p className="m-0 mt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[#A07C3B]">
          {note}
        </p>
      ) : null}
    </div>
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
      className={`border-[#d9e0e7] bg-white p-5 shadow-[0_12px_30px_rgb(16_24_32_/_0.06)] ${className ?? ""}`}
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
          <Badge variant="neutral">criadas no periodo</Badge>
          <Badge variant="neutral">responsavel</Badge>
          {snapshot?.source.limitReached ? (
            <Badge variant="warning">limite atingido</Badge>
          ) : null}
          <button
            aria-label="Atualizar painel Asana"
            className="grid h-9 w-9 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#667085] transition hover:bg-[#f5f7fa] hover:text-[#101820]"
            disabled={isLoading}
            onClick={onRefresh}
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={isLoading ? "animate-spin" : ""}
              size={16}
            />
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
              label="criadas"
              value={totals?.total ?? 0}
            />
            <AsanaKpi
              icon={<AlertTriangle size={16} />}
              label="AT"
              tone="danger"
              value={totals?.overdue ?? 0}
            />
            <AsanaKpi
              icon={<CheckCircle2 size={16} />}
              label="CP"
              tone="success"
              value={totals?.completedOnTime ?? 0}
            />
            <AsanaKpi
              icon={<Clock3 size={16} />}
              label="CA"
              tone="danger"
              value={totals?.completedLate ?? 0}
            />
            <AsanaKpi
              icon={<Percent size={16} />}
              label="CP / total"
              value={formatPercent(totals?.onTimeRate)}
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
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-2">
      <div className="inline-flex rounded-md border border-[#d9e0e7] bg-white p-1">
        {presets.map((preset) => (
          <button
            aria-pressed={period.preset === preset.value}
            className={`h-8 rounded px-3 text-xs font-semibold transition ${
              period.preset === preset.value
                ? "bg-[#101820] text-white"
                : "text-[#667085] hover:bg-[#f5f7fa] hover:text-[#101820]"
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
      <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#8a97a8]">
        Inicio
        <input
          className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2 text-sm font-semibold normal-case tracking-normal text-[#17202f]"
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
      <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#8a97a8]">
        Fim
        <input
          className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2 text-sm font-semibold normal-case tracking-normal text-[#17202f]"
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
  const missingEnv = snapshot?.source.missingEnv ?? [
    "ASANA_ACCESS_TOKEN",
  ];

  return (
    <div className="mt-4 grid min-h-52 place-items-center rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-5 text-center">
      <div className="max-w-xl">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#fff6e3] text-[#A07C3B]">
          <KeyRound aria-hidden="true" size={20} />
        </span>
        <p className="m-0 mt-3 text-sm font-semibold text-[#101820]">
          {isLoading ? "Carregando Asana..." : "Configurar Asana server-side"}
        </p>
        <p className="m-0 mt-2 text-xs leading-5 text-[#667085]">
          {error ??
            snapshot?.message ??
            "O token deve ficar somente no ambiente do servidor. Em modo geral, a Home busca todos os espacos de trabalho acessiveis e cruza os colaboradores pelo e-mail cadastrado."}
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {missingEnv.map((key) => (
            <code
              className="rounded-md border border-[#eadfc8] bg-white px-2 py-1 text-xs font-semibold text-[#6f5728]"
              key={key}
            >
              {key}
            </code>
          ))}
          <code className="rounded-md border border-[#edf0f4] bg-white px-2 py-1 text-xs font-semibold text-[#667085]">
            ASANA_WORKSPACE_MODE=all
          </code>
          <code className="rounded-md border border-[#edf0f4] bg-white px-2 py-1 text-xs font-semibold text-[#667085]">
            ASANA_WORKSPACE_GIDS opcional
          </code>
          <code className="rounded-md border border-[#edf0f4] bg-white px-2 py-1 text-xs font-semibold text-[#667085]">
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
    neutral: "text-[#101820]",
    success: "text-emerald-700",
  };

  return (
    <div className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3">
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

  return (
    <article className="grid grid-cols-2 items-center gap-3 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3 2xl:grid-cols-[minmax(12rem,1.15fr)_repeat(5,minmax(4.5rem,0.55fr))_minmax(9rem,0.8fr)]">
      <div className="min-w-0">
        <p className="m-0 truncate text-sm font-semibold text-[#17202f]">
          {collaborator.name}
        </p>
        <p className="m-0 mt-1 truncate text-xs text-[#667085]">
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
      <CompactMetric label="criadas" value={collaborator.total} />
      <CompactMetric
        label="AT"
        tone={collaborator.overdue > 0 ? "danger" : "neutral"}
        value={collaborator.overdue}
      />
      <CompactMetric label="CP" value={collaborator.completedOnTime} />
      <CompactMetric
        label="CA"
        tone={collaborator.completedLate > 0 ? "danger" : "neutral"}
        value={collaborator.completedLate}
      />
      <CompactMetric
        label="media"
        value={formatDelayDays(collaborator.averageDelayDays)}
      />
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[#485466]">
          <span>{formatPercent(collaborator.onTimeRate)} CP</span>
          <span>{formatPercent(collaborator.lateRate)} CA</span>
          <span>{formatPercent(collaborator.overdueRate)} AT</span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[#eef1f4]">
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
          tone === "danger" ? "text-red-700" : "text-[#101820]"
        }`}
      >
        {value}
      </p>
      <p className="m-0 mt-1 text-[0.6875rem] uppercase tracking-[0.08em] text-[#8a97a8]">
        {label}
      </p>
    </div>
  );
}

function PresenceTodayPanel({ className }: { className?: string }) {
  const [summary, setSummary] = useState<HubPresenceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    function loadSummary() {
      getHubPresenceTodaySummary()
        .then((snapshot) => {
          if (!isMounted) {
            return;
          }

          setSummary(snapshot.summary ?? null);
          setError(null);
        })
        .catch((loadError: unknown) => {
          if (!isMounted) {
            return;
          }

          setError(
            loadError instanceof Error
              ? loadError.message
              : "Nao foi possivel carregar presenca.",
          );
        });
    }

    loadSummary();
    const intervalId = window.setInterval(loadSummary, 60_000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const status = summary?.currentStatus ?? "offline";

  return (
    <Surface bordered className={`border-[#d9e0e7] bg-white p-5 ${className ?? ""}`}>
      <PanelTitle eyebrow="Meu dia" title="Historico de status" />
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3">
        <div>
          <p className="m-0 text-xs text-[#667085]">Status atual</p>
          <p className="m-0 mt-1 text-sm font-semibold capitalize text-[#101820]">
            {getHubPresenceLabel(status)}
          </p>
        </div>
        <span className={`h-3 w-3 rounded-full ${getPresenceDotClassName(status)}`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniLightMetric
          label="Trabalho"
          value={formatPresenceDuration(summary?.workedSeconds ?? 0)}
        />
        <MiniLightMetric
          label="Almoco"
          value={formatPresenceDuration(summary?.totals.lunch ?? 0)}
        />
        <MiniLightMetric
          label="Agenda"
          value={formatPresenceDuration(summary?.totals.agenda ?? 0)}
        />
        <MiniLightMetric
          label="Ausente"
          value={formatPresenceDuration(summary?.totals.away ?? 0)}
        />
      </div>
      {summary?.events.length ? (
        <div className="mt-4 grid gap-2">
          {summary.events.slice(0, 3).map((event) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-xs"
              key={event.id}
            >
              <span className="truncate text-[#485466]">
                {event.previousStatus
                  ? `${getHubPresenceLabel(event.previousStatus)} -> `
                  : ""}
                {getHubPresenceLabel(event.nextStatus)}
              </span>
              <span className="text-[#667085]">
                {formatPresenceTime(event.startedAt)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 mt-3 text-xs text-[#667085]">
          {error ?? "Nenhum log registrado hoje."}
        </p>
      )}
    </Surface>
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
          dark ? "text-white/55" : "text-[#667085]"
        }`}
      >
        {eyebrow}
      </p>
      <h2
        className={`m-0 mt-1 text-base font-semibold ${
          dark ? "text-white" : "text-[#101820]"
        }`}
      >
        {title}
      </h2>
    </div>
  );
}

function PulseMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Surface bordered className="border-[#d9e0e7] bg-white p-3 shadow-[0_8px_20px_rgb(16_24_32_/_0.045)]">
      <div className="flex items-center justify-between gap-2 text-[#A07C3B]">
        {icon}
        <span className="h-2 w-2 rounded-full bg-[#A07C3B]" />
      </div>
      <p className="m-0 mt-3 text-2xl font-semibold text-[#101820]">{value}</p>
      <p className="m-0 mt-1 text-xs text-[#667085]">{label}</p>
    </Surface>
  );
}

function StatusPill({
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

function MiniLightMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-2.5">
      <p className="m-0 text-sm font-semibold text-[#101820]">{value}</p>
      <p className="m-0 mt-1 text-xs text-[#667085]">{label}</p>
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

function formatPresenceDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }

  return `${minutes}m`;
}

function formatPresenceTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

    return {
      endDate: formatDateInput(now),
      preset,
      startDate: formatDateInput(start),
    };
  }

  start.setDate(1);

  return {
    endDate: formatDateInput(now),
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
