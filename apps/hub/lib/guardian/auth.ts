import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

type HubUserRow = { id: string; role: string; status: string };

type HubUserDetailRow = {
  display_name: string | null;
  email: string | null;
  id: string;
  role: string;
  status: string;
};

// Roles do Hub que podem LER os dados operacionais do Hades (fila/cliente).
const HADES_READ_ROLES = ["admin", "leader", "operator", "viewer"];

// Roles que podem ESCREVER (operar a cobranca). Espelha a policy "manage" da
// migration 0036 (admin/leader/operator — viewer e somente leitura).
const HADES_WRITE_ROLES = ["admin", "leader", "operator"];

// Aprovacao/reprovacao de proposta = SO Admin (decisao do Lucas, Fase 2).
const HADES_ADMIN_ROLES = ["admin"];

export type HadesAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse };

export type HadesAuthUser = {
  displayName: string | null;
  email: string | null;
  id: string;
  role: string;
};

export type HadesWriteAuthResult =
  | { ok: true; user: HadesAuthUser }
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

// Variante de ESCRITA: valida o Bearer e exige papel operador (admin/leader/
// operator), devolvendo a identidade do operador para gravar autoria e a nota
// na timeline. Em dev/local sem Supabase, libera com um operador sintetico.
export async function authorizeHadesWrite(
  request: Request,
): Promise<HadesWriteAuthResult> {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!url || !serviceRoleKey) {
    return {
      ok: true,
      user: {
        displayName: "Operador Hades",
        email: null,
        id: "local-hub-user",
        role: "operator",
      },
    };
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
    .select("id,role,status,display_name,email")
    .eq("id", authData.user.id)
    .maybeSingle<HubUserDetailRow>();

  if (
    userError ||
    !user ||
    user.status !== "active" ||
    !HADES_WRITE_ROLES.includes(user.role)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuario sem acesso operacional ao Hades." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    user: {
      displayName: user.display_name,
      email: user.email,
      id: user.id,
      role: user.role,
    },
  };
}

// Variante ADMIN: aprovar/reprovar proposta exige papel admin. Devolve a
// identidade do admin (autoria da decisao + nota na thread). Em dev/local sem
// Supabase, libera com um admin sintetico.
export async function authorizeHadesAdmin(
  request: Request,
): Promise<HadesWriteAuthResult> {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!url || !serviceRoleKey) {
    return {
      ok: true,
      user: {
        displayName: "Admin Hades",
        email: null,
        id: "local-hub-user",
        role: "admin",
      },
    };
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
    .select("id,role,status,display_name,email")
    .eq("id", authData.user.id)
    .maybeSingle<HubUserDetailRow>();

  if (
    userError ||
    !user ||
    user.status !== "active" ||
    !HADES_ADMIN_ROLES.includes(user.role)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Apenas Admin pode aprovar ou reprovar propostas." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    user: {
      displayName: user.display_name,
      email: user.email,
      id: user.id,
      role: user.role,
    },
  };
}
