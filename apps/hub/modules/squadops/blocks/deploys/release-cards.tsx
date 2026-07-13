"use client";

import type { EngineeringOperationRecord } from "@/lib/squadops/engineering-operations-parser";
import { UNKNOWN_OPERATION_VALUE } from "@/lib/squadops/engineering-operations-parser";
import {
  buildReleaseCommitTemplate,
  getReleaseProtocolEnvironmentLabel,
  getReleaseProtocolStatusLabel,
  type HubReleaseProtocol,
} from "@/lib/squadops/release-protocols";
import { Badge, Tooltip, type BadgeVariant } from "@repo/uix";

export type ReleaseModuleGroup = {
  activityCount: number;
  agent: string;
  latestAt: string;
  module: string;
  protocols: HubReleaseProtocol[];
};

type ReleaseModuleGroupSectionProps = {
  formatDateTime: (value: string) => string;
  formatModuleList: (releaseProtocol: HubReleaseProtocol) => string;
  getStatusVariant: (status: HubReleaseProtocol["status"]) => BadgeVariant;
  group: ReleaseModuleGroup;
  isInHomologation: (releaseProtocol: HubReleaseProtocol) => boolean;
  isReadyForProduction: (releaseProtocol: HubReleaseProtocol) => boolean;
  onSelectRecord: (record: EngineeringOperationRecord) => void;
};

type ReleaseProtocolCardProps = {
  formatDateTime: (value: string) => string;
  formatModuleList: (releaseProtocol: HubReleaseProtocol) => string;
  getStatusVariant: (status: HubReleaseProtocol["status"]) => BadgeVariant;
  onSelectRecord: (record: EngineeringOperationRecord) => void;
  releaseProtocol: HubReleaseProtocol;
};

export function ReleaseModuleGroupSection({
  formatDateTime,
  formatModuleList,
  getStatusVariant,
  group,
  isInHomologation,
  isReadyForProduction,
  onSelectRecord,
}: ReleaseModuleGroupSectionProps) {
  const readyForProduction = group.protocols.filter(isReadyForProduction).length;
  const homologationCount = group.protocols.filter(isInHomologation).length;

  return (
    <section className="grid gap-3 border-b border-line pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[#7a5e2c] dark:text-[#d9b877]">
            {group.agent}
          </p>
          <h3 className="m-0 mt-1 text-base font-semibold text-ink">
            {group.module}
          </h3>
          <p className="m-0 mt-1 text-xs leading-5 text-ink-muted">
            {group.protocols.length} pacote(s) / {group.activityCount} atividade(s)
            sinalizadas para rastreabilidade.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant={readyForProduction > 0 ? "success" : "info"}>
            {readyForProduction} pronto(s) producao
          </Badge>
          <Badge variant="warning">{homologationCount} em homologacao</Badge>
        </div>
      </div>

      <div className="grid gap-3">
        {group.protocols.map((releaseProtocol) => (
          <ReleaseProtocolCard
            formatDateTime={formatDateTime}
            formatModuleList={formatModuleList}
            getStatusVariant={getStatusVariant}
            key={`${group.module}-${releaseProtocol.protocol}`}
            onSelectRecord={onSelectRecord}
            releaseProtocol={releaseProtocol}
          />
        ))}
      </div>
    </section>
  );
}

