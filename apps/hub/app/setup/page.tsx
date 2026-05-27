"use client";

import { HubShell } from "@/layouts/hub-shell";
import {
  createAtlasDepartment,
  createAtlasOccurrenceProfile,
  createAtlasOccurrenceType,
  createAtlasRole,
  createDepartment,
  createOperationalUser,
  createHermesChannel,
  createSector,
  linkUserAssignment,
  loadSetupData,
  syncHermesChannelMembers,
  updateDepartment,
  updateHermesChannel,
  updateSector,
  uploadUserAvatar,
} from "@/lib/setup/data";
import type {
  HubUserContext,
  HubUserRole,
  OperationalProfileRole,
  VisibilityScope,
} from "@repo/shared";
import {
  getVisibilityScopeForProfile,
  mapLegacyRoleToOperationalProfile,
} from "@repo/shared";
import type {
  CreateAtlasDepartmentInput,
  CreateAtlasOccurrenceProfileInput,
  CreateAtlasOccurrenceTypeInput,
  CreateAtlasRoleInput,
  CreateDepartmentInput,
  CreateOperationalUserInput,
  CreateHermesChannelInput,
  CreateSectorInput,
  LinkUserAssignmentInput,
  SetupData,
  SetupDepartment,
  SetupModule,
  SetupOperationalProfileRole,
  SetupHermesChannel,
  SetupRecordStatus,
  SetupSector,
  SetupUser,
  UpdateDepartmentInput,
  UpdateHermesChannelInput,
  UpdateSectorInput,
} from "@/lib/setup/types";
import { useAuth } from "@/providers/auth-provider";
import {
  Badge,
  EmptyState,
  Surface,
  Tooltip,
  WorkspaceLayout,
} from "@repo/uix";
import {
  BriefcaseBusiness,
  Building2,
  Archive,
  Gauge,
  KeyRound,
  Layers3,
  Link2,
  MoreVertical,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Upload,
  X,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";

type SetupTabId =
  | "usuarios"
  | "departamentos"
  | "setores"
  | "modulos"
  | "permissoes";

type SetupActionId = "new-department" | "new-sector" | "new-user";
type AtlasConfigTabId =
  | "departamentos"
  | "cargos"
  | "ocorrencias"
  | "perfis";

type SetupEditTarget =
  | { record: SetupDepartment; type: "department" }
  | { record: SetupSector; type: "sector" }
  | { record: SetupHermesChannel; type: "channel" };

const setupTabs = [
  { icon: Users, id: "usuarios", label: "Usuarios" },
  { icon: Building2, id: "departamentos", label: "Departamentos" },
  { icon: Layers3, id: "setores", label: "Setores" },
  { icon: PackageCheck, id: "modulos", label: "Modulos" },
  { icon: KeyRound, id: "permissoes", label: "Permissoes" },
] as const satisfies readonly {
  icon: typeof Users;
  id: SetupTabId;
  label: string;
}[];

const atlasConfigTabs = [
  { icon: Building2, id: "departamentos", label: "Departamentos" },
  { icon: BriefcaseBusiness, id: "cargos", label: "Cargos" },
  { icon: Gauge, id: "ocorrencias", label: "Ocorrencias" },
  { icon: Layers3, id: "perfis", label: "Perfis" },
] as const satisfies readonly {
  icon: LucideIcon;
  id: AtlasConfigTabId;
  label: string;
}[];

export default function SetupPage() {
  const { hubUser, profileStatus } = useAuth();
  const access = getSetupAccess(hubUser);

  if (profileStatus === "loading" && !access.canManageSetup) {
    return (
      <HubShell layoutMode="module">
        <WorkspaceLayout>
          <Surface bordered className="border-[#d9e0e7] bg-white p-6">
            <EmptyState
              description="Carregando perfil operacional."
              title="Preparando Setup"
            />
          </Surface>
        </WorkspaceLayout>
      </HubShell>
    );
  }

  if (!access.canManageSetup) {
    const isProfileError = profileStatus === "error";

    return (
      <HubShell layoutMode="module">
        <WorkspaceLayout>
          <Surface bordered className="border-[#d9e0e7] bg-white p-6">
            <EmptyState
              description={
                isProfileError
                  ? "Nao foi possivel carregar seu perfil admin. Verifique os logs do console e tente atualizar."
                  : "Entre com um perfil admin para visualizar usuarios, departamentos, setores e permissoes."
              }
              title={isProfileError ? "Perfil indisponivel" : "Acesso negado"}
            />
          </Surface>
        </WorkspaceLayout>
      </HubShell>
    );
  }

  return (
    <HubShell layoutMode="module">
      <SetupWorkspace />
    </HubShell>
  );
}

type SetupAccessProfile = OperationalProfileRole | "readonly";

type SetupAccess = {
  canManageSetup: boolean;
  profileRole: SetupAccessProfile;
  visibilityScope: VisibilityScope | "readonly";
};

function getSetupAccess(user: HubUserContext | null): SetupAccess {
  const profileRole = mapHubRoleToSetupProfile(user?.role);

  return {
    canManageSetup: user?.role === "admin" || profileRole === "adm",
    profileRole,
    visibilityScope:
      profileRole === "readonly"
        ? "readonly"
        : getVisibilityScopeForProfile(profileRole),
  };
}

function mapHubRoleToSetupProfile(role?: HubUserRole): SetupAccessProfile {
  if (!role || role === "viewer") {
    return "readonly";
  }

  return mapLegacyRoleToOperationalProfile(role);
}

function SetupWorkspace() {
  const [activeTab, setActiveTab] = useState<SetupTabId>("usuarios");
  const [data, setData] = useState<SetupData>(emptySetupData);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<SetupActionId | null>(null);
  const [editTarget, setEditTarget] = useState<SetupEditTarget | null>(null);
  const [linkUserTarget, setLinkUserTarget] = useState<SetupUser | null>(null);
  const [moduleConfigTarget, setModuleConfigTarget] =
    useState<SetupModule | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  async function refreshSetupData() {
    setIsLoading(true);
    setError(null);

    try {
      setData(await loadSetupData());
    } catch (setupError) {
      setError(
        setupError instanceof Error
          ? getFriendlySetupError(setupError, "load")
          : "Nao foi possivel carregar os dados. Tente atualizar.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshSetupData();
  }, []);

  const summary = useMemo(
    () => [
      { label: "usuarios", value: data.users.length },
      { label: "departamentos", value: data.departments.length },
      { label: "setores", value: data.sectors.length },
      { label: "modulos", value: data.modules.length },
    ],
    [data],
  );

  async function handleCreateDepartment(input: CreateDepartmentInput) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await createDepartment(input);
      await refreshSetupData();
      setActiveTab("departamentos");
      setActiveAction(null);
      setSuccess("Departamento cadastrado.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateSector(input: CreateSectorInput) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await createSector(input);
      await refreshSetupData();
      setActiveTab("setores");
      setActiveAction(null);
      setSuccess("Setor cadastrado.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateOperationalUser(
    input: CreateOperationalUserInput,
  ) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await createOperationalUser(input);
      await refreshSetupData();
      setActiveTab("usuarios");
      setActiveAction(null);
      setSuccess("Usuario criado.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateHermesModuleChannel(
    input: CreateHermesChannelInput,
  ) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await createHermesChannel(input);
      await refreshSetupData();
      setSuccess("Grupo Hermes cadastrado.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateAtlasDepartment(
    input: CreateAtlasDepartmentInput,
  ) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await createAtlasDepartment(input);
      await refreshSetupData();
      setSuccess("Departamento Atlas cadastrado.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateAtlasRole(input: CreateAtlasRoleInput) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await createAtlasRole(input);
      await refreshSetupData();
      setSuccess("Cargo Atlas cadastrado.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateAtlasOccurrenceProfile(
    input: CreateAtlasOccurrenceProfileInput,
  ) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await createAtlasOccurrenceProfile(input);
      await refreshSetupData();
      setSuccess("Perfil Atlas cadastrado.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateAtlasOccurrenceType(
    input: CreateAtlasOccurrenceTypeInput,
  ) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await createAtlasOccurrenceType(input);
      await refreshSetupData();
      setSuccess("Ocorrencia Atlas cadastrada.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLinkUserAssignment(input: LinkUserAssignmentInput) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await linkUserAssignment(input);
      await refreshSetupData();
      setActiveTab("usuarios");
      setLinkUserTarget(null);
      setSuccess("Usuario atualizado.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateDepartment(input: UpdateDepartmentInput) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await updateDepartment(input);
      await refreshSetupData();
      setEditTarget(null);
      setSuccess("Departamento atualizado.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateSector(input: UpdateSectorInput) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await updateSector(input);
      await refreshSetupData();
      setEditTarget(null);
      setSuccess("Setor atualizado.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateHermesChannel(input: UpdateHermesChannelInput) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await updateHermesChannel(input);
      await refreshSetupData();
      setEditTarget(null);
      setSuccess("Canal Hermes atualizado.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSyncHermesChannelMembers(
    channelId: string,
    participantUserIds: readonly string[],
  ) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await syncHermesChannelMembers(channelId, participantUserIds);
      await refreshSetupData();
      setSuccess("Participantes atualizados.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <WorkspaceLayout className="bg-[#f3f6fa]">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map((item) => (
          <Surface
            bordered
            className="border-[#d9e0e7] bg-white p-4"
            key={item.label}
          >
            <p className="m-0 text-2xl font-semibold text-[#101820]">
              {item.value}
            </p>
            <p className="m-0 mt-1 text-xs text-[#667085]">{item.label}</p>
          </Surface>
        ))}
      </section>

      {error ? (
        <Surface
          bordered
          className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
        >
          <span className="inline-flex items-center gap-2 font-semibold">
            <ShieldAlert aria-hidden="true" size={16} />
            {error}
          </span>
        </Surface>
      ) : null}

      {success ? (
        <Surface
          bordered
          className="border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800"
        >
          {success}
        </Surface>
      ) : null}

      <Surface bordered className="border-[#d9e0e7] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5eaf0] p-2">
          <div className="flex flex-wrap gap-1">
            {setupTabs.map((tab) => {
              const TabIcon = tab.icon;

              return (
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold text-[#667085] outline-none transition hover:bg-[#f3f6fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B] data-[active=true]:bg-[#101820] data-[active=true]:text-white"
                  data-active={activeTab === tab.id}
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setActiveAction(null);
                    setEditTarget(null);
                    setLinkUserTarget(null);
                    setModuleConfigTarget(null);
                  }}
                  type="button"
                >
                  <TabIcon aria-hidden="true" size={15} />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <Tooltip content="Atualizar">
            <button
              aria-label="Atualizar"
              className="grid h-9 w-9 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#101820] outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={() => void refreshSetupData()}
              title="Atualizar"
              type="button"
            >
              <RefreshCw aria-hidden="true" size={15} />
            </button>
          </Tooltip>
        </div>
        <div className="p-5">
          {isLoading ? (
            <EmptyState
              description="Buscando dados reais do Supabase."
              title="Carregando Setup"
            />
          ) : (
            <SetupTabContent
              activeTab={activeTab}
              data={data}
              error={error}
              activeAction={activeAction}
              isSaving={isSaving}
              onCloseAction={() => setActiveAction(null)}
              onCreateDepartment={handleCreateDepartment}
              onCreateOperationalUser={handleCreateOperationalUser}
              onCreateSector={handleCreateSector}
              onEditRecord={setEditTarget}
              onLinkUser={setLinkUserTarget}
              onConfigureModule={setModuleConfigTarget}
              onOpenAction={(action) => {
                setError(null);
                setSuccess(null);
                setActiveAction(action);
              }}
            />
          )}
        </div>
      </Surface>
      {editTarget ? (
        <EditRecordModal
          data={data}
          isSaving={isSaving}
          onClose={() => setEditTarget(null)}
          onUpdateDepartment={handleUpdateDepartment}
          onUpdateHermesChannel={handleUpdateHermesChannel}
          onUpdateSector={handleUpdateSector}
          target={editTarget}
        />
      ) : null}
      {linkUserTarget ? (
        <LinkUserAssignmentModal
          data={data}
          isSaving={isSaving}
          onClose={() => setLinkUserTarget(null)}
          onSubmit={handleLinkUserAssignment}
          user={linkUserTarget}
        />
      ) : null}
      {moduleConfigTarget?.id === "hermes" ? (
        <HermesModuleConfigModal
          data={data}
          isSaving={isSaving}
          onClose={() => setModuleConfigTarget(null)}
          onCreateChannel={handleCreateHermesModuleChannel}
          onEditChannel={(channel) =>
            setEditTarget({ record: channel, type: "channel" })
          }
          onSyncMembers={handleSyncHermesChannelMembers}
        />
      ) : null}
      {moduleConfigTarget?.id === "atlas" ? (
        <AtlasModuleConfigModal
          data={data}
          error={error}
          isSaving={isSaving}
          onClose={() => setModuleConfigTarget(null)}
          onCreateDepartment={handleCreateAtlasDepartment}
          onCreateOccurrenceProfile={handleCreateAtlasOccurrenceProfile}
          onCreateOccurrenceType={handleCreateAtlasOccurrenceType}
          onCreateRole={handleCreateAtlasRole}
          success={success}
        />
      ) : null}
    </WorkspaceLayout>
  );
}

function SetupTabContent({
  activeTab,
  activeAction,
  data,
  error,
  isSaving,
  onCloseAction,
  onCreateDepartment,
  onCreateOperationalUser,
  onCreateSector,
  onConfigureModule,
  onEditRecord,
  onLinkUser,
  onOpenAction,
}: {
  activeTab: SetupTabId;
  activeAction: SetupActionId | null;
  data: SetupData;
  error: string | null;
  isSaving: boolean;
  onCloseAction: () => void;
  onCreateDepartment: (input: CreateDepartmentInput) => Promise<void>;
  onCreateOperationalUser: (input: CreateOperationalUserInput) => Promise<void>;
  onCreateSector: (input: CreateSectorInput) => Promise<void>;
  onConfigureModule: (module: SetupModule) => void;
  onEditRecord: (target: SetupEditTarget) => void;
  onLinkUser: (user: SetupUser) => void;
  onOpenAction: (action: SetupActionId) => void;
}) {
  if (activeTab === "usuarios") {
    return (
      <TabPanel
        action={
          <ActionButton
            label="Novo usuario"
            onClick={() => onOpenAction("new-user")}
          />
        }
        title="Usuarios"
      >
        {activeAction === "new-user" ? (
          <CreateOperationalUserModal
            data={data}
            error={error}
            isSaving={isSaving}
            onClose={onCloseAction}
            onSubmit={onCreateOperationalUser}
          />
        ) : null}
        <DataGrid
          empty="Nenhum usuario sincronizado em hub_users."
          headers={[
            "Nome",
            "Email",
            "Departamento",
            "Setor",
            "Status",
            "Acoes",
          ]}
          rows={data.users.map((user) => [
            user.displayName,
            user.email,
            user.departmentName ?? "Sem departamento",
            user.sectorName ?? "Sem setor",
            user.status,
            <UserAssignmentAction
              key={user.id}
              onClick={() => onLinkUser(user)}
            />,
          ])}
        />
      </TabPanel>
    );
  }

  if (activeTab === "departamentos") {
    return (
      <TabPanel
        action={
          <ActionButton
            label="Novo departamento"
            onClick={() => onOpenAction("new-department")}
          />
        }
        title="Departamentos"
      >
        {activeAction === "new-department" ? (
          <CreateDepartmentForm
            isSaving={isSaving}
            onCancel={onCloseAction}
            onSubmit={onCreateDepartment}
          />
        ) : null}
        <DataGrid
          empty="Nenhum departamento cadastrado."
          headers={["Departamento", "Descricao", "Status", "Acoes"]}
          rows={data.departments.map((department) => [
            department.name,
            department.description ?? "-",
            department.status,
            <RowActions
              key={department.id}
              onArchive={() =>
                onEditRecord({
                  record: { ...department, status: "archived" },
                  type: "department",
                })
              }
              onEdit={() =>
                onEditRecord({ record: department, type: "department" })
              }
            />,
          ])}
        />
      </TabPanel>
    );
  }

  if (activeTab === "setores") {
    return (
      <TabPanel
        action={
          <ActionButton
            label="Novo setor"
            onClick={() => onOpenAction("new-sector")}
          />
        }
        title="Setores"
      >
        {activeAction === "new-sector" ? (
          <CreateSectorForm
            departments={data.departments}
            isSaving={isSaving}
            onCancel={onCloseAction}
            onSubmit={onCreateSector}
          />
        ) : null}
        <DataGrid
          empty="Nenhum setor cadastrado."
          headers={["Setor", "Departamento", "Descricao", "Status", "Acoes"]}
          rows={data.sectors.map((sector) => [
            sector.name,
            sector.departmentName ?? "-",
            sector.description ?? "-",
            sector.status,
            <RowActions
              key={sector.id}
              onArchive={() =>
                onEditRecord({
                  record: { ...sector, status: "archived" },
                  type: "sector",
                })
              }
              onEdit={() => onEditRecord({ record: sector, type: "sector" })}
            />,
          ])}
        />
      </TabPanel>
    );
  }

  if (activeTab === "modulos") {
    return (
      <TabPanel title="Modulos">
        <DataGrid
          empty="Nenhum modulo cadastrado."
          headers={[
            "Modulo",
            "Acoes",
            "Rota",
            "Status",
            "Departamentos liberados",
          ]}
          rows={data.modules.map((module) => [
            module.name,
            <ModuleConfigAction
              disabled={
                !["atlas", "hermes"].includes(module.id) ||
                module.status === "planned"
              }
              key={module.id}
              onClick={() => onConfigureModule(module)}
            />,
            module.basePath,
            module.status,
            data.departmentModules.filter(
              (access) =>
                access.moduleId === module.id && access.status === "enabled",
            ).length,
          ])}
        />
      </TabPanel>
    );
  }

  if (activeTab === "permissoes") {
    return (
      <TabPanel title="Permissoes">
        <DataGrid
          empty="Nenhuma permissao cadastrada."
          headers={["Permissao", "Escopo", "Modulo", "Descricao"]}
          rows={data.permissions.map((permission) => [
            permission.key,
            permission.scope,
            permission.moduleId ?? "-",
            permission.description ?? "-",
          ])}
        />
      </TabPanel>
    );
  }

  return null;
}

function CreateDepartmentForm({
  isSaving,
  onCancel,
  onSubmit,
}: {
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateDepartmentInput) => Promise<void>;
}) {
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<SetupRecordStatus>("active");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      description,
      name,
      slug: slugify(name),
      status,
    });
    setDescription("");
    setName("");
    setStatus("active");
  }

  return (
    <SetupFormCard title="Novo departamento">
      <form className="grid gap-3" onSubmit={handleSubmit}>
        <TextInput label="Nome" onChange={setName} value={name} />
        <TextAreaInput
          label="Descricao"
          onChange={setDescription}
          value={description}
        />
        <StatusSelect onChange={setStatus} value={status} />
        <FormActions disabled={!name.trim() || isSaving} onCancel={onCancel} />
      </form>
    </SetupFormCard>
  );
}

function CreateSectorForm({
  departments,
  isSaving,
  onCancel,
  onSubmit,
}: {
  departments: SetupData["departments"];
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (input: CreateSectorInput) => Promise<void>;
}) {
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<SetupRecordStatus>("active");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      departmentId,
      description,
      name,
      slug: slugify(name),
      status,
    });
    setDescription("");
    setName("");
    setStatus("active");
  }

  return (
    <SetupFormCard title="Novo setor">
      <form className="grid gap-3" onSubmit={handleSubmit}>
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#667085]">
            Departamento
          </span>
          <select
            className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
            onChange={(event) => setDepartmentId(event.target.value)}
            value={departmentId}
          >
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <TextInput label="Nome" onChange={setName} value={name} />
        <TextAreaInput
          label="Descricao"
          onChange={setDescription}
          value={description}
        />
        <StatusSelect onChange={setStatus} value={status} />
        <FormActions
          disabled={!departmentId || !name.trim() || isSaving}
          onCancel={onCancel}
        />
      </form>
    </SetupFormCard>
  );
}

function HermesCreateChannelPanel({
  activeDepartmentId,
  data,
  isSaving,
  onCreated,
  onSubmit,
}: {
  activeDepartmentId: string;
  data: SetupData;
  isSaving: boolean;
  onCreated: (channelId: string) => void;
  onSubmit: (input: CreateHermesChannelInput) => Promise<void>;
}) {
  const [departmentId, setDepartmentId] = useState(activeDepartmentId);
  const [description, setDescription] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [name, setName] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [status, setStatus] = useState<SetupRecordStatus>("active");
  const [type, setType] =
    useState<CreateHermesChannelInput["type"]>("department_channel");
  const availableSectors = data.sectors.filter(
    (sector) => !departmentId || sector.departmentId === departmentId,
  );

  useEffect(() => {
    setDepartmentId(activeDepartmentId);
    setSectorId("");
  }, [activeDepartmentId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const channelId = createHermesChannelId({
      data,
      departmentId,
      name,
      sectorId,
      type,
    });

    await onSubmit({
      departmentId,
      description,
      id: channelId,
      name,
      sectorId: sectorId || undefined,
      status,
      type,
    });
    onCreated(channelId);
    setDescription("");
    setName("");
    setSectorId("");
    setStatus("active");
    setType("department_channel");
    setIsExpanded(false);
  }

  return (
    <section className="rounded-md border border-[#d9e0e7] bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-[#edf0f4] px-4 py-3">
        <div>
          <h3 className="m-0 text-sm font-semibold text-[#101820]">
            Canais e grupos
          </h3>
          <p className="m-0 mt-1 text-xs text-[#667085]">Hermes</p>
        </div>
        <button
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#101820] px-3 text-sm font-semibold text-white outline-none transition hover:bg-[#1f2933] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={() => setIsExpanded((current) => !current)}
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          Novo
        </button>
      </div>
      {isExpanded ? (
        <form className="grid gap-3 p-4" onSubmit={handleSubmit}>
          <div className="grid gap-3 lg:grid-cols-2">
            <TextInput label="Nome" onChange={setName} value={name} />
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#667085]">
                Departamento
              </span>
              <select
                className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
                onChange={(event) => {
                  setDepartmentId(event.target.value);
                  setSectorId("");
                }}
                value={departmentId}
              >
                {data.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#667085]">Tipo</span>
              <select
                className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
                onChange={(event) => {
                  const nextType = event.target
                    .value as CreateHermesChannelInput["type"];

                  setType(nextType);
                }}
                value={type}
              >
                <option value="department_channel">
                  Canal de departamento
                </option>
                <option value="sector_channel">Canal de setor</option>
                <option value="private_group">Grupo privado</option>
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#667085]">
                Setor
              </span>
              <select
                className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
                onChange={(event) => setSectorId(event.target.value)}
                value={sectorId}
              >
                <option value="">Departamento</option>
                {availableSectors.map((sector) => (
                  <option key={sector.id} value={sector.id}>
                    {sector.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <TextAreaInput
            label="Descricao"
            onChange={setDescription}
            value={description}
          />
          <StatusSelect onChange={setStatus} value={status} />
          <FormActions
            disabled={!departmentId || !name.trim() || isSaving}
            onCancel={() => setIsExpanded(false)}
          />
        </form>
      ) : null}
    </section>
  );
}

function DataGrid({
  empty,
  headers,
  rows,
}: {
  empty: string;
  headers: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}) {
  if (rows.length === 0) {
    return <EmptyState description={empty} title="Nenhum registro" />;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[#e5eaf0]">
      <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
        <thead className="bg-[#f8fafc] text-xs uppercase text-[#667085]">
          <tr>
            {headers.map((header) => (
              <th className="px-3 py-2 font-semibold" key={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#edf0f4] bg-white">
          {rows.map((row, rowIndex) => (
            <tr key={String(rowIndex)}>
              {row.map((cell, cellIndex) => (
                <td
                  className="px-3 py-3 text-[#344054]"
                  key={String(cellIndex)}
                >
                  {typeof cell === "string" && isStatusValue(cell) ? (
                    <Badge variant={getStatusBadgeVariant(cell)}>{cell}</Badge>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function isStatusValue(value: string) {
  return [
    "active",
    "archived",
    "disabled",
    "enabled",
    "locked",
    "planned",
  ].includes(value);
}

function getStatusBadgeVariant(
  value: string,
): "danger" | "neutral" | "success" | "warning" {
  if (value === "active" || value === "enabled") {
    return "success";
  }

  if (value === "disabled" || value === "archived") {
    return "warning";
  }

  if (value === "locked") {
    return "danger";
  }

  return "neutral";
}

function TabPanel({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-base font-semibold text-[#101820]">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label}>
      <button
        aria-label={label}
        className="grid h-9 w-9 place-items-center rounded-md bg-[#A07C3B] text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
        onClick={onClick}
        type="button"
      >
        <Plus aria-hidden="true" size={15} />
      </button>
    </Tooltip>
  );
}

function RowActions({
  onArchive,
  onEdit,
}: {
  onArchive: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Tooltip content="Editar">
        <button
          aria-label="Editar"
          className="grid h-8 w-8 place-items-center rounded-md text-[#667085] outline-none transition hover:bg-[#f3f6fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={onEdit}
          type="button"
        >
          <Pencil aria-hidden="true" size={14} />
        </button>
      </Tooltip>
      <Tooltip content="Arquivar">
        <button
          aria-label="Arquivar"
          className="grid h-8 w-8 place-items-center rounded-md text-[#667085] outline-none transition hover:bg-[#fff7e6] hover:text-[#8a682f] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={onArchive}
          type="button"
        >
          <Archive aria-hidden="true" size={14} />
        </button>
      </Tooltip>
      <MoreVertical aria-hidden="true" className="text-[#98a2b3]" size={14} />
    </div>
  );
}

function ModuleConfigAction({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-start">
      <Tooltip
        content={
          disabled ? "Modulo ainda sem configuracao" : "Configurar modulo"
        }
      >
        <button
          aria-label="Configurar modulo"
          className="grid h-8 w-8 place-items-center rounded-md text-[#667085] outline-none transition hover:bg-[#f3f6fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-35"
          disabled={disabled}
          onClick={onClick}
          type="button"
        >
          <Settings2 aria-hidden="true" size={14} />
        </button>
      </Tooltip>
    </div>
  );
}

function UserAssignmentAction({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex items-center justify-start">
      <Tooltip content="Editar usuario">
        <button
          aria-label="Editar usuario"
          className="grid h-8 w-8 place-items-center rounded-md text-[#667085] outline-none transition hover:bg-[#f3f6fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={onClick}
          type="button"
        >
          <Pencil aria-hidden="true" size={14} />
        </button>
      </Tooltip>
    </div>
  );
}

function EditRecordModal({
  data,
  isSaving,
  onClose,
  onUpdateDepartment,
  onUpdateHermesChannel,
  onUpdateSector,
  target,
}: {
  data: SetupData;
  isSaving: boolean;
  onClose: () => void;
  onUpdateDepartment: (input: UpdateDepartmentInput) => Promise<void>;
  onUpdateHermesChannel: (input: UpdateHermesChannelInput) => Promise<void>;
  onUpdateSector: (input: UpdateSectorInput) => Promise<void>;
  target: SetupEditTarget;
}) {
  if (target.type === "department") {
    return (
      <EditDepartmentModal
        isSaving={isSaving}
        onClose={onClose}
        onSubmit={onUpdateDepartment}
        record={target.record}
      />
    );
  }

  if (target.type === "sector") {
    return (
      <EditSectorModal
        departments={data.departments}
        isSaving={isSaving}
        onClose={onClose}
        onSubmit={onUpdateSector}
        record={target.record}
      />
    );
  }

  return (
    <EditHermesChannelModal
      data={data}
      isSaving={isSaving}
      onClose={onClose}
      onSubmit={onUpdateHermesChannel}
      record={target.record}
    />
  );
}

function EditDepartmentModal({
  isSaving,
  onClose,
  onSubmit,
  record,
}: {
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (input: UpdateDepartmentInput) => Promise<void>;
  record: SetupDepartment;
}) {
  const [description, setDescription] = useState(record.description ?? "");
  const [name, setName] = useState(record.name);
  const [status, setStatus] = useState<SetupRecordStatus>(record.status);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      description,
      id: record.id,
      name,
      status,
    });
  }

  return (
    <SetupModal onClose={onClose} title="Editar departamento">
      <form className="grid gap-3 p-5" onSubmit={handleSubmit}>
        <TextInput label="Nome" onChange={setName} value={name} />
        <TextAreaInput
          label="Descricao"
          onChange={setDescription}
          value={description}
        />
        <StatusSelect onChange={setStatus} value={status} />
        <FormActions
          disabled={!name.trim() || isSaving}
          onCancel={onClose}
          submitLabel={isSaving ? "Salvando..." : "Salvar"}
        />
      </form>
    </SetupModal>
  );
}

function EditSectorModal({
  departments,
  isSaving,
  onClose,
  onSubmit,
  record,
}: {
  departments: SetupData["departments"];
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (input: UpdateSectorInput) => Promise<void>;
  record: SetupSector;
}) {
  const [departmentId, setDepartmentId] = useState(record.departmentId);
  const [description, setDescription] = useState(record.description ?? "");
  const [name, setName] = useState(record.name);
  const [status, setStatus] = useState<SetupRecordStatus>(record.status);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      departmentId,
      description,
      id: record.id,
      name,
      status,
    });
  }

  return (
    <SetupModal onClose={onClose} title="Editar setor">
      <form className="grid gap-3 p-5" onSubmit={handleSubmit}>
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#667085]">
            Departamento
          </span>
          <select
            className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
            onChange={(event) => setDepartmentId(event.target.value)}
            value={departmentId}
          >
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <TextInput label="Nome" onChange={setName} value={name} />
        <TextAreaInput
          label="Descricao"
          onChange={setDescription}
          value={description}
        />
        <StatusSelect onChange={setStatus} value={status} />
        <FormActions
          disabled={!departmentId || !name.trim() || isSaving}
          onCancel={onClose}
          submitLabel={isSaving ? "Salvando..." : "Salvar"}
        />
      </form>
    </SetupModal>
  );
}

function EditHermesChannelModal({
  data,
  isSaving,
  onClose,
  onSubmit,
  record,
}: {
  data: SetupData;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (input: UpdateHermesChannelInput) => Promise<void>;
  record: SetupHermesChannel;
}) {
  const [departmentId, setDepartmentId] = useState(record.departmentId ?? "");
  const [name, setName] = useState(record.name);
  const [participantUserIds, setParticipantUserIds] = useState<string[]>(
    getHermesChannelMemberIds(data, record.id),
  );
  const [sectorId, setSectorId] = useState(record.sectorId ?? "");
  const [status, setStatus] = useState<SetupRecordStatus>(record.status);
  const [type, setType] = useState<SetupHermesChannel["type"]>(record.type);
  const availableSectors = data.sectors.filter(
    (sector) => !departmentId || sector.departmentId === departmentId,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      departmentId,
      id: record.id,
      name,
      participantUserIds,
      sectorId: sectorId || undefined,
      status,
      type,
    });
  }

  return (
    <SetupModal onClose={onClose} title="Editar canal">
      <form className="grid gap-3 p-5" onSubmit={handleSubmit}>
        <TextInput label="Nome" onChange={setName} value={name} />
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#667085]">
            Departamento
          </span>
          <select
            className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
            onChange={(event) => {
              setDepartmentId(event.target.value);
              setSectorId("");
            }}
            value={departmentId}
          >
            <option value="">Sem departamento</option>
            {data.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#667085]">Setor</span>
          <select
            className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
            onChange={(event) => setSectorId(event.target.value)}
            value={sectorId}
          >
            <option value="">Departamento</option>
            {availableSectors.map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#667085]">Tipo</span>
          <select
            className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
            onChange={(event) =>
              setType(event.target.value as SetupHermesChannel["type"])
            }
            value={type}
          >
            <option value="sector_channel">Canal de setor</option>
            <option value="department_channel">Canal de departamento</option>
            <option value="private_group">Grupo privado</option>
          </select>
        </label>
        <StatusSelect onChange={setStatus} value={status} />
        <ParticipantPicker
          onChange={setParticipantUserIds}
          selectedUserIds={participantUserIds}
          users={data.users}
        />
        <FormActions
          disabled={!name.trim() || isSaving}
          onCancel={onClose}
          submitLabel={isSaving ? "Salvando..." : "Salvar"}
        />
      </form>
    </SetupModal>
  );
}

function SetupModal({
  children,
  onClose,
  size = "default",
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  size?: "default" | "full" | "wide";
  title: string;
}) {
  const sizeClass =
    size === "full"
      ? "max-w-[86rem]"
      : size === "wide"
        ? "max-w-5xl"
        : "max-w-xl";

  return (
    <div className="fixed inset-0 z-[var(--uix-z-modal)] grid place-items-center bg-black/25 px-4">
      <button
        aria-label="Fechar janela"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div
        className={`relative z-10 w-full rounded-md border border-[#d9e0e7] bg-white shadow-2xl ${sizeClass}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[#edf0f4] px-5 py-4">
          <h2 className="m-0 text-base font-semibold text-[#101820]">
            {title}
          </h2>
          <button
            aria-label="Fechar"
            className="grid h-8 w-8 place-items-center rounded-md text-[#667085] outline-none transition hover:bg-[#f3f6fa] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AtlasModuleConfigModal({
  data,
  error,
  isSaving,
  onClose,
  onCreateDepartment,
  onCreateOccurrenceProfile,
  onCreateOccurrenceType,
  onCreateRole,
  success,
}: {
  data: SetupData;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onCreateDepartment: (input: CreateAtlasDepartmentInput) => Promise<void>;
  onCreateOccurrenceProfile: (
    input: CreateAtlasOccurrenceProfileInput,
  ) => Promise<void>;
  onCreateOccurrenceType: (
    input: CreateAtlasOccurrenceTypeInput,
  ) => Promise<void>;
  onCreateRole: (input: CreateAtlasRoleInput) => Promise<void>;
  success: string | null;
}) {
  const [activeTab, setActiveTab] =
    useState<AtlasConfigTabId>("departamentos");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const profileNameById = useMemo(
    () =>
      new Map(
        data.atlas.occurrenceProfiles.map((profile) => [
          profile.id,
          profile.name,
        ]),
      ),
    [data.atlas.occurrenceProfiles],
  );
  const activeTabMeta =
    atlasConfigTabs.find((tab) => tab.id === activeTab) ?? atlasConfigTabs[0];
  const ActiveIcon = activeTabMeta.icon;

  useEffect(() => {
    setIsCreateOpen(false);
  }, [activeTab]);

  return (
    <SetupModal onClose={onClose} size="full" title="Setup Atlas">
      <div className="grid max-h-[82vh] overflow-hidden lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="border-b border-[#edf0f4] bg-[#f8fafc] p-4 lg:border-b-0 lg:border-r">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <p className="m-0 text-xs font-semibold uppercase text-[#667085]">
                Modulo
              </p>
              <h3 className="m-0 mt-1 text-base font-semibold text-[#101820]">
                Atlas
              </h3>
            </div>
            <Badge variant="neutral">read-only</Badge>
          </div>
          <div className="grid gap-2">
            {atlasConfigTabs.map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;

              return (
                <button
                  aria-pressed={isSelected}
                  className={`flex h-10 items-center gap-2 rounded-md border px-2.5 text-left text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
                    isSelected
                      ? "border-[#A07C3B] bg-white text-[#101820] shadow-sm"
                      : "border-[#e5eaf0] bg-white/70 text-[#667085] hover:bg-white hover:text-[#101820]"
                  }`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  type="button"
                >
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${
                      isSelected
                        ? "bg-[#101820] text-[#A07C3B]"
                        : "bg-[#f3f6fa] text-[#667085]"
                    }`}
                  >
                    <Icon aria-hidden="true" size={14} />
                  </span>
                  <span className="min-w-0 truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 rounded-md border border-[#eadfca] bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase text-[#8a682f]">
                Bonus
              </span>
              <Badge variant="danger">BLOQUEADO</Badge>
            </div>
            <p className="m-0 mt-2 text-xs leading-5 text-[#667085]">
              Regras de bonus e escrita seguem preservadas ate validacao humana.
            </p>
          </div>
        </aside>

        <main className="min-h-0 overflow-auto p-4">
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <AtlasConfigSummaryCard
              icon={Building2}
              label="Departamentos"
              value={data.atlas.departments.length}
            />
            <AtlasConfigSummaryCard
              icon={BriefcaseBusiness}
              label="Cargos"
              value={data.atlas.roles.length}
            />
            <AtlasConfigSummaryCard
              icon={Gauge}
              label="Ocorrencias"
              value={data.atlas.occurrenceTypes.length}
            />
            <AtlasConfigSummaryCard
              icon={Layers3}
              label="Perfis"
              value={data.atlas.occurrenceProfiles.length}
            />
          </div>

          <section className="grid gap-4 rounded-md border border-[#e5eaf0] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#101820] text-[#A07C3B]">
                  <ActiveIcon aria-hidden="true" size={16} />
                </span>
                <div className="min-w-0">
                  <h3 className="m-0 truncate text-base font-semibold text-[#101820]">
                    {activeTabMeta.label}
                  </h3>
                  <p className="m-0 mt-1 text-sm text-[#667085]">
                    Configuracao herdada das tabelas Atlas no Hub.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">
                  {getAtlasConfigTabCount(data, activeTab)} registros
                </Badge>
                <button
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#A07C3B] px-3 text-sm font-semibold text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                  onClick={() => setIsCreateOpen((current) => !current)}
                  type="button"
                >
                  <Plus aria-hidden="true" size={15} />
                  Criar
                </button>
              </div>
            </div>
            {error ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                {error}
              </div>
            ) : null}
            {success ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                {success}
              </div>
            ) : null}
            {isCreateOpen ? (
              <AtlasCreateConfigForm
                activeTab={activeTab}
                data={data}
                isSaving={isSaving}
                onCancel={() => setIsCreateOpen(false)}
                onCreateDepartment={onCreateDepartment}
                onCreateOccurrenceProfile={onCreateOccurrenceProfile}
                onCreateOccurrenceType={onCreateOccurrenceType}
                onCreateRole={onCreateRole}
              />
            ) : null}
            <AtlasConfigTable
              activeTab={activeTab}
              data={data}
              profileNameById={profileNameById}
            />
          </section>
        </main>
      </div>
    </SetupModal>
  );
}

function AtlasConfigSummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-[#e5eaf0] bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase text-[#667085]">
          {label}
        </span>
        <span className="grid h-7 w-7 place-items-center rounded-md bg-[#A07C3B]/10 text-[#A07C3B]">
          <Icon aria-hidden="true" size={14} />
        </span>
      </div>
      <p className="m-0 mt-2 text-xl font-semibold text-[#101820]">
        {value}
      </p>
    </div>
  );
}

function AtlasCreateConfigForm({
  activeTab,
  data,
  isSaving,
  onCancel,
  onCreateDepartment,
  onCreateOccurrenceProfile,
  onCreateOccurrenceType,
  onCreateRole,
}: {
  activeTab: AtlasConfigTabId;
  data: SetupData;
  isSaving: boolean;
  onCancel: () => void;
  onCreateDepartment: (input: CreateAtlasDepartmentInput) => Promise<void>;
  onCreateOccurrenceProfile: (
    input: CreateAtlasOccurrenceProfileInput,
  ) => Promise<void>;
  onCreateOccurrenceType: (
    input: CreateAtlasOccurrenceTypeInput,
  ) => Promise<void>;
  onCreateRole: (input: CreateAtlasRoleInput) => Promise<void>;
}) {
  const [baseValue, setBaseValue] = useState("");
  const [name, setName] = useState("");
  const [profileLegacyId, setProfileLegacyId] = useState(
    data.atlas.occurrenceProfiles[0]?.id ?? "",
  );

  useEffect(() => {
    setBaseValue("");
    setName("");
    setProfileLegacyId(data.atlas.occurrenceProfiles[0]?.id ?? "");
  }, [activeTab, data.atlas.occurrenceProfiles]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (activeTab === "departamentos") {
      await onCreateDepartment({ name });
      setName("");
      return;
    }

    if (activeTab === "cargos") {
      await onCreateRole({
        baseValue: parseAtlasCurrencyInput(baseValue),
        name,
      });
      setBaseValue("");
      setName("");
      return;
    }

    if (activeTab === "ocorrencias") {
      const selectedProfile = data.atlas.occurrenceProfiles.find(
        (profile) => profile.id === profileLegacyId,
      );

      await onCreateOccurrenceType({
        name,
        profileLegacyId: selectedProfile?.id ?? null,
        profileRowId: selectedProfile?.rowId ?? null,
      });
      setName("");
      return;
    }

    await onCreateOccurrenceProfile({ name });
    setName("");
  }

  const isOccurrenceType = activeTab === "ocorrencias";
  const isRole = activeTab === "cargos";
  const hasRequiredProfile =
    !isOccurrenceType || data.atlas.occurrenceProfiles.length > 0;
  const submitLabel = `Criar ${getAtlasCreateLabel(activeTab)}`;

  return (
    <SetupFormCard title={submitLabel}>
      <form className="grid gap-3" onSubmit={handleSubmit}>
        <TextInput label="Nome" onChange={setName} value={name} />
        {isRole ? (
          <TextInput
            label="Valor base"
            onChange={setBaseValue}
            placeholder="0,00"
            value={baseValue}
          />
        ) : null}
        {isOccurrenceType ? (
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-[#667085]">
              Perfil
            </span>
            <select
              className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B] disabled:cursor-not-allowed disabled:bg-[#f4f7fa] disabled:text-[#8b96a8]"
              disabled={data.atlas.occurrenceProfiles.length === 0}
              onChange={(event) => setProfileLegacyId(event.target.value)}
              value={profileLegacyId}
            >
              {data.atlas.occurrenceProfiles.length === 0 ? (
                <option value="">Crie um perfil primeiro</option>
              ) : null}
              {data.atlas.occurrenceProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {isOccurrenceType && !hasRequiredProfile ? (
          <p className="m-0 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            Crie um perfil antes de cadastrar uma ocorrencia.
          </p>
        ) : null}
        <FormActions
          disabled={!name.trim() || !hasRequiredProfile || isSaving}
          onCancel={onCancel}
          submitLabel={isSaving ? "Salvando..." : submitLabel}
        />
      </form>
    </SetupFormCard>
  );
}

function AtlasConfigTable({
  activeTab,
  data,
  profileNameById,
}: {
  activeTab: AtlasConfigTabId;
  data: SetupData;
  profileNameById: ReadonlyMap<string, string>;
}) {
  if (activeTab === "departamentos") {
    return (
      <DataGrid
        empty="Nenhum departamento Atlas encontrado."
        headers={["Departamento", "ID legado"]}
        rows={data.atlas.departments.map((department) => [
          department.name,
          department.id,
        ])}
      />
    );
  }

  if (activeTab === "cargos") {
    return (
      <DataGrid
        empty="Nenhum cargo Atlas encontrado."
        headers={["Cargo", "Valor base", "ID legado"]}
        rows={data.atlas.roles.map((role) => [
          role.name,
          formatSetupCurrency(role.baseValue ?? 0),
          role.id,
        ])}
      />
    );
  }

  if (activeTab === "ocorrencias") {
    return (
      <DataGrid
        empty="Nenhum tipo de ocorrencia Atlas encontrado."
        headers={["Ocorrencia", "Perfil", "ID legado"]}
        rows={data.atlas.occurrenceTypes.map((occurrenceType) => [
          occurrenceType.name,
          occurrenceType.profileId
            ? profileNameById.get(occurrenceType.profileId) ?? "-"
            : "-",
          occurrenceType.id,
        ])}
      />
    );
  }

  return (
    <DataGrid
      empty="Nenhum perfil de ocorrencia Atlas encontrado."
      headers={["Perfil", "ID legado"]}
      rows={data.atlas.occurrenceProfiles.map((profile) => [
        profile.name,
        profile.id,
      ])}
    />
  );
}

function getAtlasConfigTabCount(data: SetupData, activeTab: AtlasConfigTabId) {
  if (activeTab === "departamentos") {
    return data.atlas.departments.length;
  }

  if (activeTab === "cargos") {
    return data.atlas.roles.length;
  }

  if (activeTab === "ocorrencias") {
    return data.atlas.occurrenceTypes.length;
  }

  return data.atlas.occurrenceProfiles.length;
}

function getAtlasCreateLabel(activeTab: AtlasConfigTabId) {
  if (activeTab === "departamentos") {
    return "departamento";
  }

  if (activeTab === "cargos") {
    return "cargo";
  }

  if (activeTab === "ocorrencias") {
    return "ocorrencia";
  }

  return "perfil";
}

function HermesModuleConfigModal({
  data,
  isSaving,
  onClose,
  onCreateChannel,
  onEditChannel,
  onSyncMembers,
}: {
  data: SetupData;
  isSaving: boolean;
  onClose: () => void;
  onCreateChannel: (input: CreateHermesChannelInput) => Promise<void>;
  onEditChannel: (channel: SetupHermesChannel) => void;
  onSyncMembers: (
    channelId: string,
    participantUserIds: readonly string[],
  ) => Promise<void>;
}) {
  const activeDepartments = data.departments.filter(
    (department) => department.status === "active",
  );
  const fallbackDepartmentId =
    activeDepartments[0]?.id ?? data.departments[0]?.id ?? "";
  const [selectedDepartmentId, setSelectedDepartmentId] =
    useState(fallbackDepartmentId);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const memberCountByChannel = getMemberCountByChannel(data);
  const scopedChannels = data.channels.filter((channel) =>
    selectedDepartmentId ? channel.departmentId === selectedDepartmentId : true,
  );
  const selectedDepartment = data.departments.find(
    (department) => department.id === selectedDepartmentId,
  );
  const selectedChannel =
    scopedChannels.find((channel) => channel.id === selectedChannelId) ??
    scopedChannels[0];
  const usersForSelectedDepartment = getUsersForHermesDepartment(
    data,
    selectedDepartmentId,
  );

  useEffect(() => {
    if (!selectedDepartmentId && fallbackDepartmentId) {
      setSelectedDepartmentId(fallbackDepartmentId);
      return;
    }

    if (
      selectedDepartmentId &&
      !data.departments.some(
        (department) => department.id === selectedDepartmentId,
      )
    ) {
      setSelectedDepartmentId(fallbackDepartmentId);
    }
  }, [data.departments, fallbackDepartmentId, selectedDepartmentId]);

  useEffect(() => {
    if (scopedChannels.length === 0) {
      if (selectedChannelId) {
        setSelectedChannelId("");
      }

      return;
    }

    if (
      !selectedChannelId ||
      !scopedChannels.some((channel) => channel.id === selectedChannelId)
    ) {
      const firstChannel = scopedChannels[0];

      if (firstChannel) {
        setSelectedChannelId(firstChannel.id);
      }
    }
  }, [scopedChannels, selectedChannelId]);

  async function handleUpdateMembers(
    channel: SetupHermesChannel,
    participantUserIds: string[],
  ) {
    await onSyncMembers(channel.id, participantUserIds);
  }

  return (
    <SetupModal onClose={onClose} size="full" title="Setup Hermes">
      <div className="grid max-h-[82vh] overflow-auto lg:grid-cols-[18rem_minmax(0,1fr)_22rem]">
        <HermesDepartmentList
          data={data}
          onSelectDepartment={(departmentId) => {
            setSelectedDepartmentId(departmentId);
            setSelectedChannelId("");
          }}
          selectedDepartmentId={selectedDepartmentId}
        />
        <main className="grid content-start gap-4 border-b border-[#edf0f4] p-4 lg:border-b-0 lg:border-r">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="m-0 text-xs font-semibold uppercase text-[#667085]">
                Departamento
              </p>
              <h3 className="m-0 mt-1 text-lg font-semibold text-[#101820]">
                {selectedDepartment?.name ?? "Sem departamento"}
              </h3>
            </div>
            <Badge variant="neutral">{scopedChannels.length} canais</Badge>
          </div>
          <HermesCreateChannelPanel
            activeDepartmentId={selectedDepartmentId}
            data={data}
            isSaving={isSaving}
            onCreated={setSelectedChannelId}
            onSubmit={onCreateChannel}
          />
          <HermesChannelList
            channels={scopedChannels}
            memberCountByChannel={memberCountByChannel}
            onArchive={(channel) =>
              onEditChannel({ ...channel, status: "archived" })
            }
            onEdit={onEditChannel}
            onSelectChannel={setSelectedChannelId}
            selectedChannelId={selectedChannel?.id ?? ""}
          />
        </main>
        <HermesMembersPanel
          channel={selectedChannel}
          data={data}
          isSaving={isSaving}
          onEditChannel={onEditChannel}
          onSubmit={handleUpdateMembers}
          users={usersForSelectedDepartment}
        />
      </div>
    </SetupModal>
  );
}

function HermesDepartmentList({
  data,
  onSelectDepartment,
  selectedDepartmentId,
}: {
  data: SetupData;
  onSelectDepartment: (departmentId: string) => void;
  selectedDepartmentId: string;
}) {
  const departments = data.departments.filter(
    (department) => department.status === "active",
  );

  return (
    <aside className="border-b border-[#edf0f4] bg-[#f8fafc] p-4 lg:border-b-0 lg:border-r">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold text-[#101820]">
          Departamentos
        </h3>
        <Badge variant="neutral">{departments.length}</Badge>
      </div>
      {departments.length === 0 ? (
        <p className="m-0 rounded-md border border-dashed border-[#d9e0e7] bg-white p-4 text-sm text-[#667085]">
          Nenhum departamento ativo.
        </p>
      ) : (
        <div className="grid gap-2">
          {departments.map((department) => {
            const channels = data.channels.filter(
              (channel) => channel.departmentId === department.id,
            );
            const channelIds = new Set(channels.map((channel) => channel.id));
            const participantCount = new Set(
              data.channelMembers
                .filter((member) => channelIds.has(member.channelId))
                .map((member) => member.userId),
            ).size;
            const isSelected = selectedDepartmentId === department.id;

            return (
              <button
                className={`rounded-md border p-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
                  isSelected
                    ? "border-[#A07C3B] bg-white shadow-sm"
                    : "border-[#e5eaf0] bg-white/70 hover:bg-white"
                }`}
                key={department.id}
                onClick={() => onSelectDepartment(department.id)}
                type="button"
              >
                <span className="block text-sm font-semibold text-[#101820]">
                  {department.name}
                </span>
                <span className="mt-2 flex flex-wrap gap-2 text-xs text-[#667085]">
                  <span>{channels.length} canais</span>
                  <span>{participantCount} pessoas</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function HermesChannelList({
  channels,
  memberCountByChannel,
  onArchive,
  onEdit,
  onSelectChannel,
  selectedChannelId,
}: {
  channels: readonly SetupHermesChannel[];
  memberCountByChannel: ReadonlyMap<string, number>;
  onArchive: (channel: SetupHermesChannel) => void;
  onEdit: (channel: SetupHermesChannel) => void;
  onSelectChannel: (channelId: string) => void;
  selectedChannelId: string;
}) {
  if (channels.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[#d9e0e7] bg-white p-6 text-center">
        <h3 className="m-0 text-base font-semibold text-[#101820]">
          Nenhum canal
        </h3>
        <p className="m-0 mt-1 text-sm text-[#667085]">
          Crie o primeiro canal desse departamento.
        </p>
      </div>
    );
  }

  return (
    <section className="grid gap-3">
      {channels.map((channel) => {
        const isSelected = selectedChannelId === channel.id;

        return (
          <article
            className={`rounded-md border bg-white p-3 transition ${
              isSelected
                ? "border-[#A07C3B] shadow-sm"
                : "border-[#e5eaf0] hover:border-[#cfd8e3]"
            }`}
            key={channel.id}
          >
            <div className="flex items-start justify-between gap-3">
              <button
                aria-pressed={isSelected}
                className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={() => onSelectChannel(channel.id)}
                type="button"
              >
                <span className="block truncate text-sm font-semibold text-[#101820]">
                  {channel.name}
                </span>
                <span className="mt-1 flex flex-wrap gap-2 text-xs text-[#667085]">
                  <span>{getHermesChannelTypeLabel(channel.type)}</span>
                  <span>{channel.sectorName ?? "Departamento"}</span>
                  <span>
                    {memberCountByChannel.get(channel.id) ?? 0} pessoas
                  </span>
                </span>
              </button>
              <RowActions
                onArchive={() => onArchive(channel)}
                onEdit={() => onEdit(channel)}
              />
            </div>
            {channel.description ? (
              <p className="m-0 mt-2 line-clamp-2 text-xs text-[#667085]">
                {channel.description}
              </p>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

function HermesMembersPanel({
  channel,
  data,
  isSaving,
  onEditChannel,
  onSubmit,
  users,
}: {
  channel?: SetupHermesChannel;
  data: SetupData;
  isSaving: boolean;
  onEditChannel: (channel: SetupHermesChannel) => void;
  onSubmit: (
    channel: SetupHermesChannel,
    participantUserIds: string[],
  ) => Promise<void>;
  users: readonly SetupUser[];
}) {
  const memberIds = useMemo(
    () => (channel ? getHermesChannelMemberIds(data, channel.id) : []),
    [channel, data],
  );
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(memberIds);
  const listedUsers = mergeUsersById([
    ...users,
    ...data.users.filter((user) => memberIds.includes(user.id)),
  ]);

  useEffect(() => {
    setSelectedUserIds(memberIds);
  }, [memberIds]);

  if (!channel) {
    return (
      <aside className="bg-white p-4">
        <EmptyState description="Selecione ou crie um canal." title="Pessoas" />
      </aside>
    );
  }

  const currentChannel = channel;

  function toggleUser(userId: string) {
    const nextUserIds = selectedUserIds.includes(userId)
      ? selectedUserIds.filter((candidate) => candidate !== userId)
      : [...selectedUserIds, userId];

    setSelectedUserIds(nextUserIds);
    void onSubmit(currentChannel, nextUserIds);
  }

  async function handleSaveMembers() {
    await onSubmit(currentChannel, selectedUserIds);
  }

  return (
    <aside className="bg-white p-4">
      <div className="grid h-full content-start gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-xs font-semibold uppercase text-[#667085]">
              Pessoas
            </p>
            <h3 className="m-0 mt-1 truncate text-base font-semibold text-[#101820]">
              {currentChannel.name}
            </h3>
            <p className="m-0 mt-1 text-xs text-[#667085]">
              {selectedUserIds.length} vinculadas
            </p>
          </div>
          <Tooltip content="Editar canal">
            <button
              aria-label="Editar canal"
              className="grid h-8 w-8 place-items-center rounded-md text-[#667085] outline-none transition hover:bg-[#f3f6fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={() => onEditChannel(currentChannel)}
              type="button"
            >
              <Pencil aria-hidden="true" size={14} />
            </button>
          </Tooltip>
        </div>

        {listedUsers.length === 0 ? (
          <EmptyState description="Nenhum usuario ativo." title="Sem pessoas" />
        ) : (
          <div className="grid max-h-[44vh] gap-2 overflow-auto pr-1">
            {listedUsers.map((user) => (
              <label
                className="flex cursor-pointer items-start gap-3 rounded-md border border-[#e5eaf0] bg-[#f8fafc] p-3 text-sm transition hover:bg-white"
                key={user.id}
              >
                <input
                  checked={selectedUserIds.includes(user.id)}
                  className="mt-1 h-4 w-4 rounded border-[#cfd8e3] accent-[#A07C3B]"
                  disabled={isSaving}
                  onChange={() => toggleUser(user.id)}
                  type="checkbox"
                />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-[#101820]">
                    {user.displayName}
                  </span>
                  <span className="block truncate text-xs text-[#667085]">
                    {user.sectorName ?? user.departmentName ?? user.email}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#A07C3B] px-3 text-sm font-semibold text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:bg-[#d9e0e7] disabled:text-[#667085]"
          disabled={isSaving}
          onClick={() => {
            void handleSaveMembers();
          }}
          type="button"
        >
          <Link2 aria-hidden="true" size={15} />
          {isSaving ? "Salvando..." : "Salvar vinculos"}
        </button>
      </div>
    </aside>
  );
}

function ParticipantPicker({
  onChange,
  selectedUserIds,
  users,
}: {
  onChange: (userIds: string[]) => void;
  selectedUserIds: readonly string[];
  users: readonly SetupUser[];
}) {
  const selectedUserSet = new Set(selectedUserIds);

  if (users.length === 0) {
    return null;
  }

  return (
    <fieldset className="grid gap-2 rounded-md border border-[#d9e0e7] bg-white p-3">
      <legend className="px-1 text-xs font-semibold text-[#667085]">
        Participantes
      </legend>
      <div className="grid max-h-40 gap-2 overflow-auto md:grid-cols-2">
        {users.map((user) => (
          <label
            className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[#344054] hover:bg-[#f3f6fa]"
            key={user.id}
          >
            <input
              checked={selectedUserSet.has(user.id)}
              className="h-4 w-4 accent-[#A07C3B]"
              onChange={(event) => {
                if (event.target.checked) {
                  onChange([...selectedUserIds, user.id]);
                  return;
                }

                onChange(
                  selectedUserIds.filter((userId) => userId !== user.id),
                );
              }}
              type="checkbox"
            />
            <span className="min-w-0 truncate">{user.displayName}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function getMemberCountByChannel(data: SetupData) {
  const counts = new Map<string, number>();

  for (const member of data.channelMembers) {
    counts.set(member.channelId, (counts.get(member.channelId) ?? 0) + 1);
  }

  return counts;
}

function getHermesChannelMemberIds(data: SetupData, channelId: string) {
  return data.channelMembers
    .filter((member) => member.channelId === channelId)
    .map((member) => member.userId);
}

function createHermesChannelId({
  data,
  departmentId,
  name,
  sectorId,
  type,
}: {
  data: SetupData;
  departmentId: string;
  name: string;
  sectorId: string;
  type: CreateHermesChannelInput["type"];
}) {
  const nameSlug = slugify(name);
  const departmentSlug =
    data.departments.find((department) => department.id === departmentId)
      ?.slug ?? departmentId.slice(0, 8);
  const sectorSlug = sectorId
    ? (data.sectors.find((sector) => sector.id === sectorId)?.slug ??
      sectorId.slice(0, 8))
    : "";

  if (type === "sector_channel" && sectorSlug) {
    return `${departmentSlug}-${sectorSlug}-${nameSlug}`;
  }

  return `${departmentSlug}-${nameSlug}`;
}

function getUsersForHermesDepartment(data: SetupData, departmentId: string) {
  const activeUsers = data.users.filter((user) => user.status === "active");

  return [...activeUsers].sort((firstUser, secondUser) => {
    const firstPriority = firstUser.departmentId === departmentId ? 0 : 1;
    const secondPriority = secondUser.departmentId === departmentId ? 0 : 1;

    if (firstPriority !== secondPriority) {
      return firstPriority - secondPriority;
    }

    return firstUser.displayName.localeCompare(secondUser.displayName, "pt-BR");
  });
}

function mergeUsersById(users: readonly SetupUser[]) {
  const usersById = new Map<string, SetupUser>();

  for (const user of users) {
    usersById.set(user.id, user);
  }

  return [...usersById.values()];
}

function CreateOperationalUserModal({
  data,
  error,
  isSaving,
  onClose,
  onSubmit,
}: {
  data: SetupData;
  error?: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (input: CreateOperationalUserInput) => Promise<void>;
}) {
  const [departmentId, setDepartmentId] = useState(
    data.departments[0]?.id ?? "",
  );
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState<SetupOperationalProfileRole>("op1");
  const [sectorId, setSectorId] = useState("");
  const [status, setStatus] =
    useState<CreateOperationalUserInput["status"]>("active");
  const availableSectors = data.sectors.filter(
    (sector) => !departmentId || sector.departmentId === departmentId,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      departmentId,
      email,
      fullName,
      password,
      profile,
      sectorId,
      status,
    });
  }

  return (
    <div className="fixed inset-0 z-[var(--uix-z-modal)] grid place-items-center bg-black/25 px-4">
      <button
        aria-label="Fechar janela de novo usuario"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 w-full max-w-xl rounded-md border border-[#d9e0e7] bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[#edf0f4] px-5 py-4">
          <h2 className="m-0 text-base font-semibold text-[#101820]">
            Novo usuario
          </h2>
          <button
            aria-label="Fechar"
            className="grid h-8 w-8 place-items-center rounded-md text-[#667085] outline-none transition hover:bg-[#f3f6fa] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <form className="grid gap-4 p-5" onSubmit={handleSubmit}>
          {error ? (
            <div
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800"
              role="alert"
            >
              {error}
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <TextInput
              label="Nome completo"
              onChange={setFullName}
              value={fullName}
            />
            <TextInput
              inputType="email"
              label="E-mail"
              onChange={setEmail}
              value={email}
            />
            <TextInput
              inputType="password"
              label="Senha temporaria"
              onChange={setPassword}
              value={password}
            />
            <ProfileSelect onChange={setProfile} value={profile} />
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#667085]">
                Departamento
              </span>
              <select
                className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
                onChange={(event) => {
                  setDepartmentId(event.target.value);
                  setSectorId("");
                }}
                value={departmentId}
              >
                {data.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#667085]">
                Setor
              </span>
              <select
                className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
                onChange={(event) => setSectorId(event.target.value)}
                value={sectorId}
              >
                <option value="">Selecione</option>
                {availableSectors.map((sector) => (
                  <option key={sector.id} value={sector.id}>
                    {sector.name}
                  </option>
                ))}
              </select>
            </label>
            <UserStatusSelect onChange={setStatus} value={status} />
          </div>
          <FormActions
            disabled={
              !departmentId ||
              !email.trim() ||
              !fullName.trim() ||
              password.trim().length < 8 ||
              !sectorId ||
              isSaving
            }
            onCancel={onClose}
            submitLabel={isSaving ? "Criando..." : "Criar usuario"}
          />
        </form>
      </div>
    </div>
  );
}

function LinkUserAssignmentModal({
  data,
  isSaving,
  onClose,
  onSubmit,
  user,
}: {
  data: SetupData;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (input: LinkUserAssignmentInput) => Promise<void>;
  user: SetupUser;
}) {
  const [departmentId, setDepartmentId] = useState(
    user.departmentId ?? data.departments[0]?.id ?? "",
  );
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [email, setEmail] = useState(user.email);
  const [fullName, setFullName] = useState(user.displayName);
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState<SetupOperationalProfileRole>(
    user.operationalProfile,
  );
  const [sectorId, setSectorId] = useState(user.sectorId ?? "");
  const [status, setStatus] = useState<LinkUserAssignmentInput["status"]>(
    user.status === "disabled" ? "disabled" : "active",
  );
  const userId = user.id;
  const availableSectors = data.sectors.filter(
    (sector) => !departmentId || sector.departmentId === departmentId,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      avatarUrl,
      departmentId,
      email,
      fullName,
      password: password.trim() || undefined,
      profile,
      sectorId,
      status,
      userId,
    });
  }

  async function handleAvatarImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setAvatarError(null);

    if (file.type !== "image/png") {
      setAvatarError("Importe uma imagem PNG.");
      event.target.value = "";
      return;
    }

    setIsUploadingAvatar(true);

    try {
      const nextAvatarUrl = await uploadUserAvatar({ file, userId });
      setAvatarUrl(nextAvatarUrl);
    } catch (uploadError) {
      setAvatarError(
        uploadError instanceof Error
          ? uploadError.message
          : "Nao foi possivel importar a foto.",
      );
    } finally {
      setIsUploadingAvatar(false);
      event.target.value = "";
    }
  }

  return (
    <SetupModal onClose={onClose} title="Editar usuario">
      <form className="grid gap-3 p-5" onSubmit={handleSubmit}>
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput
            label="Nome completo"
            onChange={setFullName}
            value={fullName}
          />
          <TextInput
            inputType="email"
            label="E-mail"
            onChange={setEmail}
            value={email}
          />
          <TextInput
            inputType="password"
            label="Nova senha temporaria"
            onChange={setPassword}
            placeholder="Opcional; minimo 8 caracteres"
            value={password}
          />
          <div className="grid gap-1.5 md:col-span-2">
            <span className="text-xs font-semibold text-[#667085]">
              Foto do perfil
            </span>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md border border-[#d9e0e7] bg-[#fafbfc] p-3">
              <span
                aria-label={`Foto de ${fullName}`}
                className="grid h-12 w-12 place-items-center rounded-full bg-[#101820] bg-cover bg-center text-sm font-semibold text-white"
                role="img"
                style={
                  avatarUrl
                    ? {
                        backgroundImage: `url(${avatarUrl})`,
                      }
                    : undefined
                }
              >
                {avatarUrl ? null : fullName.trim().charAt(0).toUpperCase()}
              </span>
              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] outline-none transition hover:border-[#A07C3B]/45 hover:bg-[#fbf7ef]">
                <Upload aria-hidden="true" size={15} />
                {isUploadingAvatar ? "Importando..." : "Importar PNG"}
                <input
                  accept="image/png"
                  className="sr-only"
                  disabled={isUploadingAvatar || isSaving}
                  onChange={handleAvatarImport}
                  type="file"
                />
              </label>
            </div>
            {avatarError ? (
              <p className="m-0 text-xs font-semibold text-red-700">
                {avatarError}
              </p>
            ) : (
              <p className="m-0 text-xs text-[#667085]">
                Use um PNG quadrado de ate 2 MB.
              </p>
            )}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-[#667085]">
              Departamento
            </span>
            <select
              className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
              onChange={(event) => {
                setDepartmentId(event.target.value);
                setSectorId("");
              }}
              value={departmentId}
            >
              {data.departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-[#667085]">Setor</span>
            <select
              className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
              onChange={(event) => setSectorId(event.target.value)}
              value={sectorId}
            >
              <option value="">Selecione</option>
              {availableSectors.map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.name}
                </option>
              ))}
            </select>
          </label>
          <ProfileSelect onChange={setProfile} value={profile} />
          <UserStatusSelect onChange={setStatus} value={status} />
        </div>
        <FormActions
          disabled={
            !userId ||
            !fullName.trim() ||
            !email.trim() ||
            !departmentId ||
            !sectorId ||
            (password.trim().length > 0 && password.trim().length < 8) ||
            isUploadingAvatar ||
            isSaving
          }
          onCancel={onClose}
          submitLabel={isSaving ? "Salvando..." : "Salvar usuario"}
        />
      </form>
    </SetupModal>
  );
}

function SetupFormCard({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="rounded-md border border-[#e5eaf0] bg-[#f8fafc] p-4">
      <h2 className="m-0 mb-3 text-sm font-semibold text-[#101820]">{title}</h2>
      {children}
    </div>
  );
}

function TextInput({
  inputType = "text",
  label,
  onChange,
  placeholder,
  value,
}: {
  inputType?: "email" | "password" | "text" | "url";
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-[#667085]">{label}</span>
      <input
        className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none placeholder:text-[#98a2b3] focus:border-[#A07C3B]"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={inputType}
        value={value}
      />
    </label>
  );
}

function ProfileSelect({
  onChange,
  value,
}: {
  onChange: (value: SetupOperationalProfileRole) => void;
  value: SetupOperationalProfileRole;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-[#667085]">Perfil</span>
      <select
        className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
        onChange={(event) =>
          onChange(event.target.value as SetupOperationalProfileRole)
        }
        value={value}
      >
        <option value="op1">op1</option>
        <option value="op2">op2</option>
        <option value="op3">op3</option>
        <option value="ldr">ldr</option>
        <option value="cdr">cdr</option>
        <option value="adm">adm</option>
      </select>
    </label>
  );
}

function UserStatusSelect({
  onChange,
  value,
}: {
  onChange: (value: CreateOperationalUserInput["status"]) => void;
  value: CreateOperationalUserInput["status"];
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-[#667085]">Status</span>
      <select
        className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
        onChange={(event) =>
          onChange(event.target.value as CreateOperationalUserInput["status"])
        }
        value={value}
      >
        <option value="active">active</option>
        <option value="disabled">disabled</option>
      </select>
    </label>
  );
}

function TextAreaInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-[#667085]">{label}</span>
      <textarea
        className="min-h-20 resize-y rounded-md border border-[#d9e0e7] bg-white px-3 py-2 text-sm text-[#101820] outline-none placeholder:text-[#98a2b3] focus:border-[#A07C3B]"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function StatusSelect({
  onChange,
  value,
}: {
  onChange: (value: SetupRecordStatus) => void;
  value: SetupRecordStatus;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-[#667085]">Status</span>
      <select
        className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
        onChange={(event) => onChange(event.target.value as SetupRecordStatus)}
        value={value}
      >
        <option value="active">Ativo</option>
        <option value="disabled">Inativo</option>
        <option value="archived">Arquivado</option>
      </select>
    </label>
  );
}

function FormActions({
  disabled,
  onCancel,
  submitLabel = "Salvar",
}: {
  disabled: boolean;
  onCancel: () => void;
  submitLabel?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-2">
      <button
        className="inline-flex h-10 items-center justify-center rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#344054] outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
        onClick={onCancel}
        type="button"
      >
        Cancelar
      </button>
      <button
        className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#A07C3B] px-3 text-sm font-semibold text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:bg-[#d9e0e7] disabled:text-[#667085]"
        disabled={disabled}
        type="submit"
      >
        <Plus aria-hidden="true" size={15} />
        {submitLabel}
      </button>
    </div>
  );
}

function getFriendlySetupError(error: unknown, action: "load" | "save") {
  if (
    error instanceof Error &&
    error.message.includes("Nao foi possivel conectar ao Supabase")
  ) {
    return error.message;
  }

  if (error instanceof Error && action === "save") {
    return error.message || "Nao foi possivel salvar. Tente novamente.";
  }

  if (error instanceof Error) {
    return "Nao foi possivel carregar os dados. Tente atualizar.";
  }

  return "Nao foi possivel salvar. Tente novamente.";
}

function getHermesChannelTypeLabel(type: SetupHermesChannel["type"]) {
  if (type === "sector_channel") {
    return "Canal de setor";
  }

  if (type === "department_channel") {
    return "Canal de departamento";
  }

  return "Grupo privado";
}

function formatSetupCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    style: "currency",
  }).format(value);
}

function parseAtlasCurrencyInput(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  const normalizedValue = trimmedValue.replace(/\./g, "").replace(",", ".");
  const parsedValue = Number(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

const emptySetupData: SetupData = {
  atlas: {
    departments: [],
    occurrenceProfiles: [],
    occurrenceTypes: [],
    roles: [],
  },
  channelMembers: [],
  channels: [],
  departmentModules: [],
  departments: [],
  modules: [],
  permissions: [],
  sectors: [],
  users: [],
};

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
