"use client";

import { useState } from "react";
import {
  ArrowRight,
  Brain,
  Building2,
  Clock3,
  FileText,
  Gauge,
  HandCoins,
  LayoutDashboard,
  MapPinned,
  Maximize2,
  MessageCircle,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  ReceiptText,
  ShieldAlert,
  X,
} from "lucide-react";
import { AgreementsCenterCard } from "@/modules/attendance/components/AgreementsCenterCard";
import { AiSuggestionsModal } from "@/modules/attendance/components/AiSuggestionsModal";
import { DetailSection } from "@/modules/attendance/components/DetailSection";
import { ExpandableDetailSection } from "@/modules/attendance/components/ExpandableDetailSection";
import { InstallmentsCard } from "@/modules/attendance/components/InstallmentsCard";
import { OperationalWorkflowCard } from "@/modules/attendance/components/OperationalWorkflowCard";
import { OperationalTimeline } from "@/modules/attendance/components/OperationalTimeline";
import { agreementRiskStyles, agreementStatusStyles } from "@/modules/attendance/agreements";
import { priorityStyles } from "@/modules/attendance/priority";
import { workflowStageStyles } from "@/modules/attendance/workflow";
import type { OperationalTimelineEvent, PortfolioUnit, QueueClient } from "@/modules/attendance/types";

type ClientDetailPanelProps = {
  client: QueueClient;
  extraTimelineEvents?: OperationalTimelineEvent[];
  onOpenWhatsApp: () => void;
};
type WorkspaceTab = "overview" | "client" | "portfolio" | "timeline" | "agreements";
type UnitSubtab = "summary" | "installments" | "agreements" | "timeline" | "risk" | "documents";

const workspaceTabs: Array<{ id: WorkspaceTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Visão geral", icon: LayoutDashboard },
  { id: "client", label: "Cliente", icon: Building2 },
  { id: "portfolio", label: "Carteira", icon: MapPinned },
  { id: "timeline", label: "Timeline", icon: Clock3 },
  { id: "agreements", label: "Acordos", icon: HandCoins },
];

const unitSubtabs: Array<{ id: UnitSubtab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "summary", label: "Resumo da unidade", icon: LayoutDashboard },
  { id: "installments", label: "Parcelas", icon: ReceiptText },
  { id: "agreements", label: "Acordos", icon: HandCoins },
  { id: "timeline", label: "Timeline", icon: Clock3 },
  { id: "risk", label: "Risco", icon: ShieldAlert },
  { id: "documents", label: "Documentos da unidade", icon: FileText },
];

