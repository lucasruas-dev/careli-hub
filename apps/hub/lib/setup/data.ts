"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  CreateDepartmentInput,
  CreateOperationalUserInput,
  CreatePulseXChannelInput,
  CreateSectorInput,
  SetupData,
  SetupDepartment,
  SetupDepartmentModule,
  SetupModule,
  SetupOperationalProfileRole,
  SetupPermission,
  SetupPulseXChannel,
  SetupSector,
  SetupUser,
} from "./types";

type QueryResult<T> = {
  data: T | null;
  error: { code?: string; message: string } | null;
};

type DepartmentRow = {
  created_at?: string;
  description?: string | null;
  id: string;
  name: string;
  slug: string;
  status: SetupDepartment["status"];
};

type SectorRow = {
  department_id: string;
  description?: string | null;
  hub_departments?: { name: string } | null;
  id: string;
  name: string;
  slug: string;
  status: SetupSector["status"];
};

type UserRow = {
  avatar_url?: string | null;
  display_name: string;
  email: string;
  hub_user_assignments?: {
    hub_departments?: { name: string } | null;
    hub_sectors?: { name: string } | null;
  }[];
  id: string;
  operational_profile?: SetupOperationalProfileRole | null;
  role: SetupUser["role"];
  status: SetupUser["status"];
};

type ModuleRow = {
  base_path: string;
  id: string;
  name: string;
  order: number;
  status: SetupModule["status"];
};

type DepartmentModuleRow = {
  department_id: string;
  module_id: string;
  status: SetupDepartmentModule["status"];
};

type PermissionRow = {
  description?: string | null;
  id: string;
  key: string;
  module_id?: string | null;
  scope: SetupPermission["scope"];
};

type PulseXChannelRow = {
  department_id?: string | null;
  description?: string | null;
  hub_departments?: { name: string } | null;
  hub_sectors?: { name: string } | null;
  id: string;
  kind: SetupPulseXChannel["kind"];
  name: string;
  sector_id?: string | null;
  status: SetupPulseXChannel["status"];
};

export async function loadSetupData(): Promise<SetupData> {
  const client = getHubSupabaseClient();

  if (!client) {
    return createEmptySetupData();
  }

  const [
    departmentsResult,
    sectorsResult,
    usersResult,
    modulesResult,
    departmentModulesResult,
    permissionsResult,
    channelsResult,
  ] = await Promise.all([
    client
      .from("hub_departments")
      .select("id,slug,name,description,status,created_at")
      .order("name"),
    client
      .from("hub_sectors")
      .select("id,department_id,slug,name,description,status,hub_departments(name)")
      .order("name"),
    loadUsersQuery(client),
    client.from("hub_modules").select("id,name,base_path,status,order").order("order"),
    client
      .from("hub_department_modules")
      .select("department_id,module_id,status"),
    client
      .from("hub_permissions")
      .select("id,key,scope,module_id,description")
      .order("key"),
    client
      .from("pulsex_channels")
      .select(
        "id,name,description,kind,department_id,sector_id,status,hub_departments(name),hub_sectors(name)",
      )
      .order("order"),
  ]);

  const readableResults = [
    departmentsResult,
    sectorsResult,
    usersResult,
    modulesResult,
    permissionsResult,
    channelsResult,
  ];

  if (readableResults.every(hasQueryError)) {
    throw new Error("Nao foi possivel carregar os dados. Tente atualizar.");
  }

  return {
    channels: readRows<PulseXChannelRow>(channelsResult).map(mapPulseXChannel),
    departmentModules: readRows<DepartmentModuleRow>(departmentModulesResult).map((access) => ({
      departmentId: access.department_id,
      moduleId: access.module_id,
      status: access.status,
    })),
    departments: readRows<DepartmentRow>(departmentsResult).map(mapDepartment),
    modules: readRows<ModuleRow>(modulesResult).map((module) => ({
        basePath: module.base_path,
        id: module.id,
        name: module.name,
        order: module.order,
        status: module.status,
      }),
    ),
    permissions: readRows<PermissionRow>(permissionsResult).map((permission) => ({
      description: permission.description ?? undefined,
      id: permission.id,
      key: permission.key,
      moduleId: permission.module_id ?? undefined,
      scope: permission.scope,
    })),
    sectors: readRows<SectorRow>(sectorsResult).map(mapSector),
    users: readRows<UserRow>(usersResult).map(mapUser),
  };
}

export async function listDepartments() {
  const client = getHubSupabaseClient();

  if (!client) {
    return [];
  }

  const result = await client
    .from("hub_departments")
    .select("id,slug,name,description,status,created_at")
    .order("name");

  assertQuery("departamentos", result);

  return ((result as QueryResult<DepartmentRow[]>).data ?? []).map(
    mapDepartment,
  );
}

export async function listSectors() {
  const client = getHubSupabaseClient();

  if (!client) {
    return [];
  }

  const result = await client
    .from("hub_sectors")
    .select("id,department_id,slug,name,description,status,hub_departments(name)")
    .order("name");

  assertQuery("setores", result);

  return ((result as QueryResult<SectorRow[]>).data ?? []).map(mapSector);
}

export async function listPulseXChannels() {
  const client = getHubSupabaseClient();

  if (!client) {
    return [];
  }

  const result = await client
    .from("pulsex_channels")
    .select(
      "id,name,description,kind,department_id,sector_id,status,hub_departments(name),hub_sectors(name)",
    )
    .order("order");

  assertQuery("canais PulseX", result);

  return ((result as QueryResult<PulseXChannelRow[]>).data ?? []).map(
    mapPulseXChannel,
  );
}

