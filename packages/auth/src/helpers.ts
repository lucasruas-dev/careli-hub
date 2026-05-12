import {
  getPermissionsForRole,
  type HubUserContext,
  type HubUserRole,
} from "@repo/shared";
import type { AuthState, AuthUser } from "./types";

type CreateMockAuthStateInput = {
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

  return {
    session: {
      provider: "mock",
      user,
    },
    status: "authenticated",
    user,
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
