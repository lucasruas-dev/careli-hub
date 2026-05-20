#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const envFile = readArg("--env-file");

loadEnvFile(".env");
loadEnvFile(".env.local");
loadEnvFile("apps/hub/.env.local");

if (envFile) {
  loadEnvFile(envFile);
}

const postgresUrl =
  readEnv("POSTGRES_URL") ??
  readEnv("POSTGRES_URL_NON_POOLING") ??
  readEnv("POSTGRES_PRISMA_URL");

if (!postgresUrl) {
  fail("Missing POSTGRES_URL, POSTGRES_URL_NON_POOLING or POSTGRES_PRISMA_URL. No secret values were printed.");
}

const { Client } = pg;
const client = new Client({
  connectionString: postgresUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  const summary = await queryOne(`
    select
      (select count(*)::int from public.atlas_departments) as departments,
      (select count(*)::int from public.atlas_roles) as roles,
      (select count(*)::int from public.atlas_collaborators) as collaborators,
      (select count(*)::int from public.atlas_occurrence_profiles) as occurrence_profiles,
      (select count(*)::int from public.atlas_occurrence_types) as occurrence_types,
      (select count(*)::int from public.atlas_occurrences) as occurrences,
      (select count(*)::int from public.atlas_legacy_user_profiles) as user_profiles;
  `);
  const values = await queryOne(`
    select
      count(*) filter (where base_value is not null)::int as roles_with_base_value,
      coalesce(sum(base_value), 0)::numeric(14,2) as base_value_sum,
      coalesce(min(base_value), 0)::numeric(14,2) as base_value_min,
      coalesce(max(base_value), 0)::numeric(14,2) as base_value_max
    from public.atlas_roles;
  `);
  const occurrences = await queryOne(`
    select
      min(occurrence_date)::text as first_occurrence_date,
      max(occurrence_date)::text as last_occurrence_date,
      count(*) filter (where evidence_url is not null)::int as occurrences_with_evidence,
      count(*) filter (where evidence_url is null)::int as occurrences_without_evidence
    from public.atlas_occurrences;
  `);
  const batch = await queryOne(`
    select status, source_counts, imported_counts, finished_at is not null as finished
    from public.atlas_migration_batches
    order by created_at desc
    limit 1;
  `);

  console.log(
    JSON.stringify(
      {
        batch,
        occurrences,
        summary,
        values,
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}

async function queryOne(sql) {
  const { rows } = await client.query(sql);

  return rows[0] ?? {};
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
