"use client";

import {
  Activity,
  CalendarClock,
  MessageCircle,
  ShieldAlert,
  Sparkles,
  TicketCheck,
} from "lucide-react";

import { BuilderCard, ProgressLine, SignalCard } from "../shared/iris-ui";
import type { IrisData, IrisSnapshot } from "../../types/iris-types";

export function IrisReportsView({
  data,
  formatCount,
  snapshot,
}: {
  data: IrisData;
  formatCount: (value: number) => string;
  snapshot: IrisSnapshot;
}) {
  const priorityRows: Array<[string, number, number]> = [
    [
      "Critica",
      data.tickets.filter((ticket) => ticket.priority === "critical").length,
      snapshot.total,
    ],
    [
      "Alta",
      data.tickets.filter((ticket) => ticket.priority === "high").length,
      snapshot.total,
    ],
    [
      "Media",
      data.tickets.filter((ticket) => ticket.priority === "medium").length,
      snapshot.total,
    ],
    [
      "Baixa",
      data.tickets.filter((ticket) => ticket.priority === "low").length,
      snapshot.total,
    ],
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-4">
      <section className="rounded-2xl border border-[#dbe3ef] bg-white p-4">
        <h3 className="mb-4 text-base font-semibold">
          Performance operacional
        </h3>
        <div className="grid grid-cols-4 gap-3">
          <SignalCard
            icon={TicketCheck}
            title="Tickets"
            value={formatCount(snapshot.total)}
          />
          <SignalCard
            icon={ShieldAlert}
            title="Criticos"
            value={formatCount(snapshot.critical)}
            tone="red"
          />
          <SignalCard
            icon={MessageCircle}
            title="Sem resposta"
            value={formatCount(snapshot.unanswered)}
            tone="gold"
          />
          <SignalCard
            icon={Sparkles}
            title="Acoes IA"
            value={formatCount(snapshot.aiActions)}
            tone="blue"
          />
        </div>
        <div className="mt-5 space-y-3">
          {priorityRows.map(([label, value, total]) => (
            <ProgressLine
              key={label}
              label={label}
              value={value}
              total={total}
            />
          ))}
        </div>
      </section>

      <aside className="space-y-3">
        <BuilderCard
          icon={Activity}
          title="Resumo"
          rows={[
            ["Fila", formatCount(snapshot.total)],
            ["SLA critico", formatCount(snapshot.slaCritical)],
            ["Cliente foco", snapshot.topTicket?.contactLabel ?? "-"],
            ["Proxima janela", "Hoje"],
          ]}
        />
        <BuilderCard
          icon={CalendarClock}
          title="Agenda"
          rows={[
            ["Retornos", formatCount(snapshot.followUpsToday)],
            ["Sem resposta", formatCount(snapshot.unanswered)],
            ["Escalados", formatCount(snapshot.waitingOperator)],
            ["Proxima janela", "Hoje"],
          ]}
        />
      </aside>
    </div>
  );
}
