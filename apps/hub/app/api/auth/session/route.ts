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

type SessionPayload = {
  accessToken?: string;
  refreshToken?: string;
};

type SupabaseUserPayload = {
  app_metadata?: unknown;
  email?: unknown;
  id?: unknown;
  user_metadata?: unknown;
};

type SupabaseAuthPayload = {
  access_token?: unknown;
  error?: unknown;
  error_description?: unknown;
  expires_at?: unknown;
  expires_in?: unknown;
  message?: unknown;
  msg?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  user?: unknown;
};

const AUTH_TIMEOUT_MS = 15_000;
const hubUserRoles = ["admin", "leader", "operator", "viewer"] as const;
const hubUserStatuses = ["active", "archived", "disabled"] as const;

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: "Supabase nao configurado no servidor." },
      { status: 503 },
    );
  }

  const payload = parseSessionPayload(await request.json().catch(() => null));

  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  const config = {
    anonKey,
    supabaseUrl: supabaseUrl.replace(/\/+$/, ""),
  };
  let session = createSessionPayload(payload.data);
  let user = await getSupabaseUser(config, session.access_token);

  if (!user.ok && session.refresh_token) {
    const refreshResult = await refreshSupabaseSession(config, session.refresh_token);

    if (refreshResult.ok) {
      session = refreshResult.session;
      user = getUserFromAuthPayload(refreshResult.rawSession);

      if (!user.ok) {
        user = await getSupabaseUser(config, session.access_token);
      }
    }
  }

  if (!user.ok) {
    return NextResponse.json(
      { error: user.error },
      { status: user.status },
    );
  }

  const profile = await loadHubProfile(config, {
    accessToken: session.access_token,
    userId: user.user.id,
  });

  if (!profile.ok) {
    return NextResponse.json(
      { error: profile.error },
      { status: profile.status },
    );
  }

  return NextResponse.json({
    profile: profile.profile,
    session,
  });
}

function parseSessionPayload(input: unknown):
  | {
      data: SessionPayload;
      ok: true;
    }
  | {
      error: string;
      ok: false;
    } {
  if (!input || typeof input !== "object") {
    return {
      error: "Sessao ausente.",
      ok: false,
    };
  }

  const maybePayload = input as {
    accessToken?: unknown;
    refreshToken?: unknown;
  };
  const accessToken =
    typeof maybePayload.accessToken === "string"
      ? maybePayload.accessToken.trim()
      : "";
  const refreshToken =
    typeof maybePayload.refreshToken === "string"
      ? maybePayload.refreshToken.trim()
      : "";

  if (!accessToken && !refreshToken) {
    return {
      error: "Sessao ausente.",
      ok: false,
    };
  }

  return {
    data: {
      accessToken: accessToken || undefined,
      refreshToken: refreshToken || undefined,
    },
    ok: true,
  };
}

function createSessionPayload(input: SessionPayload) {
  return {
    access_token: input.accessToken,
    refresh_token: input.refreshToken,
  };
}

async function getSupabaseUser(
  config: { anonKey: string; supabaseUrl: string },
  accessToken?: string,
): Promise<
  | {
      ok: true;
      user: { email?: string; id: string };
    }
  | {
      error: string;
      ok: false;
      status: number;
    }
