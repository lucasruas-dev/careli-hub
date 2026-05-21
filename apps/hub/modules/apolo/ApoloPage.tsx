"use client";

import {
  apoloProfileLabels,
  apoloProfileOptions,
  apoloScreens,
  getApoloProfileIcon,
  type ApoloScreen,
} from "@/lib/apolo/catalog";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { ClientDetailPanel } from "@/modules/guardian/attendance/components/ClientDetailPanel";
import type {
  OperationalTimelineEvent,
  QueueClient,
} from "@/modules/guardian/attendance/types";
import type {
  ApoloAuditSignal,
  ApoloDashboardData,
  ApoloDocumentSignal,
  ApoloEntity,
  ApoloInstallment,
  ApoloProfile,
  ApoloTimelineEvent,
} from "@/lib/apolo/types";
import { Tooltip } from "@repo/uix";
import {
  BarChart3,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  CircleDollarSign,
  Clock3,
  ContactRound,
  Database,
  ExternalLink,
  FileText,
  Filter,
  HandCoins,
  Handshake,
  LayoutDashboard,
  Loader2,
  MapPinned,
  MessageCircle,
  PhoneCall,
  Plus,
  ReceiptText,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

type ApoloTab =
  | "resumo"
  | "cadastro"
  | "carteira"
  | "financeiro"
  | "documentos"
  | "timeline"
  | "auditoria";

type ApoloProfileFilter = ApoloProfile | "all";

type ApoloTabItem = {
  icon: LucideIcon;
  id: ApoloTab;
  label: string;
};

type ApoloUnitSubtab = "summary" | "installments" | "timeline" | "contract";
type ApoloFinancialSubtab = "acordos";

type ApoloPortfolioUnit = {
  area: string;
  block: string;
  contractDocumentId?: string;
  contractStatus?: string;
  contractUrl?: string;
  enterprise: string;
  id: string;
  installments: ApoloInstallment[];
  lot: string;
  referenceLabel: string;
  role: string;
  stage: string;
  tableValue: string;
  unitCode: string;
  unitLabel: string;
};

type ApoloFinancialRecordType = "Promessa de pagamento" | "Acordo";

type ApoloFinancialRecord = {
  date: string;
  enterprise: string;
  id: string;
  operator: string;
  protocol: string;
  status: string;
  title: string;
  type: ApoloFinancialRecordType;
  unitCode: string;
  unitLabel: string;
  value: string;
};

const apoloTabs = [
  { icon: LayoutDashboard, id: "resumo", label: "Resumo" },
  { icon: ContactRound, id: "cadastro", label: "Cadastro" },
  { icon: MapPinned, id: "carteira", label: "Carteira" },
  { icon: CircleDollarSign, id: "financeiro", label: "Financeiro" },
  { icon: FileText, id: "documentos", label: "Documentos" },
  { icon: Clock3, id: "timeline", label: "Timeline" },
] as const satisfies readonly ApoloTabItem[];

const apoloUnitSubtabs = [
  { icon: LayoutDashboard, id: "summary", label: "Resumo" },
  { icon: ReceiptText, id: "installments", label: "Parcelas" },
  { icon: Clock3, id: "timeline", label: "Timeline" },
  { icon: FileText, id: "contract", label: "Contrato" },
] as const satisfies readonly {
  icon: LucideIcon;
  id: ApoloUnitSubtab;
  label: string;
}[];

const apoloFinancialSubtabs = [
  { icon: HandCoins, id: "acordos", label: "Acordos" },
] as const satisfies readonly {
  icon: LucideIcon;
  id: ApoloFinancialSubtab;
  label: string;
}[];

type ManualHadesOperations = {
  commitments: QueueClient["commitments"];
  events: OperationalTimelineEvent[];
};

const emptyManualHadesOperations: ManualHadesOperations = {
  commitments: [],
  events: [],
};

export function ApoloPage() {
  const [activeScreen, setActiveScreen] = useState<ApoloScreen>("crm");
  const [activeTab, setActiveTab] = useState<ApoloTab>("resumo");
  const [dashboard, setDashboard] = useState<ApoloDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [profileFilter, setProfileFilter] = useState<ApoloProfileFilter>("all");
  const [selectedEntityId, setSelectedEntityId] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void loadDashboard();
    }, query.trim() ? 280 : 0);

    async function loadDashboard() {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        const normalizedQuery = query.trim();

        if (normalizedQuery) {
          params.set("q", normalizedQuery);
        }

        if (profileFilter !== "all") {
          params.set("profile", profileFilter);
        }

        if (!normalizedQuery) {
          params.set("limit", "20");
        }

        const accessToken = await getApoloAccessToken();
        const response = await fetch(`/api/apolo/relationships?${params.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          data?: ApoloDashboardData;
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error("Nao foi possivel carregar o CRM.");
        }

        if (active) {
          setDashboard(payload.data);
          setSelectedEntityId(payload.data.entities[0]?.id ?? "");
        }
      } catch (loadError) {
        if (active) {
          if (loadError instanceof DOMException && loadError.name === "AbortError") {
            return;
          }

          setError(loadError instanceof Error ? loadError.message : "Falha ao carregar o Apolo.");
          setDashboard(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [profileFilter, query]);

  const entities = useMemo(() => dashboard?.entities ?? [], [dashboard]);
  const filteredEntities = useMemo(
    () =>
      entities.filter((entity) =>
        matchesApoloFilters(entity, query, profileFilter),
      ),
    [entities, profileFilter, query],
  );
  const selectedEntity = useMemo(
    () =>
      filteredEntities.find((entity) => entity.id === selectedEntityId) ??
      filteredEntities[0] ??
      entities[0] ??
      null,
    [entities, filteredEntities, selectedEntityId],
  );

  useEffect(() => {
    if (!filteredEntities.some((entity) => entity.id === selectedEntityId)) {
      setSelectedEntityId(filteredEntities[0]?.id ?? "");
    }
  }, [filteredEntities, selectedEntityId]);

  useEffect(() => {
    if (selectedEntity && isApoloTabUnavailableForEntity(activeTab, selectedEntity)) {
      setActiveTab("resumo");
    }
  }, [activeTab, selectedEntity]);

  function openCommercialRelationship(label: string) {
    const normalizedLabel = label.trim();

    if (!normalizedLabel) {
      return;
    }

    setActiveScreen("crm");
    setActiveTab("resumo");
    setProfileFilter("imobiliaria");
    setQuery(normalizedLabel);
  }

  return (
    <div className="flex h-full min-h-0 max-h-full overflow-hidden bg-[#F8FAFC] text-slate-950">
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4">
        <ApoloHeader
          dashboard={dashboard}
          screen={activeScreen}
          onChangeScreen={setActiveScreen}
        />
        {activeScreen === "dashboard" ? (
          <DashboardScreen dashboard={dashboard} entities={entities} loading={loading} />
        ) : null}
        {activeScreen === "relatorios" ? (
          <ReportsScreen dashboard={dashboard} entities={entities} loading={loading} />
        ) : null}
        {activeScreen === "crm" ? (
          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden">
            <CrmCommandCenter
              dashboard={dashboard}
              entities={entities}
              filteredCount={filteredEntities.length}
              loading={loading}
              selectedEntity={selectedEntity}
            />
            <section
              className="grid min-h-0 gap-3 xl:grid-cols-[minmax(22rem,0.4fr)_minmax(0,1.6fr)]"
            >
              <EntityColumn
                entities={filteredEntities}
                error={error}
                loading={loading}
                profileFilter={profileFilter}
                query={query}
                selectedEntityId={selectedEntity?.id ?? ""}
                totalCount={dashboard?.totalCount ?? entities.length}
                onChangeProfileFilter={setProfileFilter}
                onChangeQuery={setQuery}
                onSelect={setSelectedEntityId}
              />
              <RecordWorkspace
                activeTab={activeTab}
                entity={selectedEntity}
                loading={loading}
                onChangeTab={setActiveTab}
                onOpenCommercialRelationship={openCommercialRelationship}
              />
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function ApoloHeader({
  dashboard,
  screen,
  onChangeScreen,
}: {
  dashboard: ApoloDashboardData | null;
  screen: ApoloScreen;
  onChangeScreen: (screen: ApoloScreen) => void;
}) {
  return (
    <header className="shrink-0 rounded-lg border border-slate-200/70 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <nav
          aria-label="Telas do Apolo"
          className="mr-1 flex w-fit gap-1 rounded-xl border border-slate-200/70 bg-white p-1"
        >
          {apoloScreens.map((item) => {
            const Icon = item.icon;
            const active = screen === item.id;

            return (
              <Tooltip content={item.label} key={item.id} placement="bottom">
                <button
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  className={`inline-flex size-8 items-center justify-center rounded-lg ring-1 ring-inset transition-colors ${
                    active
                      ? "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/20"
                      : "bg-white text-slate-500 ring-slate-200/70 hover:bg-slate-50 hover:text-slate-950"
                  }`}
                  onClick={() => onChangeScreen(item.id)}
                  type="button"
                >
                  <Icon className={`size-4 ${active ? "text-[#A07C3B]" : "text-slate-400"}`} />
                </button>
              </Tooltip>
            );
          })}
        </nav>
        {dashboard?.meta.status === "sync_pending" ? (
          <span className="inline-flex h-9 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800">
            Atualizacao pendente
          </span>
        ) : null}
        <HeaderAction icon={MessageCircle} label="Atendimento" tone="emerald" />
        <HeaderAction icon={FileText} label="Documentos" tone="slate" />
        <HeaderAction icon={Sparkles} label="Preenchimento assistido" tone="amber" />
        <Tooltip content="Criacao de relacionamento sera liberada no fluxo de cadastro assistido.">
          <button
            aria-label="Novo relacionamento"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-500 opacity-70"
            disabled
            type="button"
          >
            <Plus className="size-4" aria-hidden="true" />
            Novo
          </button>
        </Tooltip>
      </div>
    </header>
  );
}

function HeaderAction({
  icon: Icon,
  label,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  tone: "amber" | "emerald" | "slate";
}) {
  const toneClass = {
    amber: "border-[#A07C3B]/15 bg-[#A07C3B]/5 text-[#7A5E2C]",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    slate: "border-slate-200/70 bg-white text-slate-600",
  } as const;

  return (
    <Tooltip content={label} placement="bottom">
      <button
        aria-label={label}
        className={`inline-flex size-9 items-center justify-center rounded-lg border transition-colors hover:bg-slate-50 ${toneClass[tone]}`}
        type="button"
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function DashboardScreen({
  dashboard,
  entities,
  loading,
}: {
  dashboard: ApoloDashboardData | null;
  entities: readonly ApoloEntity[];
  loading: boolean;
}) {
  const usuarioCount = profileCount(dashboard, "usuario");
  const linkedUsers = dashboard?.linkedUsersCount ?? 0;
  const notBuyerUsers = Math.max(usuarioCount - linkedUsers, 0);
  const reviewCount = dashboard?.pendingReviewCount ?? 0;
  const averageScore = entities.length
    ? Math.round(
        entities.reduce((total, entity) => total + entity.confidenceScore, 0) /
          entities.length,
      )
    : 0;

  return (
    <section className="grid min-h-0 flex-1 gap-3 overflow-y-auto">
      <ApoloProfileMetrics dashboard={dashboard} loading={loading} />
      <div className="grid gap-3 lg:grid-cols-4">
        <InsightCard
          icon={<Database className="size-4" aria-hidden="true" />}
          label="Base mestre"
          value={loading ? "--" : formatCount(dashboard?.totalCount ?? 0)}
          helper="Relacionamentos no Apolo"
        />
        <InsightCard
          icon={<CheckCircle2 className="size-4" aria-hidden="true" />}
          label="Usuarios compradores"
          value={loading ? "--" : formatCount(linkedUsers)}
          helper="Com vinculo comercial"
        />
        <InsightCard
          icon={<UsersRound className="size-4" aria-hidden="true" />}
          label="Usuarios nao compradores"
          value={loading ? "--" : formatCount(notBuyerUsers)}
          helper="Sem compra/vinculo confirmado"
        />
        <InsightCard
          icon={<ShieldCheck className="size-4" aria-hidden="true" />}
          label="Qualidade media"
          value={loading ? "--" : `${averageScore}%`}
          helper={`${formatCount(reviewCount)} cadastro(s) em revisao`}
        />
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <PanelTitle eyebrow="Insights CRM" title="Leitura operacional da base" />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <InfoTile label="Perfis comerciais" value={formatCount(profileCount(dashboard, "incorporador") + profileCount(dashboard, "imobiliaria") + profileCount(dashboard, "corretor"))} />
            <InfoTile label="Contatos cadastrados" value={formatCount(entities.reduce((total, entity) => total + entity.contacts.length, 0))} />
            <InfoTile label="Vinculos visiveis" value={formatCount(entities.reduce((total, entity) => total + entity.relationships.length, 0))} />
          </div>
        </section>
        <section className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <PanelTitle eyebrow="Proximas acoes" title="Fila de saneamento" />
          <div className="mt-4 grid gap-2">
            <StatusLine label={`${formatCount(notBuyerUsers)} usuario(s) sem compra confirmada`} status={notBuyerUsers ? "attention" : "verified"} />
            <StatusLine label={`${formatCount(reviewCount)} cadastro(s) pendente(s) de revisao`} status={reviewCount ? "pending" : "verified"} />
            <StatusLine label="Relatorios consolidados em preparacao" status="pending" />
          </div>
        </section>
      </div>
    </section>
  );
}

function ReportsScreen({
  dashboard,
  entities,
  loading,
}: {
  dashboard: ApoloDashboardData | null;
  entities: readonly ApoloEntity[];
  loading: boolean;
}) {
  return (
    <section className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto">
      <div className="grid gap-3 md:grid-cols-3">
        <InsightCard
          icon={<BarChart3 className="size-4" aria-hidden="true" />}
          label="Relatorio de perfis"
          value={loading ? "--" : formatCount(dashboard?.profileSummaries.length ?? 0)}
          helper="Distribuicao por relacionamento"
        />
        <InsightCard
          icon={<ShieldCheck className="size-4" aria-hidden="true" />}
          label="Qualidade"
          value={loading ? "--" : formatCount(dashboard?.pendingReviewCount ?? 0)}
          helper="Cadastros em revisao"
        />
        <InsightCard
          icon={<Clock3 className="size-4" aria-hidden="true" />}
          label="Timeline"
          value={formatCount(entities.reduce((total, entity) => total + entity.timeline.length, 0))}
          helper="Eventos consolidados"
        />
      </div>
      <section className="overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-100 px-5 py-4">
          <PanelTitle eyebrow="Relatorios" title="Consultas preparadas" />
        </div>
        <div className="divide-y divide-slate-100">
          {[
            ["Base por perfil", "Quantidade de usuarios, incorporadores, imobiliarias, corretores e colaboradores."],
            ["Qualidade cadastral", "Documentos, contatos, enderecos e vinculos pendentes de revisao."],
            ["Carteira e vinculos", "Usuarios compradores, nao compradores e origem comercial."],
            ["Timeline operacional", "Eventos com protocolo e informativos por relacionamento."],
          ].map(([title, description]) => (
            <div className="grid gap-1 px-5 py-4" key={title}>
              <p className="m-0 text-sm font-semibold text-slate-950">{title}</p>
              <p className="m-0 text-sm font-medium text-slate-500">{description}</p>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function InsightCard({
  helper,
  icon,
  label,
  value,
}: {
  helper: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <article className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-medium text-slate-500">{label}</p>
          <p className="m-0 mt-2 text-2xl font-semibold leading-none text-slate-950">
            {value}
          </p>
          <p className="m-0 mt-2 text-xs font-medium text-slate-500">{helper}</p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
          {icon}
        </span>
      </div>
    </article>
  );
}

function ApoloProfileMetrics({
  dashboard,
  loading,
}: {
  dashboard: ApoloDashboardData | null;
  loading: boolean;
}) {
  const metrics = dashboard?.profileSummaries ?? [];

  return (
    <section className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
      {metrics.map((metric) => {
        const Icon = getApoloProfileIcon(metric.profile);

        return (
          <MetricCard
            icon={<Icon className="size-4" aria-hidden="true" />}
            key={metric.profile}
            label={metric.label}
            loading={loading}
            value={metric.count}
          />
        );
      })}
      {!metrics.length
        ? Array.from({ length: 7 }).map((_, index) => (
            <MetricCard
              icon={<Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              key={index}
              label="Carregando"
              loading
              value={0}
            />
          ))
        : null}
    </section>
  );
}

function MetricCard({
  icon,
  label,
  loading,
  value,
}: {
  icon: ReactNode;
  label: string;
  loading: boolean;
  value: number;
}) {
  return (
    <article className="min-h-20 rounded-lg border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-medium text-slate-500">{label}</p>
          <p className="m-0 mt-2 text-xl font-semibold leading-none text-slate-950">
            {loading ? "--" : formatCount(value)}
          </p>
        </div>
        <span className="flex size-8 items-center justify-center rounded-lg bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
          {icon}
        </span>
      </div>
    </article>
  );
}

function CrmCommandCenter({
  dashboard,
  entities,
  filteredCount,
  loading,
  selectedEntity,
}: {
  dashboard: ApoloDashboardData | null;
  entities: readonly ApoloEntity[];
  filteredCount: number;
  loading: boolean;
  selectedEntity: ApoloEntity | null;
}) {
  const usuarioCount = profileCount(dashboard, "usuario");
  const pageBuyerCount = entities.filter((entity) => buyerStatusLabel(entity) === "Comprador").length;
  const buyerCount = dashboard?.buyerUsersCount ?? pageBuyerCount;
  const nonBuyerCount = dashboard?.nonBuyerUsersCount ?? Math.max(usuarioCount - pageBuyerCount, 0);
  const portfolioCount = dashboard?.portfolioUnitsCount ?? entities.reduce((total, entity) => total + entity.commercialLinks.length, 0);
  const paymentCount = dashboard?.portfolioPaymentsCount ?? 0;
  const pendingCount = selectedEntity ? countPendingSignals(selectedEntity) : dashboard?.pendingReviewCount ?? 0;

  return (
    <section className="grid shrink-0 gap-3">
      <div className="grid gap-3 md:grid-cols-4">
        <CrmSignalCard
          icon={UsersRound}
          label="Relacionamentos"
          value={loading ? "--" : formatCount(dashboard?.totalCount ?? entities.length)}
          detail={`${formatCount(filteredCount)} na consulta atual`}
        />
        <CrmSignalCard
          icon={CheckCircle2}
          label="Compradores com carteira"
          value={loading ? "--" : formatCount(buyerCount)}
          detail={`${formatCount(nonBuyerCount)} usuario(s) sem pagamento`}
        />
        <CrmSignalCard
          icon={MapPinned}
          label="Unidades em carteira"
          value={loading ? "--" : formatCount(portfolioCount)}
          detail={paymentCount > 0 ? `${formatCount(paymentCount)} pagamento(s) cruzado(s)` : "Cruzamento por pagamentos"}
        />
        <CrmSignalCard
          icon={ShieldCheck}
          label="Qualidade"
          value={loading ? "--" : `${selectedEntity?.confidenceScore ?? 0}%`}
          detail={`${formatCount(pendingCount)} ponto(s) para revisar`}
        />
      </div>
    </section>
  );
}

function CrmSignalCard({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <article className="rounded-lg border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-xs font-medium text-slate-500">{label}</p>
          <p className="m-0 mt-2 text-xl font-semibold leading-none text-slate-950">{value}</p>
          <p className="m-0 mt-2 truncate text-xs font-medium text-slate-500">{detail}</p>
        </div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
    </article>
  );
}

function EntityColumn({
  entities,
  error,
  loading,
  profileFilter,
  query,
  selectedEntityId,
  totalCount,
  onChangeProfileFilter,
  onChangeQuery,
  onSelect,
}: {
  entities: readonly ApoloEntity[];
  error: string | null;
  loading: boolean;
  profileFilter: ApoloProfileFilter;
  query: string;
  selectedEntityId: string;
  totalCount: number;
  onChangeProfileFilter: (profile: ApoloProfileFilter) => void;
  onChangeQuery: (query: string) => void;
  onSelect: (entityId: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="shrink-0 border-b border-slate-100 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-base font-semibold text-slate-950">CRM 360</h2>
            <p className="m-0 mt-1 text-xs font-medium text-slate-500">
              Pessoas, empresas, carteira e responsaveis.
            </p>
          </div>
          <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70">
            {formatCount(entities.length)}/{formatCount(totalCount)}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50/80 px-3 py-2 text-slate-500">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input
            className="w-full bg-transparent text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
            disabled={loading || Boolean(error)}
            onChange={(event) => onChangeQuery(event.target.value)}
            placeholder="Buscar nome, comprador, documento, unidade, e-mail ou responsavel"
            type="search"
            value={query}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Filtrar perfil</span>
            <Filter
              aria-hidden="true"
              className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#A07C3B]"
            />
            <select
              className="h-8 rounded-lg border border-slate-200/70 bg-white pl-8 pr-7 text-xs font-semibold text-slate-600 outline-none transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 focus:border-[#A07C3B]/35 focus:ring-2 focus:ring-[#A07C3B]/10"
              disabled={loading || Boolean(error)}
              onChange={(event) =>
                onChangeProfileFilter(event.target.value as ApoloProfileFilter)
              }
              value={profileFilter}
            >
              <option value="all">Filtros</option>
              {apoloProfileOptions.map((profile) => (
                <option key={profile} value={profile}>
                  {apoloProfileLabels[profile]}
                </option>
              ))}
            </select>
          </label>
          {profileFilter !== "all" ? (
            <button
              className="inline-flex h-7 items-center rounded-full bg-[#A07C3B]/5 px-2 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15"
              onClick={() => onChangeProfileFilter("all")}
              type="button"
            >
              {apoloProfileLabels[profileFilter]} x
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {loading ? <EntityLoadingState /> : null}
        {!loading && error ? <EntityEmptyState message={error} tone="error" /> : null}
        {!loading && !error && entities.length === 0 ? (
          <EntityEmptyState message="Nenhum relacionamento encontrado." tone="empty" />
        ) : null}
        {!loading && !error
          ? entities.map((entity) => (
              <EntityListItem
                entity={entity}
                key={entity.id}
                onSelect={() => onSelect(entity.id)}
                selected={entity.id === selectedEntityId}
              />
            ))
          : null}
      </div>
    </aside>
  );
}

function EntityLoadingState() {
  return (
    <div className="grid min-h-48 place-items-center rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm font-semibold text-slate-500">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Carregando relacionamentos reais
      </span>
    </div>
  );
}

function EntityEmptyState({
  message,
  tone,
}: {
  message: string;
  tone: "empty" | "error";
}) {
  return (
    <div
      className={`grid min-h-48 place-items-center rounded-lg border border-dashed p-4 text-center text-sm font-semibold ${
        tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 text-slate-500"
      }`}
    >
      {message}
    </div>
  );
}

function EntityListItem({
  entity,
  onSelect,
  selected,
}: {
  entity: ApoloEntity;
  onSelect: () => void;
  selected: boolean;
}) {
  const primaryProfile = primaryBusinessProfile(entity);
  const buyerLabel = buyerStatusLabel(entity);
  const financialBadge = buyerFinancialBadge(entity);
  const primaryRelationship = displayText(entity.relationships[0]?.label ?? "Vinculo em revisao");
  const isUsuario = entity.profiles.includes("usuario");
  const title = displayHeaderName(entity);

  return (
    <article
      className={`rounded-xl border p-3 transition-all ${
        selected
          ? "border-[#A07C3B]/35 bg-[#A07C3B]/5 shadow-[0_10px_30px_rgba(160,124,59,0.08)]"
          : "border-slate-100 bg-white hover:border-slate-200/80 hover:bg-slate-50/80"
      }`}
    >
      <button className="w-full text-left" onClick={onSelect} type="button">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-slate-950">
              {title}
            </p>
            <p className="m-0 mt-1 truncate text-xs text-slate-500">
              {displayText(entity.locationLabel)}
            </p>
          </div>
          {financialBadge ? (
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${financialBadge.className}`}
            >
              {financialBadge.label}
            </span>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-[#A07C3B]/8 px-2 py-1 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
            {apoloProfileLabels[primaryProfile]}
          </span>
          <span className="rounded-full bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70">
            {kindLabel(entity.kind)}
          </span>
          {isUsuario ? (
            <span
              className={`rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${
                buyerLabel === "Comprador"
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                  : "bg-amber-50 text-amber-800 ring-amber-100"
              }`}
            >
              {buyerLabel}
            </span>
          ) : null}
        </div>
        {isUsuario ? (
          <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
            <p className="m-0 text-[11px] font-medium text-slate-500">Vinculo</p>
            <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950">
              {primaryRelationship}
            </p>
          </div>
        ) : null}
      </button>
    </article>
  );
}