export function ClientDetailPanel({
  client,
  extraTimelineEvents = [],
  onOpenWhatsApp,
}: ClientDetailPanelProps) {
  const firstUnitId = client.carteira.unidades[0]?.id ?? "";
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [portfolioUnitId, setPortfolioUnitId] = useState(firstUnitId);
  const [portfolioListCollapsed, setPortfolioListCollapsed] = useState(false);
  const [portfolioMaximized, setPortfolioMaximized] = useState(false);
  const [unitSubtab, setUnitSubtab] = useState<UnitSubtab>("summary");
  const [unitFilterId, setUnitFilterId] = useState<"all" | string>("all");
  const [agreementFocus, setAgreementFocus] = useState<"default" | "recovery">("default");
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [riskModalOpen, setRiskModalOpen] = useState(false);

  const portfolioUnit =
    client.carteira.unidades.find((unit) => unit.id === portfolioUnitId) ?? client.carteira.unidades[0];
  const timelineEvents = [...extraTimelineEvents, ...client.timeline];

  function openPortfolio(unitId?: string) {
    if (unitId) {
      setPortfolioUnitId(unitId);
      setUnitSubtab("summary");
    }
    setActiveTab("portfolio");
  }

  function goToAgreements(focus: "default" | "recovery" = "default") {
    setAgreementFocus(focus);
    setActiveTab("agreements");
  }

  function openUnitSubtab(subtab: UnitSubtab, unitId = portfolioUnitId || firstUnitId) {
    setPortfolioUnitId(unitId);
    setUnitSubtab(subtab);
    setActiveTab("portfolio");
  }

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] xl:h-[calc(100vh-112px)]">
      <header className="shrink-0 border-b border-slate-100 px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
                <Building2 className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold tracking-normal text-slate-950">{client.nome}</h2>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {client.segmento} · {client.carteira.empreendimento}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenWhatsApp}
              title="Abrir WhatsApp"
              aria-label="Abrir WhatsApp"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100"
            >
              <MessageCircle className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setAiModalOpen(true)}
              title="Sugestões IA"
              aria-label="Sugestões IA"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
            >
              <Brain className="size-4" aria-hidden="true" />
            </button>
            <span title={`Workflow: ${client.workflow.stage}`} className={`inline-flex size-8 items-center justify-center rounded-lg text-xs font-semibold ring-1 ring-inset ${workflowStageStyles[client.workflow.stage]}`}>
              WF
            </span>
            <span title={`Prioridade: ${client.prioridade}`} className={`inline-flex size-8 items-center justify-center rounded-lg text-xs font-semibold ring-1 ring-inset ${priorityStyles[client.prioridade]}`}>
              P
            </span>
          </div>
        </div>

        <nav className="mt-3 flex w-fit gap-1 overflow-x-auto rounded-xl border border-slate-200/70 bg-white p-1" aria-label="Workspace operacional">
          {workspaceTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;

            return (
              <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.label}
                  aria-label={tab.label}
                  className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors ${
                    active
                      ? "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/20"
                      : "bg-white text-slate-600 ring-slate-200/70 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                >
                  <Icon className={`size-4 ${active ? "text-[#A07C3B]" : "text-slate-400"}`} />
              </button>
            );
          })}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/35 p-4 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin] sm:p-5 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
        <div className="space-y-5">
          {renderWorkspaceTab({
            activeTab,
            agreementFocus,
            client,
            onOpenWhatsApp,
            onGoToAgreements: goToAgreements,
            onOpenRiskAnalysis: () => setRiskModalOpen(true),
            onGoToTimeline: () => setActiveTab("timeline"),
            onOpenAi: () => setAiModalOpen(true),
            onOpenPortfolio: openPortfolio,
            onOpenUnitSubtab: openUnitSubtab,
            onTogglePortfolioCollapsed: () => setPortfolioListCollapsed((current) => !current),
            onTogglePortfolioMaximized: () => setPortfolioMaximized((current) => !current),
            onSetUnitSubtab: setUnitSubtab,
            onUnitFilterChange: setUnitFilterId,
            portfolioListCollapsed,
            portfolioMaximized,
            portfolioUnit,
            timelineEvents,
            unitFilterId,
            unitSubtab,
          })}
        </div>
      </div>

      <AiSuggestionsModal client={client} open={aiModalOpen} onClose={() => setAiModalOpen(false)} />
      <RiskAnalysisModal
        client={client}
        open={riskModalOpen}
        onClose={() => setRiskModalOpen(false)}
      />
    </section>
  );
}

function renderWorkspaceTab(props: {
  activeTab: WorkspaceTab;
  agreementFocus: "default" | "recovery";
  client: QueueClient;
  onOpenWhatsApp: () => void;
  onGoToAgreements: (focus?: "default" | "recovery") => void;
  onGoToTimeline: () => void;
  onOpenAi: () => void;
  onOpenRiskAnalysis: () => void;
  onOpenPortfolio: (unitId?: string) => void;
  onOpenUnitSubtab: (subtab: UnitSubtab, unitId?: string) => void;
  onTogglePortfolioCollapsed: () => void;
  onTogglePortfolioMaximized: () => void;
  onSetUnitSubtab: (subtab: UnitSubtab) => void;
  onUnitFilterChange: (unitId: "all" | string) => void;
  portfolioListCollapsed: boolean;
  portfolioMaximized: boolean;
  portfolioUnit?: PortfolioUnit;
  timelineEvents: OperationalTimelineEvent[];
  unitFilterId: "all" | string;
  unitSubtab: UnitSubtab;
}) {
  const {
    activeTab,
    agreementFocus,
    client,
    onOpenWhatsApp,
    onGoToAgreements,
    onGoToTimeline,
    onOpenAi,
    onOpenRiskAnalysis,
    onOpenPortfolio,
    onOpenUnitSubtab,
    onTogglePortfolioCollapsed,
    onTogglePortfolioMaximized,
    onSetUnitSubtab,
    onUnitFilterChange,
    portfolioListCollapsed,
    portfolioMaximized,
    portfolioUnit,
    timelineEvents,
    unitFilterId,
    unitSubtab,
  } = props;
  const selectedAgreementUnit =
    unitFilterId === "all"
      ? undefined
      : client.carteira.unidades.find((unit) => unit.id === unitFilterId);

  switch (activeTab) {
    case "client":
      return <ClientTab client={client} />;
    case "portfolio":
      return (
        <PortfolioTab
          client={client}
          listCollapsed={portfolioListCollapsed}
          maximized={portfolioMaximized}
          onToggleCollapsed={onTogglePortfolioCollapsed}
          onToggleMaximized={onTogglePortfolioMaximized}
          selectedUnit={portfolioUnit}
          selectedSubtab={unitSubtab}
          timelineEvents={timelineEvents}
          onSelectSubtab={onSetUnitSubtab}
          onSelectUnit={(unitId) => onOpenUnitSubtab("summary", unitId)}
        />
      );
    case "timeline":
      return (
        <OperationalTimeline events={timelineEvents} />
      );
    case "agreements":
      return (
        <>
          <UnitScopeControl client={client} selectedUnitId={unitFilterId} onChange={onUnitFilterChange} />
          {agreementFocus === "recovery" ? <RecoveryFocus client={client} /> : null}
          <AgreementsCenterCard
            key={`${client.id}-${selectedAgreementUnit?.id ?? "all"}`}
            client={client}
            unit={selectedAgreementUnit}
          />
        </>
      );
    case "overview":
    default:
      return (
        <>
          <ExecutiveCockpit
            client={client}
            onGoToAgreements={onGoToAgreements}
            onOpenUnitInstallments={() => onOpenUnitSubtab("installments")}
            onOpenRiskAnalysis={onOpenRiskAnalysis}
            onGoToTimeline={onGoToTimeline}
            onOpenWhatsApp={onOpenWhatsApp}
          />
          <CommitmentOverviewCards client={client} onGoToAgreements={() => onGoToAgreements()} />
          <RiskCockpit client={client} onOpenRiskAnalysis={onOpenRiskAnalysis} />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <AiExecutiveCard client={client} onOpenAi={onOpenAi} />
            <PortfolioSummaryCard client={client} onOpenPortfolio={() => onOpenPortfolio()} />
          </div>
          <OperationalWorkflowCard client={client} />
          <OverviewTimelineAndAlerts client={client} />
        </>
      );
  }
}

