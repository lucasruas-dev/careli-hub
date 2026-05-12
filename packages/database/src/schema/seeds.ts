import {
  hubModules,
  rolePermissionMatrix,
  type HubPermission,
  type HubUserRole,
} from "@repo/shared";
import type {
  HubModuleRecord,
  HubPermissionRecord,
} from "./core";

const seedTimestamp = "seed";

function getPermissionModuleId(permission: HubPermission): string | undefined {
  const [scope] = permission.split(":");

  return scope === "hub" ? undefined : scope;
}

function getPermissionScope(permission: HubPermission): HubPermissionRecord["scope"] {
  return permission.startsWith("hub:") ? "hub" : "module";
}

export const hubModuleSeedDrafts = hubModules.map((hubModule) => ({
  basePath: hubModule.basePath,
  category: hubModule.category,
  createdAt: seedTimestamp,
  description: hubModule.description,
  iconKey: hubModule.iconKey,
  id: hubModule.id,
  name: hubModule.name,
  order: hubModule.order,
  realtimeEnabled: hubModule.realtimeEnabled,
  status: hubModule.status,
  updatedAt: seedTimestamp,
})) satisfies readonly HubModuleRecord[];

const permissionSeeds = new Map<HubPermission, HubPermissionRecord>();

Object.values(rolePermissionMatrix).forEach((permissions) => {
  permissions.forEach((permission) => {
    permissionSeeds.set(permission, {
      createdAt: seedTimestamp,
      id: permission.replace(":", "-"),
      key: permission,
      moduleId: getPermissionModuleId(permission),
      scope: getPermissionScope(permission),
      updatedAt: seedTimestamp,
    });
  });
});

export const hubPermissionSeedDrafts = [
  ...permissionSeeds.values(),
] satisfies readonly HubPermissionRecord[];

export const hubRoleSeedDrafts = [
  {
    description: "Acesso administrativo completo ao Hub.",
    id: "admin",
    permissions: rolePermissionMatrix.admin,
  },
  {
    description: "Lideranca operacional com gestao de modulos selecionados.",
    id: "leader",
    permissions: rolePermissionMatrix.leader,
  },
  {
    description: "Operacao diaria com acesso de visualizacao aos modulos base.",
    id: "operator",
    permissions: rolePermissionMatrix.operator,
  },
  {
    description: "Consulta operacional com permissoes de leitura.",
    id: "viewer",
    permissions: rolePermissionMatrix.viewer,
  },
] as const satisfies readonly {
  description: string;
  id: HubUserRole;
  permissions: readonly HubPermission[];
}[];

export const canonicalSeedDrafts = {
  hubModules: hubModuleSeedDrafts,
  hubPermissions: hubPermissionSeedDrafts,
  roles: hubRoleSeedDrafts,
} as const;
