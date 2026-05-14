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
import { DetailSection } from "@/modules/attendance/components/DetailSection";

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
  { id: "activeOperators", label: "Operadores ativos", value: "2", helper: "em operação", icon: Users, tone: "gold" },
  { id: "todayContacts", label: "Contatos hoje", value: "86", helper: "+14 vs ontem", icon: Headphones, tone: "neutral" },
  { id: "stoppedQueue", label: "Fila parada", value: "12", helper: "sem ação recente", icon: Hourglass, tone: "danger" },
  { id: "todayPromises", label: "Promessas para hoje", value: "18", helper: "R$ 74,8 mil", icon: CheckCircle2, tone: "gold" },
  { id: "pendingDeals", label: "Acordos pendentes", value: "7", helper: "aguardando aprovação", icon: Clock3, tone: "neutral" },
  { id: "slaRisk", label: "SLA em risco", value: "4", helper: "prioridade alta", icon: ShieldAlert, tone: "danger" },
];

const operators = [
  {
    name: "Gustavo Freitas",
    status: "Online",
    startTime: "08:02",
    contacts: 48,
    portfolio: 124,
    promises: 9,
    sla: "94%",
    recovery: "R$ 38,4 mil",
  },
  {
    name: "Cinthia Cruz",
    status: "Ausente",
    startTime: "08:18",
    contacts: 38,
    portfolio: 118,
    promises: 7,
    sla: "88%",
    recovery: "R$ 31,2 mil",
  },
];

const todayAppointments = [
  ["08:40", "Ana Paula Ribeiro", "WhatsApp", "Gustavo Freitas", "Promessa registrada", "Confirmar comprovante às 14:00"],
  ["09:15", "Carlos Henrique Matos", "Ligação", "Cinthia Cruz", "Sem resposta", "Nova tentativa multicanal em 45 min"],
  ["10:05", "Patrícia Amaral", "E-mail", "Gustavo Freitas", "Acordo pré-aprovado", "Enviar proposta final para aceite"],
  ["11:30", "Eduardo Martins", "WhatsApp", "Cinthia Cruz", "Contraproposta", "Validar desconto com gestão"],
  ["14:20", "Renato Pires", "Ligação", "Cinthia Cruz", "Contato reagendado", "Retornar às 16:30 com proposta curta"],
].map(([time, client, channel, operator, result, nextAction]) => ({
  time,
  client,
  channel,
  operator,
  result,
  nextAction,
}));

const operationalQueue = [
  ["Carlos Henrique Matos", "Vista Alegre", "Q07 · Lote 18", "7 dias", "Crítica", "Cinthia Cruz", "42 min"],
  ["Cíntia Rocha", "Lavra do Ouro", "Q11 · Lote 08", "4 dias", "Alta", "Gustavo Freitas", "22 min"],
  ["Renato Pires", "Vista Alegre", "Q10 · Lote 02", "5 dias", "Alta", "Cinthia Cruz", "2h 12min"],
  ["Marcelo Duarte", "Vista Alegre", "Q06 · Lote 15", "3 dias", "Média", "Cinthia Cruz", "2h 40min"],
  ["Ana Paula Ribeiro", "Jardins do Vale", "Q12 · Lote 18", "1 dia", "Média", "Gustavo Freitas", "4h 05min"],
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
    name: "Gustavo Freitas",
    contactsPlanned: 42,
    promisesToTrack: 9,
    pendingDeals: 3,
    criticalClients: 1,
    nextBestAction: "Fechar proposta da Patrícia Amaral e retomar Cíntia Rocha antes do SLA crítico.",
    focus: "Alta conversão",
  },
  {
    name: "Cinthia Cruz",
    contactsPlanned: 46,
    promisesToTrack: 9,
    pendingDeals: 4,
    criticalClients: 3,
    nextBestAction: "Priorizar Carlos Henrique Matos com nova tentativa consultiva e acionar Renato Pires em seguida.",
    focus: "Risco operacional",
  },
];

const promises = [
  ["Ana Paula Ribeiro", "R$ 6.150,00", "Hoje, 10:30", "Gustavo Freitas", "Pendente"],
  ["Patrícia Amaral", "R$ 8.900,00", "Hoje, 13:00", "Gustavo Freitas", "Cumprida"],
  ["Eduardo Martins", "R$ 11.280,00", "Hoje, 15:45", "Cinthia Cruz", "Pendente"],
  ["Carlos Henrique Matos", "R$ 14.600,00", "Hoje, 09:00", "Cinthia Cruz", "Vencida"],
].map(([client, amount, time, owner, status]) => ({ client, amount, time, owner, status }));

