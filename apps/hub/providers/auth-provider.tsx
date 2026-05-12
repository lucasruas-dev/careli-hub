"use client";

import { mockAuthState, mockHubUserContext } from "@/lib/auth-state";
import type { AuthState } from "@repo/auth";
import type { HubUserContext } from "@repo/shared";
import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

type AuthContextValue = {
  authState: AuthState;
  hubUser: HubUserContext;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <AuthContext.Provider
      value={{
        authState: mockAuthState,
        hubUser: mockHubUserContext,
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
