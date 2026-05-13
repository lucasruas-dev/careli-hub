import type { Department, OperationalUserProfile, Sector } from "../access-model";

export type HubUserRole = "admin" | "leader" | "operator" | "viewer";

export type HubPermission =
  | "hub:view"
  | "hub:manage"
  | "setup:view"
  | "setup:manage"
  | "guardian:view"
  | "guardian:manage"
  | "pulsex:view"
  | "pulsex:manage"
  | "agenda:view"
  | "agenda:manage"
  | "financeiro:view"
  | "financeiro:manage"
  | "drive:view"
  | "drive:manage"
  | "contatos:view"
  | "contatos:manage"
  | "compras:view"
  | "compras:manage";

export type PermissionScope = {
  moduleId?: string;
  workspaceId?: string;
};

export type HubUserContext = {
  department?: Department;
  id: string;
  name: string;
  operationalProfile?: OperationalUserProfile;
  permissions: readonly HubPermission[];
  role: HubUserRole;
  sector?: Sector;
  workspaceId?: string;
};

export type HubPermissionCheck = {
  permission: HubPermission;
  scope?: PermissionScope;
  user: HubUserContext;
};
