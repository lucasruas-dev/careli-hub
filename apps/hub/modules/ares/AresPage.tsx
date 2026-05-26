"use client";

import { PanteonTopbarUser } from "@/components/panteon/panteon-topbar-user";
import {
  createAresDimension,
  createAresEntry,
  createAresFinancialBase,
  loadAresSnapshot,
  updateAresDimension,
  updateAresFinancialBase,
} from "@/lib/ares/client";
import type {
  AresApprovalStatus,
  AresFinancialBase,
  AresCounterpartyKind,
  AresDimension,
  AresDimensionKind,
  AresEntryKind,
  AresFinancialEntry,
  AresPriority,
  AresSnapshot,
  CreateAresDimensionInput,
  CreateAresEntryInput,
  CreateAresFinancialBaseInput,
} from "@/lib/ares/types";
import { useAuth } from "@/providers/auth-provider";
import { Tooltip } from "@repo/uix";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  BarChart3,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileBarChart,
  Filter,
  Landmark,
  Layers3,
  LayoutGrid,
  Loader2,
  LockKeyhole,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCcw,
  Search,
  TableProperties,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type AresLoadState = "idle" | "loading" | "ready" | "error";
type AresSection =
  | "conciliacao"
  | "estrutura"
  | "operacao"
  | "pagar"
  | "receber"
  | "relatorios";

type AresFilters = {
  kind: "all" | AresEntryKind;
  period: "7" | "30" | "90" | "all";
  status: "all" | "approval" | "open" | "overdue";
};

type AresLaunchFormState = CreateAresEntryInput;
type AresLaunchStatus = "error" | "idle" | "saved" | "saving";
type AresDimensionSetupFormState = CreateAresDimensionInput;
type AresFinancialBaseSetupFormState = CreateAresFinancialBaseInput;
type AresDimensionSaveStatus = "error" | "idle" | "saved" | "saving";
type AresApoloSearchStatus = "empty" | "error" | "idle" | "loading" | "ready";
type AresSetupTab = AresDimensionKind | "financial_base";
type AresWorkView = "kanban" | "list";

type AresApoloSearchResult = {
  displayName: string;
  documentMasked: string;
  id: string;
  kind: string;
  locationLabel: string;
  profiles: string[];
  status: string;
  updatedAt: string;
};

type AresApoloSearchResponse = {
  data?: {
    entities?: AresApoloSearchResult[];
    results?: AresApoloSearchResult[];
    total?: number;
  };
  error?: string;
};

type AresMenuItem = {
  icon: LucideIcon;
  id: AresSection;
  label: string;
};

type AresViewModel = {
  activeFinancialBase: AresFinancialBase | null;
  bankAccountById: Map<string, AresSnapshot["bankAccounts"][number]>;
  dimensionById: Map<string, AresDimension>;
  dimensionsByKind: Map<AresDimensionKind, AresDimension[]>;
  entries: AresFinancialEntry[];
  nextPayables: AresFinancialEntry[];
  nextReceivables: AresFinancialEntry[];
  paymentWeekAmount: number;
};

type AresKanbanColumn = {
  description: string;
  entries: AresFinancialEntry[];
  id: string;
  label: string;
};

const initialFilters: AresFilters = {
  kind: "all",
  period: "all",
  status: "all",
};

const launchFieldClass =
  "h-9 w-full rounded-md border border-[#d9e0e7] bg-white px-2.5 text-sm font-medium text-[#243044] outline-none transition placeholder:text-[#98a2b3] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:bg-[#f8fafc] disabled:text-[#98a2b3]";

const launchTextareaClass =
  "min-h-20 w-full rounded-md border border-[#d9e0e7] bg-white px-2.5 py-2 text-sm font-medium text-[#243044] outline-none transition placeholder:text-[#98a2b3] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:bg-[#f8fafc] disabled:text-[#98a2b3]";

const launchEntryKindOptions = [
  { label: "Conta a pagar", value: "payable" },
  { label: "Conta a receber", value: "receivable" },
] as const satisfies readonly {
  label: string;
  value: AresLaunchFormState["entryKind"];
}[];

const launchCounterpartyOptions = [
  { label: "Fornecedor", value: "supplier" },
  { label: "Cliente", value: "customer" },
  { label: "Parceiro", value: "partner" },
  { label: "Outro", value: "other" },
] as const satisfies readonly {
  label: string;
  value: AresCounterpartyKind;
}[];

const launchPriorityOptions = [
  { label: "Normal", value: "normal" },
  { label: "Alta", value: "high" },
  { label: "Urgente", value: "urgent" },
  { label: "Baixa", value: "low" },
] as const satisfies readonly {
  label: string;
  value: AresPriority;
}[];

const launchApprovalOptions = [
  { label: "Aguardando aprovacao", value: "pending" },
  { label: "Nao exige aprovacao", value: "not_required" },
  { label: "Aprovado", value: "approved" },
] as const satisfies readonly {
  label: string;
  value: Extract<AresApprovalStatus, "approved" | "not_required" | "pending">;
}[];

const aresNavigationItems = [
  {
    icon: TableProperties,
    id: "operacao",
    label: "Operacao",
  },
  {
    icon: ArrowUpCircle,
    id: "pagar",
    label: "Pagar",
  },
  {
    icon: ArrowDownCircle,
    id: "receber",
    label: "Receber",
  },
  {
    icon: Landmark,
    id: "conciliacao",
    label: "Conciliacao",
  },
  {
    icon: FileBarChart,
    id: "relatorios",
    label: "Relatorios",
  },
  {
    icon: Layers3,
    id: "estrutura",
    label: "Setup",
  },
] as const satisfies readonly AresMenuItem[];

const dimensionLabels = {
  category: "Categorias",
  cost_center: "Centros de custo",
  department: "Departamentos",
  project: "Projetos",
  result_center: "Centros de resultado",
} as const satisfies Record<AresDimensionKind, string>;

const dimensionSingularLabels = {
  category: "Categoria",
  cost_center: "Centro de custo",
  department: "Departamento",
  project: "Projeto",
  result_center: "Centro de resultado",
} as const satisfies Record<AresDimensionKind, string>;

const sectionTitles = {
  conciliacao: "Conciliacao bancaria",
  estrutura: "Setup financeiro",
  operacao: "Mesa financeira",
  pagar: "Contas a pagar",
  receber: "Contas a receber",
  relatorios: "Leituras gerenciais",
} as const satisfies Record<AresSection, string>;

const settledStatuses = new Set([
  "cancelled",
  "paid",
  "received",
  "reconciled",
]);

