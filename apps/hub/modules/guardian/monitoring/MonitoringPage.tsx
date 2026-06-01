"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Headphones,
  Hourglass,
  LineChart,
  MessageCircle,
  Radio,
  ShieldAlert,
  Target,
  Users,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { workflowStages } from "@/modules/guardian/attendance/workflow";
import type {
  AttendancePriority,
  QueueClient,
  WorkflowStage,
} from "@/modules/guardian/attendance/types";

type Tone = "danger" | "gold" | "neutral" | "success";
type KpiId =
  | "activeOperators"
  | "todayContacts"
  | "stoppedQueue"
  | "todayPromises"
  | "pendingDeals"
  | "slaRisk";

type IrisTicketSnapshot = {
  assignedToUserId: string | null;
  closedAt: string | null;
  firstResponseDueAt: string | null;
  firstRespondedAt: string | null;
  id: string;
  openedAt: string | null;
  priority: string | null;
  protocol: string | null;
  queueId: string | null;
  resolutionDueAt: string | null;
  resolvedAt: string | null;
  status: string | null;
  subject: string | null;
  updatedAt: string | null;
};

type MonitoringSnapshot = {
  hadesError: string | null;
  irisError: string | null;
  irisTickets: IrisTicketSnapshot[];
  queueClients: QueueClient[];
};

const EMPTY_FIELD = "-";
const HADES_QUEUE_LIMIT = 600;

const kpiDefinitions: Array<{
  id: KpiId;
  label: string;
  icon: LucideIcon;
  tone: Exclude<Tone, "success">;
}> = [
  { id: "activeOperators", label: "Operadores ativos", icon: Users, tone: "gold" },
  { id: "todayContacts", label: "Contatos hoje", icon: Headphones, tone: "neutral" },
  { id: "stoppedQueue", label: "Fila parada", icon: Hourglass, tone: "danger" },
  { id: "todayPromises", label: "Promessas para hoje", icon: CheckCircle2, tone: "gold" },
  { id: "pendingDeals", label: "Acordos pendentes", icon: Clock3, tone: "neutral" },
  { id: "slaRisk", label: "SLA em risco", icon: ShieldAlert, tone: "danger" },
];

