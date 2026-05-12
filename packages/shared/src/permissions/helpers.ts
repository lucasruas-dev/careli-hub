import type { HubModule } from "../modules/types";
import { rolePermissionMatrix } from "./matrix";
import type { HubPermission, HubUserContext, HubUserRole } from "./types";

export function hasPermission(
  user: HubUserContext,
  permission: HubPermission,
): boolean {
  return user.permissions.includes(permission);
}

export function hasAnyPermission(
  user: HubUserContext,
  permissions: readonly HubPermission[],
): boolean {
  return permissions.some((permission) => hasPermission(user, permission));
}

export function hasAllPermissions(
  user: HubUserContext,
  permissions: readonly HubPermission[],
): boolean {
  return permissions.every((permission) => hasPermission(user, permission));
}

export function canAccessModule(
  user: HubUserContext,
  module: HubModule,
): boolean {
  return hasAllPermissions(user, module.requiredPermissions);
}

export function getAccessibleModules(
  user: HubUserContext,
  modules: readonly HubModule[],
): HubModule[] {
  return modules.filter((module) => canAccessModule(user, module));
}

export function getPermissionsForRole(
  role: HubUserRole,
): readonly HubPermission[] {
  return rolePermissionMatrix[role];
}

export function createHubUserContextFromRole(input: {
  id: string;
  name: string;
  role: HubUserRole;
  workspaceId?: string;
}): HubUserContext {
  return {
    id: input.id,
    name: input.name,
    permissions: getPermissionsForRole(input.role),
    role: input.role,
    workspaceId: input.workspaceId,
  };
}

export function roleCanViewModule(
  role: HubUserRole,
  module: HubModule,
): boolean {
  const permissions = getPermissionsForRole(role);

  return module.requiredPermissions.every((permission) =>
    permissions.includes(permission),
  );
}

export function roleCanManageModule(
  role: HubUserRole,
  module: HubModule,
): boolean {
  const permissions = getPermissionsForRole(role);
  const managePermission = `${module.id}:manage` as HubPermission;

  return permissions.includes(managePermission);
}
