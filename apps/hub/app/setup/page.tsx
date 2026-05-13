"use client";

import { HubShell } from "@/layouts/hub-shell";
import { loadSetupData, saveDepartment, saveSector } from "@/lib/setup/data";
import type { SetupData } from "@/lib/setup/types";
import { useAuth } from "@/providers/auth-provider";
import { Badge, EmptyState, Surface, WorkspaceHeader, WorkspaceLayout } from "@repo/uix";
import {
  Building2,
  KeyRound,
  Layers3,
  MessageSquareText,
  PackageCheck,
  Plus,
  RefreshCw,
  ShieldAlert,
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
        <WorkspaceLayout
          header={
            <WorkspaceHeader
              description="Setup Central e restrito a administradores do Hub."
              eyebrow="Setup"
              title="Acesso administrativo"
            />
          }
        >
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
          ? setupError.message
          : "Nao foi possivel carregar o Setup.",
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

  async function handleCreateDepartment(input: { name: string; slug: string }) {
    setIsSaving(true);
    setError(null);

    try {
      await saveDepartment(input);
      await refreshSetupData();
      setActiveTab("departamentos");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Falha ao salvar.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateSector(input: {
    departmentId: string;
    name: string;
    slug: string;
  }) {
    setIsSaving(true);
    setError(null);

    try {
      await saveSector(input);
      await refreshSetupData();
      setActiveTab("setores");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Falha ao salvar.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <WorkspaceLayout
      className="bg-[#f3f6fa]"
      header={
        <WorkspaceHeader
          actions={
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#101820] outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={() => void refreshSetupData()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={15} />
              Atualizar
            </button>
          }
          description="Configuracao global usada pelos modulos do Hub, incluindo PulseX."
          eyebrow="Setup Central"
          title="Estrutura operacional"
        />
      }
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
        <div className="flex flex-wrap gap-1 border-b border-[#e5eaf0] p-2">
          {setupTabs.map((tab) => {
            const TabIcon = tab.icon;

            return (
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold text-[#667085] outline-none transition hover:bg-[#f3f6fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B] data-[active=true]:bg-[#101820] data-[active=true]:text-white"
                data-active={activeTab === tab.id}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <TabIcon aria-hidden="true" size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="p-5">
          {isLoading ? (
            <EmptyState description="Buscando dados reais do Supabase." title="Carregando Setup" />
          ) : (
            <SetupTabContent
              activeTab={activeTab}
              data={data}
              isSaving={isSaving}
              onCreateDepartment={handleCreateDepartment}
              onCreateSector={handleCreateSector}
            />
          )}
        </div>
      </Surface>
    </WorkspaceLayout>
  );
}

function SetupTabContent({
  activeTab,
  data,
  isSaving,
  onCreateDepartment,
  onCreateSector,
}: {
  activeTab: SetupTabId;
  data: SetupData | null;
  isSaving: boolean;
  onCreateDepartment: (input: { name: string; slug: string }) => Promise<void>;
  onCreateSector: (input: {
    departmentId: string;
    name: string;
    slug: string;
  }) => Promise<void>;
}) {
  if (!data) {
    return <EmptyState description="Configure o Supabase para carregar dados reais." title="Sem dados" />;
  }

  if (activeTab === "usuarios") {
    return (
      <DataGrid
        empty="Nenhum usuario sincronizado em hub_users."
        headers={["Nome", "Email", "Perfil", "Departamento", "Status"]}
        rows={data.users.map((user) => [
          user.displayName,
          user.email,
          user.role,
          [user.departmentName, user.sectorName].filter(Boolean).join(" / ") || "-",
          user.status,
        ])}
      />
    );
  }

  if (activeTab === "departamentos") {
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <DataGrid
          empty="Nenhum departamento cadastrado."
          headers={["Departamento", "Slug", "Status"]}
          rows={data.departments.map((department) => [
            department.name,
            department.slug,
            department.status,
          ])}
        />
        <CreateDepartmentForm isSaving={isSaving} onSubmit={onCreateDepartment} />
      </div>
    );
  }

  if (activeTab === "setores") {
    return (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <DataGrid
          empty="Nenhum setor cadastrado."
          headers={["Setor", "Departamento", "Slug", "Status"]}
          rows={data.sectors.map((sector) => [
            sector.name,
            sector.departmentName ?? "-",
            sector.slug,
            sector.status,
          ])}
        />
        <CreateSectorForm
          departments={data.departments}
          isSaving={isSaving}
          onSubmit={onCreateSector}
        />
      </div>
    );
  }

  if (activeTab === "modulos") {
    return (
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
    );
  }

  if (activeTab === "permissoes") {
    return (
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
    );
  }

  return (
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
  );
}

function CreateDepartmentForm({
  isSaving,
  onSubmit,
}: {
  isSaving: boolean;
  onSubmit: (input: { name: string; slug: string }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({ name, slug: slug || slugify(name) });
    setName("");
    setSlug("");
  }

  return (
    <SetupFormCard title="Novo departamento">
      <form className="grid gap-3" onSubmit={handleSubmit}>
        <TextInput label="Nome" onChange={setName} value={name} />
        <TextInput label="Slug" onChange={setSlug} placeholder={slugify(name)} value={slug} />
        <SubmitButton disabled={!name.trim() || isSaving} />
      </form>
    </SetupFormCard>
  );
}

function CreateSectorForm({
  departments,
  isSaving,
  onSubmit,
}: {
  departments: SetupData["departments"];
  isSaving: boolean;
  onSubmit: (input: {
    departmentId: string;
    name: string;
    slug: string;
  }) => Promise<void>;
}) {
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit({ departmentId, name, slug: slug || slugify(name) });
    setName("");
    setSlug("");
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
        <TextInput label="Slug" onChange={setSlug} placeholder={slugify(name)} value={slug} />
        <SubmitButton disabled={!departmentId || !name.trim() || isSaving} />
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
    return <EmptyState description={empty} title="Estado vazio" />;
  }

  return (
    <div className="overflow-hidden rounded-md border border-[#e5eaf0]">
      <table className="w-full border-collapse text-left text-sm">
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
                  {cellIndex === 2 && typeof cell === "string" ? (
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

function SubmitButton({ disabled }: { disabled: boolean }) {
  return (
    <button
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#101820] px-3 text-sm font-semibold text-white outline-none transition hover:bg-[#182431] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:bg-[#d9e0e7] disabled:text-[#667085]"
      disabled={disabled}
      type="submit"
    >
      <Plus aria-hidden="true" size={15} />
      Salvar
    </button>
  );
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
