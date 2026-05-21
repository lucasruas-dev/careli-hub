#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const batchSize = readNumberArg("--batch-size", 500);
const sourceEnvFile = readArg("--source-env-file");
const targetEnvFile = readArg("--target-env-file");

loadEnvFile(".env");
loadEnvFile(".env.local");
loadEnvFile("apps/hub/.env.local");

if (targetEnvFile) {
  loadEnvFile(targetEnvFile);
}

const sourceEnv = sourceEnvFile ? readEnvFileObject(sourceEnvFile) : {};
const sourceUrl =
  readEnv("ATLAS_SUPABASE_URL") ??
  readEnvFromObject(sourceEnv, "ATLAS_SUPABASE_URL") ??
  readEnvFromObject(sourceEnv, "NEXT_PUBLIC_SUPABASE_URL");
const sourceKey =
  readEnv("ATLAS_SUPABASE_SERVICE_ROLE_KEY") ??
  readEnv("ATLAS_SUPABASE_ANON_KEY") ??
  readEnvFromObject(sourceEnv, "ATLAS_SUPABASE_SERVICE_ROLE_KEY") ??
  readEnvFromObject(sourceEnv, "ATLAS_SUPABASE_ANON_KEY") ??
  readEnvFromObject(sourceEnv, "SUPABASE_SERVICE_ROLE_KEY") ??
  readEnvFromObject(sourceEnv, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
const targetUrl =
  readEnv("NEXT_PUBLIC_SUPABASE_URL") ?? readEnv("SUPABASE_URL");
const targetKey =
  readEnv("SUPABASE_SERVICE_ROLE_KEY") ?? readEnv("SUPABASE_SECRET_KEY");

const missingEnv = [
  sourceUrl ? null : "ATLAS_SUPABASE_URL",
  sourceKey
    ? null
    : "ATLAS_SUPABASE_SERVICE_ROLE_KEY or ATLAS_SUPABASE_ANON_KEY",
  targetUrl ? null : "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL",
  targetKey ? null : "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY",
].filter(Boolean);

if (missingEnv.length > 0) {
  fail(
    [
      "Atlas migration is missing environment variables.",
      `Missing: ${missingEnv.join(", ")}.`,
      "No secret values were printed.",
    ].join("\n"),
  );
}

const source = createClient(sourceUrl, sourceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const target = createClient(targetUrl, targetKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sourceProjectRef = extractProjectRef(sourceUrl);

console.log(
  apply
    ? "Atlas migration running in APPLY mode."
    : "Atlas migration running in DRY-RUN mode. Add --apply to write to Hub tables.",
);

const sourceData = {
  departments: await fetchAll(source, "setores", "id,nome", "nome"),
  roles: await fetchAll(source, "cargos", "id,nome,valor_base", "nome"),
  collaborators: await fetchAll(
    source,
    "colaboradores",
    "id,nome,email,user_id,setor_id,cargo_id",
    "nome",
  ),
  occurrenceProfiles: await fetchAll(
    source,
    "perfis_ocorrencia",
    "id,nome",
    "nome",
  ),
  occurrenceTypes: await fetchAll(
    source,
    "tipos_ocorrencia",
    "id,nome,perfil_id",
    "nome",
  ),
  occurrences: await fetchAll(
    source,
    "ocorrencias",
    "id,codigo,colaborador_id,tipo_ocorrencia_id,data_ocorrencia,observacao,evidencia_url,evidencia_nome,evidencia_tipo,created_at",
    "created_at",
    { ascending: true },
  ),
  userProfiles: await fetchAll(
    source,
    "usuarios_perfis",
    "user_id,nome,perfil,ativo",
    "nome",
  ),
};

const counts = Object.fromEntries(
  Object.entries(sourceData).map(([key, rows]) => [key, rows.length]),
);

console.log("Source counts:", counts);

if (!apply) {
  process.exit(0);
}

const migrationBatch = await insertMigrationBatch(counts);

try {
  await upsertRows(
    "atlas_departments",
    sourceData.departments.map((row) => ({
      legacy_id: row.id,
      migration_batch_id: migrationBatch.id,
      name: row.nome,
    })),
  );

  await upsertRows(
    "atlas_roles",
    sourceData.roles.map((row) => ({
      base_value: row.valor_base ?? null,
      legacy_id: row.id,
      migration_batch_id: migrationBatch.id,
      name: row.nome,
    })),
  );

  await upsertRows(
    "atlas_occurrence_profiles",
    sourceData.occurrenceProfiles.map((row) => ({
      legacy_id: row.id,
      migration_batch_id: migrationBatch.id,
      name: row.nome,
    })),
  );

  const departmentIds = await loadLegacyIdMap("atlas_departments");
  const roleIds = await loadLegacyIdMap("atlas_roles");
  const profileIds = await loadLegacyIdMap("atlas_occurrence_profiles");

  await upsertRows(
    "atlas_occurrence_types",
    sourceData.occurrenceTypes.map((row) => ({
      legacy_id: row.id,
      migration_batch_id: migrationBatch.id,
      name: row.nome,
      profile_id: row.perfil_id ? profileIds.get(row.perfil_id) ?? null : null,
      profile_legacy_id: row.perfil_id ?? null,
    })),
  );

  const occurrenceTypeIds = await loadLegacyIdMap("atlas_occurrence_types");

  await upsertRows(
    "atlas_collaborators",
    sourceData.collaborators.map((row) => ({
      department_id: row.setor_id ? departmentIds.get(row.setor_id) ?? null : null,
      department_legacy_id: row.setor_id ?? null,
      email: row.email ?? null,
      legacy_id: row.id,
      legacy_user_id: row.user_id ?? null,
      migration_batch_id: migrationBatch.id,
      name: row.nome,
      role_id: row.cargo_id ? roleIds.get(row.cargo_id) ?? null : null,
      role_legacy_id: row.cargo_id ?? null,
    })),
  );

  const collaboratorIds = await loadLegacyIdMap("atlas_collaborators");

  await upsertRows(
    "atlas_occurrences",
    sourceData.occurrences.map((row) => ({
      collaborator_id: collaboratorIds.get(row.colaborador_id) ?? null,
      collaborator_legacy_id: row.colaborador_id,
      evidence_name: row.evidencia_nome ?? null,
      evidence_type: row.evidencia_tipo ?? null,
      evidence_url: row.evidencia_url ?? null,
      legacy_code: normalizeBigInt(row.codigo),
      legacy_id: row.id,
      migration_batch_id: migrationBatch.id,
      observation: row.observacao ?? null,
      occurrence_date: row.data_ocorrencia,
      occurrence_type_id:
        occurrenceTypeIds.get(row.tipo_ocorrencia_id) ?? null,
      occurrence_type_legacy_id: row.tipo_ocorrencia_id,
      source_created_at: row.created_at ?? null,
    })),
  );

  const occurrenceIds = await loadLegacyIdMap("atlas_occurrences");

  await insertOccurrenceEvidences(
    sourceData.occurrences.map((row) => ({
      evidence_name: row.evidencia_nome ?? null,
      evidence_type: row.evidencia_tipo ?? null,
      evidence_url: row.evidencia_url ?? null,
      legacy_id: row.id,
    })),
    occurrenceIds,
    migrationBatch.id,
  );

  await upsertRows(
    "atlas_legacy_user_profiles",
    sourceData.userProfiles
      .filter((row) => row.user_id)
      .map((row) => ({
        active: row.ativo ?? null,
        display_name: row.nome ?? null,
        legacy_role: row.perfil ?? null,
        legacy_user_id: row.user_id,
        migration_batch_id: migrationBatch.id,
      })),
    "legacy_user_id",
  );

  const importedCounts = await loadImportedCounts();
  await finishMigrationBatch(migrationBatch.id, "completed", importedCounts);

  console.log("Atlas migration completed:", importedCounts);
} catch (error) {
  await finishMigrationBatch(migrationBatch.id, "failed", {});
  throw error;
}

async function fetchAll(client, tableName, selectClause, orderColumn, orderOptions = {}) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + batchSize - 1;
    let query = client.from(tableName).select(selectClause).range(from, to);

    if (orderColumn) {
      query = query.order(orderColumn, orderOptions);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to read ${tableName}: ${error.message}`);
    }

    rows.push(...(data ?? []));

    if (!data || data.length < batchSize) {
      return rows;
    }

    from += batchSize;
  }
}

async function upsertRows(tableName, rows, onConflict = "legacy_id") {
  if (rows.length === 0) {
    return;
  }

  for (const chunk of chunkRows(rows, batchSize)) {
    const { error } = await target
      .from(tableName)
      .upsert(chunk, { onConflict });

    if (error) {
      throw new Error(`Failed to upsert ${tableName}: ${error.message}`);
    }
  }

  console.log(`Imported ${rows.length} rows into ${tableName}.`);
}

async function loadLegacyIdMap(tableName) {
  const rows = await fetchAll(target, tableName, "id,legacy_id", "created_at");

  return new Map(rows.map((row) => [row.legacy_id, row.id]));
}

async function insertOccurrenceEvidences(rows, occurrenceIds, migrationBatchId) {
  const evidenceRows = rows
    .filter((row) => row.evidence_url)
    .map((row) => ({
      evidence_name: row.evidence_name ?? null,
      evidence_type: row.evidence_type ?? null,
      evidence_url: row.evidence_url,
      legacy_evidence_key: `legacy:${row.legacy_id}:primary`,
      metadata: {
        imported_via: "atlas-migrate-data",
        migration_batch_id: migrationBatchId,
        record_type: "atlas_occurrence_evidences",
      },
      occurrence_id: occurrenceIds.get(row.legacy_id),
      occurrence_legacy_id: row.legacy_id,
      position: 1,
    }))
    .filter((row) => row.occurrence_id);

  if (evidenceRows.length === 0) {
    return;
  }

  const existingKeys = await loadExistingEvidenceKeys(
    evidenceRows.map((row) => row.legacy_evidence_key),
  );
  const rowsToInsert = evidenceRows.filter(
    (row) => !existingKeys.has(row.legacy_evidence_key),
  );

  if (rowsToInsert.length === 0) {
    console.log("Imported 0 rows into atlas_occurrence_evidences.");
    return;
  }

  for (const chunk of chunkRows(rowsToInsert, batchSize)) {
    const { error } = await target
      .from("atlas_occurrence_evidences")
      .insert(chunk);

    if (error) {
      throw new Error(
        `Failed to insert atlas_occurrence_evidences: ${error.message}`,
      );
    }
  }

  console.log(`Imported ${rowsToInsert.length} rows into atlas_occurrence_evidences.`);
}

async function loadExistingEvidenceKeys(keys) {
  const existingKeys = new Set();

  for (const chunk of chunkRows(keys, batchSize)) {
    const { data, error } = await target
      .from("atlas_occurrence_evidences")
      .select("legacy_evidence_key")
      .in("legacy_evidence_key", chunk);

    if (error) {
      throw new Error(
        `Failed to read atlas_occurrence_evidences: ${error.message}`,
      );
    }

    for (const row of data ?? []) {
      if (row.legacy_evidence_key) {
        existingKeys.add(row.legacy_evidence_key);
      }
    }
  }

  return existingKeys;
}

async function insertMigrationBatch(sourceCounts) {
  const { data, error } = await target
    .from("atlas_migration_batches")
    .insert({
      source_counts: sourceCounts,
      source_project_ref: sourceProjectRef,
      started_at: new Date().toISOString(),
      status: "running",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create atlas_migration_batches record: ${error?.message ?? "empty response"}`,
    );
  }

  return data;
}

async function finishMigrationBatch(id, status, importedCounts) {
  const { error } = await target
    .from("atlas_migration_batches")
    .update({
      finished_at: new Date().toISOString(),
      imported_counts: importedCounts,
      status,
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Failed to update migration batch: ${error.message}`);
  }
}

async function loadImportedCounts() {
  const tableNames = [
    "atlas_departments",
    "atlas_roles",
    "atlas_collaborators",
    "atlas_occurrence_profiles",
    "atlas_occurrence_types",
    "atlas_occurrences",
    "atlas_occurrence_evidences",
    "atlas_fpe_entries",
    "atlas_legacy_user_profiles",
  ];
  const result = {};

  for (const tableName of tableNames) {
    const { count, error } = await target
      .from(tableName)
      .select("id", { count: "exact", head: true });

    if (error) {
      throw new Error(`Failed to count ${tableName}: ${error.message}`);
    }

    result[tableName] = count ?? 0;
  }

  return result;
}

function loadEnvFile(path) {
  const absolutePath = resolve(process.cwd(), path);

  if (!existsSync(absolutePath)) {
    return;
  }

  const content = readFileSync(absolutePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").trim().replace(/^['"]|['"]$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function readEnv(key) {
  const value = process.env[key]?.trim();

  return value ? value : undefined;
}

function readNumberArg(name, fallback) {
  const rawArg = process.argv.find((arg) => arg.startsWith(`${name}=`));
  const value = rawArg ? Number(rawArg.split("=", 2)[1]) : fallback;

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readArg(name) {
  const prefix = `${name}=`;
  const rawArg = process.argv.find((arg) => arg.startsWith(prefix));

  return rawArg ? rawArg.slice(prefix.length) : undefined;
}

function readEnvFileObject(path) {
  const absolutePath = resolve(process.cwd(), path);

  if (!existsSync(absolutePath)) {
    fail(`Environment file not found: ${path}`);
  }

  const result = {};
  const content = readFileSync(absolutePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");
    result[key] = valueParts.join("=").trim().replace(/^['"]|['"]$/g, "");
  }

  return result;
}

function readEnvFromObject(env, key) {
  const value = env[key]?.trim();

  return value ? value : undefined;
}

function chunkRows(rows, size) {
  const chunks = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

function normalizeBigInt(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : null;
}

function extractProjectRef(url) {
  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
