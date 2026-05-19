import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import {
  UNKNOWN_OPERATION_VALUE,
  type EngineeringOperationRecord,
  type EngineeringOperationsResponse,
} from "./engineering-operations-parser";

const defaultSourcePath = "docs/operations/engineering-operations.md";
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
  "created_at" | "id" | "protocol" | "updated_at"
> & {
  protocol?: string;
};

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
  how: string | null;
  id: string;
  isCritical: boolean;
  isModuleImprovement: boolean;
  isRelease: boolean;
  isSupportInvestigation: boolean;
  lineStart: number;
  localDateTime: string | null;
  localOccurredAt: string | null;
  logic: string | null;
  macroSummary: string | null;
  module: string;
  nextSquad: string | null;
  protocol: string;
  rawContent: string;
  reason: string | null;
  risks: string | null;
  routine: string | null;
  screen: string;
  shortSummary: string | null;
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

export type CreateStructuredEngineeringOperationInput = {
  affectedFiles?: string | null;
  changeCategory?: string | null;
  commit?: string | null;
  deploy?: string | null;
  healthchecks?: string | null;
  how?: string | null;
  logic?: string | null;
  macroSummary?: string | null;
  module?: string | null;
  needsDeploy?: boolean;
  nextSquad?: string | null;
  reason?: string | null;
  risks?: string | null;
  screen?: string | null;
  squad?: string | null;
  status?: string | null;
  subject: string;
  type?: string | null;
  validation?: string | null;
};

