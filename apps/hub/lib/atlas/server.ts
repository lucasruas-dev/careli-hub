import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import { getPermissionsForRole, type HubPermission, type HubUserRole } from "@repo/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  getAtlasSupabaseConfig,
  maskAtlasProjectRef,
} from "./config";
import type {
  AtlasCollaborator,
  AtlasDepartment,
  AtlasFpeEntry,
  AtlasFpeEntryKind,
  AtlasFpeSnapshot,
  AtlasLegacyUserProfile,
  AtlasOccurrence,
  AtlasOccurrenceEvidence,
  AtlasOccurrenceJustificationStatus,
  AtlasOccurrenceOperationalStatus,
  AtlasOccurrenceProfile,
  AtlasOccurrenceType,
  AtlasRole,
  AtlasSnapshot,
} from "./types";

type HubAccessUserRow = {
  id: string;
  role: HubUserRole;
  status: string;
};

type HubAccessDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: HubAccessUserRow;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type AtlasSetorRow = {
  id: string;
  nome: string;
};

type AtlasCargoRow = {
  id: string;
  nome: string;
  valor_base?: number | null;
};

type AtlasCollaboratorRow = {
  cargo_id?: string | null;
  id: string;
  nome: string;
  setor_id?: string | null;
};

type AtlasOccurrenceProfileRow = {
  id: string;
  nome: string;
};

type AtlasOccurrenceTypeRow = {
  id: string;
  nome: string;
  perfil_id?: string | null;
};

type AtlasOccurrenceRow = {
  codigo?: number | string | null;
  colaborador_id: string;
  created_at?: string | null;
  data_ocorrencia: string;
  evidencia_nome?: string | null;
  evidencia_tipo?: string | null;
  evidencia_url?: string | null;
  id: string;
  observacao?: string | null;
  tipo_ocorrencia_id: string;
};

type AtlasLegacyUserProfileRow = {
  ativo?: boolean | null;
  nome?: string | null;
  perfil?: string | null;
  user_id: string;
};

type HubAtlasDepartmentRow = {
  legacy_id: string;
  name: string;
};

type HubAtlasRoleRow = {
  base_value?: number | null;
  legacy_id: string;
  name: string;
};

type HubAtlasCollaboratorRow = {
  id: string;
  department_legacy_id?: string | null;
  legacy_id: string;
  name: string;
  role_legacy_id?: string | null;
  status?: string | null;
};

type HubAtlasOccurrenceProfileRow = {
  legacy_id: string;
  name: string;
};

type HubAtlasOccurrenceTypeRow = {
  legacy_id: string;
  name: string;
  profile_legacy_id?: string | null;
};

type HubAtlasOccurrenceRow = {
  collaborator_legacy_id: string;
  created_by_user_id?: string | null;
  evidence_name?: string | null;
  evidence_type?: string | null;
  evidence_url?: string | null;
  justification_review_note?: string | null;
  justification_reviewed_at?: string | null;
  justification_reviewed_by_user_id?: string | null;
  justification_status?: string | null;
  justification_submitted_at?: string | null;
  justification_submitted_by_user_id?: string | null;
  justification_text?: string | null;
  legacy_code?: number | string | null;
  legacy_id: string;
  observation?: string | null;
  occurrence_date: string;
  occurrence_type_legacy_id: string;
  operational_status?: string | null;
  source_created_at?: string | null;
};

type HubAtlasOccurrenceEvidenceRow = {
  created_at?: string | null;
  evidence_name?: string | null;
  evidence_type?: string | null;
  evidence_url: string;
  id: string;
  occurrence_legacy_id: string;
  position?: number | null;
};

type HubAtlasLegacyUserProfileRow = {
  active?: boolean | null;
  display_name?: string | null;
  legacy_role?: string | null;
  legacy_user_id: string;
};

type HubAtlasFpeEntryRow = {
  amount: number | string;
  collaborator_legacy_id: string;
  created_at?: string | null;
  created_by_user_id?: string | null;
  cycle_year: number;
  department_legacy_id: string;
  description?: string | null;
  entry_date: string;
  id: string;
  kind: string;
  occurrence_legacy_id?: string | null;
  occurrence_type_legacy_id?: string | null;
};

