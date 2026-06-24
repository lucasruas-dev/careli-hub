"use client";

import type { EngineeringOperationRecord } from "@/lib/squadops/engineering-operations-parser";
import {
  EmptyState,
  PanelTitle,
} from "@/modules/squadops/blocks/shared/operations-ui";
import { Badge, Surface, type BadgeVariant } from "@repo/uix";
import { History, Layers3 } from "lucide-react";

type StatusVariantResolver = (status: string) => BadgeVariant;
type RecordSummaryResolver = (record: EngineeringOperationRecord) => string;

type ProtocolRecordCardProps = {
  formatDateTime: (value: string) => string;
  getChangeSummary: RecordSummaryResolver;
  getReasonSummary: RecordSummaryResolver;
  getStatusVariant: StatusVariantResolver;
  onSelect: () => void;
  record: EngineeringOperationRecord;
};

type TimelinePanelProps = {
  emptyMessage: string;
  formatDateTime: (value: string) => string;
  getStatusVariant: StatusVariantResolver;
  limit: number;
  onSelectRecord: (record: EngineeringOperationRecord) => void;
  records: EngineeringOperationRecord[];
  title: string;
};

type RecordsTableProps = {
  formatDateTime: (value: string) => string;
  getStatusVariant: StatusVariantResolver;
  onSelectRecord: (record: EngineeringOperationRecord) => void;
  records: EngineeringOperationRecord[];
};

type TimelineItemProps = {
  formatDateTime: (value: string) => string;
  getStatusVariant: StatusVariantResolver;
  onSelect: () => void;
  record: EngineeringOperationRecord;
};

export function ProtocolRecordCard({
  formatDateTime,
  getChangeSummary,
  getReasonSummary,
  getStatusVariant,
  onSelect,
  record,
}: ProtocolRecordCardProps) {
  return (
    <button
      className="w-full rounded-lg border border-slate-200/70 bg-white p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:border-[#A07C3B]/25 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      onClick={onSelect}
      type="button"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold text-[#7A5E2C]">
            {record.protocol}
          </p>
          <p className="m-0 mt-1 line-clamp-2 text-sm font-semibold text-slate-950">
            {record.subject}
          </p>
          <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
            {record.screen} / {formatDateTime(record.localDateTime)}
          </p>
        </div>
        <Badge variant={getStatusVariant(record.status)}>{record.status}</Badge>
      </div>
      <div className="mt-3 grid gap-2 text-xs leading-5 text-slate-600">
        <p className="m-0">
          <span className="font-semibold text-slate-800">O que mudou: </span>
          {getChangeSummary(record)}
        </p>
        <p className="m-0">
          <span className="font-semibold text-slate-800">Por que: </span>
          {getReasonSummary(record)}
        </p>
      </div>
    </button>
  );
}

export function TimelinePanel({
  emptyMessage,
  formatDateTime,
  getStatusVariant,
  limit,
  onSelectRecord,
  records,
  title,
}: TimelinePanelProps) {
  return (
    <Surface
      bordered
      className="min-w-0 overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="border-b border-slate-100 p-5">
        <PanelTitle
          eyebrow={`${records.length} registros`}
          icon={<History size={18} />}
          title={title}
        />
      </div>
      <div className="grid max-h-[58vh] min-w-0 gap-3 overflow-y-auto overscroll-contain p-4 pr-3">
        {records.length > 0 ? (
          records.slice(0, limit).map((record) => (
            <TimelineItem
              formatDateTime={formatDateTime}
              getStatusVariant={getStatusVariant}
              key={record.id}
              onSelect={() => onSelectRecord(record)}
              record={record}
            />
          ))
        ) : (
          <EmptyState message={emptyMessage} />
        )}
      </div>
    </Surface>
  );
}

export function RecordsTable({
  formatDateTime,
  getStatusVariant,
  onSelectRecord,
  records,
}: RecordsTableProps) {
  return (
    <Surface
      bordered
      className="overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="border-b border-slate-100 p-5">
        <PanelTitle
          eyebrow={`${records.length} registros`}
          icon={<Layers3 size={18} />}
          title="Registros estruturados"
        />
      </div>
      <div className="max-h-[66vh] overflow-auto overscroll-contain">
        <table className="min-w-[62rem] w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-semibold uppercase text-slate-400 shadow-[0_1px_0_rgba(226,232,240,0.9)]">
            <tr>
              <th className="px-4 py-3">Protocolo</th>
              <th className="px-4 py-3">Assunto</th>
              <th className="px-4 py-3">Módulo</th>
              <th className="px-4 py-3">Squad</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Próxima squad</th>
              <th className="px-4 py-3">Pendências</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr
                className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-[#A07C3B]/5"
                key={record.id}
                onClick={() => onSelectRecord(record)}
              >
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="rounded-full bg-[#A07C3B]/10 px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                    {record.protocol}
                  </span>
                </td>
                <td className="max-w-64 px-4 py-3">
                  <p className="m-0 truncate font-semibold text-slate-950">
                    {record.subject}
                  </p>
                </td>
                <td className="px-4 py-3 text-slate-600">{record.module}</td>
                <td className="px-4 py-3 text-slate-600">{record.squad}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/70">
                    {record.type}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Badge variant={getStatusVariant(record.status)}>
                    {record.status}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {formatDateTime(record.localDateTime)}
                </td>
                <td className="max-w-52 px-4 py-3 text-slate-600">
                  <span className="line-clamp-2">{record.nextSquad}</span>
                </td>
                <td className="max-w-56 px-4 py-3 text-slate-600">
                  <span className="line-clamp-2">{record.risks}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {records.length === 0 ? (
        <div className="p-4">
          <EmptyState message="Nenhum registro encontrado para os filtros atuais." />
        </div>
      ) : null}
    </Surface>
  );
}

function TimelineItem({
  formatDateTime,
  getStatusVariant,
  onSelect,
  record,
}: TimelineItemProps) {
  return (
    <button
      className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-slate-200/70 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B] lg:grid-cols-[auto_minmax(0,1fr)_auto]"
      onClick={onSelect}
      type="button"
    >
      <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#A07C3B]" />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="shrink-0 rounded-full bg-[#A07C3B]/10 px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
            {record.protocol}
          </span>
          <p className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-[#101820]">
            {record.subject}
          </p>
          <Badge
            className="max-w-[9.5rem] shrink-0 truncate"
            variant={getStatusVariant(record.status)}
          >
            {record.status}
          </Badge>
          <span className="max-w-[12rem] truncate rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200/70">
            {record.type}
          </span>
        </div>
        <p className="m-0 mt-2 line-clamp-2 text-xs leading-5 text-[#667085]">
          {record.shortSummary}
        </p>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
          <span className="max-w-[11rem] truncate">{record.squad}</span>
          <span>/</span>
          <span className="max-w-[11rem] truncate">{record.module}</span>
          {record.isCritical ? (
            <>
              <span>/</span>
              <span className="text-[#A07C3B]">risco ou pendência</span>
            </>
          ) : null}
        </div>
      </div>
      <span className="whitespace-nowrap text-left text-xs font-semibold text-[#667085] lg:text-right">
        {formatDateTime(record.localDateTime)}
      </span>
    </button>
  );
}
