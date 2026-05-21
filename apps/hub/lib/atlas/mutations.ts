import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import type { HubUserRole } from "@repo/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  AtlasFpeEntryKind,
  AtlasOccurrenceJustificationStatus,
  AtlasOccurrenceOperationalStatus,
} from "./types";

type JsonRecord = Record<string, unknown>;

type AtlasMutationUser = {
  id: string;
  role: HubUserRole;
  status: string;
};

type AtlasCollaboratorRefRow = {
  department_id?: string | null;
  department_legacy_id?: string | null;
  id: string;
  legacy_id: string;
  name: string;
};

type AtlasOccurrenceTypeRefRow = {
  id: string;
  legacy_id: string;
  name: string;
};

type AtlasOccurrenceCodeRow = {
  legacy_code?: number | string | null;
};

type AtlasOccurrenceMutationRow = {
  id?: string;
  justification_status?: AtlasOccurrenceJustificationStatus | null;
  legacy_code?: number | string | null;
  legacy_id: string;
};

type AtlasOccurrenceEvidencePositionRow = {
  occurrence_legacy_id?: string | null;
  position?: number | null;
};

type AtlasOccurrenceInsertRow = {
  collaborator_id?: string | null;
  collaborator_legacy_id: string;
  created_by_user_id?: string | null;
  evidence_name?: string | null;
  evidence_type?: string | null;
  evidence_url?: string | null;
  justification_status?: AtlasOccurrenceJustificationStatus;
  legacy_code?: number | null;
  legacy_id: string;
  metadata?: JsonRecord;
  observation?: string | null;
  occurrence_date: string;
  occurrence_type_id?: string | null;
  occurrence_type_legacy_id: string;
  operational_status?: AtlasOccurrenceOperationalStatus;
  source_created_at?: string | null;
};

type AtlasOccurrenceEvidenceInsertRow = {
  created_by_user_id?: string | null;
  evidence_name?: string | null;
  evidence_type?: string | null;
  evidence_url: string;
  metadata?: JsonRecord;
  occurrence_id: string;
  occurrence_legacy_id: string;
  position: number;
};

type AtlasOccurrenceUpdateRow = {
  justification_review_note?: string | null;
  justification_reviewed_at?: string | null;
  justification_reviewed_by_user_id?: string | null;
  justification_status?: AtlasOccurrenceJustificationStatus;
  justification_submitted_at?: string | null;
  justification_submitted_by_user_id?: string | null;
  justification_text?: string | null;
  operational_status?: AtlasOccurrenceOperationalStatus;
};

type AtlasFpeEntryInsertRow = {
  amount: number;
  collaborator_id?: string | null;
  collaborator_legacy_id: string;
  created_by_user_id?: string | null;
  cycle_year: number;
  department_id?: string | null;
  department_legacy_id: string;
  description?: string | null;
  entry_date: string;
  kind: AtlasFpeEntryKind;
  metadata?: JsonRecord;
  occurrence_id?: string | null;
  occurrence_legacy_id?: string | null;
  occurrence_type_id?: string | null;
  occurrence_type_legacy_id?: string | null;
};

type AtlasFpeEntryMutationRow = {
  id: string;
};

type AtlasMutationDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      atlas_collaborators: {
        Insert: never;
        Relationships: [];
        Row: AtlasCollaboratorRefRow;
        Update: never;
      };
      atlas_fpe_entries: {
        Insert: AtlasFpeEntryInsertRow;
        Relationships: [];
        Row: AtlasFpeEntryMutationRow;
        Update: never;
      };
      atlas_occurrence_types: {
        Insert: never;
        Relationships: [];
        Row: AtlasOccurrenceTypeRefRow;
        Update: never;
      };
      atlas_occurrence_evidences: {
        Insert: AtlasOccurrenceEvidenceInsertRow;
        Relationships: [];
        Row: AtlasOccurrenceEvidencePositionRow;
        Update: never;
      };
      atlas_occurrences: {
        Insert: AtlasOccurrenceInsertRow;
        Relationships: [];
        Row: AtlasOccurrenceMutationRow;
        Update: AtlasOccurrenceUpdateRow;
      };
    };
    Views: Record<string, never>;
  };
};