type HubAtlasUserRow = {
  display_name?: string | null;
  id: string;
};

type AtlasDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      cargos: {
        Insert: never;
        Relationships: [];
        Row: AtlasCargoRow;
        Update: never;
      };
      colaboradores: {
        Insert: never;
        Relationships: [];
        Row: AtlasCollaboratorRow;
        Update: never;
      };
      ocorrencias: {
        Insert: never;
        Relationships: [];
        Row: AtlasOccurrenceRow;
        Update: never;
      };
      perfis_ocorrencia: {
        Insert: never;
        Relationships: [];
        Row: AtlasOccurrenceProfileRow;
        Update: never;
      };
      setores: {
        Insert: never;
        Relationships: [];
        Row: AtlasSetorRow;
        Update: never;
      };
      tipos_ocorrencia: {
        Insert: never;
        Relationships: [];
        Row: AtlasOccurrenceTypeRow;
        Update: never;
      };
      usuarios_perfis: {
        Insert: never;
        Relationships: [];
        Row: AtlasLegacyUserProfileRow;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type HubAtlasDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      atlas_collaborators: {
        Insert: never;
        Relationships: [];
        Row: HubAtlasCollaboratorRow;
        Update: never;
      };
      atlas_fpe_entries: {
        Insert: never;
        Relationships: [];
        Row: HubAtlasFpeEntryRow;
        Update: never;
      };
      atlas_departments: {
        Insert: never;
        Relationships: [];
        Row: HubAtlasDepartmentRow;
        Update: never;
      };
      atlas_legacy_user_profiles: {
        Insert: never;
        Relationships: [];
        Row: HubAtlasLegacyUserProfileRow;
        Update: never;
      };
      atlas_occurrence_profiles: {
        Insert: never;
        Relationships: [];
        Row: HubAtlasOccurrenceProfileRow;
        Update: never;
      };
      atlas_occurrence_types: {
        Insert: never;
        Relationships: [];
        Row: HubAtlasOccurrenceTypeRow;
        Update: never;
      };
      atlas_occurrence_evidences: {
        Insert: never;
        Relationships: [];
        Row: HubAtlasOccurrenceEvidenceRow;
        Update: never;
      };
      atlas_occurrences: {
        Insert: never;
        Relationships: [];
        Row: HubAtlasOccurrenceRow;
        Update: never;
      };
      atlas_roles: {
        Insert: never;
        Relationships: [];
        Row: HubAtlasRoleRow;
        Update: never;
      };
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: HubAtlasUserRow;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type QueryResult<Row> = {
  count?: number | null;
  data: Row[] | null;
  error: { message?: string } | null;
};

type AuthorizedAtlasContext =
  | {
      ok: false;
      response: NextResponse;
    }
  | {
      ok: true;
      user: HubAccessUserRow;
    };

const ATLAS_OCCURRENCES_LIMIT = 250;
const ATLAS_FPE_ENTRIES_LIMIT = 500;
const ATLAS_FPE_BASE_AMOUNT = 10_000;
const ATLAS_FPE_GLOBAL_BASE_AMOUNT = 3_000;
const ATLAS_FPE_DEPARTMENT_BASE_AMOUNT = 7_000;
const ATLAS_FPE_GLOBAL_SHARE_RATE = 0.3;
const ATLAS_FPE_DEPARTMENT_SHARE_RATE = 0.7;

type AtlasSnapshotResult =
  | { data: AtlasSnapshot; ok: true }
  | { code: string; error: string; ok: false; status: number };

export async function createAuthorizedAtlasContext(
  request: NextRequest,
): Promise<AuthorizedAtlasContext> {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Configure a chave server-side do Hub para carregar o Atlas." },
        { status: 503 },
      ),
    };
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao do Hub ausente." },
        { status: 401 },
      ),
    };
  }

  const adminClient = createClient<HubAccessDatabase>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: authData, error: authError } = await adminClient.auth.getUser(
    accessToken,
  );

  if (authError || !authData.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao do Hub invalida." },
        { status: 401 },
      ),
    };
  }

  const { data: user, error: userError } = await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<HubAccessUserRow>();

  if (userError || !user || user.status !== "active") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuario sem acesso ao Hub." },
        { status: 403 },
      ),
    };
  }

  if (!hasPermission(user.role, "atlas:view")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuario sem permissao para acessar o Atlas." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    user,
  };
}

