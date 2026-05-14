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

const operationalProfiles = ["op1", "op2", "op3", "ldr", "cdr", "adm"] as const;
const userStatuses = ["active", "disabled"] as const;

export async function POST(request: NextRequest) {
  const serverEnv = process.env as Record<string, string | undefined>;
  const supabaseUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

  logSetupUsersApi("start", {
    endpoint: "/api/setup/users",
    hasServiceRoleKey: Boolean(serviceRoleKey),
    supabaseUrl: maskSupabaseUrl(supabaseUrl),
  });

  if (!supabaseUrl || !serviceRoleKey) {
    logSetupUsersApi("error", {
      reason: "missing server env",
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
      data: {
        departmentId: string;
        email: string;
        fullName: string;
        password: string;
        profile: OperationalProfileRole;
        sectorId: string;
        status: SetupUserStatus;
      };
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
