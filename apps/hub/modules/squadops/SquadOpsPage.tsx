"use client";

import { HubShell } from "@/layouts/hub-shell";
import {
  squadOpsDemands,
  squadOpsEnvironmentLabels,
  squadOpsSquads,
  squadOpsStatusLabels,
  squadOpsStatusOrder,
  squadOpsSupabaseModel,
  type SquadOpsDemand,
  type SquadOpsDemandStatus,
  type SquadOpsEnvironmentStatus,
} from "@/lib/squadops/mock-data";
import { Badge, Surface, WorkspaceHeader, WorkspaceLayout } from "@repo/uix";
import type { BadgeVariant } from "@repo/uix";
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  GitCommitHorizontal,
  GitPullRequestArrow,
  KanbanSquare,
  Rocket,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

const statusBadgeVariant = {
  intake: "neutral",
  implementing: "info",
  validating: "warning",
  "waiting-architect": "warning",
  "waiting-qa": "info",
  "waiting-deploy": "success",
} as const satisfies Record<SquadOpsDemandStatus, BadgeVariant>;

const priorityStyle = {
  alta: "border-amber-200 bg-amber-50 text-amber-800",
  critica: "border-red-200 bg-red-50 text-red-700",
  media: "border-sky-200 bg-sky-50 text-sky-700",
} as const satisfies Record<SquadOpsDemand["priority"], string>;

const environmentStyle = {
  blocked: "border-zinc-200 bg-zinc-50 text-zinc-500",
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  stable: "border-emerald-200 bg-emerald-50 text-emerald-700",
  watching: "border-sky-200 bg-sky-50 text-sky-700",
} as const satisfies Record<SquadOpsEnvironmentStatus, string>;

const environmentLabel = {
  blocked: "bloqueado",
  pending: "pendente",
  stable: "estavel",
  watching: "monitorando",
} as const satisfies Record<SquadOpsEnvironmentStatus, string>;