const pendingDeals = [
  ["Patrícia Amaral", "R$ 22.640,00", "R$ 4.528,00", "6x", "Gustavo Freitas", "Gestão"],
  ["Carlos Henrique Matos", "R$ 32.980,00", "R$ 6.596,00", "8x", "Cinthia Cruz", "Diretoria"],
  ["Cíntia Rocha", "R$ 19.400,00", "R$ 3.880,00", "5x", "Gustavo Freitas", "Gestão"],
  ["Eduardo Martins", "R$ 28.150,00", "R$ 5.630,00", "7x", "Cinthia Cruz", "Compliance"],
].map(([client, amount, entry, installments, owner, approval]) => ({
  client,
  amount,
  entry,
  installments,
  owner,
  approval,
}));

const slaRisk = [
  ["Carlos Henrique Matos", "Primeiro contato", "Hoje, 16:00", "42 min", "Cinthia Cruz", "Crítica"],
  ["Renato Pires", "Escalonamento jurídico", "Hoje, 17:30", "2h 12min", "Cinthia Cruz", "Alta"],
  ["Cíntia Rocha", "Retorno de promessa", "Hoje, 15:40", "22 min", "Gustavo Freitas", "Alta"],
  ["Marcelo Duarte", "Aprovação de acordo", "Hoje, 18:00", "2h 40min", "Cinthia Cruz", "Média"],
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
    title: "Cliente crítico sem contato há 7 dias",
    description: "Carlos Henrique Matos precisa de acionamento consultivo imediato.",
    tone: "danger",
  },
  {
    title: "Promessa vencida sem retorno",
    description: "Há promessa vencida aguardando nova tentativa de contato.",
    tone: "danger",
  },
  {
    title: "Acordo aguardando aprovação",
    description: "7 propostas dependem de validação da gestão.",
    tone: "gold",
  },
  {
    title: "SLA próximo do limite",
    description: "4 etapas operacionais estão com vencimento nas próximas 2 horas.",
    tone: "neutral",
  },
];

const slaStages = [
  ["Primeiro contato", 92],
  ["Retorno de promessa", 76],
  ["Aprovação de acordo", 68],
  ["Escalonamento jurídico", 84],
] as const;

const deskRealtimeCards = [
  { label: "1ª resposta média", value: "5m 12s", helper: "meta operacional até 5 min", icon: Clock3, tone: "gold" },
  { label: "Média de resposta", value: "7m 48s", helper: "durante tickets ativos", icon: MessageCircle, tone: "gold" },
  { label: "Tickets sem resposta", value: "11", helper: "3 acima de 15 min", icon: AlertTriangle, tone: "danger" },
  { label: "Aguardando operador", value: "6", helper: "pendentes de assumir", icon: Users, tone: "danger" },
  { label: "Tickets abertos", value: "42", helper: "+8 na última hora", icon: Headphones, tone: "gold" },
  { label: "Em atendimento", value: "18", helper: "5 operadores ativos", icon: Radio, tone: "neutral" },
  { label: "Aguardando resposta", value: "11", helper: "3 acima de 20 min", icon: MessageCircle, tone: "gold" },
  { label: "SLA crítico", value: "4", helper: "risco de estouro", icon: ShieldAlert, tone: "danger" },
  { label: "Encerrados hoje", value: "27", helper: "+12% vs média", icon: CheckCircle2, tone: "neutral" },
  { label: "Novas mensagens", value: "9", helper: "3 não lidas", icon: AlertTriangle, tone: "danger" },
  { label: "TMR", value: "4m 18s", helper: "tempo médio de resposta", icon: Clock3, tone: "neutral" },
  { label: "TME", value: "38 min", helper: "tempo médio de encerramento", icon: Gauge, tone: "gold" },
] satisfies Array<{
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  tone: Exclude<Tone, "success">;
}>;

const deskOperators = [
  { name: "Gustavo Freitas", tickets: 12, critical: 1, slaDue: "18 min", noResponse: "12 min", firstResponse: "3m 42s", averageResponse: "4m 18s", newMessages: 2, status: "Em atendimento" },
  { name: "Cinthia Cruz", tickets: 16, critical: 3, slaDue: "08 min", noResponse: "31 min", firstResponse: "11m 20s", averageResponse: "16m 44s", newMessages: 4, status: "Sobrecarregada" },
  { name: "Mariana Lima", tickets: 7, critical: 0, slaDue: "1h 42min", noResponse: "06 min", firstResponse: "2m 58s", averageResponse: "3m 51s", newMessages: 1, status: "Online" },
  { name: "Bruno Azevedo", tickets: 7, critical: 0, slaDue: "2h 10min", noResponse: "03 min", firstResponse: "4m 35s", averageResponse: "5m 10s", newMessages: 2, status: "Online" },
];

