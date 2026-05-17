import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import {
  UNKNOWN_OPERATION_VALUE,
  type EngineeringOperationRecord,
  type EngineeringOperationsResponse,
} from "./engineering-operations-parser";

const defaultSourcePath = "docs/codex/engineering-operations.md";
const saoPauloOffset = "-03:00";

type StructuredRecordRow = {
  affected_files: string | null;
  change_category: string;
  commit_sha: string | null;
  content_hash: string;
  created_at: string;
  deployment: string | null;
  healthchecks: string | null;
  how: string | null;
  id: string;
  line_start: number;
  local_date_time: string | null;
  local_occurred_at: string | null;
  logic: string | null;
  macro_summary: string | null;
  metadata: Record<string, unknown>;
  module: string;
  next_squad: string | null;
  protocol: string;
  raw_content: string;
  reason: string | null;
  record_type: string;
  risks: string | null;
  screen: string;
  source_index: number;
  source_key: string;
  source_path: string;
  squad: string;
  status: string;
  subject: string;
  updated_at: string;
  validation: string | null;
};

type StructuredRecordInsert = Omit<
  StructuredRecordRow,
  "created_at" | "id" | "updated_at"
>;

type StructuredReleaseInsert = {
  commit_sha: string | null;
  deployment: string | null;
  environment: string;
  healthchecks: string | null;
  metadata: Record<string, unknown>;
  operation_record_id: string;
  protocol: string;
  released_at: string | null;
  status: string;
  summary: string | null;
};

type StructuredHealthcheckInsert = {
  checked_at: string | null;
  metadata: Record<string, unknown>;
  operation_record_id: string;
  protocol: string;
  source: string;
  status: string;
  summary: string;
};

type StructuredHandoffInsert = {
  from_squad: string;
  operation_record_id: string;
  protocol: string;
  risks: string | null;
  status: string;
  to_squad: string;
};

type SyncRunRow = {
  created_at: string;
  error_message: string | null;
  executed_by_user_id: string | null;
  handoffs_upserted: number;
  healthchecks_upserted: number;
  id: string;
  metadata: Record<string, unknown>;
  records_total: number;
  records_upserted: number;
  releases_upserted: number;
  source_path: string;
  status: string;
};

type SyncRunInsert = Omit<SyncRunRow, "created_at" | "id">;

type EngineeringOperationsStoreDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      hub_engineering_operation_handoffs: {
        Insert: StructuredHandoffInsert;
        Relationships: [];
        Row: StructuredHandoffInsert & {
          created_at: string;
          id: string;
          updated_at: string;
        };
        Update: Partial<StructuredHandoffInsert>;
      };
      hub_engineering_operation_healthchecks: {
        Insert: StructuredHealthcheckInsert;
        Relationships: [];
        Row: StructuredHealthcheckInsert & {
          created_at: string;
          id: string;
          updated_at: string;
        };
        Update: Partial<StructuredHealthcheckInsert>;
      };
      hub_engineering_operation_records: {
        Insert: StructuredRecordInsert;
        Relationships: [];
        Row: StructuredRecordRow;
        Update: Partial<StructuredRecordInsert>;
      };
      hub_engineering_operation_releases: {
        Insert: StructuredReleaseInsert;
        Relationships: [];
        Row: StructuredReleaseInsert & {
          created_at: string;
          id: string;
          updated_at: string;
        };
        Update: Partial<StructuredReleaseInsert>;
      };
      hub_engineering_operation_sync_runs: {
        Insert: SyncRunInsert;
        Relationships: [];
        Row: SyncRunRow;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type EngineeringOperationsStoreClient = ReturnType<
  typeof createClient<EngineeringOperationsStoreDatabase>
>;

export type StructuredEngineeringOperation = {
  affectedFiles: string | null;
  changeCategory: string;
  commit: string | null;
  createdAt: string;
  deploy: string | null;
  healthchecks: string | null;
  id: string;
  localDateTime: string | null;
  localOccurredAt: string | null;
  module: string;
  nextSquad: string | null;
  protocol: string;
  screen: string;
  sourceIndex: number;
  sourcePath: string;
  squad: string;
  status: string;
  subject: string;
  type: string;
  updatedAt: string;
  validation: string | null;
};

export type EngineeringOperationsStructuredLoadResult =
  | {
      ok: true;
      records: StructuredEngineeringOperation[];
      status: "sincronizado";
      syncRuns: SyncRunRow[];
    }
  | {
      error: string;
      ok: false;
      records: [];
      status: "indisponivel";
      syncRuns: [];
    };

export type EngineeringOperationsStructuredSyncResult =
  | {
      handoffsUpserted: number;
      healthchecksUpserted: number;
      ok: true;
      recordsTotal: number;
      recordsUpserted: number;
      releasesUpserted: number;
      sourcePath: string;
      status: "sincronizado";
      syncRun: SyncRunRow | null;
    }
  | {
      error: string;
      ok: false;
      recordsTotal: number;
      status: "indisponivel";
    };

export async function loadStructuredEngineeringOperations(
  limit = 120,
): Promise<EngineeringOperationsStructuredLoadResult> {
  const adminClient = createEngineeringOperationsStoreClient();

  if (!adminClient) {
    return unavailableLoadResult("Supabase server-side nao configurado.");
  }

  try {
    const [{ data: records, error: recordsError }, { data: syncRuns }] =
      await Promise.all([
        adminClient
          .from("hub_engineering_operation_records")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit),
        adminClient
          .from("hub_engineering_operation_sync_runs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

    if (recordsError) {
      return unavailableLoadResult(recordsError.message);
    }

    return {
      ok: true,
      records: (records ?? []).map(mapStructuredRecordRow),
      status: "sincronizado",
      syncRuns: syncRuns ?? [],
    };
  } catch (error) {
    return unavailableLoadResult(getErrorMessage(error));
  }
}

export async function syncEngineeringOperationsToStore({
  operations,
  userId,
}: {
  operations: EngineeringOperationsResponse;
  userId: string;
}): Promise<EngineeringOperationsStructuredSyncResult> {
  const adminClient = createEngineeringOperationsStoreClient();
  const sourcePath = operations.sourcePath || defaultSourcePath;

  if (!adminClient) {
    return {
      error: "Supabase server-side nao configurado.",
      ok: false,
      recordsTotal: operations.records.length,
      status: "indisponivel",
    };
  }

  try {
    const recordRows = operations.records.map((record) =>
      mapRecordToInsert(record, sourcePath),
    );
    const { data: upsertedRecords, error: recordsError } = await adminClient
      .from("hub_engineering_operation_records")
      .upsert(recordRows, { onConflict: "source_key" })
      .select("id,source_key");

    if (recordsError) {
      throw new Error(recordsError.message);
    }

    const recordIdBySourceKey = new Map(
      (upsertedRecords ?? []).map((record) => [record.source_key, record.id]),
    );
    const releases = buildReleaseRows(operations.records, sourcePath, recordIdBySourceKey);
    const healthchecks = buildHealthcheckRows(
      operations.records,
      sourcePath,
      recordIdBySourceKey,
    );
    const handoffs = buildHandoffRows(operations.records, sourcePath, recordIdBySourceKey);

    await upsertReleaseRows(adminClient, releases);
    await upsertHealthcheckRows(adminClient, healthchecks);
    await upsertHandoffRows(adminClient, handoffs);

    const syncRun = await insertSyncRun(adminClient, {
      error_message: null,
      executed_by_user_id: userId,
      handoffs_upserted: handoffs.length,
      healthchecks_upserted: healthchecks.length,
      metadata: {
        generatedAt: operations.generatedAt,
        source: "engineering-operations-markdown",
      },
      records_total: operations.records.length,
      records_upserted: upsertedRecords?.length ?? 0,
      releases_upserted: releases.length,
      source_path: sourcePath,
      status: "sincronizado",
    });

    return {
      handoffsUpserted: handoffs.length,
      healthchecksUpserted: healthchecks.length,
      ok: true,
      recordsTotal: operations.records.length,
      recordsUpserted: upsertedRecords?.length ?? 0,
      releasesUpserted: releases.length,
      sourcePath,
      status: "sincronizado",
      syncRun,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);

    await insertSyncRun(adminClient, {
      error_message: errorMessage,
      executed_by_user_id: userId,
      handoffs_upserted: 0,
      healthchecks_upserted: 0,
      metadata: {
        generatedAt: operations.generatedAt,
        source: "engineering-operations-markdown",
      },
      records_total: operations.records.length,
      records_upserted: 0,
      releases_upserted: 0,
      source_path: sourcePath,
      status: "erro",
    }).catch(() => null);

    return {
      error: errorMessage,
      ok: false,
      recordsTotal: operations.records.length,
      status: "indisponivel",
    };
  }
}

function createEngineeringOperationsStoreClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient<EngineeringOperationsStoreDatabase>(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

function mapRecordToInsert(
  record: EngineeringOperationRecord,
  sourcePath: string,
): StructuredRecordInsert {
  return {
    affected_files: nullableText(record.affectedFiles),
    change_category: requiredText(record.changeCategory),
    commit_sha: nullableText(record.commit),
    content_hash: hashText(record.rawContent),
    deployment: nullableText(record.deploy),
    healthchecks: nullableText(record.healthchecks),
    how: nullableText(record.how),
    line_start: Math.max(record.lineStart, 0),
    local_date_time: nullableText(record.localDateTime),
    local_occurred_at: parseLocalDateTime(record.localDateTime),
    logic: nullableText(record.logic),
    macro_summary: nullableText(record.macroSummary),
    metadata: {
      id: record.id,
      isCritical: record.isCritical,
      isModuleImprovement: record.isModuleImprovement,
      isRelease: record.isRelease,
      isSupportInvestigation: record.isSupportInvestigation,
      routine: nullableText(record.routine),
      shortSummary: nullableText(record.shortSummary),
    },
    module: requiredText(record.module),
    next_squad: nullableText(record.nextSquad),
    protocol: requiredText(record.protocol),
    raw_content: requiredText(record.rawContent),
    reason: nullableText(record.reason),
    record_type: requiredText(record.type),
    risks: nullableText(record.risks),
    screen: requiredText(record.screen),
    source_index: Math.max(record.sourceIndex, 0),
    source_key: buildSourceKey(sourcePath, record),
    source_path: sourcePath,
    squad: requiredText(record.squad),
    status: requiredText(record.status),
    subject: requiredText(record.subject),
    validation: nullableText(record.validation),
  };
}

function buildReleaseRows(
  records: EngineeringOperationRecord[],
  sourcePath: string,
  recordIdBySourceKey: Map<string, string>,
): StructuredReleaseInsert[] {
  return records.flatMap((record) => {
    if (!record.isRelease && !nullableText(record.deploy) && !nullableText(record.commit)) {
      return [];
    }

    const operationRecordId = recordIdBySourceKey.get(buildSourceKey(sourcePath, record));

    if (!operationRecordId) {
      return [];
    }

    return [
      {
        commit_sha: nullableText(record.commit),
        deployment: nullableText(record.deploy),
        environment: inferEnvironment(record),
        healthchecks: nullableText(record.healthchecks),
        metadata: {
          source: "engineering-operations-markdown",
        },
        operation_record_id: operationRecordId,
        protocol: requiredText(record.protocol),
        released_at: parseLocalDateTime(record.localDateTime),
        status: requiredText(record.status),
        summary: nullableText(record.macroSummary) ?? nullableText(record.shortSummary),
      },
    ];
  });
}

function buildHealthcheckRows(
  records: EngineeringOperationRecord[],
  sourcePath: string,
  recordIdBySourceKey: Map<string, string>,
): StructuredHealthcheckInsert[] {
  return records.flatMap((record) => {
    const summary = nullableText(record.healthchecks) ?? nullableText(record.validation);

    if (!summary) {
      return [];
    }

    const operationRecordId = recordIdBySourceKey.get(buildSourceKey(sourcePath, record));

    if (!operationRecordId) {
      return [];
    }

    return [
      {
        checked_at: parseLocalDateTime(record.localDateTime),
        metadata: {
          source: "engineering-operations-markdown",
        },
        operation_record_id: operationRecordId,
        protocol: requiredText(record.protocol),
        source: "engineering-operations",
        status: inferHealthcheckStatus(summary),
        summary,
      },
    ];
  });
}

function buildHandoffRows(
  records: EngineeringOperationRecord[],
  sourcePath: string,
  recordIdBySourceKey: Map<string, string>,
): StructuredHandoffInsert[] {
  return records.flatMap((record) => {
    const nextSquad = nullableText(record.nextSquad);

    if (!nextSquad) {
      return [];
    }

    const operationRecordId = recordIdBySourceKey.get(buildSourceKey(sourcePath, record));

    if (!operationRecordId) {
      return [];
    }

    return [
      {
        from_squad: requiredText(record.squad),
        operation_record_id: operationRecordId,
        protocol: requiredText(record.protocol),
        risks: nullableText(record.risks),
        status: requiredText(record.status),
        to_squad: nextSquad,
      },
    ];
  });
}

async function upsertReleaseRows(
  adminClient: EngineeringOperationsStoreClient,
  rows: StructuredReleaseInsert[],
) {
  if (rows.length === 0) {
    return;
  }

  const { error } = await adminClient
    .from("hub_engineering_operation_releases")
    .upsert(rows, { onConflict: "operation_record_id" });

  if (error) {
    throw new Error(error.message);
  }
}

async function upsertHealthcheckRows(
  adminClient: EngineeringOperationsStoreClient,
  rows: StructuredHealthcheckInsert[],
) {
  if (rows.length === 0) {
    return;
  }

  const { error } = await adminClient
    .from("hub_engineering_operation_healthchecks")
    .upsert(rows, { onConflict: "operation_record_id" });

  if (error) {
    throw new Error(error.message);
  }
}

async function upsertHandoffRows(
  adminClient: EngineeringOperationsStoreClient,
  rows: StructuredHandoffInsert[],
) {
  if (rows.length === 0) {
    return;
  }

  const { error } = await adminClient
    .from("hub_engineering_operation_handoffs")
    .upsert(rows, { onConflict: "operation_record_id" });

  if (error) {
    throw new Error(error.message);
  }
}

async function insertSyncRun(
  adminClient: EngineeringOperationsStoreClient,
  row: SyncRunInsert,
) {
  const { data, error } = await adminClient
    .from("hub_engineering_operation_sync_runs")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

function mapStructuredRecordRow(
  row: StructuredRecordRow,
): StructuredEngineeringOperation {
  return {
    affectedFiles: row.affected_files,
    changeCategory: row.change_category,
    commit: row.commit_sha,
    createdAt: row.created_at,
    deploy: row.deployment,
    healthchecks: row.healthchecks,
    id: row.id,
    localDateTime: row.local_date_time,
    localOccurredAt: row.local_occurred_at,
    module: row.module,
    nextSquad: row.next_squad,
    protocol: row.protocol,
    screen: row.screen,
    sourceIndex: row.source_index,
    sourcePath: row.source_path,
    squad: row.squad,
    status: row.status,
    subject: row.subject,
    type: row.record_type,
    updatedAt: row.updated_at,
    validation: row.validation,
  };
}

function buildSourceKey(sourcePath: string, record: EngineeringOperationRecord) {
  return hashText(
    [
      sourcePath,
      String(record.sourceIndex),
      String(record.lineStart),
      requiredText(record.protocol),
    ].join(":"),
  );
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function nullableText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed === UNKNOWN_OPERATION_VALUE) {
    return null;
  }

  return trimmed;
}

function requiredText(value: string | null | undefined) {
  return nullableText(value) ?? UNKNOWN_OPERATION_VALUE;
}

function parseLocalDateTime(value: string | null | undefined) {
  const trimmed = nullableText(value);

  if (!trimmed) {
    return null;
  }

  const normalized = trimmed
    .replace(
      /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+([+-]\d{2}:?\d{2})$/,
      "$1T$2$3",
    )
    .replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)$/, `$1T$2${saoPauloOffset}`);

  const parsed = new Date(normalized);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);

  if (dateOnly) {
    const date = new Date(`${dateOnly[1]}T00:00:00${saoPauloOffset}`);

    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function inferEnvironment(record: EngineeringOperationRecord) {
  const text = [
    record.deploy,
    record.rawContent,
    record.status,
    record.subject,
  ]
    .join("\n")
    .toLowerCase();

  if (text.includes("producao") || text.includes("produção") || text.includes("c2x.app.br")) {
    return "producao";
  }

  if (text.includes("homolog")) {
    return "homologacao";
  }

  if (text.includes("local")) {
    return "local";
  }

  return UNKNOWN_OPERATION_VALUE;
}

function inferHealthcheckStatus(summary: string) {
  const text = summary.toLowerCase();

  if (text.includes("falhou") || text.includes("erro") || text.includes("bloqueado")) {
    return "falhou";
  }

  if (text.includes("401 esperado") || text.includes("passou") || text.includes("retornou 200")) {
    return "ok";
  }

  return "registrado";
}

function unavailableLoadResult(
  error: string,
): EngineeringOperationsStructuredLoadResult {
  return {
    error,
    ok: false,
    records: [],
    status: "indisponivel",
    syncRuns: [],
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido.";
}
