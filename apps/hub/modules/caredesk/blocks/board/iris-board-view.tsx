"use client";

import type { ReactNode } from "react";
import { Clock3, MessageCircle, ShieldAlert, TicketCheck } from "lucide-react";

import { SignalCard } from "../shared/iris-ui";

export type IrisBoardMetrics = {
  averageHandlingTimeLabel: string;
  firstResponseLabel: string;
  responseTimeLabel: string;
  slaCriticalLabel: string;
  slaCriticalTone: "neutral" | "red";
};

export type IrisBoardActionItem = {
  detail: string;
  title: string;
  value: string;
};

export function IrisBoardView({
  children,
  metrics,
}: {
  // Mantido no contrato p/ nao quebrar o caller; a Agenda saiu do board (inbox em largura total).
  actionItems?: IrisBoardActionItem[];
  children: ReactNode;
  metrics: IrisBoardMetrics;
}) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SignalCard
          icon={Clock3}
          title="TPR"
          value={metrics.firstResponseLabel}
          tone="gold"
        />
        <SignalCard
          icon={MessageCircle}
          title="TDR"
          value={metrics.responseTimeLabel}
          tone="blue"
        />
        <SignalCard
          icon={TicketCheck}
          title="TMA"
          value={metrics.averageHandlingTimeLabel}
          tone="green"
        />
        <SignalCard
          icon={ShieldAlert}
          title="SLA critico"
          value={metrics.slaCriticalLabel}
          tone={metrics.slaCriticalTone}
        />
      </div>

      <div className="min-h-0 min-w-0">{children}</div>
    </div>
  );
}
