import {
  getPermissionsForRole,
  type HubUserContext,
  type HubUserRole,
} from "@repo/shared";
import type { AuthSession, AuthState, AuthUser } from "./types";

export const MOCK_AUTH_STORAGE_KEY = "careli:mock-auth-session";

export type CreateMockAuthStateInput = {
  email?: string;
  fullName?: string;
  id?: string;
  role?: HubUserRole;
  workspaceId?: string;
};

function createMockAuthUser({
  email = "admin@careli.local",
  fullName = "Admin Careli",
  id = "mock-admin",
  role = "admin",
  workspaceId = "careli",
}: CreateMockAuthStateInput = {}): AuthUser {
  return {
    email,
    fullName,
    id,
    permissions: getPermissionsForRole(role),
    role,
    workspaceId,
  };
}

export function createMockAuthState(
  input: AuthUser | CreateMockAuthStateInput = createMockAuthUser(),
): AuthState {
  const user = "permissions" in input ? input : createMockAuthUser(input);

  return createAuthStateFromSession({
    provider: "mock",
    user,
  });
}

export function createMockAuthSession(
  input: AuthUser | CreateMockAuthStateInput = createMockAuthUser(),
): AuthSession {
  const user = "permissions" in input ? input : createMockAuthUser(input);

  return {
    user,
    provider: "mock",
  };
}

export function createAuthStateFromSession(
  session: AuthSession | null,
): AuthState {
  if (!session) {
    return createUnauthenticatedAuthState();
  }

  return {
    session,
    status: "authenticated",
    user: session.user,
  };
}

export function createUnauthenticatedAuthState(): AuthState {
  return {
    session: null,
    status: "unauthenticated",
    user: null,
  };
}

export function isAuthenticated(authState: AuthState): boolean {
  return authState.status === "authenticated" && Boolean(authState.user);
}

export function getUserDisplayName(user: AuthUser | null): string {
  if (!user) {
    return "Guest";
  }

  return user.fullName ?? user.email ?? user.id;
}

export function getUserInitials(user: AuthUser | null): string {
  const displayName = getUserDisplayName(user);
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || "U";
}

export function mapAuthUserToHubUserContext(user: AuthUser): HubUserContext {
  return {
    id: user.id,
    name: getUserDisplayName(user),
    permissions: user.permissions,
    role: user.role,
    workspaceId: user.workspaceId,
  };
}
