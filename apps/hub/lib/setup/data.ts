"use client";

import {
  getHubSupabaseClient,
  getHubSupabaseDiagnostics,
  isSupabaseNetworkError,
  logSupabaseDiagnostic,
  serializeDiagnosticError,
} from "@/lib/supabase/client";
import type {
  CreateDepartmentInput,
  CreateOperationalUserInput,
  CreatePulseXChannelInput,
  CreateSectorInput,
  LinkUserAssignmentInput,
  SetupData,
  SetupDepartment,
  SetupDepartmentModule,
  SetupModule,
  SetupOperationalProfileRole,
  SetupPermission,
  SetupPulseXChannel,
  SetupPulseXChannelMember,
  SetupSector,
  SetupUser,
  UpdateDepartmentInput,
  UpdatePulseXChannelInput,
  UpdateSectorInput,
} from "./types";

type QueryResult<T> = {
  data: T | null;
  error: { code?: string; message: string; name?: string; stack?: string } | null;
};

const SUPABASE_CONNECTION_ERROR_MESSAGE =
  "Nao foi possivel conectar ao Supabase. Verifique a conexao e tente novamente.";

type HubProfileDebugRow = {
  email: string;
  id: string;
  operational_profile?: string | null;
  role: string;
  status: string;
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
  hub_user_assignments?: UserAssignmentRow[];
  id: string;
  operational_profile?: SetupOperationalProfileRole | null;
  role: SetupUser["role"];
  status: SetupUser["status"];
};

