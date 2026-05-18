/* eslint-disable */
// @ts-nocheck
"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Gauge,
  Flame,
  Headphones,
  Hourglass,
  ListChecks,
  Mail,
  MessageCircle,
  PhoneCall,
  Radio,
  ShieldAlert,
  Target,
  TrendingUp,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { DetailSection } from "@/modules/guardian/attendance/components/DetailSection";

type KpiId =
  | "activeOperators"
  | "todayContacts"
  | "stoppedQueue"
  | "todayPromises"
  | "pendingDeals"
  | "slaRisk";

type Tone = "danger" | "gold" | "neutral" | "success";
type MonitoringPanelId =
  | "desk"
  | "financial"
  | "workflow"
  | "sla"
  | "heatmap"
  | "productivity"
  | "ai";

type DrawerField = {
  label: string;
  value: string;
  tone?: Tone;
};

type DrawerDataset = {
  title: string;
  description: string;
  items: Array<{
    title: string;
    subtitle?: string;
    fields: DrawerField[];
  }>;
};

const MONITORING_PANELS_STORAGE_KEY = "guardian-monitoring-panels";
const EMPTY_FIELD = "-";

const defaultPanelState: Record<MonitoringPanelId, boolean> = {
  desk: true,
  financial: false,
  workflow: false,
  sla: false,
  heatmap: false,
  productivity: false,
  ai: true,
};

const kpis: Array<{
  id: KpiId;
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  tone: Exclude<Tone, "success">;
}> = [
  { id: "activeOperators", label: "Operadores ativos", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: Users, tone: "gold" },
  { id: "todayContacts", label: "Contatos hoje", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: Headphones, tone: "neutral" },
  { id: "stoppedQueue", label: "Fila parada", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: Hourglass, tone: "danger" },
  { id: "todayPromises", label: "Promessas para hoje", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: CheckCircle2, tone: "gold" },
  { id: "pendingDeals", label: "Acordos pendentes", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: Clock3, tone: "neutral" },
  { id: "slaRisk", label: "SLA em risco", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: ShieldAlert, tone: "danger" },
];

const operators = [
  {
    name: EMPTY_FIELD,
    status: EMPTY_FIELD,
    startTime: EMPTY_FIELD,
    contacts: EMPTY_FIELD,
    portfolio: EMPTY_FIELD,
    promises: EMPTY_FIELD,
    sla: EMPTY_FIELD,
    recovery: EMPTY_FIELD,
  },
];

const todayAppointments = [
  [EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD],
].map(([time, client, channel, operator, result, nextAction]) => ({
  time,
  client,
  channel,
  operator,
  result,
  nextAction,
}));

const operationalQueue = [
  [EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD],
].map(([client, enterprise, unit, delay, priority, owner, sla]) => ({
  client,
  enterprise,
  unit,
  delay,
  priority,
  owner,
  sla,
}));

const operatorPlans = [
  {
    name: EMPTY_FIELD,
    contactsPlanned: EMPTY_FIELD,
    promisesToTrack: EMPTY_FIELD,
    pendingDeals: EMPTY_FIELD,
    criticalClients: EMPTY_FIELD,
    nextBestAction: EMPTY_FIELD,
    focus: EMPTY_FIELD,
  },
];

const promises = [
  [EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD],
].map(([client, amount, time, owner, status]) => ({ client, amount, time, owner, status }));

const pendingDeals = [
  [EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD],
].map(([client, amount, entry, installments, owner, approval]) => ({
  client,
  amount,
  entry,
  installments,
  owner,
  approval,
}));

const slaRisk = [
  [EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD, EMPTY_FIELD],
].map(([client, stage, limit, remaining, owner, severity]) => ({
  client,
  stage,
  limit,
  remaining,
  owner,
  severity,
}));

const alerts = [
  {
    title: EMPTY_FIELD,
    description: EMPTY_FIELD,
    tone: "danger",
  },
];

const slaStages = [
  [EMPTY_FIELD, 0],
] as const;

