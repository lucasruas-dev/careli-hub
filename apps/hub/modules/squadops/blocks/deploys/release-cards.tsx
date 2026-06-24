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
    <section className="grid gap-3 border-b border-slate-100 pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[#7A5E2C]">
            {group.agent}
          </p>
          <h3 className="m-0 mt-1 text-base font-semibold text-slate-950">
            {group.module}
          </h3>
          <p className="m-0 mt-1 text-xs leading-5 text-slate-500">
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
    <article className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            className="flex min-w-0 flex-wrap items-center gap-2 text-left"
            onClick={() => onSelectRecord(releaseProtocol.record)}
            type="button"
          >
            <span className="font-mono text-xs font-semibold text-[#7A5E2C]">
              {releaseProtocol.protocol}
            </span>
            <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[0.68rem] font-semibold uppercase text-slate-500 ring-1 ring-slate-200/70">
              Pacote do modulo
            </span>
          </button>
          <h3 className="m-0 mt-2 line-clamp-2 text-sm font-semibold text-slate-950">
            {releaseProtocol.title}
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Tooltip
              content={`Abrir ${releaseProtocol.protocol}`}
              placement="top"
            >
              <button
                className="rounded-full bg-white px-2 py-1 font-mono text-[0.68rem] font-semibold text-slate-600 ring-1 ring-slate-200/70 transition hover:bg-[#F7F2EA] hover:text-[#7A5E2C] hover:ring-[#D8C7A8] focus-visible:bg-[#F7F2EA] focus-visible:text-[#7A5E2C] focus-visible:ring-[#D8C7A8]"
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
                    className="rounded-full bg-white px-2 py-1 font-mono text-[0.68rem] font-semibold text-slate-600 ring-1 ring-slate-200/70 transition hover:bg-[#F7F2EA] hover:text-[#7A5E2C] hover:ring-[#D8C7A8] focus-visible:bg-[#F7F2EA] focus-visible:text-[#7A5E2C] focus-visible:ring-[#D8C7A8] disabled:cursor-default disabled:opacity-70"
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
          <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
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

      <p className="m-0 mt-3 line-clamp-3 text-xs leading-5 text-slate-600">
        {releaseProtocol.summary}
      </p>

      <div className="mt-3 grid gap-3 rounded-lg bg-slate-50/80 p-3 ring-1 ring-slate-200/70">
        <div>
          <p className="m-0 text-[0.68rem] font-semibold uppercase text-slate-400">
            Vinculo operacional
          </p>
          <p className="m-0 mt-1 text-xs leading-5 text-slate-600">
            Este pacote agrupa protocolos do modulo para homologacao; clique em
            cada protocolo para abrir o detalhe operacional.
          </p>
        </div>

        <div className="grid gap-2 text-xs leading-5 text-slate-600">
          <ReleaseMetaLine label="Commit" value={releaseProtocol.commit} />
          <ReleaseMetaLine label="Deploy" value={releaseProtocol.deployment} />
          <ReleaseMetaLine
            label="Healthcheck"
            value={releaseProtocol.healthchecks}
          />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="m-0 text-[0.68rem] font-semibold uppercase text-slate-400">
            Formato de commit
          </p>
          <pre className="m-0 mt-2 whitespace-pre-wrap break-words font-mono text-[0.68rem] leading-5 text-slate-600">
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
              ? "border-emerald-100 bg-emerald-50 text-emerald-700"
              : step.isActive
                ? "border-[#A07C3B]/25 bg-[#A07C3B]/10 text-[#7A5E2C]"
                : "border-slate-200 bg-white text-slate-500"
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
      <span className="font-semibold text-slate-500">{label}: </span>
      {value && value !== UNKNOWN_OPERATION_VALUE ? value : "nao informado"}
    </p>
  );
}