const deskHeatmap = [
  ["Gustavo", "Carga", 68, "gold"],
  ["Gustavo", "Sem resposta", 42, "neutral"],
  ["Gustavo", "SLA crítico", 24, "neutral"],
  ["Gustavo", "Demora", 36, "neutral"],
  ["Gustavo", "Fila", 58, "gold"],
  ["Cinthia", "Carga", 92, "danger"],
  ["Cinthia", "Sem resposta", 86, "danger"],
  ["Cinthia", "SLA crítico", 78, "danger"],
  ["Cinthia", "Demora", 91, "danger"],
  ["Cinthia", "Fila", 88, "danger"],
  ["Mariana", "Carga", 38, "neutral"],
  ["Mariana", "Sem resposta", 22, "neutral"],
  ["Mariana", "SLA crítico", 8, "neutral"],
  ["Mariana", "Demora", 18, "neutral"],
  ["Mariana", "Fila", 34, "neutral"],
  ["Bruno", "Carga", 44, "neutral"],
  ["Bruno", "Sem resposta", 18, "neutral"],
  ["Bruno", "SLA crítico", 12, "neutral"],
  ["Bruno", "Demora", 28, "neutral"],
  ["Bruno", "Fila", 40, "neutral"],
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
          badge="4 críticos"
          expanded={expandedPanels.desk}
          id="desk"
          onToggle={togglePanel}
          summary="42 tickets • TMR 4m18s • 4 SLA críticos"
          title="Desk operacional"
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
          summary="18 promessas • 7 acordos pendentes • R$ 74,8 mil"
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
          summary="2 operadores • 88 ações planejadas • 4 críticos"
          title="Workflow operacional"
          tone="neutral"
        >
          <OperatorPlanBlock />
        </OperationalPanel>

        <OperationalPanel
          badge="SLA em risco"
          expanded={expandedPanels.sla}
          id="sla"
          onToggle={togglePanel}
          summary="4 etapas em risco • menor janela 22 min"
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
          summary="Cinthia 91% demora • 88% fila • 78% SLA crítico"
          title="Heatmap operacional"
          tone="danger"
        >
          <DeskHeatmapBlock />
        </OperationalPanel>

        <OperationalPanel
          expanded={expandedPanels.productivity}
          id="productivity"
          onToggle={togglePanel}
          summary="Gustavo 48 contatos • Cinthia 38 contatos • R$ 69,6 mil"
          title="Produtividade"
          tone="neutral"
        >
          <OperatorsBlock />
        </OperationalPanel>

        <OperationalPanel
          expanded={expandedPanels.ai}
          id="ai"
          onToggle={togglePanel}
          summary="Risco de atraso 18% • redistribuir 4 tickets"
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
    <button
      type="button"
      onClick={onClick}
      title={helper}
      className="group rounded-xl border border-slate-200/70 bg-white p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#A07C3B]/20 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)]"
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
        title={summary}
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
          <p className="mt-1 line-clamp-1 text-xs text-slate-500">{summary}</p>
        </div>
        <span
          title={expanded ? "Recolher painel" : "Expandir painel"}
          aria-label={expanded ? "Recolher painel" : "Expandir painel"}
          className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-600"
        >
          <ChevronDown className={`size-4 text-[#A07C3B] transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
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
    <DetailSection title="Desk operacional" icon={Headphones} accent>
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
    <DetailSection title="Heatmap operacional do Desk" icon={Flame} accent className="h-full">
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
              {value}%
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
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Cinthia Cruz concentra carga alta, SLA crítico, demora média acima de 15 minutos e mensagens sem resposta.
          </p>
        </article>
        <article className="rounded-xl border border-rose-100 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-800">Risco previsto</p>
          <p className="mt-2 text-sm leading-6 text-rose-700">
            Risco de atraso operacional em 18% dos tickets ativos se a fila permanecer sem redistribuição.
          </p>
        </article>
        <article className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
          <p className="text-sm font-semibold text-slate-950">Recomendação</p>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Redistribuir 4 tickets para Mariana Lima e priorizar protocolos com primeira resposta pendente.
          </p>
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
              <StatusBadge status={plan.name === "Gustavo Freitas" ? "Online" : "Ausente"} />
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
              <span className="text-sm font-semibold text-slate-950">{value}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#A07C3B]/70" style={{ width: `${value}%` }} />
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
  }[status];

  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${className}`}>{status}</span>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const className = {
    Alta: "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
    Crítica: "bg-rose-50 text-rose-700 ring-rose-100",
    Média: "bg-slate-50 text-slate-700 ring-slate-200",
  }[priority];

  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${className}`}>{priority}</span>;
}

function PromiseBadge({ status }: { status: string }) {
  const className = {
    Cumprida: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    Pendente: "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
    Vencida: "bg-rose-50 text-rose-700 ring-rose-100",
  }[status];

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