function ReleaseProtocolCard({
  formatDateTime,
  formatModuleList,
  getStatusVariant,
  onSelectRecord,
  releaseProtocol,
}: ReleaseProtocolCardProps) {
  const commitTemplate = buildReleaseCommitTemplate(releaseProtocol);
  const protocolRecords = new Map(
    [releaseProtocol.record, ...releaseProtocol.records].map((record) => [
      record.protocol,
      record,
    ]),
  );

  return (
    <article className="rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            className="flex min-w-0 flex-wrap items-center gap-2 text-left"
            onClick={() => onSelectRecord(releaseProtocol.record)}
            type="button"
          >
            <span className="font-mono text-xs font-semibold text-[#7a5e2c] dark:text-[#d9b877]">
              {releaseProtocol.protocol}
            </span>
            <span className="rounded-full bg-subtle px-2 py-0.5 text-[0.68rem] font-semibold uppercase text-ink-muted ring-1 ring-line">
              Pacote do modulo
            </span>
          </button>
          <h3 className="m-0 mt-2 line-clamp-2 text-sm font-semibold text-ink">
            {releaseProtocol.title}
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Tooltip
              content={`Abrir ${releaseProtocol.protocol}`}
              placement="top"
            >
              <button
                className="rounded-full bg-surface px-2 py-1 font-mono text-[0.68rem] font-semibold text-ink-soft ring-1 ring-line transition hover:bg-[#f7f2ea] dark:bg-[#a07c3b]/10 hover:text-[#7a5e2c] dark:text-[#d9b877] hover:ring-[#D8C7A8] focus-visible:bg-[#f7f2ea] dark:bg-[#a07c3b]/10 focus-visible:text-[#7a5e2c] dark:text-[#d9b877] focus-visible:ring-[#D8C7A8]"
                onClick={() => onSelectRecord(releaseProtocol.record)}
                type="button"
              >
                {releaseProtocol.protocol}
              </button>
            </Tooltip>
            {releaseProtocol.includedProtocols.map((protocol) => {
              const protocolRecord = protocolRecords.get(protocol);
              const protocolTooltip = protocolRecord
                ? `Abrir ${protocol}`
                : "Registro nao encontrado neste pacote";

              return (
                <Tooltip
                  content={protocolTooltip}
                  key={`${releaseProtocol.protocol}-quick-${protocol}`}
                  placement="top"
                >
                  <button
                    className="rounded-full bg-surface px-2 py-1 font-mono text-[0.68rem] font-semibold text-ink-soft ring-1 ring-line transition hover:bg-[#f7f2ea] dark:bg-[#a07c3b]/10 hover:text-[#7a5e2c] dark:text-[#d9b877] hover:ring-[#D8C7A8] focus-visible:bg-[#f7f2ea] dark:bg-[#a07c3b]/10 focus-visible:text-[#7a5e2c] dark:text-[#d9b877] focus-visible:ring-[#D8C7A8] disabled:cursor-default disabled:opacity-70"
                    disabled={!protocolRecord}
                    onClick={() => {
                      if (protocolRecord) {
                        onSelectRecord(protocolRecord);
                      }
                    }}
                    type="button"
                  >
                    {protocol}
                  </button>
                </Tooltip>
              );
            })}
          </div>
          <p className="m-0 mt-1 text-xs font-semibold text-ink-muted">
            {formatModuleList(releaseProtocol)} /{" "}
            {formatDateTime(releaseProtocol.plannedAt)}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant={getStatusVariant(releaseProtocol.status)}>
            {getReleaseProtocolStatusLabel(releaseProtocol.status)}
          </Badge>
          <Badge variant="info">
            {getReleaseProtocolEnvironmentLabel(releaseProtocol.environment)}
          </Badge>
        </div>
      </div>

      <ReleaseProtocolPipeline releaseProtocol={releaseProtocol} />

      <p className="m-0 mt-3 line-clamp-3 text-xs leading-5 text-ink-soft">
        {releaseProtocol.summary}
      </p>

      <div className="mt-3 grid gap-3 rounded-lg bg-subtle p-3 ring-1 ring-line">
        <div>
          <p className="m-0 text-[0.68rem] font-semibold uppercase text-ink-muted">
            Vinculo operacional
          </p>
          <p className="m-0 mt-1 text-xs leading-5 text-ink-soft">
            Este pacote agrupa protocolos do modulo para homologacao; clique em
            cada protocolo para abrir o detalhe operacional.
          </p>
        </div>

        <div className="grid gap-2 text-xs leading-5 text-ink-soft">
          <ReleaseMetaLine label="Commit" value={releaseProtocol.commit} />
          <ReleaseMetaLine label="Deploy" value={releaseProtocol.deployment} />
          <ReleaseMetaLine
            label="Healthcheck"
            value={releaseProtocol.healthchecks}
          />
        </div>

        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="m-0 text-[0.68rem] font-semibold uppercase text-ink-muted">
            Formato de commit
          </p>
          <pre className="m-0 mt-2 whitespace-pre-wrap break-words font-mono text-[0.68rem] leading-5 text-ink-soft">
            {commitTemplate}
          </pre>
        </div>
      </div>
    </article>
  );
}

function ReleaseProtocolPipeline({
  releaseProtocol,
}: {
  releaseProtocol: HubReleaseProtocol;
}) {
  const steps = [
    {
      id: "homologacao",
      label: "Modulo homologa",
      isActive:
        releaseProtocol.environment === "homologacao" ||
        releaseProtocol.status === "em_homologacao" ||
        releaseProtocol.status === "homologado",
      isDone:
        releaseProtocol.status === "homologado" ||
        releaseProtocol.status === "aguardando_producao" ||
        releaseProtocol.status === "em_producao" ||
        releaseProtocol.status === "finalizado",
    },
    {
      id: "producao",
      label: "Hefesto produz",
      isActive:
        releaseProtocol.environment === "producao" ||
        releaseProtocol.status === "aguardando_producao" ||
        releaseProtocol.status === "em_producao",
      isDone:
        releaseProtocol.status === "em_producao" ||
        releaseProtocol.status === "finalizado",
    },
  ];

  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      {steps.map((step) => (
        <div
          className={`rounded-lg border px-3 py-2 ${
            step.isDone
              ? "border-emerald-100 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
              : step.isActive
                ? "border-[#A07C3B]/25 bg-[#A07C3B]/10 text-[#7a5e2c] dark:text-[#d9b877]"
                : "border-line bg-surface text-ink-muted"
          }`}
          key={step.id}
        >
          <p className="m-0 text-xs font-semibold">{step.label}</p>
          <p className="m-0 mt-1 text-[0.68rem] font-medium">
            {step.isDone ? "concluido" : step.isActive ? "em foco" : "pendente"}
          </p>
        </div>
      ))}
    </div>
  );
}

function ReleaseMetaLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="m-0">
      <span className="font-semibold text-ink-muted">{label}: </span>
      {value && value !== UNKNOWN_OPERATION_VALUE ? value : "nao informado"}
    </p>
  );
}
