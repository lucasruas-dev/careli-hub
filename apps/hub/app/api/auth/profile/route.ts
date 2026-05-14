import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

type HubProfileRow = {
  avatar_url?: string | null;
  display_name: string;
  email: string;
  id: string;
  role: HubUserRole;
  status: "active" | "archived" | "disabled";
};

const hubUserRoles = ["admin", "leader", "operator", "viewer"] as const;
const hubUserStatuses = ["active", "archived", "disabled"] as const;

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  logProfileApi("start", {
    endpoint: "/api/auth/profile",
    hasAnonKey: Boolean(anonKey),
    supabaseUrl: maskSupabaseUrl(supabaseUrl),
  });

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: "Supabase nao configurado no servidor." },
      { status: 503 },
    );
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json(
      { error: "Sessao ausente." },
      { status: 401 },
    );
  }

  const supabase = createClient(supabaseUrl, anonKey, {
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
    await supabase.auth.getUser(accessToken);

  if (authError || !authData.user) {
    logProfileApi("error", {
      error: serializeServerError(authError),
      reason: "invalid session",
    });
    return NextResponse.json(
      { error: "Sessao invalida." },
      { status: 401 },
    );
  }

  try {
    const { data, error } = await supabase
      .from("hub_users")
      .select("id,email,display_name,avatar_url,role,status")
      .eq("id", authData.user.id)
      .maybeSingle<HubProfileRow>();

    if (error) {
      logProfileApi("error", {
        error: serializeServerError(error),
        reason: "profile query failed",
        table: "hub_users",
        userId: authData.user.id,
      });
      return NextResponse.json(
        { error: "Nao foi possivel carregar o perfil operacional." },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Perfil operacional ausente." },
        { status: 404 },
      );
    }

    if (!isHubUserRole(data.role) || !isHubUserStatus(data.status)) {
      return NextResponse.json(
        { error: "Perfil operacional invalido." },
        { status: 403 },
      );
    }

    logProfileApi("done", {
      role: data.role,
      status: data.status,
      table: "hub_users",
      userId: data.id,
    });

    return NextResponse.json({ profile: data });
  } catch (error) {
    logProfileApi("error", {
      error: serializeServerError(error),
      reason: "profile network failure",
      table: "hub_users",
      userId: authData.user.id,
    });
    return NextResponse.json(
      { error: "Nao foi possivel conectar ao Supabase." },
      { status: 503 },
    );
  }
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

function isHubUserRole(value: string): value is HubUserRole {
  return hubUserRoles.some((role) => role === value);
}

function isHubUserStatus(
  value: string,
): value is HubProfileRow["status"] {
  return hubUserStatuses.some((status) => status === value);
}

function logProfileApi(event: string, detail?: unknown) {
  const logger = event.includes("error") ? console.warn : console.debug;
  logger(`[auth-api] profile ${event}`, detail ?? "");
}

function serializeServerError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

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