export async function loadAtlasSnapshot(): Promise<AtlasSnapshotResult> {
  const hubConfig = getServerSupabaseConfig();
  const hasHubServerConfig = Boolean(hubConfig.url && hubConfig.serviceRoleKey);
  const hubSnapshot = await loadHubAtlasSnapshot(
    hubConfig.url,
    hubConfig.serviceRoleKey,
  );

  if (hubSnapshot.ok) {
    return hubSnapshot;
  }

  if (hasHubServerConfig && hubSnapshot.code !== "atlas_hub_env_missing") {
    return hubSnapshot;
  }

  const atlasConfig = getAtlasSupabaseConfig();

  if (!atlasConfig.url || !atlasConfig.anonKey) {
    return {
      code: "atlas_env_missing",
      error:
        "Configure ATLAS_SUPABASE_URL e ATLAS_SUPABASE_ANON_KEY para leitura controlada.",
      ok: false,
      status: 503,
    };
  }

  const atlasClient = createClient<AtlasDatabase>(
    atlasConfig.url,
    atlasConfig.anonKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
  const [
    departmentsResult,
    rolesResult,
    collaboratorsResult,
    occurrenceProfilesResult,
    occurrenceTypesResult,
    occurrencesResult,
    userProfilesResult,
    occurrenceCountResult,
  ] = await Promise.all([
    atlasClient.from("setores").select("id,nome").order("nome"),
    atlasClient.from("cargos").select("id,nome,valor_base").order("nome"),
    atlasClient
      .from("colaboradores")
      .select("id,nome,setor_id,cargo_id")
      .order("nome"),
    atlasClient.from("perfis_ocorrencia").select("id,nome").order("nome"),
    atlasClient.from("tipos_ocorrencia").select("id,nome,perfil_id").order("nome"),
    atlasClient
      .from("ocorrencias")
      .select(
        "id,codigo,colaborador_id,tipo_ocorrencia_id,data_ocorrencia,observacao,evidencia_url,evidencia_nome,evidencia_tipo,created_at",
      )
      .order("data_ocorrencia", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(ATLAS_OCCURRENCES_LIMIT),
    atlasClient.from("usuarios_perfis").select("user_id,nome,perfil,ativo"),
    atlasClient.from("ocorrencias").select("id", {
      count: "exact",
      head: true,
    }),
  ]);

  const failedTables = [
    getFailedTable("setores", departmentsResult),
    getFailedTable("cargos", rolesResult),
    getFailedTable("colaboradores", collaboratorsResult),
    getFailedTable("perfis_ocorrencia", occurrenceProfilesResult),
    getFailedTable("tipos_ocorrencia", occurrenceTypesResult),
    getFailedTable("ocorrencias", occurrencesResult),
    getFailedTable("usuarios_perfis", userProfilesResult),
    getFailedTable("ocorrencias_count", occurrenceCountResult),
  ].filter(Boolean);

  if (failedTables.length > 0) {
    return {
      code: "atlas_snapshot_failed",
      error: `Nao foi possivel carregar o snapshot Atlas: ${failedTables.join(", ")}.`,
      ok: false,
      status: 502,
    };
  }

  const departments = mapDepartments(departmentsResult.data ?? []);
  const roles = mapRoles(rolesResult.data ?? []);
  const collaborators = mapCollaborators(collaboratorsResult.data ?? []);
  const occurrenceProfiles = mapOccurrenceProfiles(
    occurrenceProfilesResult.data ?? [],
  );
  const occurrenceTypes = mapOccurrenceTypes(occurrenceTypesResult.data ?? []);
  const occurrences = mapOccurrences(occurrencesResult.data ?? []);
  const userProfiles = mapUserProfiles(userProfilesResult.data ?? []);

  return {
    data: {
      blockers: [
        {
          code: "atlas_bonus_rules_unmapped",
          label: "Regra de bonus preservada e pendente de validacao humana",
          status: "BLOQUEADO",
        },
        {
          code: "atlas_legacy_write_blocked",
          label: "Bonus, uploads e Auth legado bloqueados na V1 Hub",
          status: "BLOQUEADO",
        },
        {
          code: "atlas_hub_identity_unmapped",
          label: "Vinculo Hub Users x colaboradores Atlas ainda nao reconciliado",
          status: "MAPEANDO",
        },
      ],
      collaborators,
      counts: {
        collaborators: collaborators.length,
        departments: departments.length,
        fpeEntries: 0,
        occurrenceProfiles: occurrenceProfiles.length,
        occurrences: occurrenceCountResult.count ?? occurrences.length,
        occurrenceTypes: occurrenceTypes.length,
        roles: roles.length,
        userProfiles: userProfiles.length,
      },
      departments,
      fpe: createAtlasFpeSnapshot([], "missing"),
      generatedAt: new Date().toISOString(),
      limits: {
        occurrencesLoaded: occurrences.length,
        occurrencesLimit: ATLAS_OCCURRENCES_LIMIT,
      },
      occurrenceProfiles,
      occurrenceTypes,
      occurrences,
      roles,
      source: {
        gitRepository: "lucasruas-dev/careli-performance",
        mode: "read-only",
        schema: "public",
        supabaseProjectRef: maskAtlasProjectRef(atlasConfig.projectRef),
        vercelProject: "careli-performance",
      },
      userProfiles,
    },
    ok: true,
  };
}

async function loadHubAtlasSnapshot(
  supabaseUrl?: string,
  serviceRoleKey?: string,
): Promise<AtlasSnapshotResult> {
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      code: "atlas_hub_env_missing",
      error: "Hub Supabase server config ausente.",
      ok: false,
      status: 503,
    };
  }

  const hubClient = createClient<HubAtlasDatabase>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const [
    departmentsResult,
    rolesResult,
    collaboratorsResult,
    occurrenceProfilesResult,
    occurrenceTypesResult,
    occurrencesResult,
    userProfilesResult,
    occurrenceCountResult,
  ] = await Promise.all([
    hubClient.from("atlas_departments").select("legacy_id,name").order("name"),
    hubClient
      .from("atlas_roles")
      .select("legacy_id,name,base_value")
      .order("name"),
    hubClient
      .from("atlas_collaborators")
      .select("id,legacy_id,name,department_legacy_id,role_legacy_id,status")
      .order("name"),
    hubClient
      .from("atlas_occurrence_profiles")
      .select("legacy_id,name")
      .order("name"),
    hubClient
      .from("atlas_occurrence_types")
      .select("legacy_id,name,profile_legacy_id")
      .order("name"),
    hubClient
      .from("atlas_occurrences")
      .select(
        "legacy_id,legacy_code,collaborator_legacy_id,occurrence_type_legacy_id,occurrence_date,observation,evidence_url,evidence_name,evidence_type,source_created_at,created_by_user_id,operational_status,justification_status,justification_text,justification_submitted_by_user_id,justification_submitted_at,justification_reviewed_by_user_id,justification_reviewed_at,justification_review_note",
      )
      .order("occurrence_date", { ascending: false })
      .order("source_created_at", { ascending: false })
      .limit(ATLAS_OCCURRENCES_LIMIT),
    hubClient
      .from("atlas_legacy_user_profiles")
      .select("legacy_user_id,display_name,legacy_role,active"),
    hubClient.from("atlas_occurrences").select("legacy_id", {
      count: "exact",
      head: true,
    }),
  ]);

  const failedCoreTables = [
    getFailedTable("atlas_departments", departmentsResult),
    getFailedTable("atlas_roles", rolesResult),
    getFailedTable("atlas_collaborators", collaboratorsResult),
    getFailedTable("atlas_occurrence_profiles", occurrenceProfilesResult),
    getFailedTable("atlas_occurrence_types", occurrenceTypesResult),
    getFailedTable("atlas_occurrences", occurrencesResult),
  ].filter(Boolean);

  if (failedCoreTables.length > 0) {
    return {
      code: "atlas_hub_snapshot_unavailable",
      error: `Snapshot Atlas Hub indisponivel: ${failedCoreTables.join(", ")}.`,
      ok: false,
      status: 503,
    };
  }

  const departments = mapHubDepartments(departmentsResult.data ?? []);
  const roles = mapHubRoles(rolesResult.data ?? []);
  const collaborators = mapHubCollaborators(collaboratorsResult.data ?? []);
  const occurrenceProfiles = mapHubOccurrenceProfiles(
    occurrenceProfilesResult.data ?? [],
  );
  const occurrenceTypes = mapHubOccurrenceTypes(
    occurrenceTypesResult.data ?? [],
  );
  const occurrenceEvidenceRows = await loadHubOccurrenceEvidenceRows(
    hubClient,
    occurrencesResult.data ?? [],
  );
  const hubUsersById = await loadHubUsersById(
    hubClient,
    collectAtlasOccurrenceAuditUserIds(occurrencesResult.data ?? []),
  );
  const occurrences = mapHubOccurrences(
    occurrencesResult.data ?? [],
    occurrenceEvidenceRows,
    hubUsersById,
  );
  const fpeResult = await loadHubFpeEntries(hubClient);
  const userProfiles = userProfilesResult.error
    ? []
    : mapHubUserProfiles(userProfilesResult.data ?? []);
  const occurrenceCount = occurrenceCountResult.error
    ? occurrences.length
    : occurrenceCountResult.count ?? occurrences.length;

  return {
    data: {
      blockers: [
        {
          code: "atlas_bonus_rules_unmapped",
          label: "Regra de bonus preservada e pendente de validacao humana",
          status: "BLOQUEADO",
        },
        {
          code: "atlas_legacy_write_blocked",
          label: "Bonus, Auth legado e edicoes sensiveis seguem bloqueados",
          status: "BLOQUEADO",
        },
        {
          code: "atlas_hub_identity_unmapped",
          label: "Vinculo Hub Users x colaboradores Atlas ainda nao reconciliado",
          status: "MAPEANDO",
        },
      ],
      collaborators,
      counts: {
        collaborators: collaborators.length,
        departments: departments.length,
        fpeEntries: fpeResult.rows.length,
        occurrenceProfiles: occurrenceProfiles.length,
        occurrences: occurrenceCount,
        occurrenceTypes: occurrenceTypes.length,
        roles: roles.length,
        userProfiles: userProfiles.length,
      },
      departments,
      fpe: createAtlasFpeSnapshot(
        mapHubFpeEntries(fpeResult.rows, occurrences),
        fpeResult.available ? "available" : "missing",
      ),
      generatedAt: new Date().toISOString(),
      limits: {
        occurrencesLoaded: occurrences.length,
        occurrencesLimit: ATLAS_OCCURRENCES_LIMIT,
      },
      occurrenceProfiles,
      occurrenceTypes,
      occurrences,
      roles,
      source: {
        gitRepository: "lucasruas-dev/careli-performance",
        mode: "controlled-write",
        schema: "public",
        supabaseProjectRef: "Hub Atlas",
        vercelProject: "careli-performance",
      },
      userProfiles,
    },
    ok: true,
  };
}

