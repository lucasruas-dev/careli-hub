import { createClient } from "@supabase/supabase-js";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

type AuthDiagnosticsDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: {
          email: string | null;
          id: string;
          role: string;
          status: string;
        };
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type AuthDiagnosticsClient = ReturnType<
  typeof createClient<AuthDiagnosticsDatabase>
>;

export type AuthDiagnosticsResult = {
  generatedAt: string;
  meta: {
    activeProfileWithoutAuth: number;
    activeProfiles: number;
    authUsers: number;
    authWithoutProfile: number;
    disabledProfiles: number;
    hubProfiles: number;
    invalidRoleProfiles: number;
    sampledAuthUsers: boolean;
    sampledHubProfiles: boolean;
  };
  recommendations: string[];
  status: "bloqueado" | "desalinhado" | "indisponivel" | "sincronizado";
};

const AUTH_USERS_PAGE_SIZE = 200;
const HUB_USERS_PAGE_SIZE = 500;
const MAX_AUTH_USERS_PAGES = 10;
const MAX_HUB_USERS_PAGES = 10;
const VALID_HUB_USER_ROLES = new Set(["admin", "leader", "operator", "viewer"]);

export async function collectAuthDiagnostics(): Promise<AuthDiagnosticsResult> {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();
  const generatedAt = new Date().toISOString();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      generatedAt,
      meta: emptyDiagnosticsMeta(),
      recommendations: [
        "Configurar URL e service role server-side no ambiente para permitir diagnostico protegido.",
      ],
      status: "bloqueado",
    };
  }

  try {
    const client = createClient<AuthDiagnosticsDatabase>(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
    const [authUsers, hubUsers] = await Promise.all([
      listAuthUserIds(client),
      listHubUserProfiles(client),
    ]);
    const hubUserIds = new Set(hubUsers.rows.map((row) => row.id));
    const authUserIds = new Set(authUsers.ids);
    const activeHubUsers = hubUsers.rows.filter((row) => row.status === "active");
    const meta = {
      activeProfiles: activeHubUsers.length,
      activeProfileWithoutAuth: activeHubUsers.filter(
        (row) => !authUserIds.has(row.id),
      ).length,
      authUsers: authUsers.ids.length,
      authWithoutProfile: authUsers.ids.filter((id) => !hubUserIds.has(id))
        .length,
      disabledProfiles: hubUsers.rows.filter((row) => row.status !== "active")
        .length,
      hubProfiles: hubUsers.rows.length,
      invalidRoleProfiles: hubUsers.rows.filter(
        (row) => !VALID_HUB_USER_ROLES.has(row.role),
      ).length,
      sampledAuthUsers: authUsers.truncated,
      sampledHubProfiles: hubUsers.truncated,
    };
    const hasBlockingMismatch =
      meta.authWithoutProfile > 0 ||
      meta.activeProfileWithoutAuth > 0 ||
      meta.invalidRoleProfiles > 0;

    return {
      generatedAt,
      meta,
      recommendations: buildRecommendations(meta),
      status: hasBlockingMismatch ? "desalinhado" : "sincronizado",
    };
  } catch {
    return {
      generatedAt,
      meta: emptyDiagnosticsMeta(),
      recommendations: [
        "Nao foi possivel ler Auth ou public.hub_users. Validar permissao server-side e logs do Supabase sem expor secrets.",
      ],
      status: "indisponivel",
    };
  }
}

async function listAuthUserIds(
  client: AuthDiagnosticsClient,
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];

  for (let page = 1; page <= MAX_AUTH_USERS_PAGES; page += 1) {
    const result = await client.auth.admin.listUsers({
      page,
      perPage: AUTH_USERS_PAGE_SIZE,
    });

    if (result.error) {
      throw new Error("auth-users-read-failed");
    }

    const users = result.data.users ?? [];
    ids.push(
      ...users
        .map((user) => user.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );

    if (users.length < AUTH_USERS_PAGE_SIZE) {
      return { ids, truncated: false };
    }
  }

  return { ids, truncated: true };
}

async function listHubUserProfiles(
  client: AuthDiagnosticsClient,
): Promise<{
  rows: Array<{ id: string; role: string; status: string }>;
  truncated: boolean;
}> {
  const rows: Array<{ id: string; role: string; status: string }> = [];

  for (let page = 0; page < MAX_HUB_USERS_PAGES; page += 1) {
    const from = page * HUB_USERS_PAGE_SIZE;
    const to = from + HUB_USERS_PAGE_SIZE - 1;
    const result = await client
      .from("hub_users")
      .select("id,role,status")
      .range(from, to);

    if (result.error) {
      throw new Error("hub-users-read-failed");
    }

    const pageRows = (result.data ?? [])
      .map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        role: typeof row.role === "string" ? row.role : "",
        status: typeof row.status === "string" ? row.status : "",
      }))
      .filter((row) => row.id.length > 0);

    rows.push(...pageRows);

    if (pageRows.length < HUB_USERS_PAGE_SIZE) {
      return { rows, truncated: false };
    }
  }

  return { rows, truncated: true };
}

function buildRecommendations(meta: AuthDiagnosticsResult["meta"]) {
  const recommendations: string[] = [];

  if (meta.authWithoutProfile > 0) {
    recommendations.push(
      "Criar ou sincronizar public.hub_users para Auth users sem perfil, mantendo id igual ao auth.users.id.",
    );
  }

  if (meta.activeProfileWithoutAuth > 0) {
    recommendations.push(
      "Criar convite/Auth user para perfis ativos sem Auth correspondente, ou desativar perfis que nao devem acessar.",
    );
  }

  if (meta.invalidRoleProfiles > 0) {
    recommendations.push(
      "Corrigir roles fora do enum admin, leader, operator ou viewer.",
    );
  }

  if (meta.disabledProfiles > 0) {
    recommendations.push(
      "Revisar perfis inativos caso o chamado de login envolva usuarios bloqueados por status.",
    );
  }

  if (meta.sampledAuthUsers || meta.sampledHubProfiles) {
    recommendations.push(
      "Amostra truncada; executar auditoria paginada completa antes de qualquer backfill.",
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Auth e public.hub_users estao alinhados na amostra; investigar senha, confirmacao de e-mail, projeto Supabase ou env do runtime.",
    );
  }

  return recommendations;
}

function emptyDiagnosticsMeta(): AuthDiagnosticsResult["meta"] {
  return {
    activeProfiles: 0,
    activeProfileWithoutAuth: 0,
    authUsers: 0,
    authWithoutProfile: 0,
    disabledProfiles: 0,
    hubProfiles: 0,
    invalidRoleProfiles: 0,
    sampledAuthUsers: false,
    sampledHubProfiles: false,
  };
}
