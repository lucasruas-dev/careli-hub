"use client";

import { HubShell } from "@/layouts/hub-shell";
import {
  createDepartment,
  createPulseXChannel,
  createSector,
  loadSetupData,
} from "@/lib/setup/data";
import type {
  CreateDepartmentInput,
  CreatePulseXChannelInput,
  CreateSectorInput,
  SetupData,
  SetupRecordStatus,
} from "@/lib/setup/types";
import { useAuth } from "@/providers/auth-provider";
import { Badge, EmptyState, Surface, WorkspaceLayout } from "@repo/uix";
import {
  Building2,
  KeyRound,
  Layers3,
  MessageSquareText,
  PackageCheck,
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
  const { hubUser } = useAuth();

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
  const [data, setData] = useState<SetupData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<SetupActionId | null>(null);
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
      { label: "usuarios", value: data?.users.length ?? 0 },
      { label: "departamentos", value: data?.departments.length ?? 0 },
      { label: "setores", value: data?.sectors.length ?? 0 },
      { label: "canais PulseX", value: data?.channels.length ?? 0 },
    ],
    [data],
  );

  async function handleCreateDepartment(input: CreateDepartmentInput) {
    setIsSaving(true);
    setError(null);

    try {
      await createDepartment(input);
      await refreshSetupData();
      setActiveTab("departamentos");
      setActiveAction(null);
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateSector(input: CreateSectorInput) {
    setIsSaving(true);
    setError(null);

    try {
      await createSector(input);
      await refreshSetupData();
      setActiveTab("setores");
      setActiveAction(null);
    } catch (saveError) {
      setError(getFriendlySetupError(saveError, "save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreatePulseXChannel(input: CreatePulseXChannelInput) {
    setIsSaving(true);
    setError(null);

    try {
      await createPulseXChannel(input);
      await refreshSetupData();
      setActiveTab("pulsex");
      setActiveAction(null);
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
                }}
                type="button"
              >
                <TabIcon aria-hidden="true" size={15} />
                {tab.label}
              </button>
            );
          })}
          </div>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onClick={() => void refreshSetupData()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={15} />
            Atualizar
          </button>
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
              onCreatePulseXChannel={handleCreatePulseXChannel}
              onCreateSector={handleCreateSector}
              onOpenAction={setActiveAction}
            />
          )}
        </div>
      </Surface>
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
  onCreatePulseXChannel,
  onCreateSector,
  onOpenAction,
}: {
  activeTab: SetupTabId;
  activeAction: SetupActionId | null;
  data: SetupData | null;
  isSaving: boolean;
  onCloseAction: () => void;
  onCreateDepartment: (input: CreateDepartmentInput) => Promise<void>;
  onCreatePulseXChannel: (input: CreatePulseXChannelInput) => Promise<void>;
  onCreateSector: (input: CreateSectorInput) => Promise<void>;
  onOpenAction: (action: SetupActionId) => void;
}) {
  if (!data) {
    return (
      <EmptyState
        description="Atualize a conexao e tente novamente."
        title="Dados indisponiveis"
      />
    );
  }

  if (activeTab === "usuarios") {
    return (
      <TabPanel
        action={
          <ActionButton onClick={() => onOpenAction("new-user")}>
            Novo usuario
          </ActionButton>
        }
        title="Usuarios"
      >
        {activeAction === "new-user" ? (
          <UserInfoModal
            data={data}
            onClose={onCloseAction}
          />
        ) : null}
        <DataGrid
          empty="Nenhum usuario sincronizado em hub_users."
          headers={["Nome", "Email", "Role", "Status"]}
          rows={data.users.map((user) => [
            user.displayName,
            user.email,
            user.role,
            user.status,
          ])}
        />
      </TabPanel>
    );
  }

  if (activeTab === "departamentos") {
    return (
      <TabPanel
        action={
          <ActionButton onClick={() => onOpenAction("new-department")}>
            Novo departamento
          </ActionButton>
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
          headers={["Departamento", "Descricao", "Status"]}
          rows={data.departments.map((department) => [
            department.name,
            department.description ?? "-",
            department.status,
          ])}
        />
      </TabPanel>
    );
  }

  if (activeTab === "setores") {
    return (
      <TabPanel
        action={
          <ActionButton onClick={() => onOpenAction("new-sector")}>
            Novo setor
          </ActionButton>
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
          headers={["Setor", "Departamento", "Descricao", "Status"]}
          rows={data.sectors.map((sector) => [
            sector.name,
            sector.departmentName ?? "-",
            sector.description ?? "-",
            sector.status,
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
        <ActionButton onClick={() => onOpenAction("new-channel")}>
          Novo canal
        </ActionButton>
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
        headers={["Canal", "Tipo", "Departamento", "Setor", "Status"]}
        rows={data.channels.map((channel) => [
          channel.name,
          channel.kind,
          channel.departmentName ?? "-",
          channel.sectorName ?? "-",
          channel.status,
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
  const [kind, setKind] = useState<CreatePulseXChannelInput["kind"]>("sector");
  const [name, setName] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [status, setStatus] = useState<SetupRecordStatus>("active");
  const availableSectors = data.sectors.filter(
    (sector) => !departmentId || sector.departmentId === departmentId,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({
      departmentId,
      description,
      id: slugify(name),
      kind,
      name,
      sectorId: sectorId || undefined,
      status,
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
              setKind(event.target.value as CreatePulseXChannelInput["kind"])
            }
            value={kind}
          >
            <option value="sector">Setor</option>
            <option value="department">Departamento</option>
            <option value="direct">Direta</option>
            <option value="system">Sistema</option>
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
                    <Badge variant="neutral">{cell}</Badge>
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
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-9 items-center gap-2 rounded-md bg-[#A07C3B] px-3 text-sm font-semibold text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      onClick={onClick}
      type="button"
    >
      <Plus aria-hidden="true" size={15} />
      {children}
    </button>
  );
}

function UserInfoModal({
  data,
  onClose,
}: {
  data: SetupData;
  onClose: () => void;
}) {
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
        <div className="grid gap-4 p-5">
          <p className="m-0 text-sm leading-6 text-[#344054]">
            Usuarios sao criados pelo Supabase Auth. Depois, vincule o usuario
            a um setor.
          </p>
          <div className="grid gap-3 rounded-md border border-[#edf0f4] bg-[#f8fafc] p-4">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#667085]">
                Usuario existente
              </span>
              <select className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]">
                {data.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName} / {user.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold text-[#667085]">Setor</span>
              <select className="h-10 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none focus:border-[#A07C3B]">
                {data.sectors.map((sector) => (
                  <option key={sector.id} value={sector.id}>
                    {sector.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="inline-flex h-10 cursor-not-allowed items-center justify-center rounded-md bg-[#d9e0e7] px-3 text-sm font-semibold text-[#667085]"
              disabled
              type="button"
            >
              Vincular em breve
            </button>
          </div>
        </div>
      </div>
    </div>
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
  label,
  onChange,
  placeholder,
  value,
}: {
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
        value={value}
      />
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
}: {
  disabled: boolean;
  onCancel: () => void;
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
        Salvar
      </button>
    </div>
  );
}

function getFriendlySetupError(error: unknown, action: "load" | "save") {
  if (error instanceof Error && action === "save") {
    return "Nao foi possivel salvar. Tente novamente.";
  }

  if (error instanceof Error) {
    return "Nao foi possivel carregar os dados. Tente atualizar.";
  }

  return "Nao foi possivel salvar. Tente novamente.";
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
