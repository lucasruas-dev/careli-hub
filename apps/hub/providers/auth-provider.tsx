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
  type AuthSession,
  type AuthState,
  type PasswordAuthCredentials,
  type SupabaseAuthAdapter,
} from "@repo/auth";
import type { HubUserContext } from "@repo/shared";
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
  workspaceId: "careli",
};

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

      supabaseAuthAdapter.getSession().then((result) => {
        if (!isMounted) {
          return;
        }

        if (!result.ok) {
          setAuthState({
            ...createUnauthenticatedAuthState(),
            error: result.error,
            status: "error",
          });
          return;
        }

        setAuthState(createAuthStateFromSession(result.data));
      });

      const subscription = supabaseAuthAdapter.onAuthStateChange((session) => {
        if (isMounted) {
          setAuthState(createAuthStateFromSession(session));
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
        setAuthState(createUnauthenticatedAuthState());
        return;
      }

      setAuthState(
        createAuthStateFromSession(JSON.parse(storedSession) as AuthSession),
      );
    } catch {
      window.localStorage.removeItem(MOCK_AUTH_STORAGE_KEY);
      setAuthState(createUnauthenticatedAuthState());
    }
  }, [supabaseAuthAdapter]);

  useEffect(() => {
    if (authState.status === "loading") {
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
      const result = await supabaseAuthAdapter.signIn?.({
        email: normalizedEmail,
        password,
      });

      if (!result) {
        return {
          error: "Adaptador Supabase Auth indisponivel.",
          ok: false,
        };
      }

      if (result.ok) {
        window.localStorage.removeItem(MOCK_AUTH_STORAGE_KEY);
        setAuthState(createAuthStateFromSession(result.data));
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

function AuthGateMessage({ message }: { message: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--uix-surface-canvas)] px-6 text-center">
      <p className="m-0 text-sm text-[var(--uix-text-muted)]">{message}</p>
    </div>
  );
}
