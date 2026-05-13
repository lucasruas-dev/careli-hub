"use client";

import {
  departmentModuleAccess,
  hubImprovements,
  operationalActivities,
  operationalTeam,
  type HubImprovementType,
  type OperationStatus,
  type OperationalActivityStatus,
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
  CheckCircle2,
  Clock3,
  MessageSquareText,
  Radio,
  UserCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const operationStatusLabel = {
  away: "ausente",
  lunch: "almoco",
  meeting: "em reuniao",
  offline: "offline",
  online: "online",
} as const satisfies Record<OperationStatus, string>;

const operationStatusStyle = {
  away: "border-amber-200 bg-amber-50 text-amber-700",
  lunch: "border-[#eadcbc] bg-[#fbf7ef] text-[#8A682F]",
  meeting: "border-sky-200 bg-sky-50 text-sky-700",
  offline: "border-zinc-200 bg-zinc-50 text-zinc-500",
  online: "border-emerald-200 bg-emerald-50 text-emerald-700",
} as const satisfies Record<OperationStatus, string>;

const activityStatusLabel = {
  done: "concluidas",
  overdue: "vencidas",
  pending: "pendentes",
  tracking: "em acompanhamento",
} as const satisfies Record<OperationalActivityStatus, string>;

const activityStatusVariant = {
  done: "success",
  overdue: "warning",
  pending: "neutral",
  tracking: "info",
} as const satisfies Record<OperationalActivityStatus, BadgeVariant>;

const improvementTypeVariant = {
  "ajuste visual": "warning",
  correcao: "neutral",
  melhoria: "success",
  "novo recurso": "info",
} as const satisfies Record<HubImprovementType, BadgeVariant>;

export default function HomePage() {
  const { hubUser } = useAuth();
  const displayName = getFirstName(hubUser?.name ?? "Operacao");
  const availableModules = orderedHubModules.filter(
    (hubModule) =>
      isHubModuleActive(hubModule) &&
      Boolean(hubUser && canAccessModule(hubUser, hubModule)) &&
      departmentModuleAccess.some(
        (access) =>
          access.moduleId === hubModule.id && access.status === "enabled",
      ),
  );
  const onlineCount = countTeamStatus("online");
  const awayCount = countTeamStatus("away") + countTeamStatus("lunch");
  const meetingCount = countTeamStatus("meeting");
  const overdueCount = countActivities("overdue");
  const pendingMentions = 3;

  return (
    <HubShell>
      <WorkspaceLayout
        aside={<HomeAside activeModulesCount={availableModules.length} />}
        className="careli-home"
        header={
          <WorkspaceHeader title={`${getGreeting()}, ${displayName}.`} />
        }
      >
        <section className="grid grid-cols-6 gap-3">
          <PulseMetric icon={<Users size={18} />} label="online" value={onlineCount} />
          <PulseMetric icon={<Clock3 size={18} />} label="ausentes" value={awayCount} />
          <PulseMetric icon={<UserCheck size={18} />} label="em reuniao" value={meetingCount} />
          <PulseMetric icon={<Bell size={18} />} label="vencidas" value={overdueCount} />
          <PulseMetric icon={<MessageSquareText size={18} />} label="mencoes" value={pendingMentions} />
          <PulseMetric icon={<Radio size={18} />} label="modulos" value={availableModules.length} />
        </section>

        <section className="grid grid-cols-[minmax(0,1fr)_minmax(22rem,0.78fr)] gap-5">
          <Surface bordered className="border-[#d9e0e7] bg-white p-5 shadow-[0_14px_34px_rgb(16_24_32_/_0.07)]">
            <PanelTitle
              eyebrow="Mapa Operacional"
              title="Status da Operacao"
            />
            <div className="mt-4 grid grid-cols-2 gap-3">
              {operationalTeam.map((member) => (
                <article
                  className="grid min-h-20 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3"
                  key={member.id}
                >
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[#101820] text-xs font-semibold text-white">
                    {member.initials}
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold text-[#17202f]">
                      {member.name}
                    </p>
                    <p className="m-0 mt-1 truncate text-xs text-[#667085]">
                      {member.roleLabel} / {member.lastSignal}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-1 text-xs font-semibold ${operationStatusStyle[member.status]}`}
                  >
                    {operationStatusLabel[member.status]}
                  </span>
                </article>
              ))}
            </div>
          </Surface>

          <Surface bordered className="border-[#d9e0e7] bg-[#101820] p-5 text-white shadow-[0_18px_42px_rgb(16_24_32_/_0.12)]">
            <PanelTitle
              dark
              eyebrow="Rotina"
              title="Atividades do dia"
            />
            <div className="mt-4 grid grid-cols-2 gap-3">
              {(["overdue", "pending", "tracking", "done"] as const).map(
                (status) => (
                  <div
                    className="rounded-md border border-white/10 bg-white/[0.055] p-3"
                    key={status}
                  >
                    <p className="m-0 text-2xl font-semibold">
                      {countActivities(status)}
                    </p>
                    <p className="m-0 mt-1 text-xs text-white/58">
                      {activityStatusLabel[status]}
                    </p>
                  </div>
                ),
              )}
            </div>
            <div className="mt-4 grid gap-2">
              {operationalActivities.slice(0, 4).map((activity) => (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border border-white/10 bg-black/15 px-3 py-2.5"
                  key={activity.id}
                >
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold">
                      {activity.title}
                    </p>
                    <p className="m-0 mt-1 text-xs text-white/55">
                      {activity.due}
                    </p>
                  </div>
                  <Badge variant={activityStatusVariant[activity.status]}>
                    {activityStatusLabel[activity.status]}
                  </Badge>
                </div>
              ))}
            </div>
          </Surface>
        </section>

        <section className="grid grid-cols-[minmax(0,0.78fr)_minmax(0,1fr)] gap-5">
          <Surface bordered className="border-[#d9e0e7] bg-white p-5 shadow-[0_12px_30px_rgb(16_24_32_/_0.06)]">
            <PanelTitle
              eyebrow="Modulos"
              title="Acesso rapido"
            />
            <div className="mt-4 grid gap-3">
              {availableModules.map((hubModule) => (
                <Link
                  className="grid min-h-20 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-[#e2e7ee] bg-[#fafbfc] p-4 text-[#101820] no-underline outline-none transition hover:border-[#A07C3B]/45 hover:bg-[#fbf7ef] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                  href={hubModule.basePath}
                  key={hubModule.id}
                >
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-[#101820] text-[#d0ad69]">
                    <MessageSquareText aria-hidden="true" size={18} />
                  </span>
                  <div>
                    <p className="m-0 text-sm font-semibold">
                      {hubModule.name}
                    </p>
                    <p className="m-0 mt-1 text-xs text-[#667085]">
                      ativo para departamentos liberados
                    </p>
                  </div>
                  <ArrowRight aria-hidden="true" size={16} />
                </Link>
              ))}
            </div>
          </Surface>

          <Surface bordered className="border-[#d9e0e7] bg-white p-5 shadow-[0_12px_30px_rgb(16_24_32_/_0.06)]">
            <PanelTitle
              eyebrow="Produto"
              title="Novidades do Hub"
            />
            <div className="mt-4 grid gap-3">
              {hubImprovements.map((improvement) => (
                <article
                  className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3"
                  key={improvement.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="m-0 text-sm font-semibold text-[#17202f]">
                        {improvement.title}
                      </p>
                      <p className="m-0 mt-1 text-xs text-[#667085]">
                        {improvement.date} / {improvement.moduleId ?? "hub"}
                      </p>
                    </div>
                    <Badge variant={improvementTypeVariant[improvement.type]}>
                      {improvement.type}
                    </Badge>
                  </div>
                  <p className="m-0 mt-2 text-xs leading-5 text-[#667085]">
                    {improvement.description}
                  </p>
                </article>
              ))}
            </div>
          </Surface>
        </section>
      </WorkspaceLayout>
    </HubShell>
  );
}

function HomeAside({ activeModulesCount }: { activeModulesCount: number }) {
  return (
    <div className="grid gap-5">
      <Surface bordered className="border-[#222936] bg-[#101820] p-5 text-white shadow-[0_18px_42px_rgb(16_24_32_/_0.16)]">
        <PanelTitle
          dark
          eyebrow="Perfil"
          title="Administrador"
        />
        <div className="mt-4 grid gap-3">
          <MiniMetric label="Escopo" value="Global" />
          <MiniMetric label="Perfil" value="adm" />
          <MiniMetric label="Modulos ativos" value={String(activeModulesCount)} />
        </div>
      </Surface>

      <Surface bordered className="border-[#d9e0e7] bg-white p-5">
        <div className="flex items-center gap-2">
          <CheckCircle2 aria-hidden="true" className="text-emerald-600" size={18} />
          <p className="m-0 text-sm font-semibold text-[#101820]">
            Regras preparadas
          </p>
        </div>
        <div className="mt-4 grid gap-3">
          {[
            "operador: propria rotina",
            "lider: setor",
            "coordenador: departamento",
            "administrador: tudo",
          ].map((item) => (
            <div
              className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 text-sm text-[#485466]"
              key={item}
            >
              <span className="h-2 w-2 rounded-full bg-[#A07C3B]" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </Surface>
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

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.055] px-3 py-2.5">
      <span className="text-xs text-white/58">{label}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

function countTeamStatus(status: OperationStatus): number {
  return operationalTeam.filter((member) => member.status === status).length;
}

function countActivities(status: OperationalActivityStatus): number {
  return operationalActivities.filter((activity) => activity.status === status)
    .length;
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