type AtlasMutationClient = SupabaseClient<AtlasMutationDatabase>;

export type AtlasEvidenceInput = {
  name?: string | null;
  type?: string | null;
  url: string;
};

export type AddAtlasOccurrenceEvidencesInput = {
  evidences: unknown;
  occurrenceId: string;
};

export type CreateAtlasOccurrenceInput = {
  collaboratorId: unknown;
  evidences?: unknown;
  occurrenceDate: unknown;
  observation?: unknown;
  typeId: unknown;
};

export type CreateAtlasFpeEntryInput = {
  amount: unknown;
  collaboratorId: unknown;
  description?: unknown;
  entryDate: unknown;
  evidences?: unknown;
  kind: unknown;
  typeId: unknown;
};

export type SubmitAtlasJustificationInput = {
  justification: unknown;
  occurrenceId: string;
};

export type ReviewAtlasJustificationInput = {
  action: "accept" | "reject";
  occurrenceId: string;
  reviewNote?: unknown;
};

export class AtlasMutationError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AtlasMutationError";
    this.status = status;
  }
}

export async function createAtlasOccurrence(
  user: AtlasMutationUser,
  input: CreateAtlasOccurrenceInput,
) {
  assertActiveAtlasUser(user);

  const collaboratorId = normalizeId(input.collaboratorId, "colaborador");
  const typeId = normalizeId(input.typeId, "ocorrencia");
  const occurrenceDate = normalizeDate(input.occurrenceDate);
  const observation = normalizeOptionalText(input.observation, 1500);
  const evidences = normalizeEvidenceInputs(input.evidences, {
    required: false,
  });
  const client = createAtlasMutationClient();

  const [collaboratorResult, typeResult, codeResult] = await Promise.all([
    client
      .from("atlas_collaborators")
      .select("id,legacy_id,name")
      .eq("legacy_id", collaboratorId)
      .maybeSingle<AtlasCollaboratorRefRow>(),
    client
      .from("atlas_occurrence_types")
      .select("id,legacy_id,name")
      .eq("legacy_id", typeId)
      .maybeSingle<AtlasOccurrenceTypeRefRow>(),
    client
      .from("atlas_occurrences")
      .select("legacy_code")
      .not("legacy_code", "is", null)
      .order("legacy_code", { ascending: false })
      .limit(1),
  ]);

  if (collaboratorResult.error) {
    throw new AtlasMutationError(
      500,
      "atlas_collaborator_lookup_failed",
      "Nao foi possivel validar o colaborador da ocorrencia.",
    );
  }

  if (!collaboratorResult.data) {
    throw new AtlasMutationError(
      404,
      "atlas_collaborator_not_found",
      "Colaborador Atlas nao encontrado.",
    );
  }

  if (typeResult.error) {
    throw new AtlasMutationError(
      500,
      "atlas_occurrence_type_lookup_failed",
      "Nao foi possivel validar o tipo da ocorrencia.",
    );
  }

  if (!typeResult.data) {
    throw new AtlasMutationError(
      404,
      "atlas_occurrence_type_not_found",
      "Tipo de ocorrencia Atlas nao encontrado.",
    );
  }

  if (codeResult.error) {
    throw new AtlasMutationError(
      500,
      "atlas_occurrence_code_failed",
      "Nao foi possivel calcular o codigo da ocorrencia.",
    );
  }

  const legacyCode = getNextLegacyCode(codeResult.data ?? []);
  const primaryEvidence = evidences[0];
  const payload: AtlasOccurrenceInsertRow = {
    collaborator_id: collaboratorResult.data.id,
    collaborator_legacy_id: collaboratorResult.data.legacy_id,
    created_by_user_id: user.id,
    evidence_name: primaryEvidence?.name ?? null,
    evidence_type: primaryEvidence?.type ?? null,
    evidence_url: primaryEvidence?.url ?? null,
    justification_status: "none",
    legacy_code: legacyCode,
    legacy_id: globalThis.crypto.randomUUID(),
    metadata: {
      created_by_role: user.role,
      created_via: "atlas_occurrence_form",
      origin: "hub_atlas",
    },
    observation,
    occurrence_date: occurrenceDate,
    occurrence_type_id: typeResult.data.id,
    occurrence_type_legacy_id: typeResult.data.legacy_id,
    operational_status: "procedente",
    source_created_at: new Date().toISOString(),
  };
  const result = await client
    .from("atlas_occurrences")
    .insert(payload)
    .select("id,legacy_id,legacy_code")
    .single<AtlasOccurrenceMutationRow>();

  if (result.error || !result.data) {
    throw new AtlasMutationError(
      500,
      "atlas_occurrence_create_failed",
      "Nao foi possivel abrir a ocorrencia Atlas.",
    );
  }

  if (evidences.length > 0 && result.data.id) {
    await insertOccurrenceEvidences(client, {
      createdByUserId: user.id,
      evidences,
      occurrenceId: result.data.id,
      occurrenceLegacyId: result.data.legacy_id,
      startPosition: 1,
    });
  }

  return {
    code: result.data.legacy_code ?? legacyCode,
    evidenceCount: evidences.length,
    id: result.data.legacy_id,
  };
}

