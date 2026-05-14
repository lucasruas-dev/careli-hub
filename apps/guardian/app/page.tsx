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
import { CollectionQueueTable, type DashboardQueueItem } from "@/components/dashboard/CollectionQueueTable";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { MainLayout } from "@/components/layout/MainLayout";
import { guardianMockClients } from "@/modules/guardianMockData";

const contracts = guardianMockClients.map((client) => ({
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
  sexo: client.sexo,
  faixaEtaria: getAgeRange(client.idade),
  profissao: client.profissao,
  renda: client.renda,
  escolaridade: client.escolaridade,
  estadoCivil: client.estadoCivil,
  recuperado: client.recuperado,
})) as Array<{
  cliente: string; empreendimento: string; unidadeLote: string; perfil: string; status: string; vencimento: string; carteira: number; atraso: number; atrasoDias: number; score: number; risco: string; responsavel: string; filaStatus: string; sexo: string; faixaEtaria: string; profissao: string; renda: string; escolaridade: string; estadoCivil: string; recuperado: number;
}>;

const enterpriseOptions = ["Todos", ...Array.from(new Set(contracts.map((item) => item.empreendimento)))];
const profileOptions = ["Todos", "Ato", "Sinal", "Parcela"];
const statusOptions = ["Todos", "Vencidas", "A vencer", "Liquidadas"];
type DashboardKpiId = "totalPortfolio" | "delinquency" | "overdueAmount" | "monthlyRecovery" | "overdueClients" | "criticalContracts";
type DashboardPanelId = "financial" | "desk" | "collection" | "workflow" | "sla" | "ai" | "heatmap" | "operators";

const DASHBOARD_PANELS_STORAGE_KEY = "guardian-home-panels";
const defaultDashboardPanels: Record<DashboardPanelId, boolean> = {
  financial: true,
  desk: true,
  collection: false,
  workflow: false,
  sla: false,
  ai: true,
  heatmap: false,
  operators: false,
};

