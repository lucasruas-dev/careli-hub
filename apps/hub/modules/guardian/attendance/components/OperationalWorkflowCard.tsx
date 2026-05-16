/* eslint-disable */
// @ts-nocheck
import { GitBranch, Sparkles } from "lucide-react";
import { DetailSection } from "@/modules/guardian/attendance/components/DetailSection";
import { workflowStageDots, workflowStageStyles } from "@/modules/guardian/attendance/workflow";
import type { QueueClient } from "@/modules/guardian/attendance/types";

type OperationalWorkflowCardProps = {
  client: QueueClient;
};

export function OperationalWorkflowCard({ client }: OperationalWorkflowCardProps) {
  const { workflow } = client;

  return (
    <DetailSection title="Workflow operacional" icon={GitBranch} accent>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                Etapa atual
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`size-2.5 rounded-full ${workflowStageDots[workflow.stage]}`} />
                <span
                  title={`Etapa atual: ${workflow.stage}`}
                  className={`inline-flex h-7 items-center justify-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset ${
                    workflowStageStyles[workflow.stage]
                  }`}
                >
                  {workflow.stage}
                </span>
                <span className="text-xs text-slate-500">{workflow.updatedAt}</span>
              </div>
            </div>

            <div className="rounded-lg border border-[#A07C3B]/15 bg-white px-3 py-2 text-[#7A5E2C]">
              <p className="text-xs font-semibold">Op.</p>
              <p className="mt-1 text-sm font-semibold">{workflow.owner}</p>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200/70 bg-white p-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
              <Sparkles className="size-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                Próxima ação
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-700">{workflow.nextAction}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200/70 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
            Histórico de alteração
          </p>
          <div className="mt-3 space-y-3">
            {workflow.history.slice(0, 3).map((change) => (
              <div key={change.id} className="grid grid-cols-[12px_minmax(0,1fr)] gap-3">
                <div className="pt-1.5">
                  <span className={`block size-2 rounded-full ${workflowStageDots[change.to]}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-semibold text-slate-900">{change.to}</span>
                    <span className="text-slate-400">de {change.from}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                    {change.reason}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-slate-400">
                    {change.changedAt} · {change.operator}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DetailSection>
  );
}




