export type CanonicalRecordStatus = "active" | "archived" | "disabled";

export type CanonicalTimestamp = string;

export type HubUserRecord = {
  avatarUrl?: string;
  createdAt: CanonicalTimestamp;
  displayName: string;
  email: string;
  id: string;
  lastSeenAt?: CanonicalTimestamp;
  role: "admin" | "leader" | "operator" | "viewer";
  status: CanonicalRecordStatus;
  updatedAt: CanonicalTimestamp;
};

export type HubWorkspaceRecord = {
  createdAt: CanonicalTimestamp;
  description?: string;
  id: string;
  name: string;
  ownerUserId?: HubUserRecord["id"];
  slug: string;
  status: CanonicalRecordStatus;
  updatedAt: CanonicalTimestamp;
};

export type HubModuleRecord = {
  basePath: string;
  category:
    | "core"
    | "operations"
    | "finance"
    | "productivity"
    | "relationship"
    | "commercial"
    | "procurement";
  createdAt: CanonicalTimestamp;
  description: string;
  iconKey: string;
  id: string;
  name: string;
  order: number;
  realtimeEnabled: boolean;
  status: "available" | "beta" | "disabled" | "planned";
  updatedAt: CanonicalTimestamp;
};

export type HubPermissionRecord = {
  createdAt: CanonicalTimestamp;
  description?: string;
  id: string;
  key: string;
  moduleId?: HubModuleRecord["id"];
  scope: "hub" | "module" | "workspace" | "system";
  updatedAt: CanonicalTimestamp;
};

export type HubUserPermissionRecord = {
  createdAt: CanonicalTimestamp;
  grantedByUserId?: HubUserRecord["id"];
  id: string;
  permissionId: HubPermissionRecord["id"];
  revokedAt?: CanonicalTimestamp;
  userId: HubUserRecord["id"];
  workspaceId?: HubWorkspaceRecord["id"];
};

export type HubActivityEventRecord = {
  createdAt: CanonicalTimestamp;
  description?: string;
  id: string;
  metadata?: Record<string, unknown>;
  moduleId?: HubModuleRecord["id"];
  severity: "neutral" | "info" | "success" | "warning" | "danger";
  title: string;
  type: "system" | "module" | "notification" | "presence" | "sync";
  userId?: HubUserRecord["id"];
  workspaceId?: HubWorkspaceRecord["id"];
};

export type HubNotificationRecord = {
  actionHref?: string;
  createdAt: CanonicalTimestamp;
  id: string;
  moduleId?: HubModuleRecord["id"];
  readAt?: CanonicalTimestamp;
  recipientUserId: HubUserRecord["id"];
  severity: HubActivityEventRecord["severity"];
  title: string;
  workspaceId?: HubWorkspaceRecord["id"];
};

export type HubPresenceRecord = {
  lastSeenAt: CanonicalTimestamp;
  moduleId?: HubModuleRecord["id"];
  status: "online" | "away" | "busy" | "offline";
  userId: HubUserRecord["id"];
  workspaceId?: HubWorkspaceRecord["id"];
};

export type HubFileRecord = {
  createdAt: CanonicalTimestamp;
  createdByUserId: HubUserRecord["id"];
  id: string;
  metadata?: Record<string, unknown>;
  mimeType: string;
  moduleId?: HubModuleRecord["id"];
  name: string;
  sizeBytes: number;
  storagePath: string;
  updatedAt: CanonicalTimestamp;
  workspaceId: HubWorkspaceRecord["id"];
};

export type HubIntegrationRecord = {
  config?: Record<string, unknown>;
  createdAt: CanonicalTimestamp;
  id: string;
  moduleId?: HubModuleRecord["id"];
  name: string;
  provider: string;
  status: "connected" | "disabled" | "error" | "pending";
  updatedAt: CanonicalTimestamp;
  workspaceId?: HubWorkspaceRecord["id"];
};

export type CanonicalDatabaseSchema = {
  hub_activity_events: HubActivityEventRecord;
  hub_files: HubFileRecord;
  hub_integrations: HubIntegrationRecord;
  hub_modules: HubModuleRecord;
  hub_notifications: HubNotificationRecord;
  hub_permissions: HubPermissionRecord;
  hub_presence: HubPresenceRecord;
  hub_user_permissions: HubUserPermissionRecord;
  hub_users: HubUserRecord;
  hub_workspaces: HubWorkspaceRecord;
};

export type CanonicalDatabaseTableName = keyof CanonicalDatabaseSchema;

export const canonicalDatabaseTableNames = [
  "hub_users",
  "hub_workspaces",
  "hub_modules",
  "hub_permissions",
  "hub_user_permissions",
  "hub_activity_events",
  "hub_notifications",
  "hub_presence",
  "hub_files",
  "hub_integrations",
] as const satisfies readonly CanonicalDatabaseTableName[];