function ExecutiveCockpit({
  client,
  onGoToAgreements,
  onOpenRiskAnalysis,
  onOpenUnitInstallments,
  onGoToTimeline,
  onOpenWhatsApp,
}: {
  client: QueueClient;
  onGoToAgreements: (focus?: "default" | "recovery") => void;
  onOpenRiskAnalysis: () => void;
  onOpenUnitInstallments: () => void;
  onGoToTimeline: () => void;
  onOpenWhatsApp: () => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <ActionMetric label="Saldo em atraso" value={client.saldoDevedor} onClick={onOpenUnitInstallments} />
      <ActionMetric label="Score de risco" value={`${client.scoreRisco}/100`} tone="danger" onClick={onOpenRiskAnalysis} />
      <ActionMetric label="Status do acordo" value={client.agreement.status} tone="gold" onClick={() => onGoToAgreements()} />
      <ActionMetric label="Valor recuperado" value={client.agreement.recoveredValue} tone="gold" onClick={() => onGoToAgreements("recovery")} />
      <ActionMetric label="Parcelas vencidas" value={`${client.parcelas.vencidas}`} tone="danger" onClick={onOpenUnitInstallments} />
      <ActionMetric label="Próxima ação" value={client.workflow.nextAction} onClick={onGoToTimeline} compact />
      <ActionMetric label="WhatsApp" value={client.dados360.telefone} tone="gold" onClick={onOpenWhatsApp} />
    </div>
  );
}

function CommitmentOverviewCards({
  client,
  onGoToAgreements,
}: {
  client: QueueClient;
  onGoToAgreements: () => void;
}) {
  const promises = client.commitments.filter((commitment) => commitment.type === "Promessa de pagamento");
  const agreements = client.commitments.filter((commitment) => commitment.type === "Acordo");
  const fulfilled = promises.filter((promise) => promise.status === "Cumprida").length;
  const broken = promises.filter((promise) => promise.status === "Quebrada").length;
  const open = promises.filter((promise) =>
    ["Promessa realizada", "Aguardando pagamento", "Reagendada"].includes(promise.status)
  ).length;
  const activeAgreements = agreements.filter((agreement) =>
    ["Ativo", "Formalizando", "Em negociação", "Reativado"].includes(agreement.status)
  ).length;
  const concluded = fulfilled + broken;
  const fulfillmentRate = concluded > 0 ? Math.round((fulfilled / concluded) * 100) : 0;
  const promisedValue = promises.reduce((total, promise) => total + parseMoney(promise.promisedValue), 0);

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <ActionMetric label="Promessas em aberto" value={`${open}`} tone="gold" onClick={onGoToAgreements} />
      <ActionMetric label="Promessas cumpridas" value={`${fulfilled}`} onClick={onGoToAgreements} />
      <ActionMetric label="Promessas quebradas" value={`${broken}`} tone="danger" onClick={onGoToAgreements} />
      <ActionMetric label="Acordos ativos" value={`${activeAgreements}`} tone="gold" onClick={onGoToAgreements} />
      <ActionMetric label="Taxa de cumprimento" value={`${fulfillmentRate}%`} onClick={onGoToAgreements} />
      <ActionMetric label="Valor prometido" value={formatMoney(promisedValue)} tone="gold" onClick={onGoToAgreements} />
      <ActionMetric label="Valor recuperado" value={client.agreement.recoveredValue} tone="gold" onClick={onGoToAgreements} />
      <ActionMetric label="Risco de quebra" value={`${client.agreement.aiSuggestion.breakChance}%`} tone="danger" onClick={onGoToAgreements} />
    </div>
  );
}

