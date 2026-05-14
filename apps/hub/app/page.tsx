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
  hubImprovements,
  type HubImprovement,
  type HubImprovementType,
} from "@/lib/operational-home";
import { HubShell } from "@/layouts/hub-shell";
import { useAuth } from "@/providers/auth-provider";
import {
  canAccessModule,
  isHubModuleActive,
  orderedHubModules,
} from "@repo/shared";
import { Badge, Surface, WorkspaceHeader, WorkspaceLayout } from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";
import {
  ArrowRight,
  Bell,
  CalendarCheck2,
  ListChecks,
  MessageSquareText,
  TimerReset,
  Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

const improvementTypeVariant = {
  "ajuste visual": "warning",
  correcao: "neutral",
  melhoria: "success",
  "novo recurso": "info",
} as const satisfies Record<HubImprovementType, BadgeVariant>;

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
  const [snapshot, setSnapshot] = useState<HubHomeSnapshot | null>(null);
  const [homeError, setHomeError] = useState<string | null>(null);
  const displayName = getFirstName(hubUser?.name ?? "Operacao");
  const isAdmin = hubUser?.role === "admin";
  const teamMembers = createTeamMembers(snapshot);
  const activeModuleIds = new Set(
    (snapshot?.modules ?? [])
      .filter((module) => module.status === "active")
      .map((module) => module.id),
  );
  const enabledModuleIds = new Set(
    (snapshot?.departmentModules ?? [])
      .filter((access) => access.status === "enabled")
      .map((access) => access.moduleId),
  );
  const availableModules = orderedHubModules.filter(
    (hubModule) =>
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
  const taskCount = 0;
  const unreadNotificationsCount = snapshot?.notifications.unreadCount ?? 0;
  const peopleCount = teamMembers.length;
  const messagesTodayCount = snapshot?.pulsex.messagesTodayCount ?? 0;

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

        <section className="grid grid-cols-6 gap-3">
          <PulseMetric icon={<CalendarCheck2 size={18} />} label="reunioes" value={meetingCount} />
          <PulseMetric icon={<ListChecks size={18} />} label="tasks" value={taskCount} />
          <PulseMetric icon={<MessageSquareText size={18} />} label="mensagens hoje" value={messagesTodayCount} />
          <PulseMetric icon={<Bell size={18} />} label="notificacoes" value={unreadNotificationsCount} />
          <PulseMetric icon={<Users size={18} />} label="usuarios ativos" value={peopleCount} />
          <PulseMetric icon={<TimerReset size={18} />} label="modulos ativos" value={availableModules.length} />
        </section>

        <section className="grid grid-cols-[minmax(0,1fr)_minmax(22rem,0.78fr)] gap-5">
          <Surface bordered className="border-[#d9e0e7] bg-white p-5 shadow-[0_14px_34px_rgb(16_24_32_/_0.07)]">
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

          <Surface bordered className="border-[#d9e0e7] bg-white p-5 shadow-[0_18px_42px_rgb(16_24_32_/_0.08)]">
            <PanelTitle
              eyebrow="Rotina"
              title="Agenda e tarefas"
            />
            <div className="mt-4 grid grid-cols-3 gap-3">
              <DayMetric label="reunioes agora" value={meetingCount} />
              <DayMetric label="tasks do dia" value={taskCount} note="em breve" />
              <DayMetric label="mensagens PulseX" value={messagesTodayCount} />
            </div>
            <div className="mt-4 rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-4">
              <p className="m-0 text-sm font-semibold text-[#101820]">
                Task ainda nao implantado
              </p>
              <p className="m-0 mt-2 text-xs leading-5 text-[#667085]">
                Quando o modulo Task entrar, este painel passa a mostrar
                vencidas, pendentes, concluidas e responsaveis com dados reais.
              </p>
            </div>
          </Surface>
        </section>

        <section className="grid grid-cols-[minmax(0,0.82fr)_minmax(0,1fr)] gap-5">
          <PresenceTodayPanel />
          <Surface bordered className="border-[#d9e0e7] bg-white p-5 shadow-[0_12px_30px_rgb(16_24_32_/_0.06)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <PanelTitle
                eyebrow="Produto"
                title="Novidades do Hub"
              />
              <Badge variant="info">registro Codex</Badge>
            </div>
            <div className="mt-4 grid gap-3">
              {hubImprovements.map((improvement) => (
                <ImprovementCard
                  improvement={improvement}
                  key={improvement.id}
                />
              ))}
            </div>
          </Surface>
        </section>
      </WorkspaceLayout>
    </HubShell>
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

function ImprovementCard({ improvement }: { improvement: HubImprovement }) {
  return (
    <details className="group rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3 open:border-[#A07C3B]/45 open:bg-[#fffaf0]">
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3 outline-none">
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-[#17202f]">
            {improvement.title}
          </p>
          <p className="m-0 mt-1 text-xs text-[#667085]">
            {improvement.date} / {improvement.moduleId ?? "hub"}
          </p>
        </div>
        <Badge variant={improvementTypeVariant[improvement.type]}>
          {improvement.type}
        </Badge>
        <ArrowRight
          aria-hidden="true"
          className="mt-1 text-[#667085] transition group-open:rotate-90"
          size={15}
        />
      </summary>
      <div className="mt-3 border-t border-[#eadfc8] pt-3">
        <p className="m-0 text-xs leading-5 text-[#485466]">
          {improvement.description}
        </p>
        <div className="mt-3 grid gap-2 text-xs text-[#667085]">
          <span>Impacto: mais clareza para a operacao diaria.</span>
          <span>Origem: ajuste registrado no ciclo de evolucao do Hub.</span>
        </div>
      </div>
    </details>
  );
}

function PresenceTodayPanel() {
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
    <Surface bordered className="border-[#d9e0e7] bg-white p-5">
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
