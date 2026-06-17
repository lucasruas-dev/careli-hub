"use client";

import {
  UNKNOWN_OPERATION_VALUE,
  type EngineeringAuditRoutine,
} from "@/lib/squadops/engineering-operations-parser";
import {
  DetailBlock,
  DetailField,
  EmptyState,
  PanelTitle,
} from "@/modules/squadops/blocks/shared/operations-ui";
import { Badge, Surface, type BadgeVariant } from "@repo/uix";
import { ClipboardCheck, X } from "lucide-react";

type StatusVariantResolver = (status: string) => BadgeVariant;

type AuditRoutinesPanelProps = {
  formatDateTime: (value: string) => string;
  getStatusVariant: StatusVariantResolver;
  onSelectRoutine: (routine: EngineeringAuditRoutine) => void;
  routines: EngineeringAuditRoutine[];
};

type AuditSummaryPillProps = {
  label: string;
  value: number | string;
};

type AuditRoutineGroupProps = {
  formatDateTime: (value: string) => string;
  getStatusVariant: StatusVariantResolver;
  onSelectRoutine: (routine: EngineeringAuditRoutine) => void;
  routines: EngineeringAuditRoutine[];
  title: string;
};

type AuditRoutineCardProps = {
  formatDateTime: (value: string) => string;
  getStatusVariant: StatusVariantResolver;
  onSelect: () => void;
  routine: EngineeringAuditRoutine;
};

type AuditRoutineDetailDrawerProps = {
  formatDateTime: (value: string) => string;
  getStatusVariant: StatusVariantResolver;
  onClose: () => void;
  routine: EngineeringAuditRoutine | null;
};

export function AuditRoutinesPanel({
  formatDateTime,
  getStatusVariant,
  onSelectRoutine,
  routines,
}: AuditRoutinesPanelProps) {
  const overdueRoutines = routines.filter((routine) => routine.isOverdue);
  const stableRoutines = routines.filter((routine) => !routine.isOverdue);
  const latestExecution =
    routines.find(
      (routine) => routine.lastExecution !== UNKNOWN_OPERATION_VALUE,
    )?.lastExecution ?? UNKNOWN_OPERATION_VALUE;
  const latestExecutionFormatted = formatDateTime(latestExecution);

  return (
    <Surface
      bordered
      className="min-w-0 overflow-hidden border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PanelTitle
          eyebrow={`${routines.length} rotinas`}
          icon={<ClipboardCheck size={18} />}
          title="Auditorias operacionais"
        />
        <Badge variant={overdueRoutines.length > 0 ? "warning" : "success"}>
          {overdueRoutines.length > 0
            ? `${overdueRoutines.length} vencidas`
            : "rotinas em dia"}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <AuditSummaryPill label="vencidas" value={overdueRoutines.length} />
        <AuditSummaryPill
          label="em acompanhamento"
          value={stableRoutines.length}
        />
        <AuditSummaryPill
          label="última execução"
          value={latestExecutionFormatted}
        />
      </div>

      <div className="mt-5 grid max-h-[62vh] gap-5 overflow-y-auto overscroll-contain pr-1">
        {overdueRoutines.length > 0 ? (
          <AuditRoutineGroup
            formatDateTime={formatDateTime}
            getStatusVariant={getStatusVariant}
            onSelectRoutine={onSelectRoutine}
            routines={overdueRoutines}
            title="Precisa de atenção"
          />
        ) : null}
        <AuditRoutineGroup
          formatDateTime={formatDateTime}
          getStatusVariant={getStatusVariant}
          onSelectRoutine={onSelectRoutine}
          routines={stableRoutines}
          title="Em acompanhamento"
        />
      </div>
    </Surface>
  );
}