export default function Home() {
  const [enterprise, setEnterprise] = useState("Todos");
  const [profile, setProfile] = useState("Todos");
  const [status, setStatus] = useState("Todos");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [selectedKpi, setSelectedKpi] = useState<DashboardKpiId | null>(null);
  const [expandedPanels, setExpandedPanels] = useState(defaultDashboardPanels);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = window.localStorage.getItem(DASHBOARD_PANELS_STORAGE_KEY);
      if (!stored) return;

      try {
        setExpandedPanels({ ...defaultDashboardPanels, ...JSON.parse(stored) });
      } catch {
        setExpandedPanels(defaultDashboardPanels);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  function togglePanel(panel: DashboardPanelId) {
    setExpandedPanels((current) => {
      const next = { ...current, [panel]: !current[panel] };
      window.localStorage.setItem(DASHBOARD_PANELS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const filtered = useMemo(() => contracts.filter((item) => {
    const time = new Date(item.vencimento).getTime();
    return (enterprise === "Todos" || item.empreendimento === enterprise)
      && (profile === "Todos" || item.perfil === profile)
      && (status === "Todos" || item.status === status)
      && (!dateStart || time >= new Date(dateStart).getTime())
      && (!dateEnd || time <= new Date(dateEnd).getTime());
  }), [dateEnd, dateStart, enterprise, profile, status]);

  const totalCarteira = sum(filtered, "carteira");
  const totalAtraso = sum(filtered, "atraso");
  const totalRecuperado = sum(filtered, "recuperado");
  const vencidas = filtered.filter((item) => item.status === "Vencidas");
  const kpis = [
    { id: "totalPortfolio" as const, title: "Carteira total", value: money(totalCarteira), variation: "+12,8%", description: "base filtrada", icon: Banknote },
    { id: "delinquency" as const, title: "Inadimplência", value: pct(totalAtraso, totalCarteira), variation: "+0,8%", description: "vs mês anterior", icon: Percent },
    { id: "overdueAmount" as const, title: "Valor em atraso", value: money(totalAtraso), variation: "+5,1%", description: "saldo vencido", icon: CircleDollarSign },
    { id: "monthlyRecovery" as const, title: "Recuperação mensal", value: pct(totalRecuperado, totalRecuperado + totalAtraso), variation: "+4,1%", description: "base filtrada", icon: TrendingUp },
    { id: "overdueClients" as const, title: "Clientes em atraso", value: `${vencidas.length}`, variation: "-3,4%", description: "contratos vencidos", icon: Users },
    { id: "criticalContracts" as const, title: "Contratos críticos", value: `${filtered.filter((item) => item.risco === "Crítica").length}`, variation: "-2,1%", description: "risco alto", icon: AlertTriangle },
  ];
  const selectedKpiMeta = selectedKpi ? kpis.find((item) => item.id === selectedKpi) : null;
  const drawerItems = selectedKpi ? buildKpiDrawerItems(selectedKpi, filtered) : [];

  const queueItems: DashboardQueueItem[] = vencidas.map((item) => ({
    cliente: item.cliente,
    empreendimento: item.empreendimento,
    unidadeLote: item.unidadeLote,
    atraso: `${item.atrasoDias} dias`,
    saldo: money(item.atraso),
    risco: item.risco,
    responsavel: item.responsavel,
    status: item.filaStatus,
  }));

  return (
    <MainLayout>
      <div className="flex w-full flex-col gap-6">
        <GlobalFilters enterprise={enterprise} profile={profile} status={status} dateStart={dateStart} dateEnd={dateEnd} setEnterprise={setEnterprise} setProfile={setProfile} setStatus={setStatus} setDateStart={setDateStart} setDateEnd={setDateEnd} />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {kpis.map((kpi) => (
            <KpiCard
              key={kpi.title}
              {...kpi}
              onClick={() => setSelectedKpi(kpi.id)}
            />
          ))}
        </section>

        <DashboardPanel badge="R$ 74,8 mil" expanded={expandedPanels.financial} id="financial" onToggle={togglePanel} summary={`${money(totalAtraso)} em atraso • ${money(totalRecuperado)} recuperado • ${pct(totalRecuperado, totalRecuperado + totalAtraso)} recuperação`} title="Financeiro" tone="gold">
          <section className="grid gap-4 2xl:grid-cols-[1.4fr_0.6fr]">
          <EnterprisePerformanceTable data={aggregateEnterprises(filtered)} selected={enterprise} onSelect={setEnterprise} />
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-1">
            <DistributionCard title="Aging da inadimplência" data={agingData(vencidas)} />
            <DistributionCard title="Composição da cobrança" data={billingCompositionData(filtered)} />
          </div>
          </section>
        </DashboardPanel>

        <DashboardPanel badge="4 críticos" expanded={expandedPanels.desk} id="desk" onToggle={togglePanel} summary="42 tickets • SLA crítico 4 • TMR 4m18s • 11 sem resposta" title="Desk" tone="danger">
          <ActionMetricGrid metrics={[["Tickets abertos", "42", "Abrir Desk", "gold"], ["SLA crítico", "4", "Ver críticos", "danger"], ["Tempo médio resposta", "4m18s", "Monitorar SLA", "neutral"], ["Tempo médio encerramento", "38 min", "Ver produtividade", "neutral"], ["Mensagens sem resposta", "11", "Abrir fila", "danger"], ["Operadores online", "5", "Ver operadores", "gold"], ["Aguardando operador", "6", "Distribuir", "danger"], ["Tickets prioritários", "14", "Priorizar", "gold"]]} />
        </DashboardPanel>

        <DashboardPanel expanded={expandedPanels.collection} id="collection" onToggle={togglePanel} summary={`${vencidas.length} clientes em atraso • 18 promessas abertas • taxa quebra 12%`} title="Cobrança" tone="gold">
          <CollectionQueueTable items={queueItems} />
        </DashboardPanel>

        <DashboardPanel expanded={expandedPanels.workflow} id="workflow" onToggle={togglePanel} summary="31 follow-ups vencendo • 8 clientes críticos • risco operacional elevado" title="Workflow" tone="danger">
          <ActionMetricGrid metrics={[["Workflow operacional", "76%", "Ver etapas", "neutral"], ["Clientes críticos", `${filtered.filter((item) => item.risco === "Crítica").length}`, "Abrir fila", "danger"], ["Follow-ups vencendo", "31", "Priorizar", "gold"], ["Promessas vencendo hoje", "18", "Abrir promessas", "gold"], ["Risco operacional", "Alto", "Ver diagnóstico", "danger"], ["Tickets prioritários", "14", "Abrir Desk", "danger"]]} />
        </DashboardPanel>

        <DashboardPanel badge="SLA estourando" expanded={expandedPanels.sla} id="sla" onToggle={togglePanel} summary="4 SLA críticos • 6 aguardando operador • menor janela 8 min" title="SLA" tone="danger">
          <ActionMetricGrid metrics={[["SLA crítico", "4", "Abrir tickets críticos", "danger"], ["SLA vencendo", "9", "Repriorizar", "gold"], ["Sem primeira resposta", "6", "Assumir atendimento", "danger"], ["Dentro do SLA", "88%", "Ver tendência", "neutral"]]} />
        </DashboardPanel>

        <DashboardPanel expanded={expandedPanels.ai} id="ai" onToggle={togglePanel} summary="Previsão atraso 18% • quebra 12% • evasão 7% • redistribuir 4 tickets" title="IA operacional" tone="gold">
          <ExecutiveAiBlock />
        </DashboardPanel>

        <DashboardPanel expanded={expandedPanels.heatmap} id="heatmap" onToggle={togglePanel} summary="Cinthia sobrecarregada • fila aquecendo • SLA concentrado" title="Heatmap" tone="danger">
          <ExecutiveHeatmap />
        </DashboardPanel>

        <DashboardPanel expanded={expandedPanels.operators} id="operators" onToggle={togglePanel} summary="5 online • 18 tickets em atendimento • Gustavo lidera recuperação" title="Operadores" tone="neutral">
          <ActionMetricGrid metrics={[["Operadores online", "5", "Ver escala", "gold"], ["Em atendimento", "18", "Abrir Desk", "neutral"], ["Sobrecarregados", "1", "Redistribuir", "danger"], ["Produtividade", "+12%", "Ver ranking", "gold"]]} />
        </DashboardPanel>
      </div>
      <DashboardKpiDrawer
        items={drawerItems}
        onClose={() => setSelectedKpi(null)}
        title={selectedKpiMeta?.title ?? ""}
      />
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
          <p className={`mt-1.5 text-xl font-semibold ${tone === "danger" ? "text-rose-700" : tone === "gold" ? "text-[#7A5E2C]" : "text-slate-950"}`}>{value}</p>
        </button>
      ))}
    </div>
  );
}

function ExecutiveAiBlock() {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <InsightCard title="Gargalo" value="Desk em atenção" text="SLA crítico concentrado em tickets sem primeira resposta e operador sobrecarregado." tone="danger" />
      <InsightCard title="Previsões" value="Atraso 18%" text="Quebra prevista em 12% e risco de evasão em 7% nos clientes críticos." tone="gold" />
      <InsightCard title="Recomendação IA" value="Redistribuir" text="Mover 4 tickets para operadores com menor carga e priorizar promessas vencendo hoje." tone="neutral" />
    </div>
  );
}

function ExecutiveHeatmap() {
  const cells = [
    ["Gustavo", "Carga", 68, "gold"],
    ["Gustavo", "SLA", 24, "neutral"],
    ["Cinthia", "Carga", 92, "danger"],
    ["Cinthia", "Sem resposta", 86, "danger"],
    ["Mariana", "Carga", 38, "neutral"],
    ["Mariana", "SLA", 8, "neutral"],
    ["Bruno", "Carga", 44, "neutral"],
    ["Bruno", "Fila", 40, "neutral"],
  ] as const;

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {cells.map(([operator, metric, value, tone]) => (
        <div key={`${operator}-${metric}`} className={`rounded-xl border px-3 py-3 ${tone === "danger" ? "border-rose-100 bg-rose-50" : tone === "gold" ? "border-[#A07C3B]/15 bg-[#A07C3B]/5" : "border-slate-200/70 bg-slate-50/60"}`}>
          <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">{operator}</p>
          <p className="mt-1 text-sm text-slate-500">{metric}</p>
          <p className={`mt-2 text-xl font-semibold ${tone === "danger" ? "text-rose-700" : tone === "gold" ? "text-[#7A5E2C]" : "text-slate-950"}`}>{value}%</p>
        </div>
      ))}
    </div>
  );
}

