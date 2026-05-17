"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Building2,
  ChevronDown,
  CircleDollarSign,
  Filter,
  Percent,
  TrendingUp,
  Users,
  X,
} from "lucide-react";

import { KpiCard } from "@/components/guardian/dashboard/KpiCard";
import { MainLayout } from "@/components/guardian/layout/MainLayout";
import type {
  GuardianDistributionBucket,
  GuardianEnterprisePerformance,
} from "@/lib/guardian/overview";
import { getGuardianOverviewSnapshot } from "@/lib/guardian/overview-client";
import { guardianMockClients } from "@/modules/guardian/guardianMockData";

type DashboardKpiId =
  | "totalPortfolio"
  | "delinquency"
  | "overdueAmount"
  | "monthlyRecovery"
  | "overdueClients"
  | "criticalContracts";

type DashboardPanelId = "financial" | "desk" | "workflow" | "ai" | "operators";

type RealGuardianKpis = {
  billingComposition: GuardianDistributionBucket[];
  criticalContracts: number;
  enterprisePerformance: GuardianEnterprisePerformance[];
  liquidatedAmount: number;
  liquidatedPayments: number;
  monthlyRecoveryAmount: number;
  monthlyRecoveryPayments: number;
  overdueClients: number;
  overdueAging: GuardianDistributionBucket[];
  overduePrincipalAmount: number;
  overduePrincipalPayments: number;
  totalPortfolioAmount: number;
  totalPortfolioPayments: number;
};

type ContractRecord = {
  cliente: string;
  empreendimento: string;
  unidadeLote: string;
  perfil: string;
  status: string;
  vencimento: string;
  carteira: number;
  atraso: number;
  atrasoDias: number;
  score: number;
  risco: string;
  responsavel: string;
  filaStatus: string;
  recuperado: number;
};

type EnterprisePerformanceItem = {
  delinquencyBaseAmount: number;
  enterpriseName: string;
  monthlyRecoveryAmount: number;
  monthlyRecoveryPayments: number;
  overdueClients: number;
  overduePrincipalAmount: number;
  overduePrincipalPayments: number;
  totalPortfolioAmount: number;
  totalPortfolioPayments: number;
};

type EnterprisePerformanceSortKey =
  | "enterpriseName"
  | "totalPortfolioAmount"
  | "overduePrincipalAmount"
  | "overduePrincipalPayments"
  | "overdueClients"
  | "monthlyRecoveryAmount"
  | "delinquencyRate"
  | "recoveryRate";

const REAL_KPIS_CACHE_KEY = "guardian:overview:real-kpis:v1";

const contracts: ContractRecord[] = guardianMockClients.map((client) => ({
  cliente: client.nome,
  empreendimento: client.empreendimento,
  unidadeLote: client.unidadeLote,
  perfil: client.perfilParcela,
  status: client.parcelasVencidas > 0 ? "Vencidas" : client.parcelasAVencer > 0 ? "A vencer" : "Liquidadas",
  vencimento: client.vencimento,
  carteira: client.valorUnidade + (client.segundaUnidade?.valorUnidade ?? 0),
  atraso: client.saldoAtraso,
  atrasoDias: client.atrasoDias,
  score: client.scoreRisco,
  risco: client.prioridade,
  responsavel: client.responsavel,
  filaStatus: client.status,
  recuperado: client.recuperado,
}));

const profileOptions = ["Todos", "Ato", "Sinal", "Parcela"];
const statusOptions = ["Todos", "Vencidas", "A vencer", "Liquidadas"];

function readCachedRealKpis() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const cached = window.sessionStorage.getItem(REAL_KPIS_CACHE_KEY);

    if (!cached) {
      return null;
    }

    const parsed = JSON.parse(cached) as RealGuardianKpis;
    return typeof parsed.totalPortfolioAmount === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedRealKpis(kpis: RealGuardianKpis) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(REAL_KPIS_CACHE_KEY, JSON.stringify(kpis));
  } catch {
    // Cache is only a UX fallback; failing to persist it should not block the dashboard.
  }
}

