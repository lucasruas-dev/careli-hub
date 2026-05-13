"use client";

import {
  MOCK_AUTH_STORAGE_KEY,
  createAuthStateFromSession,
  createMockAuthState,
  createSupabaseAuthAdapter,
  createUnauthenticatedAuthState,
  hasSupabaseAuthConfig,
  isAuthenticated,
  mapAuthUserToHubUserContext,
  type AuthActionResult,
  type AuthErrorDetails,
  type AuthSession,
  type AuthState,
  type PasswordAuthCredentials,
  type SupabaseAuthAdapter,
} from "@repo/auth";
import type { HubUserContext } from "@repo/shared";
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
  signIn: (
    credentials: PasswordAuthCredentials,
  ) => Promise<AuthActionResult<AuthSession>>;
  signOut: () => Promise<AuthActionResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const SUPABASE_AUTH_CONFIG = {
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  workspaceId: process.env.NEXT_PUBLIC_SUPABASE_WORKSPACE_ID ?? "careli",
};
const AUTH_BOOTSTRAP_TIMEOUT_MS = 12_000;

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
  const isLoginRoute = pathname === "/login";
  const supabaseAuthAdapter = useMemo<SupabaseAuthAdapter | null>(() => {
    if (!hasSupabaseAuthConfig(SUPABASE_AUTH_CONFIG)) {
      return null;
    }

    return createSupabaseAuthAdapter(SUPABASE_AUTH_CONFIG);
  }, []);
  const hubUser = useMemo(
    () =>
      authState.user ? mapAuthUserToHubUserContext(authState.user) : null,
    [authState.user],
  );

  useEffect(() => {
    if (supabaseAuthAdapter) {
      let isMounted = true;

      withTimeout(
        supabaseAuthAdapter.getSession(),
        "Tempo excedido ao carregar a sessao.",
      )
        .then((result) => {
          if (!isMounted) {
            return;
          }

          logAuthDebug("auth session loaded", result.ok ? "resolved" : "error");
          setAuthState(createAuthStateFromResult(result));
        })
        .catch((error: unknown) => {
          if (!isMounted) {
            return;
          }

          const message = getErrorMessage(
            error,
            "Nao foi possivel carregar a sessao.",
          );

          logAuthDebug("auth error", message);
          setAuthState(createAuthErrorState(message));
        });

      const subscription = supabaseAuthAdapter.onAuthStateChange((result) => {
        if (isMounted) {
          setAuthState(createAuthStateFromResult(result));
        }
      });

      return () => {
        isMounted = false;
        subscription.unsubscribe();
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
  }, [supabaseAuthAdapter]);

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

    if (supabaseAuthAdapter) {
      let result: AuthActionResult<AuthSession> | undefined;

      try {
        result = await withTimeout(
          supabaseAuthAdapter.signIn?.({
            email: normalizedEmail,
            password,
          }) ?? Promise.resolve(undefined),
          "Tempo excedido ao entrar no Hub.",
        );
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

      if (!result) {
        return {
          error: "Adaptador Supabase Auth indisponivel.",
          ok: false,
        };
      }

      if (result.ok) {
        window.localStorage.removeItem(MOCK_AUTH_STORAGE_KEY);
        logAuthDebug("hub user profile loaded", result.data.user.id);
        setAuthState(createAuthStateFromSession(result.data));
      } else {
        const message = getFriendlyAuthMessage(
          result.error,
          result.errorDetails,
        );

        logAuthDebug("auth error", result.error);
        setAuthState(createAuthErrorState(message, result.errorDetails));

        return {
          ...result,
          error: message,
        };
      }

      return result;
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
    if (supabaseAuthAdapter) {
      const result = await supabaseAuthAdapter.signOut?.();

      if (result && !result.ok) {
        return result;
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

function createAuthStateFromResult(
  result: AuthActionResult<AuthSession | null>,
): AuthState {
  if (result.ok) {
    return createAuthStateFromSession(result.data);
  }

  return {
    ...createUnauthenticatedAuthState(),
    error: result.error,
    errorDetails: result.errorDetails,
    status: "error",
  };
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

function withTimeout<Result>(
  promise: PromiseLike<Result>,
  message: string,
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, AUTH_BOOTSTRAP_TIMEOUT_MS);

    promise.then(
      (result) => {
        window.clearTimeout(timeoutId);
        resolve(result);
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId);
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
