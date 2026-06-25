"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Building2,
  ChevronDown,
  CircleDollarSign,
  Percent,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";

import { KpiCard } from "@/components/guardian/dashboard/KpiCard";
import { MainLayout } from "@/components/guardian/layout/MainLayout";
import {
  PanteonLoadingMark,
  PanteonLoadingState,
} from "@/components/panteon/panteon-loading";
import type {
  HadesDistributionBucket,
  HadesEnterpriseDistributions,
  HadesEnterprisePerformance,
  HadesKpiDrilldownRow,
  HadesTopDelinquentClient,
} from "@/lib/guardian/overview";
import {
  getHadesKpiDrilldown,
  getHadesOperationalIntelligence,
  getHadesOverviewEnterpriseDistributions,
  getHadesOverviewSnapshot,
} from "@/lib/guardian/overview-client";
import type { HadesOperationalIntelligence } from "@/lib/guardian/read-model";

type DashboardKpiId =
  | "totalPortfolio"
  | "delinquency"
  | "overdueAmount"
  | "monthlyRecovery"
  | "overdueClients"
  | "criticalContracts";

type DashboardPanelId = "financial" | "desk" | "workflow" | "ai" | "operators";

type RealHadesKpis = {
  billingComposition: HadesDistributionBucket[];
  criticalContracts: number;
  enterprisePerformance: HadesEnterprisePerformance[];
  liquidatedAmount: number;
  liquidatedPayments: number;
  monthlyRecoveryAmount: number;
  monthlyRecoveryPayments: number;
  overdueClients: number;
  overdueAging: HadesDistributionBucket[];
  overduePrincipalAmount: number;
  overduePrincipalPayments: number;
  totalPortfolioAmount: number;
  totalPortfolioPayments: number;
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
  | "delinquencyBaseAmount"
  | "overduePrincipalAmount"
  | "overduePrincipalPayments"
  | "overdueClients"
  | "monthlyRecoveryAmount"
  | "delinquencyRate"
  | "recoveryRate";

const MOCK_DASH = "-";


function buildEnterpriseScopedKpis(
  kpis: RealHadesKpis,
  enterprise: HadesEnterprisePerformance,
): RealHadesKpis {
  const liquidatedAmount = Math.max(
    enterprise.delinquencyBaseAmount - enterprise.overduePrincipalAmount,
    0,
  );

  return {
    ...kpis,
    criticalContracts: enterprise.criticalContracts,
    liquidatedAmount,
    liquidatedPayments: 0,
    monthlyRecoveryAmount: enterprise.monthlyRecoveryAmount,
    monthlyRecoveryPayments: enterprise.monthlyRecoveryPayments,
    overdueClients: enterprise.overdueClients,
    overduePrincipalAmount: enterprise.overduePrincipalAmount,
    overduePrincipalPayments: enterprise.overduePrincipalPayments,
    totalPortfolioAmount: enterprise.totalPortfolioAmount,
    totalPortfolioPayments: enterprise.totalPortfolioPayments,
  };
}

export default function HadesPage() {
  const [enterprise, setEnterprise] = useState("Todos");
  const [selectedKpi, setSelectedKpi] = useState<DashboardKpiId | null>(null);
  const [realKpis, setRealKpis] = useState<RealHadesKpis | null>(null);
  const [enterpriseDistributions, setEnterpriseDistributions] = useState<
    Record<string, HadesEnterpriseDistributions>
  >({});
  const [enterpriseDistributionLoading, setEnterpriseDistributionLoading] =
    useState<string | null>(null);
  const [enterpriseDistributionError, setEnterpriseDistributionError] =
    useState<string | null>(null);
  const [realKpisError, setRealKpisError] = useState<string | null>(null);
  const [expandedPanels, setExpandedPanels] = useState<Record<DashboardPanelId, boolean>>({
    financial: true,
    desk: true,
    workflow: false,
    ai: true,
    operators: false,
  });
  const [opsIntel, setOpsIntel] = useState<HadesOperationalIntelligence | null>(
    null,
  );
  const [opsIntelError, setOpsIntelError] = useState<string | null>(null);
  const [kpiDrilldownRows, setKpiDrilldownRows] = useState<
    HadesKpiDrilldownRow[]
  >([]);
  const [kpiDrilldownLoading, setKpiDrilldownLoading] = useState(false);
  const [kpiDrilldownError, setKpiDrilldownError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!selectedKpi) {
      return;
    }

    let cancelled = false;
    const kpiToLoad = selectedKpi;
    setKpiDrilldownLoading(true);
    setKpiDrilldownError(null);
    setKpiDrilldownRows([]);

    async function loadDrilldown() {
      try {
        const rows = await getHadesKpiDrilldown(kpiToLoad);

        if (!cancelled) {
          setKpiDrilldownRows(rows);
        }
      } catch (error) {
        if (!cancelled) {
          setKpiDrilldownError(
            error instanceof Error
              ? error.message
              : "Falha ao carregar o detalhamento.",
          );
        }
      } finally {
        if (!cancelled) {
          setKpiDrilldownLoading(false);
        }
      }
    }

    void loadDrilldown();

    return () => {
      cancelled = true;
    };
  }, [selectedKpi]);

  useEffect(() => {
    let cancelled = false;

    async function loadOpsIntel() {
      try {
        const data = await getHadesOperationalIntelligence();
        if (!cancelled) {
          setOpsIntel(data);
          setOpsIntelError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setOpsIntelError(
            error instanceof Error
              ? error.message
              : "Falha ao carregar a inteligência da operação.",
          );
        }
      }
    }

    void loadOpsIntel();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function refreshRealKpis() {
      try {
        const snapshot = await getHadesOverviewSnapshot();

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
    }, 60000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const selectedEnterpriseName =
      enterprise === "Todos"
        ? null
        : realKpis?.enterprisePerformance.find((item) => item.enterpriseName === enterprise)
            ?.enterpriseName ?? null;

    if (!selectedEnterpriseName) {
      setEnterpriseDistributionError(null);
      setEnterpriseDistributionLoading(null);
      return;
    }

    const enterpriseToLoad = selectedEnterpriseName;
    let isMounted = true;
    setEnterpriseDistributionLoading(enterpriseToLoad);
    setEnterpriseDistributionError(null);

    async function loadEnterpriseDistributions() {
      try {
        const distributions = await getHadesOverviewEnterpriseDistributions(
          enterpriseToLoad,
        );

        if (!isMounted) {
          return;
        }

        setEnterpriseDistributions((current) => ({
          ...current,
          [enterpriseToLoad]: distributions,
        }));
        setEnterpriseDistributionError(null);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setEnterpriseDistributionError(
          error instanceof Error
            ? error.message
            : "Nao foi possivel carregar o recorte do empreendimento.",
        );
      } finally {
        if (isMounted) {
          setEnterpriseDistributionLoading(null);
        }
      }
    }

    void loadEnterpriseDistributions();

    return () => {
      isMounted = false;
    };
  }, [enterprise, realKpis]);

  const selectedEnterprisePerformance = useMemo(
    () =>
      enterprise === "Todos"
        ? null
        : realKpis?.enterprisePerformance.find((item) => item.enterpriseName === enterprise) ?? null,
    [enterprise, realKpis],
  );
  const scopedRealKpis = realKpis
    ? selectedEnterprisePerformance
      ? buildEnterpriseScopedKpis(realKpis, selectedEnterprisePerformance)
      : realKpis
    : null;
  const isEnterpriseScoped = Boolean(selectedEnterprisePerformance);
  const realTotalCarteira = scopedRealKpis?.totalPortfolioAmount ?? null;
  const realTotalAtraso = scopedRealKpis?.overduePrincipalAmount ?? null;
  const realBaseInadimplencia =
    scopedRealKpis ? scopedRealKpis.liquidatedAmount + scopedRealKpis.overduePrincipalAmount : null;
  const realDataDescription = realKpisError
    ? "falha ao carregar dados reais"
    : scopedRealKpis
      ? isEnterpriseScoped
        ? `dados reais de ${enterprise}`
        : "dados reais"
      : "carregando dados reais";
  const isRealKpisLoading = !realKpis && !realKpisError;
  const financialEnterpriseRows =
    realKpis?.enterprisePerformance ?? [];
  const selectedEnterpriseDistributions = selectedEnterprisePerformance
    ? enterpriseDistributions[selectedEnterprisePerformance.enterpriseName] ?? null
    : null;
  const isLoadingEnterpriseDistributions =
    selectedEnterprisePerformance?.enterpriseName === enterpriseDistributionLoading;
  const distributionEmptyMessage = isLoadingEnterpriseDistributions
    ? "Carregando recorte do empreendimento."
    : enterpriseDistributionError
      ? "Nao foi possivel carregar o recorte do empreendimento."
      : "Aguardando dados reais do C2X.";
  const overdueAgingRows = selectedEnterprisePerformance
    ? selectedEnterpriseDistributions?.overdueAging ?? []
    : realKpis?.overdueAging ?? [];
  const billingCompositionRows = selectedEnterprisePerformance
    ? selectedEnterpriseDistributions?.billingComposition ?? []
    : realKpis?.billingComposition ?? [];
  const agingByClientRows: HadesDistributionBucket[] = selectedEnterprisePerformance
    ? selectedEnterpriseDistributions?.overdueAgingByClient ?? []
    : [...(opsIntel?.agingByClient ?? [])]
        .sort((first, second) => first.sortOrder - second.sortOrder)
        .map((bucket) => ({ label: bucket.label, total: bucket.clients }));
  const operationalTopClients: HadesTopDelinquentClient[] =
    selectedEnterprisePerformance
      ? selectedEnterpriseDistributions?.topClients ?? []
      : opsIntel?.topClients ?? [];
  const operationalClientsCount = selectedEnterprisePerformance
    ? agingByClientRows.reduce((subtotal, bucket) => subtotal + bucket.total, 0)
    : opsIntel?.totalOverdueClients ?? 0;
  const operationalError = selectedEnterprisePerformance ? null : opsIntelError;
  const operationalLoading = selectedEnterprisePerformance
    ? isLoadingEnterpriseDistributions && !selectedEnterpriseDistributions
    : !opsIntel && !opsIntelError;
  const operationalSummary =
    operationalClientsCount > 0
      ? `${formatCount(operationalClientsCount)} clientes em atraso`
      : MOCK_DASH;
  const showFinancialLoadingOverlay =
    isRealKpisLoading && financialEnterpriseRows.length === 0;
  const financialSummary = scopedRealKpis
    ? `${money(scopedRealKpis.overduePrincipalAmount)} em atraso | ${money(
        scopedRealKpis.monthlyRecoveryAmount,
      )} recuperado no mes | ${pct(
        scopedRealKpis.monthlyRecoveryAmount,
        scopedRealKpis.monthlyRecoveryAmount + scopedRealKpis.overduePrincipalAmount,
      )} recuperacao`
    : MOCK_DASH;
  const financialSummaryTitle = scopedRealKpis
    ? `${isEnterpriseScoped ? `${enterprise} | ` : ""}${fullMoney(scopedRealKpis.overduePrincipalAmount)} em atraso | ${fullMoney(
        scopedRealKpis.monthlyRecoveryAmount,
      )} recuperado no mes | ${pct(
        scopedRealKpis.monthlyRecoveryAmount,
        scopedRealKpis.monthlyRecoveryAmount + scopedRealKpis.overduePrincipalAmount,
      )} recuperacao`
    : financialSummary;

  const kpis = [
    {
      id: "totalPortfolio" as const,
      title: "Carteira total",
      value: realTotalCarteira === null ? "..." : money(realTotalCarteira),
      valueTitle: realTotalCarteira === null ? undefined : fullMoney(realTotalCarteira),
      variation: scopedRealKpis ? formatCount(scopedRealKpis.totalPortfolioPayments) : "--",
      description: scopedRealKpis ? "parcelas na carteira" : realDataDescription,
      icon: Banknote,
    },
    {
      id: "delinquency" as const,
      title: "Inadimplência",
      value: realBaseInadimplencia === null || realTotalAtraso === null ? "..." : pct(realTotalAtraso, realBaseInadimplencia, 2),
      valueTitle:
        realBaseInadimplencia === null || realTotalAtraso === null
          ? undefined
          : `${pct(realTotalAtraso, realBaseInadimplencia, 2)} sobre ${fullMoney(realBaseInadimplencia)}`,
      variation: scopedRealKpis ? "vencidas" : "--",
      description: scopedRealKpis ? "sobre vencidas + liquidadas" : realDataDescription,
      icon: Percent,
    },
    {
      id: "overdueAmount" as const,
      title: "Valor em atraso",
      value: realTotalAtraso === null ? "..." : money(realTotalAtraso),
      valueTitle: realTotalAtraso === null ? undefined : fullMoney(realTotalAtraso),
      variation: scopedRealKpis ? formatCount(scopedRealKpis.overduePrincipalPayments) : "--",
      description: scopedRealKpis ? "parcelas vencidas" : realDataDescription,
      icon: CircleDollarSign,
    },
    {
      id: "monthlyRecovery" as const,
      title: "Recuperação mensal",
      value: scopedRealKpis ? money(scopedRealKpis.monthlyRecoveryAmount) : "...",
      valueTitle: scopedRealKpis ? fullMoney(scopedRealKpis.monthlyRecoveryAmount) : undefined,
      variation: scopedRealKpis ? formatCount(scopedRealKpis.monthlyRecoveryPayments) : "--",
      description: scopedRealKpis ? "pagas apos 10 dias" : realDataDescription,
      icon: TrendingUp,
    },
    {
      id: "overdueClients" as const,
      title: "Clientes em atraso",
      value: scopedRealKpis ? formatCount(scopedRealKpis.overdueClients) : "...",
      variation: scopedRealKpis ? "clientes" : "--",
      description: scopedRealKpis ? "clientes distintos" : realDataDescription,
      icon: Users,
    },
    {
      id: "criticalContracts" as const,
      title: "Contratos críticos",
      value: scopedRealKpis ? formatCount(scopedRealKpis.criticalContracts) : "...",
      variation: scopedRealKpis ? "> 3 parcelas" : "--",
      description: scopedRealKpis ? "contratos em atraso" : realDataDescription,
      icon: AlertTriangle,
    },
  ];

  const selectedKpiMeta = selectedKpi ? kpis.find((item) => item.id === selectedKpi) : null;

  function togglePanel(panel: DashboardPanelId) {
    setExpandedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }

  return (
    <MainLayout>
      <div className="flex w-full flex-col gap-6">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.id} {...kpi} onClick={() => setSelectedKpi(kpi.id)} />
          ))}
        </section>

        <DashboardPanel
          badge={isEnterpriseScoped ? enterprise : realKpis ? "C2X" : "Aguardando C2X"}
          expanded={expandedPanels.financial}
          id="financial"
          onToggle={togglePanel}
          summary={financialSummary}
          summaryTitle={financialSummaryTitle}
          title="Financeiro"
          tone="gold"
        >
          <section
            aria-busy={showFinancialLoadingOverlay}
            className="relative grid gap-4 2xl:grid-cols-[1.4fr_0.6fr]"
          >
            <div
              className={
                showFinancialLoadingOverlay
                  ? "contents pointer-events-none select-none"
                  : "contents"
              }
            >
              <EnterprisePerformanceTable
                data={financialEnterpriseRows}
                error={realKpisError}
                isLoading={showFinancialLoadingOverlay}
                selected={enterprise}
                onSelect={(value) => setEnterprise((current) => (current === value ? "Todos" : value))}
              />
              <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-1">
                <AgingDistributionCard
                  parcelaData={overdueAgingRows}
                  clienteData={agingByClientRows}
                  emptyMessage={distributionEmptyMessage}
                  isLoading={showFinancialLoadingOverlay}
                />
                <DistributionCard
                  title="Composição da cobrança"
                  data={billingCompositionRows}
                  emptyMessage={distributionEmptyMessage}
                  isLoading={showFinancialLoadingOverlay}
                />
              </div>
            </div>
            {showFinancialLoadingOverlay ? (
              <PanteonLoadingState title="Carregando" variant="overlay" />
            ) : null}
          </section>
        </DashboardPanel>

        <DashboardPanel
          expanded={expandedPanels.ai}
          id="ai"
          onToggle={togglePanel}
          summary={operationalSummary}
          title="Ranking de inadimplência"
          tone="gold"
        >
          <ExecutiveAiBlock
            topClients={operationalTopClients}
            error={operationalError}
            isLoading={operationalLoading}
          />
        </DashboardPanel>

      </div>

      {selectedKpiMeta ? (
        <DashboardKpiDrawer
          rows={kpiDrilldownRows}
          isLoading={kpiDrilldownLoading}
          error={kpiDrilldownError}
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
  summaryTitle,
  title,
  tone = "neutral",
}: {
  badge?: string;
  children: ReactNode;
  expanded: boolean;
  id: DashboardPanelId;
  onToggle: (id: DashboardPanelId) => void;
  summary: string;
  summaryTitle?: string;
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
        className="flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50/70 lg:flex-row lg:items-center lg:justify-between"
        aria-expanded={expanded}
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
            {badge ? <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${badgeClass}`}>{badge}</span> : null}
          </div>
          <Tooltip content={summaryTitle ?? summary} placement="bottom">
            <span className="mt-1 block truncate text-xs text-slate-500">
              {summary}
            </span>
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
        <Tooltip key={`${label}-${value}`} content={action} placement="bottom" className="w-full" triggerClassName="w-full">
          <button
            type="button"
            className="group w-full rounded-xl border border-slate-200/70 bg-slate-50/50 p-3 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold tracking-normal text-slate-400">{label}</p>
              <ArrowUpRight className="size-3.5 text-[#A07C3B] opacity-70 transition-opacity group-hover:opacity-100" aria-hidden="true" />
            </div>
            <p className={`mt-1.5 text-xl font-semibold ${tone === "danger" ? "text-rose-700" : tone === "gold" ? "text-[#7A5E2C]" : "text-slate-950"}`}>
              {value}
            </p>
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

function ExecutiveAiBlock({
  topClients,
  error,
  isLoading,
}: {
  topClients: HadesTopDelinquentClient[];
  error: string | null;
  isLoading: boolean;
}) {
  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
        {error}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm font-medium text-slate-500">
        Carregando ranking de inadimplência...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-950">
          Top 15 clientes inadimplentes
        </h3>
        <p className="mt-0.5 text-xs font-medium text-slate-500">
          Maior valor em aberto.
        </p>
        {topClients.length > 0 ? (
          <div className="mt-3 max-h-80 overflow-y-auto pr-1">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-white text-[11px] tracking-wide text-slate-400">
                <tr>
                  <th className="py-1 pr-2 font-semibold">#</th>
                  <th className="py-1 pr-2 font-semibold">Cliente</th>
                  <th className="py-1 pr-2 font-semibold">Empreend.</th>
                  <th className="py-1 pr-2 text-right font-semibold">Parc.</th>
                  <th className="py-1 pr-2 text-right font-semibold">Em aberto</th>
                  <th className="py-1 text-right font-semibold">Atraso</th>
                </tr>
              </thead>
              <tbody>
                {topClients.map((client, index) => (
                  <tr
                    key={`${client.name}-${index}`}
                    className="border-t border-slate-100"
                  >
                    <td className="py-1.5 pr-2 font-semibold text-slate-400">
                      {index + 1}
                    </td>
                    <td className="py-1.5 pr-2 font-medium text-slate-800">
                      {client.name}
                    </td>
                    <td className="py-1.5 pr-2 text-slate-500">
                      {client.enterprise ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-slate-600">
                      {formatCount(client.overduePayments)}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-semibold text-slate-900">
                      <MoneyValue value={client.overdueAmount} />
                    </td>
                    <td className="py-1.5 text-right text-slate-600">
                      {formatCount(client.overdueDays)}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-500">
            Nenhum cliente inadimplente neste recorte.
          </div>
        )}
      </section>
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
      <Tooltip content={text} placement="bottom">
        <span className="mt-1 block text-xs leading-5 text-slate-600">{text}</span>
      </Tooltip>
    </article>
  );
}

function DashboardKpiDrawer({
  rows,
  isLoading,
  error,
  onClose,
  title,
}: {
  rows: HadesKpiDrilldownRow[];
  isLoading: boolean;
  error: string | null;
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
        className={`absolute right-0 top-0 flex h-full w-full max-w-[920px] flex-col border-l border-slate-200/70 bg-white shadow-[-24px_0_70px_rgba(15,23,42,0.18)] transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium tracking-normal text-[#A07C3B]">Detalhamento do indicador</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">{title}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {isLoading
                  ? "Carregando base real do C2X..."
                  : error
                    ? error
                    : `${formatCount(rows.length)} ${rows.length === 1 ? "registro" : "registros"}${rows.length === 200 ? "+ (mostrando os 200 maiores)" : ""}`}
              </p>
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
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <PanteonLoadingMark size="sm" />
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">
              {error}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4 text-sm text-slate-500">
              Nenhum registro encontrado.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200/70">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs tracking-normal text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Empreendimento</th>
                    <th className="px-4 py-3 font-medium">Unidade</th>
                    <th className="px-4 py-3 font-medium">Contrato</th>
                    <th className="px-4 py-3 text-right font-medium">Parcelas</th>
                    <th className="px-4 py-3 font-medium">Vencimento</th>
                    <th className="px-4 py-3 text-right font-medium">Saldo</th>
                    <th className="px-4 py-3 text-right font-medium">Atraso</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {rows.map((row, index) => (
                    <tr key={`${title}-${index}`} className="hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-950">{row.cliente}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{row.empreendimento}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{row.unidade}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{row.contrato}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600">
                        {row.parcelas === null ? "—" : formatCount(row.parcelas)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {row.vencimento ? formatDate(row.vencimento) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-950">
                        <MoneyValue value={row.saldo} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600">
                        {row.atraso === null ? "—" : `${formatCount(row.atraso)}d`}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function EnterprisePerformanceTable({
  data,
  error,
  isLoading,
  selected,
  onSelect,
}: {
  data: EnterprisePerformanceItem[];
  error: string | null;
  isLoading: boolean;
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
    <section className="relative overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
            <Building2 className="size-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-950">Performance por empreendimento</h2>
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
      <div className="max-h-[640px] min-h-72 overflow-auto">
        <table className="w-full min-w-[1120px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs tracking-normal text-slate-500">
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
                label="Carteira acumulada"
                sortKey="delinquencyBaseAmount"
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
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                    <MoneyValue value={item.totalPortfolioAmount} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                    <MoneyValue value={item.delinquencyBaseAmount} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{pct(item.overduePrincipalAmount, item.delinquencyBaseAmount, 2)}</td>
                  <td className="whitespace-nowrap px-5 py-3 font-medium text-slate-900">
                    <MoneyValue value={item.overduePrincipalAmount} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatCount(item.overduePrincipalPayments)}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatCount(item.overdueClients)}</td>
                  <td className="whitespace-nowrap px-5 py-3">
                    <div className="flex flex-col items-center gap-1 text-center">
                      <span className="rounded-full border border-[#A07C3B]/15 bg-[#A07C3B]/5 px-2.5 py-1 text-xs font-medium text-[#7A5E2C]">
                        {pct(item.monthlyRecoveryAmount, item.monthlyRecoveryAmount + item.overduePrincipalAmount)}
                      </span>
                      <span className="text-xs text-slate-500">
                        <MoneyValue value={item.monthlyRecoveryAmount} /> | {formatCount(item.monthlyRecoveryPayments)} pagas
                      </span>
                    </div>
                  </td>
                </tr>
              ))
            ) : isLoading ? null : (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-sm text-slate-500">
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

function MoneyValue({ value }: { value: number }) {
  return (
    <Tooltip content={fullMoney(value)} placement="top">
      <span aria-label={fullMoney(value)}>
        {money(value)}
      </span>
    </Tooltip>
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

function AgingDistributionCard({
  parcelaData,
  clienteData,
  emptyMessage = "Aguardando dados reais do C2X.",
  isLoading = false,
}: {
  parcelaData: HadesDistributionBucket[];
  clienteData: HadesDistributionBucket[];
  emptyMessage?: string;
  isLoading?: boolean;
}) {
  const [view, setView] = useState<"cliente" | "parcela">("parcela");
  const data = view === "parcela" ? parcelaData : clienteData;
  const isLoadingEmptyState = /^carregando/i.test(emptyMessage);
  const total = Math.max(
    data.reduce((subtotal, item) => subtotal + item.total, 0),
    1,
  );

  return (
    <section className="relative rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">
            Aging da inadimplência
          </h2>
          <p className="mt-0.5 text-xs font-medium text-slate-500">
            Por {view === "parcela" ? "parcelas" : "clientes"} · faixa de atraso
          </p>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
          <Tooltip content="Por parcela">
            <button
              type="button"
              onClick={() => setView("parcela")}
              aria-label="Aging por parcela"
              aria-pressed={view === "parcela"}
              className={`flex size-7 items-center justify-center rounded-md transition ${
                view === "parcela"
                  ? "bg-white text-[#A07C3B] shadow-sm"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <Banknote className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip content="Por cliente">
            <button
              type="button"
              onClick={() => setView("cliente")}
              aria-label="Aging por cliente"
              aria-pressed={view === "cliente"}
              className={`flex size-7 items-center justify-center rounded-md transition ${
                view === "cliente"
                  ? "bg-white text-[#A07C3B] shadow-sm"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <Users className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="mt-5 min-h-40 space-y-4">
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
            {isLoading ? (
              "Carregando"
            ) : isLoadingEmptyState ? (
              <span className="inline-flex items-center gap-2">
                <PanteonLoadingMark size="xs" />
                {emptyMessage}
              </span>
            ) : (
              emptyMessage
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function DistributionCard({
  title,
  data,
  emptyMessage = "Aguardando dados reais do C2X.",
  isLoading = false,
}: {
  title: string;
  data: HadesDistributionBucket[];
  emptyMessage?: string;
  isLoading?: boolean;
}) {
  const isLoadingEmptyState = /^carregando/i.test(emptyMessage);
  const total = Math.max(
    data.reduce((subtotal, item) => subtotal + item.total, 0),
    1,
  );

  return (
    <section className="relative rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <div className="mt-5 min-h-40 space-y-4">
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
            {isLoading ? (
              "Carregando"
            ) : isLoadingEmptyState ? (
              <span className="inline-flex items-center gap-2">
                <PanteonLoadingMark size="xs" />
                {emptyMessage}
              </span>
            ) : (
              emptyMessage
            )}
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

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("pt-BR");
}

function money(value: number) {
  if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1).replace(".", ",")} mi`;
  if (value >= 1000) return `R$ ${Math.round(value / 1000)} mil`;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fullMoney(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(value: number, total: number, digits = 1) {
  return `${(total > 0 ? (value / total) * 100 : 0).toFixed(digits).replace(".", ",")}%`;
}

function formatCount(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("pt-BR");
}
