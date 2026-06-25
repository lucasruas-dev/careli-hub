"use client";

import type { ReactNode } from "react";
import {
  CalendarClock,
  Clock3,
  MessageCircle,
  ShieldAlert,
  TicketCheck,
} from "lucide-react";

import { ActionPanel, SignalCard } from "../shared/iris-ui";

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
  actionItems,
  children,
  metrics,
}: {
  actionItems: IrisBoardActionItem[];
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

      <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-h-0 min-w-0">{children}</div>

        <aside className="min-h-0 space-y-3 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          <ActionPanel
            icon={CalendarClock}
            title="Agenda"
            items={actionItems}
          />
        </aside>
      </div>
    </div>
  );
}
