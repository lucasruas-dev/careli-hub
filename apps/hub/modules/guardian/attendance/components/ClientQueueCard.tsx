/* eslint-disable */
// @ts-nocheck
import { MessageCircle } from "lucide-react";
import { Tooltip } from "@repo/uix";
import { priorityStyles } from "@/modules/guardian/attendance/priority";
import { workflowStageStyles } from "@/modules/guardian/attendance/workflow";
import type { QueueClient } from "@/modules/guardian/attendance/types";

type ClientQueueCardProps = {
  client: QueueClient;
  contactedToday?: boolean;
  mode?: "daily" | "general";
  selected: boolean;
  onOpenAttendance: () => void;
  onSelect: () => void;
};

export function ClientQueueCard({
  client,
  contactedToday = false,
  mode = "daily",
  selected,
  onOpenAttendance,
  onSelect,
}: ClientQueueCardProps) {
  return (
    <article
      className={`w-full rounded-xl border p-4 text-left transition-all ${
        selected
          ? "border-[#A07C3B]/30 bg-[#A07C3B]/5 shadow-[0_10px_30px_rgba(160,124,59,0.08)]"
          : "border-transparent bg-surface hover:border-line/70 hover:bg-subtle/80"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-ink">{client.nome}</p>
          <p className="mt-1 text-xs text-ink-muted">Responsável: {client.responsavel}</p>
        </button>

        <Tooltip content="Abrir atendimento" placement="top">
          <button
            type="button"
            onClick={onOpenAttendance}
            aria-label="Abrir atendimento"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-100 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-100"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
          </button>
        </Tooltip>

        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
            priorityStyles[client.prioridade]
          }`}
        >
          {client.prioridade}
        </span>
      </div>

      <button type="button" onClick={onSelect} className="mt-3 flex w-full flex-wrap items-center gap-2 text-left">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
            workflowStageStyles[client.workflow.stage]
          }`}
        >
          {client.workflow.stage}
        </span>
        {mode === "daily" && contactedToday ? (
          <span className="rounded-full bg-emerald-50 dark:bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-100 dark:ring-emerald-500/25">
            Contatado hoje
          </span>
        ) : null}
      </button>

      <button type="button" onClick={onSelect} className="mt-4 grid w-full grid-cols-4 gap-3 text-left">
        <div>
          <p className="text-xs text-ink-muted">Atraso</p>
          <p className="mt-1 text-sm font-medium text-ink">{client.atrasoDias} dias</p>
        </div>
        <div>
          <p className="text-xs text-ink-muted">Parcelas</p>
          <p className="mt-1 text-sm font-medium text-ink">{client.parcelas.vencidas}</p>
        </div>
        <div>
          <p className="text-xs text-ink-muted">Saldo</p>
          <Tooltip content={client.saldoDevedor} placement="top">
            <span className="mt-1 block text-sm font-medium text-ink">
              {formatCompactCurrency(client.saldoDevedor)}
            </span>
          </Tooltip>
        </div>
        <div>
          <p className="text-xs text-ink-muted">Risco</p>
          <p className="mt-1 text-sm font-medium text-ink">{client.scoreRisco}</p>
        </div>
      </button>
    </article>
  );
}

function formatCompactCurrency(value: string) {
  const number = parseCurrency(value);

  if (!Number.isFinite(number)) {
    return value;
  }

  const absolute = Math.abs(number);

  if (absolute >= 1_000_000) {
    const compact = (number / 1_000_000).toLocaleString("pt-BR", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    });

    return `R$ ${compact} mi`;
  }

  if (absolute >= 1_000) {
    return `R$ ${Math.round(number / 1_000).toLocaleString("pt-BR")}k`;
  }

  return value;
}

function parseCurrency(value: string) {
  const normalized = value
    .replace(/[^\d,-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  return Number.parseFloat(normalized);
}