type UserAssignmentRow = {
  department_id?: string | null;
  hub_departments?: { name: string } | { name: string }[] | null;
  hub_sectors?: { name: string } | { name: string }[] | null;
  sector_id?: string | null;
  status: "active" | "archived" | "disabled";
  user_id: string;
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

type PulseXChannelMemberRow = {
  channel_id: string;
  user_id: string;
};

export async function loadSetupData(): Promise<SetupData> {
  const client = getHubSupabaseClient();

  if (!client) {
    logSetupDebug("Supabase client indisponivel", {
      hasClient: false,
    });
    return createEmptySetupData();
  }

  await logCurrentSetupAuthContext(client);
  await runSetupConnectivityProbe(client);

  const [
    departmentsResult,
    sectorsResult,
    usersResult,
    modulesResult,
    departmentModulesResult,
    permissionsResult,
    channelsResult,
    channelMembersResult,
  ] = await Promise.all([
    runSetupQuery<DepartmentRow[]>(
      "list departments",
      client
        .from("hub_departments")
        .select("id,slug,name,description,status,created_at")
        .order("name"),
    ),
    runSetupQuery<SectorRow[]>(
      "list sectors",
      client
        .from("hub_sectors")
        .select("id,department_id,slug,name,description,status,hub_departments(name)")
        .order("name"),
    ),
    loadUsersQuery(client),
    runSetupQuery<ModuleRow[]>(
      "list modules",
      client.from("hub_modules").select("id,name,base_path,status,order").order("order"),
    ),
    runSetupQuery<DepartmentModuleRow[]>(
      "list department modules",
      client
        .from("hub_department_modules")
        .select("department_id,module_id,status"),
    ),
    runSetupQuery<PermissionRow[]>(
      "list permissions",
      client
        .from("hub_permissions")
        .select("id,key,scope,module_id,description")
        .order("key"),
    ),
    runSetupQuery<PulseXChannelRow[]>(
      "list pulsex channels",
      client
        .from("pulsex_channels")
        .select(
          "id,name,description,kind,department_id,sector_id,status,hub_departments(name),hub_sectors(name)",
        )
        .order("order"),
    ),
    runSetupQuery<PulseXChannelMemberRow[]>(
      "list pulsex channel members",
      client.from("pulsex_channel_members").select("channel_id,user_id"),
    ),
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
    readableResults.forEach((result, index) => {
      logSetupQueryError(`setup:${index}`, result);
    });
    const hasNetworkFailure = readableResults.some((result) =>
      isNetworkFailure((result as QueryResult<unknown>).error),
    );

    throw new Error(
      hasNetworkFailure
        ? SUPABASE_CONNECTION_ERROR_MESSAGE
        : "Nao foi possivel carregar os dados. Tente atualizar.",
    );
  }

  return {
    channelMembers: readRows<PulseXChannelMemberRow>(
      "pulsex_channel_members",
      channelMembersResult,
    ).map(mapPulseXChannelMember),
    channels: readRows<PulseXChannelRow>("pulsex_channels", channelsResult).map(mapPulseXChannel),
    departmentModules: readRows<DepartmentModuleRow>("hub_department_modules", departmentModulesResult).map((access) => ({
      departmentId: access.department_id,
      moduleId: access.module_id,
      status: access.status,
    })),
    departments: readRows<DepartmentRow>("hub_departments", departmentsResult).map(mapDepartment),
    modules: readRows<ModuleRow>("hub_modules", modulesResult).map((module) => ({
        basePath: module.base_path,
        id: module.id,
        name: module.name,
        order: module.order,
        status: module.status,
      }),
    ),
    permissions: readRows<PermissionRow>("hub_permissions", permissionsResult).map((permission) => ({
      description: permission.description ?? undefined,
      id: permission.id,
      key: permission.key,
      moduleId: permission.module_id ?? undefined,
      scope: permission.scope,
    })),
    sectors: readRows<SectorRow>("hub_sectors", sectorsResult).map(mapSector),
    users: readRows<UserRow>("hub_users", usersResult).map(mapUser),
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
    slug: input.slug.trim() || createFallbackSlug(input.name),
    status: input.status,
  };
  logSupabaseDiagnostic("setup", "create department payload", {
    function: "createDepartment",
    payload,
    supabase: getHubSupabaseDiagnostics(),
    table: "hub_departments",
  });
  const result = await runSetupMutation<DepartmentRow>(
    "create department",
    client
      .from("hub_departments")
      .insert(payload)
      .select("id,slug,name,description,status,created_at")
      .single(),
  );
  logSetupQueryResult("create department", result);

  if (isNetworkFailure(result.error)) {
    logSupabaseDiagnostic("setup", "create department direct insert failed", {
      error: result.error,
      fallback: "/api/setup/departments",
      function: "createDepartment",
      payload,
      supabase: getHubSupabaseDiagnostics(),
      table: "hub_departments",
    });

    return createDepartmentViaApi(client, payload);
  }

  assertQuery("salvar departamento", result);

  return mapDepartment((result as QueryResult<DepartmentRow>).data);
}

export async function updateDepartment(input: UpdateDepartmentInput) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao indisponivel.");
  }

  const payload = {
    description: input.description?.trim() || null,
    name: input.name.trim(),
    status: input.status,
  };
  logSetupDebug("update department payload", {
    id: input.id,
    ...payload,
  });
  const result = await runSetupMutation<DepartmentRow>(
    "update department",
    client
      .from("hub_departments")
      .update(payload)
      .eq("id", input.id)
      .select("id,slug,name,description,status,created_at")
      .single(),
  );
  logSetupQueryResult("update department", result);

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
    slug: input.slug.trim() || createFallbackSlug(input.name),
    status: input.status,
  };
  logSetupDebug("create sector payload", payload);
  const result = await runSetupMutation<SectorRow>(
    "create sector",
    client
      .from("hub_sectors")
      .insert(payload)
      .select("id,department_id,slug,name,description,status,hub_departments(name)")
      .single(),
  );
  logSetupQueryResult("create sector", result);

  assertQuery("salvar setor", result);

  return mapSector((result as QueryResult<SectorRow>).data);
}

export async function updateSector(input: UpdateSectorInput) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao indisponivel.");
  }

  const payload = {
    department_id: input.departmentId,
    description: input.description?.trim() || null,
    name: input.name.trim(),
    status: input.status,
  };
  logSetupDebug("update sector payload", {
    id: input.id,
    ...payload,
  });
  const result = await runSetupMutation<SectorRow>(
    "update sector",
    client
      .from("hub_sectors")
      .update(payload)
      .eq("id", input.id)
      .select("id,department_id,slug,name,description,status,hub_departments(name)")
      .single(),
  );
  logSetupQueryResult("update sector", result);

  assertQuery("salvar setor", result);

  return mapSector((result as QueryResult<SectorRow>).data);
}

