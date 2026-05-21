import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

export type IrisMetaRole = "admin" | "leader" | "operator" | "viewer";

type IrisMetaUser = {
  id: string;
  role: IrisMetaRole;
  status: string;
};

const DEFAULT_ALLOWED_ROLES: IrisMetaRole[] = ["admin", "leader", "operator"];

export function createIrisMetaAdminClient() {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function authorizeIrisMetaRequest(
  request: NextRequest,
  allowedRoles: IrisMetaRole[] = DEFAULT_ALLOWED_ROLES,
) {
  const client = createIrisMetaAdminClient();

  if (!client) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Persistencia server-side do Iris nao configurada." },
        { status: 503 },
      ),
    };
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sessao do Iris ausente." },
        { status: 401 },
      ),
    };
  }

  const { data: authData, error: authError } =
    await client.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sessao do Iris invalida." },
        { status: 401 },
      ),
    };
  }

  const { data: user, error: userError } = await client
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<IrisMetaUser>();

  if (
    userError ||
    !user ||
    user.status !== "active" ||
    !allowedRoles.includes(user.role)
  ) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Usuario sem permissao para operar a integracao Meta." },
        { status: 403 },
      ),
    };
  }

  return {
    client,
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