export default function GuardianPage() {
  const [enterprise, setEnterprise] = useState("Todos");
  const [profile, setProfile] = useState("Todos");
  const [status, setStatus] = useState("Todos");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [selectedKpi, setSelectedKpi] = useState<DashboardKpiId | null>(null);
  const [realKpis, setRealKpis] = useState<RealGuardianKpis | null>(null);
  const [realKpisError, setRealKpisError] = useState<string | null>(null);
  const [expandedPanels, setExpandedPanels] = useState<Record<DashboardPanelId, boolean>>({
    financial: true,
    desk: true,
    workflow: false,
    ai: true,
    operators: false,
  });

  useEffect(() => {
    let isMounted = true;
    const cachedKpis = readCachedRealKpis();

    if (cachedKpis) {
      setRealKpis(cachedKpis);
    }

    async function refreshRealKpis() {
      try {
        const snapshot = await getGuardianOverviewSnapshot();

        if (!isMounted) {
          return;
        }

        const nextKpis = {
          billingComposition: snapshot.billingComposition ?? [],
          criticalContracts: snapshot.summary.criticalContracts,
          enterprisePerformance: snapshot.enterprisePerformance,
          liquidatedAmount: snapshot.summary.liquidatedAmount,
          liquidatedPayments: snapshot.summary.liquidatedPayments,
          monthlyRecoveryAmount: snapshot.summary.monthlyRecoveryAmount,
          monthlyRecoveryPayments: snapshot.summary.monthlyRecoveryPayments,
          overdueClients: snapshot.summary.overdueClients,
          overdueAging: snapshot.overdueAging ?? [],
          overduePrincipalAmount: snapshot.summary.overduePrincipalAmount,
          overduePrincipalPayments: snapshot.summary.overduePrincipalPayments,
          totalPortfolioAmount: snapshot.summary.totalPortfolioAmount,
          totalPortfolioPayments: snapshot.summary.totalPortfolioPayments,
        };

        setRealKpis(nextKpis);
        writeCachedRealKpis(nextKpis);
        setRealKpisError(null);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setRealKpisError(error instanceof Error ? error.message : "Nao foi possivel carregar os dados reais.");
      }
    }

    void refreshRealKpis();
    const intervalId = window.setInterval(() => {
      void refreshRealKpis();
    }, 30000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const filtered = useMemo(
    () =>
      contracts.filter((item) => {
        const time = new Date(item.vencimento).getTime();

        return (
          (enterprise === "Todos" || item.empreendimento === enterprise) &&
          (profile === "Todos" || item.perfil === profile) &&
          (status === "Todos" || item.status === status) &&
          (!dateStart || time >= new Date(dateStart).getTime()) &&
          (!dateEnd || time <= new Date(dateEnd).getTime())
        );
      }),
    [dateEnd, dateStart, enterprise, profile, status],
  );

  const criticos = filtered.filter((item) => item.risco === "Crítica");

  const realTotalCarteira = realKpis?.totalPortfolioAmount ?? null;
  const realTotalAtraso = realKpis?.overduePrincipalAmount ?? null;
  const realBaseInadimplencia =
    realKpis ? realKpis.liquidatedAmount + realKpis.overduePrincipalAmount : null;
  const realDataDescription = realKpisError
    ? "falha ao carregar dados reais"
    : realKpis
      ? "dados reais"
      : "carregando dados reais";
  const financialEnterpriseRows =
    realKpis?.enterprisePerformance ?? [];
  const overdueAgingRows = realKpis?.overdueAging ?? [];
  const billingCompositionRows = realKpis?.billingComposition ?? [];
  const financialEnterpriseOptions = useMemo(
    () => [
      "Todos",
      ...Array.from(
        new Set(realKpis?.enterprisePerformance.map((item) => item.enterpriseName) ?? []),
      ),
    ],
    [realKpis],
  );
  const financialSummary = realKpis
    ? `${money(realKpis.overduePrincipalAmount)} em atraso | ${money(
        realKpis.monthlyRecoveryAmount,
      )} recuperado no mes | ${pct(
        realKpis.monthlyRecoveryAmount,
        realKpis.monthlyRecoveryAmount + realKpis.overduePrincipalAmount,
      )} recuperacao`
    : "R$ -- em atraso | R$ -- recuperado no mes | -- recuperacao";

  const kpis = [
    {
      id: "totalPortfolio" as const,
      title: "Carteira total",
      value: realTotalCarteira === null ? "..." : money(realTotalCarteira),
      variation: realKpis ? formatCount(realKpis.totalPortfolioPayments) : "--",
      description: realKpis ? "parcelas na carteira" : realDataDescription,
      icon: Banknote,
    },
    {
      id: "delinquency" as const,
      title: "Inadimplência",
      value: realBaseInadimplencia === null || realTotalAtraso === null ? "..." : pct(realTotalAtraso, realBaseInadimplencia, 2),
      variation: realKpis ? "vencidas" : "--",
      description: realKpis ? "sobre vencidas + liquidadas" : realDataDescription,
      icon: Percent,
    },
    {
      id: "overdueAmount" as const,
      title: "Valor em atraso",
      value: realTotalAtraso === null ? "..." : money(realTotalAtraso),
      variation: realKpis ? formatCount(realKpis.overduePrincipalPayments) : "--",
      description: realKpis ? "parcelas vencidas" : realDataDescription,
      icon: CircleDollarSign,
    },
    {
      id: "monthlyRecovery" as const,
      title: "Recuperação mensal",
      value: realKpis ? money(realKpis.monthlyRecoveryAmount) : "...",
      variation: realKpis ? formatCount(realKpis.monthlyRecoveryPayments) : "--",
      description: realKpis ? "pagas apos 10 dias" : realDataDescription,
      icon: TrendingUp,
    },
    {
      id: "overdueClients" as const,
      title: "Clientes em atraso",
      value: realKpis ? formatCount(realKpis.overdueClients) : "...",
      variation: realKpis ? "clientes" : "--",
      description: realKpis ? "clientes distintos" : realDataDescription,
      icon: Users,
    },
    {
      id: "criticalContracts" as const,
      title: "Contratos críticos",
      value: realKpis ? formatCount(realKpis.criticalContracts) : "...",
      variation: realKpis ? "> 3 parcelas" : "--",
      description: realKpis ? "contratos em atraso" : realDataDescription,
      icon: AlertTriangle,
    },
  ];

  const selectedKpiMeta = selectedKpi ? kpis.find((item) => item.id === selectedKpi) : null;
  const drawerItems = selectedKpi ? buildKpiDrawerItems(selectedKpi, filtered) : [];

  function togglePanel(panel: DashboardPanelId) {
    setExpandedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }

  return (
    <MainLayout>
      <div className="flex w-full flex-col gap-6">
        <GlobalFilters
          dateEnd={dateEnd}
          dateStart={dateStart}
          enterprise={enterprise}
          enterpriseOptions={financialEnterpriseOptions}
          profile={profile}
          setDateEnd={setDateEnd}
          setDateStart={setDateStart}
          setEnterprise={setEnterprise}
          setProfile={setProfile}
          setStatus={setStatus}
          status={status}
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.id} {...kpi} onClick={() => setSelectedKpi(kpi.id)} />
          ))}
        </section>

        <DashboardPanel
          badge={realKpis ? "C2X" : "Aguardando C2X"}
          expanded={expandedPanels.financial}
          id="financial"
          onToggle={togglePanel}
          summary={financialSummary}
          title="Financeiro"
          tone="gold"
        >
          <section className="grid gap-4 2xl:grid-cols-[1.4fr_0.6fr]">
            <EnterprisePerformanceTable
              data={financialEnterpriseRows}
              error={realKpisError}
              selected={enterprise}
              onSelect={setEnterprise}
            />
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-1">
              <DistributionCard title="Aging da inadimplência" data={overdueAgingRows} />
              <DistributionCard title="Composição da cobrança" data={billingCompositionRows} />
            </div>
          </section>
        </DashboardPanel>

        <DashboardPanel
          badge="4 críticos"
          expanded={expandedPanels.desk}
          id="desk"
          onToggle={togglePanel}
          summary="42 tickets | SLA crítico 4 | TMR 4m18s | 11 sem resposta"
          title="CareDesk"
          tone="danger"
        >
          <ActionMetricGrid
            metrics={[
              ["Tickets abertos", "42", "Abrir CareDesk", "gold"],
              ["SLA crítico", "4", "Ver críticos", "danger"],
              ["Tempo médio resposta", "4m18s", "Monitorar SLA", "neutral"],
              ["Mensagens sem resposta", "11", "Abrir fila", "danger"],
              ["Operadores online", "5", "Ver operadores", "gold"],
              ["Aguardando operador", "6", "Distribuir", "danger"],
              ["Tickets prioritários", "14", "Priorizar", "gold"],
              ["Encerrados hoje", "23", "Ver produtividade", "neutral"],
            ]}
          />
        </DashboardPanel>

        <DashboardPanel
          expanded={expandedPanels.workflow}
          id="workflow"
          onToggle={togglePanel}
          summary="31 follow-ups vencendo | 8 clientes críticos | risco operacional elevado"
          title="Workflow"
          tone="danger"
        >
          <ActionMetricGrid
            metrics={[
              ["Workflow operacional", "76%", "Ver etapas", "neutral"],
              ["Clientes críticos", String(criticos.length), "Abrir fila", "danger"],
              ["Follow-ups vencendo", "31", "Priorizar", "gold"],
              ["Promessas hoje", "18", "Abrir promessas", "gold"],
              ["Risco operacional", "Alto", "Ver diagnóstico", "danger"],
              ["Tickets prioritários", "14", "Abrir CareDesk", "danger"],
            ]}
          />
        </DashboardPanel>

        <DashboardPanel
          expanded={expandedPanels.ai}
          id="ai"
          onToggle={togglePanel}
          summary="Previsão atraso 18% | quebra 12% | evasão 7% | redistribuir 4 tickets"
          title="IA operacional"
          tone="gold"
        >
          <ExecutiveAiBlock />
        </DashboardPanel>

        <DashboardPanel
          expanded={expandedPanels.operators}
          id="operators"
          onToggle={togglePanel}
          summary="5 online | 18 tickets em atendimento | Gustavo lidera recuperação"
          title="Operadores"
          tone="neutral"
        >
          <ActionMetricGrid
            metrics={[
              ["Operadores online", "5", "Ver escala", "gold"],
              ["Em atendimento", "18", "Abrir CareDesk", "neutral"],
              ["Sobrecarregados", "1", "Redistribuir", "danger"],
              ["Produtividade", "+12%", "Ver ranking", "gold"],
            ]}
          />
        </DashboardPanel>
      </div>

      {selectedKpiMeta ? (
        <DashboardKpiDrawer
          items={drawerItems}
          onClose={() => setSelectedKpi(null)}
          title={selectedKpiMeta.title}
        />
      ) : null}
    </MainLayout>
  );
}

