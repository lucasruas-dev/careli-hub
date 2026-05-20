"use client";

import { loadAtlasSnapshot } from "@/lib/atlas/client";
import { PanteonTopbarUser } from "@/components/panteon/panteon-topbar-user";
import type {
  AtlasBlocker,
  AtlasCollaborator,
  AtlasDepartment,
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
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileDown,
  Gauge,
  Layers3,
  LayoutGrid,
  LockKeyhole,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCcw,
  Search,
  Trophy,
  UsersRound,
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
type AtlasSection =
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

type AtlasViewModel = {
  collaboratorsById: Map<string, AtlasCollaborator>;
  departmentById: Map<string, AtlasDepartment>;
  departmentRows: Array<{ count: number; id: string; label: string }>;
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
  const [filters, setFilters] = useState<AtlasFilterState>(initialFilters);
  const [isAtlasSidebarCollapsed, setIsAtlasSidebarCollapsed] =
    useState(false);
  const accessToken = authState.session?.accessToken ?? null;
  const isAdmin = hubUser?.role === "admin";
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
              filters={filters}
              isBlocked={isBlocked}
              onChangeFilters={setFilters}
              onResetFilters={() => setFilters(initialFilters)}
              snapshot={atlasData}
              viewModel={viewModel}
            />
          ) : null}

          {activeSection === "ocorrencias" ? (
            <OccurrencesSection
              filters={filters}
              isBlocked={isBlocked}
              onChangeFilters={setFilters}
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
            Escrita, Auth legado e bonus ficam bloqueados ate validacao.
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
        {isBlocked ? "Operacao bloqueada" : "Read-only"}
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
  filters,
  isBlocked,
  onChangeFilters,
  onResetFilters,
  snapshot,
  viewModel,
}: {
  filters: AtlasFilterState;
  isBlocked: boolean;
  onChangeFilters: (filters: AtlasFilterState) => void;
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
        isBlocked={isBlocked}
        mode="analytics"
        occurrences={viewModel.filteredOccurrences}
        viewModel={viewModel}
      />
    </div>
  );
}

function OccurrencesSection({
  filters,
  isBlocked,
  onChangeFilters,
  onResetFilters,
  snapshot,
  viewModel,
}: {
  filters: AtlasFilterState;
  isBlocked: boolean;
  onChangeFilters: (filters: AtlasFilterState) => void;
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
        isBlocked={isBlocked}
        mode="operations"
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
  isBlocked,
  mode,
  occurrences,
  viewModel,
}: {
  isBlocked: boolean;
  mode: "analytics" | "operations";
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
        <table className="min-w-[72rem] w-full border-separate border-spacing-0 text-left text-sm">
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
              <TableHead>Observacao</TableHead>
            </tr>
          </thead>
          <tbody>
            {occurrences.length === 0 ? (
              <EmptyTableRow
                colSpan={9}
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
                      <span className="block max-w-[18rem] truncate">
                        {occurrence.observation ?? "-"}
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

function EvidenceLink({ occurrence }: { occurrence: AtlasOccurrence }) {
  if (!occurrence.hasEvidence) {
    return <StatusBadge tone="neutral">-</StatusBadge>;
  }

  if (!occurrence.evidenceUrl) {
    return <StatusBadge tone="online">Sim</StatusBadge>;
  }

  const label = occurrence.evidenceName?.trim() || "Abrir evidencia";

  return (
    <Tooltip content={label} placement="top">
      <a
        className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-[#A07C3B]/5 px-2.5 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15 transition hover:bg-[#A07C3B]/10 hover:text-[#101820]"
        href={occurrence.evidenceUrl}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink className="size-3.5 stroke-[1.8]" aria-hidden="true" />
        Abrir
      </a>
    </Tooltip>
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
  tone: "blocked" | "dark" | "neutral" | "online";
}) {
  const toneClass = {
    blocked: "border-red-200 bg-red-50 text-red-700",
    dark: "border-white/[0.12] bg-white/[0.06] text-[#d7dee8]",
    neutral: "border-[#d9e0e7] bg-[#f8fafc] text-[#526078]",
    online: "border-emerald-200 bg-emerald-50 text-emerald-700",
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

  return {
    collaboratorsById,
    departmentById,
    departmentRows,
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
      occurrenceProfiles: 0,
      occurrences: 0,
      occurrenceTypes: 0,
      roles: 0,
      userProfiles: 0,
    },
    departments: [],
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

function isAdminSection(section: AtlasSection) {
  return section === "colaboradores";
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