async function loadHubOccurrenceEvidenceRows(
  hubClient: SupabaseClient<HubAtlasDatabase>,
  occurrences: HubAtlasOccurrenceRow[],
): Promise<HubAtlasOccurrenceEvidenceRow[]> {
  const occurrenceIds = occurrences.map((occurrence) => occurrence.legacy_id);

  if (occurrenceIds.length === 0) {
    return [];
  }

  const { data, error } = await hubClient
    .from("atlas_occurrence_evidences")
    .select(
      "id,occurrence_legacy_id,evidence_url,evidence_name,evidence_type,position,created_at",
    )
    .in("occurrence_legacy_id", occurrenceIds)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return [];
  }

  return data ?? [];
}

async function loadHubUsersById(
  hubClient: SupabaseClient<HubAtlasDatabase>,
  userIds: string[],
): Promise<Map<string, HubAtlasUserRow>> {
  const uniqueUserIds = [...new Set(userIds.filter(Boolean))];

  if (uniqueUserIds.length === 0) {
    return new Map();
  }

  const { data, error } = await hubClient
    .from("hub_users")
    .select("id,display_name")
    .in("id", uniqueUserIds);

  if (error) {
    return new Map();
  }

  return new Map((data ?? []).map((user) => [user.id, user]));
}

function collectAtlasOccurrenceAuditUserIds(rows: HubAtlasOccurrenceRow[]) {
  return rows.flatMap((row) => [
    row.justification_reviewed_by_user_id ?? "",
    row.justification_submitted_by_user_id ?? "",
  ]);
}

