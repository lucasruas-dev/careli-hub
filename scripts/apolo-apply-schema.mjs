#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const envFile = readArg("--env-file");
const sqlFile =
  readArg("--sql-file") ?? "packages/database/migrations/0026_apolo_core.sql";

loadEnvFile(".env");
loadEnvFile(".env.local");
loadEnvFile("apps/hub/.env.local");

if (envFile) {
  loadEnvFile(envFile);
}

const postgresUrl =
  readEnv("POSTGRES_URL") ??
  readEnv("POSTGRES_URL_NON_POOLING") ??
  readEnv("POSTGRES_PRISMA_URL") ??
  readEnv("DATABASE_URL") ??
  readEnv("HOMOLOG_POSTGRES_URL");

if (!postgresUrl) {
  fail(
    "Missing POSTGRES_URL, POSTGRES_URL_NON_POOLING, POSTGRES_PRISMA_URL, DATABASE_URL or HOMOLOG_POSTGRES_URL. No secret values were printed.",
  );
}

const sqlPath = resolve(process.cwd(), sqlFile);

if (!existsSync(sqlPath)) {
  fail(`SQL file not found: ${sqlFile}`);
}

const sql = readFileSync(sqlPath, "utf8");
const { Client } = pg;
const client = new Client({
  connectionString: postgresUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  await client.query(sql);

  const { rows } = await client.query(`
    select table_name, to_regclass('public.' || table_name) is not null as present
    from (
      values
        ('apolo_sync_runs'),
        ('apolo_entities'),
        ('apolo_entity_profiles'),
        ('apolo_entity_identifiers'),
        ('apolo_contacts'),
        ('apolo_addresses'),
        ('apolo_relationships'),
        ('apolo_module_records'),
        ('apolo_commercial_links'),
        ('apolo_financial_snapshots'),
        ('apolo_service_signals'),
        ('apolo_documents'),
        ('apolo_timeline_events'),
        ('apolo_audit_events'),
        ('apolo_source_links'),
        ('apolo_search_entries'),
        ('apolo_merge_candidates')
    ) as expected(table_name)
    order by table_name;
  `);

  console.log("Apolo schema applied.");
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await client.end();
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

function readArg(name) {
  const prefix = `${name}=`;
  const rawArg = process.argv.find((arg) => arg.startsWith(prefix));

  return rawArg ? rawArg.slice(prefix.length) : undefined;
}

function readEnv(key) {
  const value = process.env[key]?.trim();

  return value ? value : undefined;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
