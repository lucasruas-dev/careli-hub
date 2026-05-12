import type { HubPermission } from "../permissions/types";

export type HubModuleStatus = "available" | "beta" | "planned" | "disabled";

export type HubModuleCategory =
  | "core"
  | "operations"
  | "productivity"
  | "finance"
  | "commercial"
  | "procurement";

export type HubModulePermission = HubPermission;

export type HubModuleRoute = {
  description?: string;
  id: string;
  label: string;
  path: string;
};

export type HubModuleNavigationItem = {
  badge?: string;
  iconKey?: string;
  id: string;
  label: string;
  order: number;
  path: string;
};

export type HubModule = {
  basePath: string;
  category: HubModuleCategory;
  description: string;
  iconKey: string;
  id: string;
  name: string;
  navigationItems: readonly HubModuleNavigationItem[];
  order: number;
  realtimeEnabled: boolean;
  requiredPermissions: readonly HubModulePermission[];
  routes: readonly HubModuleRoute[];
  status: HubModuleStatus;
};
