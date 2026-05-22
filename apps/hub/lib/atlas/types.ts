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
  status?: "active" | "archived" | "inactive" | string | null;
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

export type AtlasOccurrenceOperationalStatus = "improcedente" | "procedente";

export type AtlasOccurrenceJustificationStatus =
  | "accepted"
  | "none"
  | "pending"
  | "rejected";

export type AtlasOccurrenceEvidence = {
  createdAt?: string | null;
  id: string;
  name?: string | null;
  position: number;
  type?: string | null;
  url: string;
};

export type AtlasOccurrence = {
  code?: number | string | null;
  collaboratorId: string;
  createdByUserId?: string | null;
  createdAt?: string | null;
  evidences: AtlasOccurrenceEvidence[];
  date: string;
  evidenceName?: string | null;
  evidenceType?: string | null;
  evidenceUrl?: string | null;
  hasEvidence: boolean;
  id: string;
  justification?: {
    reviewedAt?: string | null;
    reviewedByUserId?: string | null;
    reviewedByUserName?: string | null;
    reviewNote?: string | null;
    status: AtlasOccurrenceJustificationStatus;
    submittedAt?: string | null;
    submittedByUserId?: string | null;
    submittedByUserName?: string | null;
    text?: string | null;
  };
  observation?: string | null;
  operationalStatus: AtlasOccurrenceOperationalStatus;
  typeId: string;
};

export type AtlasLegacyUserProfile = {
  active?: boolean | null;
  legacyRole?: string | null;
  name?: string | null;
  userId: string;
};

export type AtlasFpeEntryKind = "bonus" | "loss";

export type AtlasFpeEntry = {
  amount: number;
  collaboratorId: string;
  createdAt?: string | null;
  createdByUserId?: string | null;
  cycleYear: number;
  departmentId: string;
  description?: string | null;
  entryDate: string;
  id: string;
  kind: AtlasFpeEntryKind;
  occurrenceCode?: number | string | null;
  occurrenceId?: string | null;
  occurrenceTypeId?: string | null;
};

export type AtlasFpeSnapshot = {
  config: {
    baseAmount: number;
    cycleYear: number;
    departmentBaseAmount: number;
    departmentShareRate: number;
    globalBaseAmount: number;
    globalShareRate: number;
    schemaStatus: "available" | "missing";
  };
  entries: AtlasFpeEntry[];
};

export type AtlasSnapshot = {
  blockers: AtlasBlocker[];
  collaborators: AtlasCollaborator[];
  counts: {
    collaborators: number;
    departments: number;
    fpeEntries: number;
    occurrenceProfiles: number;
    occurrences: number;
    occurrenceTypes: number;
    roles: number;
    userProfiles: number;
  };
  departments: AtlasDepartment[];
  fpe: AtlasFpeSnapshot;
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
    mode: "controlled-write" | "read-only";
    schema: "public";
    supabaseProjectRef?: string;
    vercelProject: "careli-performance";
  };
  userProfiles: AtlasLegacyUserProfile[];
};
