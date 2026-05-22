"use client";

import {
  addAtlasOccurrenceEvidences,
  createAtlasFpeEntry as createAtlasFpeEntryRequest,
  createAtlasOccurrence as createAtlasOccurrenceRequest,
  loadAtlasSnapshot,
  reviewAtlasOccurrenceJustification,
  submitAtlasOccurrenceJustification,
  uploadAtlasEvidenceFile,
  type AddAtlasOccurrenceEvidencesClientInput,
  type AtlasEvidenceClientInput,
  type CreateAtlasFpeEntryClientInput,
  type CreateAtlasOccurrenceClientInput,
  type ReviewAtlasJustificationClientInput,
  type SubmitAtlasJustificationClientInput,
} from "@/lib/atlas/client";
import { PanteonTopbarUser } from "@/components/panteon/panteon-topbar-user";
import type {
  AtlasBlocker,
  AtlasCollaborator,
  AtlasDepartment,
  AtlasFpeEntry,
  AtlasFpeEntryKind,
  AtlasOccurrence,
  AtlasOccurrenceProfile,
  AtlasOccurrenceType,
  AtlasRole,
  AtlasSnapshot,
} from "@/lib/atlas/types";
import { useAuth } from "@/providers/auth-provider";
import {
  Activity,
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardList,
  CircleDollarSign,
  ExternalLink,
  FileDown,
  Gauge,
  HandCoins,
  Layers3,
  LayoutGrid,
  LockKeyhole,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  PiggyBank,
  Plus,
  RefreshCcw,
  Search,
  SendHorizontal,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Trash2,
  Trophy,
  UsersRound,
  WalletCards,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Tooltip } from "@repo/uix";

type AtlasLoadState = "idle" | "loading" | "ready" | "error";
type AtlasMutationState = "idle" | "saving";
type AtlasSection =
  | "fpe"
  | "relatorios"
  | "ocorrencias"
  | "colaboradores";

type AtlasMenuItem = {
  adminOnly?: boolean;
  icon: LucideIcon;
  id: AtlasSection;
  label: string;
};

type AtlasFilterState = {
  code: string;
  collaboratorId: string;
  date: string;
  departmentId: string;
  endDate: string;
  profileId: string;
  startDate: string;
  typeId: string;
};

type AtlasDialogState =
  | { mode: "create" }
  | { mode: "evidences"; occurrence: AtlasOccurrence }
  | { mode: "fpe-create" }
  | { mode: "justify"; occurrence: AtlasOccurrence }
  | { mode: "review"; occurrence: AtlasOccurrence }
  | null;

type AtlasFpeDepartmentRow = {
  balance: number;
  baseAmount: number;
  collaboratorCount: number;
  departmentId: string;
  departmentName: string;
  entryDelta: number;
  entriesCount: number;
  perCollaboratorAmount: number;
  status: "negative" | "neutral" | "positive";
};

type AtlasFpeViewModel = {
  activeCollaborators: AtlasCollaborator[];
  baseAmount: number;
  departmentBalance: number;
  departmentRows: AtlasFpeDepartmentRow[];
  departmentShareRate: number;
  entries: AtlasFpeEntry[];
  globalBalance: number;
  globalPerCollaborator: number;
  globalShareRate: number;
  negativeImpact: number;
  positiveImpact: number;
  targetPercent: number;
  totalBalance: number;
  totalEntriesImpact: number;
};

type AtlasViewModel = {
  collaboratorsById: Map<string, AtlasCollaborator>;
  departmentById: Map<string, AtlasDepartment>;
  departmentRows: Array<{ count: number; id: string; label: string }>;
  fpe: AtlasFpeViewModel;
  filteredOccurrences: AtlasOccurrence[];
  occurrenceProfileRows: Array<{ count: number; id: string; label: string }>;
  occurrenceTypeRows: Array<{
    count: number;
    id: string;
    label: string;
    profileLabel: string;
  }>;
  roleById: Map<string, AtlasRole>;
  topOccurrenceType: string;
  typeById: Map<string, AtlasOccurrenceType>;
  withEvidence: number;
  withoutEvidence: number;
};

const initialFilters: AtlasFilterState = {
  code: "",
  collaboratorId: "",
  date: "",
  departmentId: "",
  endDate: "",
  profileId: "",
  startDate: "",
  typeId: "",
};

const atlasNavigationItems = [
  {
    adminOnly: false,
    icon: BarChart3,
    id: "relatorios",
    label: "Dashboard",
  },
  {
    adminOnly: false,
    icon: PiggyBank,
    id: "fpe",
    label: "FPE",
  },
  {
    adminOnly: false,
    icon: ClipboardList,
    id: "ocorrencias",
    label: "Lancamentos",
  },
  {
    adminOnly: true,
    icon: UsersRound,
    id: "colaboradores",
    label: "Colaboradores",
  },
] as const satisfies readonly AtlasMenuItem[];

export function AtlasPage() {
  const { authState, hubUser, profileStatus } = useAuth();
  const [activeSection, setActiveSection] =
    useState<AtlasSection>("relatorios");
  const [snapshot, setSnapshot] = useState<AtlasSnapshot | null>(null);
  const [status, setStatus] = useState<AtlasLoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<AtlasDialogState>(null);
  const [mutationStatus, setMutationStatus] =
    useState<AtlasMutationState>("idle");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [filters, setFilters] = useState<AtlasFilterState>(initialFilters);
  const [isAtlasSidebarCollapsed, setIsAtlasSidebarCollapsed] =
    useState(false);
  const accessToken = authState.session?.accessToken ?? null;
  const isAdmin = hubUser?.role === "admin";
  const canOpenOccurrences = Boolean(snapshot && hubUser);
  const canManageFpe = hubUser?.role === "admin" || hubUser?.role === "leader";
  const canReviewJustifications =
    hubUser?.role === "admin" || hubUser?.role === "leader";
  const atlasData = useMemo(
    () => snapshot ?? createEmptyAtlasSnapshot(errorMessage),
    [errorMessage, snapshot],
  );
  const viewModel = useMemo(
    () => createAtlasViewModel(atlasData, filters),
    [atlasData, filters],
  );
  const isLoading = status === "loading" || profileStatus !== "ready";
  const isBlocked = !snapshot;

  const refreshAtlas = useCallback(async () => {
    setStatus("loading");
    setErrorMessage(null);

    try {
      const nextSnapshot = await loadAtlasSnapshot(accessToken);

      setSnapshot(nextSnapshot);
      setStatus("ready");
    } catch (error) {
      setSnapshot(null);
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Nao foi possivel carregar o Atlas.",
      );
    }
  }, [accessToken]);

  const runAtlasMutation = useCallback(
    async (mutation: () => Promise<unknown>) => {
      setMutationStatus("saving");
      setMutationError(null);

      try {
        await mutation();
        await refreshAtlas();
        setMutationStatus("idle");
        return true;
      } catch (error) {
        setMutationStatus("idle");
        setMutationError(
          error instanceof Error
            ? error.message
            : "Nao foi possivel atualizar o Atlas.",
        );
        return false;
      }
    },
    [refreshAtlas],
  );

  const handleCreateOccurrence = useCallback(
    (input: CreateAtlasOccurrenceClientInput) =>
      runAtlasMutation(() => createAtlasOccurrenceRequest(input, accessToken)),
    [accessToken, runAtlasMutation],
  );

  const handleCreateFpeEntry = useCallback(
    (input: CreateAtlasFpeEntryClientInput) =>
      runAtlasMutation(() => createAtlasFpeEntryRequest(input, accessToken)),
    [accessToken, runAtlasMutation],
  );

  const handleAddEvidences = useCallback(
    (input: AddAtlasOccurrenceEvidencesClientInput) =>
      runAtlasMutation(() =>
        addAtlasOccurrenceEvidences(input, accessToken),
      ),
    [accessToken, runAtlasMutation],
  );

  const handleSubmitJustification = useCallback(
    (input: SubmitAtlasJustificationClientInput) =>
      runAtlasMutation(() =>
        submitAtlasOccurrenceJustification(input, accessToken),
      ),
    [accessToken, runAtlasMutation],
  );

  const handleReviewJustification = useCallback(
    (input: ReviewAtlasJustificationClientInput) =>
      runAtlasMutation(() =>
        reviewAtlasOccurrenceJustification(input, accessToken),
      ),
    [accessToken, runAtlasMutation],
  );

  useEffect(() => {
    if (profileStatus !== "ready") {
      return;
    }

    void refreshAtlas();
  }, [profileStatus, refreshAtlas]);

  useEffect(() => {
    if (!isAdmin && isAdminSection(activeSection)) {
      setActiveSection("relatorios");
    }
  }, [activeSection, isAdmin]);

  return (
    <div className="h-[100dvh] max-h-[100dvh] overflow-hidden bg-[#f3f6fa] text-[#101820]">
      <div
        className={`grid h-full min-h-0 ${
          isAtlasSidebarCollapsed
            ? "lg:grid-cols-[4.5rem_minmax(0,1fr)]"
            : "lg:grid-cols-[16rem_minmax(0,1fr)]"
        }`}
      >
        <AtlasSidebar
          activeSection={activeSection}
          collapsed={isAtlasSidebarCollapsed}
          isAdmin={isAdmin}
          onSelect={setActiveSection}
          onToggleCollapsed={() =>
            setIsAtlasSidebarCollapsed((currentValue) => !currentValue)
          }
        />
        <main className="min-h-0 min-w-0 overflow-y-auto p-3 lg:p-4">
          <AtlasModuleToolbar
            isBlocked={isBlocked}
            isLoading={isLoading}
            onRefresh={() => void refreshAtlas()}
          />

          {isBlocked ? (
            <BlockedNotice
              blockers={atlasData.blockers}
              message={errorMessage}
              status={status}
            />
          ) : null}

          {activeSection === "relatorios" ? (
            <ReportsSection
              canReviewJustifications={canReviewJustifications}
              filters={filters}
              isBlocked={isBlocked}
              onChangeFilters={setFilters}
              onOpenEvidence={(occurrence) =>
                setDialog({ mode: "evidences", occurrence })
              }
              onOpenJustification={(occurrence) =>
                setDialog({ mode: "justify", occurrence })
              }
              onOpenReview={(occurrence) =>
                setDialog({ mode: "review", occurrence })
              }
              onResetFilters={() => setFilters(initialFilters)}
              snapshot={atlasData}
              viewModel={viewModel}
            />
          ) : null}

          {activeSection === "fpe" ? (
            <FpeSection
              canManageFpe={canManageFpe}
              isBlocked={isBlocked}
              onOpenCreate={() => setDialog({ mode: "fpe-create" })}
              snapshot={atlasData}
              viewModel={viewModel}
            />
          ) : null}

          {activeSection === "ocorrencias" ? (
            <OccurrencesSection
              canOpenOccurrences={canOpenOccurrences}
              canReviewJustifications={canReviewJustifications}
              filters={filters}
              isBlocked={isBlocked}
              onChangeFilters={setFilters}
              onOpenCreate={() => setDialog({ mode: "create" })}
              onOpenEvidence={(occurrence) =>
                setDialog({ mode: "evidences", occurrence })
              }
              onOpenJustification={(occurrence) =>
                setDialog({ mode: "justify", occurrence })
              }
              onOpenReview={(occurrence) =>
                setDialog({ mode: "review", occurrence })
              }
              onResetFilters={() => setFilters(initialFilters)}
              snapshot={atlasData}
              viewModel={viewModel}
            />
          ) : null}

          {activeSection === "colaboradores" ? (
            <CollaboratorsSection
              snapshot={atlasData}
              viewModel={viewModel}
            />
          ) : null}
        </main>
      </div>
      {dialog?.mode === "create" ? (
        <CreateOccurrenceDialog
          error={mutationError}
          isSaving={mutationStatus === "saving"}
          onClose={() => {
            setDialog(null);
            setMutationError(null);
          }}
          onSubmit={handleCreateOccurrence}
          snapshot={atlasData}
        />
      ) : null}
      {dialog?.mode === "fpe-create" ? (
        <CreateFpeEntryDialog
          error={mutationError}
          isSaving={mutationStatus === "saving"}
          onClose={() => {
            setDialog(null);
            setMutationError(null);
          }}
          onSubmit={handleCreateFpeEntry}
          snapshot={atlasData}
          viewModel={viewModel}
        />
      ) : null}
      {dialog?.mode === "evidences" ? (
        <EvidenceDialog
          error={mutationError}
          isSaving={mutationStatus === "saving"}
          occurrence={dialog.occurrence}
          onClose={() => {
            setDialog(null);
            setMutationError(null);
          }}
          onSubmit={handleAddEvidences}
          viewModel={viewModel}
        />
      ) : null}
      {dialog?.mode === "justify" ? (
        <JustificationDialog
          error={mutationError}
          isSaving={mutationStatus === "saving"}
          mode="justify"
          occurrence={dialog.occurrence}
          onClose={() => {
            setDialog(null);
            setMutationError(null);
          }}
          onSubmitJustification={handleSubmitJustification}
          viewModel={viewModel}
        />
      ) : null}
      {dialog?.mode === "review" ? (
        <JustificationDialog
          error={mutationError}
          isSaving={mutationStatus === "saving"}
          mode="review"
          occurrence={dialog.occurrence}
          onClose={() => {
            setDialog(null);
            setMutationError(null);
          }}
          onReviewJustification={handleReviewJustification}
          viewModel={viewModel}
        />
      ) : null}
    </div>
  );
}

