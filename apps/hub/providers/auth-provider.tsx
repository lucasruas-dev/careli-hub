"use client";

import {
  MOCK_AUTH_STORAGE_KEY,
  createAuthStateFromSession,
  createMockAuthState,
  createUnauthenticatedAuthState,
  isAuthenticated,
  mapAuthUserToHubUserContext,
  type AuthActionResult,
  type AuthErrorDetails,
  type AuthSession,
  type AuthState,
  type PasswordAuthCredentials,
} from "@repo/auth";
import {
  getHubSupabaseClient,
  hasHubSupabaseConfig,
} from "@/lib/supabase/client";
import {
  getPermissionsForRole,
  type HubUserContext,
  type HubUserRole,
} from "@repo/shared";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { AlertTriangle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AuthContextValue = {
  authState: AuthState;
  hubUser: HubUserContext | null;
  profileStatus: "error" | "idle" | "loading" | "ready";
  signIn: (
    credentials: PasswordAuthCredentials,
  ) => Promise<AuthActionResult<AuthSession>>;
  signOut: () => Promise<AuthActionResult>;
};

type HubProfileRow = {
  avatar_url?: string | null;
  display_name: string;
  email: string;
  id: string;
  role: HubUserRole;
  status: "active" | "archived" | "disabled";
};

const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const pathname = usePathname();
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>({
    session: null,
    status: "loading",
    user: null,
  });
  const [profileStatus, setProfileStatus] =
    useState<AuthContextValue["profileStatus"]>("idle");
  const isLoginRoute = pathname === "/login";
  const hubUser = useMemo(
    () =>
      authState.user ? mapAuthUserToHubUserContext(authState.user) : null,
    [authState.user],
  );

  useEffect(() => {
    if (hasHubSupabaseConfig()) {
      let isMounted = true;
      const client = getHubSupabaseClient();

      if (!client) {
        setAuthState(createUnauthenticatedAuthState());
        return;
      }

      logAuthTiming("session start");
      withMeasuredTimeout(
        client.auth.getSession(),
        "Tempo excedido ao carregar a sessao Supabase.",
        "session",
        8_000,
      )
        .then(({ data, error }) => {
          if (!isMounted) {
            return;
          }

          if (error) {
            logAuthDebug("session error", error.message);
            setAuthState(createAuthErrorState(error.message));
            return;
          }

          applySupabaseSession({
            client,
            isMounted: () => isMounted,
            session: data.session,
            setAuthState,
            setProfileStatus,
          });
        })
        .catch((error: unknown) => {
          if (!isMounted) {
            return;
          }

          const message = getErrorMessage(
            error,
            "Nao foi possivel carregar a sessao.",
          );

          logAuthDebug("session error", message);
          setAuthState(createAuthErrorState(message));
        });

      const { data } = client.auth.onAuthStateChange((_event, session) => {
        applySupabaseSession({
          client,
          isMounted: () => isMounted,
          session,
          setAuthState,
          setProfileStatus,
        });
      });

      return () => {
        isMounted = false;
        data.subscription.unsubscribe();
      };
    }

    try {
      const storedSession = window.localStorage.getItem(MOCK_AUTH_STORAGE_KEY);

      if (!storedSession) {
        logAuthDebug("auth session loaded", "mock session missing");
        setAuthState(createUnauthenticatedAuthState());
        return;
      }

      logAuthDebug("auth session loaded", "mock session loaded");
      setAuthState(
        createAuthStateFromSession(JSON.parse(storedSession) as AuthSession),
      );
    } catch {
      window.localStorage.removeItem(MOCK_AUTH_STORAGE_KEY);
      logAuthDebug("auth error", "invalid mock session");
      setAuthState(createUnauthenticatedAuthState());
    }
  }, []);

  useEffect(() => {
    if (authState.status === "loading" || authState.status === "error") {
      return;
    }

    if (!isAuthenticated(authState) && !isLoginRoute) {
      router.replace("/login");
      return;
    }

    if (isAuthenticated(authState) && isLoginRoute) {
      router.replace("/");
    }
  }, [authState, isLoginRoute, router]);

  async function signIn({
    email,
    password,
  }: PasswordAuthCredentials): Promise<AuthActionResult<AuthSession>> {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password.trim()) {
      return {
        error: "Informe e-mail e senha para entrar.",
        ok: false,
      };
    }

    if (hasHubSupabaseConfig()) {
      const client = getHubSupabaseClient();

      if (!client) {
        return {
          error: "Adaptador Supabase Auth indisponivel.",
          ok: false,
        };
      }

      try {
        logAuthTiming("session start");
        const { data, error } = await withMeasuredTimeout(
          client.auth.signInWithPassword({
            email: normalizedEmail,
            password,
          }),
          "Tempo excedido ao autenticar com Supabase.",
          "session",
          12_000,
        );

        if (error || !data.session) {
          const message = getFriendlyAuthMessage(error?.message);
          setAuthState(createAuthErrorState(message));

          return {
            error: message,
            ok: false,
          };
        }

        const session = createPartialAuthSession(data.session);
        setAuthState(createAuthStateFromSession(session));
        loadHubProfileInBackground({
          client,
          session: data.session,
          setAuthState,
          setProfileStatus,
        });

        return {
          data: session,
          ok: true,
        };
      } catch (error) {
        const technicalMessage = getErrorMessage(
          error,
          "Nao foi possivel entrar no Hub.",
        );
        const message = getFriendlyAuthMessage(technicalMessage);

        logAuthDebug("auth error", technicalMessage);
        setAuthState(createAuthErrorState(message));

        return {
          error: message,
          ok: false,
        };
      }
    }

    const nextAuthState = createMockAuthState({
      email: normalizedEmail,
      fullName: getMockDisplayName(normalizedEmail),
      id: `mock-${normalizedEmail.replace(/[^a-z0-9]/g, "-")}`,
      role: "admin",
      workspaceId: "careli",
    });

    if (!nextAuthState.session) {
      return {
        error: "Nao foi possivel criar a sessao mockada.",
        ok: false,
      };
    }

    window.localStorage.setItem(
      MOCK_AUTH_STORAGE_KEY,
      JSON.stringify(nextAuthState.session),
    );
    logAuthDebug("auth session loaded", "mock sign-in");
    setAuthState(nextAuthState);

    return {
      data: nextAuthState.session,
      ok: true,
    };
  }

  async function signOut(): Promise<AuthActionResult> {
    if (hasHubSupabaseConfig()) {
      const client = getHubSupabaseClient();

      if (client) {
        const { error } = await client.auth.signOut();

        if (error) {
          return {
            error: error.message,
            ok: false,
          };
        }
      }
    }

    window.localStorage.removeItem(MOCK_AUTH_STORAGE_KEY);
    setAuthState(createUnauthenticatedAuthState());
    router.replace("/login");

    return {
      data: undefined,
      ok: true,
    };
  }

  if (authState.status === "loading" && !isLoginRoute) {
    return <AuthGateMessage message="Carregando sessao..." />;
  }

  if (authState.status === "error" && !isLoginRoute) {
    return (
      <AuthGateMessage
        message={getAuthGateMessage(authState)}
        onSignOut={() => {
          void signOut();
        }}
      />
    );
  }

  if (!isLoginRoute && !isAuthenticated(authState)) {
    return <AuthGateMessage message="Redirecionando para login..." />;
  }

  return (
    <AuthContext.Provider
      value={{
        authState,
        hubUser,
        profileStatus,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }

  return context;
}

function getMockDisplayName(email: string): string {
  const [localPart = "usuario"] = email.split("@");

  return localPart
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function createAuthErrorState(
  error: string,
  errorDetails?: AuthErrorDetails,
): AuthState {
  return {
    ...createUnauthenticatedAuthState(),
    error,
    errorDetails,
    status: "error",
  };
}

function applySupabaseSession({
  client,
  isMounted,
  session,
  setAuthState,
  setProfileStatus,
}: {
  client: SupabaseClient;
  isMounted: () => boolean;
  session: Session | null;
  setAuthState: (state: AuthState) => void;
  setProfileStatus: (status: AuthContextValue["profileStatus"]) => void;
}) {
  if (!isMounted()) {
    return;
  }

  if (!session) {
    logAuthDebug("session done", "no active session");
    setProfileStatus("idle");
    setAuthState(createUnauthenticatedAuthState());
    return;
  }

  const partialSession = createPartialAuthSession(session);

  logAuthDebug("session done", {
    email: session.user.email,
    userId: session.user.id,
  });
  setAuthState(createAuthStateFromSession(partialSession));

  loadHubProfileInBackground({
    client,
    session,
    setAuthState: (nextState) => {
      if (isMounted()) {
        setAuthState(nextState);
      }
    },
    setProfileStatus: (nextStatus) => {
      if (isMounted()) {
        setProfileStatus(nextStatus);
      }
    },
  });
}

async function loadHubProfileInBackground({
  client,
  session,
  setAuthState,
  setProfileStatus,
}: {
  client: SupabaseClient;
  session: Session;
  setAuthState: (state: AuthState) => void;
  setProfileStatus: (status: AuthContextValue["profileStatus"]) => void;
}) {
  const startedAt = performance.now();

  setProfileStatus("loading");
  logAuthDebug("profile start", {
    email: session.user.email,
    userId: session.user.id,
  });

  try {
    const { data, error } = await withMeasuredTimeout(
      client
        .from("hub_users")
        .select("id,email,display_name,avatar_url,role,status")
        .eq("id", session.user.id)
        .maybeSingle<HubProfileRow>(),
      "Tempo excedido ao carregar o perfil operacional do Hub.",
      "profile",
      15_000,
    );

    if (error || !data || data.status !== "active") {
      logAuthDebug("profile error", error?.message ?? "profile unavailable");
      setProfileStatus("error");
      return;
    }

    const authSession = createAuthSessionFromProfile(session, data);

    setAuthState(createAuthStateFromSession(authSession));
    setProfileStatus("ready");
    logAuthDebug("profile done", {
      elapsedMs: Math.round(performance.now() - startedAt),
      role: data.role,
      userId: data.id,
    });
  } catch (error) {
    logAuthDebug("profile error", getErrorMessage(error, "profile failed"));
    setProfileStatus("error");
  }
}

function createPartialAuthSession(session: Session): AuthSession {
  const fallbackRole: HubUserRole = "viewer";

  return {
    accessToken: session.access_token,
    expiresAt:
      typeof session.expires_at === "number"
        ? new Date(session.expires_at * 1000).toISOString()
        : undefined,
    provider: "supabase",
    user: {
      avatarUrl: getUserMetadataString(session.user, "avatar_url"),
      email: session.user.email,
      fullName:
        getUserMetadataString(session.user, "full_name") ??
        getUserMetadataString(session.user, "name") ??
        session.user.email?.split("@")[0],
      id: session.user.id,
      permissions: getPermissionsForRole(fallbackRole),
      role: fallbackRole,
      status: "active",
      workspaceId: "careli",
    },
  };
}

function createAuthSessionFromProfile(
  session: Session,
  profile: HubProfileRow,
): AuthSession {
  return {
    ...createPartialAuthSession(session),
    user: {
      avatarUrl: profile.avatar_url ?? undefined,
      email: profile.email,
      fullName: profile.display_name,
      id: profile.id,
      permissions: getPermissionsForRole(profile.role),
      role: profile.role,
      status: profile.status,
      workspaceId: "careli",
    },
  };
}

function getUserMetadataString(user: User, key: string): string | undefined {
  const value = user.user_metadata[key] ?? user.app_metadata[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

function withMeasuredTimeout<Result>(
  promise: PromiseLike<Result>,
  message: string,
  label: "profile" | "session",
  timeoutMs: number,
): Promise<Result> {
  const startedAt = performance.now();

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      logAuthDebug(`${label} error`, {
        elapsedMs: Math.round(performance.now() - startedAt),
        message,
      });
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (result) => {
        window.clearTimeout(timeoutId);
        logAuthDebug(`${label} done`, {
          elapsedMs: Math.round(performance.now() - startedAt),
        });
        resolve(result);
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId);
        logAuthDebug(`${label} error`, {
          elapsedMs: Math.round(performance.now() - startedAt),
          message: getErrorMessage(error, "Erro desconhecido."),
        });
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

function logAuthDebug(event: string, detail?: unknown) {
  if (!isLocalDevelopmentRuntime()) {
    return;
  }

  console.debug(`[auth] ${event}`, detail ?? "");
}

function logAuthTiming(event: string) {
  logAuthDebug(event);
}

function isLocalDevelopmentRuntime(): boolean {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function getAuthGateMessage(authState: AuthState): string {
  return getFriendlyAuthMessage(authState.error, authState.errorDetails);
}

function getFriendlyAuthMessage(
  error?: string,
  details?: AuthErrorDetails,
): string {
  const errorCode = details?.code;

  if (
    errorCode === "hub_profile_create_failed" ||
    errorCode === "hub_profile_inactive" ||
    errorCode === "hub_profile_invalid" ||
    errorCode === "hub_profile_missing"
  ) {
    return "Seu usuário ainda não possui acesso ao Hub Careli.";
  }

  const normalizedError = (error ?? "").trim().toLowerCase();

  if (normalizedError.includes("invalid login credentials")) {
    return "E-mail ou senha inválidos.";
  }

  if (normalizedError.includes("email not confirmed")) {
    return "Seu acesso ainda não foi liberado.";
  }

  if (normalizedError.includes("user not found")) {
    return "Usuário não encontrado.";
  }

  if (
    normalizedError.includes("profile missing") ||
    normalizedError.includes("perfil operacional ausente") ||
    normalizedError.includes("perfil operacional ainda nao existe") ||
    normalizedError.includes("public.hub_users")
  ) {
    return "Seu usuário ainda não possui acesso ao Hub Careli.";
  }

  if (normalizedError.includes("adaptador supabase auth indisponivel")) {
    return "Serviço de autenticação indisponível. Tente novamente.";
  }

  if (normalizedError.includes("tempo excedido")) {
    return "Não foi possível validar seu acesso agora. Tente novamente.";
  }

  return "Não foi possível validar seu acesso ao Hub Careli. Tente novamente.";
}

function AuthGateMessage({
  message,
  onSignOut,
}: {
  message: string;
  onSignOut?: () => void;
}) {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--uix-surface-canvas)] px-6 text-center">
      <div className="max-w-md rounded-md border border-[#eadfca] bg-white px-6 py-5 shadow-sm">
        <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[#A07C3B]/10 text-[#8a682f]">
          <AlertTriangle aria-hidden="true" size={18} strokeWidth={1.8} />
        </span>
        <p className="m-0 text-sm font-medium text-[var(--uix-text-primary)]">
          {message}
        </p>
        {onSignOut ? (
          <button
            className="mt-4 rounded-md bg-[#101820] px-4 py-2 text-sm font-semibold text-white outline-none transition hover:bg-[#182431] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
            onClick={onSignOut}
            type="button"
          >
            Sair
          </button>
        ) : null}
      </div>
    </div>
  );
}