const deskRealtimeCards = [
  { label: "1ª resposta média", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: Clock3, tone: "gold" },
  { label: "Média de resposta", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: MessageCircle, tone: "gold" },
  { label: "Tickets sem resposta", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: AlertTriangle, tone: "danger" },
  { label: "Aguardando operador", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: Users, tone: "danger" },
  { label: "Tickets abertos", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: Headphones, tone: "gold" },
  { label: "Em atendimento", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: Radio, tone: "neutral" },
  { label: "Aguardando resposta", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: MessageCircle, tone: "gold" },
  { label: "SLA crítico", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: ShieldAlert, tone: "danger" },
  { label: "Encerrados hoje", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: CheckCircle2, tone: "neutral" },
  { label: "Novas mensagens", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: AlertTriangle, tone: "danger" },
  { label: "TMR", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: Clock3, tone: "neutral" },
  { label: "TME", value: EMPTY_FIELD, helper: EMPTY_FIELD, icon: Gauge, tone: "gold" },
] satisfies Array<{
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  tone: Exclude<Tone, "success">;
}>;

const deskOperators = [
  { name: EMPTY_FIELD, tickets: EMPTY_FIELD, critical: 0, slaDue: EMPTY_FIELD, noResponse: EMPTY_FIELD, firstResponse: EMPTY_FIELD, averageResponse: EMPTY_FIELD, newMessages: EMPTY_FIELD, status: EMPTY_FIELD },
];

const deskHeatmap = [
  [EMPTY_FIELD, EMPTY_FIELD, 0, "neutral"],
] as const;

const drawerDatasets: Record<KpiId, DrawerDataset> = {
  activeOperators: {
    title: "Operadores ativos",
    description: "Operadores em turno com atividade operacional no dia.",
    items: operators.map((operator) => ({
      title: operator.name,
      subtitle: `Início às ${operator.startTime}`,
      fields: [
        { label: "Status", value: operator.status, tone: operator.status === "Online" ? "success" : "gold" },
        { label: "Contatos realizados", value: `${operator.contacts}` },
        { label: "Carteira atual", value: `${operator.portfolio} clientes` },
      ],
    })),
  },
  todayContacts: {
    title: "Contatos hoje",
    description: "Interações registradas por canal, resultado e próxima ação.",
    items: todayAppointments.map((contact) => ({
      title: contact.client,
      subtitle: `${contact.channel} · ${contact.time}`,
      fields: [
        { label: "Responsável", value: contact.operator },
        { label: "Resultado", value: contact.result, tone: getResultTone(contact.result) },
        { label: "Próxima ação", value: contact.nextAction },
      ],
    })),
  },
  stoppedQueue: {
    title: "Fila parada",
    description: "Clientes sem interação recente e com prioridade operacional.",
    items: operationalQueue.map((item) => ({
      title: item.client,
      subtitle: `${item.enterprise} · ${item.unit}`,
      fields: [
        { label: "Atraso", value: item.delay, tone: item.priority === "Crítica" ? "danger" : "gold" },
        { label: "Responsável", value: item.owner },
        { label: "Prioridade", value: item.priority, tone: getPriorityTone(item.priority) },
        { label: "SLA", value: item.sla, tone: item.priority === "Crítica" ? "danger" : "gold" },
      ],
    })),
  },
  todayPromises: {
    title: "Promessas para hoje",
    description: "Compromissos de pagamento previstos para acompanhamento.",
    items: promises.map((promise) => ({
      title: promise.client,
      subtitle: promise.time,
      fields: [
        { label: "Valor prometido", value: promise.amount, tone: "gold" },
        { label: "Responsável", value: promise.owner },
        { label: "Status", value: promise.status, tone: promise.status === "Vencida" ? "danger" : promise.status === "Cumprida" ? "success" : "gold" },
      ],
    })),
  },
  pendingDeals: {
    title: "Acordos pendentes",
    description: "Propostas aguardando aprovação antes do envio final.",
    items: pendingDeals.map((deal) => ({
      title: deal.client,
      subtitle: `${deal.entry} de entrada · ${deal.installments}`,
      fields: [
        { label: "Valor do acordo", value: deal.amount, tone: "gold" },
        { label: "Responsável", value: deal.owner },
        { label: "Status aprovação", value: deal.approval },
      ],
    })),
  },
  slaRisk: {
    title: "SLA em risco",
    description: "Etapas com prazo próximo do limite operacional.",
    items: slaRisk.map((item) => ({
      title: item.client,
      subtitle: item.stage,
      fields: [
        { label: "Prazo limite", value: item.limit },
        { label: "Tempo restante", value: item.remaining, tone: item.severity === "Crítica" ? "danger" : "gold" },
        { label: "Responsável", value: item.owner },
        { label: "Severidade", value: item.severity, tone: getPriorityTone(item.severity) },
      ],
    })),
  },
};