function RecordWorkspace({
  activeTab,
  entity,
  loading,
  onChangeTab,
  onOpenCommercialRelationship,
}: {
  activeTab: ApoloTab;
  entity: ApoloEntity | null;
  loading: boolean;
  onChangeTab: (tab: ApoloTab) => void;
  onOpenCommercialRelationship: (label: string) => void;
}) {
  if (entity && canUseHadesWorkspace()) {
    return <HadesRecordWorkspace entity={entity} />;
  }

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {entity ? <RecordHeader entity={entity} /> : <RecordHeaderEmpty loading={loading} />}
      <TabStrip activeTab={activeTab} disabled={!entity} entity={entity} onChangeTab={onChangeTab} />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {entity ? (
          <TabPanel
            activeTab={activeTab}
            entity={entity}
            onOpenCommercialRelationship={onOpenCommercialRelationship}
          />
        ) : (
          <div className="grid min-h-64 place-items-center rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm font-semibold text-slate-500">
            {loading ? "Carregando detalhe 360" : "Selecione um relacionamento"}
          </div>
        )}
      </div>
    </section>
  );
}

function HadesRecordWorkspace({ entity }: { entity: ApoloEntity }) {
  const [client, setClient] = useState<QueueClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualOperations, setManualOperations] = useState<ManualHadesOperations>(
    emptyManualHadesOperations,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadHadesClient() {
      const clientId = entity.hadesClientId;

      setClient(null);
      setError(null);
      setLoading(true);
      setManualOperations(emptyManualHadesOperations);

      if (!clientId) {
        setLoading(false);
        setError("Cadastro sem compra vinculada.");
        return;
      }

      try {
        const accessToken = await getApoloAccessToken(false);
        const headers = accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined;
        const response = await fetch(
          `/api/hades/attendance/client/${encodeURIComponent(clientId)}`,
          {
            cache: "no-store",
            headers,
          },
        );
        const payload = (await response.json().catch(() => null)) as
          | { client?: QueueClient; error?: string }
          | null;

        if (cancelled) {
          return;
        }

        if (!response.ok || !payload?.client) {
          throw new Error(payload?.error ?? "Cadastro sem carteira operacional.");
        }

        setClient(payload.client);

        if (!accessToken) {
          return;
        }

        const manualPayload = await loadHadesManualOperations(payload.client.id, accessToken);

        if (!cancelled) {
          setManualOperations(manualPayload);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? sanitizeOperationalMessage(loadError.message)
              : "Nao foi possivel carregar a carteira operacional.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadHadesClient();

    return () => {
      cancelled = true;
    };
  }, [entity.hadesClientId]);

  async function saveManualTimelineEvent(event: OperationalTimelineEvent) {
    if (!client) {
      return;
    }

    const payload = await persistHadesManualOperation({
      body: {
        client: {
          c2xAcquisitionRequestId: client.c2xAcquisitionRequestId,
          id: client.id,
          name: client.nome,
        },
        event,
        kind: "timeline",
      },
      method: "POST",
    });

    upsertManualOperations(payload);
  }

  async function saveManualCommitment(record: QueueClient["commitments"][number]) {
    if (!client) {
      return;
    }

    const payload = await persistHadesManualOperation({
      body: {
        client: {
          c2xAcquisitionRequestId: client.c2xAcquisitionRequestId,
          id: client.id,
          name: client.nome,
        },
        commitment: record,
        kind: "commitment",
      },
      method: "POST",
    });

    upsertManualOperations(payload);
  }

  async function updateManualCommitment(record: QueueClient["commitments"][number]) {
    const isPersistedRecord = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id);

    if (!isPersistedRecord) {
      await saveManualCommitment(record);
      return;
    }

    const payload = await persistHadesManualOperation({
      body: {
        commitment: record,
        id: record.id,
        kind: "commitment",
      },
      method: "PATCH",
    });

    upsertManualOperations(payload);
  }

  function upsertManualOperations(payload: ManualHadesOperations) {
    setManualOperations((current) => ({
      commitments: upsertById(payload.commitments ?? [], current.commitments),
      events: upsertById(payload.events ?? [], current.events),
    }));
  }

  if (loading) {
    return <HadesWorkspaceLoading entity={entity} />;
  }

  if (!client) {
    return <HadesUnavailableWorkspace entity={entity} message={error} />;
  }

  const clientWithManualOperations = {
    ...client,
    commitments: upsertById(manualOperations.commitments, client.commitments),
  };
  const extraTimelineEvents = upsertById(manualOperations.events, []);

  return (
    <ClientDetailPanel
      key={client.id}
      client={clientWithManualOperations}
      extraTimelineEvents={extraTimelineEvents}
      onCreateCommitment={saveManualCommitment}
      onCreateTimelineEvent={saveManualTimelineEvent}
      onOpenWhatsApp={() => {
        window.location.href = "/iris";
      }}
      onUpdateCommitment={updateManualCommitment}
    />
  );
}