export async function createPulseXChannel(input: CreatePulseXChannelInput) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao indisponivel.");
  }

  const payload = {
    department_id: input.departmentId || null,
    description: input.description?.trim() || null,
    id: input.id.trim() || createFallbackSlug(input.name),
    kind: mapChannelTypeToKind(input.type),
    name: input.name.trim(),
    sector_id: input.sectorId || null,
    status: input.status,
  };
  logSetupDebug("create pulsex channel payload", payload);
  const result = await runSetupMutation<PulseXChannelRow>(
    "create pulsex channel",
    client
      .from("pulsex_channels")
      .insert(payload)
      .select(
        "id,name,description,kind,department_id,sector_id,status,hub_departments(name),hub_sectors(name)",
      )
      .single(),
  );
  logSetupQueryResult("create pulsex channel", result);

  assertQuery("salvar canal PulseX", result);

  const channel = mapPulseXChannel((result as QueryResult<PulseXChannelRow>).data);

  if (input.participantUserIds) {
    await syncPulseXChannelMembers(channel.id, input.participantUserIds);
  }

  return channel;
}

export async function updatePulseXChannel(input: UpdatePulseXChannelInput) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao indisponivel.");
  }

  const payload = {
    department_id: input.departmentId || null,
    ...(input.type ? { kind: mapChannelTypeToKind(input.type) } : {}),
    name: input.name.trim(),
    sector_id: input.sectorId || null,
    status: input.status,
  };
  logSetupDebug("update pulsex channel payload", {
    id: input.id,
    ...payload,
  });
  const result = await runSetupMutation<PulseXChannelRow>(
    "update pulsex channel",
    client
      .from("pulsex_channels")
      .update(payload)
      .eq("id", input.id)
      .select(
        "id,name,description,kind,department_id,sector_id,status,hub_departments(name),hub_sectors(name)",
      )
      .single(),
  );
  logSetupQueryResult("update pulsex channel", result);

  assertQuery("salvar canal PulseX", result);

  const channel = mapPulseXChannel((result as QueryResult<PulseXChannelRow>).data);

  if (input.participantUserIds) {
    await syncPulseXChannelMembers(channel.id, input.participantUserIds);
  }

  return channel;
}

export async function syncPulseXChannelMembers(
  channelId: string,
  participantUserIds: readonly string[],
) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao indisponivel.");
  }

  const uniqueUserIds = [...new Set(participantUserIds)].filter(Boolean);
  const currentMembersResult = await runSetupQuery<PulseXChannelMemberRow[]>(
    "list pulsex channel members for sync",
    client
      .from("pulsex_channel_members")
      .select("channel_id,user_id")
      .eq("channel_id", channelId),
  );

  if (currentMembersResult.error) {
    logSupabaseDiagnostic("setup", "sync pulsex members direct read failed", {
      channelId,
      error: currentMembersResult.error,
      fallback: "/api/setup/pulsex/channel-members",
      function: "syncPulseXChannelMembers",
      table: "pulsex_channel_members",
    });

    return syncPulseXChannelMembersViaApi(client, channelId, uniqueUserIds);
  }

  const currentUserIds = new Set(
    (currentMembersResult.data ?? []).map((member) => member.user_id),
  );
  const targetUserIds = new Set(uniqueUserIds);
  const userIdsToInsert = uniqueUserIds.filter(
    (userId) => !currentUserIds.has(userId),
  );
  const userIdsToDelete = [...currentUserIds].filter(
    (userId) => !targetUserIds.has(userId),
  );

  if (userIdsToInsert.length > 0) {
    const insertResult = await runSetupMutation<unknown>(
      "sync pulsex channel members insert",
      client.from("pulsex_channel_members").insert(
        userIdsToInsert.map((userId) => ({
          channel_id: channelId,
          user_id: userId,
        })),
      ),
    );

    logSetupQueryResult("sync pulsex channel members insert", insertResult);
    if (insertResult.error) {
      logSupabaseDiagnostic("setup", "sync pulsex members direct insert failed", {
        channelId,
        error: insertResult.error,
        fallback: "/api/setup/pulsex/channel-members",
        function: "syncPulseXChannelMembers",
        table: "pulsex_channel_members",
      });

      return syncPulseXChannelMembersViaApi(client, channelId, uniqueUserIds);
    }
  }

  if (userIdsToDelete.length > 0) {
    const deleteResult = await runSetupMutation<unknown>(
      "sync pulsex channel members delete",
      client
        .from("pulsex_channel_members")
        .delete()
        .eq("channel_id", channelId)
        .in("user_id", userIdsToDelete),
    );

    logSetupQueryResult("sync pulsex channel members delete", deleteResult);
    if (deleteResult.error) {
      logSupabaseDiagnostic("setup", "sync pulsex members direct delete failed", {
        channelId,
        error: deleteResult.error,
        fallback: "/api/setup/pulsex/channel-members",
        function: "syncPulseXChannelMembers",
        table: "pulsex_channel_members",
      });

      return syncPulseXChannelMembersViaApi(client, channelId, uniqueUserIds);
    }
  }
}