async function loadHubFpeEntries(
  hubClient: SupabaseClient<HubAtlasDatabase>,
): Promise<{ available: boolean; rows: HubAtlasFpeEntryRow[] }> {
  const currentCycleYear = getCurrentFpeCycleYear();
  const { data, error } = await hubClient
    .from("atlas_fpe_entries")
    .select(
      "id,cycle_year,entry_date,kind,amount,collaborator_legacy_id,department_legacy_id,occurrence_legacy_id,occurrence_type_legacy_id,description,created_by_user_id,created_at",
    )
    .eq("cycle_year", currentCycleYear)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(ATLAS_FPE_ENTRIES_LIMIT);

  if (error) {
    return {
      available: false,
      rows: [],
    };
  }

  return {
    available: true,
    rows: data ?? [],
  };
}

function hasPermission(role: HubUserRole, permission: HubPermission) {
  return getPermissionsForRole(role).includes(permission);
}

function getFailedTable<Row>(
  tableName: string,
  result: QueryResult<Row>,
): string | null {
  return result.error ? tableName : null;
}

function mapDepartments(rows: AtlasSetorRow[]): AtlasDepartment[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.nome,
  }));
}

function mapHubDepartments(rows: HubAtlasDepartmentRow[]): AtlasDepartment[] {
  return rows.map((row) => ({
    id: row.legacy_id,
    name: row.name,
  }));
}