export async function createAtlasFpeEntry(
  user: AtlasMutationUser,
  input: CreateAtlasFpeEntryInput,
) {
  assertAtlasFpeManager(user);

  const collaboratorId = normalizeId(input.collaboratorId, "colaborador");
  const typeId = normalizeId(input.typeId, "ocorrencia");
  const entryDate = normalizeDate(input.entryDate);
  const kind = normalizeFpeEntryKind(input.kind);
  const amount = normalizeMoneyAmount(input.amount);
  const description = normalizeOptionalText(input.description, 1500);
  const evidences = normalizeEvidenceInputs(input.evidences, {
    required: false,
  });
  const client = createAtlasMutationClient();

  await assertAtlasFpeSchemaAvailable(client);

  const [collaboratorResult, typeResult, codeResult] = await Promise.all([
    client
      .from("atlas_collaborators")
      .select("id,legacy_id,name,department_id,department_legacy_id")
      .eq("legacy_id", collaboratorId)
      .maybeSingle<AtlasCollaboratorRefRow>(),
    client
      .from("atlas_occurrence_types")
      .select("id,legacy_id,name")
      .eq("legacy_id", typeId)
      .maybeSingle<AtlasOccurrenceTypeRefRow>(),
    client
      .from("atlas_occurrences")
      .select("legacy_code")
      .not("legacy_code", "is", null)
      .order("legacy_code", { ascending: false })
      .limit(1),
  ]);

  if (collaboratorResult.error) {
    throw new AtlasMutationError(
      500,
      "atlas_collaborator_lookup_failed",
      "Nao foi possivel validar o colaborador do lancamento FPE.",
    );
  }

  if (!collaboratorResult.data) {
    throw new AtlasMutationError(
      404,
      "atlas_collaborator_not_found",
      "Colaborador Atlas nao encontrado.",
    );
  }

  if (!collaboratorResult.data.department_legacy_id) {
    throw new AtlasMutationError(
      400,
      "atlas_fpe_department_missing",
      "Colaborador sem departamento Atlas para aplicar a regra FPE.",
    );
  }

  if (typeResult.error) {
    throw new AtlasMutationError(
      500,
      "atlas_occurrence_type_lookup_failed",
      "Nao foi possivel validar o tipo de ocorrencia do FPE.",
    );
  }

  if (!typeResult.data) {
    throw new AtlasMutationError(
      404,
      "atlas_occurrence_type_not_found",
      "Tipo de ocorrencia Atlas nao encontrado.",
    );
  }

  if (codeResult.error) {
    throw new AtlasMutationError(
      500,
      "atlas_occurrence_code_failed",
      "Nao foi possivel calcular o codigo da ocorrencia FPE.",
    );
  }

  const legacyCode = getNextLegacyCode(codeResult.data ?? []);
  const primaryEvidence = evidences[0];
  const occurrencePayload: AtlasOccurrenceInsertRow = {
    collaborator_id: collaboratorResult.data.id,
    collaborator_legacy_id: collaboratorResult.data.legacy_id,
    created_by_user_id: user.id,
    evidence_name: primaryEvidence?.name ?? null,
    evidence_type: primaryEvidence?.type ?? null,
    evidence_url: primaryEvidence?.url ?? null,
    justification_status: "none",
    legacy_code: legacyCode,
    legacy_id: globalThis.crypto.randomUUID(),
    metadata: {
      created_by_role: user.role,
      created_via: "atlas_fpe_form",
      fpe_amount: amount,
      fpe_kind: kind,
      origin: "hub_atlas_fpe",
    },
    observation: description,
    occurrence_date: entryDate,
    occurrence_type_id: typeResult.data.id,
    occurrence_type_legacy_id: typeResult.data.legacy_id,
    operational_status: "procedente",
    source_created_at: new Date().toISOString(),
  };
  const occurrenceResult = await client
    .from("atlas_occurrences")
    .insert(occurrencePayload)
    .select("id,legacy_id,legacy_code")
    .single<AtlasOccurrenceMutationRow>();

  if (occurrenceResult.error || !occurrenceResult.data?.id) {
    throw new AtlasMutationError(
      500,
      "atlas_fpe_occurrence_create_failed",
      "Nao foi possivel abrir a ocorrencia vinculada ao FPE.",
    );
  }

  if (evidences.length > 0) {
    await insertOccurrenceEvidences(client, {
      createdByUserId: user.id,
      evidences,
      occurrenceId: occurrenceResult.data.id,
      occurrenceLegacyId: occurrenceResult.data.legacy_id,
      startPosition: 1,
    });
  }

  const fpeResult = await client
    .from("atlas_fpe_entries")
    .insert({
      amount,
      collaborator_id: collaboratorResult.data.id,
      collaborator_legacy_id: collaboratorResult.data.legacy_id,
      created_by_user_id: user.id,
      cycle_year: getCycleYearFromDate(entryDate),
      department_id: collaboratorResult.data.department_id ?? null,
      department_legacy_id: collaboratorResult.data.department_legacy_id,
      description,
      entry_date: entryDate,
      kind,
      metadata: {
        created_by_role: user.role,
        created_via: "atlas_fpe_form",
        origin: "hub_atlas_fpe",
      },
      occurrence_id: occurrenceResult.data.id,
      occurrence_legacy_id: occurrenceResult.data.legacy_id,
      occurrence_type_id: typeResult.data.id,
      occurrence_type_legacy_id: typeResult.data.legacy_id,
    })
    .select("id")
    .single<AtlasFpeEntryMutationRow>();

  if (fpeResult.error || !fpeResult.data) {
    throw new AtlasMutationError(
      503,
      "atlas_fpe_create_failed",
      "Nao foi possivel registrar o lancamento FPE. Estrutura FPE pode estar pendente de migration.",
    );
  }

  return {
    id: fpeResult.data.id,
    occurrenceCode: occurrenceResult.data.legacy_code ?? legacyCode,
    occurrenceId: occurrenceResult.data.legacy_id,
  };
}