> {
  if (!accessToken) {
    return {
      error: "Sessao ausente.",
      ok: false,
      status: 401,
    };
  }

  try {
    const response = await fetchWithTimeout(`${config.supabaseUrl}/auth/v1/user`, {
      cache: "no-store",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const payload = (await response.json().catch(() => null)) as
      | SupabaseUserPayload
      | null;

    if (!response.ok) {
      return {
        error: getAuthPayloadMessage(payload),
        ok: false,
        status: response.status === 400 ? 401 : response.status,
      };
    }

    return parseSupabaseUser(payload);
  } catch (error) {
    return {
      error: getServerAuthErrorMessage(error),
      ok: false,
      status: 503,
    };
  }
}

async function refreshSupabaseSession(
  config: { anonKey: string; supabaseUrl: string },
  refreshToken: string,
): Promise<
  | {
      ok: true;
      rawSession: SupabaseAuthPayload;
      session: ReturnType<typeof createSessionPayload> & {
        expires_at?: unknown;
        expires_in?: unknown;
        token_type?: unknown;
        user?: unknown;
      };
    }
  | {
      error: string;
      ok: false;
      status: number;
    }
> {
  try {
    const response = await fetchWithTimeout(
      `${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        body: JSON.stringify({ refresh_token: refreshToken }),
        cache: "no-store",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      },
    );
    const authPayload = (await response.json().catch(() => null)) as
      | SupabaseAuthPayload
      | null;

    if (!response.ok || !authPayload) {
      return {
        error: getAuthPayloadMessage(authPayload),
        ok: false,
        status: response.status === 400 ? 401 : response.status,
      };
    }

    if (
      typeof authPayload.access_token !== "string" ||
      typeof authPayload.refresh_token !== "string"
    ) {
      return {
        error: "Supabase nao retornou uma sessao valida.",
        ok: false,
        status: 502,
      };
    }

    return {
      ok: true,
      rawSession: authPayload,
      session: {
        access_token: authPayload.access_token,
        expires_at: authPayload.expires_at,
        expires_in: authPayload.expires_in,
        refresh_token: authPayload.refresh_token,
        token_type: authPayload.token_type,
        user: authPayload.user,
      },
    };
  } catch (error) {
    return {
      error: getServerAuthErrorMessage(error),
      ok: false,
      status: 503,
    };
  }
}

async function loadHubProfile(
  config: { anonKey: string; supabaseUrl: string },
  input: { accessToken?: string; userId: string },
): Promise<
  | {
      ok: true;
      profile: HubProfileRow;
    }
  | {
      error: string;
      ok: false;
      status: number;
    }
> {
  if (!input.accessToken) {
    return {
      error: "Sessao ausente.",
      ok: false,
      status: 401,
    };
  }

  try {
    const response = await fetchWithTimeout(
      `${config.supabaseUrl}/rest/v1/hub_users?id=eq.${encodeURIComponent(
        input.userId,
      )}&select=id,email,display_name,avatar_url,role,status`,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          apikey: config.anonKey,
          Authorization: `Bearer ${input.accessToken}`,
        },
      },
    );
    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      return {
        error: getAuthPayloadMessage(payload),
        ok: false,
        status: response.status,
      };
    }

    if (!Array.isArray(payload) || !payload[0]) {
      return {
        error: "Perfil operacional ausente.",
        ok: false,
        status: 404,
      };
    }

    const profile = payload[0] as HubProfileRow;

    if (!isHubUserRole(profile.role) || !isHubUserStatus(profile.status)) {
      return {
        error: "Perfil operacional invalido.",
        ok: false,
        status: 403,
      };
    }

    return {
      ok: true,
      profile,
    };
  } catch (error) {
    return {
      error: getServerAuthErrorMessage(error),
      ok: false,
      status: 503,
    };
  }
}

function getUserFromAuthPayload(payload: SupabaseAuthPayload) {
  return parseSupabaseUser(payload.user);
}

function parseSupabaseUser(input: unknown):
  | {
      ok: true;
      user: { email?: string; id: string };
    }
  | {
      error: string;
      ok: false;
      status: number;
    } {
  if (!input || typeof input !== "object") {
    return {
      error: "Sessao invalida.",
      ok: false,
      status: 401,
    };
  }

  const maybeUser = input as SupabaseUserPayload;

  if (typeof maybeUser.id !== "string" || !maybeUser.id.trim()) {
    return {
      error: "Sessao invalida.",
      ok: false,
      status: 401,
    };
  }

  return {
    ok: true,
    user: {
      email: typeof maybeUser.email === "string" ? maybeUser.email : undefined,
      id: maybeUser.id,
    },
  };
}

function isHubUserRole(value: string): value is HubUserRole {
  return hubUserRoles.some((role) => role === value);
}

function isHubUserStatus(
  value: string,
): value is HubProfileRow["status"] {
  return hubUserStatuses.some((status) => status === value);
}

function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

  return fetch(input, {
    ...init,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));
}

function getAuthPayloadMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "Nao foi possivel autenticar com Supabase.";
  }

  const maybePayload = payload as SupabaseAuthPayload;

  for (const value of [
    maybePayload.msg,
    maybePayload.message,
    maybePayload.error_description,
    maybePayload.error,
  ]) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "Nao foi possivel autenticar com Supabase.";
}

function getServerAuthErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Tempo excedido ao conectar ao Supabase.";
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Nao foi possivel conectar ao Supabase.";
}
