#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const envFile = readArg("--env-file");
const sqlFile =
  readArg("--sql-file") ??
  "packages/database/migrations/0037_hermes_realtime_hotfix.sql";
const confirmedProduction = process.argv.includes("--confirm-production");

if (!confirmedProduction) {
  fail(
    "Missing --confirm-production. This hotfix changes the production Realtime publication and must be explicit.",
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

await client.connect();

try {
  await client.query(sql);

  const { rows } = await client.query(`
    with expected_indexes(indexname) as (
      values
        ('pulsex_messages_channel_active_created_at_idx'),
        ('pulsex_messages_thread_parent_created_at_idx'),
        ('pulsex_messages_client_message_id_idx')
    )
    select
      expected_indexes.indexname,
      pg_indexes.indexname is not null as present
    from expected_indexes
    left join pg_indexes
      on pg_indexes.schemaname = 'public'
      and pg_indexes.tablename = 'pulsex_messages'
      and pg_indexes.indexname = expected_indexes.indexname
    order by expected_indexes.indexname;
  `);

  const publication = await client.query(`
    select exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'pulsex_messages'
    ) as present;
  `);

  const replicaIdentity = await client.query(`
    select c.relreplident
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'pulsex_messages'
    limit 1;
  `);

  console.log(
    JSON.stringify(
      {
        applied: true,
        envSource: postgresEnv.name,
        indexes: rows,
        realtimePublication: publication.rows[0],
        replicaIdentity: formatReplicaIdentity(
          replicaIdentity.rows[0]?.relreplident,
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
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

    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").trim().replace(/^['"]|['"]$/g, "");

    if (options.override || !process.env[key]) {
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

function formatReplicaIdentity(value) {
  if (value === "f") {
    return "full";
  }

  if (value === "d") {
    return "default";
  }

  if (value === "n") {
    return "nothing";
  }

  if (value === "i") {
    return "index";
  }

  return "unknown";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