export async function addAtlasOccurrenceEvidences(
  user: AtlasMutationUser,
  input: AddAtlasOccurrenceEvidencesInput,
) {
  assertActiveAtlasUser(user);

  const occurrenceId = normalizeId(input.occurrenceId, "ocorrencia");
  const evidences = normalizeEvidenceInputs(input.evidences, {
    required: true,
  });
  const client = createAtlasMutationClient();
  const occurrenceResult = await client
    .from("atlas_occurrences")
    .select("id,legacy_id")
    .eq("legacy_id", occurrenceId)
    .maybeSingle<AtlasOccurrenceMutationRow>();

  if (occurrenceResult.error) {
    throw new AtlasMutationError(
      500,
      "atlas_occurrence_lookup_failed",
      "Nao foi possivel validar a ocorrencia Atlas.",
    );
  }

  if (!occurrenceResult.data?.id) {
    throw new AtlasMutationError(
      404,
      "atlas_occurrence_not_found",
      "Ocorrencia Atlas nao encontrada.",
    );
  }

  const startPosition = await loadNextEvidencePosition(
    client,
    occurrenceResult.data.legacy_id,
  );

  await insertOccurrenceEvidences(client, {
    createdByUserId: user.id,
    evidences,
    occurrenceId: occurrenceResult.data.id,
    occurrenceLegacyId: occurrenceResult.data.legacy_id,
    startPosition,
  });

  return {
    count: evidences.length,
    id: occurrenceResult.data.legacy_id,
  };
}