function AiExecutiveCard({ client, onOpenAi }: { client: QueueClient; onOpenAi: () => void }) {
  return (
    <DetailSection title="Copiloto IA" icon={Brain} accent>
      <div className="grid gap-3">
        <InfoPanel title="Análise executiva" value={client.aiSuggestion} />
        <InfoPanel
          title="Diagnóstico de risco"
          value={`Score ${client.scoreRisco}/100, risco de acordo ${client.agreement.risk} e ${client.agreement.aiSuggestion.breakChance}% de chance de quebra.`}
        />
        <InfoPanel title="Recomendação de acordo" value={client.agreement.aiSuggestion.composition} />
        <InfoPanel title="Alerta operacional" value={client.agreement.aiSuggestion.nextAction} />
      </div>
      <button
        type="button"
        onClick={onOpenAi}
        title="Abrir sugestões IA"
        aria-label="Abrir sugestões IA"
        className="mt-4 inline-flex size-9 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
      >
        <Brain className="size-4" aria-hidden="true" />
      </button>
    </DetailSection>
  );
}

function RiskCockpit({
  client,
  onOpenRiskAnalysis,
}: {
  client: QueueClient;
  onOpenRiskAnalysis: () => void;
}) {
  const evasionTrend = Math.min(client.scoreRisco + Math.floor(client.atrasoDias / 3), 96);
  const financialRisk = client.agreement.aiSuggestion.breakChance;

  return (
    <DetailSection title="Cockpit de risco" icon={ShieldAlert} accent>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={onOpenRiskAnalysis}
          title="Abrir análise de risco"
          className="rounded-xl border border-slate-200/70 bg-white p-4 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
        >
          <p className="text-xs font-medium text-slate-500">Score de risco</p>
          <p className="mt-2 text-lg font-semibold text-rose-700">{client.scoreRisco}/100</p>
          <ArrowRight className="mt-2 size-3.5 text-[#A07C3B]" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onOpenRiskAnalysis}
          title="Abrir análise de risco"
          className="rounded-xl border border-slate-200/70 bg-white p-4 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
        >
          <p className="text-xs font-medium text-slate-500">Tendência de evasão</p>
          <p className="mt-2 text-lg font-semibold text-slate-950">{evasionTrend}%</p>
          <p className="mt-2 text-xs text-slate-500">Baseada em atraso e resposta operacional</p>
        </button>
        <button
          type="button"
          onClick={onOpenRiskAnalysis}
          title="Abrir análise de risco"
          className="rounded-xl border border-slate-200/70 bg-white p-4 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
        >
          <p className="text-xs font-medium text-slate-500">Risco operacional</p>
          <p className="mt-2 text-lg font-semibold text-[#7A5E2C]">{client.workflow.stage}</p>
          <p className="mt-2 text-xs text-slate-500">Etapa atual do workflow</p>
        </button>
        <button
          type="button"
          onClick={onOpenRiskAnalysis}
          title="Abrir análise de risco"
          className="rounded-xl border border-slate-200/70 bg-white p-4 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
        >
          <p className="text-xs font-medium text-slate-500">Risco financeiro</p>
          <p className="mt-2 text-lg font-semibold text-rose-700">{financialRisk}%</p>
          <p className="mt-2 text-xs text-slate-500">Chance de quebra do acordo</p>
        </button>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <InfoPanel
          title="Comportamento do cliente"
          value={`${client.parcelas.vencidas} parcela(s) vencida(s), ${client.atrasoDias} dias de atraso e status operacional ${client.workflow.stage.toLowerCase()}.`}
        />
        <InfoPanel
          title="Alerta crítico"
          value={
            client.agreement.aiSuggestion.breakChance >= 50
              ? "Acordo exige acompanhamento humano próximo e lembrete antes do vencimento."
              : "Risco sob controle, manter régua preventiva e monitorar compensação."
          }
        />
        <InfoPanel title="Próxima ação recomendada" value={client.workflow.nextAction} />
      </div>
    </DetailSection>
  );
}