function mapHubRoles(rows: HubAtlasRoleRow[]): AtlasRole[] {
  return rows.map((row) => ({
    baseValue: row.base_value ?? null,
    id: row.legacy_id,
    name: row.name,
  }));
}

function mapHubCollaborators(
  rows: HubAtlasCollaboratorRow[],
): AtlasCollaborator[] {
  return rows.map((row) => ({
    departmentId: row.department_legacy_id ?? null,
    id: row.legacy_id,
    name: row.name,
    roleId: row.role_legacy_id ?? null,
    status: row.status ?? "active",
  }));
}

function mapHubOccurrenceProfiles(
  rows: HubAtlasOccurrenceProfileRow[],
): AtlasOccurrenceProfile[] {
  return rows.map((row) => ({
    id: row.legacy_id,
    name: row.name,
  }));
}

function mapHubOccurrenceTypes(
  rows: HubAtlasOccurrenceTypeRow[],
): AtlasOccurrenceType[] {
  return rows.map((row) => ({
    id: row.legacy_id,
    name: row.name,
    profileId: row.profile_legacy_id ?? null,
  }));
}

function groupEvidenceRowsByOccurrence(rows: HubAtlasOccurrenceEvidenceRow[]) {
  const rowsByOccurrence = new Map<string, HubAtlasOccurrenceEvidenceRow[]>();

  for (const row of rows) {
    const currentRows = rowsByOccurrence.get(row.occurrence_legacy_id) ?? [];

    currentRows.push(row);
    rowsByOccurrence.set(row.occurrence_legacy_id, currentRows);
  }

  return rowsByOccurrence;
}

function getOccurrenceEvidences(
  rows: HubAtlasOccurrenceEvidenceRow[],
  fallback: {
    createdAt?: string | null;
    id: string;
    name?: string | null;
    type?: string | null;
    url?: string | null;
  },
): AtlasOccurrenceEvidence[] {
  const evidences = rows
    .filter((row) => Boolean(row.evidence_url?.trim()))
    .map((row, index) => ({
      createdAt: row.created_at ?? null,
      id: row.id,
      name: row.evidence_name ?? null,
      position: row.position ?? index + 1,
      type: row.evidence_type ?? null,
      url: row.evidence_url,
    }));

  if (evidences.length > 0 || !fallback.url) {
    return evidences;
  }

  return [
    {
      createdAt: fallback.createdAt ?? null,
      id: fallback.id,
      name: fallback.name ?? null,
      position: 1,
      type: fallback.type ?? null,
      url: fallback.url,
    },
  ];
}