export function MonitoringPage() {
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot>({
    hadesError: null,
    irisError: null,
    irisTickets: [],
    queueClients: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadMonitoring() {
      setLoading(true);

      const [hadesResult, irisResult] = await Promise.all([
        loadHadesQueueSnapshot(),
        loadIrisBillingSnapshot(),
      ]);

      if (!active) {
        return;
      }

      setSnapshot({
        hadesError: hadesResult.error,
        irisError: irisResult.error,
        irisTickets: irisResult.tickets,
        queueClients: hadesResult.clients,
      });
      setLoading(false);
    }

    void loadMonitoring();

    return () => {
      active = false;
    };
  }, []);

  const metrics = useMemo(() => buildMonitoringMetrics(snapshot), [snapshot]);
  const kpis = kpiDefinitions.map((definition) => ({
    ...definition,
    helper: metrics.kpiHelpers[definition.id],
    value: metrics.kpis[definition.id],
  }));

  return (
    <div className="flex min-h-[calc(100vh-7rem)] w-full flex-col gap-5">
      <section className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold text-slate-950">
                Monitoramento Hades
              </h1>
              <StatusPill
                label={loading ? "Atualizando" : "Tempo real operacional"}
                tone={loading ? "gold" : "success"}
              />
            </div>
            <p className="mt-1 text-xs font-medium text-slate-500">
              Indicadores de cobrança, fila diária e board Iris filtrado em cobrança.
            </p>
          </div>
          <div className="grid gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-2 lg:w-[420px]">
            <SourceState label="Hades/C2X" value={snapshot.hadesError} />
            <SourceState label="Iris cobrança" value={snapshot.irisError} />
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((item) => (
          <MonitoringKpi key={item.id} {...item} />
        ))}
      </section>

      <section className="grid gap-5 2xl:grid-cols-[1.25fr_0.75fr]">
        <Panel
          icon={LineChart}
          summary={`${formatCount(metrics.queueClients)} clientes no recorte carregado | ${formatCount(metrics.dailyClients.length)} na fila diária`}
          title="Fila diária e estágios"
        >
          <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <DailyQueueBlock clients={metrics.dailySample} />
            <StageDistribution stages={metrics.stageCounts} />
          </div>
        </Panel>

        <Panel
          icon={Target}
          summary="Recorte por perfil operacional definido para OP1, OP2, OP3 e jurídico."
          title="Responsabilidade por perfil"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {metrics.profileBuckets.map((bucket) => (
              <ProfileBucket key={bucket.label} {...bucket} />
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
        <Panel
          icon={MessageCircle}
          summary={`${formatCount(metrics.irisOpenTickets)} tickets abertos de cobrança | ${formatCount(metrics.irisWaitingOperator)} aguardando operador`}
          title="Iris cobrança"
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricTile
              icon={Headphones}
              label="Tickets abertos"
              tone="gold"
              value={formatCount(metrics.irisOpenTickets)}
            />
            <MetricTile
              icon={ShieldAlert}
              label="SLA crítico"
              tone={metrics.irisSlaCritical > 0 ? "danger" : "neutral"}
              value={formatCount(metrics.irisSlaCritical)}
            />
            <MetricTile
              icon={Users}
              label="Aguardando operador"
              tone={metrics.irisWaitingOperator > 0 ? "danger" : "neutral"}
              value={formatCount(metrics.irisWaitingOperator)}
            />
            <MetricTile
              icon={CheckCircle2}
              label="Encerrados hoje"
              tone="neutral"
              value={formatCount(metrics.irisClosedToday)}
            />
            <MetricTile
              icon={Clock3}
              label="TPR"
              tone="gold"
              value={metrics.firstResponseLabel}
            />
            <MetricTile
              icon={Radio}
              label="TMA"
              tone="gold"
              value={metrics.averageHandlingLabel}
            />
          </div>
        </Panel>

        <Panel
          icon={AlertTriangle}
          summary="Clientes em promessa ou acordo ficam fora da fila diária até quebra; quebras retornam para acionamento."
          title="Pontos de atenção"
        >
          <div className="grid gap-3">
            {metrics.alerts.map((alert) => (
              <article
                key={alert.title}
                className={`rounded-xl border p-3 ${
                  alert.tone === "danger"
                    ? "border-rose-100 bg-rose-50"
                    : "border-[#A07C3B]/15 bg-[#A07C3B]/5"
                }`}
              >
                <p className="text-sm font-semibold text-slate-950">{alert.title}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {alert.description}
                </p>
              </article>
            ))}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function MonitoringKpi({
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
    <Tooltip content={helper} placement="bottom" className="w-full" triggerClassName="w-full">
      <article className="w-full rounded-xl border border-slate-200/70 bg-white p-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
              {label}
            </p>
            <p className="mt-2 text-xl font-semibold tracking-normal text-slate-950">
              {value}
            </p>
            <p className="mt-1 line-clamp-1 text-xs text-slate-500">{helper}</p>
          </div>
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ${toneClass}`}>
            <Icon className="size-4" aria-hidden="true" />
          </div>
        </div>
      </article>
    </Tooltip>
  );
}

function Panel({
  children,
  icon: Icon,
  summary,
  title,
}: {
  children: ReactNode;
  icon: LucideIcon;
  summary: string;
  title: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#A07C3B]/5 text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
            <Icon className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
            <p className="mt-1 truncate text-xs text-slate-500">{summary}</p>
          </div>
        </div>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function DailyQueueBlock({ clients }: { clients: QueueClient[] }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-950">Fila diária</p>
        <StatusPill label="Contato diário" tone="gold" />
      </div>
      <div className="space-y-2">
        {clients.length ? (
          clients.map((client) => (
            <article
              key={client.id}
              className="grid gap-3 rounded-xl border border-slate-200/70 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-slate-950">
                    {client.nome}
                  </p>
                  <PriorityBadge priority={client.prioridade} />
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {client.carteira.empreendimento} | {client.atrasoDias} dias
                </p>
              </div>
              <StatusPill label={client.workflow.stage} tone={stageTone(client.workflow.stage)} />
            </article>
          ))
        ) : (
          <EmptyState label="Sem clientes elegíveis na fila diária." />
        )}
      </div>
    </div>
  );
}

function StageDistribution({
  stages,
}: {
  stages: Array<{ count: number; stage: WorkflowStage }>;
}) {
  const total = Math.max(
    stages.reduce((sum, item) => sum + item.count, 0),
    1,
  );

  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
      <p className="text-sm font-semibold text-slate-950">Estágios da cobrança</p>
      <div className="mt-3 grid gap-2">
        {stages.map((item) => (
          <div key={item.stage}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-slate-700">{item.stage}</span>
              <span className="text-slate-500">{formatCount(item.count)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-slate-200/70">
              <div
                className="h-full rounded-full bg-[#A07C3B]"
                style={{ width: `${Math.round((item.count / total) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileBucket({
  label,
  helper,
  value,
}: {
  helper: string;
  label: string;
  value: number;
}) {
  return (
    <article className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-xl font-semibold text-slate-950">
        {formatCount(value)}
      </p>
      <p className="mt-1 text-xs text-slate-500">{helper}</p>
    </article>
  );
}

function MetricTile({
  icon: Icon,
  label,
  tone,
  value,
}: {
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
    <article className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
            {label}
          </p>
          <p className="mt-2 text-lg font-semibold text-slate-950">{value}</p>
        </div>
        <div className={`grid size-8 place-items-center rounded-lg ring-1 ${toneClass}`}>
          <Icon className="size-4" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}

function SourceState({ label, value }: { label: string; value: string | null }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        value
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-emerald-100 bg-emerald-50 text-emerald-700"
      }`}
    >
      <span>{label}: </span>
      <span>{value ? "atenção" : "online"}</span>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  const toneClass = {
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
    gold: "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15",
    neutral: "bg-slate-50 text-slate-600 ring-slate-200/70",
    success: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  }[tone];

  return (
    <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${toneClass}`}>
      {label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: AttendancePriority }) {
  const tone =
    priority === "Crítica" ? "danger" : priority === "Alta" ? "gold" : "neutral";

  return <StatusPill label={priority} tone={tone} />;
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm font-medium text-slate-500">
      {label}
    </div>
  );
}

async function loadHadesQueueSnapshot() {
  try {
    const token = await getHadesAccessToken();
    const response = await fetch(
      `/api/hades/attendance/queue?limit=${HADES_QUEUE_LIMIT}`,
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | { clients?: QueueClient[]; error?: string }
      | null;

    if (!response.ok || !payload?.clients) {
      throw new Error(payload?.error ?? "Nao foi possivel carregar a fila Hades.");
    }

    return { clients: payload.clients, error: null };
  } catch (error) {
    return {
      clients: [],
      error:
        error instanceof Error
          ? error.message
          : "Nao foi possivel carregar a fila Hades.",
    };
  }
}

async function loadIrisBillingSnapshot() {
  try {
    const supabase = getHubSupabaseClient();

    if (!supabase) {
      throw new Error("Supabase indisponivel para a Iris.");
    }

    const queuesResult = await supabase
      .from("caredesk_queues")
      .select("id,name,slug,status")
      .eq("status", "active");

    if (queuesResult.error) {
      throw queuesResult.error;
    }

    const billingQueueIds = (queuesResult.data ?? [])
      .filter((queue) => normalizeText(`${queue.name} ${queue.slug}`).includes("cobranca"))
      .map((queue) => queue.id);

    if (!billingQueueIds.length) {
      return { error: null, tickets: [] };
    }

    const ticketsResult = await supabase
      .from("caredesk_tickets")
      .select(
        "id,protocol,queue_id,status,priority,subject,assigned_to_user_id,opened_at,first_response_due_at,resolution_due_at,first_responded_at,resolved_at,closed_at,updated_at",
      )
      .in("queue_id", billingQueueIds)
      .order("opened_at", { ascending: false })
      .limit(200);

    if (ticketsResult.error) {
      throw ticketsResult.error;
    }

    const tickets = (ticketsResult.data ?? []).map((ticket) => ({
      assignedToUserId: ticket.assigned_to_user_id ?? null,
      closedAt: ticket.closed_at ?? null,
      firstResponseDueAt: ticket.first_response_due_at ?? null,
      firstRespondedAt: ticket.first_responded_at ?? null,
      id: ticket.id,
      openedAt: ticket.opened_at ?? null,
      priority: ticket.priority ?? null,
      protocol: ticket.protocol ?? null,
      queueId: ticket.queue_id ?? null,
      resolutionDueAt: ticket.resolution_due_at ?? null,
      resolvedAt: ticket.resolved_at ?? null,
      status: ticket.status ?? null,
      subject: ticket.subject ?? null,
      updatedAt: ticket.updated_at ?? null,
    }));

    return { error: null, tickets };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Nao foi possivel carregar o board Iris.",
      tickets: [],
    };
  }
}

async function getHadesAccessToken() {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao do Supabase indisponivel.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa ausente.");
  }

  return accessToken;
}

function buildMonitoringMetrics(snapshot: MonitoringSnapshot) {
  const queueClients = snapshot.queueClients;
  const dailyClients = queueClients.filter(isDailyQueueClient);
  const irisOpenTickets = snapshot.irisTickets.filter((ticket) => !isClosedTicket(ticket));
  const irisSlaCritical = irisOpenTickets.filter(isIrisSlaCritical).length;
  const irisWaitingOperator = irisOpenTickets.filter(
    (ticket) => !ticket.assignedToUserId,
  ).length;
  const irisClosedToday = snapshot.irisTickets.filter((ticket) =>
    isTodayDate(ticket.closedAt ?? ticket.resolvedAt),
  ).length;
  const activeOperators = new Set(
    [
      ...queueClients.map((client) => client.responsavel).filter(Boolean),
      ...snapshot.irisTickets.map((ticket) => ticket.assignedToUserId).filter(Boolean),
    ].filter((value) => value !== EMPTY_FIELD),
  );
  const todayPromises = queueClients.flatMap((client) => client.commitments ?? []).filter(
    (commitment) =>
      commitment.type === "Promessa de pagamento" &&
      isTodayDate(commitment.promisedDate),
  );
  const pendingDeals = queueClients.filter((client) =>
    ["Acordo", "Formalizando", "Ativo"].includes(
      String(client.workflow.stage === "Acordo" ? "Acordo" : client.agreement?.status ?? ""),
    ),
  );
  const stoppedQueue = dailyClients.filter(
    (client) => client.workflow.stage === "A acionar" || client.workflow.stage === "Contato",
  );
  const todayContacts = snapshot.irisTickets.filter((ticket) =>
    isTodayDate(ticket.updatedAt ?? ticket.openedAt),
  ).length;
  const profileBuckets = [
    {
      helper: "1 a 30 dias de inadimplencia",
      label: "OP1",
      value: queueClients.filter((client) => client.atrasoDias >= 1 && client.atrasoDias <= 30).length,
    },
    {
      helper: "31 a 60 dias de inadimplencia",
      label: "OP2",
      value: queueClients.filter((client) => client.atrasoDias >= 31 && client.atrasoDias <= 60).length,
    },
    {
      helper: "61 a 90 dias de inadimplencia",
      label: "OP3",
      value: queueClients.filter((client) => client.atrasoDias >= 61 && client.atrasoDias <= 90).length,
    },
    {
      helper: "Acima de 90 dias",
      label: "Jurídico",
      value: queueClients.filter((client) => client.atrasoDias >= 91).length,
    },
  ];
  const stageCounts = workflowStages.map((stage) => ({
    count: queueClients.filter((client) => client.workflow.stage === stage).length,
    stage,
  }));
  const slaRisk = irisSlaCritical + queueClients.filter((client) => client.prioridade === "Crítica").length;

  return {
    alerts: [
      {
        description:
          stoppedQueue.length > 0
            ? `${formatCount(stoppedQueue.length)} clientes seguem em contato diário sem compromisso ativo.`
            : "Sem fila parada identificada no recorte carregado.",
        title: "Fila diária",
        tone: stoppedQueue.length > 0 ? "danger" : "gold",
      },
      {
        description:
          pendingDeals.length > 0
            ? `${formatCount(pendingDeals.length)} clientes estão fora da fila diária por acordo/promessa ativa.`
            : "Nenhum acordo ativo encontrado no recorte carregado.",
        title: "Promessas e acordos",
        tone: "gold",
      },
    ],
    averageHandlingLabel: EMPTY_FIELD,
    dailyClients,
    dailySample: dailyClients.slice(0, 8),
    firstResponseLabel: EMPTY_FIELD,
    irisClosedToday,
    irisOpenTickets: irisOpenTickets.length,
    irisSlaCritical,
    irisWaitingOperator,
    kpiHelpers: {
      activeOperators: activeOperators.size
        ? "Responsaveis Hades e operadores Iris com tickets de cobrança."
        : "Aguardando operador vinculado nos dados reais.",
      pendingDeals: "Clientes com acordo ou formalização ativa.",
      slaRisk: "Soma de tickets Iris com SLA vencido e contratos críticos Hades.",
      stoppedQueue: "Clientes elegíveis para contato diário sem promessa/acordo ativo.",
      todayContacts: "Tickets Iris de cobrança movimentados hoje.",
      todayPromises: "Compromissos de pagamento com data de hoje.",
    },
    kpis: {
      activeOperators: activeOperators.size ? formatCount(activeOperators.size) : EMPTY_FIELD,
      pendingDeals: formatCount(pendingDeals.length),
      slaRisk: formatCount(slaRisk),
      stoppedQueue: formatCount(stoppedQueue.length),
      todayContacts: formatCount(todayContacts),
      todayPromises: formatCount(todayPromises.length),
    },
    profileBuckets,
    queueClients: queueClients.length,
    stageCounts,
  };
}

function isDailyQueueClient(client: QueueClient) {
  if (client.atrasoDias < 3) {
    return false;
  }

  return (
    client.workflow.stage !== "Promessa de pagamento" &&
    client.workflow.stage !== "Promessa realizada" &&
    client.workflow.stage !== "Aguardando pagamento" &&
    client.workflow.stage !== "Acordo" &&
    client.workflow.stage !== "Pago"
  );
}

function isIrisSlaCritical(ticket: IrisTicketSnapshot) {
  if (isClosedTicket(ticket)) {
    return false;
  }

  const dueAt = ticket.firstRespondedAt
    ? ticket.resolutionDueAt
    : ticket.firstResponseDueAt ?? ticket.resolutionDueAt;

  if (!dueAt) {
    return false;
  }

  return new Date(dueAt).getTime() <= Date.now();
}

function isClosedTicket(ticket: IrisTicketSnapshot) {
  return Boolean(ticket.closedAt || ticket.resolvedAt) || ticket.status === "closed";
}

function stageTone(stage: WorkflowStage): Tone {
  if (stage === "Quebra" || stage === "Jurídico") {
    return "danger";
  }

  if (stage === "Promessa de pagamento" || stage === "Acordo") {
    return "success";
  }

  if (stage === "Negociação") {
    return "gold";
  }

  return "neutral";
}

function isTodayDate(value?: string | null) {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return false;
  }

  const today = new Date();

  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

function formatCount(value: number) {
  return value.toLocaleString("pt-BR");
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}
