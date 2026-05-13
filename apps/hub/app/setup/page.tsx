"use client";

import { HubShell } from "@/layouts/hub-shell";
import {
  createDepartment,
  createOperationalUser,
  createPulseXChannel,
  createSector,
  linkUserAssignment,
  loadSetupData,
  updateDepartment,
  updatePulseXChannel,
  updateSector,
} from "@/lib/setup/data";
import type {
  CreateDepartmentInput,
  CreateOperationalUserInput,
  CreatePulseXChannelInput,
  CreateSectorInput,
  LinkUserAssignmentInput,
  SetupData,
  SetupDepartment,
  SetupOperationalProfileRole,
  SetupPulseXChannel,
  SetupRecordStatus,
  SetupSector,
  SetupUser,
  UpdateDepartmentInput,
  UpdatePulseXChannelInput,
  UpdateSectorInput,
} from "@/lib/setup/types";
import { useAuth } from "@/providers/auth-provider";
import { Badge, EmptyState, Surface, Tooltip, WorkspaceLayout } from "@repo/uix";
import {
  Building2,
  Archive,
  KeyRound,
  Layers3,
  Link2,
  MessageSquareText,
  MoreVertical,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  X,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

type SetupTabId =
  | "usuarios"
  | "departamentos"
  | "setores"
  | "modulos"
  | "permissoes"
  | "pulsex";

type SetupActionId =
  | "new-channel"
  | "new-department"
  | "new-sector"
  | "new-user";

type SetupEditTarget =
  | { record: SetupDepartment; type: "department" }
  | { record: SetupSector; type: "sector" }
  | { record: SetupPulseXChannel; type: "channel" };

const setupTabs = [
  { icon: Users, id: "usuarios", label: "Usuarios" },
  { icon: Building2, id: "departamentos", label: "Departamentos" },
  { icon: Layers3, id: "setores", label: "Setores" },
  { icon: PackageCheck, id: "modulos", label: "Modulos" },
  { icon: KeyRound, id: "permissoes", label: "Permissoes" },
  { icon: MessageSquareText, id: "pulsex", label: "PulseX" },
] as const satisfies readonly {
  icon: typeof Users;
  id: SetupTabId;
  label: string;
}[];

export default function SetupPage() {
  const { hubUser, profileStatus } = useAuth();

  if (profileStatus === "loading" && hubUser?.role !== "admin") {
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

  if (!hubUser || hubUser.role !== "admin") {
    return (
      <HubShell layoutMode="module">
        <WorkspaceLayout>
          <Surface bordered className="border-[#d9e0e7] bg-white p-6">
            <EmptyState
              description="Entre com um perfil admin para visualizar usuarios, departamentos, setores e permissoes."
              title="Acesso negado"
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

function SetupWorkspace() {
  const [activeTab, setActiveTab] = useState<SetupTabId>("usuarios");
  const [data, setData] = useState<SetupData>(emptySetupData);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<SetupActionId | null>(null);
  const [editTarget, setEditTarget] = useState<SetupEditTarget | null>(null);
  const [linkUserTarget, setLinkUserTarget] = useState<SetupUser | null>(null);
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
      { label: "canais PulseX", value: data.channels.length },
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

  async function handleCreateOperationalUser(input: CreateOperationalUserInput) {
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

  async function handleCreatePulseXChannel(input: CreatePulseXChannelInput) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await createPulseXChannel(input);
      await refreshSetupData();
      setActiveTab("pulsex");
      setActiveAction(null);
      setSuccess("Canal PulseX cadastrado.");
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
      setSuccess("Usuario vinculado ao setor.");
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

  async function handleUpdatePulseXChannel(input: UpdatePulseXChannelInput) {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await updatePulseXChannel(input);
      await refreshSetupData();
      setEditTarget(null);
      setSuccess("Canal PulseX atualizado.");
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <WorkspaceLayout
      className="bg-[#f3f6fa]"
    >
      <section className="grid grid-cols-4 gap-3">
        {summary.map((item) => (
          <Surface bordered className="border-[#d9e0e7] bg-white p-4" key={item.label}>
            <p className="m-0 text-2xl font-semibold text-[#101820]">{item.value}</p>
            <p className="m-0 mt-1 text-xs text-[#667085]">{item.label}</p>
          </Surface>
        ))}
      </section>

      {error ? (
        <Surface bordered className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <span className="inline-flex items-center gap-2 font-semibold">
            <ShieldAlert aria-hidden="true" size={16} />
            {error}
          </span>
        </Surface>
      ) : null}

      {success ? (
        <Surface bordered className="border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
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
            <EmptyState description="Buscando dados reais do Supabase." title="Carregando Setup" />
          ) : (
            <SetupTabContent
              activeTab={activeTab}
              data={data}
              activeAction={activeAction}
              isSaving={isSaving}
              onCloseAction={() => setActiveAction(null)}
              onCreateDepartment={handleCreateDepartment}
              onCreateOperationalUser={handleCreateOperationalUser}
              onCreatePulseXChannel={handleCreatePulseXChannel}
              onCreateSector={handleCreateSector}
              onEditRecord={setEditTarget}
              onLinkUser={setLinkUserTarget}
              onOpenAction={setActiveAction}
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
          onUpdatePulseXChannel={handleUpdatePulseXChannel}
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
    </WorkspaceLayout>
  );
}

function SetupTabContent({
  activeTab,
  activeAction,
  data,
  isSaving,
  onCloseAction,
  onCreateDepartment,
  onCreateOperationalUser,
  onCreatePulseXChannel,
  onCreateSector,
  onEditRecord,
  onLinkUser,
  onOpenAction,
}: {
  activeTab: SetupTabId;
  activeAction: SetupActionId | null;
  data: SetupData;
  isSaving: boolean;
  onCloseAction: () => void;
  onCreateDepartment: (input: CreateDepartmentInput) => Promise<void>;
  onCreateOperationalUser: (input: CreateOperationalUserInput) => Promise<void>;
  onCreatePulseXChannel: (input: CreatePulseXChannelInput) => Promise<void>;
  onCreateSector: (input: CreateSectorInput) => Promise<void>;
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
            isSaving={isSaving}
            onClose={onCloseAction}
            onSubmit={onCreateOperationalUser}
          />
        ) : null}
        <DataGrid
          empty="Nenhum usuario sincronizado em hub_users."
          headers={["Nome", "Email", "Perfil", "Departamento", "Setor", "Status", "Acoes"]}
          rows={data.users.map((user) => [
            user.displayName,
            user.email,
            user.operationalProfile,
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
              onEdit={() => onEditRecord({ record: department, type: "department" })}
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
          headers={["Modulo", "Rota", "Status", "Departamentos liberados"]}
          rows={data.modules.map((module) => [
            module.name,
            module.basePath,
            module.status,
            data.departmentModules.filter(
              (access) => access.moduleId === module.id && access.status === "enabled",
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

  return (
    <TabPanel
      action={
        <ActionButton
          label="Novo canal"
          onClick={() => onOpenAction("new-channel")}
        />
      }
      title="PulseX"
    >
      {activeAction === "new-channel" ? (
        <CreatePulseXChannelForm
          data={data}
          isSaving={isSaving}
          onCancel={onCloseAction}
          onSubmit={onCreatePulseXChannel}
        />
      ) : null}
      <DataGrid
        empty="Nenhum canal PulseX cadastrado."
        headers={["Canal", "Tipo", "Departamento", "Setor", "Status", "Acoes"]}
        rows={data.channels.map((channel) => [
          channel.name,
          getPulseXChannelTypeLabel(channel.type),
          channel.departmentName ?? "-",
          channel.sectorName ?? "-",
          channel.status,
          <RowActions
            key={channel.id}
            onArchive={() =>
              onEditRecord({
                record: { ...channel, status: "archived" },
                type: "channel",
              })
            }
            onEdit={() => onEditRecord({ record: channel, type: "channel" })}
          />,
        ])}
      />
    </TabPanel>
  );
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
        <FormActions
          disabled={!name.trim() || isSaving}
          onCancel={onCancel}
        />
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
          <span className="text-xs font-semibold text-[#667085]">Departamento</span>
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

function CreatePulseXChannelForm({
  data,
  isSaving,
  onCancel,
  onSubmit,
}: {
  data: SetupData;
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: (input: CreatePulseXChannelInput) => Promise<void>;
}) {
  const [departmentId, setDepartmentId] = useState(data.departments[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [status, setStatus] = useState<SetupRecordStatus>("active");
  const [type, setType] = useState<CreatePulseXChannelInput["type"]>("sector_channel");
  const availableSectors = data.sectors.filter(
    (sector) => !departmentId || sector.departmentId === departmentId,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      departmentId,
      description,
      id: slugify(name),
      name,
      sectorId: sectorId || undefined,
      status,
      type,
    });
    setDescription("");
    setName("");
    setSectorId("");
    setStatus("active");
  }

  return (
    <SetupFormCard title="Novo canal">
      <form className="grid gap-3" onSubmit={handleSubmit}>
        <TextInput label="Nome" onChange={setName} value={name} />
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#667085]">Departamento</span>
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
              setType(event.target.value as CreatePulseXChannelInput["type"])
            }
            value={type}
          >
            <option value="sector_channel">Canal de setor</option>
            <option value="department_channel">Canal de departamento</option>
            <option value="private_group">Grupo privado</option>
          </select>
        </label>
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
                <td className="px-3 py-3 text-[#344054]" key={String(cellIndex)}>
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
        title={label}
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
          title="Editar"
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
          title="Arquivar"
          type="button"
        >
          <Archive aria-hidden="true" size={14} />
        </button>
      </Tooltip>
      <MoreVertical aria-hidden="true" className="text-[#98a2b3]" size={14} />
    </div>
  );
}

function UserAssignmentAction({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex items-center justify-end">
      <Tooltip content="Vincular setor">
        <button
          aria-label="Vincular setor"
          className="grid h-8 w-8 place-items-center rounded-md text-[#667085] outline-none transition hover:bg-[#f3f6fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={onClick}
          title="Vincular setor"
          type="button"
        >
          <Link2 aria-hidden="true" size={14} />
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
  onUpdatePulseXChannel,
  onUpdateSector,
  target,
}: {
  data: SetupData;
  isSaving: boolean;
  onClose: () => void;
  onUpdateDepartment: (input: UpdateDepartmentInput) => Promise<void>;
  onUpdatePulseXChannel: (input: UpdatePulseXChannelInput) => Promise<void>;
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
    <EditPulseXChannelModal
      data={data}
      isSaving={isSaving}
      onClose={onClose}
      onSubmit={onUpdatePulseXChannel}
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
          <span className="text-xs font-semibold text-[#667085]">Departamento</span>
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

function EditPulseXChannelModal({
  data,
  isSaving,
  onClose,
  onSubmit,
  record,
}: {
  data: SetupData;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (input: UpdatePulseXChannelInput) => Promise<void>;
  record: SetupPulseXChannel;
}) {
  const [departmentId, setDepartmentId] = useState(record.departmentId ?? "");
  const [name, setName] = useState(record.name);
  const [sectorId, setSectorId] = useState(record.sectorId ?? "");
  const [status, setStatus] = useState<SetupRecordStatus>(record.status);
  const [type, setType] = useState<SetupPulseXChannel["type"]>(record.type);
  const availableSectors = data.sectors.filter(
    (sector) => !departmentId || sector.departmentId === departmentId,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      departmentId,
      id: record.id,
      name,
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
          <span className="text-xs font-semibold text-[#667085]">Departamento</span>
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
              setType(event.target.value as SetupPulseXChannel["type"])
            }
            value={type}
          >
            <option value="sector_channel">Canal de setor</option>
            <option value="department_channel">Canal de departamento</option>
            <option value="private_group">Grupo privado</option>
          </select>
        </label>
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

function SetupModal({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-[var(--uix-z-modal)] grid place-items-center bg-black/25 px-4">
      <div className="w-full max-w-xl rounded-md border border-[#d9e0e7] bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[#edf0f4] px-5 py-4">
          <h2 className="m-0 text-base font-semibold text-[#101820]">{title}</h2>
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

function CreateOperationalUserModal({
  data,
  isSaving,
  onClose,
  onSubmit,
}: {
  data: SetupData;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (input: CreateOperationalUserInput) => Promise<void>;
}) {
  const [departmentId, setDepartmentId] = useState(data.departments[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState<SetupOperationalProfileRole>("op1");
  const [sectorId, setSectorId] = useState("");
  const [status, setStatus] = useState<CreateOperationalUserInput["status"]>("active");
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
      <div className="w-full max-w-xl rounded-md border border-[#d9e0e7] bg-white shadow-2xl">
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
          <div className="grid gap-3 md:grid-cols-2">
            <TextInput label="Nome completo" onChange={setFullName} value={fullName} />
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
              <span className="text-xs font-semibold text-[#667085]">Departamento</span>
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
  const [profile, setProfile] = useState<SetupOperationalProfileRole>(
    user.operationalProfile,
  );
  const [sectorId, setSectorId] = useState(user.sectorId ?? "");
  const [status, setStatus] = useState<LinkUserAssignmentInput["status"]>(
    user.status === "disabled" ? "disabled" : "active",
  );
  const [userId, setUserId] = useState(user.id);
  const availableSectors = data.sectors.filter(
    (sector) => !departmentId || sector.departmentId === departmentId,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      departmentId,
      profile,
      sectorId,
      status,
      userId,
    });
  }

  return (
    <SetupModal onClose={onClose} title="Vincular setor">
      <form className="grid gap-3 p-5" onSubmit={handleSubmit}>
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold text-[#667085]">Usuario</span>
          <select
            className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]"
            onChange={(event) => {
              const nextUser = data.users.find(
                (candidate) => candidate.id === event.target.value,
              );
              setUserId(event.target.value);
              if (nextUser) {
                setDepartmentId(nextUser.departmentId ?? data.departments[0]?.id ?? "");
                setSectorId(nextUser.sectorId ?? "");
                setProfile(nextUser.operationalProfile);
                setStatus(nextUser.status === "disabled" ? "disabled" : "active");
              }
            }}
            value={userId}
          >
            {data.users.map((setupUser) => (
              <option key={setupUser.id} value={setupUser.id}>
                {setupUser.displayName} · {setupUser.email}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-[#667085]">Departamento</span>
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
          disabled={!userId || !departmentId || !sectorId || isSaving}
          onCancel={onClose}
          submitLabel={isSaving ? "Salvando..." : "Vincular setor"}
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
  inputType?: "email" | "password" | "text";
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
  if (error instanceof Error && action === "save") {
    return error.message || "Nao foi possivel salvar. Tente novamente.";
  }

  if (error instanceof Error) {
    return "Nao foi possivel carregar os dados. Tente atualizar.";
  }

  return "Nao foi possivel salvar. Tente novamente.";
}

function getPulseXChannelTypeLabel(type: SetupPulseXChannel["type"]) {
  if (type === "sector_channel") {
    return "Canal de setor";
  }

  if (type === "department_channel") {
    return "Canal de departamento";
  }

  return "Grupo privado";
}

const emptySetupData: SetupData = {
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