function ClientTab({ client }: { client: QueueClient }) {
  return (
    <>
      <ExpandableDetailSection
        title="Dados do cliente"
        icon={Building2}
        className="p-6"
        primaryItems={[
          { label: "Nome", value: client.nome },
          { label: "CPF", value: client.cpf },
          { label: "Telefone", value: client.dados360.telefone },
          { label: "Idade", value: client.dados360.idade },
          { label: "Profissão", value: client.dados360.profissao },
        ]}
        expandedItems={[
          { label: "Estado civil", value: client.dados360.estadoCivil },
          { label: "Sexo", value: client.dados360.sexo },
          { label: "Cidade", value: client.dados360.cidade },
          { label: "Renda", value: client.dados360.faixaSalarial },
          { label: "Cônjuge", value: client.dados360.conjuge },
          { label: "Nascimento", value: client.dados360.nascimento },
          { label: "E-mail", value: client.dados360.email },
          { label: "Relacionamento", value: client.dados360.relacionamento },
        ]}
        buttonLabel="Ver mais"
        expandedLayout="list"
      />
      <DocumentsTab client={client} />
    </>
  );
}

function PortfolioSummaryCard({ client, onOpenPortfolio }: { client: QueueClient; onOpenPortfolio: () => void }) {
  const mainUnit = client.carteira.unidades[0];

  return (
    <DetailSection title="Resumo da carteira" icon={MapPinned}>
      <div className="grid gap-3">
        <CompactInfo label="Unidades/lotes" value={`${client.carteira.unidades.length}`} />
        <CompactInfo label="Empreendimento principal" value={mainUnit?.empreendimento ?? "-"} />
        <CompactInfo label="Valor de tabela" value={mainUnit?.valorTabela ?? "-"} />
      </div>
      <button
        type="button"
        onClick={onOpenPortfolio}
        className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 px-3 text-sm font-medium text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
      >
        Ver carteira
        <ArrowRight className="size-4" aria-hidden="true" />
      </button>
    </DetailSection>
  );
}

