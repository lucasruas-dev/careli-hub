#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const envFile = readArg("--env-file");
const sqlFile =
  readArg("--sql-file") ??
  "packages/database/migrations/0034_chronos_drive_chat_storage.sql";
const confirmedProduction = process.argv.includes("--confirm-production");

if (!confirmedProduction) {
  fail(
    "Missing --confirm-production. This schema changes Chronos Storage, RLS and grants in Production.",
  );
}

loadEnvFile(".env");
loadEnvFile(".env.local");
loadEnvFile("apps/hub/.env.local");

if (envFile) {
  loadEnvFile(envFile, { override: true });
}

const postgresEnv = pickEnv([
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "DATABASE_URL",
]);

if (!postgresEnv.value) {
  fail(
    "Missing production Postgres URL. Expected POSTGRES_URL_NON_POOLING, POSTGRES_URL, POSTGRES_PRISMA_URL or DATABASE_URL. No secret values were printed.",
  );
}

const sqlPath = resolve(process.cwd(), sqlFile);

if (!existsSync(sqlPath)) {
  fail(`SQL file not found: ${sqlFile}`);
}

const sql = readFileSync(sqlPath, "utf8");
const { Client } = pg;
const client = new Client({
  connectionString: postgresEnv.value,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(sql);

  const { rows: tableRows } = await client.query(`
    with expected_tables(table_name) as (
      values
        ('chronos_chat_messages'),
        ('chronos_participant_preferences')
    )
    select
      expected_tables.table_name,
      tables.table_name is not null as present,
      coalesce(class.relrowsecurity, false) as rls_enabled,
      case class.relreplident
        when 'f' then 'full'
        when 'd' then 'default'
        when 'n' then 'nothing'
        when 'i' then 'index'
        else 'unknown'
      end as replica_identity
    from expected_tables
    left join information_schema.tables tables
      on tables.table_schema = 'public'
      and tables.table_name = expected_tables.table_name
    left join pg_class class
      on class.relname = expected_tables.table_name
    left join pg_namespace namespace
      on namespace.oid = class.relnamespace
      and namespace.nspname = 'public'
    order by expected_tables.table_name;
  `);

  const { rows: recordingColumns } = await client.query(`
    with expected_columns(column_name) as (
      values
        ('file_name'),
        ('mime_type'),
        ('size_bytes'),
        ('uploaded_at')
    )
    select
      expected_columns.column_name,
      columns.column_name is not null as present
    from expected_columns
    left join information_schema.columns columns
      on columns.table_schema = 'public'
      and columns.table_name = 'chronos_recordings'
      and columns.column_name = expected_columns.column_name
    order by expected_columns.column_name;
  `);

  const { rows: indexRows } = await client.query(`
    with expected_indexes(indexname) as (
      values
        ('chronos_recordings_storage_path_idx'),
        ('chronos_chat_messages_meeting_created_idx'),
        ('chronos_participant_preferences_user_idx'),
        ('chronos_participant_preferences_user_key'),
        ('chronos_participant_preferences_guest_key')
    )
    select
      expected_indexes.indexname,
      pg_indexes.indexname is not null as present
    from expected_indexes
    left join pg_indexes
      on pg_indexes.schemaname = 'public'
      and pg_indexes.indexname = expected_indexes.indexname
    order by expected_indexes.indexname;
  `);

  const { rows: policyRows } = await client.query(`
    with expected_policies(schema_name, table_name, policy_name) as (
      values
        ('public', 'chronos_chat_messages', 'chronos authenticated read'),
        ('public', 'chronos_chat_messages', 'chronos authenticated manage'),
        ('public', 'chronos_participant_preferences', 'chronos authenticated read'),
        ('public', 'chronos_participant_preferences', 'chronos authenticated manage'),
        ('storage', 'objects', 'chronos drive authenticated read'),
        ('storage', 'objects', 'chronos drive authenticated manage')
    )
    select
      expected_policies.schema_name,
      expected_policies.table_name,
      expected_policies.policy_name,
      policies.policyname is not null as present
    from expected_policies
    left join pg_policies policies
      on policies.schemaname = expected_policies.schema_name
      and policies.tablename = expected_policies.table_name
      and policies.policyname = expected_policies.policy_name
    order by
      expected_policies.schema_name,
      expected_policies.table_name,
      expected_policies.policy_name;
  `);

  const { rows: bucketRows } = await client.query(`
    select
      id,
      public,
      file_size_limit,
      allowed_mime_types is not null as mime_types_configured
    from storage.buckets
    where id = 'chronos-drive';
  `);

  const result = {
    applied: true,
    envSource: postgresEnv.name,
    bucket: bucketRows[0] ?? null,
    recordingColumns,
    tables: tableRows,
    indexes: indexRows,
    policies: policyRows,
  };

  assertAllPresent("bucket", [Boolean(bucketRows[0])]);
  assertAllPresent(
    "recordingColumns",
    recordingColumns.map((row) => row.present),
  );
  assertAllPresent(
    "tables",
    tableRows.map((row) => row.present && row.rls_enabled),
  );
  assertAllPresent(
    "indexes",
    indexRows.map((row) => row.present),
  );
  assertAllPresent(
    "policies",
    policyRows.map((row) => row.present),
  );

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        applied: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

function loadEnvFile(path, options = {}) {
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

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");

    if (key && (options.override || !process.env[key])) {
      process.env[key] = value;
    }
  }
}

function readArg(name) {
  const prefix = `${name}=`;
  const rawArg = process.argv.find((arg) => arg.startsWith(prefix));

  return rawArg ? rawArg.slice(prefix.length) : undefined;
}

function pickEnv(keys) {
  for (const name of keys) {
    const value = process.env[name]?.trim();

    if (value) {
      return { name, value };
    }
  }

  return { name: null, value: null };
}

function assertAllPresent(label, checks) {
  if (checks.every(Boolean)) {
    return;
  }

  throw new Error(`Chronos drive storage verification failed: ${label}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
