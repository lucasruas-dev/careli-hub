import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { getPermissionsForRole, type HubUserRole } from "@repo/shared";
import type {
  AuthActionResult,
  AuthAdapter,
  AuthSession,
  AuthUser,
  PasswordAuthCredentials,
} from "./types";

export type SupabaseAuthConfig = {
  anonKey?: string;
  url?: string;
  workspaceId?: string;
};

export type SupabaseAuthChangeHandler = (
  result: AuthActionResult<AuthSession | null>,
) => void;

export type SupabaseAuthAdapter = AuthAdapter & {
  onAuthStateChange: (
    handler: SupabaseAuthChangeHandler,
  ) => { unsubscribe: () => void };
  provider: "supabase";
};

const HUB_USER_ROLES = ["admin", "leader", "operator", "viewer"] as const;
const HUB_USER_STATUSES = ["active", "archived", "disabled"] as const;

type HubUserProfileStatus = (typeof HUB_USER_STATUSES)[number];

type HubUserProfileRow = {
  avatar_url: string | null;
  display_name: string;
  email: string;
  id: string;
  role: HubUserRole;
  status: HubUserProfileStatus;
};

export function hasSupabaseAuthConfig(
  config: SupabaseAuthConfig,
): config is SupabaseAuthConfig & { anonKey: string; url: string } {
  return Boolean(config.url?.trim() && config.anonKey?.trim());
}

export function createSupabaseAuthClient(
  config: SupabaseAuthConfig & { anonKey: string; url: string },
): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });
}

export function createSupabaseAuthAdapter(
  config: SupabaseAuthConfig,
): SupabaseAuthAdapter {
  if (!hasSupabaseAuthConfig(config)) {
    throw new Error(
      "Supabase Auth requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const client = createSupabaseAuthClient(config);

  return {
    provider: "supabase",
    async getSession(): Promise<AuthActionResult<AuthSession | null>> {
      const { data, error } = await client.auth.getSession();

      if (error) {
        return {
          error: error.message,
          ok: false,
        };
      }

      return mapSupabaseSession(client, data.session, config.workspaceId);
    },
    async refreshSession(): Promise<AuthActionResult<AuthSession | null>> {
      const { data, error } = await client.auth.refreshSession();

      if (error) {
        return {
          error: error.message,
          ok: false,
        };
      }

      return mapSupabaseSession(client, data.session, config.workspaceId);
    },
    async signIn(input?: unknown): Promise<AuthActionResult<AuthSession>> {
      const credentials = parsePasswordCredentials(input);

      if (!credentials) {
        return {
          error: "Informe e-mail e senha para entrar.",
          ok: false,
        };
      }

      const { data, error } = await client.auth.signInWithPassword({
        email: credentials.email.trim().toLowerCase(),
        password: credentials.password,
      });

      if (error) {
        return {
          error: error.message,
          ok: false,
        };
      }

      const sessionResult = await mapSupabaseSession(
        client,
        data.session,
        config.workspaceId,
      );

      if (!sessionResult.ok) {
        await client.auth.signOut();

        return {
          error: sessionResult.error,
          ok: false,
        };
      }

      if (!sessionResult.data) {
        await client.auth.signOut();

        return {
          error: "Nao foi possivel iniciar a sessao Supabase.",
          ok: false,
        };
      }

      return {
        data: sessionResult.data,
        ok: true,
      };
    },
    async signOut(): Promise<AuthActionResult> {
      const { error } = await client.auth.signOut();

      if (error) {
        return {
          error: error.message,
          ok: false,
        };
      }

      return {
        data: undefined,
        ok: true,
      };
    },
    onAuthStateChange(handler: SupabaseAuthChangeHandler) {
      const { data } = client.auth.onAuthStateChange(async (_event, session) => {
        handler(await mapSupabaseSession(client, session, config.workspaceId));
      });

      return {
        unsubscribe: () => data.subscription.unsubscribe(),
      };
    },
  };
}

function parsePasswordCredentials(
  input?: unknown,
): PasswordAuthCredentials | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const maybeCredentials = input as Partial<PasswordAuthCredentials>;

  if (
    typeof maybeCredentials.email !== "string" ||
    typeof maybeCredentials.password !== "string"
  ) {
    return null;
  }

  if (!maybeCredentials.email.trim() || !maybeCredentials.password.trim()) {
    return null;
  }

  return {
    email: maybeCredentials.email,
    password: maybeCredentials.password,
  };
}

async function mapSupabaseSession(
  client: SupabaseClient,
  session: Session | null,
  workspaceId = "careli",
): Promise<AuthActionResult<AuthSession | null>> {
  if (!session) {
    return {
      data: null,
      ok: true,
    };
  }

  const profileResult = await loadHubUserProfile(client, session.user.id);

  if (!profileResult.ok) {
    return profileResult;
  }

  return {
    data: {
      accessToken: session.access_token,
      expiresAt:
        typeof session.expires_at === "number"
          ? new Date(session.expires_at * 1000).toISOString()
          : undefined,
      provider: "supabase",
      user: mapHubUserProfile(profileResult.data, workspaceId),
    },
    ok: true,
  };
}

async function loadHubUserProfile(
  client: SupabaseClient,
  userId: string,
): Promise<AuthActionResult<HubUserProfileRow>> {
  const { data, error } = await client
    .from("hub_users")
    .select("id,email,display_name,avatar_url,role,status")
    .eq("id", userId)
    .maybeSingle<HubUserProfileRow>();

  if (error) {
    return {
      error: `Nao foi possivel carregar o perfil operacional do Hub: ${error.message}`,
      ok: false,
    };
  }

  if (!data) {
    return {
      error:
        "Seu login foi autenticado, mas o perfil operacional ainda nao existe no Careli Hub. Solicite a liberacao do acesso.",
      ok: false,
    };
  }

  if (!isHubUserRole(data.role)) {
    return {
      error:
        "Seu perfil operacional possui uma role invalida. Solicite revisao a um administrador.",
      ok: false,
    };
  }

  if (!isHubUserStatus(data.status)) {
    return {
      error:
        "Seu perfil operacional possui um status invalido. Solicite revisao a um administrador.",
      ok: false,
    };
  }

  if (data.status !== "active") {
    return {
      error:
        "Seu perfil operacional nao esta ativo no Careli Hub. Solicite a liberacao do acesso.",
      ok: false,
    };
  }

  return {
    data,
    ok: true,
  };
}

function mapHubUserProfile(
  profile: HubUserProfileRow,
  workspaceId: string,
): AuthUser {
  return {
    avatarUrl: profile.avatar_url ?? undefined,
    email: profile.email,
    fullName: profile.display_name,
    id: profile.id,
    permissions: getPermissionsForRole(profile.role),
    role: profile.role,
    status: profile.status,
    workspaceId,
  };
}

function isHubUserRole(role: string | undefined): role is HubUserRole {
  return HUB_USER_ROLES.some((hubRole) => hubRole === role);
}

function isHubUserStatus(
  status: string | undefined,
): status is HubUserProfileStatus {
  return HUB_USER_STATUSES.some((hubStatus) => hubStatus === status);
}
