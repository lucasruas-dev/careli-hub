import { MessageCircle } from "lucide-react";
import { priorityStyles } from "@/modules/attendance/priority";
import { workflowStageStyles } from "@/modules/attendance/workflow";
import type { QueueClient } from "@/modules/attendance/types";

type ClientQueueCardProps = {
  client: QueueClient;
  selected: boolean;
  onOpenWhatsApp: () => void;
  onSelect: () => void;
};

export function ClientQueueCard({
  client,
  selected,
  onOpenWhatsApp,
  onSelect,
}: ClientQueueCardProps) {
  return (
    <article
      className={`w-full rounded-xl border p-4 text-left transition-all ${
        selected
          ? "border-[#A07C3B]/30 bg-[#A07C3B]/5 shadow-[0_10px_30px_rgba(160,124,59,0.08)]"
          : "border-transparent bg-white hover:border-slate-200/70 hover:bg-slate-50/80"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-slate-950">{client.nome}</p>
          <p className="mt-1 text-xs text-slate-500">Responsável: {client.responsavel}</p>
        </button>

        <button
          type="button"
          onClick={onOpenWhatsApp}
          aria-label={`Abrir WhatsApp de ${client.nome}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
        </button>

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
        <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
          {client.workflow.nextAction}
        </span>
      </button>

      <button type="button" onClick={onSelect} className="mt-4 grid w-full grid-cols-3 gap-3 text-left">
        <div>
          <p className="text-xs text-slate-500">Atraso</p>
          <p className="mt-1 text-sm font-medium text-slate-950">{client.atrasoDias} dias</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Saldo</p>
          <p className="mt-1 truncate text-sm font-medium text-slate-950">{client.saldoDevedor}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Risco</p>
          <p className="mt-1 text-sm font-medium text-slate-950">{client.scoreRisco}</p>
        </div>
      </button>
    </article>
  );
}
