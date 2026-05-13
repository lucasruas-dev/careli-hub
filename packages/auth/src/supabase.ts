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
  AuthErrorDetails,
  AuthSession,
  AuthUser,
  PasswordAuthCredentials,
} from "./types";

export type SupabaseAuthConfig = {
  anonKey?: string;
  client?: SupabaseClient;
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
const SUPABASE_AUTH_TIMEOUT_MS = 30_000;

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

  const client = config.client ?? createSupabaseAuthClient(config);

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

  logAuthDebug("auth session loaded", {
    email: session.user.email,
    userId: session.user.id,
  });

  const profileResult = await loadHubUserProfile(client, session.user);

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
  authUser: User,
): Promise<AuthActionResult<HubUserProfileRow>> {
  const userId = authUser.id;
  const email = authUser.email;
  const profileQuery = {
    filters: {
      id: userId,
    },
    schema: "public",
    select: "id,email,display_name,avatar_url,role,status",
    table: "hub_users",
  };

  try {
    logAuthDebug("hub user profile query", {
      authEmail: email,
      authUserId: userId,
      query: profileQuery,
    });

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
      logAuthError("auth error", {
        authEmail: email,
        authUserId: userId,
        query: profileQuery,
        queryResult: "error",
        supabaseError: serializeSupabaseError(error),
      });

      return {
        error: `Nao foi possivel carregar o perfil operacional do Hub: ${error.message}`,
        errorDetails: createAuthErrorDetails({
          code: "supabase_auth_error",
          email,
          hint: "Verifique permissoes de leitura em public.hub_users e se a tabela existe no schema public.",
          queryResult: "error",
          userId,
        }),
        ok: false,
      };
    }

    if (!data) {
      logAuthDebug("hub user profile missing", {
        authEmail: email,
        authUserId: userId,
        data,
        query: profileQuery,
        queryResult: "missing",
      });

      const createResult = await createDevelopmentHubUserProfile(
        client,
        authUser,
      );

      if (createResult.ok) {
        logAuthDebug("hub user profile loaded", {
          authEmail: email,
          authUserId: userId,
          profile: serializeHubUserProfile(createResult.data),
          queryResult: "created",
        });

        return createResult;
      }

      return {
        error: createMissingHubProfileMessage({ email, userId }),
        errorDetails: createAuthErrorDetails({
          code: createResult.errorDetails?.code ?? "hub_profile_missing",
          email,
          hint:
            createResult.errorDetails?.hint ??
            "Crie ou sincronize um registro em public.hub_users com id igual ao auth.users.id.",
          queryResult: createResult.errorDetails?.queryResult ?? "missing",
          userId,
        }),
        ok: false,
      };
    }

    if (!isHubUserRole(data.role)) {
      logAuthError("auth error", {
        authEmail: email,
        authUserId: userId,
        profile: serializeHubUserProfile(data),
        queryResult: "found",
        reason: "invalid hub user role",
      });

      return {
        error:
          "Seu perfil operacional possui uma role invalida. Solicite revisao a um administrador.",
        errorDetails: createAuthErrorDetails({
          code: "hub_profile_invalid",
          email,
          hint: "Use uma role valida: admin, leader, operator ou viewer.",
          queryResult: "found",
          userId,
        }),
        ok: false,
      };
    }

    if (!isHubUserStatus(data.status)) {
      logAuthError("auth error", {
        authEmail: email,
        authUserId: userId,
        profile: serializeHubUserProfile(data),
        queryResult: "found",
        reason: "invalid hub user status",
      });

      return {
        error:
          "Seu perfil operacional possui um status invalido. Solicite revisao a um administrador.",
        errorDetails: createAuthErrorDetails({
          code: "hub_profile_invalid",
          email,
          hint: "Use um status valido: active, archived ou disabled.",
          queryResult: "found",
          userId,
        }),
        ok: false,
      };
    }

    if (data.status !== "active") {
      logAuthError("auth error", {
        authEmail: email,
        authUserId: userId,
        profile: serializeHubUserProfile(data),
        queryResult: "found",
        reason: "inactive hub user profile",
      });

      return {
        error:
          "Seu perfil operacional nao esta ativo no Careli Hub. Solicite a liberacao do acesso.",
        errorDetails: createAuthErrorDetails({
          code: "hub_profile_inactive",
          email,
          hint: "Atualize public.hub_users.status para active.",
          queryResult: "found",
          userId,
        }),
        ok: false,
      };
    }

    logAuthDebug("hub user profile loaded", {
      authEmail: email,
      authUserId: userId,
      profile: serializeHubUserProfile(data),
      query: profileQuery,
      queryResult: "found",
    });

    return {
      data,
      ok: true,
    };
  } catch (error) {
    const message = getErrorMessage(
      error,
      "Supabase indisponivel ao carregar o perfil operacional do Hub.",
    );

    logAuthError("auth error", {
      authEmail: email,
      authUserId: userId,
      message,
      query: profileQuery,
      queryResult: "error",
    });

    return {
      error: message,
      errorDetails: createAuthErrorDetails({
        code: "supabase_unavailable",
        email,
        hint: "Verifique conectividade com Supabase e permissoes da anon key.",
        queryResult: "error",
        userId,
      }),
      ok: false,
    };
  }
}

