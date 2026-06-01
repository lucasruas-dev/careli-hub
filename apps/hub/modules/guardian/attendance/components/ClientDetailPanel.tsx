"use client";

import { useState } from "react";
import {
  ArrowRight,
  BotMessageSquare,
  Building2,
  ChevronDown,
  Clock3,
  ExternalLink,
  FileText,
  Gauge,
  MapPinned,
  Maximize2,
  MessageCircle,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldAlert,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { AgreementsCenterCard } from "@/modules/guardian/attendance/components/AgreementsCenterCard";
import { AiSuggestionsModal } from "@/modules/guardian/attendance/components/AiSuggestionsModal";
import { DetailSection } from "@/modules/guardian/attendance/components/DetailSection";
import { ExpandableDetailSection } from "@/modules/guardian/attendance/components/ExpandableDetailSection";
import { InstallmentsCard } from "@/modules/guardian/attendance/components/InstallmentsCard";
import { OperationalWorkflowCard } from "@/modules/guardian/attendance/components/OperationalWorkflowCard";
import { OperationalTimeline } from "@/modules/guardian/attendance/components/OperationalTimeline";
import {
  agreementRiskStyles,
  agreementStatusStyles,
} from "@/modules/guardian/attendance/agreements";
import { buildCommitmentOverviewMetrics } from "@/modules/guardian/attendance/client-commitment-metrics";
import { buildClientDocumentSummary } from "@/modules/guardian/attendance/client-document-summary";
import {
  type ClientDetailUnitSubtab as UnitSubtab,
  type ClientDetailWorkspaceTab as WorkspaceTab,
  unitSubtabs,
  workspaceTabs,
} from "@/modules/guardian/attendance/client-detail-navigation";
import { buildPaymentBehavior } from "@/modules/guardian/attendance/client-payment-behavior";
import {
  buildPortfolioSummary,
  formatPortfolioLot,
  resolvePortfolioUnit,
} from "@/modules/guardian/attendance/client-portfolio-summary";
import { buildClientProfileSummary } from "@/modules/guardian/attendance/client-profile-summary";
import { buildClientRiskMetrics } from "@/modules/guardian/attendance/client-risk-metrics";
import { priorityStyles } from "@/modules/guardian/attendance/priority";
import { workflowStageStyles } from "@/modules/guardian/attendance/workflow";
import type {
  OperationalTimelineEvent,
  PortfolioUnit,
  QueueClient,
} from "@/modules/guardian/attendance/types";

const EMPTY_FIELD = "-";
const neutralPillStyle = "bg-slate-50 text-slate-500 ring-slate-200";

function isFilledField(value: string) {
  return value.trim() !== EMPTY_FIELD;
}

type ClientDetailPanelProps = {
  client: QueueClient;
  extraTimelineEvents?: OperationalTimelineEvent[];
  onCreateCommitment?: (
    record: QueueClient["commitments"][number],
  ) => Promise<void>;
  onCreateTimelineEvent?: (event: OperationalTimelineEvent) => Promise<void>;
  onOpenWhatsApp: () => void;
  onUpdateCommitment?: (
    record: QueueClient["commitments"][number],
  ) => Promise<void>;
};
export function ClientDetailPanel({
  client,
  extraTimelineEvents = [],
  onCreateCommitment,
  onCreateTimelineEvent,
  onOpenWhatsApp,
  onUpdateCommitment,
}: ClientDetailPanelProps) {
  const firstUnitId = client.carteira.unidades[0]?.id ?? "";
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [portfolioUnitId, setPortfolioUnitId] = useState(firstUnitId);
  const [portfolioListCollapsed, setPortfolioListCollapsed] = useState(false);
  const [portfolioMaximized, setPortfolioMaximized] = useState(false);
  const [unitSubtab, setUnitSubtab] = useState<UnitSubtab>("summary");
  const [unitFilterId, setUnitFilterId] = useState<"all" | string>("all");
  const [agreementFocus, setAgreementFocus] = useState<"default" | "recovery">(
    "default",
  );
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [riskModalOpen, setRiskModalOpen] = useState(false);

  const paymentBehavior = buildPaymentBehavior(client);
  const PaymentBehaviorIcon = paymentBehavior.icon;
  const portfolioUnit = resolvePortfolioUnit(client, portfolioUnitId);
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

  function openUnitSubtab(
    subtab: UnitSubtab,
    unitId = portfolioUnitId || firstUnitId,
  ) {
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
                <h2 className="truncate text-lg font-semibold tracking-normal text-slate-950">
                  {client.nome}
                </h2>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs">
                  <span className="truncate text-slate-500">
                    {client.segmento} · {client.carteira.empreendimento}
                  </span>
                  <Tooltip content={paymentBehavior.tooltip} placement="bottom">
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${paymentBehavior.className}`}
                    >
                      <PaymentBehaviorIcon
                        className="size-3.5"
                        aria-hidden="true"
                      />
                      {paymentBehavior.label}
                    </span>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Tooltip content="Abrir Iris" placement="bottom">
              <button
                type="button"
                onClick={onOpenWhatsApp}
                aria-label="Abrir Iris"
                className="inline-flex size-9 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                <MessageCircle className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
            <Tooltip
              content={`Workflow: ${client.workflow.stage}`}
              placement="bottom"
            >
              <span
                className={`inline-flex size-8 items-center justify-center rounded-lg text-xs font-semibold ring-1 ring-inset ${workflowStageStyles[client.workflow.stage] ?? neutralPillStyle}`}
              >
                WF
              </span>
            </Tooltip>
            <Tooltip
              content={`Prioridade: ${client.prioridade}`}
              placement="bottom"
            >
              <span
                className={`inline-flex size-8 items-center justify-center rounded-lg text-xs font-semibold ring-1 ring-inset ${priorityStyles[client.prioridade] ?? neutralPillStyle}`}
              >
                P
              </span>
            </Tooltip>
          </div>
        </div>

        <nav
          className="mt-3 flex w-fit flex-wrap gap-1 rounded-xl border border-slate-200/70 bg-white p-1"
          aria-label="Workspace operacional"
        >
          {workspaceTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;

            return (
              <Tooltip key={tab.id} content={tab.label} placement="bottom">
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-label={tab.label}
                  className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors ${
                    active
                      ? "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/20"
                      : "bg-white text-slate-600 ring-slate-200/70 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                >
                  <Icon
                    className={`size-4 ${active ? "text-[#A07C3B]" : "text-slate-400"}`}
                  />
                </button>
              </Tooltip>
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
            onCreateCommitment,
            onCreateTimelineEvent,
            onOpenAi: () => setAiModalOpen(true),
            onOpenPortfolio: openPortfolio,
            onOpenUnitSubtab: openUnitSubtab,
            onTogglePortfolioCollapsed: () =>
              setPortfolioListCollapsed((current) => !current),
            onTogglePortfolioMaximized: () =>
              setPortfolioMaximized((current) => !current),
            onSetUnitSubtab: setUnitSubtab,
            onUnitFilterChange: setUnitFilterId,
            onUpdateCommitment,
            portfolioListCollapsed,
            portfolioMaximized,
            portfolioUnit,
            timelineEvents,
            unitFilterId,
            unitSubtab,
          })}
        </div>
      </div>

      <AiSuggestionsModal
        client={client}
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
      />
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
  onCreateCommitment?: (
    record: QueueClient["commitments"][number],
  ) => Promise<void>;
  onCreateTimelineEvent?: (event: OperationalTimelineEvent) => Promise<void>;
  onOpenAi: () => void;
  onOpenRiskAnalysis: () => void;
  onOpenPortfolio: (unitId?: string) => void;
  onOpenUnitSubtab: (subtab: UnitSubtab, unitId?: string) => void;
  onTogglePortfolioCollapsed: () => void;
  onTogglePortfolioMaximized: () => void;
  onSetUnitSubtab: (subtab: UnitSubtab) => void;
  onUnitFilterChange: (unitId: "all" | string) => void;
  onUpdateCommitment?: (
    record: QueueClient["commitments"][number],
  ) => Promise<void>;
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
    onCreateCommitment,
    onCreateTimelineEvent,
    onOpenAi,
    onOpenRiskAnalysis,
    onOpenPortfolio,
    onOpenUnitSubtab,
    onTogglePortfolioCollapsed,
    onTogglePortfolioMaximized,
    onSetUnitSubtab,
    onUnitFilterChange,
    onUpdateCommitment,
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
          onCreateCommitment={onCreateCommitment}
          onCreateTimelineEvent={onCreateTimelineEvent}
          onSelectSubtab={onSetUnitSubtab}
          onSelectUnit={(unitId) => onOpenUnitSubtab("summary", unitId)}
          onUpdateCommitment={onUpdateCommitment}
        />
      );
    case "timeline":
      return (
        <OperationalTimeline
          client={client}
          events={timelineEvents}
          onCreateEvent={onCreateTimelineEvent}
        />
      );
    case "agreements":
      return (
        <>
          <UnitScopeControl
            client={client}
            selectedUnitId={unitFilterId}
            onChange={onUnitFilterChange}
          />
          {agreementFocus === "recovery" ? (
            <RecoveryFocus client={client} />
          ) : null}
          <AgreementsCenterCard
            key={`${client.id}-${selectedAgreementUnit?.id ?? "all"}`}
            client={client}
            onCreateCommitment={onCreateCommitment}
            onUpdateCommitment={onUpdateCommitment}
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
          <CommitmentOverviewCards
            client={client}
            onGoToAgreements={() => onGoToAgreements()}
          />
          <RiskCockpit
            client={client}
            onOpenRiskAnalysis={onOpenRiskAnalysis}
          />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <AiExecutiveCard client={client} onOpenAi={onOpenAi} />
            <PortfolioSummaryCard
              client={client}
              onOpenPortfolio={() => onOpenPortfolio()}
            />
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
      <ActionMetric
        label="Saldo em atraso"
        value={client.saldoDevedor}
        onClick={onOpenUnitInstallments}
      />
      <ActionMetric
        label="Score de risco"
        value={`${client.scoreRisco}/100`}
        tone="danger"
        onClick={onOpenRiskAnalysis}
      />
      <ActionMetric
        label="Status do acordo"
        value={client.agreement.status}
        tone="gold"
        onClick={() => onGoToAgreements()}
      />
      <ActionMetric
        label="Valor recuperado"
        value={client.agreement.recoveredValue}
        tone="gold"
        onClick={() => onGoToAgreements("recovery")}
      />
      <ActionMetric
        label="Parcelas vencidas"
        value={`${client.parcelas.vencidas}`}
        tone="danger"
        onClick={onOpenUnitInstallments}
      />
      <ActionMetric
        label="Próxima ação"
        value={client.workflow.nextAction}
        onClick={onGoToTimeline}
        compact
      />
      <ActionMetric
        label="Iris"
        value={client.dados360.telefone}
        tone="gold"
        onClick={onOpenWhatsApp}
      />
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
  const metrics = buildCommitmentOverviewMetrics(client);

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <ActionMetric
        label="Promessas em aberto"
        value={metrics.hasCommitmentData ? `${metrics.open}` : EMPTY_FIELD}
        tone="gold"
        onClick={onGoToAgreements}
      />
      <ActionMetric
        label="Promessas cumpridas"
        value={
          metrics.hasCommitmentData ? `${metrics.fulfilled}` : EMPTY_FIELD
        }
        onClick={onGoToAgreements}
      />
      <ActionMetric
        label="Promessas quebradas"
        value={metrics.hasCommitmentData ? `${metrics.broken}` : EMPTY_FIELD}
        tone="danger"
        onClick={onGoToAgreements}
      />
      <ActionMetric
        label="Acordos ativos"
        value={
          metrics.hasCommitmentData
            ? `${metrics.activeAgreements}`
            : EMPTY_FIELD
        }
        tone="gold"
        onClick={onGoToAgreements}
      />
      <ActionMetric
        label="Taxa de cumprimento"
        value={
          metrics.hasCommitmentData
            ? `${metrics.fulfillmentRate}%`
            : EMPTY_FIELD
        }
        onClick={onGoToAgreements}
      />
      <ActionMetric
        label="Valor prometido"
        value={
          metrics.hasCommitmentData ? metrics.promisedValue : EMPTY_FIELD
        }
        tone="gold"
        onClick={onGoToAgreements}
      />
      <ActionMetric
        label="Valor recuperado"
        value={client.agreement.recoveredValue}
        tone="gold"
        onClick={onGoToAgreements}
      />
      <ActionMetric
        label="Risco de quebra"
        value={
          !isFilledField(client.agreement.risk)
            ? EMPTY_FIELD
            : `${client.agreement.aiSuggestion.breakChance}%`
        }
        tone="danger"
        onClick={onGoToAgreements}
      />
    </div>
  );
}

function AiExecutiveCard({
  client,
  onOpenAi,
}: {
  client: QueueClient;
  onOpenAi: () => void;
}) {
  const diagnostic =
    !isFilledField(client.agreement.risk)
      ? EMPTY_FIELD
      : `Score ${client.scoreRisco}/100, risco de acordo ${client.agreement.risk} e ${client.agreement.aiSuggestion.breakChance}% de chance de quebra.`;

  return (
    <DetailSection title="IA da cobrança" icon={BotMessageSquare} accent>
      <div className="grid gap-3">
        <InfoPanel title="Análise executiva" value={client.aiSuggestion} />
        <InfoPanel
          title="Diagnóstico de risco"
          value={diagnostic}
        />
        <InfoPanel
          title="Recomendação de acordo"
          value={client.agreement.aiSuggestion.composition}
        />
        <InfoPanel
          title="Alerta operacional"
          value={client.agreement.aiSuggestion.nextAction}
        />
      </div>
      <Tooltip content="Abrir sugestões IA" placement="top">
        <button
          type="button"
          onClick={onOpenAi}
          aria-label="Abrir sugestões IA"
          className="mt-4 inline-flex size-9 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
        >
          <BotMessageSquare className="size-4" aria-hidden="true" />
        </button>
      </Tooltip>
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
  const riskMetrics = buildClientRiskMetrics(client);

  return (
    <DetailSection title="Cockpit de risco" icon={ShieldAlert} accent>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Tooltip
          content="Abrir análise de risco"
          placement="top"
          className="w-full"
          triggerClassName="w-full"
        >
          <button
            type="button"
            onClick={onOpenRiskAnalysis}
            className="w-full rounded-xl border border-slate-200/70 bg-white p-4 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
          >
            <p className="text-xs font-medium text-slate-500">Score de risco</p>
            <p className="mt-2 text-lg font-semibold text-rose-700">
              {client.scoreRisco}/100
            </p>
            <ArrowRight
              className="mt-2 size-3.5 text-[#A07C3B]"
              aria-hidden="true"
            />
          </button>
        </Tooltip>
        <Tooltip
          content="Abrir análise de risco"
          placement="top"
          className="w-full"
          triggerClassName="w-full"
        >
          <button
            type="button"
            onClick={onOpenRiskAnalysis}
            className="w-full rounded-xl border border-slate-200/70 bg-white p-4 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
          >
            <p className="text-xs font-medium text-slate-500">
              Tendência de evasão
            </p>
            <p className="mt-2 text-lg font-semibold text-slate-950">
              {riskMetrics.evasionTrend}%
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Baseada em atraso e resposta operacional
            </p>
          </button>
        </Tooltip>
        <Tooltip
          content="Abrir análise de risco"
          placement="top"
          className="w-full"
          triggerClassName="w-full"
        >
          <button
            type="button"
            onClick={onOpenRiskAnalysis}
            className="w-full rounded-xl border border-slate-200/70 bg-white p-4 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
          >
            <p className="text-xs font-medium text-slate-500">
              Risco operacional
            </p>
            <p className="mt-2 text-lg font-semibold text-[#7A5E2C]">
              {client.workflow.stage}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Etapa atual do workflow
            </p>
          </button>
        </Tooltip>
        <Tooltip
          content="Abrir análise de risco"
          placement="top"
          className="w-full"
          triggerClassName="w-full"
        >
          <button
            type="button"
            onClick={onOpenRiskAnalysis}
            className="w-full rounded-xl border border-slate-200/70 bg-white p-4 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
          >
            <p className="text-xs font-medium text-slate-500">
              Risco financeiro
            </p>
            <p className="mt-2 text-lg font-semibold text-rose-700">
              {riskMetrics.financialRisk}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Chance de quebra do acordo
            </p>
          </button>
        </Tooltip>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <InfoPanel
          title="Comportamento do cliente"
          value={`${client.parcelas.vencidas} parcela(s) vencida(s), ${client.atrasoDias} dias de atraso e status operacional ${client.workflow.stage.toLowerCase()}.`}
        />
        <InfoPanel
          title="Alerta crítico"
          value={riskMetrics.criticalAlert}
        />
        <InfoPanel
          title="Próxima ação recomendada"
          value={client.workflow.nextAction}
        />
      </div>
    </DetailSection>
  );
}

function ClientTab({ client }: { client: QueueClient }) {
  const profileSummary = buildClientProfileSummary(client);

  return (
    <>
      <ExpandableDetailSection
        title="Dados do cliente"
        icon={Building2}
        className="p-6"
        primaryItems={profileSummary.primaryItems}
        expandedItems={profileSummary.expandedItems}
        buttonLabel="Ver mais"
        expandedLayout="list"
      />
      {profileSummary.spouseItems.length ? (
        <SpouseDetailsBlock
          spouseName={profileSummary.spouseName}
          items={profileSummary.spouseItems}
        />
      ) : null}
      <DocumentsTab client={client} />
    </>
  );
}

function SpouseDetailsBlock({
  spouseName,
  items,
}: {
  spouseName: string;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <details className="group rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-950">
            Dados do cônjuge
          </p>
          <p className="mt-1 truncate text-xs text-slate-500">{spouseName}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 px-2.5 py-1 text-xs font-semibold text-[#7A5E2C]">
          Expandir
          <ChevronDown
            className="size-3.5 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </span>
      </summary>
      <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <InfoPanel
              key={item.label}
              title={item.label.replace("Cônjuge ", "")}
              value={item.value}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

function PortfolioSummaryCard({
  client,
  onOpenPortfolio,
}: {
  client: QueueClient;
  onOpenPortfolio: () => void;
}) {
  const portfolioSummary = buildPortfolioSummary(client);

  return (
    <DetailSection title="Resumo da carteira" icon={MapPinned}>
      <div className="grid gap-3">
        <CompactInfo
          label="Unidades/lotes"
          value={portfolioSummary.unitsCount}
        />
        <CompactInfo
          label="Empreendimento principal"
          value={portfolioSummary.mainEnterprise}
        />
        <CompactInfo
          label="Valor de tabela"
          value={portfolioSummary.mainTableValue}
        />
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
  onCreateCommitment,
  onCreateTimelineEvent,
  onToggleCollapsed,
  onToggleMaximized,
  onUpdateCommitment,
  selectedSubtab,
  selectedUnit,
  timelineEvents,
}: {
  client: QueueClient;
  listCollapsed: boolean;
  maximized: boolean;
  onSelectSubtab: (subtab: UnitSubtab) => void;
  onSelectUnit: (unitId: string) => void;
  onCreateCommitment?: (
    record: QueueClient["commitments"][number],
  ) => Promise<void>;
  onCreateTimelineEvent?: (event: OperationalTimelineEvent) => Promise<void>;
  onToggleCollapsed: () => void;
  onToggleMaximized: () => void;
  onUpdateCommitment?: (
    record: QueueClient["commitments"][number],
  ) => Promise<void>;
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
            aria-label={
              listCollapsed
                ? "Expandir lista de unidades"
                : "Recolher lista de unidades"
            }
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
                <Tooltip
                  key={unit.id}
                  content={`${unit.empreendimento} · ${unit.quadra} ${unit.lote}`}
                  placement="right"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectUnit(unit.id);
                      onSelectSubtab("summary");
                    }}
                    className={`flex size-8 items-center justify-center rounded-lg text-xs font-semibold ring-1 ring-inset transition-colors ${
                      selectedUnit.id === unit.id
                        ? "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/20"
                        : "bg-slate-50 text-slate-500 ring-slate-200/70 hover:bg-[#A07C3B]/5"
                    }`}
                  >
                    {index + 1}
                  </button>
                </Tooltip>
              ))}
            </div>
          ) : (
            <>
              <div className="mb-4">
                <p className="text-sm font-semibold text-slate-950">
                  Unidades e lotes
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Selecione uma unidade para operar.
                </p>
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
                    <p className="text-sm font-semibold text-slate-950">
                      {unit.empreendimento}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Quadra {unit.quadra} · Lote{" "}
                      {formatPortfolioLot(unit.lote)} ·{" "}
                      {unit.area}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <CompactInfo
                        label="Cod. unidade"
                        value={unit.matricula}
                      />
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
              <h3 className="text-lg font-semibold text-slate-950">
                {selectedUnit.empreendimento}
              </h3>
              <span className="w-fit rounded-full border border-[#A07C3B]/15 bg-[#A07C3B]/5 px-2.5 py-1 text-xs font-medium text-[#7A5E2C]">
                {selectedUnit.statusVenda}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Quadra {selectedUnit.quadra} · Lote{" "}
              {formatPortfolioLot(selectedUnit.lote)} · {selectedUnit.area}
            </p>
          </div>

          <div className="flex flex-col gap-3 lg:items-end">
            <Tooltip
              content={
                maximized ? "Sair do modo maximizado" : "Maximizar detalhe"
              }
              placement="bottom"
            >
              <button
                type="button"
                onClick={onToggleMaximized}
                aria-label={
                  maximized ? "Sair do modo maximizado" : "Maximizar detalhe"
                }
                className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
              >
                {maximized ? (
                  <Minimize2
                    className="size-4 text-[#A07C3B]"
                    aria-hidden="true"
                  />
                ) : (
                  <Maximize2
                    className="size-4 text-[#A07C3B]"
                    aria-hidden="true"
                  />
                )}
              </button>
            </Tooltip>
            <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[520px]">
              <CompactInfo
                label="Cod. unidade"
                value={selectedUnit.matricula}
              />
              <CompactInfo
                label="Valor de tabela"
                value={selectedUnit.valorTabela}
              />
              <CompactInfo
                label="Imobiliária/corretor"
                value={selectedUnit.imobiliariaCorretor}
              />
            </div>
          </div>
        </div>

        <SubtabNav
          selectedSubtab={selectedSubtab}
          onSelectSubtab={onSelectSubtab}
        />

        <div className="mt-5">
          {renderUnitSubtab({
            client,
            onCreateCommitment,
            onCreateTimelineEvent,
            onUpdateCommitment,
            subtab: selectedSubtab,
            timelineEvents,
            unit: selectedUnit,
          })}
        </div>
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
    <nav
      className="flex w-fit flex-wrap gap-1 rounded-xl border border-slate-200/70 bg-white p-1"
      aria-label="Detalhes da unidade"
    >
      {unitSubtabs.map((tab) => {
        const Icon = tab.icon;
        const active = selectedSubtab === tab.id;
        return (
          <Tooltip key={tab.id} content={tab.label} placement="bottom">
            <button
              type="button"
              onClick={() => onSelectSubtab(tab.id)}
              aria-label={tab.label}
              className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors ${
                active
                  ? "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/20"
                  : "bg-white text-slate-600 ring-slate-200/70 hover:bg-slate-50"
              }`}
            >
              <Icon
                className={`size-3.5 ${active ? "text-[#A07C3B]" : "text-slate-400"}`}
              />
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function renderUnitSubtab({
  client,
  onCreateCommitment,
  onCreateTimelineEvent,
  onUpdateCommitment,
  subtab,
  timelineEvents,
  unit,
}: {
  client: QueueClient;
  unit: PortfolioUnit;
  subtab: UnitSubtab;
  timelineEvents: OperationalTimelineEvent[];
  onCreateCommitment?: (
    record: QueueClient["commitments"][number],
  ) => Promise<void>;
  onCreateTimelineEvent?: (event: OperationalTimelineEvent) => Promise<void>;
  onUpdateCommitment?: (
    record: QueueClient["commitments"][number],
  ) => Promise<void>;
}) {
  if (subtab === "installments")
    return <InstallmentsCard client={client} unit={unit} />;
  if (subtab === "agreements") {
    return (
      <>
        <UnitContext label="Acordos filtrados pela unidade" unit={unit} />
        <AgreementsCenterCard
          key={`${client.id}-${unit.id}`}
          client={client}
          onCreateCommitment={onCreateCommitment}
          onUpdateCommitment={onUpdateCommitment}
          unit={unit}
        />
      </>
    );
  }
  if (subtab === "timeline") {
    return (
      <>
        <UnitContext label="Timeline filtrada pela unidade" unit={unit} />
        <OperationalTimeline
          client={client}
          defaultUnit={unit}
          events={timelineEvents}
          onCreateEvent={onCreateTimelineEvent}
        />
      </>
    );
  }
  if (subtab === "risk") return <RiskTab client={client} unit={unit} />;
  if (subtab === "documents")
    return <DocumentsTab client={client} unit={unit} />;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <CompactInfo label="Empreendimento" value={unit.empreendimento} />
      <CompactInfo label="Quadra" value={unit.quadra} />
      <CompactInfo label="Lote" value={formatPortfolioLot(unit.lote)} />
      <CompactInfo label="Cod. unidade" value={unit.matricula} />
      <CompactInfo label="Área" value={unit.area} />
      <CompactInfo label="Valor de tabela" value={unit.valorTabela} />
      <CompactInfo label="Status do contrato" value={unit.statusVenda} />
      <CompactInfo
        label="Imobiliária/corretor"
        value={unit.imobiliariaCorretor}
      />
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
              {unit.empreendimento} · Quadra {unit.quadra} · Lote{" "}
              {formatPortfolioLot(unit.lote)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function RiskTab({
  client,
  unit,
}: {
  client: QueueClient;
  unit?: PortfolioUnit;
}) {
  return (
    <>
      <DetailSection title="Risco operacional" icon={Gauge} accent>
        {unit ? <UnitContext unit={unit} label="Unidade em análise" /> : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            label="Score Hades"
            value={`${client.scoreRisco}/100`}
            tone="danger"
          />
          <MetricTile
            label="Prioridade"
            value={client.prioridade}
            tone="danger"
          />
          <MetricTile
            label="Atraso médio"
            value={`${client.atrasoDias} dias`}
          />
          <MetricTile
            label="Risco do acordo"
            value={client.agreement.risk}
            tone="gold"
          />
        </div>
        <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${priorityStyles[client.prioridade] ?? neutralPillStyle}`}
            >
              {client.prioridade}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${agreementRiskStyles[client.agreement.risk] ?? neutralPillStyle}`}
            >
              Acordo {client.agreement.risk}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${agreementStatusStyles[client.agreement.status] ?? neutralPillStyle}`}
            >
              {client.agreement.status}
            </span>
          </div>
          <p className="text-sm leading-6 text-slate-600">
            {!isFilledField(client.agreement.risk)
              ? EMPTY_FIELD
              : `O cliente está em ${client.workflow.stage.toLowerCase()}, com ${client.parcelas.vencidas} parcela(s) vencida(s), saldo em atraso de ${client.saldoDevedor} e chance de quebra de acordo de ${client.agreement.aiSuggestion.breakChance}%.`}
          </p>
        </div>
      </DetailSection>
      <OperationalWorkflowCard client={client} />
    </>
  );
}

function DocumentsTab({
  client,
  unit,
}: {
  client: QueueClient;
  unit?: PortfolioUnit;
}) {
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(
    null,
  );
  const [documentError, setDocumentError] = useState<string | null>(null);
  const documents = buildClientDocumentSummary(client, unit);

  async function openHadesDocument(documentUrl: string, documentId: string) {
    const previewWindow = window.open("about:blank", "_blank");

    if (previewWindow) {
      previewWindow.opener = null;
    }

    try {
      setOpeningDocumentId(documentId);
      setDocumentError(null);

      const accessToken = await getHadesDocumentAccessToken();
      const response = await fetch(documentUrl, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(
          payload?.error ?? "Nao foi possivel abrir o documento.",
        );
      }

      const documentBlob = await response.blob();
      const objectUrl = window.URL.createObjectURL(documentBlob);

      if (previewWindow) {
        previewWindow.location.href = objectUrl;
      } else {
        window.open(objectUrl, "_blank", "noreferrer");
      }

      window.setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl);
      }, 60000);
    } catch (error) {
      previewWindow?.close();
      setDocumentError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel abrir o documento.",
      );
    } finally {
      setOpeningDocumentId(null);
    }
  }

  return (
    <DetailSection title="Documentos" icon={FileText} accent>
      {documentError ? (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {documentError}
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {documents.map((document) => (
          <article
            key={document.id}
            className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950">
                  {document.title}
                </p>
                {document.href ? (
                  <button
                    type="button"
                    disabled={openingDocumentId === document.id}
                    onClick={() => {
                      if (!document.href) {
                        return;
                      }

                      void openHadesDocument(document.href, document.id);
                    }}
                    className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#A07C3B]/20 bg-white px-2 py-1 text-xs font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
                  >
                    <span className="truncate">{document.detail}</span>
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </button>
                ) : (
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {document.detail}
                  </p>
                )}
                {document.meta ? (
                  <p className="mt-1 truncate text-xs font-medium text-slate-500">
                    {document.meta}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {document.unitBadge ? (
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/20">
                    {document.unitBadge}
                  </span>
                ) : null}
                <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                  {document.status}
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>
    </DetailSection>
  );
}

async function getHadesDocumentAccessToken() {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Sessao administrativa ausente.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (!accessToken) {
    throw new Error("Sessao administrativa ausente.");
  }

  return accessToken;
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

  const riskMetrics = buildClientRiskMetrics(client);

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
              <h2 className="text-base font-semibold text-slate-950">
                Análise de risco
              </h2>
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
          <MetricTile
            label="Score de risco"
            value={`${client.scoreRisco}/100`}
            tone="danger"
          />
          <MetricTile
            label="Tendência de evasão"
            value={`${riskMetrics.evasionTrend}%`}
            tone="danger"
          />
          <MetricTile
            label="Risco operacional"
            value={client.workflow.stage}
            tone="gold"
          />
          <MetricTile
            label="Risco financeiro"
            value={riskMetrics.financialRisk}
            tone="danger"
          />
          <InfoPanel
            title="Diagnóstico IA"
            value={riskMetrics.aiDiagnostic}
          />
          <InfoPanel
            title="Recomendação"
            value={client.agreement.aiSuggestion.nextAction}
          />
          <InfoPanel
            title="Comportamento do cliente"
            value={EMPTY_FIELD}
          />
          <InfoPanel
            title="Expansão futura"
            value={EMPTY_FIELD}
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
            <div
              key={event.id}
              className="rounded-lg border border-slate-200/70 bg-slate-50/70 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-semibold text-slate-950">
                  {event.title}
                </p>
                <span className="shrink-0 text-xs text-slate-400">
                  {event.occurredAt}
                </span>
              </div>
              <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                {event.description}
              </p>
            </div>
          ))}
        </div>
      </DetailSection>
      <DetailSection title="Alertas importantes" icon={ShieldAlert} accent>
        <div className="space-y-2">
          <InfoPanel
            title="Risco de quebra"
            value={
              !isFilledField(client.agreement.risk)
                ? EMPTY_FIELD
                : `${client.agreement.aiSuggestion.breakChance}% de chance prevista no acordo atual.`
            }
          />
          <InfoPanel
            title="Ação operacional"
            value={client.workflow.nextAction}
          />
          <InfoPanel
            title="Acordo"
            value={
              !isFilledField(client.agreement.risk)
                ? EMPTY_FIELD
                : `${client.agreement.status}, risco ${client.agreement.risk}.`
            }
          />
        </div>
      </DetailSection>
    </div>
  );
}

function RecoveryFocus({ client }: { client: QueueClient }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <MetricTile
        label="Valor recuperado"
        value={client.agreement.recoveredValue}
        tone="gold"
      />
      <MetricTile
        label="Taxa de recuperação"
        value={`${client.agreement.recoveryRate}%`}
        tone="gold"
      />
      <MetricTile
        label="Valor negociado"
        value={client.agreement.negotiatedValue}
      />
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
    <Tooltip
      content={`${label}: ${value}`}
      placement="bottom"
      className="w-full"
      triggerClassName="w-full"
    >
      <button
        type="button"
        onClick={onClick}
        className="group w-full rounded-xl border border-slate-200/70 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
      >
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p
          className={`mt-2 font-semibold tracking-normal ${
            compact ? "line-clamp-2 text-sm leading-5" : "truncate text-lg"
          } ${tone === "danger" ? "text-rose-700" : tone === "gold" ? "text-[#7A5E2C]" : "text-slate-950"}`}
        >
          {value}
        </p>
        <ArrowRight
          className="mt-2 size-3.5 text-[#A07C3B] opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        />
      </button>
    </Tooltip>
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
      <p className="mt-1 truncate text-lg font-semibold tracking-normal">
        {value}
      </p>
    </div>
  );
}

function InfoPanel({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
        {title}
      </p>
      <Tooltip content={value} placement="bottom">
        <span className="mt-1 line-clamp-2 text-xs leading-5 text-slate-700">
          {value}
        </span>
      </Tooltip>
    </div>
  );
}

function CompactInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200/70">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-950">
        {value}
      </p>
    </div>
  );
}

function UnitContext({ label, unit }: { label: string; unit: PortfolioUnit }) {
  return (
    <div className="mb-4 rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-950">
        {unit.empreendimento} · Quadra {unit.quadra} · Lote{" "}
        {formatPortfolioLot(unit.lote)}
      </p>
    </div>
  );
}
