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
  getHubSupabaseDiagnostics,
  hasHubSupabaseConfig,
  hubSupabaseConfig,
  logSupabaseDiagnostic,
  serializeDiagnosticError,
} from "@/lib/supabase/client";
import { markHubPresence } from "@/lib/hub-presence";
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

type ProfileFallbackResponse = {
  error?: string;
  profile?: HubProfileRow;
};

type PasswordSignInFallbackResponse = {
  error?: string;
  session?: {
    access_token?: unknown;
    expires_at?: unknown;
    expires_in?: unknown;
    refresh_token?: unknown;
  };
};

type SessionRecoveryResponse = {
  error?: string;
  profile?: HubProfileRow;
  session?: {
    access_token?: unknown;
    expires_at?: unknown;
    expires_in?: unknown;
    refresh_token?: unknown;
  };
};

type CachedSupabaseSession = {
  accessToken?: string;
  refreshToken?: string;
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
  const [authRetryKey, setAuthRetryKey] = useState(0);
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

      setAuthState({
        session: null,
        status: "loading",
        user: null,
      });
      setProfileStatus("idle");

      if (!client) {
        setAuthState(createUnauthenticatedAuthState());
        return;
      }

      logSupabaseDiagnostic("auth", "env", getHubSupabaseDiagnostics());
      logAuthTiming("session start");
      recoverHubSessionViaApiFallback({
        client,
        isMounted: () => isMounted,
        setAuthState,
        setProfileStatus,
      })
        .then((recovered) => {
          if (!isMounted || recovered) {
            return null;
          }

          return withMeasuredTimeout(
            client.auth.getSession(),
            "Tempo excedido ao carregar a sessao Supabase.",
            "session",
            20_000,
          );
        })
        .then(async (sessionResult) => {
          if (!isMounted) {
            return;
          }

          if (!sessionResult) {
            return;
          }

          const { data, error } = sessionResult;

          if (error) {
            logSupabaseDiagnostic("auth", "session error", {
              error: serializeDiagnosticError(error),
              function: "AuthProvider.getSession",
              supabase: getHubSupabaseDiagnostics(),
            });

            if (isSupabaseAuthNetworkError(error)) {
              const recovered = await recoverHubSessionViaApiFallback({
                client,
                isMounted: () => isMounted,
                setAuthState,
                setProfileStatus,
              });

              if (recovered) {
                return;
              }

              clearLocalAuthStorage();
              setProfileStatus("idle");
              setAuthState(createUnauthenticatedAuthState());
              return;
            }

            setAuthState(createAuthErrorState(getFriendlySupabaseError(error)));
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
        .catch(async (error: unknown) => {
          if (!isMounted) {
            return;
          }

          const message = getErrorMessage(
            error,
            "Nao foi possivel carregar a sessao.",
          );

          logSupabaseDiagnostic("auth", "session error", {
            error: serializeDiagnosticError(error),
            function: "AuthProvider.getSession",
            message,
            supabase: getHubSupabaseDiagnostics(),
          });

          if (isSupabaseAuthNetworkError(error)) {
            const recovered = await recoverHubSessionViaApiFallback({
              client,
              isMounted: () => isMounted,
              setAuthState,
              setProfileStatus,
            });

            if (recovered) {
              return;
            }

            clearLocalAuthStorage();
            setProfileStatus("idle");
            setAuthState(createUnauthenticatedAuthState());
            return;
          }

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
  }, [authRetryKey]);

  useEffect(() => {
    if (authState.status === "loading") {
      return;
    }

    if (authState.status === "error") {
      if (!isLoginRoute && shouldResetSessionAfterAuthError(authState.error)) {
        resetBrokenSessionToLogin({
          setAuthState,
          setProfileStatus,
        });
      }

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
        logSupabaseDiagnostic("auth", "signIn start", {
          email: normalizedEmail,
          function: "AuthProvider.signIn",
          supabase: getHubSupabaseDiagnostics(),
        });
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
          if (error && isSupabaseAuthNetworkError(error)) {
            const fallbackResult = await signInViaApiFallback({
              client,
              normalizedEmail,
              password,
              setAuthState,
              setProfileStatus,
            });

            if (fallbackResult.ok) {
              return fallbackResult;
            }

            setAuthState(createAuthErrorState(fallbackResult.error));

            return fallbackResult;
          }

          const message = error
            ? getFriendlySupabaseError(error)
            : getFriendlyAuthMessage();
          logSupabaseDiagnostic("auth", "signIn error", {
            email: normalizedEmail,
            error: error ? serializeDiagnosticError(error) : null,
            function: "AuthProvider.signIn",
            supabase: getHubSupabaseDiagnostics(),
          });
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
        if (isSupabaseAuthNetworkError(error)) {
          const fallbackResult = await signInViaApiFallback({
            client,
            normalizedEmail,
            password,
            setAuthState,
            setProfileStatus,
          });

          if (fallbackResult.ok) {
            return fallbackResult;
          }

          setAuthState(createAuthErrorState(fallbackResult.error));

          return fallbackResult;
        }

        const technicalMessage = getErrorMessage(
          error,
          "Nao foi possivel entrar no Hub.",
        );
        const message = getFriendlyAuthMessage(technicalMessage);

        logSupabaseDiagnostic("auth", "signIn error", {
          email: normalizedEmail,
          error: serializeDiagnosticError(error),
          function: "AuthProvider.signIn",
          message: technicalMessage,
          supabase: getHubSupabaseDiagnostics(),
        });
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
    const client = hasHubSupabaseConfig() ? getHubSupabaseClient() : null;

    if (client) {
      void markHubPresence({
        reason: "logout",
        source: "auth-provider",
        status: "offline",
      }).catch((error: unknown) => {
        logSupabaseDiagnostic("auth", "presence logout error", {
          error: serializeDiagnosticError(error),
          function: "AuthProvider.signOut",
          supabase: getHubSupabaseDiagnostics(),
        });
      });
    }

    clearLocalAuthStorage();
    setProfileStatus("idle");
    setAuthState(createUnauthenticatedAuthState());
    router.replace("/login");

    if (client) {
      void signOutSupabaseInBackground(client);
    }

    return {
      data: undefined,
      ok: true,
    };
  }

  async function signOutSupabaseInBackground(client: SupabaseClient) {
    if (hasHubSupabaseConfig()) {
      try {
        logSupabaseDiagnostic("auth", "signOut start", {
          function: "AuthProvider.signOut",
          supabase: getHubSupabaseDiagnostics(),
        });
        const { error } = await withMeasuredTimeout(
          client.auth.signOut({ scope: "local" }),
          "Tempo excedido ao encerrar a sessao Supabase.",
          "signOut",
          5_000,
        );

        if (error) {
          logSupabaseDiagnostic("auth", "signOut error", {
            error: serializeDiagnosticError(error),
            function: "AuthProvider.signOut",
            supabase: getHubSupabaseDiagnostics(),
          });
        }
      } catch (error) {
        logSupabaseDiagnostic("auth", "signOut error", {
          error: serializeDiagnosticError(error),
          function: "AuthProvider.signOut",
          supabase: getHubSupabaseDiagnostics(),
        });
      }
    }
  }

  if (authState.status === "loading" && !isLoginRoute) {
    return <AuthGateMessage message="Carregando sessao..." />;
  }

  if (authState.status === "error" && !isLoginRoute) {
    const authGateMessage = getAuthGateMessage(authState);
    const shouldResetSession = shouldResetSessionAfterAuthError(authGateMessage);

    return (
      <AuthGateMessage
        message={authGateMessage}
        onRetry={() => {
          if (shouldResetSession) {
            resetBrokenSessionToLogin({
              setAuthState,
              setProfileStatus,
            });
            return;
          }

          setAuthRetryKey((currentKey) => currentKey + 1);
        }}
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

async function signInViaApiFallback({
  client,
  normalizedEmail,
  password,
  setAuthState,
  setProfileStatus,
}: {
  client: SupabaseClient;
  normalizedEmail: string;
  password: string;
  setAuthState: (state: AuthState) => void;
  setProfileStatus: (status: AuthContextValue["profileStatus"]) => void;
}): Promise<AuthActionResult<AuthSession>> {
  try {
    logSupabaseDiagnostic("auth", "signIn api fallback start", {
      email: normalizedEmail,
      endpoint: "/api/auth/password",
      function: "signInViaApiFallback",
    });

    const response = await withMeasuredTimeout(
      fetch("/api/auth/password", {
        body: JSON.stringify({
          email: normalizedEmail,
          password,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
      "Tempo excedido ao autenticar com Supabase pelo servidor.",
      "session",
      25_000,
    );
    const payload = (await response.json().catch(() => null)) as
      | PasswordSignInFallbackResponse
      | null;

    if (
      !response.ok ||
      typeof payload?.session?.access_token !== "string" ||
      typeof payload.session.refresh_token !== "string"
    ) {
      const message = getFriendlyAuthMessage(payload?.error);

      logSupabaseDiagnostic("auth", "signIn api fallback error", {
        email: normalizedEmail,
        endpoint: "/api/auth/password",
        response: payload,
        status: response.status,
        statusText: response.statusText,
      });

      return {
        error: message,
        ok: false,
      };
    }

    const { data, error } = await withMeasuredTimeout(
      client.auth.setSession({
        access_token: payload.session.access_token,
        refresh_token: payload.session.refresh_token,
      }),
      "Tempo excedido ao gravar a sessao Supabase.",
      "session",
      10_000,
    );

    if (error || !data.session) {
      const message = error
        ? getFriendlySupabaseError(error)
        : "Nao foi possivel iniciar a sessao Supabase.";

      logSupabaseDiagnostic("auth", "signIn api fallback error", {
        email: normalizedEmail,
        endpoint: "/api/auth/password",
        error: error ? serializeDiagnosticError(error) : null,
        reason: "setSession failed",
      });

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

    logSupabaseDiagnostic("auth", "signIn api fallback done", {
      email: normalizedEmail,
      endpoint: "/api/auth/password",
      userId: data.session.user.id,
    });

    return {
      data: session,
      ok: true,
    };
  } catch (error) {
    const message = getFriendlyAuthMessage(
      getErrorMessage(error, "Nao foi possivel autenticar com Supabase."),
    );

    logSupabaseDiagnostic("auth", "signIn api fallback error", {
      email: normalizedEmail,
      endpoint: "/api/auth/password",
      error: serializeDiagnosticError(error),
    });

    return {
      error: message,
      ok: false,
    };
  }
}

async function recoverHubSessionViaApiFallback({
  client,
  isMounted,
  setAuthState,
  setProfileStatus,
}: {
  client: SupabaseClient;
  isMounted: () => boolean;
  setAuthState: (state: AuthState) => void;
  setProfileStatus: (status: AuthContextValue["profileStatus"]) => void;
}) {
  const cachedSession = getCachedSupabaseSessionFromStorage();

  if (!cachedSession) {
    logSupabaseDiagnostic("auth", "session api recovery skipped", {
      endpoint: "/api/auth/session",
      reason: "cached session missing",
    });
    return false;
  }

  try {
    logSupabaseDiagnostic("auth", "session api recovery start", {
      endpoint: "/api/auth/session",
      function: "recoverHubSessionViaApiFallback",
    });

    const response = await withMeasuredTimeout(
      fetch("/api/auth/session", {
        body: JSON.stringify(cachedSession),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
      "Tempo excedido ao recuperar a sessao pelo servidor.",
      "session",
      20_000,
    );
    const payload = (await response.json().catch(() => null)) as
      | SessionRecoveryResponse
      | null;

    if (!response.ok || !payload?.profile) {
      logSupabaseDiagnostic("auth", "session api recovery error", {
        endpoint: "/api/auth/session",
        response: payload,
        status: response.status,
        statusText: response.statusText,
      });
      return false;
    }

    if (!isMounted()) {
      return true;
    }

    setAuthState(
      createAuthStateFromSession(
        createAuthSessionFromRecoveredProfile(payload.profile, payload.session),
      ),
    );
    setProfileStatus("ready");
    syncRecoveredSupabaseSession(client, payload.session);

    logSupabaseDiagnostic("auth", "session api recovery done", {
      endpoint: "/api/auth/session",
      role: payload.profile.role,
      userId: payload.profile.id,
    });

    return true;
  } catch (error) {
    logSupabaseDiagnostic("auth", "session api recovery error", {
      endpoint: "/api/auth/session",
      error: serializeDiagnosticError(error),
    });
    return false;
  }
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
  logSupabaseDiagnostic("auth", "profile start", {
    email: session.user.email,
    function: "loadHubProfileInBackground",
    table: "hub_users",
    userId: session.user.id,
    supabase: getHubSupabaseDiagnostics(),
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
      logSupabaseDiagnostic("auth", "profile error", {
        email: session.user.email,
        error: error ? serializeDiagnosticError(error) : null,
        function: "loadHubProfileInBackground",
        reason: !data ? "profile unavailable" : "profile inactive",
        status: data?.status,
        table: "hub_users",
        userId: session.user.id,
        supabase: getHubSupabaseDiagnostics(),
      });

      if (error || !data) {
        const fallbackProfile = await loadHubProfileViaApi(session);

        if (fallbackProfile?.status === "active") {
          setAuthState(
            createAuthStateFromSession(
              createAuthSessionFromProfile(session, fallbackProfile),
            ),
          );
          setProfileStatus("ready");
          return;
        }
      }

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
    logSupabaseDiagnostic("auth", "profile done", {
      elapsedMs: Math.round(performance.now() - startedAt),
      function: "loadHubProfileInBackground",
      role: data.role,
      table: "hub_users",
      userId: data.id,
    });
  } catch (error) {
    logSupabaseDiagnostic("auth", "profile error", {
      email: session.user.email,
      error: serializeDiagnosticError(error),
      function: "loadHubProfileInBackground",
      table: "hub_users",
      userId: session.user.id,
      supabase: getHubSupabaseDiagnostics(),
    });
    const fallbackProfile = await loadHubProfileViaApi(session);

    if (fallbackProfile?.status === "active") {
      setAuthState(
        createAuthStateFromSession(
          createAuthSessionFromProfile(session, fallbackProfile),
        ),
      );
      setProfileStatus("ready");
      return;
    }

    setProfileStatus("error");
  }
}

async function loadHubProfileViaApi(
  session: Session,
): Promise<HubProfileRow | null> {
  if (!session.access_token) {
    return null;
  }

  try {
    logSupabaseDiagnostic("auth", "profile api fallback start", {
      endpoint: "/api/auth/profile",
      function: "loadHubProfileViaApi",
      table: "hub_users",
      userId: session.user.id,
    });

    const response = await withMeasuredTimeout(
      fetch("/api/auth/profile", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }),
      "Tempo excedido ao carregar o perfil operacional pelo servidor.",
      "profile",
      10_000,
    );
    const payload = (await response.json().catch(() => null)) as
      | ProfileFallbackResponse
      | null;

    if (!response.ok || !payload?.profile) {
      logSupabaseDiagnostic("auth", "profile api fallback error", {
        endpoint: "/api/auth/profile",
        function: "loadHubProfileViaApi",
        response: payload,
        status: response.status,
        statusText: response.statusText,
        table: "hub_users",
        userId: session.user.id,
      });
      return null;
    }

    logSupabaseDiagnostic("auth", "profile api fallback done", {
      endpoint: "/api/auth/profile",
      function: "loadHubProfileViaApi",
      role: payload.profile.role,
      table: "hub_users",
      userId: payload.profile.id,
    });

    return payload.profile;
  } catch (error) {
    logSupabaseDiagnostic("auth", "profile api fallback error", {
      endpoint: "/api/auth/profile",
      error: serializeDiagnosticError(error),
      function: "loadHubProfileViaApi",
      table: "hub_users",
      userId: session.user.id,
    });
    return null;
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

function createAuthSessionFromRecoveredProfile(
  profile: HubProfileRow,
  session?: SessionRecoveryResponse["session"],
): AuthSession {
  return {
    accessToken:
      typeof session?.access_token === "string"
        ? session.access_token
        : undefined,
    expiresAt: normalizeRecoveredExpiresAt(session),
    provider: "supabase",
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

function normalizeRecoveredExpiresAt(
  session?: SessionRecoveryResponse["session"],
) {
  if (typeof session?.expires_at === "number") {
    return new Date(session.expires_at * 1000).toISOString();
  }

  if (typeof session?.expires_at === "string" && session.expires_at.trim()) {
    const numericValue = Number(session.expires_at);

    if (Number.isFinite(numericValue)) {
      return new Date(numericValue * 1000).toISOString();
    }

    return session.expires_at;
  }

  if (typeof session?.expires_in === "number") {
    return new Date(Date.now() + session.expires_in * 1000).toISOString();
  }

  return undefined;
}

function syncRecoveredSupabaseSession(
  client: SupabaseClient,
  session?: SessionRecoveryResponse["session"],
) {
  if (
    typeof session?.access_token !== "string" ||
    typeof session.refresh_token !== "string"
  ) {
    return;
  }

  void withMeasuredTimeout(
    client.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }),
    "Tempo excedido ao sincronizar a sessao Supabase.",
    "session",
    8_000,
  ).catch((error: unknown) => {
    logSupabaseDiagnostic("auth", "session sync error", {
      error: serializeDiagnosticError(error),
      function: "syncRecoveredSupabaseSession",
      supabase: getHubSupabaseDiagnostics(),
    });
  });
}

function getCachedSupabaseSessionFromStorage(): CachedSupabaseSession | null {
  const storageKey = getSupabaseAuthStorageKey(hubSupabaseConfig.url);
  const candidateKeys = new Set<string>();

  if (storageKey) {
    candidateKeys.add(storageKey);
  }

  const projectRef = getSupabaseProjectRef(hubSupabaseConfig.url);

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);

    if (
      key &&
      (key.includes("auth-token") ||
        key.includes("supabase") ||
        Boolean(projectRef && key.includes(projectRef)))
    ) {
      candidateKeys.add(key);
    }
  }

  for (const key of candidateKeys) {
    const rawSession = window.localStorage.getItem(key);

    if (!rawSession) {
      continue;
    }

    try {
      const parsedSession = JSON.parse(rawSession) as unknown;
      const session = extractCachedSupabaseSession(parsedSession);

      if (session?.accessToken || session?.refreshToken) {
        logSupabaseDiagnostic("auth", "cached session found", {
          key: maskStorageKey(key),
        });
        return session;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function extractCachedSupabaseSession(
  input: unknown,
): CachedSupabaseSession | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const maybeSession = input as {
    access_token?: unknown;
    currentSession?: unknown;
    refresh_token?: unknown;
    session?: unknown;
  };
  const nestedSession =
    extractCachedSupabaseSession(maybeSession.currentSession) ??
    extractCachedSupabaseSession(maybeSession.session);
  const accessToken =
    typeof maybeSession.access_token === "string"
      ? maybeSession.access_token
      : nestedSession?.accessToken;
  const refreshToken =
    typeof maybeSession.refresh_token === "string"
      ? maybeSession.refresh_token
      : nestedSession?.refreshToken;

  if (!accessToken && !refreshToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
  };
}

function getUserMetadataString(user: User, key: string): string | undefined {
  const value = user.user_metadata[key] ?? user.app_metadata[key];

  return typeof value === "string" && value.trim() ? value : undefined;
}

function withMeasuredTimeout<Result>(
  promise: PromiseLike<Result>,
  message: string,
  label: "profile" | "session" | "signOut",
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
        logSupabaseDiagnostic("auth", `${label} error`, {
          elapsedMs: Math.round(performance.now() - startedAt),
          error: serializeDiagnosticError(error),
          message: getErrorMessage(error, "Erro desconhecido."),
          supabase: getHubSupabaseDiagnostics(),
        });
        reject(error);
      },
    );
  });
}

function clearLocalAuthStorage() {
  window.localStorage.removeItem(MOCK_AUTH_STORAGE_KEY);

  const supabaseStorageKey = getSupabaseAuthStorageKey(hubSupabaseConfig.url);

  if (!supabaseStorageKey) {
    return;
  }

  window.localStorage.removeItem(supabaseStorageKey);
  window.localStorage.removeItem(`${supabaseStorageKey}-code-verifier`);
}

function getSupabaseAuthStorageKey(url?: string) {
  const projectRef = getSupabaseProjectRef(url);

  return projectRef ? `sb-${projectRef}-auth-token` : null;
}

function getSupabaseProjectRef(url?: string) {
  if (!url?.trim()) {
    return null;
  }

  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function maskStorageKey(key: string) {
  if (key.length <= 12) {
    return key;
  }

  return `${key.slice(0, 6)}...${key.slice(-6)}`;
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

function getFriendlySupabaseError(error: unknown): string {
  if (isSupabaseAuthNetworkError(error)) {
    return "Não foi possível conectar ao Supabase agora. Verifique sua conexão e tente novamente.";
  }

  return getFriendlyAuthMessage(
    getErrorMessage(error, "Não foi possível validar seu acesso ao Hub Careli."),
  );
}

function isSupabaseAuthNetworkError(error: unknown) {
  const message = getErrorMessage(error, "").trim().toLowerCase();

  if (
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("network request failed") ||
    message.includes("networkerror") ||
    message.includes("nao foi possivel conectar ao supabase") ||
    message.includes("supabase network unavailable") ||
    message.includes("supabase_network_unavailable")
  ) {
    return true;
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as {
    code?: unknown;
    name?: unknown;
    status?: unknown;
  };
  const errorName =
    typeof maybeError.name === "string"
      ? maybeError.name.trim().toLowerCase()
      : "";
  const status =
    typeof maybeError.status === "number" ? maybeError.status : undefined;

  return (
    errorName === "authretryablefetcherror" ||
    maybeError.code === "supabase_network_unavailable" ||
    status === 0 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 520 ||
    status === 521 ||
    status === 522 ||
    status === 523 ||
    status === 524 ||
    status === 530
  );
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

function shouldResetSessionAfterAuthError(error?: string) {
  const normalizedError = (error ?? "").trim().toLowerCase();

  return (
    normalizedError.includes("failed to fetch") ||
    normalizedError.includes("fetch failed") ||
    normalizedError.includes("network request failed") ||
    normalizedError.includes("networkerror") ||
    normalizedError.includes("nao foi possivel conectar ao supabase") ||
    normalizedError.includes("não foi possível conectar ao supabase") ||
    normalizedError.includes("supabase network unavailable") ||
    normalizedError.includes("supabase_network_unavailable") ||
    (normalizedError.includes("tempo excedido") &&
      normalizedError.includes("supabase"))
  );
}

function resetBrokenSessionToLogin({
  setAuthState,
  setProfileStatus,
}: {
  setAuthState: (state: AuthState) => void;
  setProfileStatus: (status: AuthContextValue["profileStatus"]) => void;
}) {
  clearLocalAuthStorage();
  setProfileStatus("idle");
  setAuthState(createUnauthenticatedAuthState());

  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
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

  if (
    normalizedError.includes("failed to fetch") ||
    normalizedError.includes("fetch failed") ||
    normalizedError.includes("network request failed") ||
    normalizedError.includes("networkerror") ||
    normalizedError.includes("nao foi possivel conectar ao supabase") ||
    normalizedError.includes("supabase network unavailable") ||
    normalizedError.includes("supabase_network_unavailable")
  ) {
    return "Não foi possível conectar ao Supabase agora. Verifique sua conexão e tente novamente.";
  }

  if (
    normalizedError.includes("tempo excedido") &&
    normalizedError.includes("supabase")
  ) {
    return "Não foi possível conectar ao Supabase agora. Verifique sua conexão e tente novamente.";
  }

  if (normalizedError.includes("tempo excedido")) {
    return "Não foi possível validar seu acesso agora. Tente novamente.";
  }

  return "Não foi possível validar seu acesso ao Hub Careli. Tente novamente.";
}

function AuthGateMessage({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry?: () => void;
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
        {onRetry || onSignOut ? (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {onRetry ? (
              <button
                className="rounded-md bg-[#101820] px-4 py-2 text-sm font-semibold text-white outline-none transition hover:bg-[#182431] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
                onClick={onRetry}
                type="button"
              >
                Tentar novamente
              </button>
            ) : null}
            {onSignOut ? (
              <button
                className="rounded-md border border-[#d9e0e7] bg-white px-4 py-2 text-sm font-semibold text-[#344054] outline-none transition hover:bg-[#f8fafc] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
                onClick={onSignOut}
                type="button"
              >
                Sair
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