async function syncPulseXChannelMembersViaApi(
  client: NonNullable<ReturnType<typeof getHubSupabaseClient>>,
  channelId: string,
  participantUserIds: readonly string[],
) {
  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa indisponivel.");
  }

  let response: Response;

  try {
    response = await fetch("/api/setup/pulsex/channel-members", {
      body: JSON.stringify({
        channelId,
        participantUserIds,
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch (error) {
    logSupabaseDiagnostic("setup", "sync pulsex members api error", {
      channelId,
      endpoint: "/api/setup/pulsex/channel-members",
      error: serializeDiagnosticError(error),
      function: "syncPulseXChannelMembersViaApi",
      table: "pulsex_channel_members",
    });
    throw new Error(
      isSupabaseNetworkError(error)
        ? SUPABASE_CONNECTION_ERROR_MESSAGE
        : "Nao foi possivel salvar participantes.",
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;

  if (!response.ok) {
    logSupabaseDiagnostic("setup", "sync pulsex members api failed", {
      channelId,
      endpoint: "/api/setup/pulsex/channel-members",
      function: "syncPulseXChannelMembersViaApi",
      response: payload,
      status: response.status,
      statusText: response.statusText,
      table: "pulsex_channel_members",
    });
    throw new Error(payload?.error ?? "Nao foi possivel salvar participantes.");
  }
}

export async function createOperationalUser(input: CreateOperationalUserInput) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao indisponivel.");
  }

  logSupabaseDiagnostic("setup", "create user auth session start", {
    endpoint: "/api/setup/users",
    function: "createOperationalUser",
    supabase: getHubSupabaseDiagnostics(),
  });
  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa indisponivel.");
  }

  let response: Response;

  try {
    logSupabaseDiagnostic("setup", "create user api start", {
      endpoint: "/api/setup/users",
      function: "createOperationalUser",
    });
    response = await fetch("/api/setup/users", {
      body: JSON.stringify(input),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch (error) {
    logSupabaseDiagnostic("setup", "create user api error", {
      endpoint: "/api/setup/users",
      error: serializeDiagnosticError(error),
      function: "createOperationalUser",
    });
    throw new Error(
      isSupabaseNetworkError(error)
        ? SUPABASE_CONNECTION_ERROR_MESSAGE
        : "Nao foi possivel criar usuario.",
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;

  if (!response.ok) {
    logSupabaseDiagnostic("setup", "create user api error", {
      endpoint: "/api/setup/users",
      function: "createOperationalUser",
      status: response.status,
      statusText: response.statusText,
      response: payload,
    });
    throw new Error(payload?.error ?? "Nao foi possivel criar usuario.");
  }
}

export async function linkUserAssignment(input: LinkUserAssignmentInput) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao indisponivel.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (!sessionResult.error && accessToken) {
    const response = await fetch("/api/setup/users", {
      body: JSON.stringify(input),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "PATCH",
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (response.ok) {
      return;
    }

    if (response.status !== 503) {
      throw new Error(payload?.error ?? "Nao foi possivel atualizar usuario.");
    }
  }

  const userPayload = {
    avatar_url: input.avatarUrl?.trim() || null,
    display_name: input.fullName.trim(),
    email: input.email.trim().toLowerCase(),
    operational_profile: input.profile,
    role: mapOperationalProfileToRole(input.profile),
    status: input.status,
  };
  logSetupDebug("link user profile payload", {
    userId: input.userId,
    ...userPayload,
  });

  const userResult = await runSetupMutation<unknown>(
    "link user profile",
    client
      .from("hub_users")
      .update(userPayload)
      .eq("id", input.userId),
  );

  logSetupQueryResult("link user profile", userResult);

  if ((userResult as QueryResult<unknown>).error?.message.includes("operational_profile")) {
    const legacyUserResult = await runSetupMutation<unknown>(
      "link user profile legacy",
      client
        .from("hub_users")
        .update({
          avatar_url: userPayload.avatar_url,
          display_name: userPayload.display_name,
          email: userPayload.email,
          role: userPayload.role,
          status: userPayload.status,
        })
        .eq("id", input.userId),
    );

    logSetupQueryResult("link user profile legacy", legacyUserResult);
    assertQuery("vincular usuario", legacyUserResult);
  } else {
    assertQuery("vincular usuario", userResult);
  }

  const archiveResult = await runSetupMutation<unknown>(
    "archive user assignments",
    client
      .from("hub_user_assignments")
      .update({ status: "archived" })
      .eq("user_id", input.userId)
      .eq("is_primary", true)
      .eq("status", "active"),
  );

  logSetupQueryResult("archive user assignments", archiveResult);
  assertQuery("vincular usuario", archiveResult);

  const assignmentPayload = {
    department_id: input.departmentId,
    is_primary: true,
    sector_id: input.sectorId,
    status: input.status,
    title: input.profile,
    user_id: input.userId,
  };
  logSetupDebug("link user assignment payload", assignmentPayload);

  const assignmentResult = await runSetupMutation<unknown>(
    "link user assignment",
    client.from("hub_user_assignments").insert(assignmentPayload),
  );

  logSetupQueryResult("link user assignment", assignmentResult);
  assertQuery("vincular usuario", assignmentResult);
}

export async function uploadUserAvatar(input: {
  file: File;
  userId: string;
}) {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao indisponivel.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa ausente.");
  }

  const formData = new FormData();
  formData.set("file", input.file);
  formData.set("userId", input.userId);

  const response = await fetch("/api/setup/users/avatar", {
    body: formData,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | { avatarUrl?: string; error?: string }
    | null;

  if (!response.ok || !payload?.avatarUrl) {
    throw new Error(payload?.error ?? "Nao foi possivel importar a foto.");
  }

  return payload.avatarUrl;
}

export const saveDepartment = createDepartment;
export const saveSector = createSector;

async function createDepartmentViaApi(
  client: NonNullable<ReturnType<typeof getHubSupabaseClient>>,
  payload: {
    description: string | null;
    name: string;
    slug: string;
    status: SetupDepartment["status"];
  },
) {
  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    logSupabaseDiagnostic("setup", "create department fallback auth error", {
      error: sessionResult.error
        ? serializeDiagnosticError(sessionResult.error)
        : null,
      function: "createDepartmentViaApi",
      table: "hub_departments",
    });
    throw new Error("Sessao administrativa indisponivel.");
  }

  let response: Response;

  try {
    logSupabaseDiagnostic("setup", "create department api start", {
      endpoint: "/api/setup/departments",
      function: "createDepartmentViaApi",
      payload,
      table: "hub_departments",
    });
    response = await fetch("/api/setup/departments", {
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch (error) {
    logSupabaseDiagnostic("setup", "create department api error", {
      endpoint: "/api/setup/departments",
      error: serializeDiagnosticError(error),
      function: "createDepartmentViaApi",
      payload,
      table: "hub_departments",
    });
    throw new Error(SUPABASE_CONNECTION_ERROR_MESSAGE);
  }

  const responsePayload = (await response.json().catch(() => null)) as
    | { data?: DepartmentRow; error?: string }
    | null;

  if (!response.ok || !responsePayload?.data) {
    logSupabaseDiagnostic("setup", "create department api error", {
      endpoint: "/api/setup/departments",
      function: "createDepartmentViaApi",
      payload,
      response: responsePayload,
      status: response.status,
      statusText: response.statusText,
      table: "hub_departments",
    });
    throw new Error(responsePayload?.error ?? "Nao foi possivel salvar departamento.");
  }

  logSupabaseDiagnostic("setup", "create department api result", {
    endpoint: "/api/setup/departments",
    function: "createDepartmentViaApi",
    id: responsePayload.data.id,
    table: "hub_departments",
  });

  return mapDepartment(responsePayload.data);
}

function assertQuery(label: string, result: unknown): asserts result is QueryResult<unknown> {
  const queryResult = result as QueryResult<unknown>;

  if (queryResult.error) {
    logSetupQueryError(label, result);
    throw new Error(getSetupErrorMessage(label));
  }
}

function hasQueryError(result: unknown) {
  return Boolean((result as QueryResult<unknown>).error);
}

function readRows<Row>(label: string, result: unknown): Row[] {
  const queryResult = result as QueryResult<Row[]>;

  if (queryResult.error) {
    logSetupQueryError(label, result);
    return [];
  }

  return queryResult.data ?? [];
}

async function runSetupQuery<Result>(
  label: string,
  query: PromiseLike<unknown>,
): Promise<QueryResult<Result>> {
  logSupabaseDiagnostic("setup", `${label} start`, {
    function: `setup.${label}`,
    supabase: getHubSupabaseDiagnostics(),
    table: getSetupQueryTable(label),
  });

  try {
    const result = (await query) as QueryResult<Result>;

    logSetupQueryResult(label, result);

    return result;
  } catch (error) {
    const queryError = serializeThrownError(error);
    const result = {
      data: null,
      error: queryError,
    } satisfies QueryResult<Result>;

    logSetupQueryError(label, result);

    return result;
  }
}

async function runSetupConnectivityProbe(
  client: NonNullable<ReturnType<typeof getHubSupabaseClient>>,
) {
  if (!isLocalDevelopmentRuntime()) {
    return;
  }

  const probes = [
    {
      label: "probe hub_departments",
      query: client.from("hub_departments").select("id").limit(1),
    },
    {
      label: "probe hub_sectors",
      query: client.from("hub_sectors").select("id").limit(1),
    },
    {
      label: "probe pulsex_channels",
      query: client.from("pulsex_channels").select("id").limit(1),
    },
  ];

  await Promise.all(
    probes.map(async (probe) => {
      const result = await runSetupQuery(probe.label, probe.query);

      if (result.error) {
        logSetupQueryError(probe.label, result);
      }
    }),
  );
}

async function runSetupMutation<Result>(
  label: string,
  query: PromiseLike<unknown>,
): Promise<QueryResult<Result>> {
  logSupabaseDiagnostic("setup", `${label} start`, {
    function: `setup.${label}`,
    supabase: getHubSupabaseDiagnostics(),
    table: getSetupQueryTable(label),
  });

  try {
    return (await query) as QueryResult<Result>;
  } catch (error) {
    const result = {
      data: null,
      error: serializeThrownError(error),
    } satisfies QueryResult<Result>;

    logSetupQueryError(label, result);

    return result;
  }
}

async function logCurrentSetupAuthContext(
  client: NonNullable<ReturnType<typeof getHubSupabaseClient>>,
) {
  if (!isLocalDevelopmentRuntime()) {
    return;
  }

  logSupabaseDiagnostic("setup", "current auth user start", {
    function: "logCurrentSetupAuthContext",
    supabase: getHubSupabaseDiagnostics(),
  });
  let authResult: Awaited<ReturnType<typeof client.auth.getUser>>;

  try {
    authResult = await client.auth.getUser();
  } catch (error) {
    logSupabaseDiagnostic("setup", "current auth user error", {
      error: serializeDiagnosticError(error),
      function: "logCurrentSetupAuthContext",
      supabase: getHubSupabaseDiagnostics(),
    });
    return;
  }

  if (authResult.error || !authResult.data.user) {
    console.warn("[setup] current auth user error", authResult.error);
    return;
  }

  const currentUser = authResult.data.user;

  console.debug("[setup] current auth user", {
    email: currentUser.email,
    id: currentUser.id,
  });

  logSupabaseDiagnostic("setup", "current hub profile start", {
    function: "logCurrentSetupAuthContext",
    table: "hub_users",
    userId: currentUser.id,
  });
  let profileResult: QueryResult<HubProfileDebugRow>;

  try {
    profileResult = (await client
      .from("hub_users")
      .select("id,email,role,status,operational_profile")
      .eq("id", currentUser.id)
      .maybeSingle<HubProfileDebugRow>()) as QueryResult<HubProfileDebugRow>;
  } catch (error) {
    logSupabaseDiagnostic("setup", "current hub profile error", {
      error: serializeDiagnosticError(error),
      function: "logCurrentSetupAuthContext",
      table: "hub_users",
      userId: currentUser.id,
    });
    return;
  }

  if (profileResult.error) {
    console.warn("[setup] current hub profile error", profileResult.error);
    return;
  }

  console.debug("[setup] current hub profile", {
    email: profileResult.data?.email,
    id: profileResult.data?.id,
    operationalProfile: profileResult.data?.operational_profile,
    role: profileResult.data?.role,
    status: profileResult.data?.status,
  });
}

function logSetupQueryResult(label: string, result: unknown) {
  if (!isLocalDevelopmentRuntime()) {
    return;
  }

  const queryResult = result as QueryResult<unknown>;

  if (queryResult.error) {
    console.warn(`[setup] ${label} error`, queryResult.error);
    return;
  }

  const rowCount = Array.isArray(queryResult.data)
    ? queryResult.data.length
    : queryResult.data
      ? 1
      : 0;

  console.debug(`[setup] ${label} result`, {
    rowCount,
  });
}

function logSetupQueryError(label: string, result: unknown) {
  if (!isLocalDevelopmentRuntime()) {
    return;
  }

  const queryResult = result as QueryResult<unknown>;

  if (queryResult.error) {
    logSupabaseDiagnostic("setup", "Supabase query error", {
      error: queryResult.error,
      function: `setup.${label}`,
      label,
      supabase: getHubSupabaseDiagnostics(),
      table: getSetupQueryTable(label),
    });
  }
}

function logSetupDebug(message: string, detail?: unknown) {
  if (!isLocalDevelopmentRuntime()) {
    return;
  }

  console.debug(`[setup] ${message}`, detail ?? "");
}

function isLocalDevelopmentRuntime(): boolean {
  if (typeof globalThis.location === "undefined") {
    return false;
  }

  return ["localhost", "127.0.0.1"].includes(globalThis.location.hostname);
}

function createFallbackSlug(value: string) {
  const normalizedValue = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalizedValue || `registro-${Date.now().toString(36)}`;
}

function serializeThrownError(error: unknown): NonNullable<QueryResult<unknown>["error"]> {
  const serialized = serializeDiagnosticError(error);

  return {
    message: serialized.message || "Erro de rede ao consultar Supabase.",
    name: serialized.name,
    stack: serialized.stack,
  };
}

function isNetworkFailure(error: QueryResult<unknown>["error"]) {
  return Boolean(error && isSupabaseNetworkError(error));
}

function getSetupQueryTable(label: string) {
  const normalizedLabel = label.toLowerCase();

  if (normalizedLabel.includes("department module")) {
    return "hub_department_modules";
  }

  if (normalizedLabel.includes("department")) {
    return "hub_departments";
  }

  if (normalizedLabel.includes("sector")) {
    return "hub_sectors";
  }

  if (normalizedLabel.includes("user assignment")) {
    return "hub_user_assignments";
  }

  if (normalizedLabel.includes("user")) {
    return "hub_users";
  }

  if (
    normalizedLabel.includes("channel member") ||
    normalizedLabel.includes("participantes")
  ) {
    return "pulsex_channel_members";
  }

  if (normalizedLabel.includes("pulsex") || normalizedLabel.includes("canal")) {
    return "pulsex_channels";
  }

  if (normalizedLabel.includes("module")) {
    return "hub_modules";
  }

  if (normalizedLabel.includes("permission")) {
    return "hub_permissions";
  }

  return "unknown";
}

async function loadUsersQuery(client: ReturnType<typeof getHubSupabaseClient>) {
  if (!client) {
    return { data: [], error: null } satisfies QueryResult<UserRow[]>;
  }

  const result = await runSetupQuery<UserRow[]>(
    "list users",
    client
      .from("hub_users")
      .select("id,email,display_name,avatar_url,role,operational_profile,status")
      .order("display_name"),
  );

  const users =
    result.error?.message.includes("operational_profile")
      ? await runSetupQuery<UserRow[]>(
          "list users legacy profile fallback",
          client
            .from("hub_users")
            .select("id,email,display_name,avatar_url,role,status")
            .order("display_name"),
        )
      : result;

  if (users.error || !users.data?.length) {
    return users;
  }

  const assignments = await runSetupQuery<UserAssignmentRow[]>(
    "list user assignments",
    client
      .from("hub_user_assignments")
      .select(
        "user_id,department_id,sector_id,status,hub_departments(name),hub_sectors:hub_sectors!hub_user_assignments_sector_department_fk(name)",
      )
      .order("created_at", { ascending: false }),
  );

  if (assignments.error) {
    const apiResult = await loadUsersViaApi(client);

    if (apiResult) {
      return apiResult;
    }

    return users;
  }

  const assignmentsByUser = new Map<string, UserAssignmentRow[]>();

  for (const assignment of assignments.data ?? []) {
    const currentAssignments = assignmentsByUser.get(assignment.user_id) ?? [];
    currentAssignments.push(assignment);
    assignmentsByUser.set(assignment.user_id, currentAssignments);
  }

  return {
    data: users.data.map((user) => ({
      ...user,
      hub_user_assignments: assignmentsByUser.get(user.id) ?? [],
    })),
    error: null,
  } satisfies QueryResult<UserRow[]>;
}

async function loadUsersViaApi(
  client: NonNullable<ReturnType<typeof getHubSupabaseClient>>,
) {
  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    return null;
  }

  let response: Response;

  try {
    response = await fetch("/api/setup/users", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    logSupabaseDiagnostic("setup", "list users api error", {
      endpoint: "/api/setup/users",
      error: serializeDiagnosticError(error),
      function: "loadUsersViaApi",
      table: "hub_users",
    });
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | { data?: UserRow[]; error?: string }
    | null;

  if (response.ok && payload?.data) {
    return {
      data: payload.data,
      error: null,
    } satisfies QueryResult<UserRow[]>;
  }

  if (response.status !== 503) {
    logSupabaseDiagnostic("setup", "list users api error", {
      endpoint: "/api/setup/users",
      function: "loadUsersViaApi",
      response: payload,
      status: response.status,
      statusText: response.statusText,
      table: "hub_users",
    });
  }

  return null;
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
  const assignment =
    row.hub_user_assignments?.find((item) => item.status === "active") ??
    row.hub_user_assignments?.[0];

  return {
    avatarUrl: row.avatar_url ?? undefined,
    departmentId: assignment?.department_id ?? undefined,
    departmentName: getRelationName(assignment?.hub_departments),
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    operationalProfile: row.operational_profile ?? mapRoleToOperationalProfile(row.role),
    role: row.role,
    sectorId: assignment?.sector_id ?? undefined,
    sectorName: getRelationName(assignment?.hub_sectors),
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
    type: mapChannelKindToType(row.kind),
  };
}

function mapPulseXChannelMember(
  row: PulseXChannelMemberRow,
): SetupPulseXChannelMember {
  return {
    channelId: row.channel_id,
    userId: row.user_id,
  };
}

function getRelationName(
  relation?: { name: string } | { name: string }[] | null,
) {
  if (Array.isArray(relation)) {
    return relation[0]?.name;
  }

  return relation?.name;
}

function mapChannelTypeToKind(
  type: SetupPulseXChannel["type"],
): SetupPulseXChannel["kind"] {
  if (type === "sector_channel") {
    return "sector";
  }

  if (type === "department_channel") {
    return "department";
  }

  return "system";
}

function mapChannelKindToType(
  kind: SetupPulseXChannel["kind"],
): SetupPulseXChannel["type"] {
  if (kind === "sector") {
    return "sector_channel";
  }

  if (kind === "department") {
    return "department_channel";
  }

  return "private_group";
}

function mapOperationalProfileToRole(
  profile: SetupOperationalProfileRole,
): SetupUser["role"] {
  if (profile === "adm") {
    return "admin";
  }

  if (profile === "cdr" || profile === "ldr") {
    return "leader";
  }

  return "operator";
}

function createEmptySetupData(): SetupData {
  return {
    channelMembers: [],
    channels: [],
    departmentModules: [],
    departments: [],
    modules: [],
    permissions: [],
    sectors: [],
    users: [],
  };
}
