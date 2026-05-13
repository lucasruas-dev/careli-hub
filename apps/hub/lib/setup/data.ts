"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  SetupData,
  SetupDepartment,
  SetupDepartmentModule,
  SetupModule,
  SetupPermission,
  SetupPulseXChannel,
  SetupSector,
  SetupUser,
} from "./types";

type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
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
    client
      .from("hub_users")
      .select(
        "id,email,display_name,avatar_url,role,status,hub_user_assignments(hub_departments(name),hub_sectors(name))",
      )
      .order("display_name"),
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

  assertQuery("departamentos", departmentsResult);
  assertQuery("setores", sectorsResult);
  assertQuery("usuarios", usersResult);
  assertQuery("modulos", modulesResult);
  assertQuery("modulos por departamento", departmentModulesResult);
  assertQuery("permissoes", permissionsResult);
  assertQuery("canais PulseX", channelsResult);

  return {
    channels: ((channelsResult as QueryResult<PulseXChannelRow[]>).data ?? []).map(
      mapPulseXChannel,
    ),
    departmentModules: (
      (departmentModulesResult as QueryResult<DepartmentModuleRow[]>).data ?? []
    ).map((access) => ({
      departmentId: access.department_id,
      moduleId: access.module_id,
      status: access.status,
    })),
    departments: (
      (departmentsResult as QueryResult<DepartmentRow[]>).data ?? []
    ).map(mapDepartment),
    modules: ((modulesResult as QueryResult<ModuleRow[]>).data ?? []).map(
      (module) => ({
        basePath: module.base_path,
        id: module.id,
        name: module.name,
        order: module.order,
        status: module.status,
      }),
    ),
    permissions: (
      (permissionsResult as QueryResult<PermissionRow[]>).data ?? []
    ).map((permission) => ({
      description: permission.description ?? undefined,
      id: permission.id,
      key: permission.key,
      moduleId: permission.module_id ?? undefined,
      scope: permission.scope,
    })),
    sectors: ((sectorsResult as QueryResult<SectorRow[]>).data ?? []).map(
      mapSector,
    ),
    users: ((usersResult as QueryResult<UserRow[]>).data ?? []).map(mapUser),
  };
}

export async function saveDepartment(input: {
  id?: string;
  name: string;
  slug: string;
}) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Supabase nao configurado.");
  }

  const payload = {
    id: input.id,
    name: input.name.trim(),
    slug: input.slug.trim(),
    status: "active",
  };
  const result = await client
    .from("hub_departments")
    .upsert(payload, { onConflict: input.id ? "id" : "slug" })
    .select("id,slug,name,description,status,created_at")
    .single();

  assertQuery("salvar departamento", result);

  return mapDepartment((result as QueryResult<DepartmentRow>).data);
}

export async function saveSector(input: {
  departmentId: string;
  id?: string;
  name: string;
  slug: string;
}) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Supabase nao configurado.");
  }

  const payload = {
    department_id: input.departmentId,
    id: input.id,
    name: input.name.trim(),
    slug: input.slug.trim(),
    status: "active",
  };
  const result = await client
    .from("hub_sectors")
    .upsert(payload, { onConflict: input.id ? "id" : "slug" })
    .select("id,department_id,slug,name,description,status,hub_departments(name)")
    .single();

  assertQuery("salvar setor", result);

  return mapSector((result as QueryResult<SectorRow>).data);
}

function assertQuery(label: string, result: unknown): asserts result is QueryResult<unknown> {
  const queryResult = result as QueryResult<unknown>;

  if (queryResult.error) {
    throw new Error(`Nao foi possivel carregar ${label}: ${queryResult.error.message}`);
  }
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
    role: row.role,
    sectorName: assignment?.hub_sectors?.name,
    status: row.status,
  };
}

function mapPulseXChannel(row: PulseXChannelRow): SetupPulseXChannel {
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
