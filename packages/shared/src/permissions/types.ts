import type { Department, OperationalUserProfile, Sector } from "../access-model";

export type HubUserRole = "admin" | "leader" | "operator" | "viewer";

export type HubPermission =
  | "hub:view"
  | "hub:manage"
  | "setup:view"
  | "setup:manage"
  | "apolo:view"
  | "apolo:manage"
  | "hades:view"
  | "hades:manage"
  | "guardian:view"
  | "guardian:manage"
  | "atlas:view"
  | "atlas:manage"
  | "iris:view"
  | "iris:manage"
  | "caredesk:view"
  | "caredesk:manage"
  | "hermes:view"
  | "hermes:manage"
  | "pulsex:view"
  | "pulsex:manage"
  | "chronos:view"
  | "chronos:manage"
  | "zeus:view"
  | "zeus:manage"
  | "squadops:view"
  | "squadops:manage"
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
  avatarUrl?: string;
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