export function SquadOpsPage() {
  const [selectedDemandId, setSelectedDemandId] = useState<string>(
    squadOpsDemands[0].id,
  );
  const selectedDemand = useMemo(
    () =>
      squadOpsDemands.find((demand) => demand.id === selectedDemandId) ??
      squadOpsDemands[0],
    [selectedDemandId],
  );
  const activeSquad =
    squadOpsSquads.find((squad) => squad.id === selectedDemand.squadId) ??
    squadOpsSquads[0];
  const pendingQaCount = squadOpsDemands.filter((demand) =>
    demand.qa.some((record) => record.result === "pendente"),
  ).length;
  const pendingCommitCount = squadOpsDemands.reduce(
    (count, demand) =>
      count +
      demand.commits.filter((commit) => commit.status === "aguardando push")
        .length,
    0,
  );

  return (
    <HubShell layoutMode="module">
      <WorkspaceLayout
        header={
          <WorkspaceHeader
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="warning">AGUARDANDO ARCHITECT</Badge>
                <Badge variant="info">AGUARDANDO QA</Badge>
              </div>
            }
            description="Demandas, squads, handoffs, commits, QA, deploys e protocolos da engenharia IA do Hub."
            eyebrow="SquadOps Core"
            title="SquadOps"
          />
        }
      >
        <section className="grid grid-cols-4 gap-3">
          <MetricTile
            icon={<KanbanSquare size={18} />}
            label="demandas abertas"
            value={squadOpsDemands.length}
          />
          <MetricTile
            icon={<UserRoundCheck size={18} />}
            label="squads ativas"
            value={squadOpsSquads.filter((squad) => squad.status === "ativa").length}
          />
          <MetricTile
            icon={<ClipboardCheck size={18} />}
            label="QA pendente"
            value={pendingQaCount}
          />
          <MetricTile
            icon={<GitCommitHorizontal size={18} />}
            label="commits em handoff"
            value={pendingCommitCount}
          />
        </section>

        <section className="grid grid-cols-[minmax(0,1fr)_minmax(21rem,0.42fr)] gap-5">
          <Surface bordered className="border-[#d9e0e7] bg-white p-5 shadow-[0_14px_34px_rgb(16_24_32_/_0.07)]">
            <PanelTitle
              icon={<KanbanSquare size={18} />}
              eyebrow="Board"
              title="Demandas por status"
            />
            <div className="mt-4 grid grid-cols-3 gap-3 xl:grid-cols-6">
              {squadOpsStatusOrder.map((status) => {
                const demands = squadOpsDemands.filter(
                  (demand) => demand.status === status,
                );

                return (
                  <div
                    className="min-h-64 rounded-md border border-[#e5e9ef] bg-[#f8fafc] p-3"
                    key={status}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="m-0 text-xs font-semibold text-[#101820]">
                        {squadOpsStatusLabels[status]}
                      </p>
                      <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white px-2 text-xs font-semibold text-[#526078]">
                        {demands.length}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {demands.map((demand) => (
                        <button
                          className={`rounded-md border bg-white p-3 text-left shadow-sm outline-none transition hover:border-[#A07C3B] hover:shadow-md focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
                            selectedDemand.id === demand.id
                              ? "border-[#A07C3B]"
                              : "border-[#edf0f4]"
                          }`}
                          key={demand.id}
                          onClick={() => setSelectedDemandId(demand.id)}
                          type="button"
                        >
                          <span className="text-[0.6875rem] font-semibold text-[#667085]">
                            {demand.protocol}
                          </span>
                          <span className="mt-1 block text-sm font-semibold leading-5 text-[#101820]">
                            {demand.title}
                          </span>
                          <span
                            className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[0.6875rem] font-semibold ${priorityStyle[demand.priority]}`}
                          >
                            {demand.priority}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Surface>

          <Surface bordered className="border-[#d9e0e7] bg-white p-5 shadow-[0_18px_42px_rgb(16_24_32_/_0.08)]">
            <PanelTitle
              icon={<ShieldCheck size={18} />}
              eyebrow={selectedDemand.protocol}
              title="Detalhe da demanda"
            />
            <div className="mt-4 grid gap-4">
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="m-0 text-lg font-semibold text-[#101820]">
                      {selectedDemand.title}
                    </p>
                    <p className="m-0 mt-1 text-sm leading-5 text-[#526078]">
                      {selectedDemand.summary}
                    </p>
                  </div>
                  <Badge variant={statusBadgeVariant[selectedDemand.status]}>
                    {squadOpsStatusLabels[selectedDemand.status]}
                  </Badge>
                </div>
              </div>
              <DetailGrid demand={selectedDemand} squadName={activeSquad.name} />
              <NextAgentCard demand={selectedDemand} />
            </div>
          </Surface>
        </section>

        <section className="grid grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] gap-5">
          <Surface bordered className="border-[#d9e0e7] bg-white p-5 shadow-[0_12px_30px_rgb(16_24_32_/_0.06)]">
            <PanelTitle
              icon={<Boxes size={18} />}
              eyebrow="Squads"
              title="Cadastro operacional"
            />
            <div className="mt-4 grid gap-3">
              {squadOpsSquads.map((squad) => (
                <article
                  className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-4"
                  key={squad.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="m-0 text-sm font-semibold text-[#101820]">
                        {squad.name}
                      </p>
                      <p className="m-0 mt-1 text-xs leading-5 text-[#667085]">
                        {squad.focus}
                      </p>
                    </div>
                    <span className="rounded-full border border-[#d9e0e7] bg-white px-2 py-1 text-xs font-semibold text-[#526078]">
                      {squad.status}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-xs text-[#526078]">
                    <span className="truncate">Lead: {squad.lead}</span>
                    <span>{squad.nextProtocol}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {squad.members.map((member) => (
                      <span
                        className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-[#17202f]"
                        key={member}
                      >
                        {member}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </Surface>

          <Surface bordered className="border-[#d9e0e7] bg-white p-5 shadow-[0_12px_30px_rgb(16_24_32_/_0.06)]">
            <PanelTitle
              icon={<GitPullRequestArrow size={18} />}
              eyebrow="Timeline"
              title="Operacao e handoffs"
            />
            <div className="mt-4 grid gap-3">
              {selectedDemand.timeline.map((event) => (
                <article
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3"
                  key={event.id}
                >
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#A07C3B]" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="m-0 text-sm font-semibold text-[#101820]">
                        {event.title}
                      </p>
                      <Badge variant={statusBadgeVariant[event.status]}>
                        {squadOpsStatusLabels[event.status]}
                      </Badge>
                    </div>
                    <p className="m-0 mt-1 text-xs leading-5 text-[#667085]">
                      {event.detail}
                    </p>
                    <p className="m-0 mt-2 text-xs font-semibold text-[#526078]">
                      {event.actor}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[#667085]">
                    {event.timestamp}
                  </span>
                </article>
              ))}
            </div>
          </Surface>
        </section>

        <section className="grid grid-cols-[minmax(0,0.68fr)_minmax(0,1fr)] gap-5">
          <Surface bordered className="border-[#d9e0e7] bg-white p-5 shadow-[0_12px_30px_rgb(16_24_32_/_0.06)]">
            <PanelTitle
              icon={<Rocket size={18} />}
              eyebrow="Ambientes"
              title="Status operacional"
            />
            <div className="mt-4 grid grid-cols-2 gap-3">
              {Object.entries(selectedDemand.environment).map(
                ([environment, status]) => (
                  <div
                    className={`rounded-md border p-3 ${environmentStyle[status]}`}
                    key={environment}
                  >
                    <p className="m-0 text-xs font-semibold">
                      {
                        squadOpsEnvironmentLabels[
                          environment as keyof typeof squadOpsEnvironmentLabels
                        ]
                      }
                    </p>
                    <p className="m-0 mt-2 text-lg font-semibold">
                      {environmentLabel[status]}
                    </p>
                  </div>
                ),
              )}
            </div>
            <div className="mt-4 grid gap-3">
              <RecordList
                icon={<GitCommitHorizontal size={16} />}
                title="Commits"
                empty="Sem commit registrado."
                items={selectedDemand.commits.map((commit) => ({
                  meta: `${commit.author} / ${commit.timestamp}`,
                  title: commit.message,
                  value: commit.hash,
                }))}
              />
              <RecordList
                icon={<ClipboardCheck size={16} />}
                title="QA"
                empty="Sem QA registrado."
                items={selectedDemand.qa.map((record) => ({
                  meta: `${record.owner} / ${record.timestamp}`,
                  title: record.scope,
                  value: record.result,
                }))}
              />
              <RecordList
                icon={<Rocket size={16} />}
                title="Deploy"
                empty="Sem deploy registrado."
                items={selectedDemand.deploys.map((deploy) => ({
                  meta: `${deploy.owner} / ${deploy.timestamp}`,
                  title: squadOpsEnvironmentLabels[deploy.environment],
                  value: deploy.status,
                }))}
              />
            </div>
          </Surface>

          <Surface bordered className="border-[#d9e0e7] bg-white p-5 shadow-[0_12px_30px_rgb(16_24_32_/_0.06)]">
            <PanelTitle
              icon={<Sparkles size={18} />}
              eyebrow="Supabase futuro"
              title="Modelagem recomendada"
            />
            <div className="mt-4 grid grid-cols-2 gap-3">
              {squadOpsSupabaseModel.map((table) => (
                <article
                  className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-4"
                  key={table.name}
                >
                  <p className="m-0 font-mono text-xs font-semibold text-[#A07C3B]">
                    {table.name}
                  </p>
                  <p className="m-0 mt-2 text-xs leading-5 text-[#667085]">
                    {table.description}
                  </p>
                </article>
              ))}
            </div>
            <div className="mt-4 rounded-md border border-[#d9e0e7] bg-[#101820] p-4 text-white">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 size={16} />
                <span>Protocolo automatico</span>
              </div>
              <p className="m-0 mt-2 font-mono text-sm text-[#f2d79b]">
                {selectedDemand.protocol}
              </p>
              <p className="m-0 mt-2 text-xs leading-5 text-[#d7dee8]">
                Padrao inicial: prefixo da squad, data local e sequencial do dia.
              </p>
            </div>
          </Surface>
        </section>
      </WorkspaceLayout>
    </HubShell>
  );
}

function MetricTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Surface bordered className="border-[#d9e0e7] bg-white p-4 shadow-[0_10px_28px_rgb(16_24_32_/_0.05)]">
      <div className="flex items-center justify-between gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-[#101820] text-[#f2d79b]">
          {icon}
        </span>
        <span className="text-2xl font-semibold text-[#101820]">{value}</span>
      </div>
      <p className="m-0 mt-3 text-xs font-semibold text-[#667085]">{label}</p>
    </Surface>
  );
}

function PanelTitle({
  eyebrow,
  icon,
  title,
}: {
  eyebrow: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 place-items-center rounded-md bg-[#f4efe6] text-[#A07C3B]">
        {icon}
      </span>
      <div>
        <p className="m-0 text-xs font-semibold text-[#667085]">{eyebrow}</p>
        <h2 className="m-0 mt-1 text-base font-semibold text-[#101820]">
          {title}
        </h2>
      </div>
    </div>
  );
}

function DetailGrid({
  demand,
  squadName,
}: {
  demand: SquadOpsDemand;
  squadName: string;
}) {
  const items = [
    ["Modulo", demand.module],
    ["Squad", squadName],
    ["Solicitante", demand.requester],
    ["Prazo", demand.dueAt],
    ["Architect", demand.architectOwner],
    ["Handoff", demand.handoff],
  ] as const;

  return (
    <dl className="m-0 grid grid-cols-2 gap-3">
      {items.map(([label, value]) => (
        <div
          className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3"
          key={label}
        >
          <dt className="text-xs font-semibold text-[#667085]">{label}</dt>
          <dd className="m-0 mt-1 text-sm font-semibold leading-5 text-[#17202f]">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function NextAgentCard({ demand }: { demand: SquadOpsDemand }) {
  return (
    <div className="rounded-md border border-[#d9e0e7] bg-[#101820] p-4 text-white">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <UserRoundCheck size={16} />
          <span>Proximo agente recomendado</span>
        </div>
        <ArrowRight size={16} />
      </div>
      <p className="m-0 mt-3 text-xl font-semibold text-[#f2d79b]">
        {demand.nextAgent}
      </p>
      <p className="m-0 mt-2 text-xs leading-5 text-[#d7dee8]">
        Motivo: demanda em {squadOpsStatusLabels[demand.status].toLowerCase()}.
      </p>
    </div>
  );
}

function RecordList({
  empty,
  icon,
  items,
  title,
}: {
  empty: string;
  icon: ReactNode;
  items: readonly { meta: string; title: string; value: string }[];
  title: string;
}) {
  return (
    <div className="rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#101820]">
        <span className="text-[#A07C3B]">{icon}</span>
        <span>{title}</span>
      </div>
      <div className="mt-3 grid gap-2">
        {items.length > 0 ? (
          items.map((item) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md bg-white p-3"
              key={`${item.title}-${item.value}`}
            >
              <div className="min-w-0">
                <p className="m-0 truncate text-xs font-semibold text-[#101820]">
                  {item.title}
                </p>
                <p className="m-0 mt-1 truncate text-xs text-[#667085]">
                  {item.meta}
                </p>
              </div>
              <span className="font-mono text-xs font-semibold text-[#526078]">
                {item.value}
              </span>
            </div>
          ))
        ) : (
          <p className="m-0 rounded-md bg-white p-3 text-xs text-[#667085]">
            {empty}
          </p>
        )}
      </div>
    </div>
  );
}