function AuditSummaryPill({ label, value }: AuditSummaryPillProps) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
      <p className="m-0 text-xs font-semibold uppercase text-slate-400">
        {label}
      </p>
      <p className="m-0 mt-1 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function AuditRoutineGroup({
  formatDateTime,
  getStatusVariant,
  onSelectRoutine,
  routines,
  title,
}: AuditRoutineGroupProps) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="m-0 text-sm font-semibold text-slate-950">{title}</h3>
        <span className="text-xs font-semibold text-slate-400">
          {routines.length} rotinas
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {routines.length > 0 ? (
          routines.map((routine) => (
            <AuditRoutineCard
              formatDateTime={formatDateTime}
              getStatusVariant={getStatusVariant}
              key={routine.id}
              onSelect={() => onSelectRoutine(routine)}
              routine={routine}
            />
          ))
        ) : (
          <EmptyState message="Nenhuma rotina nesta categoria." />
        )}
      </div>
    </section>
  );
}

function AuditRoutineCard({
  formatDateTime,
  getStatusVariant,
  onSelect,
  routine,
}: AuditRoutineCardProps) {
  return (
    <button
      className="rounded-xl border border-slate-200/70 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-slate-950">
            {routine.name}
          </p>
          <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
            {routine.frequency} / {routine.responsible}
          </p>
        </div>
        <Badge
          variant={
            routine.isOverdue ? "warning" : getStatusVariant(routine.lastStatus)
          }
        >
          {routine.isOverdue ? "vencida" : routine.lastStatus}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
        <span className="rounded-full bg-slate-50 px-2.5 py-1 ring-1 ring-slate-200/70">
          Última: {formatDateTime(routine.lastExecution)}
        </span>
        <span className="rounded-full bg-slate-50 px-2.5 py-1 ring-1 ring-slate-200/70">
          Histórico: {routine.history.length}
        </span>
      </div>
      <p className="m-0 mt-3 line-clamp-2 text-xs leading-5 text-slate-600">
        {routine.consolidatedResult}
      </p>
      <p className="m-0 mt-3 line-clamp-2 rounded-lg bg-slate-50/70 p-3 text-xs leading-5 text-slate-600 ring-1 ring-slate-200/70">
        {routine.script}
      </p>
    </button>
  );
}

export function AuditRoutineDetailDrawer({
  formatDateTime,
  getStatusVariant,
  onClose,
  routine,
}: AuditRoutineDetailDrawerProps) {
  if (!routine) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/20 backdrop-blur-[1px]">
      <button
        aria-label="Fechar rotina de auditoria"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <PanelTitle
            eyebrow={routine.frequency}
            icon={<ClipboardCheck size={18} />}
            title={routine.name}
          />
          <button
            className="grid size-9 place-items-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-950"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                routine.isOverdue
                  ? "warning"
                  : getStatusVariant(routine.lastStatus)
              }
            >
              {routine.isOverdue ? "vencida" : routine.lastStatus}
            </Badge>
            <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/70">
              {routine.responsible}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <DetailField label="Responsavel" value={routine.responsible} />
            <DetailField
              label="Ultima execucao"
              value={formatDateTime(routine.lastExecution)}
            />
            <DetailField label="Frequencia" value={routine.frequency} />
            <DetailField
              label="Historico"
              value={`${routine.history.length} registros`}
            />
          </div>

          <div className="mt-5 grid gap-3">
            <DetailBlock
              label="Resultado consolidado"
              value={routine.consolidatedResult}
            />
            <DetailBlock label="Script operacional" value={routine.script} />
          </div>

          <div className="mt-5 rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
            <p className="m-0 text-xs font-semibold uppercase text-slate-400">
              Historico relacionado
            </p>
            <div className="mt-3 grid gap-3">
              {routine.history.length > 0 ? (
                routine.history.map((record) => (
                  <article
                    className="rounded-lg border border-slate-200/70 bg-white p-3"
                    key={record.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-semibold text-slate-950">
                          {record.subject}
                        </p>
                        <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
                          {record.module} / {formatDateTime(record.localDateTime)}
                        </p>
                      </div>
                      <Badge variant={getStatusVariant(record.status)}>
                        {record.status}
                      </Badge>
                    </div>
                    <pre className="m-0 mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">
                      {record.rawContent}
                    </pre>
                  </article>
                ))
              ) : (
                <EmptyState message="Sem registro historico relacionado." />
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