function HadesWorkspaceLoading({ entity }: { entity: ApoloEntity }) {
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] xl:h-[calc(100vh-112px)]">
      <RecordHeader entity={entity} />
      <div className="grid min-h-72 flex-1 place-items-center bg-slate-50/35 p-6 text-sm font-semibold text-slate-500">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Carregando carteira, acordos, documentos e contrato
        </span>
      </div>
    </section>
  );
}

function HadesUnavailableWorkspace({
  entity,
  message,
}: {
  entity: ApoloEntity;
  message: string | null;
}) {
  const statusMessage =
    sanitizeOperationalMessage(message) ??
    "Carteira detalhada ainda nao encontrada no modulo operacional.";
  const disabledTabs = [
    { icon: LayoutDashboard, label: "Visao geral", enabled: true },
    { icon: Building2, label: "Cliente", enabled: true },
    { icon: MapPinned, label: "Carteira", enabled: false },
    { icon: Clock3, label: "Timeline", enabled: true },
    { icon: HandCoins, label: "Acordos", enabled: false },
  ] as const satisfies readonly {
    enabled: boolean;
    icon: LucideIcon;
    label: string;
  }[];

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] xl:h-[calc(100vh-112px)]">
      <RecordHeader entity={entity} />
      <nav
        aria-label="Workspace operacional"
        className="shrink-0 border-b border-slate-100 px-4 py-3"
      >
        <div className="flex w-fit flex-wrap gap-1 rounded-xl border border-slate-200/70 bg-white p-1">
          {disabledTabs.map((tab) => {
            const Icon = tab.icon;

            return (
              <Tooltip content={tab.label} key={tab.label} placement="bottom">
                <button
                  aria-label={tab.label}
                  className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${
                    tab.enabled
                      ? "bg-white text-slate-600 ring-slate-200/70"
                      : "cursor-not-allowed bg-slate-50 text-slate-300 ring-slate-200/70"
                  }`}
                  disabled={!tab.enabled}
                  type="button"
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            );
          })}
        </div>
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/35 p-4 sm:p-5">
        <div className="grid gap-5">
          <section className="rounded-xl border border-slate-200/70 bg-white p-5">
            <PanelTitle eyebrow="Visao geral" title="Cadastro no CRM com carteira operacional pendente" />
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <InfoTile label={isCompanyEntity(entity) ? "Razao social" : "Nome"} value={summaryName(entity)} />
              <InfoTile label={documentLabel(entity)} value={entity.documentMasked} />
              <InfoTile label="Perfil" value={profileLabelList(entity)} />
              <InfoTile label="Compra" value={buyerStatusLabel(entity)} />
            </div>
            <p className="m-0 mt-4 text-sm font-medium text-slate-500">
              {statusMessage}
            </p>
          </section>
          <section className="grid gap-3 md:grid-cols-3">
            <DisabledOperationCard
              icon={MapPinned}
              label="Carteira"
              value="Detalhe financeiro ainda indisponivel"
            />
            <DisabledOperationCard
              icon={HandCoins}
              label="Acordos"
              value="Aguardando carteira detalhada"
            />
            <DisabledOperationCard
              icon={FileText}
              label="Contrato"
              value="Contrato nao localizado no detalhe operacional"
            />
          </section>
          <RegistrationPanel entity={entity} />
        </div>
      </div>
    </section>
  );
}

function DisabledOperationCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <article className="rounded-xl border border-slate-200/70 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-400 ring-1 ring-slate-200/70">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-slate-950">{label}</p>
          <p className="m-0 mt-1 text-xs font-medium text-slate-500">{value}</p>
          <button
            className="mt-3 inline-flex h-8 cursor-not-allowed items-center rounded-lg border border-slate-200/70 bg-slate-50 px-3 text-xs font-semibold text-slate-400"
            disabled
            type="button"
          >
            Indisponivel
          </button>
        </div>
      </div>
    </article>
  );
}

function RecordHeader({ entity }: { entity: ApoloEntity }) {
  const primaryProfile = primaryBusinessProfile(entity);
  const registrationLabel = activeRegistrationLabel(entity);
  const headerName = displayHeaderName(entity);

  return (
    <header className="shrink-0 border-b border-slate-100 px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-[#A07C3B] ring-1 ring-slate-200/70">
              {entity.kind === "pj" || entity.kind === "organization" ? (
                <Building2 className="size-4" aria-hidden="true" />
              ) : (
                <ContactRound className="size-4" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="m-0 truncate text-lg font-semibold tracking-normal text-slate-950">
                {headerName}
              </h2>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs">
                <span className="truncate text-slate-500">
                  {entity.locationLabel}
                </span>
                <span className="inline-flex shrink-0 rounded-full bg-[#A07C3B]/8 px-2 py-1 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                  {apoloProfileLabels[primaryProfile]}
                </span>
                <span className="inline-flex shrink-0 rounded-full bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70">
                  {registrationLabel}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <HeaderAction icon={MessageCircle} label="Abrir atendimento" tone="emerald" />
          <HeaderAction icon={CalendarClock} label="Agenda" tone="amber" />
        </div>
      </div>
    </header>
  );
}

function RecordHeaderEmpty({ loading }: { loading: boolean }) {
  return (
    <header className="shrink-0 border-b border-slate-100 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-400 ring-1 ring-slate-200/70">
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ContactRound className="size-4" aria-hidden="true" />
          )}
        </div>
        <div>
          <h2 className="m-0 text-lg font-semibold text-slate-950">
            {loading ? "Carregando" : "Sem relacionamento selecionado"}
          </h2>
          <p className="m-0 mt-1 text-xs text-slate-500">
            O detalhe aparece quando houver um item selecionado.
          </p>
        </div>
      </div>
    </header>
  );
}

function TabStrip({
  activeTab,
  disabled,
  entity,
  onChangeTab,
}: {
  activeTab: ApoloTab;
  disabled: boolean;
  entity: ApoloEntity | null;
  onChangeTab: (tab: ApoloTab) => void;
}) {
  return (
    <nav
      aria-label="Areas do relacionamento"
      className="shrink-0 overflow-x-auto border-b border-slate-100 px-3 py-2"
    >
      <div className="flex gap-1">
        {apoloTabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          const tabDisabled = disabled || isApoloTabUnavailableForEntity(tab.id, entity);
          const tooltipContent = tabDisabled && entity ? `${tab.label} indisponivel sem pagamentos` : tab.label;

          return (
            <Tooltip content={tooltipContent} key={tab.id} placement="bottom">
              <button
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? "bg-slate-950 text-white"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
                disabled={tabDisabled}
                onClick={() => onChangeTab(tab.id)}
                type="button"
              >
                <Icon className="size-4" aria-hidden="true" />
                {tab.label}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}

function TabPanel({
  activeTab,
  entity,
  onOpenCommercialRelationship,
}: {
  activeTab: ApoloTab;
  entity: ApoloEntity;
  onOpenCommercialRelationship: (label: string) => void;
}) {
  if (activeTab === "cadastro") {
    return <RegistrationPanel entity={entity} />;
  }

  if (activeTab === "carteira") {
    return <PortfolioPanel entity={entity} />;
  }

  if (activeTab === "financeiro") {
    return <FinancialPanel entity={entity} />;
  }

  if (activeTab === "documentos") {
    return <DocumentsPanel entity={entity} />;
  }

  if (activeTab === "timeline") {
    return <TimelinePanel events={entity.timeline} />;
  }

  if (activeTab === "auditoria") {
    return <AuditPanel audit={entity.audit} />;
  }

  return (
    <SummaryPanel
      entity={entity}
      onOpenCommercialRelationship={onOpenCommercialRelationship}
    />
  );
}

function SummaryPanel({
  entity,
  onOpenCommercialRelationship,
}: {
  entity: ApoloEntity;
  onOpenCommercialRelationship: (label: string) => void;
}) {
  const financialBadge = buyerFinancialBadge(entity);
  const primaryEmail = primaryContact(entity, "email");
  const primaryPhone = primaryPhoneContact(entity);
  const primaryAddress = entity.addresses[0];
  const acquiredUnits = acquiredUnitsCount(entity);
  const commercialRelationship = commercialRelationshipLabel(entity);
  const isCompany = isCompanyEntity(entity);

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <PanelTitle eyebrow="Resumo" title="Resumo do relacionamento" />
          <div className="flex flex-wrap gap-1.5">
            <Pill>{apoloProfileLabels[primaryBusinessProfile(entity)]}</Pill>
            <Pill>{kindLabel(entity.kind)}</Pill>
            {financialBadge ? (
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${financialBadge.className}`}
              >
                {financialBadge.label}
              </span>
            ) : null}
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <InfoTile
            label={isCompany ? "Razao social" : "Nome"}
            value={summaryName(entity)}
          />
          <InfoTile label={documentLabel(entity)} value={entity.documentMasked} />
          <InfoTile label="E-mail" value={primaryEmail?.value ?? "-"} />
          <InfoTile label="Cidade" value={displayText(primaryAddress ? `${primaryAddress.city}-${primaryAddress.state}` : entity.locationLabel)} />
          <InfoTile label="Telefone" value={primaryPhone?.value ?? "-"} />
          <InfoTile label="Estado civil" value={civilStatusLabel(entity)} />
          <InfoTile label="Unidades adquiridas" value={String(acquiredUnits)} />
          {entity.profiles.includes("usuario") ? (
            <InfoButtonTile
              disabled={!commercialRelationship}
              label="Vinculo comercial"
              onClick={() => onOpenCommercialRelationship(commercialRelationship)}
              value={commercialRelationship || "-"}
            />
          ) : isCompany ? (
            <InfoTile label="Responsavel" value={responsibleLabel(entity) || "-"} />
          ) : (
            <InfoTile label="Proxima acao" value={entity.nextAction} />
          )}
        </div>
      </section>
    </div>
  );
}