export async function createDepartment(input: CreateDepartmentInput) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao indisponivel.");
  }

  const payload = {
    description: input.description?.trim() || null,
    name: input.name.trim(),
    slug: input.slug.trim(),
    status: input.status,
  };
  const result = await client
    .from("hub_departments")
    .insert(payload)
    .select("id,slug,name,description,status,created_at")
    .single();

  assertQuery("salvar departamento", result);

  return mapDepartment((result as QueryResult<DepartmentRow>).data);
}

export async function createSector(input: CreateSectorInput) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao indisponivel.");
  }

  const payload = {
    department_id: input.departmentId,
    description: input.description?.trim() || null,
    name: input.name.trim(),
    slug: input.slug.trim(),
    status: input.status,
  };
  const result = await client
    .from("hub_sectors")
    .insert(payload)
    .select("id,department_id,slug,name,description,status,hub_departments(name)")
    .single();

  assertQuery("salvar setor", result);

  return mapSector((result as QueryResult<SectorRow>).data);
}

export async function createPulseXChannel(input: CreatePulseXChannelInput) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao indisponivel.");
  }

  const result = await client
    .from("pulsex_channels")
    .insert({
      department_id: input.departmentId || null,
      description: input.description?.trim() || null,
      id: input.id.trim(),
      kind: input.kind,
      name: input.name.trim(),
      sector_id: input.sectorId || null,
      status: input.status,
    })
    .select(
      "id,name,description,kind,department_id,sector_id,status,hub_departments(name),hub_sectors(name)",
    )
    .single();

  assertQuery("salvar canal PulseX", result);

  return mapPulseXChannel((result as QueryResult<PulseXChannelRow>).data);
}

export async function createOperationalUser(input: CreateOperationalUserInput) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao indisponivel.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa indisponivel.");
  }

  const response = await fetch("/api/setup/users", {
    body: JSON.stringify(input),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Nao foi possivel criar usuario.");
  }
}

export const saveDepartment = createDepartment;
export const saveSector = createSector;

function assertQuery(label: string, result: unknown): asserts result is QueryResult<unknown> {
  const queryResult = result as QueryResult<unknown>;

  if (queryResult.error) {
    throw new Error(getSetupErrorMessage(label));
  }
}

function hasQueryError(result: unknown) {
  return Boolean((result as QueryResult<unknown>).error);
}

function readRows<Row>(result: unknown): Row[] {
  const queryResult = result as QueryResult<Row[]>;

  if (queryResult.error) {
    return [];
  }

  return queryResult.data ?? [];
}

async function loadUsersQuery(client: ReturnType<typeof getHubSupabaseClient>) {
  if (!client) {
    return { data: [], error: null } satisfies QueryResult<UserRow[]>;
  }

  const result = await client
    .from("hub_users")
    .select(
      "id,email,display_name,avatar_url,role,operational_profile,status,hub_user_assignments(hub_departments(name),hub_sectors(name))",
    )
    .order("display_name");

  if (!result.error) {
    return result;
  }

  return client
    .from("hub_users")
    .select(
      "id,email,display_name,avatar_url,role,status,hub_user_assignments(hub_departments(name),hub_sectors(name))",
    )
    .order("display_name");
}

function getSetupErrorMessage(label: string) {
  if (label.startsWith("salvar")) {
    return `Nao foi possivel ${label}.`;
  }

  return `Nao foi possivel carregar ${label}.`;
}

function mapDepartment(row: DepartmentRow | null): SetupDepartment {
  if (!row) {
    throw new Error("Departamento inexistente.");
  }

  return {
    createdAt: row.created_at,
    description: row.description ?? undefined,
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
  };
}

function mapSector(row: SectorRow | null): SetupSector {
  if (!row) {
    throw new Error("Setor inexistente.");
  }

  return {
    departmentId: row.department_id,
    departmentName: row.hub_departments?.name,
    description: row.description ?? undefined,
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
  };
}

function mapUser(row: UserRow): SetupUser {
  const assignment = row.hub_user_assignments?.[0];

  return {
    avatarUrl: row.avatar_url ?? undefined,
    departmentName: assignment?.hub_departments?.name,
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    operationalProfile: row.operational_profile ?? mapRoleToOperationalProfile(row.role),
    role: row.role,
    sectorName: assignment?.hub_sectors?.name,
    status: row.status,
  };
}

function mapRoleToOperationalProfile(
  role: SetupUser["role"],
): SetupOperationalProfileRole {
  if (role === "admin") {
    return "adm";
  }

  if (role === "leader") {
    return "ldr";
  }

  return "op1";
}

function mapPulseXChannel(row: PulseXChannelRow | null): SetupPulseXChannel {
  if (!row) {
    throw new Error("Canal PulseX inexistente.");
  }

  return {
    departmentId: row.department_id ?? undefined,
    departmentName: row.hub_departments?.name,
    description: row.description ?? undefined,
    id: row.id,
    kind: row.kind,
    name: row.name,
    sectorId: row.sector_id ?? undefined,
    sectorName: row.hub_sectors?.name,
    status: row.status,
  };
}

function createEmptySetupData(): SetupData {
  return {
    channels: [],
    departmentModules: [],
    departments: [],
    modules: [],
    permissions: [],
    sectors: [],
    users: [],
  };
}