export type CreateStructuredEngineeringOperationResult =
  | {
      ok: true;
      record: StructuredEngineeringOperation;
      status: "registrado";
    }
  | {
      error: string;
      ok: false;
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
  userId: string | null;
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
    const reconciledRecordRows = await reconcileMarkdownProtocolCollisions(
      adminClient,
      recordRows,
    );
    const { data: upsertedRecords, error: recordsError } = await adminClient
      .from("hub_engineering_operation_records")
      .upsert(reconciledRecordRows, {
        defaultToNull: false,
        onConflict: "source_key",
      })
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

export async function createStructuredEngineeringOperation({
  input,
  userId,
}: {
  input: CreateStructuredEngineeringOperationInput;
  userId: string | null;
}): Promise<CreateStructuredEngineeringOperationResult> {
  const adminClient = createEngineeringOperationsStoreClient();

  if (!adminClient) {
    return {
      error: "Supabase server-side nao configurado.",
      ok: false,
      status: "indisponivel",
    };
  }

  try {
    const row = mapLiveInputToInsert(input, userId);
    const { data: insertedRecord, error } = await adminClient
      .from("hub_engineering_operation_records")
      .insert(row)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    if (isLiveReleaseLikeRecord(insertedRecord)) {
      await upsertReleaseRows(adminClient, [
        {
          commit_sha: insertedRecord.commit_sha,
          deployment: insertedRecord.deployment,
          environment: inferStructuredEnvironment(insertedRecord),
          healthchecks: insertedRecord.healthchecks,
          metadata: {
            source: "squadops-live-record",
          },
          operation_record_id: insertedRecord.id,
          protocol: insertedRecord.protocol,
          released_at: insertedRecord.local_occurred_at,
          status: insertedRecord.status,
          summary: insertedRecord.macro_summary ?? insertedRecord.reason,
        },
      ]);
    }

    return {
      ok: true,
      record: mapStructuredRecordRow(insertedRecord),
      status: "registrado",
    };
  } catch (error) {
    return {
      error: getErrorMessage(error),
      ok: false,
      status: "indisponivel",
    };
  }
}

function createEngineeringOperationsStoreClient() {
  const {
    serviceRoleKey,
    url: supabaseUrl,
  } = getServerSupabaseConfig();

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

async function reconcileMarkdownProtocolCollisions(
  adminClient: EngineeringOperationsStoreClient,
  rows: StructuredRecordInsert[],
) {
  const protocols = [
    ...new Set(
      rows
        .map((row) => row.protocol)
        .filter((protocol): protocol is string => Boolean(protocol)),
    ),
  ];

  if (protocols.length === 0) {
    return rows;
  }

  const { data: existingRows, error } = await adminClient
    .from("hub_engineering_operation_records")
    .select("content_hash,protocol,source_key,subject")
    .in("protocol", protocols);

  if (error) {
    throw new Error(error.message);
  }

  const { data: protocolRows, error: protocolRowsError } = await adminClient
    .from("hub_engineering_operation_records")
    .select("protocol")
    .limit(5000);

  if (protocolRowsError) {
    throw new Error(protocolRowsError.message);
  }

  const existingByProtocol = new Map(
    (existingRows ?? []).map((row) => [row.protocol, row]),
  );
  const usedProtocols = new Set(
    (protocolRows ?? [])
      .map((row) => row.protocol)
      .filter((protocol): protocol is string => Boolean(protocol)),
  );
  const seenByProtocol = new Map<string, StructuredRecordInsert>();

  const reconciledRows = rows.map((row) => {
    if (!row.protocol) {
      return {
        ...row,
        protocol: nextAvailableProtocol("AT", usedProtocols),
      };
    }

    const existing = existingByProtocol.get(row.protocol);
    const seen = seenByProtocol.get(row.protocol);

    if (!existing || existing.source_key === row.source_key) {
      if (
        seen &&
        seen.source_key !== row.source_key &&
        !isSameOperationalRecord(seen, row)
      ) {
        return {
          ...row,
          protocol: nextAvailableProtocol(protocolPrefix(row.protocol), usedProtocols),
        };
      }

      seenByProtocol.set(row.protocol, row);
      usedProtocols.add(row.protocol);
      return row;
    }

    if (isSameOperationalRecord(existing, row)) {
      const reconciledRow = {
        ...row,
        source_key: existing.source_key,
      };

      seenByProtocol.set(row.protocol, reconciledRow);
      usedProtocols.add(row.protocol);

      return reconciledRow;
    }

    return {
      ...row,
      protocol: nextAvailableProtocol(protocolPrefix(row.protocol), usedProtocols),
    };
  });

  return [...new Map(reconciledRows.map((row) => [row.source_key, row])).values()];
}

function isSameOperationalRecord(
  existing: Pick<StructuredRecordInsert, "content_hash" | "subject">,
  incoming: Pick<StructuredRecordInsert, "content_hash" | "subject">,
) {
  return (
    existing.content_hash === incoming.content_hash ||
    normalizeStoreSearchText(existing.subject) ===
      normalizeStoreSearchText(incoming.subject)
  );
}

function protocolPrefix(protocol: string) {
  const match = protocol.trim().toUpperCase().match(/^([A-Z]{2})-/);

  return match?.[1] ?? "AT";
}

function nextAvailableProtocol(prefix: string, usedProtocols: Set<string>) {
  let nextNumber = 1;

  for (const protocol of usedProtocols) {
    const match = protocol
      .trim()
      .toUpperCase()
      .match(new RegExp(`^${prefix}-(\\d+)$`));

    if (!match) {
      continue;
    }

    nextNumber = Math.max(nextNumber, Number(match[1]) + 1);
  }

  let candidate = `${prefix}-${String(nextNumber).padStart(4, "0")}`;

  while (usedProtocols.has(candidate)) {
    nextNumber += 1;
    candidate = `${prefix}-${String(nextNumber).padStart(4, "0")}`;
  }

  usedProtocols.add(candidate);

  return candidate;
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

function mapLiveInputToInsert(
  input: CreateStructuredEngineeringOperationInput,
  userId: string | null,
): StructuredRecordInsert {
  const subject = requiredText(input.subject);
  const now = new Date();
  const localDateTime = formatSaoPauloDateTime(now);
  const status =
    nullableText(input.status) ??
    (input.needsDeploy ? "AGUARDANDO RELEASEOPS" : "REGISTRADO");
  const recordType = requiredText(input.type ?? "ATIVIDADE");
  const changeCategory = requiredText(input.changeCategory ?? recordType);
  const rawContent = buildLiveRawContent({
    input,
    localDateTime,
    recordType,
    status,
    subject,
  });
  const isCritical = hasCriticalText(`${status} ${input.risks ?? ""}`);
  const isRelease = hasReleaseText(
    `${recordType} ${status} ${input.commit ?? ""} ${input.deploy ?? ""}`,
  );

  return {
    affected_files: nullableText(input.affectedFiles),
    change_category: changeCategory,
    commit_sha: nullableText(input.commit),
    content_hash: hashText(rawContent),
    deployment: nullableText(input.deploy),
    healthchecks: nullableText(input.healthchecks),
    how: nullableText(input.how),
    line_start: 0,
    local_date_time: localDateTime,
    local_occurred_at: now.toISOString(),
    logic: nullableText(input.logic),
    macro_summary: nullableText(input.macroSummary),
    metadata: {
      createdByUserId: userId,
      isCritical,
      isModuleImprovement: hasImprovementText(`${recordType} ${changeCategory}`),
      isRelease,
      isSupportInvestigation: hasSupportText(
        `${input.squad ?? ""} ${recordType} ${subject}`,
      ),
      needsDeploy: input.needsDeploy === true,
      routine: null,
      shortSummary: nullableText(input.macroSummary) ?? nullableText(input.reason),
      source: "squadops-live-record",
    },
    module: requiredText(input.module ?? "SquadOps"),
    next_squad: nullableText(input.nextSquad),
    raw_content: rawContent,
    reason: nullableText(input.reason),
    record_type: recordType,
    risks: nullableText(input.risks),
    screen: requiredText(input.screen ?? "Operations Center"),
    source_index: 0,
    source_key: `live:${hashText(
      ["squadops-live-record", now.toISOString(), userId ?? "system", randomUUID()].join(":"),
    )}`,
    source_path: "Supabase: live operation records",
    squad: requiredText(input.squad ?? "SquadOps Core"),
    status,
    subject,
    validation: nullableText(input.validation),
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

function buildLiveRawContent({
  input,
  localDateTime,
  recordType,
  status,
  subject,
}: {
  input: CreateStructuredEngineeringOperationInput;
  localDateTime: string;
  recordType: string;
  status: string;
  subject: string;
}) {
  return [
    "Registro de diario:",
    "",
    `- Assunto: ${subject}.`,
    `- Nome da squad/agente: ${requiredText(input.squad ?? "SquadOps Core")}.`,
    `- Data e hora local: ${localDateTime}.`,
    `- Tipo da alteracao: ${recordType}.`,
    `- Modulo: ${requiredText(input.module ?? "SquadOps")}.`,
    `- Tela/area: ${requiredText(input.screen ?? "Operations Center")}.`,
    `- Necessita deploy: ${input.needsDeploy ? "sim" : "nao"}.`,
    `- Motivo da mudanca: ${requiredText(input.reason)}.`,
    `- Como foi feito: ${requiredText(input.how)}.`,
    `- Logica utilizada: ${requiredText(input.logic)}.`,
    `- Validacao executada: ${requiredText(input.validation)}.`,
    `- Riscos conhecidos: ${requiredText(input.risks)}.`,
    `- Status operacional: ${status}.`,
    `- Proxima squad recomendada: ${requiredText(input.nextSquad)}.`,
  ].join("\n");
}

function formatSaoPauloDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((accumulator, part) => {
      accumulator[part.type] = part.value;
      return accumulator;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${saoPauloOffset}`;
}

function isLiveReleaseLikeRecord(row: StructuredRecordRow) {
  return hasReleaseText(
    `${row.record_type} ${row.status} ${row.commit_sha ?? ""} ${row.deployment ?? ""}`,
  );
}

function inferStructuredEnvironment(row: StructuredRecordRow) {
  const text = normalizeStoreSearchText(
    `${row.deployment ?? ""} ${row.raw_content} ${row.status} ${row.subject}`,
  );

  if (text.includes("producao") || text.includes("c2x.app.br")) {
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

function hasCriticalText(value: string) {
  const text = normalizeStoreSearchText(value);

  return (
    text.includes("bloqueado") ||
    text.includes("critico") ||
    text.includes("necessita correcao") ||
    text.includes("operacional com atencao")
  );
}

function hasImprovementText(value: string) {
  const text = normalizeStoreSearchText(value);

  return (
    text.includes("melhoria") ||
    text.includes("evolucao") ||
    text.includes("criacao")
  );
}

function hasReleaseText(value: string) {
  const text = normalizeStoreSearchText(value);

  return text.includes("release") || text.includes("deploy");
}

function hasSupportText(value: string) {
  const text = normalizeStoreSearchText(value);

  return (
    text.includes("supportops") ||
    text.includes("investigacao") ||
    text.includes("troubleshooting")
  );
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
  const metadata = row.metadata ?? {};

  return {
    affectedFiles: row.affected_files,
    changeCategory: row.change_category,
    commit: row.commit_sha,
    createdAt: row.created_at,
    deploy: row.deployment,
    healthchecks: row.healthchecks,
    how: row.how,
    id: row.id,
    isCritical: getMetadataBoolean(metadata, "isCritical"),
    isModuleImprovement: getMetadataBoolean(metadata, "isModuleImprovement"),
    isRelease: getMetadataBoolean(metadata, "isRelease"),
    isSupportInvestigation: getMetadataBoolean(metadata, "isSupportInvestigation"),
    lineStart: row.line_start,
    localDateTime: row.local_date_time,
    localOccurredAt: row.local_occurred_at,
    logic: row.logic,
    macroSummary: row.macro_summary,
    module: row.module,
    nextSquad: row.next_squad,
    protocol: row.protocol,
    rawContent: row.raw_content,
    reason: row.reason,
    risks: row.risks,
    routine: getMetadataText(metadata, "routine"),
    screen: row.screen,
    shortSummary: getMetadataText(metadata, "shortSummary"),
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

function getMetadataBoolean(
  metadata: Record<string, unknown>,
  key: string,
) {
  return metadata[key] === true;
}

function getMetadataText(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];

  return typeof value === "string" && value.trim() ? value : null;
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

function normalizeStoreSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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
