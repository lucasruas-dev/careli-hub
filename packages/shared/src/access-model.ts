import type { HubModule } from "./modules/types";
import type { HubUserRole } from "./permissions/types";

export type OperationalProfileRole = "op1" | "op2" | "op3" | "ldr" | "cdr" | "adm";

export type VisibilityScope = "self" | "sector" | "department" | "global";

export type Department = {
  id: string;
  name: string;
  slug: string;
};

export type Sector = {
  departmentId: Department["id"];
  id: string;
  name: string;
  slug: string;
};

export type DepartmentModuleAccess = {
  departmentId: Department["id"];
  moduleId: HubModule["id"];
  status: "enabled" | "disabled" | "planned";
};

export type OperationalUserProfile = {
  departmentId?: Department["id"];
  profileRole: OperationalProfileRole;
  sectorId?: Sector["id"];
  visibilityScope: VisibilityScope;
};

export const operationalProfileHierarchy = [
  "op1",
  "op2",
  "op3",
  "ldr",
  "cdr",
  "adm",
] as const satisfies readonly OperationalProfileRole[];

export const operationalProfileVisibilityScope = {
  adm: "global",
  cdr: "department",
  ldr: "sector",
  op1: "self",
  op2: "self",
  op3: "self",
} as const satisfies Record<OperationalProfileRole, VisibilityScope>;

export const legacyRoleToOperationalProfile = {
  admin: "adm",
  leader: "ldr",
  operator: "op1",
  viewer: "op1",
} as const satisfies Record<HubUserRole, OperationalProfileRole>;

export function mapLegacyRoleToOperationalProfile(
  role: HubUserRole,
): OperationalProfileRole {
  return legacyRoleToOperationalProfile[role];
}

export function getVisibilityScopeForProfile(
  profileRole: OperationalProfileRole,
): VisibilityScope {
  return operationalProfileVisibilityScope[profileRole];
}
