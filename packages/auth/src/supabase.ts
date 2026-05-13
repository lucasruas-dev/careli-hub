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
const SUPABASE_AUTH_TIMEOUT_MS = 10_000;

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
      try {
        const { data, error } = await withTimeout(
          client.auth.getSession(),
          "Tempo excedido ao carregar a sessao Supabase.",
        );

        if (error) {
          logAuthError("auth error", error.message);

          return {
            error: error.message,
            ok: false,
          };
        }

        return mapSupabaseSession(client, data.session, config.workspaceId);
      } catch (error) {
        const message = getErrorMessage(
          error,
          "Supabase indisponivel ao carregar a sessao.",
        );

        logAuthError("auth error", message);

        return {
          error: message,
          ok: false,
        };
      }
    },
    async refreshSession(): Promise<AuthActionResult<AuthSession | null>> {
      try {
        const { data, error } = await withTimeout(
          client.auth.refreshSession(),
          "Tempo excedido ao renovar a sessao Supabase.",
        );

        if (error) {
          logAuthError("auth error", error.message);

          return {
            error: error.message,
            ok: false,
          };
        }

        return mapSupabaseSession(client, data.session, config.workspaceId);
      } catch (error) {
        const message = getErrorMessage(
          error,
          "Supabase indisponivel ao renovar a sessao.",
        );

        logAuthError("auth error", message);

        return {
          error: message,
          ok: false,
        };
      }
    },
    async signIn(input?: unknown): Promise<AuthActionResult<AuthSession>> {
      const credentials = parsePasswordCredentials(input);

      if (!credentials) {
        return {
          error: "Informe e-mail e senha para entrar.",
          ok: false,
        };
      }

      try {
        const { data, error } = await withTimeout(
          client.auth.signInWithPassword({
            email: credentials.email.trim().toLowerCase(),
            password: credentials.password,
          }),
          "Tempo excedido ao autenticar com Supabase.",
        );

        if (error) {
          logAuthError("auth error", error.message);

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
          await safeSupabaseSignOut(client);

          return {
            error: sessionResult.error,
            ok: false,
          };
        }

        if (!sessionResult.data) {
          await safeSupabaseSignOut(client);

          return {
            error: "Nao foi possivel iniciar a sessao Supabase.",
            ok: false,
          };
        }

        return {
          data: sessionResult.data,
          ok: true,
        };
      } catch (error) {
        const message = getErrorMessage(
          error,
          "Supabase indisponivel ao autenticar.",
        );

        logAuthError("auth error", message);

        return {
          error: message,
          ok: false,
        };
      }
    },
    async signOut(): Promise<AuthActionResult> {
      try {
        const { error } = await withTimeout(
          client.auth.signOut(),
          "Tempo excedido ao encerrar a sessao Supabase.",
        );

        if (error) {
          logAuthError("auth error", error.message);

          return {
            error: error.message,
            ok: false,
          };
        }

        return {
          data: undefined,
          ok: true,
        };
      } catch (error) {
        const message = getErrorMessage(
          error,
          "Supabase indisponivel ao encerrar a sessao.",
        );

        logAuthError("auth error", message);

        return {
          error: message,
          ok: false,
        };
      }
    },
    onAuthStateChange(handler: SupabaseAuthChangeHandler) {
      const { data } = client.auth.onAuthStateChange(async (_event, session) => {
        try {
          handler(await mapSupabaseSession(client, session, config.workspaceId));
        } catch (error) {
          const message = getErrorMessage(
            error,
            "Supabase indisponivel ao processar a sessao.",
          );

          logAuthError("auth error", message);

          handler({
            error: message,
            ok: false,
          });
        }
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
    logAuthDebug("auth session loaded", "no active session");

    return {
      data: null,
      ok: true,
    };
  }

  const profileResult = await loadHubUserProfile(client, session.user.id);

  if (!profileResult.ok) {
    return profileResult;
  }

  logAuthDebug("auth session loaded", "active session");

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
  try {
    const result = await withTimeout(
      client
        .from("hub_users")
        .select("id,email,display_name,avatar_url,role,status")
        .eq("id", userId)
        .maybeSingle<HubUserProfileRow>(),
      "Tempo excedido ao carregar o perfil operacional do Hub.",
    );

    const { data, error } = result;

    if (error) {
      logAuthError("auth error", error.message);

      return {
        error: `Nao foi possivel carregar o perfil operacional do Hub: ${error.message}`,
        ok: false,
      };
    }

    if (!data) {
      logAuthDebug("hub user profile missing", userId);

      return {
        error:
          "Seu login foi autenticado, mas o perfil operacional ainda nao existe no Careli Hub. Solicite a liberacao do acesso.",
        ok: false,
      };
    }

    if (!isHubUserRole(data.role)) {
      logAuthError("auth error", "invalid hub user role");

      return {
        error:
          "Seu perfil operacional possui uma role invalida. Solicite revisao a um administrador.",
        ok: false,
      };
    }

    if (!isHubUserStatus(data.status)) {
      logAuthError("auth error", "invalid hub user status");

      return {
        error:
          "Seu perfil operacional possui um status invalido. Solicite revisao a um administrador.",
        ok: false,
      };
    }

    if (data.status !== "active") {
      logAuthError("auth error", "inactive hub user profile");

      return {
        error:
          "Seu perfil operacional nao esta ativo no Careli Hub. Solicite a liberacao do acesso.",
        ok: false,
      };
    }

    logAuthDebug("hub user profile loaded", data.id);

    return {
      data,
      ok: true,
    };
  } catch (error) {
    const message = getErrorMessage(
      error,
      "Supabase indisponivel ao carregar o perfil operacional do Hub.",
    );

    logAuthError("auth error", message);

    return {
      error: message,
      ok: false,
    };
  }
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

async function safeSupabaseSignOut(client: SupabaseClient): Promise<void> {
  try {
    await withTimeout(
      client.auth.signOut(),
      "Tempo excedido ao encerrar sessao Supabase invalida.",
    );
  } catch {
    // Best effort cleanup only. The caller already returns the auth failure.
  }
}

function withTimeout<Result>(
  promise: PromiseLike<Result>,
  message: string,
  timeoutMs = SUPABASE_AUTH_TIMEOUT_MS,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (result) => {
        globalThis.clearTimeout(timeoutId);
        resolve(result);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

function logAuthDebug(event: string, detail?: string) {
  if (!isLocalDevelopmentRuntime()) {
    return;
  }

  console.debug(`[careli-auth] ${event}`, detail ?? "");
}

function logAuthError(event: string, detail?: string) {
  if (!isLocalDevelopmentRuntime()) {
    return;
  }

  console.warn(`[careli-auth] ${event}`, detail ?? "");
}

function isLocalDevelopmentRuntime(): boolean {
  if (typeof globalThis.location === "undefined") {
    return false;
  }

  return ["localhost", "127.0.0.1"].includes(globalThis.location.hostname);
}