export async function submitAtlasOccurrenceJustification(
  user: AtlasMutationUser,
  input: SubmitAtlasJustificationInput,
) {
  assertActiveAtlasUser(user);

  const occurrenceId = normalizeId(input.occurrenceId, "ocorrencia");
  const justification = normalizeRequiredText(
    input.justification,
    "Informe a justificativa da ocorrencia.",
    2400,
  );
  const client = createAtlasMutationClient();
  const result = await client
    .from("atlas_occurrences")
    .update({
      justification_review_note: null,
      justification_reviewed_at: null,
      justification_reviewed_by_user_id: null,
      justification_status: "pending",
      justification_submitted_at: new Date().toISOString(),
      justification_submitted_by_user_id: user.id,
      justification_text: justification,
      operational_status: "procedente",
    })
    .eq("legacy_id", occurrenceId)
    .select("legacy_id")
    .maybeSingle<AtlasOccurrenceMutationRow>();

  if (result.error) {
    throw new AtlasMutationError(
      500,
      "atlas_justification_submit_failed",
      "Nao foi possivel registrar a justificativa.",
    );
  }

  if (!result.data) {
    throw new AtlasMutationError(
      404,
      "atlas_occurrence_not_found",
      "Ocorrencia Atlas nao encontrada.",
    );
  }

  return { id: result.data.legacy_id };
}

export async function reviewAtlasOccurrenceJustification(
  user: AtlasMutationUser,
  input: ReviewAtlasJustificationInput,
) {
  assertAtlasJustificationReviewer(user);

  const occurrenceId = normalizeId(input.occurrenceId, "ocorrencia");
  const reviewNote = normalizeOptionalText(input.reviewNote, 1200);
  const isAccepted = input.action === "accept";
  const client = createAtlasMutationClient();
  const result = await client
    .from("atlas_occurrences")
    .update({
      justification_review_note: reviewNote,
      justification_reviewed_at: new Date().toISOString(),
      justification_reviewed_by_user_id: user.id,
      justification_status: isAccepted ? "accepted" : "rejected",
      operational_status: isAccepted ? "improcedente" : "procedente",
    })
    .eq("legacy_id", occurrenceId)
    .eq("justification_status", "pending")
    .select("legacy_id")
    .maybeSingle<AtlasOccurrenceMutationRow>();

  if (result.error) {
    throw new AtlasMutationError(
      500,
      "atlas_justification_review_failed",
      "Nao foi possivel revisar a justificativa.",
    );
  }

  if (!result.data) {
    throw new AtlasMutationError(
      404,
      "atlas_pending_justification_not_found",
      "Justificativa pendente nao encontrada para esta ocorrencia.",
    );
  }

  return {
    id: result.data.legacy_id,
    operationalStatus: isAccepted ? "improcedente" : "procedente",
  };
}

export function canReviewAtlasJustifications(role?: HubUserRole | null) {
  return role === "admin" || role === "leader";
}

export function canManageAtlasFpe(role?: HubUserRole | null) {
  return role === "admin" || role === "leader";
}

