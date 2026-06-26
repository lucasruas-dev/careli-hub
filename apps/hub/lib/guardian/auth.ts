import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

type HubUserRow = { id: string; role: string; status: string };

// Roles do Hub que podem LER os dados operacionais do Hades (fila/cliente).
const HADES_READ_ROLES = ["admin", "leader", "operator", "viewer"];

export type HadesAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);

  return match?.[1] ?? "";
}

// Garante que so um usuario autenticado e ATIVO do Hub leia os dados sensiveis
// da cobranca (PII do legado C2X). A pagina ja envia o Bearer da sessao Supabase;
// aqui o servidor valida. Em dev/local sem Supabase configurado, libera (mesmo
// padrao do boleto-resend), pois nao ha sessao real.
export async function authorizeHadesRead(
  request: Request,
): Promise<HadesAuthResult> {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!url || !serviceRoleKey) {
    return { ok: true, userId: "local-hub-user" };
  }

  const token = getBearerToken(request);

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sessao ausente." }, { status: 401 }),
    };
  }

  const adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } =
    await adminClient.auth.getUser(token);

  if (authError || !authData.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao invalida." },
        { status: 401 },
      ),
    };
  }

  const { data: user, error: userError } = await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<HubUserRow>();

  if (
    userError ||
    !user ||
    user.status !== "active" ||
    !HADES_READ_ROLES.includes(user.role)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuario sem acesso operacional ao Hades." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, userId: user.id };
}
