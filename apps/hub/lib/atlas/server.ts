import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import { getPermissionsForRole, type HubPermission, type HubUserRole } from "@repo/shared";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import {
  getAtlasSupabaseConfig,
  maskAtlasProjectRef,
} from "./config";
import type {
  AtlasCollaborator,
  AtlasDepartment,
  AtlasLegacyUserProfile,
  AtlasOccurrence,
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
  department_legacy_id?: string | null;
  legacy_id: string;
  name: string;
  role_legacy_id?: string | null;
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
  evidence_name?: string | null;
  evidence_type?: string | null;
  evidence_url?: string | null;
  legacy_code?: number | string | null;
  legacy_id: string;
  observation?: string | null;
  occurrence_date: string;
  occurrence_type_legacy_id: string;
  source_created_at?: string | null;
};

type HubAtlasLegacyUserProfileRow = {
  active?: boolean | null;
  display_name?: string | null;
  legacy_role?: string | null;
  legacy_user_id: string;
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
  const hubSnapshot = await loadHubAtlasSnapshot(
    hubConfig.url,
    hubConfig.serviceRoleKey,
  );

  if (hubSnapshot.ok) {
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
          label: "Escritas, uploads e Auth legado bloqueados na V1 Hub",
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
        occurrenceProfiles: occurrenceProfiles.length,
        occurrences: occurrenceCountResult.count ?? occurrences.length,
        occurrenceTypes: occurrenceTypes.length,
        roles: roles.length,
        userProfiles: userProfiles.length,
      },
      departments,
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
      .select("legacy_id,name,department_legacy_id,role_legacy_id")
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
        "legacy_id,legacy_code,collaborator_legacy_id,occurrence_type_legacy_id,occurrence_date,observation,evidence_url,evidence_name,evidence_type,source_created_at",
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

  const failedTables = [
    getFailedTable("atlas_departments", departmentsResult),
    getFailedTable("atlas_roles", rolesResult),
    getFailedTable("atlas_collaborators", collaboratorsResult),
    getFailedTable("atlas_occurrence_profiles", occurrenceProfilesResult),
    getFailedTable("atlas_occurrence_types", occurrenceTypesResult),
    getFailedTable("atlas_occurrences", occurrencesResult),
    getFailedTable("atlas_legacy_user_profiles", userProfilesResult),
    getFailedTable("atlas_occurrences_count", occurrenceCountResult),
  ].filter(Boolean);

  if (failedTables.length > 0) {
    return {
      code: "atlas_hub_snapshot_unavailable",
      error: `Snapshot Atlas Hub indisponivel: ${failedTables.join(", ")}.`,
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
  const occurrences = mapHubOccurrences(occurrencesResult.data ?? []);
  const userProfiles = mapHubUserProfiles(userProfilesResult.data ?? []);

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
          label: "Escritas e bonus seguem bloqueados na V1 Hub",
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
        occurrenceProfiles: occurrenceProfiles.length,
        occurrences: occurrenceCountResult.count ?? occurrences.length,
        occurrenceTypes: occurrenceTypes.length,
        roles: roles.length,
        userProfiles: userProfiles.length,
      },
      departments,
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
        supabaseProjectRef: "Hub Atlas",
        vercelProject: "careli-performance",
      },
      userProfiles,
    },
    ok: true,
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

function mapHubOccurrences(rows: HubAtlasOccurrenceRow[]): AtlasOccurrence[] {
  return rows.map((row) => ({
    code: row.legacy_code ?? null,
    collaboratorId: row.collaborator_legacy_id,
    createdAt: row.source_created_at ?? null,
    date: row.occurrence_date,
    evidenceName: row.evidence_name ?? null,
    evidenceType: row.evidence_type ?? null,
    evidenceUrl: row.evidence_url ?? null,
    hasEvidence: Boolean(row.evidence_url),
    id: row.legacy_id,
    observation: row.observation ?? null,
    typeId: row.occurrence_type_legacy_id,
  }));
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
  return rows.map((row) => ({
    code: row.codigo ?? null,
    collaboratorId: row.colaborador_id,
    createdAt: row.created_at ?? null,
    date: row.data_ocorrencia,
    evidenceName: row.evidencia_nome ?? null,
    evidenceType: row.evidencia_tipo ?? null,
    evidenceUrl: row.evidencia_url ?? null,
    hasEvidence: Boolean(row.evidencia_url),
    id: row.id,
    observation: row.observacao ?? null,
    typeId: row.tipo_ocorrencia_id,
  }));
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
