import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";
type OperationalProfileRole = "op1" | "op2" | "op3" | "ldr" | "cdr" | "adm";
type SetupUserStatus = "active" | "disabled";

type CreateOperationalUserPayload = {
  departmentId?: unknown;
  email?: unknown;
  fullName?: unknown;
  password?: unknown;
  profile?: unknown;
  sectorId?: unknown;
  status?: unknown;
};

type UpdateOperationalUserPayload = {
  avatarUrl?: unknown;
  departmentId?: unknown;
  email?: unknown;
  fullName?: unknown;
  profile?: unknown;
  sectorId?: unknown;
  status?: unknown;
  userId?: unknown;
};

type ParsedOperationalUserPayload = {
  departmentId: string;
  email: string;
  fullName: string;
  password: string;
  profile: OperationalProfileRole;
  sectorId: string;
  status: SetupUserStatus;
};

type ListHubUserRow = {
  avatar_url?: string | null;
  display_name: string;
  email: string;
  hub_user_assignments?: ListHubUserAssignmentRow[];
  id: string;
  operational_profile?: OperationalProfileRole | null;
  role: HubUserRole;
  status: string;
};

type ListHubUserAssignmentRow = {
  department_id?: string | null;
  hub_departments?: { name: string } | { name: string }[] | null;
  hub_sectors?: { name: string } | { name: string }[] | null;
  sector_id?: string | null;
  status: "active" | "archived" | "disabled";
  user_id: string;
};

const operationalProfiles = ["op1", "op2", "op3", "ldr", "cdr", "adm"] as const;
const userStatuses = ["active", "disabled"] as const;

export async function GET(request: NextRequest) {
  const serverEnv = process.env as Record<string, string | undefined>;
  const supabaseUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          "Configure a chave server-side para carregar vinculos de usuarios.",
      },
      { status: 503 },
    );
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json({ error: "Sessao administrativa ausente." }, { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: authData, error: authError } = await adminClient.auth.getUser(
    accessToken,
  );

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Sessao administrativa invalida." }, { status: 401 });
  }

  const { data: currentUser, error: currentUserError } = await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: HubUserRole; status: string }>();

  if (currentUserError || currentUser?.role !== "admin" || currentUser.status !== "active") {
    return NextResponse.json({ error: "Apenas administradores podem listar usuarios." }, { status: 403 });
  }

  const result = await adminClient
    .from("hub_users")
    .select("id,email,display_name,avatar_url,role,operational_profile,status")
    .order("display_name");
  const users =
    result.error?.message.includes("operational_profile")
      ? await adminClient
          .from("hub_users")
          .select("id,email,display_name,avatar_url,role,status")
          .order("display_name")
      : result;

  if (users.error) {
    logSetupUsersApi("list error", {
      error: serializeServerError(users.error),
      reason: "users list failed",
      table: "hub_users",
    });
    return NextResponse.json(
      { error: "Nao foi possivel carregar usuarios." },
      { status: 500 },
    );
  }

  const { data: assignments, error: assignmentsError } = await adminClient
    .from("hub_user_assignments")
    .select(
      "user_id,department_id,sector_id,status,hub_departments(name),hub_sectors:hub_sectors!hub_user_assignments_sector_department_fk(name),created_at",
    )
    .order("created_at", { ascending: false });

  if (assignmentsError) {
    logSetupUsersApi("list error", {
      error: serializeServerError(assignmentsError),
      reason: "assignments list failed",
      table: "hub_user_assignments",
    });
    return NextResponse.json(
      { error: "Nao foi possivel carregar vinculos de usuarios." },
      { status: 500 },
    );
  }

  const assignmentsByUser = new Map<string, ListHubUserAssignmentRow[]>();

  for (const assignment of (assignments ?? []) as ListHubUserAssignmentRow[]) {
    const currentAssignments = assignmentsByUser.get(assignment.user_id) ?? [];
    currentAssignments.push(assignment);
    assignmentsByUser.set(assignment.user_id, currentAssignments);
  }

  return NextResponse.json({
    data: ((users.data ?? []) as ListHubUserRow[]).map((user) => ({
      ...user,
      hub_user_assignments: assignmentsByUser.get(user.id) ?? [],
    })),
  });
}