function AtlasSidebar({
  activeSection,
  collapsed,
  isAdmin,
  onSelect,
  onToggleCollapsed,
}: {
  activeSection: AtlasSection;
  collapsed: boolean;
  isAdmin: boolean;
  onSelect: (section: AtlasSection) => void;
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
              <BarChart3 aria-hidden="true" size={18} />
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
            <Tooltip content="Expandir Atlas" placement="right">
              <button
                aria-label="Expandir sidebar Atlas"
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
                <BarChart3 aria-hidden="true" size={18} />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="min-w-0 truncate text-sm font-semibold leading-tight text-white">
                  Atlas
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
            <Tooltip content="Recolher Atlas" placement="right">
              <button
                aria-label="Recolher sidebar Atlas"
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
        aria-label="Menu Atlas"
        className={`min-h-0 flex-1 overflow-y-auto py-3 ${
          collapsed ? "px-2" : "px-3"
        }`}
      >
        <div className="grid gap-1">
          {atlasNavigationItems
            .filter((item) => !item.adminOnly || isAdmin)
            .map((item) => {
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
                  <span
                    className={`min-w-0 truncate ${
                      collapsed ? "sr-only" : ""
                    }`}
                  >
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
          <p className="m-0 font-bold uppercase text-[#D6B56F]">V1 Hub</p>
          <p className="m-0 mt-1">
            Bonus, Auth legado e edicoes sensiveis seguem bloqueados.
          </p>
        </div>
      )}
    </aside>
  );
}

function AtlasModuleToolbar({
  isBlocked,
  isLoading,
  onRefresh,
}: {
  isBlocked: boolean;
  isLoading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
      <button
        className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#243044] outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:opacity-60"
        disabled={isLoading}
        onClick={onRefresh}
        type="button"
      >
        <RefreshCcw aria-hidden="true" size={15} />
        Atualizar
      </button>
      <button
        className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-md border border-[#A07C3B]/35 bg-[#A07C3B]/10 px-3 text-sm font-semibold text-[#8a682f] opacity-85"
        disabled
        type="button"
      >
        <LockKeyhole aria-hidden="true" size={15} />
        {isBlocked ? "Operacao bloqueada" : "Escrita controlada"}
      </button>
      <PanteonTopbarUser className="ml-1 border-l border-[#d9e0e7] pl-3" />
    </div>
  );
}

function BlockedNotice({
  blockers,
  message,
  status,
}: {
  blockers: AtlasBlocker[];
  message: string | null;
  status: AtlasLoadState;
}) {
  return (
    <section className="mb-4 rounded-lg border border-[#eadfca] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
          <LockKeyhole className="size-4 stroke-[1.8]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-bold uppercase text-[#8a682f]">
            Atlas aguardando conexao controlada
          </p>
          <p className="m-0 mt-1 text-sm leading-6 text-[#526078]">
            {message ??
              "Configure as envs Atlas server-side para liberar leitura do banco separado."}
          </p>
        </div>
        <StatusBadge tone={status === "loading" ? "neutral" : "blocked"}>
          {status === "loading" ? "validando" : "bloqueado"}
        </StatusBadge>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-3">
        {blockers.map((blocker) => (
          <div
            className="rounded-md border border-[#edf0f3] bg-[#f8fafc] px-3 py-2"
            key={blocker.code}
          >
            <p className="m-0 text-xs font-semibold uppercase text-[#697386]">
              {blocker.status}
            </p>
            <p className="m-0 mt-1 text-sm font-semibold text-[#243044]">
              {blocker.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportsSection({
  canReviewJustifications,
  filters,
  isBlocked,
  onChangeFilters,
  onOpenEvidence,
  onOpenJustification,
  onOpenReview,
  onResetFilters,
  snapshot,
  viewModel,
}: {
  canReviewJustifications: boolean;
  filters: AtlasFilterState;
  isBlocked: boolean;
  onChangeFilters: (filters: AtlasFilterState) => void;
  onOpenEvidence: (occurrence: AtlasOccurrence) => void;
  onOpenJustification: (occurrence: AtlasOccurrence) => void;
  onOpenReview: (occurrence: AtlasOccurrence) => void;
  onResetFilters: () => void;
  snapshot: AtlasSnapshot;
  viewModel: AtlasViewModel;
}) {
  return (
    <div className="grid gap-4">
      <FilterSurface
        filters={filters}
        onChangeFilters={onChangeFilters}
        onResetFilters={onResetFilters}
        showRange
        snapshot={snapshot}
        viewModel={viewModel}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={ClipboardList}
          label="Quantidade de registros"
          value={formatNumber(viewModel.filteredOccurrences.length)}
        />
        <MetricCard
          icon={Building2}
          label="Departamentos com registros"
          value={formatNumber(countNonZero(viewModel.departmentRows))}
        />
        <MetricCard
          icon={Layers3}
          label="Perfil com registros"
          value={formatNumber(countNonZero(viewModel.occurrenceProfileRows))}
        />
        <MetricCard
          icon={Gauge}
          label="Ocorrencias registradas"
          value={formatNumber(countNonZero(viewModel.occurrenceTypeRows))}
        />
        <MetricCard
          icon={UsersRound}
          label="Colaboradores com registros"
          value={formatNumber(countCollaborators(viewModel.filteredOccurrences))}
        />
        <MetricCard
          icon={CheckCircle2}
          label="Com evidencia"
          tone="green"
          value={formatNumber(viewModel.withEvidence)}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Sem evidencia"
          tone="warning"
          value={formatNumber(viewModel.withoutEvidence)}
        />
        <MetricCard
          icon={Trophy}
          label="Maior recorrencia"
          value={viewModel.topOccurrenceType}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ListCard rows={viewModel.departmentRows} title="Registros por departamento" />
        <ListCard rows={viewModel.occurrenceProfileRows} title="Registros por perfil" />
        <ListCard rows={viewModel.occurrenceTypeRows} title="Registros por ocorrencia" />
        <ListCard rows={getCollaboratorRows(viewModel)} title="Registros por colaborador" />
      </div>

      <OccurrencesTable
        canReviewJustifications={canReviewJustifications}
        isBlocked={isBlocked}
        mode="analytics"
        onOpenEvidence={onOpenEvidence}
        onOpenJustification={onOpenJustification}
        onOpenReview={onOpenReview}
        occurrences={viewModel.filteredOccurrences}
        viewModel={viewModel}
      />
    </div>
  );
}

function FpeSection({
  canManageFpe,
  isBlocked,
  onOpenCreate,
  snapshot,
  viewModel,
}: {
  canManageFpe: boolean;
  isBlocked: boolean;
  onOpenCreate: () => void;
  snapshot: AtlasSnapshot;
  viewModel: AtlasViewModel;
}) {
  const [activeTab, setActiveTab] = useState<"caixinha" | "lancamentos">(
    "caixinha",
  );
  const isSchemaMissing = snapshot.fpe.config.schemaStatus !== "available";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-[#d9e0e7] bg-white p-1 shadow-sm">
          <button
            className={`inline-flex h-8 items-center gap-2 rounded px-3 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B]/35 ${
              activeTab === "caixinha"
                ? "bg-[#101820] text-white"
                : "text-[#526078] hover:bg-[#f4f7fa] hover:text-[#101820]"
            }`}
            onClick={() => setActiveTab("caixinha")}
            type="button"
          >
            <PiggyBank aria-hidden="true" size={15} />
            Caixinha
          </button>
          <button
            className={`inline-flex h-8 items-center gap-2 rounded px-3 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B]/35 ${
              activeTab === "lancamentos"
                ? "bg-[#101820] text-white"
                : "text-[#526078] hover:bg-[#f4f7fa] hover:text-[#101820]"
            }`}
            onClick={() => setActiveTab("lancamentos")}
            type="button"
          >
            <WalletCards aria-hidden="true" size={15} />
            Lancamentos
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={isSchemaMissing ? "blocked" : "online"}>
            {isSchemaMissing ? "migration pendente" : "ativo"}
          </StatusBadge>
          <StatusBadge tone="gold">
            ciclo {formatNumber(snapshot.fpe.config.cycleYear)}
          </StatusBadge>
        </div>
      </div>

      {isSchemaMissing ? (
        <section className="rounded-lg border border-[#eadfca] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
              <LockKeyhole className="size-4 stroke-[1.8]" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="m-0 text-sm font-bold uppercase text-[#8a682f]">
                FPE aguardando estrutura controlada
              </p>
              <p className="m-0 mt-1 text-sm leading-6 text-[#526078]">
                A tela ja esta pronta para a regra 30/70, mas a gravacao depende
                da migration 0029 aprovada e aplicada no ambiente.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === "caixinha" ? (
        <FpeDashboard viewModel={viewModel.fpe} />
      ) : (
        <FpeEntriesTable
          canManageFpe={canManageFpe}
          isBlocked={isBlocked || isSchemaMissing}
          onOpenCreate={onOpenCreate}
          viewModel={viewModel}
        />
      )}
    </div>
  );
}

function FpeDashboard({ viewModel }: { viewModel: AtlasFpeViewModel }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.5fr)]">
        <Surface
          icon={PiggyBank}
          title="Caixinha FPE"
          toolbar={
            <StatusBadge tone={viewModel.totalEntriesImpact >= 0 ? "online" : "warning"}>
              {viewModel.totalEntriesImpact >= 0 ? "crescendo" : "reduzindo"}
            </StatusBadge>
          }
        >
          <FpeJar
            balance={viewModel.totalBalance}
            baseAmount={viewModel.baseAmount}
            percent={viewModel.targetPercent}
            trend={
              viewModel.totalEntriesImpact > 0
                ? "up"
                : viewModel.totalEntriesImpact < 0
                  ? "down"
                  : "neutral"
            }
          />
        </Surface>

        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard
            icon={CircleDollarSign}
            label="Saldo total acumulado"
            tone={viewModel.totalBalance >= 10_000 ? "green" : "gold"}
            value={formatCurrency(viewModel.totalBalance)}
          />
          <MetricCard
            icon={HandCoins}
            label="Caixa global hoje"
            tone="gold"
            value={formatCurrency(viewModel.globalBalance)}
          />
          <MetricCard
            icon={Building2}
            label="Caixa dos departamentos"
            tone="gold"
            value={formatCurrency(viewModel.departmentBalance)}
          />
          <MetricCard
            icon={UsersRound}
            label="Global por colaborador ativo"
            tone="green"
            value={formatCurrency(viewModel.globalPerCollaborator)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          icon={TrendingUp}
          label="Bonificacoes no ciclo"
          tone="green"
          value={formatCurrency(viewModel.positiveImpact)}
        />
        <MetricCard
          icon={TrendingDown}
          label="Prejuizos no ciclo"
          tone="warning"
          value={formatCurrency(viewModel.negativeImpact)}
        />
        <MetricCard
          icon={WalletCards}
          label="Impacto liquido"
          tone={viewModel.totalEntriesImpact >= 0 ? "green" : "warning"}
          value={formatSignedCurrency(viewModel.totalEntriesImpact)}
        />
      </div>

      <Surface
        icon={Building2}
        title="Contribuicao dos departamentos"
        toolbar={
          <StatusBadge tone="neutral">
            {formatNumber(viewModel.departmentRows.length)} departamentos
          </StatusBadge>
        }
      >
        <div className="overflow-x-auto rounded-md border border-[#d9e0e7]">
          <table className="min-w-[72rem] w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-[#f4f7fa] text-xs uppercase text-[#697386]">
              <tr>
                <TableHead>Departamento</TableHead>
                <TableHead>Colaboradores</TableHead>
                <TableHead>Base</TableHead>
                <TableHead>Impacto</TableHead>
                <TableHead>Saldo se fechasse hoje</TableHead>
                <TableHead>Por colaborador</TableHead>
                <TableHead>Status</TableHead>
              </tr>
            </thead>
            <tbody>
              {viewModel.departmentRows.length === 0 ? (
                <EmptyTableRow
                  colSpan={7}
                  label="Nenhum departamento mapeado para o FPE."
                />
              ) : (
                viewModel.departmentRows.map((department) => (
                  <tr className="hover:bg-[#f8fafc]" key={department.departmentId}>
                    <TableCell strong>{department.departmentName}</TableCell>
                    <TableCell>{formatNumber(department.collaboratorCount)}</TableCell>
                    <TableCell>{formatCurrency(department.baseAmount)}</TableCell>
                    <TableCell>
                      <span
                        className={
                          department.entryDelta >= 0
                            ? "font-semibold text-emerald-700"
                            : "font-semibold text-amber-700"
                        }
                      >
                        {formatSignedCurrency(department.entryDelta)}
                      </span>
                    </TableCell>
                    <TableCell>{formatCurrency(department.balance)}</TableCell>
                    <TableCell>
                      {formatCurrency(department.perCollaboratorAmount)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={
                          department.status === "positive"
                            ? "online"
                            : department.status === "negative"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {department.status === "positive"
                          ? "ajudando"
                          : department.status === "negative"
                            ? "prejuizo"
                            : "neutro"}
                      </StatusBadge>
                    </TableCell>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Surface>
    </div>
  );
}

function FpeJar({
  balance,
  baseAmount,
  percent,
  trend,
}: {
  balance: number;
  baseAmount: number;
  percent: number;
  trend: "down" | "neutral" | "up";
}) {
  const fillPercent = Math.round(clamp(percent, 0, 1) * 100);
  const isAboveBase = balance >= baseAmount;
  const health =
    fillPercent >= 80 ? "green" : fillPercent >= 50 ? "yellow" : "red";
  const healthLabel =
    health === "green" ? "saudavel" : health === "yellow" ? "atencao" : "critico";
  const healthClasses = {
    green: {
      bar: "bg-emerald-500",
      badge: "online",
      text: "text-emerald-700",
    },
    red: {
      bar: "bg-red-500",
      badge: "blocked",
      text: "text-red-700",
    },
    yellow: {
      bar: "bg-amber-400",
      badge: "warning",
      text: "text-amber-700",
    },
  }[health];
  const coinMotionClass =
    trend === "down"
      ? "fpe-meter-coin--falling"
      : trend === "up"
        ? "fpe-meter-coin--rising"
        : "fpe-meter-coin--steady";
  const trendLabel =
    trend === "down" ? "descendo" : trend === "up" ? "subindo" : "estavel";

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-[#d9e0e7] bg-[#f8fafc] p-4 shadow-inner">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="m-0 text-xs font-bold uppercase text-[#697386]">
              reserva FPE
            </p>
            <p className="m-0 mt-1 text-3xl font-semibold text-[#101820]">
              {formatCurrency(balance)}
            </p>
            <p className="m-0 mt-1 text-xs font-semibold uppercase text-[#697386]">
              base anual {formatCurrency(baseAmount)}
            </p>
          </div>
          <StatusBadge tone={healthClasses.badge as "blocked" | "online" | "warning"}>
            {healthLabel}
          </StatusBadge>
        </div>

        <div className="mt-5 rounded-lg border border-[#d9e0e7] bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="m-0 text-xs font-bold uppercase text-[#697386]">
                saude do fundo
              </p>
              <p className={`m-0 mt-1 text-2xl font-semibold ${healthClasses.text}`}>
                {formatPercent(percent)}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[#697386]">
              <span className="grid size-7 place-items-center rounded-full border border-[#d9e0e7] bg-[#f8fafc]">
                <CircleDollarSign
                  aria-hidden="true"
                  className="size-4 stroke-[1.8] text-[#A07C3B]"
                />
              </span>
              moedas {trendLabel}
            </div>
          </div>

          <div className="relative mt-6 h-16">
            <div className="absolute inset-x-0 top-1/2 h-4 -translate-y-1/2 overflow-hidden rounded-full bg-gradient-to-r from-red-100 via-amber-100 to-emerald-100 ring-1 ring-[#d9e0e7]" />
            <div
              className={`absolute left-0 top-1/2 h-4 -translate-y-1/2 rounded-full ${healthClasses.bar} transition-all duration-700 ease-out`}
              style={{ width: `${fillPercent}%` }}
            />
            <div
              className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${fillPercent}%` }}
            >
              <span className={`fpe-meter-coin ${coinMotionClass}`} />
            </div>
            <div className="absolute left-1/2 top-10 h-4 border-l border-[#8b96a8]/45" />
            <div className="absolute left-[80%] top-10 h-4 border-l border-[#8b96a8]/45" />
            <span className="absolute left-1/2 top-14 -translate-x-1/2 text-[0.68rem] font-bold uppercase text-[#697386]">
              50%
            </span>
            <span className="absolute left-[80%] top-14 -translate-x-1/2 text-[0.68rem] font-bold uppercase text-[#697386]">
              80%
            </span>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2">
            <p className="m-0 text-xs font-bold uppercase text-red-700">
              abaixo de 50%
            </p>
            <p className="m-0 mt-1 text-xs font-semibold text-red-700">
              vermelho
            </p>
          </div>
          <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2">
            <p className="m-0 text-xs font-bold uppercase text-amber-700">
              50% a 80%
            </p>
            <p className="m-0 mt-1 text-xs font-semibold text-amber-700">
              amarelo
            </p>
          </div>
          <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2">
            <p className="m-0 text-xs font-bold uppercase text-emerald-700">
              acima de 80%
            </p>
            <p className="m-0 mt-1 text-xs font-semibold text-emerald-700">
              verde
            </p>
          </div>
        </div>
      </div>
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between text-xs font-semibold uppercase text-[#697386]">
          <span>{isAboveBase ? "acima da base" : "acompanhamento"}</span>
          <span>{formatCurrency(balance)} / {formatCurrency(baseAmount)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#edf0f3]">
          <div
            className={`h-full rounded-full ${healthClasses.bar} transition-all duration-700`}
            style={{ width: `${fillPercent}%` }}
          />
        </div>
      </div>
      <style>{`
        @keyframes atlas-fpe-coin-rise {
          0%,
          100% {
            transform: translateY(0) rotate(-8deg);
          }
          50% {
            transform: translateY(-12px) rotate(8deg);
          }
        }

        @keyframes atlas-fpe-coin-fall {
          0%,
          100% {
            transform: translateY(-2px) rotate(6deg);
          }
          50% {
            transform: translateY(12px) rotate(-8deg);
          }
        }

        @keyframes atlas-fpe-coin-steady {
          0%,
          100% {
            transform: translateY(0) scale(1);
          }
          50% {
            transform: translateY(-4px) scale(1.03);
          }
        }

        .fpe-meter-coin {
          display: block;
          height: 2.25rem;
          position: relative;
          width: 2.25rem;
          border-radius: 9999px;
          border: 1px solid rgb(160 124 59 / 0.38);
          background:
            radial-gradient(circle at 35% 28%, #fff8df 0 12%, transparent 13%),
            linear-gradient(135deg, #f4d990 0%, #c79742 55%, #9f7834 100%);
          box-shadow:
            inset 0 0 0 0.23rem rgb(255 255 255 / 0.22),
            0 0.35rem 0.7rem rgb(16 24 32 / 0.12);
          animation: atlas-fpe-coin-steady 3.6s ease-in-out infinite;
        }

        .fpe-meter-coin::after {
          position: absolute;
          display: block;
          inset: 0.32rem;
          border-radius: 9999px;
          border: 1px solid rgb(255 255 255 / 0.45);
          content: "";
        }

        .fpe-meter-coin--rising {
          animation-name: atlas-fpe-coin-rise;
          animation-duration: 2.8s;
        }

        .fpe-meter-coin--falling {
          animation-name: atlas-fpe-coin-fall;
          animation-duration: 2.8s;
        }

        .fpe-meter-coin--steady {
          animation-name: atlas-fpe-coin-steady;
        }
      `}</style>
    </div>
  );
}

function FpeEntriesTable({
  canManageFpe,
  isBlocked,
  onOpenCreate,
  viewModel,
}: {
  canManageFpe: boolean;
  isBlocked: boolean;
  onOpenCreate: () => void;
  viewModel: AtlasViewModel;
}) {
  return (
    <Surface
      icon={WalletCards}
      title="Lancamentos FPE"
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">
            {formatNumber(viewModel.fpe.entries.length)} registros
          </StatusBadge>
          <button
            className="inline-flex h-8 items-center gap-2 rounded-md border border-[#A07C3B]/30 bg-[#A07C3B] px-3 text-xs font-semibold text-white shadow-sm outline-none transition hover:bg-[#8f6f35] focus-visible:ring-2 focus-visible:ring-[#A07C3B]/40 disabled:cursor-not-allowed disabled:opacity-55"
            disabled={!canManageFpe || isBlocked}
            onClick={onOpenCreate}
            type="button"
          >
            <Plus aria-hidden="true" size={14} />
            Novo lancamento
          </button>
        </div>
      }
    >
      <div className="overflow-x-auto rounded-md border border-[#d9e0e7]">
        <table className="min-w-[92rem] w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-[#f4f7fa] text-xs uppercase text-[#697386]">
            <tr>
              <TableHead>Data</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Global 30%</TableHead>
              <TableHead>Departamento 70%</TableHead>
              <TableHead>Colaborador</TableHead>
              <TableHead>Departamento</TableHead>
              <TableHead>Ocorrencia</TableHead>
              <TableHead>Observacao</TableHead>
            </tr>
          </thead>
          <tbody>
            {viewModel.fpe.entries.length === 0 ? (
              <EmptyTableRow
                colSpan={9}
                label={
                  isBlocked
                    ? "FPE aguardando estrutura controlada."
                    : "Nenhum lancamento FPE registrado."
                }
              />
            ) : (
              viewModel.fpe.entries.map((entry) => {
                const collaborator = viewModel.collaboratorsById.get(
                  entry.collaboratorId,
                );
                const department = viewModel.departmentById.get(
                  entry.departmentId,
                );
                const type = entry.occurrenceTypeId
                  ? viewModel.typeById.get(entry.occurrenceTypeId)
                  : undefined;
                const signedAmount = getFpeSignedAmount(entry);

                return (
                  <tr className="hover:bg-[#f8fafc]" key={entry.id}>
                    <TableCell>{formatDate(entry.entryDate)}</TableCell>
                    <TableCell>
                      <FpeEntryKindBadge kind={entry.kind} />
                    </TableCell>
                    <TableCell strong>{formatCurrency(entry.amount)}</TableCell>
                    <TableCell>
                      {formatSignedCurrency(
                        signedAmount * viewModel.fpe.globalShareRate,
                      )}
                    </TableCell>
                    <TableCell>
                      {formatSignedCurrency(
                        signedAmount * viewModel.fpe.departmentShareRate,
                      )}
                    </TableCell>
                    <TableCell>{collaborator?.name ?? "-"}</TableCell>
                    <TableCell>{department?.name ?? "-"}</TableCell>
                    <TableCell>
                      <div className="grid gap-1">
                        <span className="font-semibold">
                          #{entry.occurrenceCode ?? "-"}
                        </span>
                        <span className="text-xs text-[#697386]">
                          {type?.name ?? "-"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-[24rem] truncate">
                        {entry.description ?? "-"}
                      </span>
                    </TableCell>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

function FpeEntryKindBadge({ kind }: { kind: AtlasFpeEntryKind }) {
  const isBonus = kind === "bonus";

  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-bold uppercase ${
        isBonus
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {isBonus ? (
        <ArrowUpCircle aria-hidden="true" size={14} />
      ) : (
        <ArrowDownCircle aria-hidden="true" size={14} />
      )}
      {isBonus ? "bonificacao" : "prejuizo"}
    </span>
  );
}

function OccurrencesSection({
  canOpenOccurrences,
  canReviewJustifications,
  filters,
  isBlocked,
  onChangeFilters,
  onOpenCreate,
  onOpenEvidence,
  onOpenJustification,
  onOpenReview,
  onResetFilters,
  snapshot,
  viewModel,
}: {
  canOpenOccurrences: boolean;
  canReviewJustifications: boolean;
  filters: AtlasFilterState;
  isBlocked: boolean;
  onChangeFilters: (filters: AtlasFilterState) => void;
  onOpenCreate: () => void;
  onOpenEvidence: (occurrence: AtlasOccurrence) => void;
  onOpenJustification: (occurrence: AtlasOccurrence) => void;
  onOpenReview: (occurrence: AtlasOccurrence) => void;
  onResetFilters: () => void;
  snapshot: AtlasSnapshot;
  viewModel: AtlasViewModel;
}) {
  return (
    <div className="grid gap-4">
      <FilterSurface
        filters={filters}
        onChangeFilters={onChangeFilters}
        onResetFilters={onResetFilters}
        snapshot={snapshot}
        viewModel={viewModel}
      />

      <OccurrencesTable
        canOpenOccurrences={canOpenOccurrences}
        canReviewJustifications={canReviewJustifications}
        isBlocked={isBlocked}
        mode="operations"
        onOpenCreate={onOpenCreate}
        onOpenEvidence={onOpenEvidence}
        onOpenJustification={onOpenJustification}
        onOpenReview={onOpenReview}
        occurrences={viewModel.filteredOccurrences}
        viewModel={viewModel}
      />
    </div>
  );
}

function CollaboratorsSection({
  snapshot,
  viewModel,
}: {
  snapshot: AtlasSnapshot;
  viewModel: AtlasViewModel;
}) {
  return (
    <div className="grid gap-4">
      <Surface
        icon={UsersRound}
        title="Colaboradores cadastrados"
        toolbar={
          <StatusBadge tone="neutral">
            {formatNumber(snapshot.collaborators.length)} registros
          </StatusBadge>
        }
      >
        <div className="overflow-x-auto rounded-md border border-[#d9e0e7]">
          <table className="min-w-[58rem] w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-[#f4f7fa] text-xs uppercase text-[#697386]">
              <tr>
                <TableHead>Nome</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Departamento</TableHead>
                <TableHead>Valor base</TableHead>
                <TableHead>Ocorrencias</TableHead>
                <TableHead>Acesso</TableHead>
              </tr>
            </thead>
            <tbody>
              {snapshot.collaborators.length === 0 ? (
                <EmptyTableRow colSpan={6} label="Nenhum colaborador cadastrado." />
              ) : (
                snapshot.collaborators.map((collaborator) => {
                  const role = collaborator.roleId
                    ? viewModel.roleById.get(collaborator.roleId)
                    : undefined;
                  const department = collaborator.departmentId
                    ? viewModel.departmentById.get(collaborator.departmentId)
                    : undefined;
                  const occurrenceCount = viewModel.filteredOccurrences.filter(
                    (occurrence) =>
                      occurrence.collaboratorId === collaborator.id,
                  ).length;

                  return (
                    <tr
                      className="border-t border-[#edf0f3] hover:bg-[#f8fafc]"
                      key={collaborator.id}
                    >
                      <TableCell strong>{collaborator.name}</TableCell>
                      <TableCell>{role?.name ?? "-"}</TableCell>
                      <TableCell>{department?.name ?? "-"}</TableCell>
                      <TableCell>
                        {formatCurrency(role?.baseValue ?? 0)}
                      </TableCell>
                      <TableCell>{formatNumber(occurrenceCount)}</TableCell>
                      <TableCell>
                        <StatusBadge tone="neutral">pendente</StatusBadge>
                      </TableCell>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Surface>
    </div>
  );
}

function FilterSurface({
  filters,
  onChangeFilters,
  onResetFilters,
  showRange = false,
  snapshot,
}: {
  filters: AtlasFilterState;
  onChangeFilters: (filters: AtlasFilterState) => void;
  onResetFilters: () => void;
  showRange?: boolean;
  snapshot: AtlasSnapshot;
  viewModel: AtlasViewModel;
}) {
  return (
    <Surface icon={Search} title="Filtros">
      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Field
          label="ID"
          onChange={(value) => onChangeFilters({ ...filters, code: value })}
          placeholder="ID"
          value={filters.code}
        />
        <Select
          label="Colaborador"
          onChange={(value) =>
            onChangeFilters({ ...filters, collaboratorId: value })
          }
          value={filters.collaboratorId}
        >
          <option value="">Colaborador</option>
          {snapshot.collaborators.map((collaborator) => (
            <option key={collaborator.id} value={collaborator.id}>
              {collaborator.name}
            </option>
          ))}
        </Select>
        <Select
          label="Departamento"
          onChange={(value) =>
            onChangeFilters({ ...filters, departmentId: value })
          }
          value={filters.departmentId}
        >
          <option value="">Departamento</option>
          {snapshot.departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
        <Select
          label="Perfil"
          onChange={(value) => onChangeFilters({ ...filters, profileId: value })}
          value={filters.profileId}
        >
          <option value="">Perfil</option>
          {snapshot.occurrenceProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </Select>
        <Select
          label="Ocorrencia"
          onChange={(value) => onChangeFilters({ ...filters, typeId: value })}
          value={filters.typeId}
        >
          <option value="">Ocorrencia</option>
          {snapshot.occurrenceTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </Select>
        <Field
          label="Data"
          onChange={(value) => onChangeFilters({ ...filters, date: value })}
          type="date"
          value={filters.date}
        />
        <button
          className="inline-flex h-10 items-center justify-center rounded-md border border-[#d9e0e7] bg-white px-4 text-sm font-semibold text-[#243044] outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#A07C3B] md:self-end"
          onClick={onResetFilters}
          type="button"
        >
          Limpar
        </button>
      </div>
      {showRange ? (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Field
            label="Data inicial"
            onChange={(value) =>
              onChangeFilters({ ...filters, startDate: value })
            }
            type="date"
            value={filters.startDate}
          />
          <Field
            label="Data final"
            onChange={(value) => onChangeFilters({ ...filters, endDate: value })}
            type="date"
            value={filters.endDate}
          />
        </div>
      ) : null}
    </Surface>
  );
}

function OccurrencesTable({
  canOpenOccurrences = false,
  canReviewJustifications,
  isBlocked,
  mode,
  onOpenCreate,
  onOpenEvidence,
  onOpenJustification,
  onOpenReview,
  occurrences,
  viewModel,
}: {
  canOpenOccurrences?: boolean;
  canReviewJustifications: boolean;
  isBlocked: boolean;
  mode: "analytics" | "operations";
  onOpenCreate?: () => void;
  onOpenEvidence: (occurrence: AtlasOccurrence) => void;
  onOpenJustification: (occurrence: AtlasOccurrence) => void;
  onOpenReview: (occurrence: AtlasOccurrence) => void;
  occurrences: AtlasOccurrence[];
  viewModel: AtlasViewModel;
}) {
  return (
    <Surface
      icon={Activity}
      title={
        mode === "analytics"
          ? "Visao analitica das ocorrencias"
          : "Ocorrencia cadastrada"
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">{formatNumber(occurrences.length)} registros</StatusBadge>
          {mode === "operations" ? (
            <button
              className="inline-flex h-8 items-center gap-2 rounded-md border border-[#A07C3B]/30 bg-[#A07C3B] px-3 text-xs font-semibold text-white shadow-sm outline-none transition hover:bg-[#8f6f35] focus-visible:ring-2 focus-visible:ring-[#A07C3B]/40 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!canOpenOccurrences || isBlocked}
              onClick={onOpenCreate}
              type="button"
            >
              <Plus aria-hidden="true" size={14} />
              Abrir ocorrencia
            </button>
          ) : null}
          {mode === "analytics" ? (
            <button
              className="inline-flex h-8 cursor-not-allowed items-center gap-2 rounded-md border border-[#d9e0e7] px-3 text-xs font-semibold text-[#697386]"
              disabled
              type="button"
            >
              <FileDown aria-hidden="true" size={14} />
              Exportar
            </button>
          ) : null}
        </div>
      }
    >
      <div className="overflow-x-auto rounded-md border border-[#d9e0e7]">
        <table className="min-w-[94rem] w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-[#f4f7fa] text-xs uppercase text-[#697386]">
            <tr>
              <TableHead>{mode === "analytics" ? "Codigo" : "ID"}</TableHead>
              <TableHead>Data registro</TableHead>
              <TableHead>Data ocorrencia</TableHead>
              <TableHead>Colaborador</TableHead>
              <TableHead>Departamento</TableHead>
              <TableHead>Ocorrencia</TableHead>
              <TableHead>Perfil</TableHead>
              <TableHead>Evidencia</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Justificativa</TableHead>
              <TableHead>Observacao</TableHead>
              <TableHead>Acoes</TableHead>
            </tr>
          </thead>
          <tbody>
            {occurrences.length === 0 ? (
              <EmptyTableRow
                colSpan={12}
                label={
                  isBlocked
                    ? "Aguardando leitura controlada do Supabase Atlas."
                    : "Nenhuma ocorrencia cadastrada."
                }
              />
            ) : (
              occurrences.map((occurrence) => {
                const collaborator = viewModel.collaboratorsById.get(
                  occurrence.collaboratorId,
                );
                const department = collaborator?.departmentId
                  ? viewModel.departmentById.get(collaborator.departmentId)
                  : undefined;
                const type = viewModel.typeById.get(occurrence.typeId);
                const profile = getProfileForType(type, viewModel);

                return (
                  <tr className="hover:bg-[#f8fafc]" key={occurrence.id}>
                    <TableCell strong>{occurrence.code ?? "-"}</TableCell>
                    <TableCell>{formatDateTime(occurrence.createdAt)}</TableCell>
                    <TableCell>{formatDate(occurrence.date)}</TableCell>
                    <TableCell>{collaborator?.name ?? "-"}</TableCell>
                    <TableCell>{department?.name ?? "-"}</TableCell>
                    <TableCell>{type?.name ?? "-"}</TableCell>
                    <TableCell>{profile?.name ?? "-"}</TableCell>
                    <TableCell>
                      <EvidenceLink occurrence={occurrence} />
                    </TableCell>
                    <TableCell>
                      <OccurrenceStatusBadge occurrence={occurrence} />
                    </TableCell>
                    <TableCell>
                      <JustificationSummary occurrence={occurrence} />
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-[18rem] truncate">
                        {occurrence.observation ?? "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <OccurrenceActions
                        canReviewJustifications={canReviewJustifications}
                        occurrence={occurrence}
                        onOpenEvidence={onOpenEvidence}
                        onOpenJustification={onOpenJustification}
                        onOpenReview={onOpenReview}
                      />
                    </TableCell>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

function EvidenceLink({ occurrence }: { occurrence: AtlasOccurrence }) {
  if (!occurrence.hasEvidence) {
    return <StatusBadge tone="neutral">-</StatusBadge>;
  }

  const evidences = occurrence.evidences ?? [];
  const primaryEvidence = evidences[0];

  if (!primaryEvidence?.url && !occurrence.evidenceUrl) {
    return <StatusBadge tone="online">Sim</StatusBadge>;
  }

  const evidenceUrl = primaryEvidence?.url ?? occurrence.evidenceUrl ?? "";
  const label =
    primaryEvidence?.name?.trim() ||
    occurrence.evidenceName?.trim() ||
    "Abrir evidencia";
  const evidenceCount = evidences.length || 1;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tooltip content={label} placement="top">
        <a
          className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-[#A07C3B]/5 px-2.5 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15 transition hover:bg-[#A07C3B]/10 hover:text-[#101820]"
          href={evidenceUrl}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-3.5 stroke-[1.8]" aria-hidden="true" />
          Abrir
        </a>
      </Tooltip>
      {evidenceCount > 1 ? (
        <StatusBadge tone="gold">+{evidenceCount - 1}</StatusBadge>
      ) : null}
    </div>
  );
}

function OccurrenceStatusBadge({
  occurrence,
}: {
  occurrence: AtlasOccurrence;
}) {
  if (occurrence.operationalStatus === "improcedente") {
    return <StatusBadge tone="online">Improcedente</StatusBadge>;
  }

  return <StatusBadge tone="warning">Procedente</StatusBadge>;
}

function JustificationSummary({
  occurrence,
}: {
  occurrence: AtlasOccurrence;
}) {
  const status = occurrence.justification?.status ?? "none";

  if (status === "none") {
    return <StatusBadge tone="neutral">Sem justificativa</StatusBadge>;
  }

  const tone = {
    accepted: "online",
    pending: "gold",
    rejected: "blocked",
  }[status] as "blocked" | "gold" | "online";
  const label = {
    accepted: "Aceita",
    pending: "Pendente",
    rejected: "Nao aceita",
  }[status];

  return (
    <div className="grid max-w-[20rem] gap-1">
      <StatusBadge tone={tone}>{label}</StatusBadge>
      {occurrence.justification?.text ? (
        <span className="truncate text-xs font-medium text-[#697386]">
          {occurrence.justification.text}
        </span>
      ) : null}
    </div>
  );
}

function OccurrenceActions({
  canReviewJustifications,
  occurrence,
  onOpenEvidence,
  onOpenJustification,
  onOpenReview,
}: {
  canReviewJustifications: boolean;
  occurrence: AtlasOccurrence;
  onOpenEvidence: (occurrence: AtlasOccurrence) => void;
  onOpenJustification: (occurrence: AtlasOccurrence) => void;
  onOpenReview: (occurrence: AtlasOccurrence) => void;
}) {
  const justificationStatus = occurrence.justification?.status ?? "none";
  const canJustify =
    justificationStatus === "none" || justificationStatus === "rejected";
  const canReview =
    canReviewJustifications && justificationStatus === "pending";

  return (
    <div className="flex min-w-[12rem] flex-wrap items-center gap-2">
      <button
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#243044] outline-none transition hover:border-[#A07C3B]/40 hover:bg-[#A07C3B]/5 focus-visible:ring-2 focus-visible:ring-[#A07C3B]/30"
        onClick={() => onOpenEvidence(occurrence)}
        type="button"
      >
        <Paperclip aria-hidden="true" size={14} />
        Evidencias
      </button>
      {canJustify ? (
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#243044] outline-none transition hover:border-[#A07C3B]/40 hover:bg-[#A07C3B]/5 focus-visible:ring-2 focus-visible:ring-[#A07C3B]/30"
          onClick={() => onOpenJustification(occurrence)}
          type="button"
        >
          <MessageSquareText aria-hidden="true" size={14} />
          Justificar
        </button>
      ) : null}
      {canReview ? (
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#A07C3B]/30 bg-[#A07C3B]/10 px-2.5 text-xs font-semibold text-[#7A5E2C] outline-none transition hover:bg-[#A07C3B]/15 focus-visible:ring-2 focus-visible:ring-[#A07C3B]/30"
          onClick={() => onOpenReview(occurrence)}
          type="button"
        >
          <ShieldCheck aria-hidden="true" size={14} />
          Revisar
        </button>
      ) : null}
    </div>
  );
}

function Surface({
  children,
  icon: Icon,
  title,
  toolbar,
}: {
  children: ReactNode;
  icon: LucideIcon;
  title: string;
  toolbar?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[#d9e0e7] bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
            <Icon className="size-4 stroke-[1.8]" aria-hidden="true" />
          </span>
          <h2 className="m-0 truncate text-base font-semibold text-[#101820]">
            {title}
          </h2>
        </div>
        {toolbar}
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  icon: Icon,
  label,
  tone = "gold",
  value,
}: {
  icon: LucideIcon;
  label: string;
  tone?: "gold" | "green" | "warning";
  value: string;
}) {
  const toneClass = {
    gold: "bg-[#A07C3B]/5 text-[#A07C3B] ring-[#A07C3B]/15",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    warning: "bg-amber-50 text-amber-700 ring-amber-100",
  }[tone];

  return (
    <div className="rounded-lg border border-[#d9e0e7] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold uppercase text-[#697386]">
            {label}
          </p>
          <p className="m-0 mt-2 break-words text-2xl font-semibold text-[#101820]">
            {value}
          </p>
        </div>
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ${toneClass}`}>
          <Icon className="size-4 stroke-[1.8]" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

function ListCard({
  rows,
  title,
}: {
  rows: Array<{ count: number; id: string; label: string }>;
  title: string;
}) {
  return (
    <Surface icon={BarChart3} title={title}>
      <div className="grid gap-2">
        {rows.length === 0 || rows.every((row) => row.count === 0) ? (
          <p className="m-0 text-sm text-[#697386]">Sem dados.</p>
        ) : (
          rows.slice(0, 8).map((row) => (
            <div
              className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-[#edf0f3] bg-[#f8fafc] px-3 py-2"
              key={row.id}
            >
              <span className="min-w-0 truncate text-sm font-semibold text-[#243044]">
                {row.label}
              </span>
              <StatusBadge tone="neutral">{formatNumber(row.count)}</StatusBadge>
            </div>
          ))
        )}
      </div>
    </Surface>
  );
}

function Field({
  disabled = false,
  label,
  onChange,
  placeholder,
  type = "text",
  value = "",
}: {
  disabled?: boolean;
  label: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: string;
  value?: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold uppercase text-[#697386]">
      {label}
      <input
        className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-medium normal-case text-[#243044] outline-none transition placeholder:text-[#98a2b3] focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20 disabled:cursor-not-allowed disabled:bg-[#f4f7fa] disabled:text-[#8b96a8]"
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

function Select({
  children,
  disabled = false,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onChange?: (value: string) => void;
  value?: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold uppercase text-[#697386]">
      {label}
      <select
        className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-medium normal-case text-[#243044] outline-none transition focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20 disabled:cursor-not-allowed disabled:bg-[#f4f7fa] disabled:text-[#8b96a8]"
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function TextArea({
  disabled = false,
  label,
  onChange,
  placeholder,
  value = "",
}: {
  disabled?: boolean;
  label: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  value?: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold uppercase text-[#697386]">
      {label}
      <textarea
        className="min-h-28 resize-y rounded-md border border-[#d9e0e7] bg-white px-3 py-2 text-sm font-medium normal-case leading-6 text-[#243044] outline-none transition placeholder:text-[#98a2b3] focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20 disabled:cursor-not-allowed disabled:bg-[#f4f7fa] disabled:text-[#8b96a8]"
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function CreateOccurrenceDialog({
  error,
  isSaving,
  onClose,
  onSubmit,
  snapshot,
}: {
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (input: CreateAtlasOccurrenceClientInput) => Promise<boolean>;
  snapshot: AtlasSnapshot;
}) {
  const [collaboratorId, setCollaboratorId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [occurrenceDate, setOccurrenceDate] = useState(getTodayInputValue());
  const [observation, setObservation] = useState("");
  const [evidenceDrafts, setEvidenceDrafts] = useState<EvidenceDraft[]>([
    createEvidenceDraft(),
  ]);
  const canSubmit = Boolean(collaboratorId && typeId && occurrenceDate);
  const evidences = normalizeEvidenceDrafts(evidenceDrafts);
  const isUploadingEvidence = hasEvidenceUploadInProgress(evidenceDrafts);

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    const saved = await onSubmit({
      collaboratorId,
      evidences,
      occurrenceDate,
      observation,
      typeId,
    });

    if (saved) {
      onClose();
    }
  }

  return (
    <AtlasDialogShell
      action={
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[#A07C3B] px-3 text-sm font-semibold text-white outline-none transition hover:bg-[#8f6f35] focus-visible:ring-2 focus-visible:ring-[#A07C3B]/40 disabled:cursor-not-allowed disabled:opacity-55"
          disabled={!canSubmit || isSaving || isUploadingEvidence}
          onClick={() => void handleSubmit()}
          type="button"
        >
          <Plus aria-hidden="true" size={15} />
          Criar
        </button>
      }
      error={error}
      icon={ClipboardList}
      onClose={onClose}
      title="Abrir ocorrencia"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Select
          disabled={isSaving}
          label="Colaborador"
          onChange={setCollaboratorId}
          value={collaboratorId}
        >
          <option value="">Selecione</option>
          {snapshot.collaborators.map((collaborator) => (
            <option key={collaborator.id} value={collaborator.id}>
              {collaborator.name}
            </option>
          ))}
        </Select>
        <Select
          disabled={isSaving}
          label="Ocorrencia"
          onChange={setTypeId}
          value={typeId}
        >
          <option value="">Selecione</option>
          {snapshot.occurrenceTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </Select>
        <Field
          disabled={isSaving}
          label="Data"
          onChange={setOccurrenceDate}
          type="date"
          value={occurrenceDate}
        />
      </div>
      <TextArea
        disabled={isSaving}
        label="Observacao"
        onChange={setObservation}
        placeholder="Descreva o fato operacional registrado."
        value={observation}
      />
      <EvidenceDraftList
        disabled={isSaving}
        drafts={evidenceDrafts}
        onChange={setEvidenceDrafts}
      />
    </AtlasDialogShell>
  );
}

function CreateFpeEntryDialog({
  error,
  isSaving,
  onClose,
  onSubmit,
  snapshot,
  viewModel,
}: {
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (input: CreateAtlasFpeEntryClientInput) => Promise<boolean>;
  snapshot: AtlasSnapshot;
  viewModel: AtlasViewModel;
}) {
  const [collaboratorId, setCollaboratorId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [entryDate, setEntryDate] = useState(getTodayInputValue());
  const [kind, setKind] = useState<AtlasFpeEntryKind>("loss");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [evidenceDrafts, setEvidenceDrafts] = useState<EvidenceDraft[]>([
    createEvidenceDraft(),
  ]);
  const collaborator = collaboratorId
    ? viewModel.collaboratorsById.get(collaboratorId)
    : undefined;
  const department = collaborator?.departmentId
    ? viewModel.departmentById.get(collaborator.departmentId)
    : undefined;
  const parsedAmount = parseMoneyInput(amount);
  const canSubmit = Boolean(
    collaboratorId &&
      typeId &&
      entryDate &&
      parsedAmount > 0 &&
      collaborator?.departmentId,
  );
  const evidences = normalizeEvidenceDrafts(evidenceDrafts);
  const isUploadingEvidence = hasEvidenceUploadInProgress(evidenceDrafts);
  const globalShare = parsedAmount * snapshot.fpe.config.globalShareRate;
  const departmentShare = parsedAmount * snapshot.fpe.config.departmentShareRate;

  async function handleSubmit() {
    if (!canSubmit) {
      return;
    }

    const saved = await onSubmit({
      amount: parsedAmount,
      collaboratorId,
      description,
      entryDate,
      evidences,
      kind,
      typeId,
    });

    if (saved) {
      onClose();
    }
  }

  return (
    <AtlasDialogShell
      action={
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[#A07C3B] px-3 text-sm font-semibold text-white outline-none transition hover:bg-[#8f6f35] focus-visible:ring-2 focus-visible:ring-[#A07C3B]/40 disabled:cursor-not-allowed disabled:opacity-55"
          disabled={!canSubmit || isSaving || isUploadingEvidence}
          onClick={() => void handleSubmit()}
          type="button"
        >
          <Plus aria-hidden="true" size={15} />
          Criar
        </button>
      }
      error={error}
      icon={PiggyBank}
      onClose={onClose}
      title="Novo lancamento FPE"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Select
          disabled={isSaving}
          label="Colaborador"
          onChange={setCollaboratorId}
          value={collaboratorId}
        >
          <option value="">Selecione</option>
          {snapshot.collaborators.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Select>
        <Select
          disabled={isSaving}
          label="Ocorrencia"
          onChange={setTypeId}
          value={typeId}
        >
          <option value="">Selecione</option>
          {snapshot.occurrenceTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </Select>
        <Select
          disabled={isSaving}
          label="Tipo FPE"
          onChange={(value) => setKind(value as AtlasFpeEntryKind)}
          value={kind}
        >
          <option value="loss">Prejuizo / desconto</option>
          <option value="bonus">Bonificacao</option>
        </Select>
        <Field
          disabled={isSaving}
          label="Valor"
          onChange={setAmount}
          placeholder="0,00"
          value={amount}
        />
        <Field
          disabled={isSaving}
          label="Data"
          onChange={setEntryDate}
          type="date"
          value={entryDate}
        />
      </div>

      <div className="grid gap-2 rounded-md border border-[#d9e0e7] bg-[#f8fafc] p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={department ? "online" : "warning"}>
            {department ? department.name : "departamento pendente"}
          </StatusBadge>
          <StatusBadge tone="gold">
            {formatPercent(snapshot.fpe.config.globalShareRate)} global
          </StatusBadge>
          <StatusBadge tone="gold">
            {formatPercent(snapshot.fpe.config.departmentShareRate)} departamento
          </StatusBadge>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <div>
            <p className="m-0 text-xs font-semibold uppercase text-[#697386]">
              impacto global
            </p>
            <p className="m-0 mt-1 text-lg font-semibold text-[#101820]">
              {formatSignedCurrency(kind === "bonus" ? globalShare : -globalShare)}
            </p>
          </div>
          <div>
            <p className="m-0 text-xs font-semibold uppercase text-[#697386]">
              impacto do departamento
            </p>
            <p className="m-0 mt-1 text-lg font-semibold text-[#101820]">
              {formatSignedCurrency(
                kind === "bonus" ? departmentShare : -departmentShare,
              )}
            </p>
          </div>
        </div>
      </div>

      <TextArea
        disabled={isSaving}
        label="Observacao"
        onChange={setDescription}
        placeholder="Descreva o motivo operacional do lancamento."
        value={description}
      />
      <EvidenceDraftList
        disabled={isSaving}
        drafts={evidenceDrafts}
        onChange={setEvidenceDrafts}
      />
    </AtlasDialogShell>
  );
}

type EvidenceDraft = {
  fileName?: string;
  id: string;
  name: string;
  status?: "error" | "idle" | "uploaded" | "uploading";
  type: string;
  uploadError?: string | null;
  url: string;
};

function EvidenceDialog({
  error,
  isSaving,
  occurrence,
  onClose,
  onSubmit,
  viewModel,
}: {
  error: string | null;
  isSaving: boolean;
  occurrence: AtlasOccurrence;
  onClose: () => void;
  onSubmit: (input: AddAtlasOccurrenceEvidencesClientInput) => Promise<boolean>;
  viewModel: AtlasViewModel;
}) {
  const [evidenceDrafts, setEvidenceDrafts] = useState<EvidenceDraft[]>([
    createEvidenceDraft(),
  ]);
  const collaborator = viewModel.collaboratorsById.get(occurrence.collaboratorId);
  const type = viewModel.typeById.get(occurrence.typeId);
  const evidences = normalizeEvidenceDrafts(evidenceDrafts);
  const isUploadingEvidence = hasEvidenceUploadInProgress(evidenceDrafts);

  async function handleSubmit() {
    if (evidences.length === 0) {
      return;
    }

    const saved = await onSubmit({
      evidences,
      occurrenceId: occurrence.id,
    });

    if (saved) {
      onClose();
    }
  }

  return (
    <AtlasDialogShell
      action={
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[#A07C3B] px-3 text-sm font-semibold text-white outline-none transition hover:bg-[#8f6f35] focus-visible:ring-2 focus-visible:ring-[#A07C3B]/40 disabled:cursor-not-allowed disabled:opacity-55"
          disabled={isSaving || isUploadingEvidence || evidences.length === 0}
          onClick={() => void handleSubmit()}
          type="button"
        >
          <Paperclip aria-hidden="true" size={15} />
          Adicionar
        </button>
      }
      error={error}
      icon={Paperclip}
      onClose={onClose}
      title="Evidencias da ocorrencia"
    >
      <div className="grid gap-2 rounded-md border border-[#edf0f3] bg-[#f8fafc] p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">#{occurrence.code ?? "-"}</StatusBadge>
          <StatusBadge tone={occurrence.hasEvidence ? "online" : "neutral"}>
            {formatNumber(occurrence.evidences.length)} evidencias
          </StatusBadge>
        </div>
        <p className="m-0 font-semibold text-[#101820]">
          {collaborator?.name ?? "Colaborador nao mapeado"}
        </p>
        <p className="m-0 text-[#526078]">
          {type?.name ?? "Ocorrencia nao mapeada"} em {formatDate(occurrence.date)}
        </p>
      </div>

      {occurrence.evidences.length > 0 ? (
        <div className="grid gap-2">
          <p className="m-0 text-xs font-semibold uppercase text-[#697386]">
            Evidencias atuais
          </p>
          <div className="grid gap-2">
            {occurrence.evidences.map((evidence) => (
              <a
                className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-[#d9e0e7] bg-white px-3 py-2 text-sm font-semibold text-[#243044] outline-none transition hover:border-[#A07C3B]/40 hover:bg-[#A07C3B]/5 focus-visible:ring-2 focus-visible:ring-[#A07C3B]/30"
                href={evidence.url}
                key={evidence.id}
                rel="noreferrer"
                target="_blank"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ExternalLink
                    aria-hidden="true"
                    className="size-4 shrink-0 stroke-[1.8] text-[#A07C3B]"
                  />
                  <span className="truncate">
                    {evidence.name?.trim() || evidence.url}
                  </span>
                </span>
                <StatusBadge tone="neutral">
                  {formatNumber(evidence.position)}
                </StatusBadge>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <EvidenceDraftList
        disabled={isSaving}
        drafts={evidenceDrafts}
        onChange={setEvidenceDrafts}
      />
    </AtlasDialogShell>
  );
}

function EvidenceDraftList({
  disabled,
  drafts,
  onChange,
}: {
  disabled: boolean;
  drafts: EvidenceDraft[];
  onChange: (drafts: EvidenceDraft[]) => void;
}) {
  function updateDraft(
    id: string,
    field: "name" | "type" | "url",
    value: string,
  ) {
    onChange(
      drafts.map((draft) =>
        draft.id === id
          ? {
              ...draft,
              [field]: value,
            }
          : draft,
      ),
    );
  }

  async function uploadDraftFile(id: string, file: File | undefined) {
    if (!file) {
      return;
    }

    onChange(
      drafts.map((draft) =>
        draft.id === id
          ? {
              ...draft,
              fileName: file.name,
              status: "uploading",
              uploadError: null,
            }
          : draft,
      ),
    );

    try {
      const uploadedFile = await uploadAtlasEvidenceFile({ file });

      onChange(
        drafts.map((draft) =>
          draft.id === id
            ? {
                ...draft,
                fileName: uploadedFile.name ?? file.name,
                name: draft.name.trim() || uploadedFile.name || file.name,
                status: "uploaded",
                type:
                  draft.type.trim() ||
                  getReadableEvidenceFileType(uploadedFile.type),
                uploadError: null,
                url: uploadedFile.url,
              }
            : draft,
        ),
      );
    } catch (error) {
      onChange(
        drafts.map((draft) =>
          draft.id === id
            ? {
                ...draft,
                status: "error",
                uploadError:
                  error instanceof Error
                    ? error.message
                    : "Nao foi possivel anexar o arquivo.",
              }
            : draft,
        ),
      );
    }
  }

  function removeDraft(id: string) {
    const nextDrafts = drafts.filter((draft) => draft.id !== id);

    onChange(nextDrafts.length > 0 ? nextDrafts : [createEvidenceDraft()]);
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-xs font-semibold uppercase text-[#697386]">
          Novas evidencias
        </p>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-white px-2.5 text-xs font-semibold text-[#243044] outline-none transition hover:border-[#A07C3B]/40 hover:bg-[#A07C3B]/5 focus-visible:ring-2 focus-visible:ring-[#A07C3B]/30 disabled:cursor-not-allowed disabled:opacity-55"
          disabled={disabled || drafts.length >= 12}
          onClick={() => onChange([...drafts, createEvidenceDraft()])}
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          Adicionar linha
        </button>
      </div>
      <div className="grid gap-2">
        {drafts.map((draft, index) => (
          <div
            className="grid gap-2 rounded-md border border-[#d9e0e7] bg-[#f8fafc] p-3 lg:grid-cols-[minmax(14rem,0.95fr)_minmax(12rem,0.9fr)_minmax(8rem,0.5fr)_2rem]"
            key={draft.id}
          >
            <div className="grid gap-1.5 text-xs font-semibold uppercase text-[#697386]">
              Arquivo {index + 1}
              <input
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                className="sr-only"
                disabled={disabled || draft.status === "uploading"}
                id={`atlas-evidence-file-${draft.id}`}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];

                  void uploadDraftFile(draft.id, file);
                  event.currentTarget.value = "";
                }}
                type="file"
              />
              <label
                aria-disabled={disabled || draft.status === "uploading"}
                className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-[#A07C3B]/25 bg-white px-3 text-sm font-semibold normal-case text-[#243044] outline-none transition hover:border-[#A07C3B]/45 hover:bg-[#A07C3B]/5 ${
                  disabled || draft.status === "uploading"
                    ? "pointer-events-none cursor-not-allowed opacity-60"
                    : ""
                }`}
                htmlFor={`atlas-evidence-file-${draft.id}`}
              >
                <Paperclip aria-hidden="true" size={15} />
                {draft.status === "uploading"
                  ? "Enviando..."
                  : draft.fileName
                    ? "Trocar arquivo"
                    : "Selecionar arquivo"}
              </label>
              <div className="flex min-h-6 flex-wrap items-center gap-2 normal-case">
                {draft.status === "uploaded" ? (
                  <StatusBadge tone="online">anexado</StatusBadge>
                ) : draft.status === "error" ? (
                  <StatusBadge tone="blocked">erro</StatusBadge>
                ) : (
                  <span className="text-xs font-medium text-[#697386]">
                    clique para buscar no computador
                  </span>
                )}
                {draft.fileName ? (
                  <span className="max-w-[14rem] truncate text-xs font-medium text-[#526078]">
                    {draft.fileName}
                  </span>
                ) : null}
                {draft.uploadError ? (
                  <span className="text-xs font-semibold text-red-700">
                    {draft.uploadError}
                  </span>
                ) : null}
              </div>
            </div>
            <Field
              disabled={disabled}
              label="Nome"
              onChange={(value) => updateDraft(draft.id, "name", value)}
              placeholder="Print, arquivo, protocolo..."
              value={draft.name}
            />
            <Field
              disabled={disabled}
              label="Tipo"
              onChange={(value) => updateDraft(draft.id, "type", value)}
              placeholder="imagem, pdf..."
              value={draft.type}
            />
            <div className="flex items-end">
              <Tooltip content="Remover linha" placement="top">
                <button
                  aria-label="Remover evidencia"
                  className="grid h-10 w-10 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#697386] outline-none transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus-visible:ring-2 focus-visible:ring-red-200 disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={disabled}
                  onClick={() => removeDraft(draft.id)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function JustificationDialog({
  error,
  isSaving,
  mode,
  occurrence,
  onClose,
  onReviewJustification,
  onSubmitJustification,
  viewModel,
}: {
  error: string | null;
  isSaving: boolean;
  mode: "justify" | "review";
  occurrence: AtlasOccurrence;
  onClose: () => void;
  onReviewJustification?: (
    input: ReviewAtlasJustificationClientInput,
  ) => Promise<boolean>;
  onSubmitJustification?: (
    input: SubmitAtlasJustificationClientInput,
  ) => Promise<boolean>;
  viewModel: AtlasViewModel;
}) {
  const [justification, setJustification] = useState(
    occurrence.justification?.text ?? "",
  );
  const [reviewNote, setReviewNote] = useState("");
  const collaborator = viewModel.collaboratorsById.get(occurrence.collaboratorId);
  const type = viewModel.typeById.get(occurrence.typeId);

  async function handleSubmitJustification() {
    if (!onSubmitJustification) {
      return;
    }

    const saved = await onSubmitJustification({
      justification,
      occurrenceId: occurrence.id,
    });

    if (saved) {
      onClose();
    }
  }

  async function handleReview(action: "accept" | "reject") {
    if (!onReviewJustification) {
      return;
    }

    const saved = await onReviewJustification({
      action,
      occurrenceId: occurrence.id,
      reviewNote,
    });

    if (saved) {
      onClose();
    }
  }

  return (
    <AtlasDialogShell
      action={
        mode === "justify" ? (
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[#A07C3B] px-3 text-sm font-semibold text-white outline-none transition hover:bg-[#8f6f35] focus-visible:ring-2 focus-visible:ring-[#A07C3B]/40 disabled:cursor-not-allowed disabled:opacity-55"
            disabled={isSaving || !justification.trim()}
            onClick={() => void handleSubmitJustification()}
            type="button"
          >
            <SendHorizontal aria-hidden="true" size={15} />
            Enviar
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 outline-none transition hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-200 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={isSaving}
              onClick={() => void handleReview("reject")}
              type="button"
            >
              <XCircle aria-hidden="true" size={15} />
              Nao aceitar
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white outline-none transition hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={isSaving}
              onClick={() => void handleReview("accept")}
              type="button"
            >
              <CheckCircle2 aria-hidden="true" size={15} />
              Aceitar
            </button>
          </div>
        )
      }
      error={error}
      icon={mode === "justify" ? MessageSquareText : ShieldCheck}
      onClose={onClose}
      title={mode === "justify" ? "Justificar ocorrencia" : "Revisar justificativa"}
    >
      <div className="grid gap-2 rounded-md border border-[#edf0f3] bg-[#f8fafc] p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">#{occurrence.code ?? "-"}</StatusBadge>
          <OccurrenceStatusBadge occurrence={occurrence} />
          <JustificationSummary occurrence={occurrence} />
        </div>
        <p className="m-0 font-semibold text-[#101820]">
          {collaborator?.name ?? "Colaborador nao mapeado"}
        </p>
        <p className="m-0 text-[#526078]">
          {type?.name ?? "Ocorrencia nao mapeada"} em {formatDate(occurrence.date)}
        </p>
        {occurrence.observation ? (
          <p className="m-0 text-[#243044]">{occurrence.observation}</p>
        ) : null}
      </div>
      {mode === "justify" ? (
        <TextArea
          disabled={isSaving}
          label="Justificativa"
          onChange={setJustification}
          placeholder="Explique o contexto da ocorrencia."
          value={justification}
        />
      ) : (
        <>
          <div className="grid gap-1.5">
            <p className="m-0 text-xs font-semibold uppercase text-[#697386]">
              Justificativa enviada
            </p>
            <div className="min-h-20 rounded-md border border-[#d9e0e7] bg-white px-3 py-2 text-sm leading-6 text-[#243044]">
              {occurrence.justification?.text ?? "-"}
            </div>
          </div>
          <TextArea
            disabled={isSaving}
            label="Nota da revisao"
            onChange={setReviewNote}
            placeholder="Registre o criterio usado na decisao."
            value={reviewNote}
          />
        </>
      )}
    </AtlasDialogShell>
  );
}

function AtlasDialogShell({
  action,
  children,
  error,
  icon: Icon,
  onClose,
  title,
}: {
  action: ReactNode;
  children: ReactNode;
  error: string | null;
  icon: LucideIcon;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#101820]/35 p-4 backdrop-blur-sm">
      <section className="w-full max-w-2xl overflow-hidden rounded-lg border border-[#d9e0e7] bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-[#edf0f3] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
              <Icon className="size-4 stroke-[1.8]" aria-hidden="true" />
            </span>
            <h2 className="m-0 truncate text-base font-semibold text-[#101820]">
              {title}
            </h2>
          </div>
          <button
            className="grid h-8 w-8 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#526078] outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#A07C3B]/30"
            onClick={onClose}
            type="button"
          >
            <XCircle aria-hidden="true" size={16} />
            <span className="sr-only">Fechar</span>
          </button>
        </div>
        <div className="grid gap-4 p-4">
          {children}
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#edf0f3] px-4 py-3">
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#243044] outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#A07C3B]/30"
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
          {action}
        </div>
      </section>
    </div>
  );
}

function TableHead({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children: ReactNode;
}) {
  return (
    <th
      className={`border-b border-[#d9e0e7] px-3 py-2 font-semibold ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function TableCell({
  align = "left",
  children,
  strong = false,
}: {
  align?: "left" | "right";
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <td
      className={`border-b border-[#edf0f3] px-3 py-2 text-[#243044] ${
        align === "right" ? "text-right" : "text-left"
      } ${strong ? "font-semibold" : ""}`}
    >
      {children}
    </td>
  );
}

function EmptyTableRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td
        className="px-4 py-10 text-center text-sm font-medium text-[#697386]"
        colSpan={colSpan}
      >
        {label}
      </td>
    </tr>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "blocked" | "dark" | "gold" | "neutral" | "online" | "warning";
}) {
  const toneClass = {
    blocked: "border-red-200 bg-red-50 text-red-700",
    dark: "border-white/[0.12] bg-white/[0.06] text-[#d7dee8]",
    gold: "border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7A5E2C]",
    neutral: "border-[#d9e0e7] bg-[#f8fafc] text-[#526078]",
    online: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
  }[tone];

  return (
    <span
      className={`inline-flex h-6 max-w-full items-center rounded-md border px-2 text-[0.6875rem] font-bold uppercase ${toneClass}`}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

function createAtlasViewModel(
  snapshot: AtlasSnapshot,
  filters: AtlasFilterState,
): AtlasViewModel {
  const collaboratorsById = new Map(
    snapshot.collaborators.map((collaborator) => [
      collaborator.id,
      collaborator,
    ]),
  );
  const departmentById = new Map(
    snapshot.departments.map((department) => [department.id, department]),
  );
  const roleById = new Map(snapshot.roles.map((role) => [role.id, role]));
  const typeById = new Map(
    snapshot.occurrenceTypes.map((type) => [type.id, type]),
  );
  const filteredOccurrences = snapshot.occurrences.filter((occurrence) =>
    matchesFilters(occurrence, filters, collaboratorsById, typeById),
  );
  const countsByDepartment = countBy(filteredOccurrences, (occurrence) => {
    const collaborator = collaboratorsById.get(occurrence.collaboratorId);

    return collaborator?.departmentId ?? "unmapped";
  });
  const countsByProfile = countBy(filteredOccurrences, (occurrence) => {
    const type = typeById.get(occurrence.typeId);

    return type?.profileId ?? "unmapped";
  });
  const countsByType = countBy(
    filteredOccurrences,
    (occurrence) => occurrence.typeId,
  );
  const departmentRows = snapshot.departments
    .map((department) => ({
      count: countsByDepartment.get(department.id) ?? 0,
      id: department.id,
      label: department.name,
    }))
    .sort(sortByCount);
  const occurrenceProfileRows = snapshot.occurrenceProfiles
    .map((profile) => ({
      count: countsByProfile.get(profile.id) ?? 0,
      id: profile.id,
      label: profile.name,
    }))
    .sort(sortByCount);
  const profileById = new Map(
    snapshot.occurrenceProfiles.map((profile) => [profile.id, profile]),
  );
  const occurrenceTypeRows = snapshot.occurrenceTypes
    .map((type) => ({
      count: countsByType.get(type.id) ?? 0,
      id: type.id,
      label: type.name,
      profileLabel: type.profileId
        ? profileById.get(type.profileId)?.name ?? "-"
        : "-",
    }))
    .sort(sortByCount);
  const withEvidence = filteredOccurrences.filter(
    (occurrence) => occurrence.hasEvidence,
  ).length;
  const fpe = createAtlasFpeViewModel(snapshot);

  return {
    collaboratorsById,
    departmentById,
    departmentRows,
    fpe,
    filteredOccurrences,
    occurrenceProfileRows,
    occurrenceTypeRows,
    roleById,
    topOccurrenceType: occurrenceTypeRows.find((row) => row.count > 0)?.label ?? "-",
    typeById,
    withEvidence,
    withoutEvidence: filteredOccurrences.length - withEvidence,
  };
}

function createAtlasFpeViewModel(
  snapshot: AtlasSnapshot,
): AtlasFpeViewModel {
  const activeCollaborators = snapshot.collaborators.filter(
    isActiveCollaborator,
  );
  const config = snapshot.fpe.config;
  const entries = snapshot.fpe.entries;
  const activeCollaboratorsByDepartment = countBy(
    activeCollaborators,
    (collaborator) => collaborator.departmentId ?? undefined,
  );
  const totalDepartments = Math.max(snapshot.departments.length, 1);
  const departmentBaseShare = config.departmentBaseAmount / totalDepartments;
  const globalDelta = sumFpeEntries(entries, config.globalShareRate);
  const departmentDelta = sumFpeEntries(entries, config.departmentShareRate);
  const globalBalance = config.globalBaseAmount + globalDelta;
  const departmentBalance = config.departmentBaseAmount + departmentDelta;
  const positiveImpact = entries
    .filter((entry) => entry.kind === "bonus")
    .reduce((total, entry) => total + entry.amount, 0);
  const negativeImpact = entries
    .filter((entry) => entry.kind === "loss")
    .reduce((total, entry) => total + entry.amount, 0);
  const entryDeltaByDepartment = new Map<string, number>();
  const entryCountByDepartment = new Map<string, number>();

  for (const entry of entries) {
    const currentDelta = entryDeltaByDepartment.get(entry.departmentId) ?? 0;
    const currentCount = entryCountByDepartment.get(entry.departmentId) ?? 0;

    entryDeltaByDepartment.set(
      entry.departmentId,
      currentDelta + getFpeSignedAmount(entry) * config.departmentShareRate,
    );
    entryCountByDepartment.set(entry.departmentId, currentCount + 1);
  }

  const departmentRows = snapshot.departments
    .map((department) => {
      const entryDelta = entryDeltaByDepartment.get(department.id) ?? 0;
      const collaboratorCount =
        activeCollaboratorsByDepartment.get(department.id) ?? 0;
      const balance = departmentBaseShare + entryDelta;

      return {
        balance,
        baseAmount: departmentBaseShare,
        collaboratorCount,
        departmentId: department.id,
        departmentName: department.name,
        entryDelta,
        entriesCount: entryCountByDepartment.get(department.id) ?? 0,
        perCollaboratorAmount:
          collaboratorCount > 0 ? balance / collaboratorCount : 0,
        status:
          entryDelta > 0
            ? "positive"
            : entryDelta < 0
              ? "negative"
              : "neutral",
      } satisfies AtlasFpeDepartmentRow;
    })
    .sort((firstRow, secondRow) => {
      const firstAbsDelta = Math.abs(firstRow.entryDelta);
      const secondAbsDelta = Math.abs(secondRow.entryDelta);

      return (
        secondAbsDelta - firstAbsDelta ||
        firstRow.departmentName.localeCompare(secondRow.departmentName, "pt-BR")
      );
    });

  return {
    activeCollaborators,
    baseAmount: config.baseAmount,
    departmentBalance,
    departmentRows,
    departmentShareRate: config.departmentShareRate,
    entries,
    globalBalance,
    globalPerCollaborator:
      activeCollaborators.length > 0
        ? globalBalance / activeCollaborators.length
        : 0,
    globalShareRate: config.globalShareRate,
    negativeImpact,
    positiveImpact,
    targetPercent:
      config.baseAmount > 0 ? (globalBalance + departmentBalance) / config.baseAmount : 0,
    totalBalance: globalBalance + departmentBalance,
    totalEntriesImpact: positiveImpact - negativeImpact,
  };
}

function matchesFilters(
  occurrence: AtlasOccurrence,
  filters: AtlasFilterState,
  collaboratorsById: Map<string, AtlasCollaborator>,
  typeById: Map<string, AtlasOccurrenceType>,
) {
  const collaborator = collaboratorsById.get(occurrence.collaboratorId);
  const type = typeById.get(occurrence.typeId);

  if (
    filters.code.trim() &&
    !String(occurrence.code ?? "")
      .toLowerCase()
      .includes(filters.code.trim().toLowerCase())
  ) {
    return false;
  }

  if (
    filters.collaboratorId &&
    occurrence.collaboratorId !== filters.collaboratorId
  ) {
    return false;
  }

  if (filters.departmentId && collaborator?.departmentId !== filters.departmentId) {
    return false;
  }

  if (filters.profileId && type?.profileId !== filters.profileId) {
    return false;
  }

  if (filters.typeId && occurrence.typeId !== filters.typeId) {
    return false;
  }

  if (filters.date && occurrence.date !== filters.date) {
    return false;
  }

  if (filters.startDate && occurrence.date < filters.startDate) {
    return false;
  }

  if (filters.endDate && occurrence.date > filters.endDate) {
    return false;
  }

  return true;
}

function createEmptyAtlasSnapshot(errorMessage: string | null): AtlasSnapshot {
  return {
    blockers: [
      {
        code: "atlas_env_missing",
        label:
          errorMessage ??
          "Leitura do Supabase Atlas pendente no Hub.",
        status: "BLOQUEADO",
      },
      {
        code: "atlas_bonus_rules_unmapped",
        label: "Regra de bonus preservada ate validacao humana.",
        status: "BLOQUEADO",
      },
      {
        code: "atlas_hub_identity_unmapped",
        label: "Vinculo Hub Users x colaboradores Atlas em mapeamento.",
        status: "MAPEANDO",
      },
    ],
    collaborators: [],
    counts: {
      collaborators: 0,
      departments: 0,
      fpeEntries: 0,
      occurrenceProfiles: 0,
      occurrences: 0,
      occurrenceTypes: 0,
      roles: 0,
      userProfiles: 0,
    },
    departments: [],
    fpe: {
      config: {
        baseAmount: 10_000,
        cycleYear: new Date().getFullYear(),
        departmentBaseAmount: 7_000,
        departmentShareRate: 0.7,
        globalBaseAmount: 3_000,
        globalShareRate: 0.3,
        schemaStatus: "missing",
      },
      entries: [],
    },
    generatedAt: new Date().toISOString(),
    limits: {
      occurrencesLoaded: 0,
      occurrencesLimit: 250,
    },
    occurrenceProfiles: [],
    occurrenceTypes: [],
    occurrences: [],
    roles: [],
    source: {
      gitRepository: "lucasruas-dev/careli-performance",
      mode: "read-only",
      schema: "public",
      supabaseProjectRef: "BLOQUEADO",
      vercelProject: "careli-performance",
    },
    userProfiles: [],
  };
}

function getProfileForType(
  type: AtlasOccurrenceType | undefined,
  viewModel: AtlasViewModel,
): AtlasOccurrenceProfile | undefined {
  if (!type?.profileId) {
    return undefined;
  }

  const profileRow = viewModel.occurrenceProfileRows.find(
    (row) => row.id === type.profileId,
  );

  return profileRow
    ? {
        id: profileRow.id,
        name: profileRow.label,
      }
    : undefined;
}

function getCollaboratorRows(viewModel: AtlasViewModel) {
  const counts = countBy(
    viewModel.filteredOccurrences,
    (occurrence) => occurrence.collaboratorId,
  );

  return [...viewModel.collaboratorsById.values()]
    .map((collaborator) => ({
      count: counts.get(collaborator.id) ?? 0,
      id: collaborator.id,
      label: collaborator.name,
    }))
    .sort(sortByCount);
}

function countBy<Row>(rows: Row[], getKey: (row: Row) => string | undefined) {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = getKey(row);

    if (!key) {
      continue;
    }

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function sortByCount(
  firstRow: { count: number; label: string },
  secondRow: { count: number; label: string },
) {
  return (
    secondRow.count - firstRow.count ||
    firstRow.label.localeCompare(secondRow.label, "pt-BR")
  );
}

function countNonZero(rows: Array<{ count: number }>) {
  return rows.filter((row) => row.count > 0).length;
}

function countCollaborators(occurrences: AtlasOccurrence[]) {
  return new Set(
    occurrences.map((occurrence) => occurrence.collaboratorId),
  ).size;
}

function createEvidenceDraft(): EvidenceDraft {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    name: "",
    status: "idle",
    type: "",
    url: "",
  };
}

function normalizeEvidenceDrafts(
  drafts: EvidenceDraft[],
): AtlasEvidenceClientInput[] {
  return drafts
    .map((draft) => ({
      name: draft.name.trim() || null,
      type: draft.type.trim() || null,
      url: draft.url.trim(),
    }))
    .filter((draft) => draft.url.length > 0);
}

function hasEvidenceUploadInProgress(drafts: EvidenceDraft[]) {
  return drafts.some((draft) => draft.status === "uploading");
}

function getReadableEvidenceFileType(type: string | null | undefined) {
  if (!type) {
    return "arquivo";
  }

  if (type.startsWith("image/")) {
    return "imagem";
  }

  if (type === "application/pdf") {
    return "pdf";
  }

  if (type.includes("spreadsheet") || type.includes("excel")) {
    return "planilha";
  }

  if (type.includes("word") || type.includes("msword")) {
    return "documento";
  }

  if (type.startsWith("text/")) {
    return "texto";
  }

  return "arquivo";
}

function parseMoneyInput(value: string) {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return 0;
  }

  const numericValue = Number(
    normalizedValue.includes(",")
      ? normalizedValue.replace(/\./g, "").replace(",", ".")
      : normalizedValue,
  );

  return Number.isFinite(numericValue) ? numericValue : 0;
}

function getTodayInputValue() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());

  return date.toISOString().slice(0, 10);
}

function isAdminSection(section: AtlasSection) {
  return section === "colaboradores";
}

function isActiveCollaborator(collaborator: AtlasCollaborator) {
  return !collaborator.status || collaborator.status === "active";
}

function getFpeSignedAmount(entry: AtlasFpeEntry) {
  return entry.kind === "bonus" ? entry.amount : -entry.amount;
}

function sumFpeEntries(entries: AtlasFpeEntry[], shareRate: number) {
  return entries.reduce(
    (total, entry) => total + getFpeSignedAmount(entry) * shareRate,
    0,
  );
}

function formatDate(value?: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(date);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    style: "currency",
  }).format(value);
}

function formatSignedCurrency(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";

  return `${sign}${formatCurrency(Math.abs(value))}`;
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
    style: "percent",
  }).format(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