function InsightCard({ text, title, tone, value }: { text: string; title: string; tone: "danger" | "gold" | "neutral"; value: string }) {
  return (
    <article title={text} className={`rounded-xl border p-3 ${tone === "danger" ? "border-rose-100 bg-rose-50" : tone === "gold" ? "border-[#A07C3B]/15 bg-[#A07C3B]/5" : "border-slate-200/70 bg-slate-50/60"}`}>
      <p className="text-sm font-semibold text-slate-950">{title}</p>
      <p className={`mt-1.5 text-lg font-semibold ${tone === "danger" ? "text-rose-700" : tone === "gold" ? "text-[#7A5E2C]" : "text-slate-950"}`}>{value}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{text}</p>
    </article>
  );
}

function GlobalFilters(props: {
  enterprise: string; profile: string; status: string; dateStart: string; dateEnd: string;
  setEnterprise: (value: string) => void; setProfile: (value: string) => void; setStatus: (value: string) => void; setDateStart: (value: string) => void; setDateEnd: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const clear = () => { props.setEnterprise("Todos"); props.setProfile("Todos"); props.setStatus("Todos"); props.setDateStart(""); props.setDateEnd(""); };
  const activeFilters = [
    props.enterprise !== "Todos" ? { label: "Empreendimento", value: props.enterprise, clear: () => props.setEnterprise("Todos") } : null,
    props.profile !== "Todos" ? { label: "Perfil", value: props.profile, clear: () => props.setProfile("Todos") } : null,
    props.status !== "Todos" ? { label: "Status", value: props.status, clear: () => props.setStatus("Todos") } : null,
    props.dateStart ? { label: "Inicial", value: props.dateStart, clear: () => props.setDateStart("") } : null,
    props.dateEnd ? { label: "Final", value: props.dateEnd, clear: () => props.setDateEnd("") } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; clear: () => void }>;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = window.localStorage.getItem("guardian-dashboard-filters-expanded");
      if (stored) setExpanded(stored === "true");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;
      window.localStorage.setItem("guardian-dashboard-filters-expanded", String(next));
      return next;
    });
  }

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={toggleExpanded} className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-[#A07C3B]/5" aria-expanded={expanded}>
          <Filter className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
          Filtros{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
          <ChevronDown className={`size-3.5 text-[#A07C3B] transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {activeFilters.map((filter) => (
          <button key={`${filter.label}-${filter.value}`} type="button" onClick={filter.clear} title={`Remover ${filter.label}`} className="inline-flex h-7 max-w-48 items-center gap-1 rounded-full bg-[#A07C3B]/5 px-2 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
            <span className="truncate">{filter.value}</span><span aria-hidden="true">×</span>
          </button>
        ))}
        {activeFilters.length > 0 ? (
          <button type="button" onClick={clear} title="Limpar filtros" aria-label="Limpar filtros" className="flex size-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]">
            <X className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className={`grid transition-all duration-300 ease-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="grid gap-3 pt-3 md:grid-cols-2 xl:grid-cols-5">
            <Select label="Empreendimento" value={props.enterprise} onChange={props.setEnterprise} options={enterpriseOptions} />
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

function buildKpiDrawerItems(kpi: DashboardKpiId, records: typeof contracts) {
  const filteredRecords = {
    criticalContracts: records.filter((item) => item.risco.includes("tica") || item.risco === "Crítica"),
    delinquency: records.filter((item) => item.atraso > 0),
    monthlyRecovery: records.filter((item) => item.recuperado > 0 || item.filaStatus.toLowerCase().includes("negocia") || item.filaStatus.toLowerCase().includes("proposta")),
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
    <div
      className={`fixed inset-0 z-50 transition ${isOpen ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!isOpen}
    >
      <button
        type="button"
        aria-label="Fechar detalhes do KPI"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/20 backdrop-blur-[2px] transition-opacity ${isOpen ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-[860px] flex-col border-l border-slate-200/70 bg-white shadow-[-24px_0_70px_rgba(15,23,42,0.18)] transition-transform duration-300 ease-out ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <header className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#A07C3B]">Detalhamento do indicador</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">{title}</h2>
              <p className="mt-1 text-sm text-slate-500">Dados mockados respeitando os filtros globais aplicados no Dashboard.</p>
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

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label><span className="text-xs font-medium text-slate-500">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-medium text-slate-700 outline-none">{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label><span className="text-xs font-medium text-slate-500">{label}</span><input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-medium text-slate-700 outline-none" /></label>;
}

function EnterprisePerformanceTable({ data, selected, onSelect }: { data: ReturnType<typeof aggregateEnterprises>; selected: string; onSelect: (value: string) => void }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-xl bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70"><Building2 className="size-4" /></div><div><h2 className="text-base font-semibold text-slate-950">Performance por empreendimento</h2><p className="mt-1 text-sm text-slate-500">Clique em um empreendimento para filtrar o dashboard.</p></div></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[840px] text-left text-sm"><thead className="bg-slate-50/70 text-xs uppercase tracking-normal text-slate-500"><tr><th className="px-5 py-3 font-medium">Empreendimento</th><th className="px-5 py-3 font-medium">Carteira</th><th className="px-5 py-3 font-medium">Inadimplência</th><th className="px-5 py-3 font-medium">Valor em atraso</th><th className="px-5 py-3 font-medium">Clientes em atraso</th><th className="px-5 py-3 font-medium">Recuperação</th></tr></thead><tbody className="divide-y divide-slate-100">{data.map((item) => <tr key={item.empreendimento} onClick={() => onSelect(item.empreendimento)} className={`cursor-pointer transition-colors hover:bg-slate-50/60 ${selected === item.empreendimento ? "bg-[#A07C3B]/5" : ""}`}><td className="whitespace-nowrap px-5 py-4 font-medium text-slate-950">{item.empreendimento}</td><td className="whitespace-nowrap px-5 py-4 text-slate-600">{money(item.carteira)}</td><td className="whitespace-nowrap px-5 py-4 text-slate-600">{pct(item.atraso, item.carteira)}</td><td className="whitespace-nowrap px-5 py-4 font-medium text-slate-900">{money(item.atraso)}</td><td className="whitespace-nowrap px-5 py-4 text-slate-600">{item.clientes}</td><td className="whitespace-nowrap px-5 py-4"><span className="rounded-full border border-[#A07C3B]/15 bg-[#A07C3B]/5 px-2.5 py-1 text-xs font-medium text-[#7A5E2C]">{pct(item.recuperado, item.recuperado + item.atraso)}</span></td></tr>)}</tbody></table></div>
    </section>
  );
}

function DistributionCard({ title, data }: { title: string; data: Array<[string, number]> }) {
  const total = Math.max(data.reduce((sum, [, value]) => sum + value, 0), 1);
  return <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"><h2 className="text-base font-semibold text-slate-950">{title}</h2><div className="mt-5 space-y-4">{data.map(([label, value]) => { const percentage = Math.round((value / total) * 100); return <Bar key={label} label={label} value={`${percentage}%`} sub={`${value}`} percentage={percentage} />; })}</div></section>;
}

function Bar({ label, value, sub, percentage }: { label: string; value: string; sub: string; percentage: number }) {
  return <div><div className="flex items-center justify-between gap-3"><span className="text-sm text-slate-600">{label}</span><span className="text-sm font-semibold text-slate-950">{value} <span className="font-medium text-slate-400">| {sub}</span></span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#A07C3B]/70" style={{ width: `${percentage}%` }} /></div></div>;
}

function aggregateEnterprises(records: typeof contracts) {
  return enterpriseOptions.filter((item) => item !== "Todos").map((empreendimento) => {
    const items = records.filter((record) => record.empreendimento === empreendimento);
    return { empreendimento, carteira: sum(items, "carteira"), atraso: sum(items, "atraso"), recuperado: sum(items, "recuperado"), clientes: items.filter((item) => item.status === "Vencidas").length };
  }).filter((item) => item.carteira > 0);
}

function agingData(records: typeof contracts): Array<[string, number]> {
  return [["1 a 15 dias", records.filter((i) => i.atrasoDias >= 1 && i.atrasoDias <= 15).length], ["16 a 30 dias", records.filter((i) => i.atrasoDias >= 16 && i.atrasoDias <= 30).length], ["31 a 60 dias", records.filter((i) => i.atrasoDias >= 31 && i.atrasoDias <= 60).length], ["61 a 90 dias", records.filter((i) => i.atrasoDias >= 61 && i.atrasoDias <= 90).length], ["90+ dias", records.filter((i) => i.atrasoDias > 90).length]];
}

function billingCompositionData(records: typeof contracts): Array<[string, number]> {
  return ["Ato", "Sinal", "Parcela"].map((profile) => [
    profile,
    records.filter((item) => item.perfil === profile).length,
  ]);
}

function getAgeRange(ageLabel: string) {
  const age = Number.parseInt(ageLabel, 10);

  if (age <= 30) return "Até 30 anos";
  if (age <= 45) return "31 a 45 anos";
  if (age <= 60) return "46 a 60 anos";
  return "60+";
}

function getReference(date: string) {
  const parsed = new Date(date);
  return parsed.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("pt-BR");
}

function sum(records: typeof contracts, key: "carteira" | "atraso" | "recuperado") {
  return records.reduce((total, item) => total + item[key], 0);
}

function money(value: number) {
  if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1).replace(".", ",")} mi`;
  if (value >= 1000) return `R$ ${Math.round(value / 1000)} mil`;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(value: number, total: number) {
  return `${(total > 0 ? (value / total) * 100 : 0).toFixed(1).replace(".", ",")}%`;
}