function PortfolioTab({
  client,
  listCollapsed,
  maximized,
  onSelectSubtab,
  onSelectUnit,
  onToggleCollapsed,
  onToggleMaximized,
  selectedSubtab,
  selectedUnit,
  timelineEvents,
}: {
  client: QueueClient;
  listCollapsed: boolean;
  maximized: boolean;
  onSelectSubtab: (subtab: UnitSubtab) => void;
  onSelectUnit: (unitId: string) => void;
  onToggleCollapsed: () => void;
  onToggleMaximized: () => void;
  selectedSubtab: UnitSubtab;
  selectedUnit?: PortfolioUnit;
  timelineEvents: OperationalTimelineEvent[];
}) {
  if (!selectedUnit) return null;

  return (
    <section
      className={`grid gap-4 transition-[grid-template-columns] duration-300 ease-out ${
        maximized
          ? "grid-cols-1"
          : listCollapsed
            ? "grid-cols-[52px_minmax(0,1fr)]"
            : "2xl:grid-cols-[360px_minmax(0,1fr)]"
      }`}
    >
      {!maximized ? (
        <aside
          className={`min-w-0 rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-300 ${
            listCollapsed ? "p-2" : "p-4"
          }`}
        >
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={listCollapsed ? "Expandir lista de unidades" : "Recolher lista de unidades"}
            className="mb-3 flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-[#A07C3B] transition-colors hover:bg-[#A07C3B]/5"
          >
            {listCollapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-4" aria-hidden="true" />
            )}
          </button>

          {listCollapsed ? (
            <div className="flex flex-col items-center gap-2">
              {client.carteira.unidades.map((unit, index) => (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => {
                    onSelectUnit(unit.id);
                    onSelectSubtab("summary");
                  }}
                  title={`${unit.empreendimento} · ${unit.quadra} ${unit.lote}`}
                  className={`flex size-8 items-center justify-center rounded-lg text-xs font-semibold ring-1 ring-inset transition-colors ${
                    selectedUnit.id === unit.id
                      ? "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/20"
                      : "bg-slate-50 text-slate-500 ring-slate-200/70 hover:bg-[#A07C3B]/5"
                  }`}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="mb-4">
                <p className="text-sm font-semibold text-slate-950">Unidades e lotes</p>
                <p className="mt-1 text-xs text-slate-500">Selecione uma unidade para operar.</p>
              </div>

              <div className="space-y-3">
          {client.carteira.unidades.map((unit) => (
            <button
              type="button"
              key={unit.id}
              onClick={() => {
                onSelectUnit(unit.id);
                onSelectSubtab("summary");
              }}
              className={`group w-full rounded-xl border p-4 text-left transition-colors ${
                selectedUnit.id === unit.id
                  ? "border-[#A07C3B]/30 bg-[#A07C3B]/5"
                  : "border-slate-200/70 bg-slate-50/60 hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
              }`}
            >
              <p className="text-sm font-semibold text-slate-950">{unit.empreendimento}</p>
              <p className="mt-1 text-xs text-slate-500">
                Quadra {unit.quadra} · Lote {formatLote(unit.lote)} · {unit.area}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <CompactInfo label="Cod. unidade" value={unit.matricula} />
                <CompactInfo label="Valor" value={unit.valorTabela} />
              </div>
            </button>
          ))}
              </div>
            </>
          )}
        </aside>
      ) : null}

      <DetailSection title="Unidade selecionada" icon={MapPinned} accent>
        <div className="mb-5 flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-slate-950">{selectedUnit.empreendimento}</h3>
              <span className="w-fit rounded-full border border-[#A07C3B]/15 bg-[#A07C3B]/5 px-2.5 py-1 text-xs font-medium text-[#7A5E2C]">
                {selectedUnit.statusVenda}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Quadra {selectedUnit.quadra} · Lote {formatLote(selectedUnit.lote)} · {selectedUnit.area}
            </p>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <button
              type="button"
              onClick={onToggleMaximized}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
            >
              {maximized ? (
                <Minimize2 className="size-4 text-[#A07C3B]" aria-hidden="true" />
              ) : (
                <Maximize2 className="size-4 text-[#A07C3B]" aria-hidden="true" />
              )}
              {maximized ? "Sair do modo maximizado" : "Maximizar detalhe"}
            </button>
            <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[520px]">
              <CompactInfo label="Cod. unidade" value={selectedUnit.matricula} />
              <CompactInfo label="Valor de tabela" value={selectedUnit.valorTabela} />
              <CompactInfo label="Corretor" value={selectedUnit.imobiliariaCorretor} />
            </div>
          </div>
        </div>

        <SubtabNav selectedSubtab={selectedSubtab} onSelectSubtab={onSelectSubtab} />

        <div className="mt-5">{renderUnitSubtab(client, selectedUnit, selectedSubtab, timelineEvents)}</div>
      </DetailSection>
    </section>
  );
}

function SubtabNav({
  onSelectSubtab,
  selectedSubtab,
}: {
  onSelectSubtab: (subtab: UnitSubtab) => void;
  selectedSubtab: UnitSubtab;
}) {
  return (
    <nav className="flex w-fit gap-1 overflow-x-auto rounded-xl border border-slate-200/70 bg-white p-1" aria-label="Detalhes da unidade">
      {unitSubtabs.map((tab) => {
        const Icon = tab.icon;
        const active = selectedSubtab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectSubtab(tab.id)}
            title={tab.label}
            aria-label={tab.label}
            className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors ${
              active
                ? "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/20"
                : "bg-white text-slate-600 ring-slate-200/70 hover:bg-slate-50"
            }`}
          >
            <Icon className={`size-3.5 ${active ? "text-[#A07C3B]" : "text-slate-400"}`} />
          </button>
        );
      })}
    </nav>
  );
}

function renderUnitSubtab(
  client: QueueClient,
  unit: PortfolioUnit,
  subtab: UnitSubtab,
  timelineEvents: OperationalTimelineEvent[]
) {
  if (subtab === "installments") return <InstallmentsCard client={client} unit={unit} />;
  if (subtab === "agreements") {
    return (
      <>
        <UnitContext label="Acordos filtrados pela unidade" unit={unit} />
        <AgreementsCenterCard key={`${client.id}-${unit.id}`} client={client} unit={unit} />
      </>
    );
  }
  if (subtab === "timeline") {
    return (
      <>
        <UnitContext label="Timeline filtrada pela unidade" unit={unit} />
        <OperationalTimeline events={timelineEvents} />
      </>
    );
  }
  if (subtab === "risk") return <RiskTab client={client} unit={unit} />;
  if (subtab === "documents") return <DocumentsTab client={client} unit={unit} />;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <CompactInfo label="Empreendimento" value={unit.empreendimento} />
      <CompactInfo label="Quadra" value={unit.quadra} />
      <CompactInfo label="Lote" value={formatLote(unit.lote)} />
      <CompactInfo label="Cod. unidade" value={unit.matricula} />
      <CompactInfo label="Área" value={unit.area} />
      <CompactInfo label="Valor de tabela" value={unit.valorTabela} />
      <CompactInfo label="Status do contrato" value={unit.statusVenda} />
      <CompactInfo label="Imobiliária/corretor" value={unit.imobiliariaCorretor} />
    </div>
  );
}

function UnitScopeControl({
  client,
  onChange,
  selectedUnitId,
}: {
  client: QueueClient;
  onChange: (unitId: "all" | string) => void;
  selectedUnitId: "all" | string;
}) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-3">
      <label className="flex flex-col gap-2 text-xs font-semibold text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        Filtrar por unidade/lote
        <select
          value={selectedUnitId}
          onChange={(event) => onChange(event.target.value as "all" | string)}
          className="h-9 rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition-colors hover:bg-slate-50"
        >
          <option value="all">Todas as unidades/lotes</option>
          {client.carteira.unidades.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.empreendimento} · Quadra {unit.quadra} · Lote {formatLote(unit.lote)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function RiskTab({ client, unit }: { client: QueueClient; unit?: PortfolioUnit }) {
  return (
    <>
      <DetailSection title="Risco operacional" icon={Gauge} accent>
        {unit ? <UnitContext unit={unit} label="Unidade em análise" /> : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricTile label="Score Guardian" value={`${client.scoreRisco}/100`} tone="danger" />
          <MetricTile label="Prioridade" value={client.prioridade} tone="danger" />
          <MetricTile label="Atraso médio" value={`${client.atrasoDias} dias`} />
          <MetricTile label="Risco do acordo" value={client.agreement.risk} tone="gold" />
        </div>
        <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${priorityStyles[client.prioridade]}`}>
              {client.prioridade}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${agreementRiskStyles[client.agreement.risk]}`}>
              Acordo {client.agreement.risk}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${agreementStatusStyles[client.agreement.status]}`}>
              {client.agreement.status}
            </span>
          </div>
          <p className="text-sm leading-6 text-slate-600">
            O cliente está em {client.workflow.stage.toLowerCase()}, com {client.parcelas.vencidas} parcela(s)
            vencida(s), saldo em atraso de {client.saldoDevedor} e chance de quebra de acordo de{" "}
            {client.agreement.aiSuggestion.breakChance}%.
          </p>
        </div>
      </DetailSection>
      <OperationalWorkflowCard client={client} />
    </>
  );
}

function DocumentsTab({ client, unit }: { client: QueueClient; unit?: PortfolioUnit }) {
  const unitLabel = unit
    ? `${unit.empreendimento} Q${unit.quadra.replace(/^Q/i, "")} L${formatLote(unit.lote)}`
    : "Todas as unidades";
  const documents = [
    ["Contrato de compra", unit?.matricula ?? client.carteira.unidades[0]?.matricula ?? "Sem cod. unidade", unitLabel],
    ["Boleto C2X", client.agreement.id.toUpperCase(), client.agreement.status],
    ["Histórico de cobrança", `${client.timeline.length} eventos`, "Registrado"],
    ["Minuta de acordo", `${client.agreement.installmentsCount} parcelas`, "Disponível"],
  ];
  return (
    <DetailSection title="Documentos" icon={FileText} accent>
      <div className="grid gap-3 md:grid-cols-2">
        {documents.map(([title, detail, status]) => (
          <article key={title} className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950">{title}</p>
                <p className="mt-1 truncate text-xs text-slate-500">{detail}</p>
              </div>
              <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                {status}
              </span>
            </div>
          </article>
        ))}
      </div>
    </DetailSection>
  );
}

function RiskAnalysisModal({
  client,
  onClose,
  open,
}: {
  client: QueueClient;
  onClose: () => void;
  open: boolean;
}) {
  if (!open) {
    return null;
  }

  const evasionTrend = Math.min(client.scoreRisco + Math.floor(client.atrasoDias / 3), 96);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label="Fechar análise de risco"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]"
      />

      <section className="relative z-10 w-full max-w-3xl rounded-2xl border border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
              <ShieldAlert className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-950">Análise de risco</h2>
              <p className="mt-1 text-sm text-slate-500">{client.nome}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="grid gap-4 p-5 md:grid-cols-2">
          <MetricTile label="Score de risco" value={`${client.scoreRisco}/100`} tone="danger" />
          <MetricTile label="Tendência de evasão" value={`${evasionTrend}%`} tone="danger" />
          <MetricTile label="Risco operacional" value={client.workflow.stage} tone="gold" />
          <MetricTile label="Risco financeiro" value={`${client.agreement.aiSuggestion.breakChance}%`} tone="danger" />
          <InfoPanel
            title="Diagnóstico IA"
            value={`O cliente combina ${client.atrasoDias} dias de atraso, ${client.parcelas.vencidas} parcela(s) vencida(s), acordo ${client.agreement.status.toLowerCase()} e risco ${client.agreement.risk.toLowerCase()}.`}
          />
          <InfoPanel
            title="Recomendação"
            value={client.agreement.aiSuggestion.nextAction}
          />
          <InfoPanel
            title="Comportamento do cliente"
            value="Resposta operacional recente, histórico de pagamento e sensibilidade à entrada devem orientar a abordagem consultiva."
          />
          <InfoPanel
            title="Expansão futura"
            value="Espaço preparado para séries históricas, modelos preditivos e explicabilidade do score."
          />
        </div>
      </section>
    </div>
  );
}

