import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { sanitizeGuardianDbError } from "@/lib/guardian/db";
import { loadGuardianOverview } from "@/lib/guardian/overview";
import { loadGuardianOverviewReadModel } from "@/lib/guardian/read-model";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

type GuardianApiDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: {
          id: string;
          role: HubUserRole;
          status: string;
        };
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  try {
    const readModelSnapshot = await loadGuardianOverviewReadModel();

    if (readModelSnapshot) {
      return NextResponse.json({ data: readModelSnapshot, source: "supabase-c2x" });
    }

    const result = await loadGuardianOverview();

    if (!result.ok) {
      return NextResponse.json(
        {
          error: "Configure a conexao server-side do Guardian.",
          missing: result.missing,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Nao foi possivel carregar o Guardian.",
        detail: sanitizeGuardianDbError(error),
      },
      { status: 500 },
    );
  }
}

async function createAuthorizedContext(request: NextRequest) {
  const serverEnv = process.env as Record<string, string | undefined>;
  const supabaseUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Configure a chave server-side para carregar o Guardian." },
        { status: 503 },
      ),
    };
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sessao administrativa ausente." },
        { status: 401 },
      ),
    };
  }

  const adminClient = createClient<GuardianApiDatabase>(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
  const { data: authData, error: authError } = await adminClient.auth.getUser(
    accessToken,
  );

  if (authError || !authData.user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sessao administrativa invalida." },
        { status: 401 },
      ),
    };
  }

  const { data: user, error: userError } = await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: HubUserRole; status: string }>();

  if (userError || !user || user.status !== "active") {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Usuario sem acesso ao Guardian." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    user,
  };
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