function RegistrationPanel({ entity }: { entity: ApoloEntity }) {
  const primaryEmail = primaryContact(entity, "email");
  const primaryPhone = primaryPhoneContact(entity);
  const primaryAddress = entity.addresses[0];
  const fullAddress = fullAddressLabel(primaryAddress);
  const isCompany = isCompanyEntity(entity);
  const cadastroRows = [
    ["Nome", displayHeaderName(entity)],
    ["CPF/CNPJ", entity.documentMasked],
    ["Razao social", isCompany ? summaryName(entity) : "-"],
    ["Nome fantasia", isCompany ? displayHeaderName(entity) : "-"],
    ["Telefone", primaryPhone?.value ?? "-"],
    ["E-mail", primaryEmail?.value ?? "-"],
    ["Endereco", fullAddress],
  ] as const;
  const detailRows = [
    ["Tipo pessoa", kindLabel(entity.kind)],
    ["RG", "-"],
    ["Documento", `${documentLabel(entity)} ${entity.documentMasked}`],
    ["Nascimento", "-"],
    ["Idade", "-"],
    ["Sexo", "-"],
    ["Estado civil", civilStatusLabel(entity) || "-"],
    ["Regime de bens", "-"],
    ["Profissao", "-"],
    ["Renda", "-"],
    ["Escolaridade", "-"],
    ["Cidade", displayText(cityStateLabel(primaryAddress, entity.locationLabel))],
    ["CEP", primaryAddress?.postalCode ?? "-"],
    ["Bairro", primaryAddress?.district ?? "-"],
    ["Numero", primaryAddress?.number ?? "-"],
    ["Complemento", primaryAddress?.complement ?? "-"],
    ["Naturalidade", "-"],
    ["Nacionalidade", "-"],
    ["Nome da mae", "-"],
    ["Relacionamento", relationshipSummary(entity)],
    ["Responsavel", isCompany ? responsibleLabel(entity) || "-" : "-"],
  ] as const;

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <PanelTitle eyebrow="Dados do cliente" title="Cadastro" />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cadastroRows.map(([label, value]) => (
            <ReadonlyLine key={label} label={label} value={value || "-"} />
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <PanelTitle eyebrow="Cadastro completo" title="Dados cadastrais" />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {detailRows.map(([label, value]) => (
            <ReadonlyLine key={label} label={label} value={value || "-"} />
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <PanelTitle eyebrow="Conjuge e representantes" title="Dados complementares" />
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ReadonlyLine label="Conjuge" value="-" />
          <ReadonlyLine label="CPF" value="-" />
          <ReadonlyLine label="Telefone" value="-" />
          <ReadonlyLine label="E-mail" value="-" />
          <ReadonlyLine label="Nascimento" value="-" />
          <ReadonlyLine label="Documento" value="-" />
          <ReadonlyLine label="Profissao" value="-" />
          <ReadonlyLine label="Naturalidade" value="-" />
          <ReadonlyLine label="Nacionalidade" value="-" />
          <ReadonlyLine
            label={isCompany ? "Responsavel" : "Endereco"}
            value={isCompany ? responsibleLabel(entity) || "-" : fullAddress}
          />
        </div>
      </section>
    </div>
  );
}

function PortfolioPanel({ entity }: { entity: ApoloEntity }) {
  const units = useMemo(() => buildPortfolioUnits(entity), [entity]);
  const [selectedUnitId, setSelectedUnitId] = useState(units[0]?.id ?? "");
  const [activeUnitSubtab, setActiveUnitSubtab] = useState<ApoloUnitSubtab>("summary");

  useEffect(() => {
    if (!units.length) {
      setSelectedUnitId("");
      return;
    }

    const firstUnit = units[0];

    if (!firstUnit) {
      return;
    }

    setSelectedUnitId((current) =>
      units.some((unit) => unit.id === current) ? current : firstUnit.id,
    );
  }, [units]);

  const firstUnit = units[0];

  if (!firstUnit) {
    return <EmptyPanel text="Nenhuma carteira disponivel para este relacionamento." />;
  }

  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) ?? firstUnit;

  return (
    <section className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <aside className="rounded-xl border border-slate-200/70 bg-white p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
            <MapPinned className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="m-0 text-sm font-semibold text-slate-950">Unidades e lotes</p>
            <p className="m-0 mt-1 text-xs font-medium text-slate-500">
              Selecione uma unidade para operar.
            </p>
          </div>
        </div>
        <div className="mt-4 grid max-h-[34rem] gap-3 overflow-y-auto pr-1">
          {units.map((unit) => {
            const active = unit.id === selectedUnit.id;

            return (
              <button
                className={`rounded-xl border p-4 text-left transition-colors ${
                  active
                    ? "border-[#A07C3B]/30 bg-[#A07C3B]/5"
                    : "border-slate-200/70 bg-slate-50/60 hover:border-[#A07C3B]/20 hover:bg-[#A07C3B]/5"
                }`}
                key={unit.id}
                onClick={() => {
                  setSelectedUnitId(unit.id);
                  setActiveUnitSubtab("summary");
                }}
                type="button"
              >
                <p className="m-0 text-sm font-semibold text-slate-950">{unit.enterprise}</p>
                <p className="m-0 mt-1 text-xs font-medium text-slate-500">
                  {portfolioUnitSubtitle(unit)}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <CompactInfo label="Cod. unidade" value={unit.unitCode} />
                  <CompactInfo label="Valor" value={unit.tableValue} />
                </div>
              </button>
            );
          })}
        </div>
      </aside>
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                <MapPinned className="size-4" aria-hidden="true" />
              </span>
              <p className="m-0 text-sm font-semibold text-slate-950">Unidade selecionada</p>
            </div>
            <h3 className="m-0 mt-3 text-xl font-semibold text-slate-950">
              {selectedUnit.enterprise}
            </h3>
            <p className="m-0 mt-2 text-sm font-medium text-slate-500">
              {portfolioUnitSubtitle(selectedUnit)}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <CompactInfo label="Cod. unidade" value={selectedUnit.unitCode} />
            <CompactInfo label="Valor de tabela" value={selectedUnit.tableValue} />
            <CompactInfo label="Imobiliaria/corretor" value={selectedUnit.referenceLabel} />
          </div>
        </div>

        <ApoloUnitSubtabNav activeSubtab={activeUnitSubtab} onChange={setActiveUnitSubtab} />

        <div className="mt-5">
          {renderApoloUnitSubtab({
            activeSubtab: activeUnitSubtab,
            entity,
            unit: selectedUnit,
          })}
        </div>
      </section>
    </section>
  );
}

function ApoloUnitSubtabNav({
  activeSubtab,
  onChange,
}: {
  activeSubtab: ApoloUnitSubtab;
  onChange: (subtab: ApoloUnitSubtab) => void;
}) {
  return (
    <nav aria-label="Detalhes da unidade" className="mt-4 flex w-fit flex-wrap gap-1 rounded-xl border border-slate-200/70 bg-white p-1">
      {apoloUnitSubtabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeSubtab === tab.id;

        return (
          <Tooltip content={tab.label} key={tab.id} placement="bottom">
            <button
              aria-label={tab.label}
              className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors ${
                active
                  ? "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/20"
                  : "bg-white text-slate-600 ring-slate-200/70 hover:bg-slate-50"
              }`}
              onClick={() => onChange(tab.id)}
              type="button"
            >
              <Icon
                aria-hidden="true"
                className={`size-3.5 ${active ? "text-[#A07C3B]" : "text-slate-400"}`}
              />
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function renderApoloUnitSubtab({
  activeSubtab,
  entity,
  unit,
}: {
  activeSubtab: ApoloUnitSubtab;
  entity: ApoloEntity;
  unit: ApoloPortfolioUnit;
}) {
  if (activeSubtab === "installments") {
    return <ApoloInstallmentsPanel entity={entity} unit={unit} />;
  }

  if (activeSubtab === "timeline") {
    return <ApoloUnitTimelinePanel entity={entity} unit={unit} />;
  }

  if (activeSubtab === "contract") {
    return <ApoloUnitContractPanel unit={unit} />;
  }

  return <ApoloUnitSummary unit={unit} />;
}

function ApoloUnitSummary({
  unit,
}: {
  unit: ApoloPortfolioUnit;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <CompactInfo label="Empreendimento" value={unit.enterprise} />
      <CompactInfo label="Quadra" value={unit.block} />
      <CompactInfo label="Lote" value={unit.lot} />
      <CompactInfo label="Cod. unidade" value={unit.unitCode} />
      <CompactInfo label="Area" value={unit.area} />
      <CompactInfo label="Valor de tabela" value={unit.tableValue} />
      <CompactInfo label="Status do contrato" value={unit.stage} />
      <CompactInfo label="Imobiliaria/corretor" value={unit.referenceLabel} />
      <CompactInfo label="Papel no relacionamento" value={unit.role} />
    </div>
  );
}

function ApoloInstallmentsPanel({
  entity,
  unit,
}: {
  entity: ApoloEntity;
  unit: ApoloPortfolioUnit;
}) {
  const installments = unit.installments;
  const overdueInstallments = installments.filter((installment) => installment.status === "Vencida");
  const paidAmount = installments
    .filter((installment) => installment.status === "Liquidada")
    .reduce((total, installment) => total + installment.valueNumber, 0);
  const overdueAmount = overdueInstallments.reduce(
    (total, installment) => total + installment.valueNumber,
    0,
  );
  const totalAmount = installments.reduce(
    (total, installment) => total + installment.valueNumber,
    0,
  );
  const risk =
    overdueInstallments.length >= 7
      ? "critico"
      : overdueInstallments.length >= 3
        ? "alto"
        : overdueInstallments.length > 0
          ? "medio"
          : "baixo";

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <CompactInfo label="Valor em carteira" value={formatMoneyLabel(totalAmount, entity.financial.totalPortfolio)} />
        <CompactInfo label="Valor pago" value={formatMoneyLabel(paidAmount, entity.financial.paidAmount)} />
        <CompactInfo label="Valor em atraso" value={formatMoneyLabel(overdueAmount, entity.financial.overdueAmount)} />
        <CompactInfo label="Parcelas vencidas" value={String(overdueInstallments.length)} />
        <CompactInfo label="Risco" value={risk} />
      </div>

      <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="m-0 text-sm font-semibold text-slate-950">Lista de parcelas</p>
            <p className="m-0 mt-1 text-xs font-medium text-slate-500">
              {unit.enterprise} / {unit.unitLabel}
            </p>
          </div>
          <span className="w-fit rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
            Leitura Apolo
          </span>
        </div>

        {installments.length ? (
          <div className="grid max-h-[34rem] gap-3 overflow-y-auto pr-1">
            {installments.map((installment) => {
              const boletoUrl = installment.paymentUrl ?? installment.invoiceUrl;

              return (
                <article
                  className="rounded-xl border border-slate-200/70 bg-white p-3"
                  key={installment.id}
                >
                  <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="m-0 text-sm font-semibold text-slate-950">
                          Parcela {installment.number}
                        </p>
                        <InstallmentStatusBadge status={installment.status} />
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                        <CompactInfo label="Referencia" value={installment.reference} />
                        <CompactInfo label="Vencimento" value={installment.dueDate} />
                        <CompactInfo label="Pagamento" value={installment.paidAt ?? "-"} />
                        <CompactInfo label="Valor" value={installment.value} />
                        <CompactInfo label="Dias de atraso" value={String(installment.overdueDays)} />
                      </div>
                    </div>
                    {boletoUrl ? (
                      <a
                        className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 px-3 text-sm font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
                        href={boletoUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Abrir boleto
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-slate-200/70 bg-slate-50 px-3 text-sm font-semibold text-slate-400">
                        Sem boleto
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200/70 bg-white px-4 py-6 text-center text-sm font-medium text-slate-500">
            Nenhuma parcela real encontrada para esta unidade.
          </div>
        )}
      </div>
    </div>
  );
}

function InstallmentStatusBadge({ status }: { status: ApoloInstallment["status"] }) {
  const className = {
    "A vencer": "bg-sky-50 text-sky-700 ring-sky-100",
    Liquidada: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    Vencida: "bg-rose-50 text-rose-700 ring-rose-100",
  }[status];

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${className}`}>
      {status}
    </span>
  );
}

function ApoloUnitTimelinePanel({
  entity,
  unit,
}: {
  entity: ApoloEntity;
  unit: ApoloPortfolioUnit;
}) {
  const normalizedUnit = normalizeText(`${unit.enterprise} ${unit.unitLabel} ${unit.unitCode}`);
  const events = entity.timeline.filter((event) => {
    const normalizedEvent = normalizeText(`${event.title} ${event.description}`);
    return normalizedUnit
      .split(" ")
      .filter((part) => part.length > 2)
      .some((part) => normalizedEvent.includes(part));
  });
  const visibleEvents = events.length ? events : entity.timeline.slice(0, 4);

  if (!visibleEvents.length) {
    return <EmptyPanel text="Nenhum registro de timeline materializado para esta unidade." />;
  }

  return (
    <div className="grid gap-3">
      {visibleEvents.map((event) => (
        <article className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3" key={`${event.title}-${event.date}`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="m-0 text-sm font-semibold text-slate-950">{event.title}</p>
              <p className="m-0 mt-1 text-sm leading-6 text-slate-600">{event.description}</p>
            </div>
            <span className="w-fit rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
              {event.date}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function ApoloUnitContractPanel({ unit }: { unit: ApoloPortfolioUnit }) {
  const contractUrl = unit.contractDocumentId
    ? `/api/hades/d4sign/contracts/${encodeURIComponent(unit.contractDocumentId)}`
    : unit.contractUrl;

  return (
    <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="m-0 text-sm font-semibold text-slate-950">Contrato</p>
          <p className="m-0 mt-2 text-lg font-semibold text-[#7A5E2C]">{unit.unitCode}</p>
          <p className="m-0 mt-1 text-sm font-medium text-slate-500">
            {unit.enterprise} / {unit.unitLabel}
          </p>
        </div>
        <span className="w-fit rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
          {unit.contractStatus ?? "Nao localizado"}
        </span>
      </div>
      {contractUrl ? (
        <a
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 px-3 text-sm font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
          href={contractUrl}
          rel="noreferrer"
          target="_blank"
        >
          Abrir contrato
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      ) : (
        <button
          className="mt-4 inline-flex h-9 cursor-not-allowed items-center rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-400"
          disabled
          type="button"
        >
          Contrato nao materializado
        </button>
      )}
    </div>
  );
}

function CompactInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200/70 bg-white p-3">
      <p className="m-0 text-[11px] font-medium text-slate-500">{label}</p>
      <p className="m-0 mt-1 break-words text-sm font-semibold text-slate-950">
        {value || "-"}
      </p>
    </div>
  );
}

function FinancialPanel({ entity }: { entity: ApoloEntity }) {
  const [activeFinancialSubtab, setActiveFinancialSubtab] =
    useState<ApoloFinancialSubtab>("acordos");
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"Todos" | ApoloFinancialRecordType>("Todos");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [unitFilter, setUnitFilter] = useState("Todas");
  const units = useMemo(() => buildPortfolioUnits(entity), [entity]);
  const records = useMemo(() => buildApoloFinancialRecords(entity), [entity]);
  const statuses = useMemo(
    () => uniqueText(records.map((record) => record.status)),
    [records],
  );
  const filteredRecords = useMemo(
    () =>
      records.filter((record) => {
        const matchesType = typeFilter === "Todos" || record.type === typeFilter;
        const matchesStatus = statusFilter === "Todos" || record.status === statusFilter;
        const matchesUnit = unitFilter === "Todas" || record.unitCode === unitFilter;

        return matchesType && matchesStatus && matchesUnit;
      }),
    [records, statusFilter, typeFilter, unitFilter],
  );
  const summary = buildApoloFinancialSummary(filteredRecords);
  const activeFilters = [
    typeFilter !== "Todos" ? { label: "Tipo", value: typeFilter, clear: () => setTypeFilter("Todos") } : null,
    statusFilter !== "Todos" ? { label: "Status", value: statusFilter, clear: () => setStatusFilter("Todos") } : null,
    unitFilter !== "Todas" ? { label: "Unidade", value: unitFilter, clear: () => setUnitFilter("Todas") } : null,
  ].filter(Boolean) as Array<{ clear: () => void; label: string; value: string }>;

  return (
    <section className="grid gap-4">
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <PanelTitle eyebrow="Financeiro" title="Area financeira" />
            <p className="m-0 mt-2 text-sm font-medium text-slate-500">
              Acordos agora ficam em subaba propria para abrir espaco para novas leituras financeiras.
            </p>
          </div>
        </div>
        <FinancialSubtabNav
          activeSubtab={activeFinancialSubtab}
          onChange={setActiveFinancialSubtab}
        />
      </section>
      {activeFinancialSubtab === "acordos" ? (
        <>
          <section className="rounded-xl border border-slate-200/70 bg-white p-4">
            <PanelTitle eyebrow="Acordos" title="Indicadores de acordos e promessas" />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <FinancialMetric label="Promessas abertas" value={String(summary.openPromises)} tone="gold" />
              <FinancialMetric label="Promessas cumpridas" value={String(summary.fulfilledPromises)} />
              <FinancialMetric label="Promessas quebradas" value={String(summary.brokenPromises)} tone="danger" />
              <FinancialMetric label="Acordos ativos" value={String(summary.activeAgreements)} tone="gold" />
              <FinancialMetric label="Valor em atraso" value={entity.financial.overdueAmount} tone="danger" />
              <FinancialMetric label="Risco de quebra" value={entity.financial.risk} tone="gold" />
            </div>
          </section>
          <section className="rounded-xl border border-slate-200/70 bg-white p-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <PanelTitle eyebrow="Central operacional" title="Acordos e promessas" />
                <p className="m-0 mt-2 text-sm font-medium text-slate-500">
                  Estrutura nativa do Apolo para compromissos financeiros do relacionamento.
                </p>
              </div>
              <div className="flex gap-2">
                <Tooltip content="Nova promessa depende da API de escrita do Apolo" placement="bottom">
                  <button className="inline-flex size-9 cursor-not-allowed items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7A5E2C] opacity-70" disabled type="button">
                    <CalendarClock className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip content="Novo acordo depende da API de escrita do Apolo" placement="bottom">
                  <button className="inline-flex size-9 cursor-not-allowed items-center justify-center rounded-lg bg-slate-100 text-slate-400" disabled type="button">
                    <Handshake className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
            </div>

            <div className="mt-4 grid gap-3 rounded-xl border border-slate-200/70 bg-slate-50/60 p-3 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    aria-expanded={filtersExpanded}
                    className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-2.5 text-xs font-semibold text-slate-600 hover:bg-[#A07C3B]/5"
                    onClick={() => setFiltersExpanded((current) => !current)}
                    type="button"
                  >
                    <Filter className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
                    Filtros{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}
                    <ChevronDown className={`size-3.5 text-[#A07C3B] transition-transform ${filtersExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                  {activeFilters.map((filter) => (
                    <Tooltip content={`Remover ${filter.label}`} key={`${filter.label}-${filter.value}`} placement="top">
                      <button className="inline-flex h-7 max-w-44 items-center gap-1 rounded-full bg-[#A07C3B]/5 px-2 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15" onClick={filter.clear} type="button">
                        <span className="truncate">{filter.value}</span>
                        <span aria-hidden="true">x</span>
                      </button>
                    </Tooltip>
                  ))}
                </div>
                <div className={`grid transition-all duration-300 ease-out ${filtersExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                  <div className="min-h-0 overflow-hidden">
                    <div className="grid gap-2 pt-3 md:grid-cols-3">
                      <ApoloFilterSelect label="Tipo" onChange={(value) => setTypeFilter(value as "Todos" | ApoloFinancialRecordType)} value={typeFilter}>
                        <option>Todos</option>
                        <option>Promessa de pagamento</option>
                        <option>Acordo</option>
                      </ApoloFilterSelect>
                      <ApoloFilterSelect label="Status" onChange={setStatusFilter} value={statusFilter}>
                        <option>Todos</option>
                        {statuses.map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </ApoloFilterSelect>
                      <ApoloFilterSelect label="Unidade/lote" onChange={setUnitFilter} value={unitFilter}>
                        <option value="Todas">Todas</option>
                        {units.map((unit) => (
                          <option key={unit.id} value={unit.unitCode}>
                            {unit.unitCode} / {unit.unitLabel}
                          </option>
                        ))}
                      </ApoloFilterSelect>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#A07C3B]/15 bg-white p-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-[#A07C3B]" aria-hidden="true" />
                  <p className="m-0 text-sm font-semibold text-slate-950">Leitura operacional</p>
                </div>
                <p className="m-0 mt-2 text-xs leading-5 text-slate-600">
                  {entity.financial.paymentBehavior}
                </p>
              </div>
            </div>

            <ApoloFinancialRecordList records={filteredRecords} />
          </section>
        </>
      ) : null}
    </section>
  );
}

function FinancialSubtabNav({
  activeSubtab,
  onChange,
}: {
  activeSubtab: ApoloFinancialSubtab;
  onChange: (subtab: ApoloFinancialSubtab) => void;
}) {
  return (
    <nav aria-label="Areas financeiras" className="mt-4 flex flex-wrap gap-1 rounded-xl border border-slate-200/70 bg-white p-1">
      {apoloFinancialSubtabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeSubtab === tab.id;

        return (
          <button
            aria-current={active ? "page" : undefined}
            className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
              active
                ? "bg-slate-950 text-white"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
            }`}
            key={tab.id}
            onClick={() => onChange(tab.id)}
            type="button"
          >
            <Icon className="size-4" aria-hidden="true" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

function FinancialMetric({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "neutral" | "gold" | "danger";
  value: string;
}) {
  const toneClass = {
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
    gold: "bg-[#A07C3B]/5 text-[#7A5E2C] ring-[#A07C3B]/15",
    neutral: "bg-slate-50/70 text-slate-950 ring-slate-200/70",
  }[tone];

  return (
    <div className={`min-w-0 rounded-xl px-3 py-2.5 ring-1 ${toneClass}`}>
      <p className="truncate text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tracking-normal">{value}</p>
    </div>
  );
}

function ApoloFilterSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label>
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <select
        className="mt-1 h-9 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition-colors hover:bg-slate-50"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function ApoloFinancialRecordList({ records }: { records: ApoloFinancialRecord[] }) {
  if (!records.length) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
        Nenhum acordo ou promessa materializado no Apolo para os filtros selecionados.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-slate-200/70 bg-white">
      <div className="grid grid-cols-[0.95fr_0.85fr_0.9fr_0.85fr_0.8fr_0.85fr] gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-xs font-semibold text-slate-500 max-lg:hidden">
        <span>Tipo</span>
        <span>Status</span>
        <span>Registro</span>
        <span>Cod. unidade</span>
        <span>Valor</span>
        <span>Data</span>
      </div>
      <div className="max-h-[520px] overflow-y-auto [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
        {records.map((record) => (
          <article
            className="grid gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 lg:grid-cols-[0.95fr_0.85fr_0.9fr_0.85fr_0.8fr_0.85fr] lg:items-center"
            key={record.id}
          >
            <div className="min-w-0">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${financialRecordTypeClass(record.type)}`}>
                {record.type}
              </span>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950">{record.enterprise}</p>
              <p className="m-0 mt-0.5 truncate text-xs text-slate-500">{record.unitLabel}</p>
            </div>
            <div>
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${financialRecordStatusClass(record.status)}`}>
                {record.status}
              </span>
            </div>
            <div className="min-w-0">
              <p className="m-0 truncate text-xs text-slate-500 lg:hidden">Registro</p>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950 lg:mt-0">{record.title}</p>
              <p className="m-0 mt-0.5 w-fit rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                {record.protocol}
              </p>
            </div>
            <div className="min-w-0">
              <p className="m-0 truncate text-xs text-slate-500 lg:hidden">Cod. unidade</p>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950 lg:mt-0">{record.unitCode}</p>
            </div>
            <div className="min-w-0">
              <p className="m-0 text-xs font-medium text-slate-500">Valor</p>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950">{record.value}</p>
            </div>
            <div className="min-w-0">
              <p className="m-0 text-xs font-medium text-slate-500">Data</p>
              <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950">{record.date}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function DocumentsPanel({
  entity,
}: {
  entity: ApoloEntity;
}) {
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const contractDocuments = contractDocumentItems(entity);
  const identityDocuments = entity.documents.map((document) => ({
    detail: document.updatedAt,
    id: `document-${document.label}`,
    meta: "Documento cadastral",
    status: document.status,
    title: document.label,
  }));

  async function openApoloDocument(documentUrl: string, documentId: string) {
    const previewWindow = window.open("about:blank", "_blank");

    if (previewWindow) {
      previewWindow.opener = null;
    }

    try {
      setOpeningDocumentId(documentId);
      setDocumentError(null);

      const accessToken = await getApoloAccessToken();
      const response = await fetch(documentUrl, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        throw new Error(payload?.error ?? "Nao foi possivel abrir o documento.");
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
    <section className="grid gap-4">
      {documentError ? (
        <p className="m-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {documentError}
        </p>
      ) : null}
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <PanelTitle eyebrow="Documentos" title="Contrato" />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {contractDocuments.map((document) => (
            <article
              className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4"
              key={document.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-semibold text-slate-950">
                    {document.title}
                  </p>
                  {document.href ? (
                    <button
                      className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#A07C3B]/20 bg-white px-2 py-1 text-xs font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10 disabled:cursor-wait disabled:opacity-70"
                      disabled={openingDocumentId === document.id}
                      onClick={() => {
                        if (document.href) {
                          void openApoloDocument(document.href, document.id);
                        }
                      }}
                      type="button"
                    >
                      <span className="truncate">{document.detail}</span>
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </button>
                  ) : (
                    <p className="m-0 mt-1 truncate text-xs text-slate-500">
                      {document.detail}
                    </p>
                  )}
                  <p className="m-0 mt-1 truncate text-xs font-medium text-slate-500">
                    {document.meta}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/20">
                    {document.unitBadge}
                  </span>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                    {document.status}
                  </span>
                </div>
              </div>
            </article>
          ))}
          {!contractDocuments.length ? (
            <EmptyPanel text="Nenhum contrato localizado para este relacionamento." />
          ) : null}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200/70 bg-white p-4">
        <PanelTitle eyebrow="Documentos" title="Cadastro e anexos" />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {identityDocuments.map((document) => (
            <article
              className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4"
              key={document.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="m-0 text-sm font-semibold text-slate-950">
                    {document.title}
                  </p>
                  <p className="m-0 mt-1 text-xs text-slate-500">
                    {document.detail}
                  </p>
                  <p className="m-0 mt-1 text-xs font-medium text-slate-500">
                    {document.meta}
                  </p>
                </div>
                <DocumentPill status={document.status} />
              </div>
            </article>
          ))}
          {!identityDocuments.length ? (
            <EmptyPanel text="Nenhum documento cadastral consolidado neste relacionamento." />
          ) : null}
        </div>
      </section>
    </section>
  );
}

function TimelinePanel({
  events,
}: {
  events: readonly ApoloTimelineEvent[];
}) {
  const [timelineQuery, setTimelineQuery] = useState("");
  const filteredEvents = useMemo(() => {
    const normalizedQuery = normalizeText(timelineQuery);

    if (!normalizedQuery) {
      return events;
    }

    return events.filter((event) =>
      normalizeText(`${event.title} ${event.description} ${event.date}`).includes(normalizedQuery),
    );
  }, [events, timelineQuery]);
  const timelineActions = [
    { icon: MessageCircle, label: "WhatsApp" },
    { icon: PhoneCall, label: "Ligacao" },
    { icon: Handshake, label: "Acordo" },
    { icon: ReceiptText, label: "Boleto" },
  ] as const satisfies readonly { icon: LucideIcon; label: string }[];

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <PanelTitle eyebrow={`${filteredEvents.length}/${events.length} eventos`} title="Timeline operacional do relacionamento" />
        <div className="flex flex-wrap gap-2">
          <label className="flex h-8 min-w-[16rem] items-center gap-2 rounded-lg border border-slate-200/70 bg-slate-50/80 px-2.5 text-slate-500">
            <Search className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="sr-only">Buscar na timeline</span>
            <input
              className="w-full bg-transparent text-xs font-semibold text-slate-900 outline-none placeholder:text-slate-400"
              onChange={(event) => setTimelineQuery(event.target.value)}
              placeholder="Buscar evento, protocolo ou unidade"
              type="search"
              value={timelineQuery}
            />
          </label>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
            {timelineActions.map((action) => {
              const Icon = action.icon;

              return (
                <button
                  className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
                  key={action.label}
                  type="button"
                >
                  <Icon className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="relative space-y-3 before:absolute before:left-[18px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-slate-200">
        {filteredEvents.map((event) => (
          <TimelineRow event={event} key={`${event.date}-${event.title}`} />
        ))}
        {!filteredEvents.length ? (
          <EmptyPanel text="Nenhum evento encontrado para a consulta atual." />
        ) : null}
      </div>
    </section>
  );
}

function TimelineRow({
  compact = false,
  event,
}: {
  compact?: boolean;
  event: ApoloTimelineEvent;
}) {
  const normalized = normalizeText(`${event.title} ${event.description}`);
  const isAction = [
    "acordo",
    "boleto",
    "cobranca",
    "contato",
    "ligacao",
    "pagamento",
    "promessa",
    "whatsapp",
  ].some((term) => normalized.includes(term));
  const Icon = getTimelineIcon(normalized);
  const statusTone = {
    attention: "bg-amber-50 text-amber-800 ring-amber-100",
    blocked: "bg-rose-50 text-rose-700 ring-rose-100",
    ok: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  } as const satisfies Record<ApoloTimelineEvent["status"], string>;

  return (
    <article
      className={`rounded-xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${
        compact ? "" : "relative ml-11"
      }`}
    >
      {!compact ? (
        <span className="absolute -left-[3rem] top-3 grid size-9 place-items-center rounded-lg border border-slate-200/70 bg-white">
          <span className="grid size-5 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
        </span>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {compact ? (
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#A07C3B]/5 text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
            ) : null}
            <p className="m-0 truncate text-sm font-semibold text-slate-950">
              {event.title}
            </p>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${statusTone[event.status]}`}
            >
              {event.status === "ok" ? "Registrado" : "Atencao"}
            </span>
            <Pill>{isAction ? "Acao operacional" : "Informativo"}</Pill>
            {isAction ? <Pill>Protocolo pendente</Pill> : null}
          </div>
          <p className="m-0 mt-2 text-sm font-medium text-slate-600">
            {event.description}
          </p>
        </div>
        <time className="shrink-0 text-xs font-medium text-slate-500">
          {event.date}
        </time>
      </div>
    </article>
  );
}

function AuditPanel({ audit }: { audit: readonly ApoloAuditSignal[] }) {
  return (
    <section className="overflow-x-auto rounded-lg border border-slate-200/70 bg-white">
      <div className="min-w-[38rem]">
        <div className="grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
          <span>Campo</span>
          <span>Status</span>
          <span>Atualizado</span>
        </div>
        {audit.map((item) => (
          <div
            className="grid grid-cols-[minmax(0,1fr)_8rem_8rem] gap-3 border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-600 last:border-b-0"
            key={item.field}
          >
            <span className="min-w-0 truncate font-semibold text-slate-950">
              {item.field}
            </span>
            <span>{item.status}</span>
            <span>{item.updatedAt}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200/70 bg-slate-50/70 p-3">
      <p className="m-0 text-xs font-medium text-slate-500">{label}</p>
      <p className="m-0 mt-2 break-words text-sm font-semibold text-slate-950">
        {value}
      </p>
    </div>
  );
}

function InfoButtonTile({
  disabled,
  label,
  onClick,
  value,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
  value: string;
}) {
  return (
    <button
      className="rounded-lg border border-slate-200/70 bg-slate-50/70 p-3 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 disabled:cursor-not-allowed disabled:hover:border-slate-200/70 disabled:hover:bg-slate-50/70"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <p className="m-0 text-xs font-medium text-slate-500">{label}</p>
      <p className="m-0 mt-2 break-words text-sm font-semibold text-slate-950">
        {value}
      </p>
    </button>
  );
}

function ReadonlyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-lg border border-slate-200/70 bg-slate-50/70 p-3">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="break-words text-sm font-semibold text-slate-950">
        {value}
      </span>
    </div>
  );
}

function StatusLine({
  label,
  status,
}: {
  label: string;
  status: "attention" | "pending" | "verified";
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200/70 bg-slate-50/70 p-3">
      <span className="min-w-0 break-words text-sm font-semibold text-slate-950">
        {label}
      </span>
      <StatusPill status={status} />
    </div>
  );
}

function StatusPill({
  status,
}: {
  status: "attention" | "pending" | "verified";
}) {
  const label = {
    attention: "Atencao",
    pending: "Pendente",
    verified: "OK",
  } as const;
  const className = {
    attention: "bg-amber-50 text-amber-800 ring-amber-100",
    pending: "bg-slate-50 text-slate-600 ring-slate-200/70",
    verified: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  } as const;

  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${className[status]}`}
    >
      {label[status]}
    </span>
  );
}

function DocumentPill({ status }: { status: ApoloDocumentSignal["status"] }) {
  const label = {
    blocked: "Restrito",
    pending_review: "Revisao",
    ready: "Pronto",
  } as const;
  const className = {
    blocked: "bg-rose-50 text-rose-700 ring-rose-100",
    pending_review: "bg-amber-50 text-amber-800 ring-amber-100",
    ready: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  } as const;

  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${className[status]}`}
    >
      {label[status]}
    </span>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200/70">
      {children}
    </span>
  );
}

function PanelTitle({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div>
      <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
        {eyebrow}
      </p>
      <p className="m-0 mt-1 text-base font-semibold text-slate-950">
        {title}
      </p>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm font-semibold text-slate-500">
      {text}
    </div>
  );
}

function sanitizeOperationalMessage(message: string | null | undefined) {
  if (!message) {
    return null;
  }

  if (/c2x|legado|legacy/i.test(message)) {
    return "Cadastro sem carteira operacional vinculada.";
  }

  return message;
}

function canUseHadesWorkspace() {
  return false;
}

function isApoloTabUnavailableForEntity(tab: ApoloTab, entity: ApoloEntity | null) {
  if (!entity) {
    return false;
  }

  if (tab !== "carteira" && tab !== "financeiro") {
    return false;
  }

  return buyerStatusLabel(entity) !== "Comprador";
}

async function getApoloAccessToken(required = true) {
  const client = getHubSupabaseClient();

  if (!client) {
    if (!required) {
      return null;
    }

    throw new Error("Sessao administrativa ausente.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token ?? null;

  if ((sessionResult.error || !accessToken) && required) {
    throw new Error("Sessao administrativa ausente.");
  }

  return accessToken;
}

async function loadHadesManualOperations(
  clientId: string,
  accessToken: string,
): Promise<ManualHadesOperations> {
  const response = await fetch(
    `/api/hades/attendance/manual-events?clientId=${encodeURIComponent(clientId)}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | ManualHadesOperations
    | { error?: string }
    | null;

  if (!response.ok || !isManualHadesOperations(payload)) {
    return emptyManualHadesOperations;
  }

  return {
    commitments: payload.commitments ?? [],
    events: payload.events ?? [],
  };
}

async function persistHadesManualOperation({
  body,
  method,
}: {
  body: Record<string, unknown>;
  method: "PATCH" | "POST";
}): Promise<ManualHadesOperations> {
  const accessToken = await getApoloAccessToken();
  const response = await fetch("/api/hades/attendance/manual-events", {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method,
  });
  const payload = (await response.json().catch(() => null)) as
    | ManualHadesOperations
    | { error?: string }
    | null;

  if (!response.ok || !isManualHadesOperations(payload)) {
    throw new Error(manualHadesError(payload) ?? "Nao foi possivel salvar registro operacional.");
  }

  return {
    commitments: payload.commitments ?? [],
    events: payload.events ?? [],
  };
}

function upsertById<T extends { id: string }>(nextRows: T[], currentRows: T[]) {
  const nextIds = new Set(nextRows.map((row) => row.id));

  return [
    ...nextRows,
    ...currentRows.filter((row) => !nextIds.has(row.id)),
  ];
}

function isManualHadesOperations(input: unknown): input is ManualHadesOperations {
  return (
    Boolean(input) &&
    typeof input === "object" &&
    Array.isArray((input as Partial<ManualHadesOperations>).commitments) &&
    Array.isArray((input as Partial<ManualHadesOperations>).events)
  );
}

function manualHadesError(input: unknown) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const error = (input as { error?: unknown }).error;

  return typeof error === "string" ? error : null;
}

function matchesApoloFilters(
  entity: ApoloEntity,
  query: string,
  profileFilter: ApoloProfileFilter,
) {
  if (profileFilter !== "all" && !entity.profiles.includes(profileFilter)) {
    return false;
  }

  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return true;
  }

  return normalizeText(
    [
      entity.displayName,
      entity.legalName ?? "",
      entity.tradeName ?? "",
      entity.documentMasked,
      entity.locationLabel,
      entity.nextAction,
      buyerStatusLabel(entity),
      buyerFinancialBadge(entity)?.label ?? "",
      entity.profiles.map((profile) => apoloProfileLabels[profile]).join(" "),
      entity.commercialLinks
        .map((link) => `${link.enterprise} ${link.unit} ${link.role} ${link.referenceLabel}`)
        .join(" "),
      entity.contacts.map((contact) => contact.value).join(" "),
      entity.relationships
        .map((relationship) => `${relationship.label} ${relationship.relation}`)
        .join(" "),
      entity.documents.map((document) => document.label).join(" "),
      entity.serviceSignals
        .map((signal) => `${signal.protocol} ${signal.channel} ${signal.lastEvent}`)
        .join(" "),
      entity.timeline
        .map((event) => `${event.title} ${event.description} ${event.date}`)
        .join(" "),
    ].join(" "),
  ).includes(normalizedQuery);
}

function profileCount(
  dashboard: ApoloDashboardData | null,
  profile: ApoloProfile,
) {
  return dashboard?.profileSummaries.find((item) => item.profile === profile)?.count ?? 0;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

function primaryBusinessProfile(entity: ApoloEntity): ApoloProfile {
  const profilePriority = [
    "usuario",
    "incorporador",
    "imobiliaria",
    "corretor",
    "parceiro",
    "fornecedor",
    "colaborador",
    "acesso_incorporador",
    "pessoa_juridica",
    "pessoa_fisica",
  ] as const satisfies readonly ApoloProfile[];

  return (
    profilePriority.find((profile) => entity.profiles.includes(profile)) ??
    entity.profiles[0] ??
    "pessoa_fisica"
  );
}

function buyerStatusLabel(entity: ApoloEntity) {
  if (!entity.profiles.includes("usuario")) {
    return "Nao aplicavel";
  }

  const normalizedLinks = normalizeText(
    entity.commercialLinks
      .map((link) => `${link.role} ${link.stage} ${link.referenceLabel}`)
      .join(" "),
  );

  if (normalizedLinks.includes("sem compra")) {
    return "Nao comprador";
  }

  if (entity.commercialLinks.some((link) => normalizeText(link.role) === "usuario comprador")) {
    return "Comprador";
  }

  if (normalizedLinks.includes("jornada comercial") || normalizedLinks.includes("vinculo comercial")) {
    return "Em jornada";
  }

  return "Nao comprador";
}

function buyerFinancialBadge(entity: ApoloEntity) {
  if (buyerStatusLabel(entity) !== "Comprador") {
    return null;
  }

  if (entity.financial.overdueInstallments > 0 || currencyLabelToNumber(entity.financial.overdueAmount) > 0) {
    return {
      className: "bg-rose-50 text-rose-700 ring-rose-100",
      label: "Inadimplente",
    };
  }

  return {
    className: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    label: "Adimplente",
  };
}

function currencyLabelToNumber(value: string) {
  if (!value || value === "A consultar") {
    return 0;
  }

  const normalized = value
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoneyLabel(value: number, fallback: string) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function displayText(value: string | null | undefined) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized || normalized === "-") {
    return "-";
  }

  if (normalized.includes("@")) {
    return normalized;
  }

  const preserved = new Set([
    "C2X",
    "CRM",
    "CPF",
    "CNPJ",
    "LBF",
    "LBP",
    "LBR",
    "MG",
    "RDP",
    "RJ",
    "SP",
  ]);
  const smallWords = new Set(["a", "as", "da", "das", "de", "do", "dos", "e"]);

  return normalized
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((word, index) => {
      const original = normalized.split(" ")[index] ?? word;
      const originalUpper = original.toUpperCase();

      if (preserved.has(originalUpper)) {
        return originalUpper;
      }

      if (/^[a-z]{2,5}\d{2,}$/i.test(original)) {
        return originalUpper;
      }

      if (index > 0 && smallWords.has(word)) {
        return word;
      }

      return word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1);
    })
    .join(" ");
}

function profileLabelList(entity: ApoloEntity) {
  return entity.profiles.map((profile) => apoloProfileLabels[profile]).join(", ");
}

function displayHeaderName(entity: ApoloEntity) {
  if (isCompanyEntity(entity)) {
    return displayText(entity.tradeName || entity.displayName || entity.legalName || "-");
  }

  return displayText(entity.displayName || entity.tradeName || entity.legalName || "-");
}

function summaryName(entity: ApoloEntity) {
  if (isCompanyEntity(entity)) {
    return displayText(entity.legalName || entity.displayName || entity.tradeName || "-");
  }

  return displayText(entity.displayName || entity.legalName || entity.tradeName || "-");
}

function documentLabel(entity: ApoloEntity) {
  if (entity.kind === "pj" || entity.kind === "organization") {
    return "CNPJ";
  }

  if (entity.kind === "pf" || entity.kind === "internal") {
    return "CPF";
  }

  return "CPF/CNPJ";
}

function activeRegistrationLabel(entity: ApoloEntity) {
  return `Ativo: ${monthYearLabel(entity.createdAt || entity.updatedAt)}`;
}

function monthYearLabel(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);

  if (match?.[2] && match[3]) {
    return `${match[2]}/${match[3].slice(-2)}`;
  }

  return "--/--";
}

function civilStatusLabel(entity: ApoloEntity) {
  return entity.kind === "pf" ? "A consultar" : "";
}

function primaryContact(entity: ApoloEntity, type: ApoloEntity["contacts"][number]["type"]) {
  return entity.contacts.find((contact) => contact.type === type);
}

function primaryPhoneContact(entity: ApoloEntity) {
  return entity.contacts.find((contact) => contact.type === "whatsapp" || contact.type === "phone");
}

function acquiredUnitsCount(entity: ApoloEntity) {
  if (buyerStatusLabel(entity) !== "Comprador") {
    return 0;
  }

  return entity.commercialLinks.length;
}

function commercialRelationshipLabel(entity: ApoloEntity) {
  if (!entity.profiles.includes("usuario")) {
    return "";
  }

  const relationship = entity.relationships.find((item) =>
    normalizeText(`${item.relation} ${item.label}`).includes("imobiliaria"),
  );

  if (relationship?.label) {
    return displayText(relationship.label);
  }

  const link = entity.commercialLinks.find((item) => {
    const normalized = normalizeText(`${item.referenceLabel} ${item.role}`);

    return normalized.includes("imobiliaria") || normalized.includes("responsavel");
  });

  return displayText(link?.brokerAgency || link?.referenceLabel || "");
}

function responsibleLabel(entity: ApoloEntity) {
  const relationship = entity.relationships.find((item) =>
    normalizeText(`${item.relation} ${item.label}`).includes("responsavel"),
  );

  if (relationship?.label) {
    return displayText(relationship.label);
  }

  const link = entity.commercialLinks.find((item) =>
    normalizeText(`${item.referenceLabel} ${item.role}`).includes("responsavel"),
  );

  return displayText(link?.brokerAgency || link?.referenceLabel || entity.relationships[0]?.label || "");
}

function isCompanyEntity(entity: ApoloEntity) {
  return entity.kind === "pj" || entity.kind === "organization";
}

function cityStateLabel(
  address: ApoloEntity["addresses"][number] | undefined,
  fallback: string,
) {
  if (!address) {
    return fallback || "-";
  }

  return `${address.city}-${address.state}`;
}

function fullAddressLabel(address: ApoloEntity["addresses"][number] | undefined) {
  if (!address) {
    return "-";
  }

  const addressLine = [
    address.value,
    address.number,
    address.complement,
    address.district,
  ]
    .filter(Boolean)
    .join(" - ");
  const cityLine = cityStateLabel(address, "");
  const postalCode = address.postalCode ? `CEP ${address.postalCode}` : "";

  return [addressLine, cityLine, postalCode].filter(Boolean).join(" - ") || "-";
}

function relationshipSummary(entity: ApoloEntity) {
  if (buyerStatusLabel(entity) === "Comprador") {
    return `${acquiredUnitsCount(entity)} unidade(s) adquirida(s)`;
  }

  return displayText(entity.relationships[0]?.label ?? "-");
}

function contractDocumentItems(entity: ApoloEntity) {
  return entity.commercialLinks
    .filter((link) => normalizeText(`${link.role} ${link.stage}`).includes("comprador"))
    .slice(0, 6)
    .map((link, index) => {
      const contractDocumentId = link.contractDocumentId?.trim();
      const detail = link.unitCode || link.unit || "Contrato";

      return {
        detail,
        href: contractDocumentId
          ? `/api/hades/d4sign/contracts/${encodeURIComponent(contractDocumentId)}`
          : undefined,
        id: `${detail}-${index}`,
        meta: displayText(`${link.enterprise} ${link.brokerAgency || link.referenceLabel}`.trim()),
        status: link.contractStatus ?? (contractDocumentId ? "Assinado" : "Nao localizado"),
        title: "Contrato",
        unitBadge: detail,
      };
    });
}

function buildPortfolioUnits(entity: ApoloEntity): ApoloPortfolioUnit[] {
  return entity.commercialLinks.map((link, index) => {
    const parsedUnit = parsePortfolioUnitLabel(link.unit);
    const legacyReference = isLegacyCommercialPlaceholder(link.referenceLabel);
    const legacyEnterprise = isLegacyCommercialPlaceholder(link.enterprise);
    const legacyUnitCarriesBroker = legacyReference && !extractUnitCode(link.unit);
    const unitCode =
      link.unitCode ??
      extractUnitCode(link.unit) ??
      extractUnitCode(link.referenceLabel) ??
      "-";
    const block = normalizePortfolioDimension(link.block ?? parsedUnit.block, "Sem quadra");
    const lot = normalizePortfolioDimension(link.lot ?? parsedUnit.lot, "Sem lote");
    const area = normalizePortfolioDimension(link.area ?? parsedUnit.area);

    return {
      area,
      block,
      contractDocumentId: link.contractDocumentId,
      contractStatus: link.contractStatus,
      contractUrl: link.contractUrl,
      enterprise: displayText(legacyEnterprise ? "-" : link.enterprise || "-"),
      id: `${portfolioKey(link)}::${index}`,
      installments: link.installments ?? [],
      lot,
      referenceLabel: displayText(
        link.brokerAgency ||
          (legacyUnitCarriesBroker ? link.unit : undefined) ||
          (legacyReference ? "-" : link.referenceLabel) ||
          "-",
      ),
      role: displayText(link.role || "-"),
      stage: displayText(link.stage || "-"),
      tableValue: link.tableValue ?? "-",
      unitCode,
      unitLabel: displayText(legacyUnitCarriesBroker ? "-" : link.unit || "-"),
    };
  });
}

function isLegacyCommercialPlaceholder(value: string | undefined) {
  const normalized = normalizeText(value ?? "");

  return [
    "carteira comercial",
    "vinculo identificado",
    "vinculo pendente",
    "sem carteira por pagamento",
  ].includes(normalized);
}

function normalizePortfolioDimension(value: string | undefined, emptyMarker?: string) {
  const normalized = String(value ?? "").trim();

  if (!normalized || normalized === "-" || normalized === emptyMarker) {
    return "-";
  }

  return normalized;
}

function parsePortfolioUnitLabel(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const blockMatch =
    /\b(?:quadra|qd|q)\s*[-.:]?\s*([a-z0-9]+)/i.exec(normalized) ??
    /\b(Q[0-9a-z-]+)\b/i.exec(normalized);
  const lotMatch =
    /\b(?:lote|lt|l)\s*[-.:]?\s*([a-z0-9]+)/i.exec(normalized) ??
    /\b(L[0-9a-z-]+)\b/i.exec(normalized);
  const areaMatch = /(\d+(?:[,.]\d+)?)\s*m(?:2|²)?/i.exec(normalized);

  return {
    area: areaMatch?.[0] ?? "-",
    block: blockMatch?.[1]?.toUpperCase() ?? "-",
    lot: lotMatch?.[1]?.toUpperCase() ?? "-",
  };
}

function extractUnitCode(value: string) {
  const match = /\b[A-Z]{2,5}\d{2,}\b/i.exec(value);
  return match?.[0]?.toUpperCase();
}

function portfolioUnitSubtitle(unit: ApoloPortfolioUnit) {
  const parts = [
    unit.block !== "-" ? `Quadra ${unit.block}` : null,
    unit.lot !== "-" ? `Lote ${unit.lot}` : null,
    unit.area !== "-" ? unit.area : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : unit.unitLabel !== "-" ? unit.unitLabel : unit.unitCode;
}

function buildApoloFinancialRecords(entity: ApoloEntity): ApoloFinancialRecord[] {
  const units = buildPortfolioUnits(entity);

  return entity.timeline
    .map((event, index) => {
      const normalized = normalizeText(`${event.title} ${event.description}`);

      if (!normalized.includes("acordo") && !normalized.includes("promessa")) {
        return null;
      }

      const unit = findUnitForText(units, normalized) ?? units[0];
      const type: ApoloFinancialRecordType = normalized.includes("acordo")
        ? "Acordo"
        : "Promessa de pagamento";

      return {
        date: event.date || "-",
        enterprise: unit?.enterprise ?? "Relacionamento financeiro",
        id: `${event.title}-${event.date}-${index}`,
        operator: "Apolo",
        protocol: `APO-${String(index + 1).padStart(5, "0")}`,
        status: financialTimelineStatusLabel(event.status),
        title: event.title,
        type,
        unitCode: unit?.unitCode ?? "-",
        unitLabel: unit?.unitLabel ?? "-",
        value: inferFinancialRecordValue(event.description, entity),
      };
    })
    .filter((record): record is ApoloFinancialRecord => Boolean(record));
}

function findUnitForText(units: ApoloPortfolioUnit[], normalizedText: string) {
  return units.find((unit) => {
    const candidates = [
      unit.enterprise,
      unit.unitLabel,
      unit.unitCode,
      unit.referenceLabel,
    ]
      .map(normalizeText)
      .filter((value) => value.length > 2);

    return candidates.some((candidate) => normalizedText.includes(candidate));
  });
}

function financialTimelineStatusLabel(status: ApoloTimelineEvent["status"]) {
  if (status === "ok") {
    return "Registrado";
  }

  if (status === "blocked") {
    return "Bloqueado";
  }

  return "Acompanhar";
}

function inferFinancialRecordValue(description: string, entity: ApoloEntity) {
  const moneyMatch = /R\$\s*[\d.]+(?:,\d{2})?/i.exec(description);

  if (moneyMatch?.[0]) {
    return moneyMatch[0];
  }

  if (currencyLabelToNumber(entity.financial.overdueAmount) > 0) {
    return entity.financial.overdueAmount;
  }

  return "-";
}

function buildApoloFinancialSummary(records: ApoloFinancialRecord[]) {
  const promises = records.filter((record) => record.type === "Promessa de pagamento");
  const agreements = records.filter((record) => record.type === "Acordo");
  const fulfilledPromises = promises.filter((record) =>
    normalizeText(record.status).includes("cumpr"),
  ).length;
  const brokenPromises = promises.filter((record) =>
    ["bloqueado", "quebrado", "cancelado"].some((status) => normalizeText(record.status).includes(status)),
  ).length;
  const openPromises = promises.length - fulfilledPromises - brokenPromises;
  const activeAgreements = agreements.filter((record) =>
    !["bloqueado", "cancelado", "quebrado"].some((status) => normalizeText(record.status).includes(status)),
  ).length;

  return {
    activeAgreements,
    brokenPromises,
    fulfilledPromises,
    openPromises,
  };
}

function uniqueText(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function financialRecordTypeClass(type: ApoloFinancialRecordType) {
  if (type === "Acordo") {
    return "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15";
  }

  return "bg-slate-50 text-slate-700 ring-slate-200";
}

function financialRecordStatusClass(status: string) {
  const normalized = normalizeText(status);

  if (normalized.includes("bloqueado") || normalized.includes("quebrado")) {
    return "bg-rose-50 text-rose-700 ring-rose-100";
  }

  if (normalized.includes("acompanhar") || normalized.includes("negoci")) {
    return "bg-amber-50 text-amber-700 ring-amber-100";
  }

  return "bg-emerald-50 text-emerald-700 ring-emerald-100";
}

function portfolioKey(link: ApoloEntity["commercialLinks"][number] | undefined) {
  if (!link) {
    return "";
  }

  return `${link.enterprise}::${link.unit}::${link.role}::${link.referenceLabel}`;
}

function getTimelineIcon(normalizedText: string): LucideIcon {
  if (normalizedText.includes("boleto")) {
    return ReceiptText;
  }

  if (normalizedText.includes("acordo") || normalizedText.includes("promessa")) {
    return Handshake;
  }

  if (normalizedText.includes("whatsapp") || normalizedText.includes("contato")) {
    return MessageCircle;
  }

  if (normalizedText.includes("ligacao") || normalizedText.includes("telefone")) {
    return PhoneCall;
  }

  if (normalizedText.includes("jurid")) {
    return Scale;
  }

  if (normalizedText.includes("pagamento") || normalizedText.includes("parcela")) {
    return CircleDollarSign;
  }

  return ClipboardList;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function kindLabel(kind: ApoloEntity["kind"]) {
  if (kind === "pf") {
    return "Pessoa fisica";
  }

  if (kind === "pj" || kind === "organization") {
    return "Pessoa juridica";
  }

  return "Colaborador";
}

function countPendingSignals(entity: ApoloEntity) {
  return (
    entity.contacts.filter((contact) => contact.status !== "verified").length +
    entity.addresses.filter((address) => address.status !== "verified").length +
    entity.relationships.filter(
      (relationship) => relationship.status !== "verified",
    ).length +
    entity.documents.filter((document) => document.status !== "ready").length
  );
}