export function AresPage() {
  const { authState, hubUser, profileStatus } = useAuth();
  const [activeSection, setActiveSection] =
    useState<AresSection>("operacao");
  const [filters, setFilters] = useState<AresFilters>(initialFilters);
  const [snapshot, setSnapshot] = useState<AresSnapshot | null>(null);
  const [status, setStatus] = useState<AresLoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isAresSidebarCollapsed, setIsAresSidebarCollapsed] = useState(false);
  const [isLaunchFormOpen, setIsLaunchFormOpen] = useState(false);
  const [workView, setWorkView] = useState<AresWorkView>("kanban");
  const [activeFinancialBaseId, setActiveFinancialBaseId] = useState<
    string | null
  >(null);
  const [launchForm, setLaunchForm] = useState<AresLaunchFormState>(() =>
    createInitialLaunchForm(),
  );
  const [launchStatus, setLaunchStatus] =
    useState<AresLaunchStatus>("idle");
  const [launchError, setLaunchError] = useState<string | null>(null);
  const accessToken = authState.session?.accessToken ?? null;
  const aresData = useMemo(
    () => snapshot ?? createEmptyAresSnapshot(),
    [snapshot],
  );
  const canManageAres = aresData.permissions.canManage;
  const viewModel = useMemo(
    () => createAresViewModel(aresData, filters, activeSection),
    [activeSection, aresData, filters],
  );
  const isLoading = status === "loading" || profileStatus !== "ready";
  const isBlocked = status === "error" && !snapshot;

  const refreshAres = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);

    try {
      const nextSnapshot = await loadAresSnapshot(
        accessToken,
        activeFinancialBaseId,
      );

      setSnapshot(nextSnapshot);
      setActiveFinancialBaseId(nextSnapshot.activeFinancialBaseId);
      setStatus("ready");
    } catch (error) {
      setSnapshot(null);
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Nao foi possivel carregar o Ares.",
      );
    }
  }, [accessToken, activeFinancialBaseId]);

  useEffect(() => {
    if (profileStatus !== "ready") {
      return;
    }

    void refreshAres();
  }, [profileStatus, refreshAres]);

  useEffect(() => {
    if (!hubUser?.name) {
      return;
    }

    setLaunchForm((currentForm) =>
      currentForm.responsibleName
        ? currentForm
        : {
            ...currentForm,
            responsibleName: hubUser.name,
          },
    );
  }, [hubUser?.name]);

  useEffect(() => {
    const nextFinancialBaseId = aresData.activeFinancialBaseId ?? "";

    setLaunchForm((currentForm) =>
      currentForm.financialBaseId === nextFinancialBaseId
        ? currentForm
        : {
            ...currentForm,
            categoryId: "",
            costCenterId: "",
            departmentId: "",
            financialBaseId: nextFinancialBaseId,
            projectId: "",
            resultCenterId: "",
          },
    );
  }, [aresData.activeFinancialBaseId]);

  const handleOpenLaunchForm = useCallback(() => {
    setLaunchError(null);
    setLaunchStatus("idle");
    setIsLaunchFormOpen(true);
  }, []);

  const handleCloseLaunchForm = useCallback(() => {
    setIsLaunchFormOpen(false);
    setLaunchError(null);
    setLaunchStatus("idle");
  }, []);

  const handleSelectFinancialBase = useCallback((financialBaseId: string) => {
    setActiveFinancialBaseId(financialBaseId || null);
    setLaunchForm((currentForm) => ({
      ...currentForm,
      categoryId: "",
      costCenterId: "",
      departmentId: "",
      financialBaseId,
      projectId: "",
      resultCenterId: "",
    }));
  }, []);

  const handleSubmitLaunch = useCallback(async () => {
    setLaunchError(null);
    setLaunchStatus("saving");

    try {
      await createAresEntry(launchForm, accessToken);
      setLaunchStatus("saved");
      setLaunchForm(
        createInitialLaunchForm(
          launchForm.responsibleName || hubUser?.name,
          aresData.activeFinancialBaseId ?? "",
        ),
      );
      await refreshAres();
    } catch (error) {
      setLaunchStatus("error");
      setLaunchError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel criar o lancamento.",
      );
    }
  }, [
    accessToken,
    aresData.activeFinancialBaseId,
    hubUser?.name,
    launchForm,
    refreshAres,
  ]);

  return (
    <div className="h-[100dvh] max-h-[100dvh] overflow-hidden bg-[#f3f6fa] text-[#101820]">
      <div
        className={`grid h-full min-h-0 ${
          isAresSidebarCollapsed
            ? "lg:grid-cols-[4.5rem_minmax(0,1fr)]"
            : "lg:grid-cols-[16rem_minmax(0,1fr)]"
        }`}
      >
        <AresSidebar
          activeSection={activeSection}
          collapsed={isAresSidebarCollapsed}
          onSelect={setActiveSection}
          onToggleCollapsed={() =>
            setIsAresSidebarCollapsed((currentValue) => !currentValue)
          }
        />
        <main className="min-h-0 min-w-0 overflow-y-auto p-3 lg:p-4">
          <AresModuleToolbar
            activeFinancialBaseId={aresData.activeFinancialBaseId}
            canManage={canManageAres}
            financialBases={aresData.financialBases}
            isBlocked={isBlocked}
            isLoading={isLoading}
            onOpenLaunch={handleOpenLaunchForm}
            onSelectFinancialBase={handleSelectFinancialBase}
            onRefresh={() => void refreshAres()}
          />

          <AresHeader
            activeFinancialBase={viewModel.activeFinancialBase}
            filters={filters}
            generatedAt={aresData.generatedAt}
            onChangeFilters={setFilters}
            section={activeSection}
            sourceTables={aresData.source.tables.length}
          />

          {isBlocked ? (
            <AresBlockedNotice message={errorMessage} />
          ) : (
            <AresSummaryCards snapshot={aresData} />
          )}

          {isLaunchFormOpen ? (
            <AresLaunchPanel
              accessToken={accessToken}
              canManage={canManageAres}
              errorMessage={launchError}
              form={launchForm}
              financialBases={aresData.financialBases}
              isSaving={launchStatus === "saving"}
              onChange={setLaunchForm}
              onClose={handleCloseLaunchForm}
              onSelectFinancialBase={handleSelectFinancialBase}
              onSubmit={() => void handleSubmitLaunch()}
              status={launchStatus}
              viewModel={viewModel}
            />
          ) : null}

          {activeSection === "conciliacao" ? (
            <ReconciliationSection snapshot={aresData} viewModel={viewModel} />
          ) : null}

          {activeSection === "estrutura" ? (
            <StructureSection
              accessToken={accessToken}
              activeFinancialBaseId={aresData.activeFinancialBaseId}
              canManageSetup={aresData.permissions.canManageSetup}
              onRefresh={refreshAres}
              snapshot={aresData}
              viewModel={viewModel}
            />
          ) : null}

          {activeSection === "relatorios" ? (
            <ReportsSection snapshot={aresData} viewModel={viewModel} />
          ) : null}

          {["operacao", "pagar", "receber"].includes(activeSection) ? (
            <>
              <AresWorklist
                entries={viewModel.entries}
                isLoading={isLoading}
                onChangeWorkView={setWorkView}
                section={activeSection}
                viewModel={viewModel}
                workView={workView}
              />
              <AresOperationalPanels
                snapshot={aresData}
                viewModel={viewModel}
              />
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function AresSidebar({
  activeSection,
  collapsed,
  onSelect,
  onToggleCollapsed,
}: {
  activeSection: AresSection;
  collapsed: boolean;
  onSelect: (section: AresSection) => void;
  onToggleCollapsed: () => void;
}) {
  function handleOpenModuleLauncher() {
    window.dispatchEvent(new Event("careli:toggle-module-launcher"));
  }

  return (
    <aside className="panteon-module-sidebar flex h-full min-h-0 flex-col overflow-hidden border-r text-[#ECECF1]">
      <div className="panteon-module-sidebar__top">
        {collapsed ? (
          <div className="grid justify-items-center gap-2 pb-1 pt-0.5">
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-[#d5dde8]">
              <CircleDollarSign aria-hidden="true" size={18} />
            </span>
            <Tooltip content="Abrir sidebar do Panteon" placement="right">
              <button
                aria-label="Abrir sidebar do Panteon"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={handleOpenModuleLauncher}
                type="button"
              >
                <LayoutGrid aria-hidden="true" size={15} />
              </button>
            </Tooltip>
            <Tooltip content="Expandir Ares" placement="right">
              <button
                aria-label="Expandir sidebar Ares"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={onToggleCollapsed}
                type="button"
              >
                <PanelLeftOpen aria-hidden="true" size={16} />
              </button>
            </Tooltip>
          </div>
        ) : (
          <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_2rem_2rem] items-center gap-2 rounded-xl bg-white/[0.035] px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-2.5 text-[#d5dde8]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-[#101820]">
                <CircleDollarSign aria-hidden="true" size={18} />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="min-w-0 truncate text-sm font-semibold leading-tight text-white">
                  Ares
                </span>
              </span>
            </div>
            <Tooltip content="Abrir sidebar do Panteon" placement="right">
              <button
                aria-label="Abrir sidebar do Panteon"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={handleOpenModuleLauncher}
                type="button"
              >
                <LayoutGrid aria-hidden="true" size={15} />
              </button>
            </Tooltip>
            <Tooltip content="Recolher Ares" placement="right">
              <button
                aria-label="Recolher sidebar Ares"
                className="grid h-8 w-8 place-items-center rounded-lg border border-white/[0.075] text-[#a5afbd] outline-none transition hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={onToggleCollapsed}
                type="button"
              >
                <PanelLeftClose aria-hidden="true" size={16} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      <nav
        aria-label="Menu Ares"
        className={`min-h-0 flex-1 overflow-y-auto py-3 ${
          collapsed ? "px-2" : "px-3"
        }`}
      >
        <div className="grid gap-1">
          {aresNavigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const button = (
              <button
                aria-current={isActive ? "page" : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={`group relative flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
                  isActive
                    ? "bg-[#2A2B32] text-white shadow-[inset_0_0_0_1px_rgb(160_124_59_/_0.22)]"
                    : "text-[#ECECF1]/80 hover:bg-[#3f4048] hover:text-white"
                } ${collapsed ? "justify-center" : ""}`}
                onClick={() => onSelect(item.id)}
                type="button"
              >
                {isActive ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-1.5 h-7 w-0.5 rounded-full bg-[#A07C3B]"
                  />
                ) : null}
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                    isActive
                      ? "panteon-module-sidebar__active-icon"
                      : "text-[#8E8EA0]"
                  }`}
                >
                  <Icon
                    aria-hidden="true"
                    className="size-[17px] stroke-[1.75]"
                  />
                </span>
                <span className={`min-w-0 truncate ${collapsed ? "sr-only" : ""}`}>
                  {item.label}
                </span>
              </button>
            );

            return collapsed ? (
              <Tooltip content={item.label} key={item.id} placement="right">
                {button}
              </Tooltip>
            ) : (
              <div key={item.id}>{button}</div>
            );
          })}
        </div>
      </nav>

      {collapsed ? (
        <div className="border-t border-white/[0.075] px-2 py-3">
          <span className="mx-auto flex size-9 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
            <LockKeyhole className="size-4 stroke-[1.8]" aria-hidden="true" />
          </span>
        </div>
      ) : (
        <div className="m-3 rounded-md border border-[#A07C3B]/25 bg-[#A07C3B]/10 p-3 text-xs leading-5 text-[#ead7a6]">
          <p className="m-0 font-bold uppercase text-[#D6B56F]">Homologacao</p>
          <p className="m-0 mt-1">
            Leitura RLS ativa. Escritas financeiras seguem por recorte aprovado.
          </p>
        </div>
      )}
    </aside>
  );
}

function AresModuleToolbar({
  activeFinancialBaseId,
  canManage,
  financialBases,
  isBlocked,
  isLoading,
  onOpenLaunch,
  onSelectFinancialBase,
  onRefresh,
}: {
  activeFinancialBaseId: string | null;
  canManage: boolean;
  financialBases: AresFinancialBase[];
  isBlocked: boolean;
  isLoading: boolean;
  onOpenLaunch: () => void;
  onSelectFinancialBase: (financialBaseId: string) => void;
  onRefresh: () => void;
}) {
  const isLaunchDisabled =
    isBlocked || isLoading || !canManage || !activeFinancialBaseId;

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <label className="grid min-w-[16rem] gap-1 text-[0.6875rem] font-bold uppercase text-[#667085]">
        Empresa
        <select
          aria-label="Selecionar empresa Ares"
          className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-sm font-semibold normal-case text-[#243044] outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          disabled={isLoading || financialBases.length === 0}
          onChange={(event) => onSelectFinancialBase(event.target.value)}
          value={activeFinancialBaseId ?? ""}
        >
          {financialBases.length === 0 ? (
            <option value="">Cadastre uma empresa</option>
          ) : null}
          {financialBases.map((base) => (
            <option key={base.id} value={base.id}>
              {base.code ? `${base.code} - ${base.name}` : base.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Tooltip
          content={
            canManage
              ? "Criar lancamento manual"
              : "Permissao financeiro:manage necessaria"
          }
          placement="bottom"
        >
          <button
            aria-label="Criar lancamento manual"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#101820] bg-[#101820] px-3 text-sm font-semibold text-white outline-none transition hover:bg-[#182431] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:border-[#d9e0e7] disabled:bg-[#f8fafc] disabled:text-[#98a2b3]"
            disabled={isLaunchDisabled}
            onClick={onOpenLaunch}
            type="button"
          >
            <Plus aria-hidden="true" size={15} />
            Novo lancamento
          </button>
        </Tooltip>
        <Tooltip content="Atualizar dados do Ares" placement="bottom">
          <button
            aria-label="Atualizar dados do Ares"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#243044] outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:opacity-60"
            disabled={isLoading}
            onClick={onRefresh}
            type="button"
          >
            <RefreshCcw aria-hidden="true" size={15} />
            Atualizar
          </button>
        </Tooltip>
        {!canManage || isBlocked ? (
          <button
            className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-md border border-[#A07C3B]/35 bg-[#A07C3B]/10 px-3 text-sm font-semibold text-[#8a682f] opacity-85"
            disabled
            type="button"
          >
            <LockKeyhole aria-hidden="true" size={15} />
            {isBlocked ? "Operacao bloqueada" : "Escrita controlada"}
          </button>
        ) : null}
        <PanteonTopbarUser className="ml-1 border-l border-[#d9e0e7] pl-3" />
      </div>
    </div>
  );
}

function AresHeader({
  activeFinancialBase,
  filters,
  generatedAt,
  onChangeFilters,
  section,
  sourceTables,
}: {
  activeFinancialBase: AresFinancialBase | null;
  filters: AresFilters;
  generatedAt: string;
  onChangeFilters: (filters: AresFilters) => void;
  section: AresSection;
  sourceTables: number;
}) {
  return (
    <section className="mb-3 grid gap-3 rounded-lg border border-[#d9e0e7] bg-white p-3 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-[#101820] text-white">
            <CircleDollarSign aria-hidden="true" size={17} />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-lg font-semibold tracking-normal text-[#101820]">
              {sectionTitles[section]}
            </h1>
            <p className="m-0 mt-0.5 text-xs font-medium text-[#667085]">
              {activeFinancialBase?.name ?? "Empresa nao selecionada"} / public
              ares_* / {sourceTables} tabelas / atualizado{" "}
              {formatDateTime(generatedAt)}
            </p>
          </div>
          {activeFinancialBase ? (
            <span
              className="inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold text-[#243044]"
              style={{
                backgroundColor: `${activeFinancialBase.accentColor}18`,
                borderColor: `${activeFinancialBase.accentColor}55`,
              }}
            >
              {activeFinancialBase.code
                ? `${activeFinancialBase.code} - ${activeFinancialBase.name}`
                : activeFinancialBase.name}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="size-4 text-[#667085]" aria-hidden="true" />
        <select
          aria-label="Filtrar periodo"
          className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-sm font-medium text-[#243044] outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onChange={(event) =>
            onChangeFilters({
              ...filters,
              period: event.target.value as AresFilters["period"],
            })
          }
          value={filters.period}
        >
          <option value="all">Todo periodo</option>
          <option value="7">7 dias</option>
          <option value="30">30 dias</option>
          <option value="90">90 dias</option>
        </select>
        <select
          aria-label="Filtrar tipo"
          className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-sm font-medium text-[#243044] outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onChange={(event) =>
            onChangeFilters({
              ...filters,
              kind: event.target.value as AresFilters["kind"],
            })
          }
          value={filters.kind}
        >
          <option value="all">Todos</option>
          <option value="payable">Pagar</option>
          <option value="receivable">Receber</option>
          <option value="bank_statement">Extrato</option>
          <option value="adjustment">Ajuste</option>
        </select>
        <select
          aria-label="Filtrar status"
          className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-sm font-medium text-[#243044] outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onChange={(event) =>
            onChangeFilters({
              ...filters,
              status: event.target.value as AresFilters["status"],
            })
          }
          value={filters.status}
        >
          <option value="all">Todos status</option>
          <option value="open">Em aberto</option>
          <option value="overdue">Vencidos</option>
          <option value="approval">Aprovacao</option>
        </select>
      </div>
    </section>
  );
}

function AresLaunchPanel({
  accessToken,
  canManage,
  errorMessage,
  form,
  financialBases,
  isSaving,
  onChange,
  onClose,
  onSelectFinancialBase,
  onSubmit,
  status,
  viewModel,
}: {
  accessToken: string | null;
  canManage: boolean;
  errorMessage: string | null;
  form: AresLaunchFormState;
  financialBases: AresFinancialBase[];
  isSaving: boolean;
  onChange: (form: AresLaunchFormState) => void;
  onClose: () => void;
  onSelectFinancialBase: (financialBaseId: string) => void;
  onSubmit: () => void;
  status: AresLaunchStatus;
  viewModel: AresViewModel;
}) {
  function updateField<Field extends keyof AresLaunchFormState>(
    field: Field,
    value: AresLaunchFormState[Field],
  ) {
    onChange({
      ...form,
      [field]: value,
    });
  }
  const departments = getActiveDimensionsByKind(viewModel, "department");
  const costCenters = getActiveDimensionsByKind(viewModel, "cost_center").filter(
    (dimension) => dimension.parentId === form.departmentId,
  );
  const resultCenters = getActiveDimensionsByKind(
    viewModel,
    "result_center",
  ).filter((dimension) => dimension.parentId === form.departmentId);
  const selectedCenterIds = [form.costCenterId, form.resultCenterId].filter(
    Boolean,
  );
  const categories = getActiveDimensionsByKind(viewModel, "category").filter(
    (dimension) =>
      dimension.parentId ? selectedCenterIds.includes(dimension.parentId) : false,
  );
  const projects = getActiveDimensionsByKind(viewModel, "project").filter(
    (dimension) => dimension.parentId === form.categoryId,
  );

  function handleFinancialBaseChange(financialBaseId: string) {
    onSelectFinancialBase(financialBaseId);
    onChange({
      ...form,
      categoryId: "",
      costCenterId: "",
      departmentId: "",
      financialBaseId,
      projectId: "",
      resultCenterId: "",
    });
  }

  function handleDepartmentChange(departmentId: string) {
    onChange({
      ...form,
      categoryId: "",
      costCenterId: "",
      departmentId,
      projectId: "",
      resultCenterId: "",
    });
  }

  function handleCenterChange(
    field: "costCenterId" | "resultCenterId",
    centerId: string,
  ) {
    const nextForm = {
      ...form,
      [field]: centerId,
    };
    const nextCenterIds = [
      field === "costCenterId" ? centerId : form.costCenterId,
      field === "resultCenterId" ? centerId : form.resultCenterId,
    ].filter(Boolean);
    const currentCategory = viewModel.dimensionById.get(form.categoryId);
    const shouldResetCategory =
      !currentCategory?.parentId ||
      !nextCenterIds.includes(currentCategory.parentId);

    onChange({
      ...nextForm,
      categoryId: shouldResetCategory ? "" : form.categoryId,
      projectId: shouldResetCategory ? "" : form.projectId,
    });
  }

  function handleCategoryChange(categoryId: string) {
    onChange({
      ...form,
      categoryId,
      projectId: "",
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#101820]/45 px-3 py-4 backdrop-blur-[2px]">
      <section
        aria-labelledby="ares-launch-title"
        aria-modal="true"
        className="grid max-h-[92dvh] w-full max-w-6xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-[#d9e0e7] bg-white shadow-2xl"
        role="dialog"
      >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf0f3] px-3 py-2.5">
        <div className="min-w-0">
          <h2
            className="m-0 text-sm font-semibold text-[#101820]"
            id="ares-launch-title"
          >
            Novo lancamento
          </h2>
          <p className="m-0 mt-0.5 text-xs text-[#667085]">
            Campos obrigatorios para contas a pagar e contas a receber.
          </p>
        </div>
        <Tooltip content="Fechar lancamento" placement="bottom">
          <button
            aria-label="Fechar formulario de lancamento"
            className="grid size-8 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#475467] outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </Tooltip>
      </div>

      <form
        className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <fieldset
          className="grid min-h-0 gap-3 overflow-y-auto p-3 disabled:opacity-70 md:grid-cols-2 xl:grid-cols-4"
          disabled={!canManage || isSaving}
        >
          <AresLaunchSelect
            label="Empresa"
            onChange={handleFinancialBaseChange}
            options={
              financialBases.length > 0
                ? financialBases.map((base) => ({
                    label: base.code ? `${base.code} - ${base.name}` : base.name,
                    value: base.id,
                  }))
                : [{ label: "Cadastre uma empresa no Setup", value: "" }]
            }
            value={form.financialBaseId}
          />
          <AresLaunchSelect
            label="Tipo"
            onChange={(value) =>
              updateField("entryKind", value as AresLaunchFormState["entryKind"])
            }
            options={launchEntryKindOptions}
            value={form.entryKind}
          />
          <AresLaunchSelect
            label="Aprovacao"
            onChange={(value) =>
              updateField(
                "approvalStatus",
                value as AresLaunchFormState["approvalStatus"],
              )
            }
            options={launchApprovalOptions}
            value={form.approvalStatus}
          />
          <AresLaunchSelect
            label="Prioridade"
            onChange={(value) =>
              updateField("priority", value as AresLaunchFormState["priority"])
            }
            options={launchPriorityOptions}
            value={form.priority}
          />
          <AresLaunchSelect
            label="Parte"
            onChange={(value) =>
              updateField(
                "counterpartyKind",
                value as AresLaunchFormState["counterpartyKind"],
              )
            }
            options={launchCounterpartyOptions}
            value={form.counterpartyKind}
          />
          <AresLaunchInput
            label="Vencimento"
            onChange={(value) => updateField("dueDate", value)}
            type="date"
            value={form.dueDate}
          />
          <AresLaunchInput
            label="Previsao"
            onChange={(value) => updateField("forecastDate", value)}
            type="date"
            value={form.forecastDate}
          />
          <AresLaunchInput
            inputMode="decimal"
            label="Valor"
            min="0.01"
            onChange={(value) => updateField("amount", value)}
            step="0.01"
            type="number"
            value={String(form.amount)}
          />
          <AresLaunchInput
            label="Documento"
            onChange={(value) => updateField("documentNumber", value)}
            placeholder="Boleto, NF, contrato ou NSU"
            value={form.documentNumber}
          />
          <AresPartyLookup
            accessToken={accessToken}
            counterpartyKind={form.counterpartyKind}
            disabled={!canManage || isSaving}
            onChange={(value) =>
              onChange({
                ...form,
                apoloEntityId: null,
                partyName: value,
              })
            }
            onSelect={(entity) =>
              onChange({
                ...form,
                apoloEntityId: isUuid(entity.id) ? entity.id : null,
                counterpartyKind: inferCounterpartyKind(
                  entity,
                  form.counterpartyKind,
                ),
                partyName: entity.displayName,
              })
            }
            value={form.partyName}
          />
          <AresLaunchInput
            label="Conta"
            onChange={(value) => updateField("bankAccountLabel", value)}
            value={form.bankAccountLabel}
          />
          <AresLaunchInput
            label="Forma"
            onChange={(value) => updateField("paymentMethod", value)}
            placeholder="PIX, boleto, TED, cartao"
            value={form.paymentMethod}
          />
          <AresLaunchDimensionSelect
            dimensions={departments}
            emptyLabel="Cadastre departamento no Setup"
            label="Departamento"
            onChange={handleDepartmentChange}
            value={form.departmentId}
          />
          <AresLaunchDimensionSelect
            dimensions={costCenters}
            emptyLabel="Selecione o departamento"
            label="Centro de custo"
            onChange={(value) => handleCenterChange("costCenterId", value)}
            value={form.costCenterId}
          />
          <AresLaunchDimensionSelect
            dimensions={resultCenters}
            emptyLabel="Selecione o departamento"
            label="Centro de resultado"
            onChange={(value) => handleCenterChange("resultCenterId", value)}
            value={form.resultCenterId}
          />
          <AresLaunchDimensionSelect
            dimensions={categories}
            emptyLabel="Selecione os centros"
            label="Categoria"
            onChange={handleCategoryChange}
            value={form.categoryId}
          />
          <AresLaunchDimensionSelect
            dimensions={projects}
            emptyLabel="Selecione a categoria"
            label="Projeto"
            onChange={(value) => updateField("projectId", value)}
            value={form.projectId}
          />
          <AresLaunchInput
            label="Responsavel"
            onChange={(value) => updateField("responsibleName", value)}
            value={form.responsibleName}
          />
          <AresLaunchInput
            className="xl:col-span-2"
            label="Descricao"
            onChange={(value) => updateField("title", value)}
            value={form.title}
          />
          <AresLaunchInput
            label="Origem"
            onChange={(value) => updateField("sourceSystem", value)}
            value={form.sourceSystem}
          />
          <AresLaunchInput
            label="Proxima acao"
            onChange={(value) => updateField("nextAction", value)}
            value={form.nextAction}
          />
          <label className="grid gap-1 text-xs font-bold uppercase text-[#667085] md:col-span-2 xl:col-span-4">
            Observacoes
            <textarea
              className={launchTextareaClass}
              onChange={(event) => updateField("notes", event.target.value)}
              placeholder="Contexto operacional sem dados sensiveis desnecessarios"
              value={form.notes ?? ""}
            />
          </label>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0f3] bg-white px-3 py-3">
          <div className="min-h-5 text-xs font-semibold">
            {status === "saved" ? (
              <span className="text-emerald-700">
                Lancamento gravado e mesa atualizada.
              </span>
            ) : null}
            {status === "error" ? (
              <span className="text-red-700">{errorMessage}</span>
            ) : null}
            {!canManage ? (
              <span className="text-[#8a682f]">
                Escrita exige permissao financeiro:manage.
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex h-9 items-center justify-center rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#344054] outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={onClose}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[#101820] bg-[#101820] px-3 text-sm font-semibold text-white outline-none transition hover:bg-[#182431] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:border-[#d9e0e7] disabled:bg-[#f8fafc] disabled:text-[#98a2b3]"
              disabled={!canManage || isSaving}
              type="submit"
            >
              <Plus aria-hidden="true" size={15} />
              {isSaving ? "Gravando" : "Realizar lancamento"}
            </button>
          </div>
        </div>
      </form>
      </section>
    </div>
  );
}

function AresPartyLookup({
  accessToken,
  counterpartyKind,
  disabled,
  onChange,
  onSelect,
  value,
}: {
  accessToken: string | null;
  counterpartyKind: AresCounterpartyKind;
  disabled: boolean;
  onChange: (value: string) => void;
  onSelect: (entity: AresApoloSearchResult) => void;
  value: string;
}) {
  const [results, setResults] = useState<AresApoloSearchResult[]>([]);
  const [status, setStatus] = useState<AresApoloSearchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const normalizedValue = value.trim();
  const partyLabel =
    counterpartyKind === "supplier"
      ? "Fornecedor no Apolo"
      : "Cadastro no Apolo";

  useEffect(() => {
    if (disabled || normalizedValue.length < 2) {
      setResults([]);
      setStatus("idle");
      setErrorMessage(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void searchApoloParties({
        accessToken,
        counterpartyKind,
        query: normalizedValue,
        signal: controller.signal,
      })
        .then((nextResults) => {
          setResults(nextResults);
          setStatus(nextResults.length > 0 ? "ready" : "empty");
          setErrorMessage(null);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }

          setResults([]);
          setStatus("error");
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Nao foi possivel buscar no Apolo.",
          );
        });
    }, 260);

    setStatus("loading");
    setErrorMessage(null);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [accessToken, counterpartyKind, disabled, normalizedValue]);

  return (
    <div className="grid min-w-0 gap-1 text-xs font-bold uppercase text-[#667085]">
      <span>{partyLabel}</span>
      <span className="relative block">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[#98a2b3]"
        />
        <input
          aria-label={`Buscar ${partyLabel.toLowerCase()}`}
          className={`${launchFieldClass} pl-8`}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Buscar no CRM Apolo"
          required
          type="search"
          value={value}
        />
      </span>
      {status !== "idle" ? (
        <div className="mt-1 max-h-44 overflow-y-auto rounded-md border border-[#d9e0e7] bg-white shadow-sm">
          {status === "loading" ? (
            <div className="flex h-10 items-center gap-2 px-2.5 text-xs font-semibold normal-case text-[#667085]">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Buscando no Apolo
            </div>
          ) : null}
          {status === "empty" ? (
            <div className="px-2.5 py-2 text-xs font-semibold normal-case text-[#667085]">
              Nenhum cadastro encontrado no Apolo.
            </div>
          ) : null}
          {status === "error" ? (
            <div className="px-2.5 py-2 text-xs font-semibold normal-case text-red-700">
              {errorMessage ?? "Nao foi possivel buscar no Apolo."}
            </div>
          ) : null}
          {status === "ready"
            ? results.map((entity) => (
                <button
                  className="grid w-full gap-0.5 border-b border-[#edf0f3] px-2.5 py-2 text-left outline-none transition last:border-b-0 hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                  key={entity.id}
                  onClick={() => onSelect(entity)}
                  type="button"
                >
                  <span className="truncate text-sm font-semibold normal-case text-[#101820]">
                    {entity.displayName}
                  </span>
                  <span className="truncate text-xs font-medium normal-case text-[#667085]">
                    {[entity.documentMasked, entity.locationLabel]
                      .filter(Boolean)
                      .join(" / ") || "Cadastro Apolo"}
                  </span>
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function AresLaunchInput({
  className = "",
  inputMode,
  label,
  min,
  onChange,
  placeholder,
  required = true,
  step,
  type = "text",
  value,
}: {
  className?: string;
  inputMode?: "decimal" | "numeric" | "search" | "text";
  label: string;
  min?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  step?: string;
  type?: "date" | "number" | "text";
  value: string;
}) {
  return (
    <label
      className={`grid min-w-0 gap-1 text-xs font-bold uppercase text-[#667085] ${className}`}
    >
      {label}
      <input
        className={launchFieldClass}
        inputMode={inputMode}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        step={step}
        type={type}
        value={value}
      />
    </label>
  );
}

function AresLaunchSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: readonly { label: string; value: string }[];
  value: string;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-bold uppercase text-[#667085]">
      {label}
      <select
        className={launchFieldClass}
        onChange={(event) => onChange(event.target.value)}
        required
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function AresLaunchDimensionSelect({
  dimensions,
  emptyLabel,
  label,
  onChange,
  value,
}: {
  dimensions: AresDimension[];
  emptyLabel?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const activeDimensions = dimensions.filter(
    (dimension) => dimension.status === "active",
  );
  const options = [
    {
      label:
        activeDimensions.length > 0
          ? `Selecione ${label.toLocaleLowerCase("pt-BR")}`
          : (emptyLabel ?? "Cadastre no Setup"),
      value: "",
    },
    ...activeDimensions.map((dimension) => ({
      label: dimension.code
        ? `${dimension.code} - ${dimension.name}`
        : dimension.name,
      value: dimension.id,
    })),
  ];

  return (
    <AresLaunchSelect
      label={label}
      onChange={onChange}
      options={options}
      value={value}
    />
  );
}

function AresSummaryCards({ snapshot }: { snapshot: AresSnapshot }) {
  const cards = [
    {
      icon: ArrowUpCircle,
      label: "A pagar em aberto",
      value: formatCurrency(snapshot.summary.payablesOpenAmount),
      detail: `${snapshot.summary.payablesOpenCount} lancamentos`,
    },
    {
      icon: ArrowDownCircle,
      label: "A receber em aberto",
      value: formatCurrency(snapshot.summary.receivablesOpenAmount),
      detail: `${snapshot.summary.receivablesOpenCount} lancamentos`,
    },
    {
      icon: CalendarClock,
      label: "Vencidos",
      value: snapshot.summary.overdueCount.toString(),
      detail: "pendencias fora do prazo",
    },
    {
      icon: Landmark,
      label: "Conciliacao",
      value: snapshot.summary.reconciliationPendingCount.toString(),
      detail: "linhas para revisar",
    },
    {
      icon: CheckCircle2,
      label: "Aprovacao",
      value: snapshot.summary.approvalPendingCount.toString(),
      detail: "aguardando decisao",
    },
  ];

  return (
    <section className="mb-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => {
        const Icon = card.icon;

        return (
          <div
            className="min-h-[6.25rem] rounded-lg border border-[#d9e0e7] bg-white p-3 shadow-sm"
            key={card.label}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="m-0 text-xs font-bold uppercase text-[#667085]">
                {card.label}
              </p>
              <span className="grid size-8 place-items-center rounded-md bg-[#101820]/5 text-[#101820]">
                <Icon aria-hidden="true" size={16} />
              </span>
            </div>
            <p className="m-0 mt-2 truncate text-xl font-semibold text-[#101820]">
              {card.value}
            </p>
            <p className="m-0 mt-1 truncate text-xs font-medium text-[#667085]">
              {card.detail}
            </p>
          </div>
        );
      })}
    </section>
  );
}

function AresWorklist({
  entries,
  isLoading,
  onChangeWorkView,
  section,
  viewModel,
  workView,
}: {
  entries: AresFinancialEntry[];
  isLoading: boolean;
  onChangeWorkView: (view: AresWorkView) => void;
  section: AresSection;
  viewModel: AresViewModel;
  workView: AresWorkView;
}) {
  const title =
    section === "pagar"
      ? "Pendencias de pagamento"
      : section === "receber"
        ? "Pendencias de recebimento"
        : "Movimentos e pendencias";
  const viewOptions = [
    {
      icon: LayoutGrid,
      label: "Kanban",
      value: "kanban",
    },
    {
      icon: TableProperties,
      label: "Lista",
      value: "list",
    },
  ] as const satisfies readonly {
    icon: LucideIcon;
    label: string;
    value: AresWorkView;
  }[];

  return (
    <section className="mb-3 grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#d9e0e7] bg-white px-3 py-2.5 shadow-sm">
        <div>
          <h2 className="m-0 text-sm font-semibold text-[#101820]">
            {title}
          </h2>
          <p className="m-0 mt-0.5 text-xs text-[#667085]">
            Kanban por etapa ou lista operacional com vencimento, centro,
            projeto, departamento e proxima acao.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex h-8 items-center gap-2 rounded-md border border-[#d9e0e7] bg-[#f8fafc] px-2.5 text-xs font-semibold text-[#475467]">
            <Search aria-hidden="true" size={14} />
            {entries.length} registros
          </div>
          <div
            aria-label="Alternar visualizacao da operacao Ares"
            className="inline-flex h-8 overflow-hidden rounded-md border border-[#d9e0e7] bg-white"
            role="group"
          >
            {viewOptions.map((option) => {
              const Icon = option.icon;
              const active = workView === option.value;

              return (
                <button
                  aria-pressed={active}
                  className={`inline-flex h-8 items-center gap-1.5 border-r border-[#edf0f3] px-2.5 text-xs font-semibold outline-none transition last:border-r-0 focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
                    active
                      ? "bg-[#101820] text-white"
                      : "bg-white text-[#475467] hover:bg-[#f8fafc]"
                  }`}
                  key={option.value}
                  onClick={() => onChangeWorkView(option.value)}
                  type="button"
                >
                  <Icon aria-hidden="true" size={14} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {workView === "kanban" ? (
        <AresKanbanBoard
          entries={entries}
          isLoading={isLoading}
          viewModel={viewModel}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d9e0e7] bg-white shadow-sm">
          <table className="min-w-[82rem] w-full border-collapse text-left text-sm">
            <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
              <tr>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Vencimento</th>
                <th className="px-3 py-2 font-semibold">Responsavel</th>
                <th className="px-3 py-2 font-semibold">Titulo</th>
                <th className="px-3 py-2 font-semibold">Centro</th>
                <th className="px-3 py-2 font-semibold">Projeto</th>
                <th className="px-3 py-2 font-semibold">Departamento</th>
                <th className="px-3 py-2 text-right font-semibold">Valor</th>
                <th className="px-3 py-2 font-semibold">Prioridade</th>
                <th className="px-3 py-2 font-semibold">Proxima acao</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f3]">
              {entries.map((entry) => (
                <tr className="align-middle hover:bg-[#fbfcfd]" key={entry.id}>
                  <td className="px-3 py-2">
                    <StatusBadge status={entry.lifecycleStatus} />
                  </td>
                  <td className="px-3 py-2 text-[#344054]">
                    {formatDate(entry.dueDate)}
                  </td>
                  <td className="max-w-[11rem] px-3 py-2">
                    <div className="truncate font-semibold text-[#344054]">
                      {entry.responsibleNameSnapshot ?? "A definir"}
                    </div>
                    <div className="truncate text-xs text-[#667085]">
                      {getEntryKindLabel(entry.entryKind)}
                    </div>
                  </td>
                  <td className="max-w-[18rem] px-3 py-2">
                    <div className="truncate font-semibold text-[#101820]">
                      {entry.title}
                    </div>
                    <div className="truncate text-xs text-[#667085]">
                      {entry.partyNameSnapshot ??
                        getEntryKindLabel(entry.entryKind)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[#344054]">
                    {getCostCenterName(entry, viewModel)}
                  </td>
                  <td className="px-3 py-2 text-[#344054]">
                    {getProjectName(entry, viewModel)}
                  </td>
                  <td className="px-3 py-2 text-[#344054]">
                    {getDepartmentName(entry, viewModel)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-[#101820]">
                    {formatCurrency(getEntryDisplayAmount(entry))}
                  </td>
                  <td className="px-3 py-2">
                    <PriorityBadge priority={entry.priority} />
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex h-7 items-center rounded-md border border-[#d9e0e7] bg-white px-2 text-xs font-semibold text-[#475467]">
                      {entry.nextAction ?? getNextAction(entry)}
                    </span>
                  </td>
                </tr>
              ))}
              {entries.length === 0 ? (
                <tr>
                  <td className="px-3 py-10 text-center" colSpan={10}>
                    <div className="mx-auto grid max-w-md justify-items-center gap-2">
                      <span className="grid size-10 place-items-center rounded-lg bg-[#101820]/5 text-[#101820]">
                        {isLoading ? (
                          <RefreshCcw aria-hidden="true" size={17} />
                        ) : (
                          <ClipboardList aria-hidden="true" size={17} />
                        )}
                      </span>
                      <p className="m-0 text-sm font-semibold text-[#243044]">
                        {isLoading
                          ? "Carregando base financeira"
                          : "Nenhum lancamento oficial registrado"}
                      </p>
                      <p className="m-0 text-xs text-[#667085]">
                        Ares esta lendo as tabelas reais em Supabase. Sem mock
                        financeiro.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AresKanbanBoard({
  entries,
  isLoading,
  viewModel,
}: {
  entries: AresFinancialEntry[];
  isLoading: boolean;
  viewModel: AresViewModel;
}) {
  const columns = createAresKanbanColumns(entries);

  return (
    <div className="grid gap-2 xl:grid-cols-4">
      {columns.map((column) => {
        const amount = column.entries.reduce(
          (total, entry) => total + getEntryDisplayAmount(entry),
          0,
        );

        return (
          <section
            className="min-h-[18rem] rounded-lg border border-[#d9e0e7] bg-[#f8fafc] shadow-sm"
            key={column.id}
          >
            <div className="border-b border-[#d9e0e7] bg-white px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="m-0 truncate text-sm font-semibold text-[#101820]">
                    {column.label}
                  </h3>
                  <p className="m-0 mt-0.5 text-xs text-[#667085]">
                    {column.description}
                  </p>
                </div>
                <span className="inline-flex h-7 shrink-0 items-center rounded-md border border-[#d9e0e7] bg-[#f8fafc] px-2 text-xs font-semibold text-[#475467]">
                  {column.entries.length}
                </span>
              </div>
              <p className="m-0 mt-2 truncate text-sm font-semibold text-[#101820]">
                {formatCurrency(amount)}
              </p>
            </div>
            <div className="grid gap-2 p-2.5">
              {column.entries.map((entry) => (
                <AresKanbanCard
                  entry={entry}
                  key={entry.id}
                  viewModel={viewModel}
                />
              ))}
              {column.entries.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#d9e0e7] bg-white px-3 py-6 text-center">
                  <span className="mx-auto grid size-9 place-items-center rounded-md bg-[#101820]/5 text-[#101820]">
                    {isLoading ? (
                      <RefreshCcw aria-hidden="true" size={16} />
                    ) : (
                      <ClipboardList aria-hidden="true" size={16} />
                    )}
                  </span>
                  <p className="m-0 mt-2 text-xs font-semibold text-[#475467]">
                    {isLoading
                      ? "Carregando etapa"
                      : "Sem lancamentos nesta etapa"}
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AresKanbanCard({
  entry,
  viewModel,
}: {
  entry: AresFinancialEntry;
  viewModel: AresViewModel;
}) {
  const center = getCostCenterName(entry, viewModel);
  const department = getDepartmentName(entry, viewModel);
  const project = getProjectName(entry, viewModel);

  return (
    <article className="rounded-md border border-[#d9e0e7] bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <StatusBadge status={entry.lifecycleStatus} />
        <PriorityBadge priority={entry.priority} />
      </div>
      <h4 className="m-0 mt-2 line-clamp-2 text-sm font-semibold text-[#101820]">
        {entry.title}
      </h4>
      <p className="m-0 mt-1 truncate text-xs font-medium text-[#667085]">
        {entry.partyNameSnapshot ?? getEntryKindLabel(entry.entryKind)}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="m-0 font-bold uppercase text-[#98a2b3]">Vencimento</p>
          <p className="m-0 mt-0.5 font-semibold text-[#344054]">
            {formatDate(entry.dueDate ?? entry.forecastDate)}
          </p>
        </div>
        <div>
          <p className="m-0 font-bold uppercase text-[#98a2b3]">Valor</p>
          <p className="m-0 mt-0.5 truncate font-semibold text-[#101820]">
            {formatCurrency(getEntryDisplayAmount(entry))}
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-1 text-xs text-[#667085]">
        <p className="m-0 truncate">
          <span className="font-bold text-[#475467]">Resp.</span>{" "}
          {entry.responsibleNameSnapshot ?? "A definir"}
        </p>
        <p className="m-0 truncate">
          <span className="font-bold text-[#475467]">Centro</span> {center}
        </p>
        <p className="m-0 truncate">
          <span className="font-bold text-[#475467]">Projeto</span> {project}
        </p>
        <p className="m-0 truncate">
          <span className="font-bold text-[#475467]">Depto.</span>{" "}
          {department}
        </p>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#edf0f3] pt-2">
        <span className="truncate text-xs font-semibold text-[#667085]">
          {getEntryKindLabel(entry.entryKind)}
        </span>
        <span className="inline-flex h-7 max-w-[9.5rem] items-center rounded-md border border-[#d9e0e7] bg-[#f8fafc] px-2 text-xs font-semibold text-[#475467]">
          <span className="truncate">
            {entry.nextAction ?? getNextAction(entry)}
          </span>
        </span>
      </div>
    </article>
  );
}

function createAresKanbanColumns(
  entries: AresFinancialEntry[],
): AresKanbanColumn[] {
  const columns: AresKanbanColumn[] = [
    {
      description: "validar antes de programar",
      entries: [],
      id: "approval",
      label: "Aguardando aprovacao",
    },
    {
      description: "lancamentos abertos",
      entries: [],
      id: "scheduled",
      label: "A vencer",
    },
    {
      description: "exige decisao operacional",
      entries: [],
      id: "critical",
      label: "Vencidos / bloqueados",
    },
    {
      description: "baixa, recebimento ou conciliacao",
      entries: [],
      id: "settled",
      label: "Liquidados / conciliados",
    },
  ];
  const columnById = new Map(columns.map((column) => [column.id, column]));

  for (const entry of entries) {
    columnById.get(getAresKanbanColumnId(entry))?.entries.push(entry);
  }

  return columns;
}

function getAresKanbanColumnId(entry: AresFinancialEntry) {
  if (
    entry.approvalStatus === "pending" ||
    entry.lifecycleStatus === "approval_pending" ||
    entry.lifecycleStatus === "draft"
  ) {
    return "approval";
  }

  if (
    entry.approvalStatus === "blocked" ||
    entry.approvalStatus === "rejected" ||
    entry.lifecycleStatus === "blocked" ||
    entry.lifecycleStatus === "overdue"
  ) {
    return "critical";
  }

  if (settledStatuses.has(entry.lifecycleStatus)) {
    return "settled";
  }

  return "scheduled";
}

function getEntryDisplayAmount(entry: AresFinancialEntry) {
  return entry.amountOpen || entry.amountGross || 0;
}

function AresOperationalPanels({
  snapshot,
  viewModel,
}: {
  snapshot: AresSnapshot;
  viewModel: AresViewModel;
}) {
  const panels = [
    {
      icon: WalletCards,
      label: "Contas correntes",
      value: snapshot.bankAccounts.length.toString(),
      detail: "cadastros operacionais",
    },
    {
      icon: Banknote,
      label: "Pagamentos da semana",
      value: formatCurrency(viewModel.paymentWeekAmount),
      detail: `${viewModel.nextPayables.length} titulos`,
    },
    {
      icon: Building2,
      label: "Setup",
      value: snapshot.dimensions.length.toString(),
      detail: "centros, projetos e categorias",
    },
  ];

  return (
    <section className="grid gap-2 lg:grid-cols-3">
      {panels.map((panel) => {
        const Icon = panel.icon;

        return (
          <div
            className="rounded-lg border border-[#d9e0e7] bg-white p-3 shadow-sm"
            key={panel.label}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="m-0 text-xs font-bold uppercase text-[#667085]">
                  {panel.label}
                </p>
                <p className="m-0 mt-1 text-lg font-semibold text-[#101820]">
                  {panel.value}
                </p>
                <p className="m-0 mt-1 text-xs text-[#667085]">
                  {panel.detail}
                </p>
              </div>
              <span className="grid size-9 place-items-center rounded-md bg-[#A07C3B]/10 text-[#8a682f]">
                <Icon aria-hidden="true" size={17} />
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function ReconciliationSection({
  snapshot,
  viewModel,
}: {
  snapshot: AresSnapshot;
  viewModel: AresViewModel;
}) {
  return (
    <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="rounded-lg border border-[#d9e0e7] bg-white shadow-sm">
        <div className="border-b border-[#edf0f3] px-3 py-2.5">
          <h2 className="m-0 text-sm font-semibold text-[#101820]">
            Extrato bancario
          </h2>
          <p className="m-0 mt-0.5 text-xs text-[#667085]">
            Linhas OFX/API/manual para revisar contra lancamentos Ares.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[46rem] w-full text-left text-sm">
            <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
              <tr>
                <th className="px-3 py-2 font-semibold">Data</th>
                <th className="px-3 py-2 font-semibold">Descricao</th>
                <th className="px-3 py-2 font-semibold">Conta</th>
                <th className="px-3 py-2 text-right font-semibold">Valor</th>
                <th className="px-3 py-2 font-semibold">Match</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf0f3]">
              {snapshot.statementLines.map((line) => (
                <tr key={line.id}>
                  <td className="px-3 py-2">{formatDate(line.transactionDate)}</td>
                  <td className="max-w-[18rem] truncate px-3 py-2 font-medium">
                    {line.description}
                  </td>
                  <td className="px-3 py-2 text-[#475467]">
                    {getBankAccountName(viewModel, line.bankAccountId)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {formatCurrency(line.amount)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex h-7 items-center rounded-md border border-[#d9e0e7] px-2 text-xs font-semibold text-[#475467]">
                      {line.matchStatus}
                    </span>
                  </td>
                </tr>
              ))}
              {snapshot.statementLines.length === 0 ? (
                <tr>
                  <td className="px-3 py-10 text-center text-sm text-[#667085]" colSpan={5}>
                    Nenhuma linha de extrato importada.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-lg border border-[#d9e0e7] bg-white p-3 shadow-sm">
        <p className="m-0 text-xs font-bold uppercase text-[#667085]">
          Importacoes
        </p>
        <div className="mt-3 grid gap-2">
          {snapshot.statementImports.map((item) => (
            <div
              className="rounded-md border border-[#edf0f3] bg-[#fbfcfd] p-2"
              key={item.id}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#101820]">
                  {item.sourceType.toUpperCase()}
                </span>
                <span className="text-xs font-semibold text-[#667085]">
                  {item.status}
                </span>
              </div>
              <p className="m-0 mt-1 text-xs text-[#667085]">
                {item.lineCount} linhas / {item.unmatchedCount} pendentes
              </p>
            </div>
          ))}
          {snapshot.statementImports.length === 0 ? (
            <p className="m-0 rounded-md border border-dashed border-[#d9e0e7] p-3 text-sm text-[#667085]">
              OFX e integracoes bancarias aguardam recorte operacional.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ReportsSection({
  snapshot,
  viewModel,
}: {
  snapshot: AresSnapshot;
  viewModel: AresViewModel;
}) {
  const reports = [
    {
      icon: BarChart3,
      label: "Previsto x realizado",
      value: `${snapshot.summary.entriesCount} lancamentos`,
      status: "Base Ares",
    },
    {
      icon: Banknote,
      label: "Pagamentos da semana",
      value: formatCurrency(viewModel.paymentWeekAmount),
      status: "Leitura operacional",
    },
    {
      icon: CalendarClock,
      label: "Previsao de pagamentos",
      value: formatCurrency(snapshot.summary.payablesOpenAmount),
      status: "Em aberto",
    },
    {
      icon: FileBarChart,
      label: "DRE gerencial",
      value: `${viewModel.dimensionsByKind.get("result_center")?.length ?? 0} centros`,
      status: "Setup inicial",
    },
  ];

  return (
    <section className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
      {reports.map((report) => {
        const Icon = report.icon;

        return (
          <div
            className="rounded-lg border border-[#d9e0e7] bg-white p-3 shadow-sm"
            key={report.label}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="grid size-9 place-items-center rounded-md bg-[#101820]/5 text-[#101820]">
                <Icon aria-hidden="true" size={17} />
              </span>
              <span className="rounded-full bg-[#A07C3B]/10 px-2 py-1 text-[0.6875rem] font-bold uppercase text-[#8a682f]">
                {report.status}
              </span>
            </div>
            <p className="m-0 mt-3 text-sm font-semibold text-[#101820]">
              {report.label}
            </p>
            <p className="m-0 mt-1 text-lg font-semibold text-[#101820]">
              {report.value}
            </p>
          </div>
        );
      })}
    </section>
  );
}

function StructureSection({
  accessToken,
  activeFinancialBaseId,
  canManageSetup,
  onRefresh,
  snapshot,
  viewModel,
}: {
  accessToken: string | null;
  activeFinancialBaseId: string | null;
  canManageSetup: boolean;
  onRefresh: () => Promise<void>;
  snapshot: AresSnapshot;
  viewModel: AresViewModel;
}) {
  const [form, setForm] = useState<AresDimensionSetupFormState>(() =>
    createInitialDimensionSetupForm("cost_center", activeFinancialBaseId ?? ""),
  );
  const [activeSetupTab, setActiveSetupTab] =
    useState<AresSetupTab>("financial_base");
  const [saveStatus, setSaveStatus] =
    useState<AresDimensionSaveStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dimensionKinds: AresDimensionKind[] = [
    "cost_center",
    "result_center",
    "project",
    "category",
    "department",
  ];
  const activeDimensionKind =
    activeSetupTab === "financial_base" ? "department" : activeSetupTab;
  const isSaving = saveStatus === "saving";
  const activeRows = viewModel.dimensionsByKind.get(activeDimensionKind) ?? [];
  const activeDimensionLabel = dimensionSingularLabels[activeDimensionKind];
  const parentOptions = getDimensionParentOptions(
    activeDimensionKind,
    viewModel,
  );
  const parentLabel = getDimensionParentLabel(activeDimensionKind);
  const needsParent = activeDimensionKind !== "department";

  useEffect(() => {
    setForm((currentForm) => ({
      ...currentForm,
      financialBaseId: activeFinancialBaseId ?? "",
    }));
  }, [activeFinancialBaseId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSaveStatus("saving");

    try {
      await createAresDimension(form, accessToken);
      setForm(createInitialDimensionSetupForm(form.kind, activeFinancialBaseId ?? ""));
      setSaveStatus("saved");
      await onRefresh();
    } catch (error) {
      setSaveStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Nao foi possivel gravar o setup financeiro.",
      );
    }
  }

  function updateField<Field extends keyof AresDimensionSetupFormState>(
    field: Field,
    value: AresDimensionSetupFormState[Field],
  ) {
    setForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  function handleSelectDimensionKind(kind: AresDimensionKind) {
    setActiveSetupTab(kind);
    setForm(createInitialDimensionSetupForm(kind, activeFinancialBaseId ?? ""));
    setErrorMessage(null);
    setSaveStatus("idle");
  }

  async function handleUpdateParent(
    dimension: AresDimension,
    parentId: string,
  ) {
    setErrorMessage(null);
    setSaveStatus("saving");

    try {
      await updateAresDimension(
        {
          id: dimension.id,
          parentId,
        },
        accessToken,
      );
      setSaveStatus("saved");
      await onRefresh();
    } catch (error) {
      setSaveStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Nao foi possivel atualizar o vinculo do setup.",
      );
    }
  }

  return (
    <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="grid gap-3">
        <div className="overflow-hidden rounded-lg border border-[#d9e0e7] bg-white shadow-sm">
          <div className="border-b border-[#edf0f3] px-3 py-2.5">
            <div
              aria-label="Tipos de setup financeiro"
              className="flex flex-wrap gap-1"
              role="tablist"
            >
              <button
                aria-selected={activeSetupTab === "financial_base"}
                className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
                  activeSetupTab === "financial_base"
                    ? "border-[#101820] bg-[#101820] text-white"
                    : "border-[#d9e0e7] bg-white text-[#475467] hover:bg-[#f8fafc]"
                }`}
                onClick={() => {
                  setActiveSetupTab("financial_base");
                  setErrorMessage(null);
                  setSaveStatus("idle");
                }}
                role="tab"
                type="button"
              >
                Empresas
                <span
                  className={`inline-flex min-w-6 justify-center rounded-full px-1.5 py-0.5 text-[0.6875rem] ${
                    activeSetupTab === "financial_base"
                      ? "bg-white/12 text-white"
                      : "bg-[#f2f4f7] text-[#667085]"
                  }`}
                >
                  {snapshot.financialBases.length}
                </span>
              </button>
              {dimensionKinds.map((kind) => {
                const rows = viewModel.dimensionsByKind.get(kind) ?? [];
                const isActive = activeSetupTab === kind;

                return (
                  <button
                    aria-selected={isActive}
                    className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
                      isActive
                        ? "border-[#101820] bg-[#101820] text-white"
                        : "border-[#d9e0e7] bg-white text-[#475467] hover:bg-[#f8fafc]"
                    }`}
                    key={kind}
                    onClick={() => handleSelectDimensionKind(kind)}
                    role="tab"
                    type="button"
                  >
                    {dimensionLabels[kind]}
                    <span
                      className={`inline-flex min-w-6 justify-center rounded-full px-1.5 py-0.5 text-[0.6875rem] ${
                        isActive
                          ? "bg-white/12 text-white"
                          : "bg-[#f2f4f7] text-[#667085]"
                      }`}
                    >
                      {rows.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {activeSetupTab === "financial_base" ? (
            <AresFinancialBaseSetup
              accessToken={accessToken}
              canManageSetup={canManageSetup}
              isSaving={isSaving}
              onRefresh={onRefresh}
              setErrorMessage={setErrorMessage}
              setSaveStatus={setSaveStatus}
              snapshot={snapshot}
            />
          ) : (
          <form
            className="border-b border-[#edf0f3] p-3"
            onSubmit={handleSubmit}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-sm font-semibold text-[#101820]">
                  Cadastrar {activeDimensionLabel.toLocaleLowerCase("pt-BR")}
                </h2>
                <p className="m-0 mt-0.5 text-xs text-[#667085]">
                  Codigo sequencial automatico.
                </p>
              </div>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-[#101820] bg-[#101820] px-3 text-sm font-semibold text-white outline-none transition hover:bg-[#182431] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:border-[#d9e0e7] disabled:bg-[#f8fafc] disabled:text-[#98a2b3]"
                disabled={!canManageSetup || isSaving || !activeFinancialBaseId}
                type="submit"
              >
                {isSaving ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <Plus aria-hidden="true" size={15} />
                )}
                {isSaving ? "Gravando" : "Cadastrar"}
              </button>
            </div>
            <fieldset
              className="mt-3 grid gap-2 disabled:opacity-70 md:grid-cols-[minmax(0,1fr)_16rem_11rem]"
              disabled={!canManageSetup || isSaving || !activeFinancialBaseId}
            >
              <AresLaunchInput
                label="Nome"
                onChange={(value) => updateField("name", value)}
                placeholder="Ex.: Obras, Comercial, Administrativo"
                value={form.name}
              />
              {needsParent ? (
                <AresLaunchSelect
                  label={parentLabel}
                  onChange={(value) => updateField("parentId", value)}
                  options={[
                    {
                      label:
                        parentOptions.length > 0
                          ? "Selecione"
                          : "Cadastre o vinculo anterior",
                      value: "",
                    },
                    ...parentOptions,
                  ]}
                  value={form.parentId ?? ""}
                />
              ) : (
                <div className="grid min-w-0 gap-1 text-xs font-bold uppercase text-[#667085]">
                  Vinculo
                  <div className="flex h-9 items-center rounded-md border border-[#d9e0e7] bg-[#f8fafc] px-2.5 text-sm font-semibold normal-case text-[#344054]">
                    Raiz
                  </div>
                </div>
              )}
              <div className="grid min-w-0 gap-1 text-xs font-bold uppercase text-[#667085]">
                Tipo
                <div className="flex h-9 items-center rounded-md border border-[#d9e0e7] bg-[#f8fafc] px-2.5 text-sm font-semibold normal-case text-[#344054]">
                  {activeDimensionLabel}
                </div>
              </div>
            </fieldset>
            <div className="mt-2 min-h-5 text-xs font-semibold">
              {saveStatus === "saved" ? (
                <span className="text-emerald-700">
                  Setup financeiro gravado.
                </span>
              ) : null}
              {saveStatus === "error" ? (
                <span className="text-red-700">{errorMessage}</span>
              ) : null}
              {!canManageSetup ? (
                <span className="text-[#8a682f]">
                  Setup exige perfil admin ou coordenador.
                </span>
              ) : null}
            </div>
          </form>
          )}
          <div className="px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold text-[#101820]">
                {activeSetupTab === "financial_base"
                  ? "Empresas cadastradas"
                  : `${dimensionLabels[activeDimensionKind]} cadastrados`}
              </h3>
              <span className="inline-flex h-7 items-center rounded-md border border-[#d9e0e7] bg-[#f8fafc] px-2 text-xs font-semibold text-[#475467]">
                {activeSetupTab === "financial_base"
                  ? snapshot.financialBases.length
                  : activeRows.length} registros
              </span>
            </div>
            {activeSetupTab === "financial_base" ? (
              <AresFinancialBaseList
                accessToken={accessToken}
                canManageSetup={canManageSetup}
                isSaving={isSaving}
                onRefresh={onRefresh}
                setErrorMessage={setErrorMessage}
                setSaveStatus={setSaveStatus}
                snapshot={snapshot}
              />
            ) : (
            <div className="mt-2 overflow-x-auto rounded-md border border-[#edf0f3]">
              <table className="min-w-[34rem] w-full text-left text-sm">
                <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
                  <tr>
                    <th className="w-28 px-3 py-2 font-semibold">Codigo</th>
                    <th className="px-3 py-2 font-semibold">Nome</th>
                    <th className="px-3 py-2 font-semibold">Vinculo</th>
                    <th className="w-28 px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf0f3]">
                  {activeRows.map((dimension) => (
                    <tr className="hover:bg-[#fbfcfd]" key={dimension.id}>
                      <td className="px-3 py-2 font-semibold text-[#667085]">
                        {dimension.code ?? "A gerar"}
                      </td>
                      <td className="max-w-[24rem] px-3 py-2">
                        <span className="block truncate font-semibold text-[#101820]">
                          {dimension.name}
                        </span>
                      </td>
                      <td className="max-w-[18rem] px-3 py-2 text-[#667085]">
                        {dimension.kind === "department" ? (
                          <span className="block truncate">
                            {getDimensionParentName(dimension, viewModel)}
                          </span>
                        ) : (
                          <select
                            aria-label={`Vinculo de ${dimension.name}`}
                            className="h-8 w-full rounded-md border border-[#d9e0e7] bg-white px-2 text-xs font-semibold text-[#344054] outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:bg-[#f8fafc] disabled:text-[#98a2b3]"
                            disabled={!canManageSetup || isSaving}
                            onChange={(event) =>
                              void handleUpdateParent(
                                dimension,
                                event.target.value,
                              )
                            }
                            value={dimension.parentId ?? ""}
                          >
                            <option value="">Selecione</option>
                            {getDimensionParentOptions(
                              dimension.kind,
                              viewModel,
                            ).map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex h-7 items-center rounded-md border border-[#d9e0e7] bg-white px-2 text-xs font-semibold uppercase text-[#475467]">
                          {dimension.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {activeRows.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-8 text-center text-sm text-[#667085]"
                        colSpan={4}
                      >
                        Nenhum cadastro neste tipo.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-[#d9e0e7] bg-white p-3 shadow-sm">
        <p className="m-0 text-xs font-bold uppercase text-[#667085]">
          Contas correntes
        </p>
        <div className="mt-3 grid gap-2">
          {snapshot.bankAccounts.map((account) => (
            <div
              className="rounded-md border border-[#edf0f3] bg-[#fbfcfd] p-2"
              key={account.id}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-[#101820]">
                  {account.name}
                </span>
                <span className="text-xs font-semibold text-[#667085]">
                  {account.status}
                </span>
              </div>
              <p className="m-0 mt-1 text-xs text-[#667085]">
                Saldo: {formatCurrency(account.currentBalance ?? 0)}
              </p>
            </div>
          ))}
          {snapshot.bankAccounts.length === 0 ? (
            <p className="m-0 rounded-md border border-dashed border-[#d9e0e7] p-3 text-sm text-[#667085]">
              Nenhuma conta corrente operacional cadastrada.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function AresFinancialBaseSetup({
  accessToken,
  canManageSetup,
  isSaving,
  onRefresh,
  setErrorMessage,
  setSaveStatus,
  snapshot,
}: {
  accessToken: string | null;
  canManageSetup: boolean;
  isSaving: boolean;
  onRefresh: () => Promise<void>;
  setErrorMessage: (message: string | null) => void;
  setSaveStatus: (status: AresDimensionSaveStatus) => void;
  snapshot: AresSnapshot;
}) {
  const [form, setForm] = useState<AresFinancialBaseSetupFormState>(() =>
    createInitialFinancialBaseSetupForm(),
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSaveStatus("saving");

    try {
      await createAresFinancialBase(form, accessToken);
      setForm(createInitialFinancialBaseSetupForm());
      setSaveStatus("saved");
      await onRefresh();
    } catch (error) {
      setSaveStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Nao foi possivel cadastrar a empresa.",
      );
    }
  }

  return (
    <form className="border-b border-[#edf0f3] p-3" onSubmit={handleSubmit}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-sm font-semibold text-[#101820]">
            Cadastrar empresa
          </h2>
          <p className="m-0 mt-0.5 text-xs text-[#667085]">
            Base financeira, cor operacional e usuarios permitidos.
          </p>
        </div>
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[#101820] bg-[#101820] px-3 text-sm font-semibold text-white outline-none transition hover:bg-[#182431] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:border-[#d9e0e7] disabled:bg-[#f8fafc] disabled:text-[#98a2b3]"
          disabled={!canManageSetup || isSaving}
          type="submit"
        >
          {isSaving ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Plus aria-hidden="true" size={15} />
          )}
          {isSaving ? "Gravando" : "Cadastrar"}
        </button>
      </div>
      <fieldset
        className="mt-3 grid gap-2 disabled:opacity-70 md:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1.2fr)]"
        disabled={!canManageSetup || isSaving}
      >
        <AresLaunchInput
          label="Nome"
          onChange={(value) => setForm((current) => ({ ...current, name: value }))}
          placeholder="Ex.: Careli, Cliente A, Cliente B"
          value={form.name}
        />
        <label className="grid min-w-0 gap-1 text-xs font-bold uppercase text-[#667085]">
          Cor
          <input
            aria-label="Cor de destaque da empresa"
            className="h-9 w-full rounded-md border border-[#d9e0e7] bg-white px-1.5 outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                accentColor: event.target.value,
              }))
            }
            type="color"
            value={form.accentColor ?? "#A07C3B"}
          />
        </label>
        <label className="grid min-w-0 gap-1 text-xs font-bold uppercase text-[#667085]">
          Usuarios
          <select
            aria-label="Usuarios permitidos na empresa"
            className="min-h-9 rounded-md border border-[#d9e0e7] bg-white px-2 text-sm font-medium normal-case text-[#243044] outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            multiple
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                assignedUserIds: Array.from(event.target.selectedOptions).map(
                  (option) => option.value,
                ),
              }))
            }
            value={form.assignedUserIds ?? []}
          >
            {snapshot.assignableUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} / {user.role}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      {!canManageSetup ? (
        <p className="m-0 mt-2 text-xs font-semibold text-[#8a682f]">
          Setup de empresas exige perfil admin ou coordenador.
        </p>
      ) : null}
    </form>
  );
}

function AresFinancialBaseList({
  accessToken,
  canManageSetup,
  isSaving,
  onRefresh,
  setErrorMessage,
  setSaveStatus,
  snapshot,
}: {
  accessToken: string | null;
  canManageSetup: boolean;
  isSaving: boolean;
  onRefresh: () => Promise<void>;
  setErrorMessage: (message: string | null) => void;
  setSaveStatus: (status: AresDimensionSaveStatus) => void;
  snapshot: AresSnapshot;
}) {
  async function handleUpdateAssignments(
    base: AresFinancialBase,
    selectedUserIds: string[],
  ) {
    setErrorMessage(null);
    setSaveStatus("saving");

    try {
      await updateAresFinancialBase(
        {
          assignedUserIds: selectedUserIds,
          id: base.id,
        },
        accessToken,
      );
      setSaveStatus("saved");
      await onRefresh();
    } catch (error) {
      setSaveStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Nao foi possivel atualizar usuarios da empresa.",
      );
    }
  }

  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-[#edf0f3]">
      <table className="min-w-[52rem] w-full text-left text-sm">
        <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
          <tr>
            <th className="w-28 px-3 py-2 font-semibold">Codigo</th>
            <th className="px-3 py-2 font-semibold">Empresa</th>
            <th className="w-32 px-3 py-2 font-semibold">Cor</th>
            <th className="w-72 px-3 py-2 font-semibold">Usuarios</th>
            <th className="w-28 px-3 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#edf0f3]">
          {snapshot.financialBases.map((base) => (
            <tr className="hover:bg-[#fbfcfd]" key={base.id}>
              <td className="px-3 py-2 font-semibold text-[#667085]">
                {base.code ?? "A gerar"}
              </td>
              <td className="max-w-[22rem] px-3 py-2">
                <span className="block truncate font-semibold text-[#101820]">
                  {base.name}
                </span>
              </td>
              <td className="px-3 py-2">
                <span
                  className="inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold text-[#243044]"
                  style={{
                    backgroundColor: `${base.accentColor}18`,
                    borderColor: `${base.accentColor}55`,
                  }}
                >
                  {base.accentColor}
                </span>
              </td>
              <td className="px-3 py-2 text-sm font-semibold text-[#344054]">
                <select
                  aria-label={`Usuarios permitidos em ${base.name}`}
                  className="min-h-9 w-full rounded-md border border-[#d9e0e7] bg-white px-2 text-xs font-semibold text-[#344054] outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:bg-[#f8fafc] disabled:text-[#98a2b3]"
                  disabled={!canManageSetup || isSaving}
                  multiple
                  onChange={(event) =>
                    void handleUpdateAssignments(
                      base,
                      Array.from(event.target.selectedOptions).map(
                        (option) => option.value,
                      ),
                    )
                  }
                  value={base.assignedUserIds}
                >
                  {snapshot.assignableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} / {user.role}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2">
                <span className="inline-flex h-7 items-center rounded-md border border-[#d9e0e7] bg-white px-2 text-xs font-semibold uppercase text-[#475467]">
                  {base.status}
                </span>
              </td>
            </tr>
          ))}
          {snapshot.financialBases.length === 0 ? (
            <tr>
              <td className="px-3 py-8 text-center text-sm text-[#667085]" colSpan={5}>
                Nenhuma empresa cadastrada no Ares.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function AresBlockedNotice({ message }: { message: string | null }) {
  return (
    <section className="mb-3 rounded-lg border border-[#eadfca] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
          <AlertTriangle className="size-4 stroke-[1.8]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-bold uppercase text-[#8a682f]">
            Snapshot Ares indisponivel
          </p>
          <p className="m-0 mt-1 text-sm text-[#344054]">
            {message ?? "Nao foi possivel carregar a base financeira agora."}
          </p>
        </div>
      </div>
    </section>
  );
}

function createAresViewModel(
  snapshot: AresSnapshot,
  filters: AresFilters,
  activeSection: AresSection,
): AresViewModel {
  const dimensionById = new Map(
    snapshot.dimensions.map((dimension) => [dimension.id, dimension]),
  );
  const bankAccountById = new Map(
    snapshot.bankAccounts.map((account) => [account.id, account]),
  );
  const dimensionsByKind = new Map<AresDimensionKind, AresDimension[]>();
  const activeFinancialBase =
    snapshot.financialBases.find(
      (base) => base.id === snapshot.activeFinancialBaseId,
    ) ?? null;

  for (const dimension of snapshot.dimensions) {
    const rows = dimensionsByKind.get(dimension.kind) ?? [];

    rows.push(dimension);
    dimensionsByKind.set(dimension.kind, rows);
  }

  const sectionKind =
    activeSection === "pagar"
      ? "payable"
      : activeSection === "receber"
        ? "receivable"
        : null;
  const entries = snapshot.entries.filter((entry) => {
    if (sectionKind && entry.entryKind !== sectionKind) {
      return false;
    }

    if (filters.kind !== "all" && entry.entryKind !== filters.kind) {
      return false;
    }

    if (!matchesPeriod(entry, filters.period)) {
      return false;
    }

    if (!matchesStatus(entry, filters.status)) {
      return false;
    }

    return true;
  });
  const nextPayables = snapshot.entries.filter(
    (entry) =>
      entry.entryKind === "payable" &&
      !settledStatuses.has(entry.lifecycleStatus) &&
      isWithinNextDays(entry.dueDate, 7),
  );
  const nextReceivables = snapshot.entries.filter(
    (entry) =>
      entry.entryKind === "receivable" &&
      !settledStatuses.has(entry.lifecycleStatus) &&
      isWithinNextDays(entry.dueDate, 7),
  );

  return {
    activeFinancialBase,
    bankAccountById,
    dimensionById,
    dimensionsByKind,
    entries,
    nextPayables,
    nextReceivables,
    paymentWeekAmount: nextPayables.reduce(
      (total, entry) => total + (entry.amountOpen || entry.amountGross || 0),
      0,
    ),
  };
}

function matchesPeriod(
  entry: AresFinancialEntry,
  period: AresFilters["period"],
) {
  if (period === "all") {
    return true;
  }

  return isWithinNextDays(entry.dueDate ?? entry.forecastDate, Number(period));
}

function matchesStatus(
  entry: AresFinancialEntry,
  status: AresFilters["status"],
) {
  if (status === "all") {
    return true;
  }

  if (status === "open") {
    return !settledStatuses.has(entry.lifecycleStatus);
  }

  if (status === "approval") {
    return (
      entry.approvalStatus === "pending" ||
      entry.lifecycleStatus === "approval_pending"
    );
  }

  return Boolean(entry.dueDate) && entry.dueDate! < getTodayDateKey();
}

function isWithinNextDays(dateValue: string | null | undefined, days: number) {
  if (!dateValue) {
    return false;
  }

  const today = new Date(getTodayDateKey());
  const date = new Date(dateValue);
  const limit = new Date(today);

  limit.setDate(today.getDate() + days);

  return date >= today && date <= limit;
}

async function searchApoloParties({
  accessToken,
  counterpartyKind,
  query,
  signal,
}: {
  accessToken: string | null;
  counterpartyKind: AresCounterpartyKind;
  query: string;
  signal: AbortSignal;
}) {
  const params = new URLSearchParams({
    limit: "8",
    q: query,
  });
  const profile = getApoloProfileForCounterpartyKind(counterpartyKind);

  if (profile) {
    params.set("profile", profile);
  }

  const headers: HeadersInit = {};

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`/api/apolo/relationships?${params.toString()}`, {
    cache: "no-store",
    headers,
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | AresApoloSearchResponse
    | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Nao foi possivel buscar no Apolo.");
  }

  return payload?.data?.results ?? payload?.data?.entities ?? [];
}

function getApoloProfileForCounterpartyKind(kind: AresCounterpartyKind) {
  if (kind === "supplier") {
    return "fornecedor";
  }

  if (kind === "partner") {
    return "parceiro";
  }

  return null;
}

function inferCounterpartyKind(
  entity: AresApoloSearchResult,
  fallback: AresCounterpartyKind,
): AresCounterpartyKind {
  if (entity.profiles.includes("fornecedor")) {
    return "supplier";
  }

  if (entity.profiles.includes("parceiro")) {
    return "partner";
  }

  return fallback;
}

function createEmptyAresSnapshot(): AresSnapshot {
  return {
    activeFinancialBaseId: null,
    assignableUsers: [],
    bankAccounts: [],
    dimensions: [],
    entries: [],
    financialBases: [],
    generatedAt: new Date().toISOString(),
    limits: {
      entriesLimit: 250,
      entriesLoaded: 0,
    },
    paymentBatches: [],
    permissions: {
      canManage: false,
      canManageSetup: false,
      canView: false,
    },
    source: {
      mode: "rls-read",
      schema: "public",
      tables: [
        "ares_financial_dimensions",
        "ares_financial_bases",
        "ares_financial_base_users",
        "ares_bank_accounts",
        "ares_financial_entries",
        "ares_bank_statement_imports",
        "ares_bank_statement_lines",
        "ares_payment_batches",
        "ares_payment_batch_items",
        "ares_entry_events",
      ],
    },
    statementImports: [],
    statementLines: [],
    summary: {
      approvalPendingCount: 0,
      bankAccountsCount: 0,
      entriesCount: 0,
      overdueCount: 0,
      payablesOpenAmount: 0,
      payablesOpenCount: 0,
      receivablesOpenAmount: 0,
      receivablesOpenCount: 0,
      reconciliationPendingCount: 0,
    },
  };
}

function createInitialLaunchForm(
  responsibleName = "",
  financialBaseId = "",
): AresLaunchFormState {
  const today = getTodayDateKey();

  return {
    amount: "",
    apoloEntityId: null,
    approvalStatus: "pending",
    bankAccountLabel: "",
    categoryId: "",
    costCenterId: "",
    counterpartyKind: "supplier",
    departmentId: "",
    documentNumber: "",
    dueDate: today,
    entryKind: "payable",
    financialBaseId,
    forecastDate: today,
    nextAction: "Programar",
    notes: "",
    partyName: "",
    paymentMethod: "",
    priority: "normal",
    projectId: "",
    responsibleName: responsibleName ?? "",
    resultCenterId: "",
    sourceSystem: "Manual",
    title: "",
  };
}

function createInitialDimensionSetupForm(
  kind: AresDimensionKind = "cost_center",
  financialBaseId = "",
): AresDimensionSetupFormState {
  return {
    financialBaseId,
    kind,
    name: "",
    parentId: null,
    status: "active",
  };
}

function createInitialFinancialBaseSetupForm(): AresFinancialBaseSetupFormState {
  return {
    accentColor: "#A07C3B",
    assignedUserIds: [],
    name: "",
    status: "active",
  };
}

function getDimensionParentOptions(
  kind: AresDimensionKind,
  viewModel: AresViewModel,
) {
  return getDimensionParentKinds(kind).flatMap((parentKind) =>
    (viewModel.dimensionsByKind.get(parentKind) ?? [])
      .filter((dimension) => dimension.status === "active")
      .map((dimension) => ({
        label: dimension.code
          ? `${dimension.code} - ${dimension.name}`
          : dimension.name,
        value: dimension.id,
      })),
  );
}

function getDimensionParentKinds(
  kind: AresDimensionKind,
): AresDimensionKind[] {
  if (kind === "cost_center" || kind === "result_center") {
    return ["department"];
  }

  if (kind === "category") {
    return ["cost_center", "result_center"];
  }

  if (kind === "project") {
    return ["category"];
  }

  return [];
}

function getDimensionParentLabel(kind: AresDimensionKind) {
  if (kind === "cost_center" || kind === "result_center") {
    return "Departamento";
  }

  if (kind === "category") {
    return "Centro";
  }

  if (kind === "project") {
    return "Categoria";
  }

  return "Vinculo";
}

function getDimensionParentName(
  dimension: AresDimension,
  viewModel: AresViewModel,
) {
  if (!dimension.parentId) {
    return "Raiz";
  }

  const parent = viewModel.dimensionById.get(dimension.parentId);

  if (!parent) {
    return "Vinculo ausente";
  }

  return parent.code ? `${parent.code} - ${parent.name}` : parent.name;
}

function getActiveDimensionsByKind(
  viewModel: AresViewModel,
  kind: AresDimensionKind,
) {
  return (viewModel.dimensionsByKind.get(kind) ?? []).filter(
    (dimension) => dimension.status === "active",
  );
}

function getDimensionName(viewModel: AresViewModel, id: string | null) {
  return id ? viewModel.dimensionById.get(id)?.name ?? "Mapear" : "A definir";
}

function getCostCenterName(
  entry: AresFinancialEntry,
  viewModel: AresViewModel,
) {
  return entry.costCenterNameSnapshot ?? getDimensionName(viewModel, entry.costCenterId);
}

function getProjectName(entry: AresFinancialEntry, viewModel: AresViewModel) {
  return entry.projectNameSnapshot ?? getDimensionName(viewModel, entry.projectId);
}

function getDepartmentName(
  entry: AresFinancialEntry,
  viewModel: AresViewModel,
) {
  return (
    entry.departmentNameSnapshot ?? getDimensionName(viewModel, entry.departmentId)
  );
}

function getBankAccountName(viewModel: AresViewModel, id: string | null) {
  return id ? viewModel.bankAccountById.get(id)?.name ?? "Mapear" : "A definir";
}

function getEntryKindLabel(kind: AresEntryKind) {
  const labels = {
    adjustment: "Ajuste",
    bank_statement: "Extrato",
    payable: "Conta a pagar",
    receivable: "Conta a receber",
  } as const satisfies Record<AresEntryKind, string>;

  return labels[kind];
}

function getNextAction(entry: AresFinancialEntry) {
  if (entry.lifecycleStatus === "approval_pending") {
    return "Aprovar";
  }

  if (entry.lifecycleStatus === "overdue") {
    return "Regularizar";
  }

  if (entry.entryKind === "bank_statement") {
    return "Conciliar";
  }

  if (settledStatuses.has(entry.lifecycleStatus)) {
    return "Auditar";
  }

  return entry.entryKind === "receivable" ? "Acompanhar" : "Programar";
}

function StatusBadge({ status }: { status: string }) {
  const isPositive = ["approved", "paid", "received", "reconciled"].includes(
    status,
  );
  const isWarning = ["approval_pending", "overdue", "pending"].includes(status);
  const tone = isPositive
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : isWarning
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-[#d9e0e7] bg-[#f8fafc] text-[#475467]";

  return (
    <span
      className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold ${tone}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: AresPriority }) {
  const labels = {
    high: "Alta",
    low: "Baixa",
    normal: "Normal",
    urgent: "Urgente",
  } as const satisfies Record<AresPriority, string>;
  const tone =
    priority === "urgent"
      ? "border-red-200 bg-red-50 text-red-700"
      : priority === "high"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : priority === "low"
          ? "border-slate-200 bg-slate-50 text-slate-600"
          : "border-[#d9e0e7] bg-[#f8fafc] text-[#475467]";

  return (
    <span
      className={`inline-flex h-7 items-center rounded-md border px-2 text-xs font-semibold ${tone}`}
    >
      {labels[priority]}
    </span>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) {
    return "A definir";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function getTodayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
