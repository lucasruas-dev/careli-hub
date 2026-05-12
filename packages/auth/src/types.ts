import type {
  HubPermission,
  HubUserRole,
  PermissionScope,
} from "@repo/shared";

export type AuthUser = {
  email?: string;
  fullName?: string;
  id: string;
  permissions: readonly HubPermission[];
  role: HubUserRole;
  workspaceId?: string;
};

export type AuthSession = {
  accessToken?: string;
  expiresAt?: string;
  provider?: string;
  user: AuthUser;
};

export type AuthProviderStatus =
  | "idle"
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "error";

export type AuthState = {
  error?: string;
  session: AuthSession | null;
  status: AuthProviderStatus;
  user: AuthUser | null;
};

export type AuthActionResult<Data = undefined> =
  | {
      data: Data;
      error?: never;
      ok: true;
    }
  | {
      data?: never;
      error: string;
      ok: false;
    };

export type AuthAdapter = {
  getSession: () => Promise<AuthActionResult<AuthSession | null>>;
  refreshSession?: () => Promise<AuthActionResult<AuthSession | null>>;
  signIn?: (input?: unknown) => Promise<AuthActionResult<AuthSession>>;
  signOut?: () => Promise<AuthActionResult>;
};

export type MockAuthCredentials = {
  email: string;
  password: string;
};

export type AuthPermissionCheck = {
  permission: HubPermission;
  scope?: PermissionScope;
  user: AuthUser | null;
};