export async function PATCH(request: NextRequest) {
  const serverEnv = process.env as Record<string, string | undefined>;
  const supabaseUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          "Configure a chave server-side para habilitar edicao de usuarios.",
      },
      { status: 503 },
    );
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json({ error: "Sessao administrativa ausente." }, { status: 401 });
  }

  const payload = parseAssignmentPayload(await request.json().catch(() => null));

  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: authData, error: authError } = await adminClient.auth.getUser(
    accessToken,
  );

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Sessao administrativa invalida." }, { status: 401 });
  }

  const { data: currentUser, error: currentUserError } = await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: HubUserRole; status: string }>();

  if (currentUserError || currentUser?.role !== "admin" || currentUser.status !== "active") {
    return NextResponse.json({ error: "Apenas administradores podem editar usuarios." }, { status: 403 });
  }

  const { data: sector, error: sectorError } = await adminClient
    .from("hub_sectors")
    .select("id,department_id")
    .eq("id", payload.data.sectorId)
    .eq("department_id", payload.data.departmentId)
    .maybeSingle<{ department_id: string; id: string }>();

  if (sectorError || !sector) {
    return NextResponse.json(
      { error: "Selecione um setor valido para o departamento." },
      { status: 400 },
    );
  }

  const role = mapProfileToHubRole(payload.data.profile);
  const { data: targetAuthUser } = await adminClient.auth.admin.getUserById(
    payload.data.userId,
  );
  const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(
    payload.data.userId,
    {
      app_metadata: {
        ...(targetAuthUser.user?.app_metadata ?? {}),
        role,
      },
      email: payload.data.email,
      email_confirm: true,
      user_metadata: {
        ...(targetAuthUser.user?.user_metadata ?? {}),
        avatar_url: payload.data.avatarUrl || null,
        full_name: payload.data.fullName,
        name: payload.data.fullName,
        operational_profile: payload.data.profile,
      },
    },
  );

  if (authUpdateError) {
    logSetupUsersApi("patch error", {
      error: serializeServerError(authUpdateError),
      reason: "auth metadata update failed",
    });
    return NextResponse.json(
      { error: "Nao foi possivel atualizar o perfil no Supabase Auth." },
      { status: 500 },
    );
  }

  const { error: profileError } = await adminClient
    .from("hub_users")
    .update({
      avatar_url: payload.data.avatarUrl || null,
      display_name: payload.data.fullName,
      email: payload.data.email,
      operational_profile: payload.data.profile,
      role,
      status: payload.data.status,
    })
    .eq("id", payload.data.userId);

  if (profileError) {
    logSetupUsersApi("patch error", {
      error: serializeServerError(profileError),
      reason: "hub profile update failed",
      table: "hub_users",
    });
    return NextResponse.json(
      { error: "Nao foi possivel atualizar o perfil operacional." },
      { status: 500 },
    );
  }

  const { error: archiveError } = await adminClient
    .from("hub_user_assignments")
    .update({ status: "archived" })
    .eq("user_id", payload.data.userId)
    .eq("is_primary", true)
    .eq("status", "active");

  if (archiveError) {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar o vinculo anterior." },
      { status: 500 },
    );
  }

  const { error: assignmentError } = await adminClient
    .from("hub_user_assignments")
    .insert({
      department_id: payload.data.departmentId,
      is_primary: true,
      sector_id: payload.data.sectorId,
      status: payload.data.status,
      title: payload.data.profile,
      user_id: payload.data.userId,
    });

  if (assignmentError) {
    logSetupUsersApi("patch error", {
      error: serializeServerError(assignmentError),
      reason: "assignment create failed",
      table: "hub_user_assignments",
    });
    return NextResponse.json(
      { error: "Nao foi possivel vincular o usuario ao setor." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  const serverEnv = process.env as Record<string, string | undefined>;
  const supabaseUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

  logSetupUsersApi("start", {
    endpoint: "/api/setup/users",
    hasAnonKey: Boolean(anonKey),
    hasServiceRoleKey: Boolean(serviceRoleKey),
    supabaseUrl: maskSupabaseUrl(supabaseUrl),
  });

  if (!supabaseUrl) {
    logSetupUsersApi("error", {
      reason: "missing server env",
      hasAnonKey: Boolean(anonKey),
      hasServiceRoleKey: Boolean(serviceRoleKey),
      supabaseUrl: maskSupabaseUrl(supabaseUrl),
    });
    return NextResponse.json(
      {
        error:
          "Configure a chave server-side para habilitar criacao de usuarios.",
      },
      { status: 503 },
    );
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    logSetupUsersApi("error", {
      reason: "missing bearer token",
    });
    return NextResponse.json({ error: "Sessao administrativa ausente." }, { status: 401 });
  }

  const payload = parsePayload(await request.json().catch(() => null));

  if (!payload.ok) {
    logSetupUsersApi("error", {
      reason: "invalid payload",
      message: payload.error,
    });
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  if (!serviceRoleKey) {
    return createOperationalUserWithSignupFallback({
      accessToken,
      anonKey,
      payload: payload.data,
      supabaseUrl,
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: authData, error: authError } = await adminClient.auth.getUser(
    accessToken,
  );

  if (authError || !authData.user) {
    logSetupUsersApi("error", {
      error: serializeServerError(authError),
      reason: "invalid admin session",
    });
    return NextResponse.json({ error: "Sessao administrativa invalida." }, { status: 401 });
  }

  const { data: currentUser, error: currentUserError } = await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: HubUserRole; status: string }>();

  if (currentUserError || currentUser?.role !== "admin" || currentUser.status !== "active") {
    logSetupUsersApi("error", {
      currentUser,
      error: serializeServerError(currentUserError),
      reason: "admin profile denied",
      table: "hub_users",
      userId: authData.user.id,
    });
    return NextResponse.json({ error: "Apenas administradores podem criar usuarios." }, { status: 403 });
  }

  const { data: sector, error: sectorError } = await adminClient
    .from("hub_sectors")
    .select("id,department_id")
    .eq("id", payload.data.sectorId)
    .eq("department_id", payload.data.departmentId)
    .maybeSingle<{ department_id: string; id: string }>();

  if (sectorError || !sector) {
    logSetupUsersApi("error", {
      error: serializeServerError(sectorError),
      reason: "invalid sector",
      table: "hub_sectors",
    });
    return NextResponse.json(
      { error: "Selecione um setor valido para o departamento." },
      { status: 400 },
    );
  }

  const role = mapProfileToHubRole(payload.data.profile);
  const { data: createdAuthUser, error: createAuthError } =
    await adminClient.auth.admin.createUser({
      app_metadata: {
        role,
      },
      email: payload.data.email,
      email_confirm: true,
      password: payload.data.password,
      user_metadata: {
        full_name: payload.data.fullName,
        name: payload.data.fullName,
        operational_profile: payload.data.profile,
      },
    });

  if (createAuthError || !createdAuthUser.user) {
    logSetupUsersApi("error", {
      error: serializeServerError(createAuthError),
      reason: "auth user create failed",
    });
    return NextResponse.json(
      { error: getCreateAuthErrorMessage(createAuthError?.message) },
      { status: 400 },
    );
  }

  const profilePayload = {
    display_name: payload.data.fullName,
    email: payload.data.email,
    id: createdAuthUser.user.id,
    operational_profile: payload.data.profile,
    role,
    status: payload.data.status,
  };
  const { error: profileError } = await adminClient
    .from("hub_users")
    .upsert(profilePayload, { onConflict: "id" });

  if (profileError) {
    const fallbackProfilePayload = {
      display_name: payload.data.fullName,
      email: payload.data.email,
      id: createdAuthUser.user.id,
      role,
      status: payload.data.status,
    };
    const { error: fallbackProfileError } = await adminClient
      .from("hub_users")
      .upsert(fallbackProfilePayload, { onConflict: "id" });

    if (fallbackProfileError) {
      await adminClient.auth.admin.deleteUser(createdAuthUser.user.id);

      logSetupUsersApi("error", {
        error: serializeServerError(fallbackProfileError),
        reason: "hub profile create failed",
        table: "hub_users",
      });
      return NextResponse.json(
        { error: "Nao foi possivel criar o perfil operacional." },
        { status: 500 },
      );
    }
  }

  await adminClient
    .from("hub_user_assignments")
    .update({ status: "archived" })
    .eq("user_id", createdAuthUser.user.id)
    .eq("is_primary", true)
    .eq("status", "active");

  const { error: assignmentError } = await adminClient
    .from("hub_user_assignments")
    .insert({
      department_id: payload.data.departmentId,
      is_primary: true,
      sector_id: payload.data.sectorId,
      status: payload.data.status,
      title: payload.data.profile,
      user_id: createdAuthUser.user.id,
    });

  if (assignmentError) {
    await adminClient.auth.admin.deleteUser(createdAuthUser.user.id);

    logSetupUsersApi("error", {
      error: serializeServerError(assignmentError),
      reason: "assignment create failed",
      table: "hub_user_assignments",
    });
    return NextResponse.json(
      { error: "Nao foi possivel vincular o usuario ao setor." },
      { status: 500 },
    );
  }

  logSetupUsersApi("done", {
    createdUserId: createdAuthUser.user.id,
    table: "hub_users",
  });

  return NextResponse.json({
    user: {
      email: payload.data.email,
      id: createdAuthUser.user.id,
      name: payload.data.fullName,
      profile: payload.data.profile,
      role,
      status: payload.data.status,
    },
  });
}

async function createOperationalUserWithSignupFallback({
  accessToken,
  anonKey,
  payload,
  supabaseUrl,
}: {
  accessToken: string;
  anonKey?: string;
  payload: ParsedOperationalUserPayload;
  supabaseUrl: string;
}) {
  if (!anonKey) {
    logSetupUsersApi("error", {
      reason: "missing anon key for signup fallback",
    });
    return NextResponse.json(
      {
        error:
          "Configure a chave publica do Supabase para habilitar criacao de usuarios.",
      },
      { status: 503 },
    );
  }

  logSetupUsersApi("fallback", {
    reason: "service role missing",
  });

  const authenticatedClient = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
  const { data: authData, error: authError } =
    await authenticatedClient.auth.getUser(accessToken);

  if (authError || !authData.user) {
    logSetupUsersApi("error", {
      error: serializeServerError(authError),
      reason: "invalid fallback admin session",
    });
    return NextResponse.json({ error: "Sessao administrativa invalida." }, { status: 401 });
  }

  const { data: currentUser, error: currentUserError } = await authenticatedClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: HubUserRole; status: string }>();

  if (currentUserError || currentUser?.role !== "admin" || currentUser.status !== "active") {
    logSetupUsersApi("error", {
      currentUser,
      error: serializeServerError(currentUserError),
      reason: "fallback admin profile denied",
      table: "hub_users",
      userId: authData.user.id,
    });
    return NextResponse.json({ error: "Apenas administradores podem criar usuarios." }, { status: 403 });
  }

  const { data: sector, error: sectorError } = await authenticatedClient
    .from("hub_sectors")
    .select("id,department_id")
    .eq("id", payload.sectorId)
    .eq("department_id", payload.departmentId)
    .maybeSingle<{ department_id: string; id: string }>();

  if (sectorError || !sector) {
    logSetupUsersApi("error", {
      error: serializeServerError(sectorError),
      reason: "invalid fallback sector",
      table: "hub_sectors",
    });
    return NextResponse.json(
      { error: "Selecione um setor valido para o departamento." },
      { status: 400 },
    );
  }

  const role = mapProfileToHubRole(payload.profile);
  const signupClient = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: createdAuthUser, error: createAuthError } =
    await signupClient.auth.signUp({
      email: payload.email,
      options: {
        data: {
          full_name: payload.fullName,
          name: payload.fullName,
          operational_profile: payload.profile,
          role,
        },
      },
      password: payload.password,
    });

  if (
    createAuthError ||
    !createdAuthUser.user ||
    createdAuthUser.user.identities?.length === 0
  ) {
    logSetupUsersApi("error", {
      error: serializeServerError(createAuthError),
      reason: "fallback auth user signup failed",
    });
    return NextResponse.json(
      { error: getCreateAuthErrorMessage(createAuthError?.message) },
      { status: 400 },
    );
  }

  const { data: profile, error: profileError } = await authenticatedClient
    .from("hub_users")
    .update({
      display_name: payload.fullName,
      email: payload.email,
      operational_profile: payload.profile,
      role,
      status: payload.status,
    })
    .eq("id", createdAuthUser.user.id)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (profileError || !profile) {
    logSetupUsersApi("error", {
      error: serializeServerError(profileError),
      reason: "fallback hub profile update failed",
      table: "hub_users",
    });
    return NextResponse.json(
      { error: "Nao foi possivel criar o perfil operacional." },
      { status: 500 },
    );
  }

  await authenticatedClient
    .from("hub_user_assignments")
    .update({ status: "archived" })
    .eq("user_id", createdAuthUser.user.id)
    .eq("is_primary", true)
    .eq("status", "active");

  const { error: assignmentError } = await authenticatedClient
    .from("hub_user_assignments")
    .insert({
      department_id: payload.departmentId,
      is_primary: true,
      sector_id: payload.sectorId,
      status: payload.status,
      title: payload.profile,
      user_id: createdAuthUser.user.id,
    });

  if (assignmentError) {
    logSetupUsersApi("error", {
      error: serializeServerError(assignmentError),
      reason: "fallback assignment create failed",
      table: "hub_user_assignments",
    });
    return NextResponse.json(
      { error: "Nao foi possivel vincular o usuario ao setor." },
      { status: 500 },
    );
  }

  logSetupUsersApi("done", {
    authMode: "signup_fallback",
    createdUserId: createdAuthUser.user.id,
    table: "hub_users",
  });

  return NextResponse.json({
    user: {
      email: payload.email,
      id: createdAuthUser.user.id,
      name: payload.fullName,
      profile: payload.profile,
      role,
      status: payload.status,
    },
  });
}

function logSetupUsersApi(event: string, detail?: unknown) {
  const logger = event.includes("error") ? console.warn : console.debug;
  logger(`[setup-api] users ${event}`, detail ?? "");
}

function serializeServerError(error: unknown) {
  if (!error || typeof error !== "object") {
    return error;
  }

  const maybeError = error as {
    code?: unknown;
    details?: unknown;
    hint?: unknown;
    message?: unknown;
    name?: unknown;
  };

  return {
    code: maybeError.code,
    details: maybeError.details,
    hint: maybeError.hint,
    message: maybeError.message,
    name: maybeError.name,
  };
}

function maskSupabaseUrl(url?: string) {
  if (!url) {
    return "missing";
  }

  try {
    const parsedUrl = new URL(url);
    const [projectRef = "unknown"] = parsedUrl.hostname.split(".");

    return `${parsedUrl.protocol}//${projectRef.slice(0, 4)}...${projectRef.slice(-4)}.${parsedUrl.hostname
      .split(".")
      .slice(1)
      .join(".")}`;
  } catch {
    return "invalid-url";
  }
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

function parsePayload(payload: unknown):
  | {
      data: ParsedOperationalUserPayload;
      ok: true;
    }
  | { error: string; ok: false } {
  if (!payload || typeof payload !== "object") {
    return { error: "Informe os dados do usuario.", ok: false };
  }

  const input = payload as CreateOperationalUserPayload;
  const fullName = getString(input.fullName);
  const email = getString(input.email).toLowerCase();
  const password = getString(input.password);
  const departmentId = getString(input.departmentId);
  const sectorId = getString(input.sectorId);
  const profile = getString(input.profile);
  const status = getString(input.status);

  if (!fullName || !email || !password || !departmentId || !sectorId) {
    return { error: "Preencha todos os campos obrigatorios.", ok: false };
  }

  if (!email.includes("@")) {
    return { error: "Informe um e-mail valido.", ok: false };
  }

  if (password.length < 8) {
    return { error: "A senha temporaria deve ter pelo menos 8 caracteres.", ok: false };
  }

  if (!isOperationalProfile(profile)) {
    return { error: "Selecione um perfil valido.", ok: false };
  }

  if (!isUserStatus(status)) {
    return { error: "Selecione um status valido.", ok: false };
  }

  return {
    data: {
      departmentId,
      email,
      fullName,
      password,
      profile,
      sectorId,
      status,
    },
    ok: true,
  };
}

function parseAssignmentPayload(payload: unknown):
  | {
      data: {
        avatarUrl?: string;
        departmentId: string;
        email: string;
        fullName: string;
        profile: OperationalProfileRole;
        sectorId: string;
        status: SetupUserStatus;
        userId: string;
      };
      ok: true;
    }
  | { error: string; ok: false } {
  if (!payload || typeof payload !== "object") {
    return { error: "Informe os dados do usuario.", ok: false };
  }

  const input = payload as UpdateOperationalUserPayload;
  const avatarUrl = getString(input.avatarUrl);
  const departmentId = getString(input.departmentId);
  const email = getString(input.email).toLowerCase();
  const fullName = getString(input.fullName);
  const profile = getString(input.profile);
  const sectorId = getString(input.sectorId);
  const status = getString(input.status);
  const userId = getString(input.userId);

  if (!userId || !fullName || !email || !departmentId || !sectorId) {
    return { error: "Preencha nome, e-mail, departamento e setor.", ok: false };
  }

  if (!email.includes("@")) {
    return { error: "Informe um e-mail valido.", ok: false };
  }

  if (!isOperationalProfile(profile)) {
    return { error: "Selecione um perfil valido.", ok: false };
  }

  if (!isUserStatus(status)) {
    return { error: "Selecione um status valido.", ok: false };
  }

  return {
    data: {
      avatarUrl,
      departmentId,
      email,
      fullName,
      profile,
      sectorId,
      status,
      userId,
    },
    ok: true,
  };
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isOperationalProfile(value: string): value is OperationalProfileRole {
  return operationalProfiles.some((profile) => profile === value);
}

function isUserStatus(value: string): value is SetupUserStatus {
  return userStatuses.some((status) => status === value);
}

function mapProfileToHubRole(profile: OperationalProfileRole): HubUserRole {
  if (profile === "adm") {
    return "admin";
  }

  if (profile === "ldr" || profile === "cdr") {
    return "leader";
  }

  return "operator";
}

function getCreateAuthErrorMessage(message?: string) {
  const normalizedMessage = message?.toLowerCase() ?? "";

  if (normalizedMessage.includes("already registered")) {
    return "Este e-mail ja esta cadastrado.";
  }

  return "Nao foi possivel criar o usuario no Supabase Auth.";
}
