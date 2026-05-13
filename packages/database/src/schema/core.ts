export type CanonicalRecordStatus = "active" | "archived" | "disabled";

export type CanonicalTimestamp = string;

export type CanonicalOperationalProfileRole =
  | "op1"
  | "op2"
  | "op3"
  | "ldr"
  | "cdr"
  | "adm";

export type CanonicalVisibilityScope =
  | "self"
  | "sector"
  | "department"
  | "global";

export type HubDepartmentRecord = {
  createdAt: CanonicalTimestamp;
  id: string;
  name: string;
  slug: string;
  status: CanonicalRecordStatus;
  updatedAt: CanonicalTimestamp;
};

export type HubSectorRecord = {
  createdAt: CanonicalTimestamp;
  departmentId: HubDepartmentRecord["id"];
  id: string;
  name: string;
  slug: string;
  status: CanonicalRecordStatus;
  updatedAt: CanonicalTimestamp;
};

export type HubUserRecord = {
  avatarUrl?: string;
  createdAt: CanonicalTimestamp;
  departmentId?: HubDepartmentRecord["id"];
  displayName: string;
  email: string;
  id: string;
  lastSeenAt?: CanonicalTimestamp;
  operationalProfile?: CanonicalOperationalProfileRole;
  role: "admin" | "leader" | "operator" | "viewer";
  sectorId?: HubSectorRecord["id"];
  status: CanonicalRecordStatus;
  updatedAt: CanonicalTimestamp;
  visibilityScope?: CanonicalVisibilityScope;
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
  status: "active" | "disabled" | "locked" | "planned";
  updatedAt: CanonicalTimestamp;
};

export type HubDepartmentModuleAccessRecord = {
  createdAt: CanonicalTimestamp;
  departmentId: HubDepartmentRecord["id"];
  id: string;
  moduleId: HubModuleRecord["id"];
  status: "enabled" | "disabled" | "planned";
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
  id: string;
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
  hub_department_module_access: HubDepartmentModuleAccessRecord;
  hub_departments: HubDepartmentRecord;
  hub_files: HubFileRecord;
  hub_integrations: HubIntegrationRecord;
  hub_modules: HubModuleRecord;
  hub_notifications: HubNotificationRecord;
  hub_permissions: HubPermissionRecord;
  hub_presence: HubPresenceRecord;
  hub_user_permissions: HubUserPermissionRecord;
  hub_users: HubUserRecord;
  hub_sectors: HubSectorRecord;
  hub_workspaces: HubWorkspaceRecord;
};

export type CanonicalDatabaseTableName = keyof CanonicalDatabaseSchema;

export const canonicalDatabaseTableNames = [
  "hub_users",
  "hub_departments",
  "hub_sectors",
  "hub_workspaces",
  "hub_modules",
  "hub_department_module_access",
  "hub_permissions",
  "hub_user_permissions",
  "hub_activity_events",
  "hub_notifications",
  "hub_presence",
  "hub_files",
  "hub_integrations",
] as const satisfies readonly CanonicalDatabaseTableName[];
