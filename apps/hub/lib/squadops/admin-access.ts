import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

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

type SquadOpsAdminAccessResult =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      response: NextResponse<{ error: string }>;
    };

export async function authorizeSquadOpsAdminRequest(
  request: NextRequest,
): Promise<SquadOpsAdminAccessResult> {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao administrativa ausente para acessar o SquadOps." },
        { status: 401 },
      ),
    };
  }

  const serverEnv = process.env as Record<string, string | undefined>;
  const supabaseUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Configure a chave server-side para validar acesso ao SquadOps." },
        { status: 503 },
      ),
    };
  }

  const adminClient = createClient<SquadOpsAdminDatabase>(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
  const { data: authData, error: authError } =
    await adminClient.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao administrativa invalida para acessar o SquadOps." },
        { status: 401 },
      ),
    };
  }

  const userResult = await loadSquadOpsUser(adminClient, authData.user.id);

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
