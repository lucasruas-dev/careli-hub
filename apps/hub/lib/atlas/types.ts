export type AtlasBlockerCode =
  | "atlas_bonus_rules_unmapped"
  | "atlas_env_missing"
  | "atlas_hub_identity_unmapped"
  | "atlas_legacy_write_blocked";

export type AtlasBlocker = {
  code: AtlasBlockerCode;
  label: string;
  status: "BLOQUEADO" | "MAPEANDO" | "VALIDANDO";
};

export type AtlasDepartment = {
  id: string;
  name: string;
};

export type AtlasRole = {
  baseValue?: number | null;
  id: string;
  name: string;
};

export type AtlasCollaborator = {
  departmentId?: string | null;
  id: string;
  name: string;
  roleId?: string | null;
};

export type AtlasOccurrenceProfile = {
  id: string;
  name: string;
};

export type AtlasOccurrenceType = {
  id: string;
  name: string;
  profileId?: string | null;
};

export type AtlasOccurrence = {
  code?: number | string | null;
  collaboratorId: string;
  createdAt?: string | null;
  date: string;
  evidenceName?: string | null;
  evidenceType?: string | null;
  evidenceUrl?: string | null;
  hasEvidence: boolean;
  id: string;
  observation?: string | null;
  typeId: string;
};

export type AtlasLegacyUserProfile = {
  active?: boolean | null;
  legacyRole?: string | null;
  name?: string | null;
  userId: string;
};

export type AtlasSnapshot = {
  blockers: AtlasBlocker[];
  collaborators: AtlasCollaborator[];
  counts: {
    collaborators: number;
    departments: number;
    occurrenceProfiles: number;
    occurrences: number;
    occurrenceTypes: number;
    roles: number;
    userProfiles: number;
  };
  departments: AtlasDepartment[];
  generatedAt: string;
  limits: {
    occurrencesLoaded: number;
    occurrencesLimit: number;
  };
  occurrenceProfiles: AtlasOccurrenceProfile[];
  occurrenceTypes: AtlasOccurrenceType[];
  occurrences: AtlasOccurrence[];
  roles: AtlasRole[];
  source: {
    gitRepository: "lucasruas-dev/careli-performance";
    mode: "read-only";
    schema: "public";
    supabaseProjectRef?: string;
    vercelProject: "careli-performance";
  };
  userProfiles: AtlasLegacyUserProfile[];
};
