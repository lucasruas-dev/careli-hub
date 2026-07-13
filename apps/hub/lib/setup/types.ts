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
  jobTitle?: string;
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

export type SetupHermesChannel = {
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

export type SetupHermesChannelMember = {
  channelId: string;
  userId: string;
};

export type SetupAtlasDepartment = {
  id: string;
  name: string;
  rowId?: string;
};

export type SetupAtlasRole = {
  baseValue?: number | null;
  id: string;
  name: string;
  rowId?: string;
};

export type SetupAtlasOccurrenceProfile = {
  id: string;
  name: string;
  rowId?: string;
};

export type SetupAtlasOccurrenceType = {
  id: string;
  name: string;
  profileId?: string | null;
  profileRowId?: string | null;
  rowId?: string;
};

export type SetupAtlasConfig = {
  departments: SetupAtlasDepartment[];
  occurrenceProfiles: SetupAtlasOccurrenceProfile[];
  occurrenceTypes: SetupAtlasOccurrenceType[];
  roles: SetupAtlasRole[];
};

export type SetupData = {
  atlas: SetupAtlasConfig;
  channelMembers: SetupHermesChannelMember[];
  channels: SetupHermesChannel[];
  departmentModules: SetupDepartmentModule[];
  departments: SetupDepartment[];
  modules: SetupModule[];
  permissions: SetupPermission[];
  sectors: SetupSector[];
  users: SetupUser[];
};

export type SetupRecordStatus = SetupDepartment["status"];

export type CreateAtlasDepartmentInput = {
  name: string;
};

export type CreateAtlasRoleInput = {
  baseValue?: number | null;
  name: string;
};

export type CreateAtlasOccurrenceProfileInput = {
  name: string;
};

export type CreateAtlasOccurrenceTypeInput = {
  name: string;
  profileLegacyId?: string | null;
  profileRowId?: string | null;
};

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

export type CreateHermesChannelInput = {
  departmentId?: string;
  description?: string;
  id: string;
  name: string;
  participantUserIds?: string[];
  sectorId?: string;
  status: SetupRecordStatus;
  type: SetupHermesChannel["type"];
};

export type UpdateHermesChannelInput = {
  departmentId?: string;
  id: string;
  name: string;
  participantUserIds?: string[];
  sectorId?: string;
  status: SetupRecordStatus;
  type?: SetupHermesChannel["type"];
};

export type CreateOperationalUserInput = {
  departmentId: string;
  email: string;
  fullName: string;
  jobTitle?: string;
  password: string;
  profile: SetupOperationalProfileRole;
  sectorId: string;
  status: "active" | "disabled";
};

export type LinkUserAssignmentInput = {
  avatarUrl?: string;
  departmentId: string;
  email: string;
  fullName: string;
  jobTitle?: string;
  profile: SetupOperationalProfileRole;
  sectorId: string;
  status: "active" | "disabled";
  userId: string;
};