export function MonitoringPage() {
  const [selectedKpi, setSelectedKpi] = useState<KpiId | null>(null);
  const [expandedPanels, setExpandedPanels] = useState(defaultPanelState);
  const drawerData = selectedKpi ? drawerDatasets[selectedKpi] : null;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = window.localStorage.getItem(MONITORING_PANELS_STORAGE_KEY);
      if (!stored) return;

      try {
        setExpandedPanels({ ...defaultPanelState, ...JSON.parse(stored) });
      } catch {
        setExpandedPanels(defaultPanelState);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  function togglePanel(panel: MonitoringPanelId) {
    setExpandedPanels((current) => {
      const next = { ...current, [panel]: !current[panel] };
      window.localStorage.setItem(MONITORING_PANELS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <>
      <div className="flex min-h-[calc(100vh-7rem)] w-full flex-col gap-6">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {kpis.map((item) => (
            <MonitoringKpi key={item.id} {...item} onClick={() => setSelectedKpi(item.id)} />
          ))}
        </section>

        <OperationalPanel
          badge={EMPTY_FIELD}
          expanded={expandedPanels.desk}
          id="desk"
          onToggle={togglePanel}
          summary={EMPTY_FIELD}
          title="CareDesk operacional"
          tone="danger"
        >
          <div className="space-y-4">
            <DeskOperationalBlock />
            <DeskOperatorsRealtimeBlock />
          </div>
        </OperationalPanel>

        <OperationalPanel
          expanded={expandedPanels.financial}
          id="financial"
          onToggle={togglePanel}
          summary={EMPTY_FIELD}
          title="Operação financeira"
          tone="gold"
        >
          <div className="grid gap-4 2xl:grid-cols-[1.08fr_0.92fr]">
            <TodayAppointmentsBlock />
            <OperationalQueueBlock />
          </div>
          <div className="mt-4">
            <PromisesBlock />
          </div>
        </OperationalPanel>

        <OperationalPanel
          expanded={expandedPanels.workflow}
          id="workflow"
          onToggle={togglePanel}
          summary={EMPTY_FIELD}
          title="Workflow operacional"
          tone="neutral"
        >
          <OperatorPlanBlock />
        </OperationalPanel>

        <OperationalPanel
          badge={EMPTY_FIELD}
          expanded={expandedPanels.sla}
          id="sla"
          onToggle={togglePanel}
          summary={EMPTY_FIELD}
          title="SLA"
          tone="danger"
        >
          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <SlaBlock />
            <AlertsBlock />
          </div>
        </OperationalPanel>

        <OperationalPanel
          expanded={expandedPanels.heatmap}
          id="heatmap"
          onToggle={togglePanel}
          summary={EMPTY_FIELD}
          title="Heatmap operacional"
          tone="danger"
        >
          <DeskHeatmapBlock />
        </OperationalPanel>

        <OperationalPanel
          expanded={expandedPanels.productivity}
          id="productivity"
          onToggle={togglePanel}
          summary={EMPTY_FIELD}
          title="Produtividade"
          tone="neutral"
        >
          <OperatorsBlock />
        </OperationalPanel>

        <OperationalPanel
          expanded={expandedPanels.ai}
          id="ai"
          onToggle={togglePanel}
          summary={EMPTY_FIELD}
          title="IA operacional"
          tone="gold"
        >
          <AiOperationalBlock />
        </OperationalPanel>
      </div>

      <KpiDrawer data={drawerData} onClose={() => setSelectedKpi(null)} />
    </>
  );
}

function MonitoringKpi({
  helper,
  icon: Icon,
  label,
  onClick,
  tone,
  value,
}: {
  helper: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone: Exclude<Tone, "success">;
  value: string;
}) {
  const toneClass = {
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
    gold: "bg-[#A07C3B]/5 text-[#A07C3B] ring-[#A07C3B]/15",
    neutral: "bg-slate-50 text-slate-600 ring-slate-200/70",
  }[tone];

  return (
    <Tooltip content={helper} placement="bottom" className="w-full" triggerClassName="w-full">
      <button
        type="button"
        onClick={onClick}
        className="group w-full rounded-xl border border-slate-200/70 bg-white p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#A07C3B]/20 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">{label}</p>
            <p className="mt-2 text-xl font-semibold tracking-normal text-slate-950">{value}</p>
            <p className="mt-1 line-clamp-1 text-xs text-slate-500">{helper}</p>
          </div>
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 transition-transform duration-200 group-hover:scale-105 ${toneClass}`}>
            <Icon className="size-4" aria-hidden="true" />
          </div>
        </div>
      </button>
    </Tooltip>
  );
}

function OperationalPanel({
  badge,
  children,
  expanded,
  id,
  onToggle,
  summary,
  title,
  tone = "neutral",
}: {
  badge?: string;
  children: ReactNode;
  expanded: boolean;
  id: MonitoringPanelId;
  onToggle: (id: MonitoringPanelId) => void;
  summary: string;
  title: string;
  tone?: Exclude<Tone, "success">;
}) {
  const badgeClass = {
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
    gold: "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15",
    neutral: "bg-slate-50 text-slate-600 ring-slate-200/70",
  }[tone];

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50/70 lg:flex-row lg:items-center lg:justify-between"
        aria-expanded={expanded}
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
            {badge ? (
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${badgeClass}`}>
                {badge}
              </span>
            ) : null}
          </div>
          <Tooltip content={summary} placement="bottom">
            <span className="mt-1 line-clamp-1 text-xs text-slate-500">{summary}</span>
          </Tooltip>
        </div>
        <Tooltip content={expanded ? "Recolher painel" : "Expandir painel"} placement="left">
          <span
            aria-label={expanded ? "Recolher painel" : "Expandir painel"}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-600"
          >
            <ChevronDown className={`size-4 text-[#A07C3B] transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
          </span>
        </Tooltip>
      </button>
      <div
        className={`grid transition-all duration-300 ease-out ${
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-slate-100 p-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

function DeskOperationalBlock() {
  return (
    <DetailSection title="CareDesk operacional" icon={Headphones} accent>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {deskRealtimeCards.map((card) => (
          <RealtimeDeskCard key={card.label} {...card} />
        ))}
      </div>
    </DetailSection>
  );
}

function RealtimeDeskCard({
  helper,
  icon: Icon,
  label,
  tone,
  value,
}: {
  helper: string;
  icon: LucideIcon;
  label: string;
  tone: Exclude<Tone, "success">;
  value: string;
}) {
  const toneClass = {
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
    gold: "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15",
    neutral: "bg-slate-50 text-slate-600 ring-slate-200/70",
  }[tone];

  return (
    <article className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-xl font-semibold tracking-normal text-slate-950">{value}</p>
          <p className="mt-0.5 text-xs text-slate-500">{helper}</p>
        </div>
        <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ${toneClass}`}>
          <Icon className="size-4" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}

function DeskOperatorsRealtimeBlock() {
  return (
    <DetailSection title="Lista operacional realtime" icon={Radio} accent className="h-full">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="text-xs uppercase tracking-normal text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="pb-3 font-medium">Operador</th>
              <th className="pb-3 font-medium">Tickets</th>
              <th className="pb-3 font-medium">Críticos</th>
              <th className="pb-3 font-medium">SLA vencendo</th>
              <th className="pb-3 font-medium">Sem resposta</th>
              <th className="pb-3 font-medium">1ª resposta</th>
              <th className="pb-3 font-medium">Média resposta</th>
              <th className="pb-3 font-medium">Novas mensagens</th>
              <th className="pb-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {deskOperators.map((operator) => (
              <tr key={operator.name}>
                <td className="py-4 font-semibold text-slate-950">{operator.name}</td>
                <td className="py-4 text-slate-600">{operator.tickets}</td>
                <td className="py-4">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${operator.critical > 0 ? "bg-rose-50 text-rose-700 ring-rose-100" : "bg-slate-50 text-slate-500 ring-slate-200"}`}>
                    {operator.critical}
                  </span>
                </td>
                <td className="py-4 font-medium text-slate-950">{operator.slaDue}</td>
                <td className="py-4 text-slate-600">{operator.noResponse}</td>
                <td className="py-4 font-medium text-slate-950">{operator.firstResponse}</td>
                <td className="py-4 text-slate-600">{operator.averageResponse}</td>
                <td className="py-4">
                  <span className="rounded-full bg-[#A07C3B]/5 px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                    {operator.newMessages}
                  </span>
                </td>
                <td className="py-4">
                  <StatusBadge status={operator.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DetailSection>
  );
}

function DeskHeatmapBlock() {
  return (
    <DetailSection title="Heatmap operacional do CareDesk" icon={Flame} accent className="h-full">
      <div className="grid grid-cols-4 gap-2">
        {deskHeatmap.map(([operator, metric, value, tone]) => (
          <div
            key={`${operator}-${metric}`}
            className={`rounded-xl border px-3 py-3 ${
              tone === "danger"
                ? "border-rose-100 bg-rose-50"
                : tone === "gold"
                  ? "border-[#A07C3B]/15 bg-[#A07C3B]/5"
                  : "border-slate-200/70 bg-slate-50/60"
            }`}
          >
            <p className="truncate text-[11px] font-semibold uppercase tracking-normal text-slate-400">{operator}</p>
            <p className="mt-1 truncate text-xs font-medium text-slate-500">{metric}</p>
            <p className={`mt-2 text-lg font-semibold ${tone === "danger" ? "text-rose-700" : tone === "gold" ? "text-[#7A5E2C]" : "text-slate-950"}`}>
              {value > 0 ? `${value}%` : EMPTY_FIELD}
            </p>
          </div>
        ))}
      </div>
    </DetailSection>
  );
}

function AiOperationalBlock() {
  return (
    <DetailSection title="IA operacional" icon={Bot} accent>
      <div className="grid gap-3 lg:grid-cols-3">
        <article className="rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 p-4">
          <p className="text-sm font-semibold text-slate-950">Gargalo identificado</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{EMPTY_FIELD}</p>
        </article>
        <article className="rounded-xl border border-rose-100 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-800">Risco previsto</p>
          <p className="mt-2 text-sm leading-6 text-rose-700">{EMPTY_FIELD}</p>
        </article>
        <article className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
          <p className="text-sm font-semibold text-slate-950">Recomendação</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">{EMPTY_FIELD}</p>
        </article>
      </div>
    </DetailSection>
  );
}

function TodayAppointmentsBlock() {
  return (
    <DetailSection title="Atendimentos de hoje" icon={CalendarDays} accent className="h-full">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="text-xs uppercase tracking-normal text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="pb-3 font-medium">Horário</th>
              <th className="pb-3 font-medium">Cliente</th>
              <th className="pb-3 font-medium">Canal</th>
              <th className="pb-3 font-medium">Operador</th>
              <th className="pb-3 font-medium">Resultado</th>
              <th className="pb-3 font-medium">Próxima ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {todayAppointments.map((appointment) => (
              <tr key={`${appointment.time}-${appointment.client}`}>
                <td className="w-20 py-4 font-semibold text-slate-950">{appointment.time}</td>
                <td className="py-4 font-semibold text-slate-950">{appointment.client}</td>
                <td className="py-4">
                  <ChannelBadge channel={appointment.channel} />
                </td>
                <td className="py-4 text-slate-600">{appointment.operator}</td>
                <td className="py-4">
                  <ResultBadge result={appointment.result} />
                </td>
                <td className="max-w-[260px] py-4 text-slate-600">{appointment.nextAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DetailSection>
  );
}

function OperationalQueueBlock() {
  return (
    <DetailSection title="Fila operacional do dia" icon={ListChecks} accent className="h-full">
      <div className="space-y-3">
        {operationalQueue.map((item, index) => (
          <article key={`${item.client}-${item.unit}`} className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-semibold text-slate-500 ring-1 ring-slate-200/70">
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-950">{item.client}</p>
                    <PriorityBadge priority={item.priority} />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {item.enterprise} · {item.unit}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm sm:w-[330px]">
                <InfoPill label="Atraso" value={item.delay} tone={item.priority === "Crítica" ? "danger" : "neutral"} />
                <InfoPill label="Responsável" value={item.owner} />
                <InfoPill label="SLA" value={item.sla} tone={item.priority === "Crítica" ? "danger" : "gold"} />
              </div>
            </div>
          </article>
        ))}
      </div>
    </DetailSection>
  );
}

function OperatorPlanBlock() {
  return (
    <DetailSection title="Plano do operador" icon={Target} accent>
      <div className="grid gap-4 xl:grid-cols-2">
        {operatorPlans.map((plan) => (
          <article key={plan.name} className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-white text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                    <UserCheck className="size-4" aria-hidden="true" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-950">{plan.name}</h4>
                    <p className="mt-0.5 text-sm text-slate-500">{plan.focus}</p>
                  </div>
                </div>
              </div>
              <StatusBadge status={EMPTY_FIELD} />
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-4">
              <MetricTile label="Contatos hoje" value={String(plan.contactsPlanned)} icon={PhoneCall} />
              <MetricTile label="Promessas" value={String(plan.promisesToTrack)} icon={CheckCircle2} />
              <MetricTile label="Acordos" value={String(plan.pendingDeals)} icon={Clock3} />
              <MetricTile label="Críticos" value={String(plan.criticalClients)} icon={Flame} tone={plan.criticalClients > 1 ? "danger" : "gold"} />
            </div>

            <div className="mt-4 rounded-xl bg-white p-4 ring-1 ring-slate-200/70">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
                  <ArrowRight className="size-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Próxima melhor ação</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{plan.nextBestAction}</p>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </DetailSection>
  );
}

function OperatorsBlock() {
  return (
    <DetailSection title="Operadores" icon={Radio}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="text-xs uppercase tracking-normal text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="pb-3 font-medium">Operador</th>
              <th className="pb-3 font-medium">Status</th>
              <th className="pb-3 font-medium">Contatos</th>
              <th className="pb-3 font-medium">Carteira</th>
              <th className="pb-3 font-medium">Promessas</th>
              <th className="pb-3 font-medium">SLA</th>
              <th className="pb-3 font-medium">Recuperação do dia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {operators.map((operator) => (
              <tr key={operator.name}>
                <td className="py-4 font-semibold text-slate-950">{operator.name}</td>
                <td className="py-4"><StatusBadge status={operator.status} /></td>
                <td className="py-4 text-slate-600">{operator.contacts}</td>
                <td className="py-4 text-slate-600">{operator.portfolio}</td>
                <td className="py-4 text-slate-600">{operator.promises}</td>
                <td className="py-4 font-medium text-slate-950">{operator.sla}</td>
                <td className="py-4 font-semibold text-slate-950">{operator.recovery}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DetailSection>
  );
}

function PromisesBlock() {
  return (
    <DetailSection title="Promessas do dia" icon={CheckCircle2}>
      <div className="space-y-3">
        {promises.map((item) => (
          <article key={`${item.client}-${item.time}`} className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold text-slate-950">{item.client}</p>
                <p className="mt-1 text-sm text-slate-500">{item.time} · {item.owner}</p>
              </div>
              <div className="flex items-center gap-2">
                <p className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-950 ring-1 ring-slate-200/70">{item.amount}</p>
                <PromiseBadge status={item.status} />
              </div>
            </div>
          </article>
        ))}
      </div>
    </DetailSection>
  );
}

function AlertsBlock() {
  return (
    <DetailSection title="Alertas operacionais" icon={AlertTriangle}>
      <div className="grid gap-3 md:grid-cols-2">
        {alerts.map((alert) => (
          <article key={alert.title} className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 size-2.5 shrink-0 rounded-full ${alert.tone === "danger" ? "bg-rose-500" : alert.tone === "gold" ? "bg-[#A07C3B]" : "bg-slate-400"}`} />
              <div>
                <h4 className="text-sm font-semibold text-slate-950">{alert.title}</h4>
                <p className="mt-2 text-sm leading-6 text-slate-500">{alert.description}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </DetailSection>
  );
}

function SlaBlock() {
  return (
    <DetailSection title="SLA por etapa" icon={TrendingUp}>
      <div className="space-y-5">
        {slaStages.map(([label, value]) => (
          <div key={label}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-600">{label}</span>
              <span className="text-sm font-semibold text-slate-950">{value > 0 ? `${value}%` : EMPTY_FIELD}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#A07C3B]/70" style={{ width: `${value > 0 ? value : 0}%` }} />
            </div>
          </div>
        ))}
      </div>
    </DetailSection>
  );
}

function KpiDrawer({ data, onClose }: { data: DrawerDataset | null; onClose: () => void }) {
  const isOpen = Boolean(data);

  return (
    <div
      className={`fixed inset-0 z-50 transition ${isOpen ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!isOpen}
    >
      <button
        type="button"
        aria-label="Fechar detalhes"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/20 transition-opacity ${isOpen ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-[460px] flex-col border-l border-slate-200/70 bg-white shadow-[-24px_0_60px_rgba(15,23,42,0.16)] transition-transform duration-300 ease-out ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {data ? (
          <>
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#A07C3B]">Detalhamento</p>
                  <h2 className="mt-2 text-lg font-semibold text-slate-950">{data.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{data.description}</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
                  aria-label="Fechar drawer"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {data.items.map((item) => (
                <article key={`${data.title}-${item.title}-${item.subtitle ?? ""}`} className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
                  <h3 className="text-sm font-semibold text-slate-950">{item.title}</h3>
                  {item.subtitle ? <p className="mt-1 text-sm text-slate-500">{item.subtitle}</p> : null}
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {item.fields.map((field) => (
                      <FieldPill key={`${item.title}-${field.label}`} {...field} />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}

function FieldPill({ label, tone = "neutral", value }: DrawerField) {
  const valueClass = getToneTextClass(tone);

  return (
    <div className="min-w-0 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-sm font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: LucideIcon;
  label: string;
  tone?: Tone;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200/70">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <Icon className={`size-4 ${getToneTextClass(tone)}`} aria-hidden="true" />
      </div>
      <p className={`mt-3 text-xl font-semibold tracking-normal ${getToneTextClass(tone)}`}>{value}</p>
    </div>
  );
}

function InfoPill({ label, tone = "neutral", value }: { label: string; tone?: Tone; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-sm font-semibold ${getToneTextClass(tone)}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const className = {
    Ausente: "bg-amber-50 text-amber-700 ring-amber-100",
    Offline: "bg-slate-50 text-slate-500 ring-slate-200",
    Online: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  }[status] ?? "bg-slate-50 text-slate-500 ring-slate-200";

  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${className}`}>{status}</span>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const className = {
    Alta: "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
    "Crítica": "bg-rose-50 text-rose-700 ring-rose-100",
    "Média": "bg-slate-50 text-slate-700 ring-slate-200",
  }[priority] ?? "bg-slate-50 text-slate-500 ring-slate-200";

  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${className}`}>{priority}</span>;
}

function PromiseBadge({ status }: { status: string }) {
  const className = {
    Cumprida: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    Pendente: "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
    Vencida: "bg-rose-50 text-rose-700 ring-rose-100",
  }[status] ?? "bg-slate-50 text-slate-500 ring-slate-200";

  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${className}`}>{status}</span>;
}

function ResultBadge({ result }: { result: string }) {
  const tone = getResultTone(result);
  const className = {
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
    gold: "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
    neutral: "bg-slate-50 text-slate-700 ring-slate-200",
    success: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  }[tone];

  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${className}`}>{result}</span>;
}

function ChannelBadge({ channel }: { channel: string }) {
  const Icon = channel === "WhatsApp" ? MessageCircle : channel === "Ligação" ? PhoneCall : Mail;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200/70">
      <Icon className="size-3.5" aria-hidden="true" />
      {channel}
    </span>
  );
}

function getResultTone(result: string): Tone {
  if (result === "Sem resposta") return "danger";
  if (result.includes("Acordo") || result.includes("Promessa")) return "success";
  if (result.includes("Contraproposta") || result.includes("reagendado")) return "gold";
  return "neutral";
}

function getPriorityTone(priority: string): Tone {
  if (priority === "Crítica") return "danger";
  if (priority === "Alta") return "gold";
  return "neutral";
}

function getToneTextClass(tone: Tone) {
  return {
    danger: "text-rose-700",
    gold: "text-[#7A5E2C]",
    neutral: "text-slate-950",
    success: "text-emerald-700",
  }[tone];
}