function DashboardPanel({
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
  id: DashboardPanelId;
  onToggle: (id: DashboardPanelId) => void;
  summary: string;
  title: string;
  tone?: "danger" | "gold" | "neutral";
}) {
  const badgeClass = {
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
    gold: "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15",
    neutral: "bg-slate-50 text-slate-600 ring-slate-200",
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
            {badge ? <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${badgeClass}`}>{badge}</span> : null}
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">{summary}</p>
        </div>
        <span
          title={expanded ? "Recolher painel" : "Expandir painel"}
          aria-label={expanded ? "Recolher painel" : "Expandir painel"}
          className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-600"
        >
          <ChevronDown className={`size-4 text-[#A07C3B] transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </span>
      </button>
      <div className={`grid transition-all duration-300 ease-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-slate-100 p-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

function ActionMetricGrid({ metrics }: { metrics: Array<[string, string, string, "danger" | "gold" | "neutral"]> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(([label, value, action, tone]) => (
        <button
          key={`${label}-${value}`}
          type="button"
          title={action}
          className="group rounded-xl border border-slate-200/70 bg-slate-50/50 p-3 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">{label}</p>
            <ArrowUpRight className="size-3.5 text-[#A07C3B] opacity-70 transition-opacity group-hover:opacity-100" aria-hidden="true" />
          </div>
          <p className={`mt-1.5 text-xl font-semibold ${tone === "danger" ? "text-rose-700" : tone === "gold" ? "text-[#7A5E2C]" : "text-slate-950"}`}>
            {value}
          </p>
        </button>
      ))}
    </div>
  );
}

function ExecutiveAiBlock() {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <InsightCard
        title="Gargalo"
        value="CareDesk em atenção"
        text="SLA crítico concentrado em tickets sem primeira resposta e operador sobrecarregado."
        tone="danger"
      />
      <InsightCard
        title="Previsões"
        value="Atraso 18%"
        text="Quebra prevista em 12% e risco de evasão em 7% nos clientes críticos."
        tone="gold"
      />
      <InsightCard
        title="Recomendação IA"
        value="Redistribuir"
        text="Mover 4 tickets para operadores com menor carga e priorizar promessas vencendo hoje."
        tone="neutral"
      />
    </div>
  );
}

function InsightCard({
  text,
  title,
  tone,
  value,
}: {
  text: string;
  title: string;
  tone: "danger" | "gold" | "neutral";
  value: string;
}) {
  return (
    <article
      title={text}
      className={`rounded-xl border p-3 ${
        tone === "danger"
          ? "border-rose-100 bg-rose-50"
          : tone === "gold"
            ? "border-[#A07C3B]/15 bg-[#A07C3B]/5"
            : "border-slate-200/70 bg-slate-50/60"
      }`}
    >
      <p className="text-sm font-semibold text-slate-950">{title}</p>
      <p className={`mt-1.5 text-lg font-semibold ${tone === "danger" ? "text-rose-700" : tone === "gold" ? "text-[#7A5E2C]" : "text-slate-950"}`}>
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-600">{text}</p>
    </article>
  );
}

function GlobalFilters(props: {
  enterprise: string;
  enterpriseOptions: string[];
  profile: string;
  status: string;
  dateStart: string;
  dateEnd: string;
  setEnterprise: (value: string) => void;
  setProfile: (value: string) => void;
  setStatus: (value: string) => void;
  setDateStart: (value: string) => void;
  setDateEnd: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const activeFilters = [
    props.enterprise !== "Todos" ? { label: "Empreendimento", value: props.enterprise, clear: () => props.setEnterprise("Todos") } : null,
    props.profile !== "Todos" ? { label: "Perfil", value: props.profile, clear: () => props.setProfile("Todos") } : null,
    props.status !== "Todos" ? { label: "Status", value: props.status, clear: () => props.setStatus("Todos") } : null,
    props.dateStart ? { label: "Inicial", value: props.dateStart, clear: () => props.setDateStart("") } : null,
    props.dateEnd ? { label: "Final", value: props.dateEnd, clear: () => props.setDateEnd("") } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; clear: () => void }>;

  function clear() {
    props.setEnterprise("Todos");
    props.setProfile("Todos");
    props.setStatus("Todos");
    props.setDateStart("");
    props.setDateEnd("");
  }

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-[#A07C3B]/5"
          aria-expanded={expanded}
        >
          <Filter className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
          Filtros{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
          <ChevronDown className={`size-3.5 text-[#A07C3B] transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {activeFilters.map((filter) => (
          <button
            key={`${filter.label}-${filter.value}`}
            type="button"
            onClick={filter.clear}
            title={`Remover ${filter.label}`}
            className="inline-flex h-7 max-w-48 items-center gap-1 rounded-full bg-[#A07C3B]/5 px-2 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15"
          >
            <span className="truncate">{filter.value}</span>
            <X className="size-3" aria-hidden="true" />
          </button>
        ))}
        {activeFilters.length > 0 ? (
          <button
            type="button"
            onClick={clear}
            title="Limpar filtros"
            aria-label="Limpar filtros"
            className="flex size-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className={`grid transition-all duration-300 ease-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="grid gap-3 pt-3 md:grid-cols-2 xl:grid-cols-5">
            <Select label="Empreendimento" value={props.enterprise} onChange={props.setEnterprise} options={props.enterpriseOptions} />
            <Select label="Perfil da parcela" value={props.profile} onChange={props.setProfile} options={profileOptions} />
            <Select label="Status" value={props.status} onChange={props.setStatus} options={statusOptions} />
            <Input label="Vencimento inicial" value={props.dateStart} onChange={props.setDateStart} />
            <Input label="Vencimento final" value={props.dateEnd} onChange={props.setDateEnd} />
          </div>
        </div>
      </div>
    </section>
  );
}

function DashboardKpiDrawer({
  items,
  onClose,
  title,
}: {
  items: ReturnType<typeof buildKpiDrawerItems>;
  onClose: () => void;
  title: string;
}) {
  const isOpen = Boolean(title);

  return (
    <div className={`fixed inset-0 z-50 overflow-hidden transition ${isOpen ? "pointer-events-auto" : "pointer-events-none"}`} aria-hidden={!isOpen}>
      <button
        type="button"
        aria-label="Fechar detalhes do KPI"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/20 backdrop-blur-[2px] transition-opacity ${isOpen ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-[860px] flex-col border-l border-slate-200/70 bg-white shadow-[-24px_0_70px_rgba(15,23,42,0.18)] transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-normal text-[#A07C3B]">Detalhamento do indicador</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">{title}</h2>
              <p className="mt-1 text-sm text-slate-500">Detalhamento operacional em preparacao para a base real do C2X.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar painel"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="overflow-x-auto rounded-xl border border-slate-200/70">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50/80 text-xs uppercase tracking-normal text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Empreendimento</th>
                  <th className="px-4 py-3 font-medium">Unidade/lote</th>
                  <th className="px-4 py-3 font-medium">Contrato</th>
                  <th className="px-4 py-3 font-medium">Perfil</th>
                  <th className="px-4 py-3 font-medium">Referência</th>
                  <th className="px-4 py-3 font-medium">Vencimento</th>
                  <th className="px-4 py-3 font-medium">Saldo</th>
                  <th className="px-4 py-3 font-medium">Atraso</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Responsável</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {items.map((item) => (
                  <tr key={`${title}-${item.contrato}`} className="hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-950">{item.cliente}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.empreendimento}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.unidadeLote}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.contrato}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.perfil}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.referencia}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.vencimento}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-950">{item.saldo}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.atraso}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                        {item.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{item.responsavel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {items.length === 0 ? (
            <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 text-sm text-slate-500">
              Nenhum registro encontrado para os filtros atuais.
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function Input({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-9 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
      />
    </label>
  );
}

function EnterprisePerformanceTable({
  data,
  error,
  selected,
  onSelect,
}: {
  data: EnterprisePerformanceItem[];
  error: string | null;
  selected: string;
  onSelect: (value: string) => void;
}) {
  const [sort, setSort] = useState<{
    direction: "asc" | "desc";
    key: EnterprisePerformanceSortKey;
  }>({ direction: "asc", key: "enterpriseName" });
  const sortedData = useMemo(
    () =>
      [...data].sort((first, second) => {
        const result = compareEnterprisePerformance(first, second, sort.key);
        return sort.direction === "asc" ? result : -result;
      }),
    [data, sort.direction, sort.key],
  );

  function sortBy(key: EnterprisePerformanceSortKey) {
    setSort((current) => ({
      direction:
        current.key === key
          ? current.direction === "asc"
            ? "desc"
            : "asc"
          : key === "enterpriseName"
            ? "asc"
            : "desc",
      key,
    }));
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
            <Building2 className="size-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950">Performance por empreendimento</h2>
            <p className="mt-1 text-sm text-slate-500">Clique nos cabeçalhos para ordenar os campos.</p>
          </div>
        </div>
      </div>
      {error ? (
        <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-sm text-amber-800">
          {data.length > 0
            ? "Nao foi possivel atualizar agora. Mantendo o ultimo snapshot real carregado."
            : "Nao foi possivel carregar o consolidado real. Os dados serao exibidos quando o C2X responder."}
        </div>
      ) : null}
      <div className="max-h-[408px] overflow-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-normal text-slate-500">
            <tr>
              <SortableEnterpriseHeader
                activeSort={sort}
                label="Empreendimento"
                sortKey="enterpriseName"
                onSort={sortBy}
              />
              <SortableEnterpriseHeader
                activeSort={sort}
                label="Carteira"
                sortKey="totalPortfolioAmount"
                onSort={sortBy}
              />
              <SortableEnterpriseHeader
                activeSort={sort}
                label="Inadimplência"
                sortKey="delinquencyRate"
                onSort={sortBy}
              />
              <SortableEnterpriseHeader
                activeSort={sort}
                label="Valor em atraso"
                sortKey="overduePrincipalAmount"
                onSort={sortBy}
              />
              <SortableEnterpriseHeader
                activeSort={sort}
                label="Parcelas em atraso"
                sortKey="overduePrincipalPayments"
                onSort={sortBy}
              />
              <SortableEnterpriseHeader
                activeSort={sort}
                label="Clientes em atraso"
                sortKey="overdueClients"
                onSort={sortBy}
              />
              <SortableEnterpriseHeader
                activeSort={sort}
                label="Recuperação mês"
                sortKey="recoveryRate"
                onSort={sortBy}
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedData.length > 0 ? (
              sortedData.map((item) => (
                <tr
                  key={item.enterpriseName}
                  onClick={() => onSelect(item.enterpriseName)}
                  className={`cursor-pointer transition-colors hover:bg-slate-50/60 ${selected === item.enterpriseName ? "bg-[#A07C3B]/5" : ""}`}
                >
                  <td className="whitespace-nowrap px-5 py-3 font-medium text-slate-950">{item.enterpriseName}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{money(item.totalPortfolioAmount)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{pct(item.overduePrincipalAmount, item.delinquencyBaseAmount, 2)}</td>
                  <td className="whitespace-nowrap px-5 py-3 font-medium text-slate-900">{money(item.overduePrincipalAmount)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatCount(item.overduePrincipalPayments)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatCount(item.overdueClients)}</td>
                  <td className="whitespace-nowrap px-5 py-3">
                    <div className="flex flex-col items-center gap-1 text-center">
                      <span className="rounded-full border border-[#A07C3B]/15 bg-[#A07C3B]/5 px-2.5 py-1 text-xs font-medium text-[#7A5E2C]">
                        {pct(item.monthlyRecoveryAmount, item.monthlyRecoveryAmount + item.overduePrincipalAmount)}
                      </span>
                      <span className="text-xs text-slate-500">
                        {money(item.monthlyRecoveryAmount)} | {formatCount(item.monthlyRecoveryPayments)} pagas
                      </span>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-500">
                  Aguardando dados reais do C2X.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SortableEnterpriseHeader({
  activeSort,
  label,
  onSort,
  sortKey,
}: {
  activeSort: { direction: "asc" | "desc"; key: EnterprisePerformanceSortKey };
  label: string;
  onSort: (key: EnterprisePerformanceSortKey) => void;
  sortKey: EnterprisePerformanceSortKey;
}) {
  const isActive = activeSort.key === sortKey;

  return (
    <th className="px-5 py-3 font-medium">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1.5 text-left transition-colors hover:text-[#7A5E2C]"
      >
        {label}
        <ChevronDown
          className={`size-3.5 transition-transform ${
            isActive ? "text-[#A07C3B]" : "text-slate-300"
          } ${isActive && activeSort.direction === "asc" ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
    </th>
  );
}

function compareEnterprisePerformance(
  first: EnterprisePerformanceItem,
  second: EnterprisePerformanceItem,
  key: EnterprisePerformanceSortKey,
) {
  if (key === "enterpriseName") {
    return first.enterpriseName.localeCompare(second.enterpriseName, "pt-BR", {
      sensitivity: "base",
    });
  }

  return getEnterpriseSortValue(first, key) - getEnterpriseSortValue(second, key);
}

function getEnterpriseSortValue(
  item: EnterprisePerformanceItem,
  key: EnterprisePerformanceSortKey,
) {
  if (key === "delinquencyRate") {
    return getRatio(item.overduePrincipalAmount, item.delinquencyBaseAmount);
  }

  if (key === "recoveryRate") {
    return getRatio(
      item.monthlyRecoveryAmount,
      item.monthlyRecoveryAmount + item.overduePrincipalAmount,
    );
  }

  if (key === "enterpriseName") {
    return 0;
  }

  return item[key];
}

function getRatio(value: number, total: number) {
  return total > 0 ? value / total : 0;
}

function DistributionCard({
  title,
  data,
}: {
  title: string;
  data: GuardianDistributionBucket[];
}) {
  const total = Math.max(
    data.reduce((subtotal, item) => subtotal + item.total, 0),
    1,
  );

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <div className="mt-5 space-y-4">
        {data.length > 0 ? (
          data.map((item) => {
            const percentage = Math.round((item.total / total) * 100);

            return (
              <Bar
                key={item.label}
                label={item.label}
                percentage={percentage}
                sub={formatCount(item.total)}
                value={`${percentage}%`}
              />
            );
          })
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-500">
            Aguardando dados reais do C2X.
          </div>
        )}
      </div>
    </section>
  );
}

function Bar({
  label,
  value,
  sub,
  percentage,
}: {
  label: string;
  value: string;
  sub: string;
  percentage: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-600">{label}</span>
        <span className="text-sm font-semibold text-slate-950">
          {value} <span className="font-medium text-slate-400">| {sub}</span>
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-[#A07C3B]/70" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function buildKpiDrawerItems(kpi: DashboardKpiId, records: ContractRecord[]) {
  const filteredRecords = {
    criticalContracts: records.filter((item) => item.risco === "Crítica"),
    delinquency: records.filter((item) => item.atraso > 0),
    monthlyRecovery: records.filter((item) => item.recuperado > 0),
    overdueAmount: records.filter((item) => item.atraso > 0),
    overdueClients: records.filter((item) => item.status === "Vencidas"),
    totalPortfolio: records,
  }[kpi];

  return filteredRecords.map((item, index) => ({
    atraso: item.atraso > 0 ? `${item.atrasoDias} dias` : "0 dias",
    cliente: item.cliente,
    contrato: `CTR-${String(1200 + index * 137).padStart(4, "0")}`,
    empreendimento: item.empreendimento,
    perfil: item.perfil,
    referencia: getReference(item.vencimento),
    responsavel: item.responsavel,
    saldo: money(item.atraso > 0 ? item.atraso : item.carteira),
    status: item.filaStatus,
    unidadeLote: item.unidadeLote,
    vencimento: formatDate(item.vencimento),
  }));
}

function getReference(date: string) {
  const parsed = new Date(date);
  return parsed.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("pt-BR");
}

function money(value: number) {
  if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1).replace(".", ",")} mi`;
  if (value >= 1000) return `R$ ${Math.round(value / 1000)} mil`;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(value: number, total: number, digits = 1) {
  return `${(total > 0 ? (value / total) * 100 : 0).toFixed(digits).replace(".", ",")}%`;
}

function formatCount(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("pt-BR");
}