function mapHubOccurrences(
  rows: HubAtlasOccurrenceRow[],
  evidenceRows: HubAtlasOccurrenceEvidenceRow[],
  hubUsersById: Map<string, HubAtlasUserRow>,
): AtlasOccurrence[] {
  const evidenceRowsByOccurrence = groupEvidenceRowsByOccurrence(evidenceRows);

  return rows.map((row) => {
    const evidences = getOccurrenceEvidences(
      evidenceRowsByOccurrence.get(row.legacy_id) ?? [],
      {
        createdAt: row.source_created_at ?? null,
        id: `${row.legacy_id}:legacy-evidence`,
        name: row.evidence_name ?? null,
        type: row.evidence_type ?? null,
        url: row.evidence_url ?? null,
      },
    );
    const primaryEvidence = evidences[0];

    return {
      code: row.legacy_code ?? null,
      collaboratorId: row.collaborator_legacy_id,
      createdByUserId: row.created_by_user_id ?? null,
      createdAt: row.source_created_at ?? null,
      date: row.occurrence_date,
      evidenceName: primaryEvidence?.name ?? row.evidence_name ?? null,
      evidenceType: primaryEvidence?.type ?? row.evidence_type ?? null,
      evidenceUrl: primaryEvidence?.url ?? row.evidence_url ?? null,
      evidences,
      hasEvidence: evidences.length > 0,
      id: row.legacy_id,
      justification: {
        reviewedAt: row.justification_reviewed_at ?? null,
        reviewedByUserId: row.justification_reviewed_by_user_id ?? null,
        reviewedByUserName: getHubUserDisplayName(
          hubUsersById,
          row.justification_reviewed_by_user_id,
        ),
        reviewNote: row.justification_review_note ?? null,
        status: normalizeJustificationStatus(row.justification_status),
        submittedAt: row.justification_submitted_at ?? null,
        submittedByUserId: row.justification_submitted_by_user_id ?? null,
        submittedByUserName: getHubUserDisplayName(
          hubUsersById,
          row.justification_submitted_by_user_id,
        ),
        text: row.justification_text ?? null,
      },
      observation: row.observation ?? null,
      operationalStatus: normalizeOperationalStatus(row.operational_status),
      typeId: row.occurrence_type_legacy_id,
    };
  });
}

function getHubUserDisplayName(
  hubUsersById: Map<string, HubAtlasUserRow>,
  userId?: string | null,
) {
  if (!userId) {
    return null;
  }

  return hubUsersById.get(userId)?.display_name?.trim() || null;
}

function mapHubFpeEntries(
  rows: HubAtlasFpeEntryRow[],
  occurrences: AtlasOccurrence[],
): AtlasFpeEntry[] {
  const occurrencesById = new Map(
    occurrences.map((occurrence) => [occurrence.id, occurrence]),
  );

  return rows.map((row) => {
    const occurrence = row.occurrence_legacy_id
      ? occurrencesById.get(row.occurrence_legacy_id)
      : undefined;

    return {
      amount: normalizeCurrencyNumber(row.amount),
      collaboratorId: row.collaborator_legacy_id,
      createdAt: row.created_at ?? null,
      createdByUserId: row.created_by_user_id ?? null,
      cycleYear: row.cycle_year,
      departmentId: row.department_legacy_id,
      description: row.description ?? null,
      entryDate: row.entry_date,
      id: row.id,
      kind: normalizeFpeEntryKind(row.kind),
      occurrenceCode: occurrence?.code ?? null,
      occurrenceId: row.occurrence_legacy_id ?? null,
      occurrenceTypeId:
        row.occurrence_type_legacy_id ?? occurrence?.typeId ?? null,
    };
  });
}