async function insertOccurrenceEvidences(
  client: AtlasMutationClient,
  input: {
    createdByUserId: string;
    evidences: AtlasEvidenceInput[];
    occurrenceId: string;
    occurrenceLegacyId: string;
    startPosition: number;
  },
) {
  const rows = input.evidences.map((evidence, index) => ({
    created_by_user_id: input.createdByUserId,
    evidence_name: evidence.name ?? null,
    evidence_type: evidence.type ?? null,
    evidence_url: evidence.url,
    metadata: {
      created_via: "atlas_evidence_form",
      origin: "hub_atlas",
    },
    occurrence_id: input.occurrenceId,
    occurrence_legacy_id: input.occurrenceLegacyId,
    position: input.startPosition + index,
  }));
  const { error } = await client
    .from("atlas_occurrence_evidences")
    .insert(rows);

  if (error) {
    throw new AtlasMutationError(
      500,
      "atlas_evidence_create_failed",
      "Nao foi possivel registrar as evidencias da ocorrencia.",
    );
  }
}

async function assertAtlasFpeSchemaAvailable(client: AtlasMutationClient) {
  const { error } = await client
    .from("atlas_fpe_entries")
    .select("id", { count: "exact", head: true });

  if (error) {
    throw new AtlasMutationError(
      503,
      "atlas_fpe_schema_missing",
      "Estrutura FPE do Atlas pendente de migration.",
    );
  }
}

async function loadNextEvidencePosition(
  client: AtlasMutationClient,
  occurrenceLegacyId: string,
) {
  const { data, error } = await client
    .from("atlas_occurrence_evidences")
    .select("position,occurrence_legacy_id")
    .eq("occurrence_legacy_id", occurrenceLegacyId)
    .order("position", { ascending: false })
    .limit(1);

  if (error) {
    throw new AtlasMutationError(
      503,
      "atlas_evidence_schema_missing",
      "Estrutura de evidencias do Atlas pendente de migration.",
    );
  }

  const currentPosition = Number(data?.[0]?.position ?? 0);

  return Number.isFinite(currentPosition) && currentPosition > 0
    ? Math.trunc(currentPosition) + 1
    : 1;
}

function createAtlasMutationClient(): AtlasMutationClient {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new AtlasMutationError(
      503,
      "atlas_hub_env_missing",
      "Configure a chave server-side do Hub para gravar no Atlas.",
    );
  }

  return createClient<AtlasMutationDatabase>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function assertActiveAtlasUser(user: AtlasMutationUser) {
  if (user.status !== "active") {
    throw new AtlasMutationError(
      403,
      "atlas_user_inactive",
      "Usuario sem acesso operacional ao Atlas.",
    );
  }
}

function assertAtlasJustificationReviewer(user: AtlasMutationUser) {
  assertActiveAtlasUser(user);

  if (!canReviewAtlasJustifications(user.role)) {
    throw new AtlasMutationError(
      403,
      "atlas_justification_review_forbidden",
      "Somente lideres e administradores podem revisar justificativas.",
    );
  }
}

function assertAtlasFpeManager(user: AtlasMutationUser) {
  assertActiveAtlasUser(user);

  if (!canManageAtlasFpe(user.role)) {
    throw new AtlasMutationError(
      403,
      "atlas_fpe_manage_forbidden",
      "Somente lideres e administradores podem registrar lancamentos FPE.",
    );
  }
}

function getNextLegacyCode(rows: AtlasOccurrenceCodeRow[]) {
  const currentCode = Number(rows[0]?.legacy_code ?? 0);

  if (!Number.isFinite(currentCode) || currentCode < 0) {
    return 1;
  }

  return Math.trunc(currentCode) + 1;
}