function OverviewTimelineAndAlerts({ client }: { client: QueueClient }) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <DetailSection title="Últimos eventos" icon={Clock3}>
        <div className="space-y-2">
          {client.timeline.slice(0, 4).map((event) => (
            <div key={event.id} className="rounded-lg border border-slate-200/70 bg-slate-50/70 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-semibold text-slate-950">{event.title}</p>
                <span className="shrink-0 text-xs text-slate-400">{event.occurredAt}</span>
              </div>
              <p className="mt-1 line-clamp-1 text-xs text-slate-500">{event.description}</p>
            </div>
          ))}
        </div>
      </DetailSection>
      <DetailSection title="Alertas importantes" icon={ShieldAlert} accent>
        <div className="space-y-2">
          <InfoPanel title="Risco de quebra" value={`${client.agreement.aiSuggestion.breakChance}% de chance prevista no acordo atual.`} />
          <InfoPanel title="Ação operacional" value={client.workflow.nextAction} />
          <InfoPanel title="Acordo" value={`${client.agreement.status}, risco ${client.agreement.risk}.`} />
        </div>
      </DetailSection>
    </div>
  );
}

function RecoveryFocus({ client }: { client: QueueClient }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <MetricTile label="Valor recuperado" value={client.agreement.recoveredValue} tone="gold" />
      <MetricTile label="Taxa de recuperação" value={`${client.agreement.recoveryRate}%`} tone="gold" />
      <MetricTile label="Valor negociado" value={client.agreement.negotiatedValue} />
    </div>
  );
}

