export type SetupOperationalProfileRole =
  | "op1"
  | "op2"
  | "op3"
  | "ldr"
  | "cdr"
  | "adm";

export type SetupDepartment = {
  createdAt?: string;
  description?: string;
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived" | "disabled";
};

export type SetupSector = {
  departmentId: string;
  departmentName?: string;
  description?: string;
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived" | "disabled";
};

export type SetupUser = {
  avatarUrl?: string;
  departmentId?: string;
  departmentName?: string;
  displayName: string;
  email: string;
  id: string;
  operationalProfile: SetupOperationalProfileRole;
  role: "admin" | "leader" | "operator" | "viewer";
  sectorId?: string;
  sectorName?: string;
  status: "active" | "archived" | "disabled";
};

export type SetupModule = {
  basePath: string;
  id: string;
  name: string;
  order: number;
  status: "active" | "disabled" | "locked" | "planned";
};

export type SetupDepartmentModule = {
  departmentId: string;
  moduleId: string;
  status: "enabled" | "disabled" | "planned";
};

export type SetupPermission = {
  description?: string;
  id: string;
  key: string;
  moduleId?: string;
  scope: "hub" | "module" | "workspace" | "system";
};

export type SetupPulseXChannel = {
  departmentId?: string;
  departmentName?: string;
  description?: string;
  id: string;
  kind: "department" | "sector" | "direct" | "system";
  name: string;
  sectorId?: string;
  sectorName?: string;
  status: "active" | "archived" | "disabled";
  type: "department_channel" | "private_group" | "sector_channel";
};

export type SetupData = {
  channels: SetupPulseXChannel[];
  departmentModules: SetupDepartmentModule[];
  departments: SetupDepartment[];
  modules: SetupModule[];
  permissions: SetupPermission[];
  sectors: SetupSector[];
  users: SetupUser[];
};

export type SetupRecordStatus = SetupDepartment["status"];

export type CreateDepartmentInput = {
  description?: string;
  name: string;
  slug: string;
  status: SetupRecordStatus;
};

export type UpdateDepartmentInput = {
  description?: string;
  id: string;
  name: string;
  status: SetupRecordStatus;
};

export type CreateSectorInput = {
  departmentId: string;
  description?: string;
  name: string;
  slug: string;
  status: SetupRecordStatus;
};

export type UpdateSectorInput = {
  departmentId: string;
  description?: string;
  id: string;
  name: string;
  status: SetupRecordStatus;
};

export type CreatePulseXChannelInput = {
  departmentId?: string;
  description?: string;
  id: string;
  name: string;
  sectorId?: string;
  status: SetupRecordStatus;
  type: SetupPulseXChannel["type"];
};

export type UpdatePulseXChannelInput = {
  departmentId?: string;
  id: string;
  name: string;
  sectorId?: string;
  status: SetupRecordStatus;
  type?: SetupPulseXChannel["type"];
};

export type CreateOperationalUserInput = {
  departmentId: string;
  email: string;
  fullName: string;
  password: string;
  profile: SetupOperationalProfileRole;
  sectorId: string;
  status: "active" | "disabled";
};

export type LinkUserAssignmentInput = {
  departmentId: string;
  profile: SetupOperationalProfileRole;
  sectorId: string;
  status: "active" | "disabled";
  userId: string;
};