function normalizeEvidenceInputs(
  value: unknown,
  options: { required: boolean },
): AtlasEvidenceInput[] {
  if (value === null || typeof value === "undefined") {
    if (options.required) {
      throw new AtlasMutationError(
        400,
        "atlas_evidence_required",
        "Informe pelo menos uma evidencia.",
      );
    }

    return [];
  }

  if (!Array.isArray(value)) {
    throw new AtlasMutationError(
      400,
      "atlas_invalid_evidences",
      "Informe uma lista valida de evidencias.",
    );
  }

  const evidences = value
    .map((rawEvidence) => normalizeEvidenceInput(rawEvidence))
    .filter((evidence): evidence is AtlasEvidenceInput => Boolean(evidence));

  if (options.required && evidences.length === 0) {
    throw new AtlasMutationError(
      400,
      "atlas_evidence_required",
      "Informe pelo menos uma evidencia.",
    );
  }

  if (evidences.length > 12) {
    throw new AtlasMutationError(
      400,
      "atlas_evidence_limit",
      "Informe no maximo 12 evidencias por envio.",
    );
  }

  return evidences;
}

function normalizeEvidenceInput(value: unknown): AtlasEvidenceInput | null {
  if (!isPlainRecord(value)) {
    throw new AtlasMutationError(
      400,
      "atlas_invalid_evidence",
      "Informe evidencia valida.",
    );
  }

  const hasAnyField = Boolean(
    String(value.url ?? "").trim() ||
      String(value.name ?? "").trim() ||
      String(value.type ?? "").trim(),
  );

  if (!hasAnyField) {
    return null;
  }

  return {
    name: normalizeOptionalText(value.name, 180),
    type: normalizeOptionalText(value.type, 80),
    url: normalizeEvidenceUrl(value.url),
  };
}

function normalizeEvidenceUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AtlasMutationError(
      400,
      "atlas_evidence_url_required",
      "Informe o link da evidencia.",
    );
  }

  const url = value.trim();

  if (url.length > 2048 || /^(data|javascript):/i.test(url)) {
    throw new AtlasMutationError(
      400,
      "atlas_invalid_evidence_url",
      "Informe um link de evidencia valido.",
    );
  }

  return url;
}

function normalizeFpeEntryKind(value: unknown): AtlasFpeEntryKind {
  if (value === "bonus" || value === "loss") {
    return value;
  }

  throw new AtlasMutationError(
    400,
    "atlas_invalid_fpe_kind",
    "Informe se o lancamento FPE e bonificacao ou prejuizo.",
  );
}

function normalizeMoneyAmount(value: unknown) {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(
            value.trim().includes(",")
              ? value.trim().replace(/\./g, "").replace(",", ".")
              : value.trim(),
          )
        : Number.NaN;

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new AtlasMutationError(
      400,
      "atlas_invalid_fpe_amount",
      "Informe um valor FPE maior que zero.",
    );
  }

  if (numericValue > 1_000_000) {
    throw new AtlasMutationError(
      400,
      "atlas_fpe_amount_too_high",
      "Valor FPE acima do limite operacional permitido.",
    );
  }

  return Math.round(numericValue * 100) / 100;
}

function getCycleYearFromDate(value: string) {
  return Number(value.slice(0, 4));
}

function normalizeId(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AtlasMutationError(
      400,
      "atlas_invalid_id",
      `Informe ${label} valido.`,
    );
  }

  return value.trim();
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AtlasMutationError(
      400,
      "atlas_invalid_date",
      "Informe uma data de ocorrencia valida.",
    );
  }

  const parsedDate = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsedDate.getTime())) {
    throw new AtlasMutationError(
      400,
      "atlas_invalid_date",
      "Informe uma data de ocorrencia valida.",
    );
  }

  return value;
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  if (typeof value !== "string") {
    throw new AtlasMutationError(
      400,
      "atlas_invalid_text",
      "Informe texto valido.",
    );
  }

  const normalizedText = value.trim();

  if (!normalizedText) {
    return null;
  }

  if (normalizedText.length > maxLength) {
    throw new AtlasMutationError(
      400,
      "atlas_text_too_long",
      `Texto excede o limite de ${maxLength} caracteres.`,
    );
  }

  return normalizedText;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeRequiredText(
  value: unknown,
  emptyMessage: string,
  maxLength: number,
) {
  const normalizedText = normalizeOptionalText(value, maxLength);

  if (!normalizedText) {
    throw new AtlasMutationError(400, "atlas_required_text", emptyMessage);
  }

  return normalizedText;
}