async function createDevelopmentHubUserProfile(
  client: SupabaseClient,
  authUser: User,
): Promise<AuthActionResult<HubUserProfileRow>> {
  if (!isLocalDevelopmentRuntime()) {
    return {
      error: "Perfil operacional ausente.",
      errorDetails: createAuthErrorDetails({
        code: "hub_profile_missing",
        email: authUser.email,
        hint:
          "Crie ou sincronize manualmente um registro em public.hub_users para este auth.users.id.",
        queryResult: "missing",
        userId: authUser.id,
      }),
      ok: false,
    };
  }

  const displayName = getAuthUserDisplayName(authUser);
  const profile = {
    avatar_url: getStringMetadataValue(authUser, ["avatar_url"]) ?? null,
    display_name: displayName,
    email: authUser.email ?? `${authUser.id}@auth.local`,
    id: authUser.id,
    role: "operator" as const,
    status: "active" as const,
  };

  logAuthDebug("hub user profile missing", {
    action: "attempting development auto-create",
    email: authUser.email,
    queryResult: "missing",
    userId: authUser.id,
  });

  const { data, error } = await withTimeout(
    client
      .from("hub_users")
      .upsert(profile, { onConflict: "id" })
      .select("id,email,display_name,avatar_url,role,status")
      .single<HubUserProfileRow>(),
    "Tempo excedido ao criar perfil operacional de desenvolvimento.",
  );

  if (error) {
    logAuthError("auth error", {
      email: authUser.email,
      message: error.message,
      queryResult: "error",
      userId: authUser.id,
    });

    return {
      error: createMissingHubProfileMessage({
        email: authUser.email,
        userId: authUser.id,
      }),
      errorDetails: createAuthErrorDetails({
        code: "hub_profile_create_failed",
        email: authUser.email,
        hint:
          "A tentativa local de criar public.hub_users foi bloqueada. Execute o backfill SQL ou crie a linha manualmente.",
        queryResult: "error",
        userId: authUser.id,
      }),
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

function createMissingHubProfileMessage({
  email,
  userId,
}: {
  email?: string;
  userId: string;
}) {
  return [
    "Seu login foi autenticado, mas o perfil operacional ainda nao existe no Careli Hub.",
    `Crie ou sincronize public.hub_users com id = ${userId}.`,
    email ? `Email autenticado: ${email}.` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

function createAuthErrorDetails(
  details: AuthErrorDetails,
): AuthErrorDetails {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined),
  ) as AuthErrorDetails;
}

function serializeHubUserProfile(profile: HubUserProfileRow) {
  return {
    email: profile.email,
    id: profile.id,
    role: profile.role,
    status: profile.status,
  };
}

function serializeSupabaseError(error: unknown) {
  if (!error || typeof error !== "object") {
    return error;
  }

  const maybeError = error as {
    code?: unknown;
    details?: unknown;
    hint?: unknown;
    message?: unknown;
    name?: unknown;
  };

  return {
    code: maybeError.code,
    details: maybeError.details,
    hint: maybeError.hint,
    message: maybeError.message,
    name: maybeError.name,
  };
}

function getAuthUserDisplayName(user: User): string {
  return (
    getStringMetadataValue(user, ["full_name", "fullName", "name"]) ??
    user.email?.split("@")[0] ??
    "Careli User"
  );
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

function logAuthDebug(event: string, detail?: unknown) {
  if (!isLocalDevelopmentRuntime()) {
    return;
  }

  console.debug(`[careli-auth] ${event}`, detail ?? "");
}

function logAuthError(event: string, detail?: unknown) {
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
