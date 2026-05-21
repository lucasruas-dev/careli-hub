#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const envFile = readArg("--env-file");
const explicitSqlFile = readArg("--sql-file");
const sqlFiles = explicitSqlFile
  ? [explicitSqlFile]
  : [
      "packages/database/migrations/0023_atlas_core.sql",
      "packages/database/migrations/0027_atlas_occurrence_justifications.sql",
      "packages/database/migrations/0028_atlas_occurrence_evidences.sql",
      "packages/database/migrations/0029_atlas_fpe.sql",
    ];

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
  readEnv("HOMOLOG_POSTGRES_URL");

if (!postgresUrl) {
  fail("Missing POSTGRES_URL, POSTGRES_URL_NON_POOLING, POSTGRES_PRISMA_URL or HOMOLOG_POSTGRES_URL. No secret values were printed.");
}

const sqlBatches = sqlFiles.map((sqlFile) => {
  const sqlPath = resolve(process.cwd(), sqlFile);

  if (!existsSync(sqlPath)) {
    fail(`SQL file not found: ${sqlFile}`);
  }

  return {
    sql: readFileSync(sqlPath, "utf8"),
    sqlFile,
  };
});
const { Client } = pg;
const client = new Client({
  connectionString: postgresUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  for (const batch of sqlBatches) {
    await client.query(batch.sql);
    console.log(`Atlas schema batch applied: ${batch.sqlFile}`);
  }

  const { rows } = await client.query(`
    select table_name, to_regclass('public.' || table_name) is not null as present
    from (
      values
        ('atlas_migration_batches'),
        ('atlas_departments'),
        ('atlas_roles'),
        ('atlas_collaborators'),
        ('atlas_occurrence_profiles'),
        ('atlas_occurrence_types'),
        ('atlas_occurrence_evidences'),
        ('atlas_occurrences'),
        ('atlas_fpe_entries'),
        ('atlas_legacy_user_profiles')
    ) as expected(table_name)
    order by table_name;
  `);

  console.log("Atlas schema applied.");
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
