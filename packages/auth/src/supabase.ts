import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
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

export type SupabaseAuthChangeHandler = (session: AuthSession | null) => void;

export type SupabaseAuthAdapter = AuthAdapter & {
  onAuthStateChange: (
    handler: SupabaseAuthChangeHandler,
  ) => { unsubscribe: () => void };
  provider: "supabase";
};

const HUB_USER_ROLES = ["admin", "leader", "operator", "viewer"] as const;

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

      return {
        data: mapSupabaseSession(data.session, config.workspaceId),
        ok: true,
      };
    },
    async refreshSession(): Promise<AuthActionResult<AuthSession | null>> {
      const { data, error } = await client.auth.refreshSession();

      if (error) {
        return {
          error: error.message,
          ok: false,
        };
      }

      return {
        data: mapSupabaseSession(data.session, config.workspaceId),
        ok: true,
      };
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

      const session = mapSupabaseSession(data.session, config.workspaceId);

      if (!session) {
        return {
          error: "Nao foi possivel iniciar a sessao Supabase.",
          ok: false,
        };
      }

      return {
        data: session,
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
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        handler(mapSupabaseSession(session, config.workspaceId));
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

function mapSupabaseSession(
  session: Session | null,
  workspaceId = "careli",
): AuthSession | null {
  if (!session) {
    return null;
  }

  return {
    accessToken: session.access_token,
    expiresAt:
      typeof session.expires_at === "number"
        ? new Date(session.expires_at * 1000).toISOString()
        : undefined,
    provider: "supabase",
    user: mapSupabaseUser(session.user, workspaceId),
  };
}

function mapSupabaseUser(user: User, workspaceId: string): AuthUser {
  const role = getSupabaseUserRole(user);
  const fullName = getStringMetadataValue(user, [
    "full_name",
    "fullName",
    "name",
  ]);

  return {
    email: user.email,
    fullName,
    id: user.id,
    permissions: getPermissionsForRole(role),
    role,
    workspaceId: getStringMetadataValue(user, ["workspace_id", "workspaceId"]) ??
      workspaceId,
  };
}

function getSupabaseUserRole(user: User): HubUserRole {
  const metadataRole =
    getStringValue(user.app_metadata.role) ??
    getStringValue(user.user_metadata.role);

  if (isHubUserRole(metadataRole)) {
    return metadataRole;
  }

  return "operator";
}

function getStringMetadataValue(
  user: User,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value =
      getStringValue(user.app_metadata[key]) ??
      getStringValue(user.user_metadata[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function getStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue || undefined;
}

function isHubUserRole(role: string | undefined): role is HubUserRole {
  return HUB_USER_ROLES.some((hubRole) => hubRole === role);
}