function ActionMetric({
  compact = false,
  label,
  onClick,
  tone = "neutral",
  value,
}: {
  compact?: boolean;
  label: string;
  onClick: () => void;
  tone?: "neutral" | "gold" | "danger";
  value: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label}: ${value}`}
      className="group rounded-xl border border-slate-200/70 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
    >
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={`mt-2 font-semibold tracking-normal ${
          compact ? "line-clamp-2 text-sm leading-5" : "truncate text-lg"
        } ${tone === "danger" ? "text-rose-700" : tone === "gold" ? "text-[#7A5E2C]" : "text-slate-950"}`}
      >
        {value}
      </p>
      <ArrowRight className="mt-2 size-3.5 text-[#A07C3B] opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
    </button>
  );
}

function MetricTile({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "neutral" | "gold" | "danger";
  value: string;
}) {
  const toneClass = {
    neutral: "bg-white text-slate-950 ring-slate-200/70",
    gold: "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15",
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
  }[tone];
  return (
    <div className={`min-w-0 rounded-xl px-3 py-2.5 ring-1 ${toneClass}`}>
      <p className="truncate text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tracking-normal">{value}</p>
    </div>
  );
}

function InfoPanel({ title, value }: { title: string; value: string }) {
  return (
    <div title={value} className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">{title}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-700">{value}</p>
    </div>
  );
}

function CompactInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function UnitContext({ label, unit }: { label: string; unit: PortfolioUnit }) {
  return (
    <div className="mb-4 rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-950">
        {unit.empreendimento} · Quadra {unit.quadra} · Lote {formatLote(unit.lote)}
      </p>
    </div>
  );
}

function formatLote(lote: string) {
  return lote.replace(/^L/i, "");
}

function parseMoney(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return Number.parseFloat(normalized) || 0;
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}


