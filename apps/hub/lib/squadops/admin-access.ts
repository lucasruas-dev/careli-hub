import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

type SquadOpsUserRow = {
  id: string;
  operational_profile?: string | null;
  role: HubUserRole;
  status: string;
};

type SquadOpsAdminDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: SquadOpsUserRow;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type SquadOpsAdminClient = ReturnType<
  typeof createClient<SquadOpsAdminDatabase>
>;

type SquadOpsAccessClientResult =
  | {
      client: SquadOpsAdminClient;
      ok: true;
    }
  | {
      ok: false;
      response: NextResponse<{ error: string }>;
    };

type SquadOpsAdminAccessResult =
  | {
      ok: true;
      userId: string | null;
    }
  | {
      ok: false;
      response: NextResponse<{ error: string }>;
    };

const SQUADOPS_AUTH_TIMEOUT_MS = 12_000;

export async function authorizeSquadOpsAdminRequest(
  request: NextRequest,
): Promise<SquadOpsAdminAccessResult> {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    if (isLocalSquadOpsDevelopmentRequest(request)) {
      return {
        ok: true,
        userId: null,
      };
    }

    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao administrativa ausente para acessar o SquadOps." },
        { status: 401 },
      ),
    };
  }

  const clientResult = createSquadOpsAccessClient(accessToken);

  if (!clientResult.ok) {
    return {
      ok: false,
      response: clientResult.response,
    };
  }

  const adminClient = clientResult.client;
  const authResult = await validateSquadOpsAccessToken(accessToken);

  if (!authResult.ok) {
    return {
      ok: false,
      response: authResult.response,
    };
  }

  const userResult = await loadSquadOpsUser(adminClient, authResult.userId);

  if (!userResult.ok) {
    return {
      ok: false,
      response: userResult.response,
    };
  }

  if (!isSquadOpsAdmin(userResult.user)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "SquadOps e liberado somente para perfil adm." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    userId: userResult.user.id,
  };
}

async function validateSquadOpsAccessToken(
  accessToken: string,
): Promise<
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: NextResponse<{ error: string }>;
    }
> {
  const {
    anonKey,
    serviceRoleKey,
    url: supabaseUrl,
  } = getServerSupabaseConfig();
  const apiKey = anonKey ?? serviceRoleKey;

  if (!supabaseUrl) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Configure a URL do Supabase para validar acesso ao SquadOps." },
        { status: 503 },
      ),
    };
  }

  if (!apiKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Configure as chaves Supabase para validar acesso ao SquadOps." },
        { status: 503 },
      ),
    };
  }

  try {
    const response = await fetchWithTimeout(
      `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`,
      {
        cache: "no-store",
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | {
          id?: unknown;
        }
      | null;

    if (!response.ok || typeof payload?.id !== "string" || !payload.id.trim()) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Sessao administrativa invalida para acessar o SquadOps." },
          { status: 401 },
        ),
      };
    }

    return {
      ok: true,
      userId: payload.id,
    };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Nao foi possivel validar sua sessao SquadOps no Supabase." },
        { status: 503 },
      ),
    };
  }
}

function createSquadOpsAccessClient(
  accessToken: string,
): SquadOpsAccessClientResult {
  const {
    anonKey,
    serviceRoleKey,
    url: supabaseUrl,
  } = getServerSupabaseConfig();

  if (!supabaseUrl) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Configure a URL do Supabase para validar acesso ao SquadOps." },
        { status: 503 },
      ),
    };
  }

  if (serviceRoleKey) {
    return {
      ok: true,
      client: createClient<SquadOpsAdminDatabase>(supabaseUrl, serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }),
    };
  }

  if (!anonKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Configure as chaves Supabase para validar acesso ao SquadOps." },
        { status: 503 },
      ),
    };
  }

  return {
    ok: true,
    client: createClient<SquadOpsAdminDatabase>(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }),
  };
}

async function loadSquadOpsUser(
  adminClient: SquadOpsAdminClient,
  userId: string,
): Promise<
  | {
      ok: true;
      user: SquadOpsUserRow;
    }
  | {
      ok: false;
      response: NextResponse<{ error: string }>;
    }
> {
  const result = await adminClient
    .from("hub_users")
    .select("id,role,status,operational_profile")
    .eq("id", userId)
    .maybeSingle<SquadOpsUserRow>();

  if (!result.error) {
    if (!result.data || result.data.status !== "active") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Usuario sem acesso ativo ao SquadOps." },
          { status: 403 },
        ),
      };
    }

    return {
      ok: true,
      user: result.data,
    };
  }

  if (!result.error.message.includes("operational_profile")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Nao foi possivel validar seu perfil SquadOps." },
        { status: 503 },
      ),
    };
  }

  const legacyResult = await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", userId)
    .maybeSingle<SquadOpsUserRow>();

  if (
    legacyResult.error ||
    !legacyResult.data ||
    legacyResult.data.status !== "active"
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuario sem acesso ativo ao SquadOps." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    user: legacyResult.data,
  };
}

function isSquadOpsAdmin(user: SquadOpsUserRow) {
  return user.role === "admin" || user.operational_profile === "adm";
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    SQUADOPS_AUTH_TIMEOUT_MS,
  );

  return fetch(input, {
    ...init,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));
}

function isLocalSquadOpsDevelopmentRequest(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return false;
  }

  try {
    const hostname = new URL(request.url).hostname.toLowerCase();

    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}