function createAtlasFpeSnapshot(
  entries: AtlasFpeEntry[],
  schemaStatus: AtlasFpeSnapshot["config"]["schemaStatus"],
): AtlasFpeSnapshot {
  return {
    config: {
      baseAmount: ATLAS_FPE_BASE_AMOUNT,
      cycleYear: getCurrentFpeCycleYear(),
      departmentBaseAmount: ATLAS_FPE_DEPARTMENT_BASE_AMOUNT,
      departmentShareRate: ATLAS_FPE_DEPARTMENT_SHARE_RATE,
      globalBaseAmount: ATLAS_FPE_GLOBAL_BASE_AMOUNT,
      globalShareRate: ATLAS_FPE_GLOBAL_SHARE_RATE,
      schemaStatus,
    },
    entries,
  };
}

function mapHubUserProfiles(
  rows: HubAtlasLegacyUserProfileRow[],
): AtlasLegacyUserProfile[] {
  return rows.map((row) => ({
    active: row.active ?? null,
    legacyRole: row.legacy_role ?? null,
    name: row.display_name ?? null,
    userId: row.legacy_user_id,
  }));
}

function mapRoles(rows: AtlasCargoRow[]): AtlasRole[] {
  return rows.map((row) => ({
    baseValue: row.valor_base ?? null,
    id: row.id,
    name: row.nome,
  }));
}

function mapCollaborators(rows: AtlasCollaboratorRow[]): AtlasCollaborator[] {
  return rows.map((row) => ({
    departmentId: row.setor_id ?? null,
    id: row.id,
    name: row.nome,
    roleId: row.cargo_id ?? null,
    status: "active",
  }));
}

function mapOccurrenceProfiles(
  rows: AtlasOccurrenceProfileRow[],
): AtlasOccurrenceProfile[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.nome,
  }));
}

function mapOccurrenceTypes(
  rows: AtlasOccurrenceTypeRow[],
): AtlasOccurrenceType[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.nome,
    profileId: row.perfil_id ?? null,
  }));
}

function mapOccurrences(rows: AtlasOccurrenceRow[]): AtlasOccurrence[] {
  return rows.map((row) => {
    const evidences = row.evidencia_url
      ? [
          {
            createdAt: row.created_at ?? null,
            id: `${row.id}:legacy-evidence`,
            name: row.evidencia_nome ?? null,
            position: 1,
            type: row.evidencia_tipo ?? null,
            url: row.evidencia_url,
          },
        ]
      : [];

    return {
      code: row.codigo ?? null,
      collaboratorId: row.colaborador_id,
      createdAt: row.created_at ?? null,
      date: row.data_ocorrencia,
      evidenceName: row.evidencia_nome ?? null,
      evidenceType: row.evidencia_tipo ?? null,
      evidenceUrl: row.evidencia_url ?? null,
      evidences,
      hasEvidence: evidences.length > 0,
      id: row.id,
      justification: {
        status: "none",
      },
      observation: row.observacao ?? null,
      operationalStatus: "procedente",
      typeId: row.tipo_ocorrencia_id,
    };
  });
}

function normalizeOperationalStatus(
  status?: string | null,
): AtlasOccurrenceOperationalStatus {
  return status === "improcedente" ? "improcedente" : "procedente";
}

function normalizeJustificationStatus(
  status?: string | null,
): AtlasOccurrenceJustificationStatus {
  if (
    status === "accepted" ||
    status === "pending" ||
    status === "rejected"
  ) {
    return status;
  }

  return "none";
}

function normalizeFpeEntryKind(kind?: string | null): AtlasFpeEntryKind {
  return kind === "bonus" ? "bonus" : "loss";
}

function normalizeCurrencyNumber(value: number | string | null | undefined) {
  const parsedValue = Number(value ?? 0);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function getCurrentFpeCycleYear() {
  return new Date().getFullYear();
}

function mapUserProfiles(rows: AtlasLegacyUserProfileRow[]): AtlasLegacyUserProfile[] {
  return rows.map((row) => ({
    active: row.ativo ?? null,
    legacyRole: row.perfil ?? null,
    name: row.nome ?? null,
    userId: row.user_id,
  }));
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
