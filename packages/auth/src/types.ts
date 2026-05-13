import type {
  HubPermission,
  HubUserRole,
  PermissionScope,
} from "@repo/shared";

export type AuthUser = {
  avatarUrl?: string;
  email?: string;
  fullName?: string;
  id: string;
  permissions: readonly HubPermission[];
  role: HubUserRole;
  status?: "active" | "archived" | "disabled";
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

export type AuthErrorDetails = {
  code?:
    | "hub_profile_create_failed"
    | "hub_profile_inactive"
    | "hub_profile_invalid"
    | "hub_profile_missing"
    | "supabase_auth_error"
    | "supabase_unavailable";
  email?: string;
  hint?: string;
  queryResult?: "created" | "error" | "found" | "missing";
  userId?: string;
};

export type AuthState = {
  error?: string;
  errorDetails?: AuthErrorDetails;
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
      errorDetails?: AuthErrorDetails;
      ok: false;
    };

export type AuthAdapter = {
  getSession: () => Promise<AuthActionResult<AuthSession | null>>;
  refreshSession?: () => Promise<AuthActionResult<AuthSession | null>>;
  signIn?: (input?: unknown) => Promise<AuthActionResult<AuthSession>>;
  signOut?: () => Promise<AuthActionResult>;
};

export type PasswordAuthCredentials = {
  email: string;
  password: string;
};

export type MockAuthCredentials = PasswordAuthCredentials;

export type AuthPermissionCheck = {
  permission: HubPermission;
  scope?: PermissionScope;
  user: AuthUser | null;
};
