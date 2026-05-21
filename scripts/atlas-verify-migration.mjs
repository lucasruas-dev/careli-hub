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
  readEnv("POSTGRES_PRISMA_URL") ??
  readEnv("HOMOLOG_POSTGRES_URL");

if (!postgresUrl) {
  fail("Missing POSTGRES_URL, POSTGRES_URL_NON_POOLING, POSTGRES_PRISMA_URL or HOMOLOG_POSTGRES_URL. No secret values were printed.");
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
      (select count(*)::int from public.atlas_occurrence_evidences) as occurrence_evidences,
      (select count(*)::int from public.atlas_occurrences) as occurrences,
      (select count(*)::int from public.atlas_fpe_entries) as fpe_entries,
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
      count(*) filter (
        where exists (
          select 1
          from public.atlas_occurrence_evidences evidence
          where evidence.occurrence_legacy_id = atlas_occurrences.legacy_id
        )
        or evidence_url is not null
      )::int as occurrences_with_evidence,
      count(*) filter (
        where not exists (
          select 1
          from public.atlas_occurrence_evidences evidence
          where evidence.occurrence_legacy_id = atlas_occurrences.legacy_id
        )
        and evidence_url is null
      )::int as occurrences_without_evidence
    from public.atlas_occurrences;
  `);
  const evidences = await queryOne(`
    select
      count(*)::int as total,
      count(distinct occurrence_legacy_id)::int as occurrences_with_rows,
      count(distinct evidence_url)::int as distinct_urls,
      count(*) filter (where legacy_evidence_key is not null)::int as legacy_imported,
      count(*) filter (where created_by_user_id is not null)::int as hub_created
    from public.atlas_occurrence_evidences;
  `);
  const justificationWorkflow = await queryOne(`
    select
      count(*) filter (where operational_status = 'procedente')::int as procedente,
      count(*) filter (where operational_status = 'improcedente')::int as improcedente,
      count(*) filter (where justification_status = 'none')::int as justification_none,
      count(*) filter (where justification_status = 'pending')::int as justification_pending,
      count(*) filter (where justification_status = 'accepted')::int as justification_accepted,
      count(*) filter (where justification_status = 'rejected')::int as justification_rejected,
      count(*) filter (where created_by_user_id is not null)::int as hub_created
    from public.atlas_occurrences;
  `);
  const fpe = await queryOne(`
    select
      count(*)::int as total,
      count(*) filter (where cycle_year = extract(year from now())::int)::int as current_cycle,
      coalesce(sum(amount) filter (where kind = 'bonus'), 0)::numeric(14,2) as bonus_amount,
      coalesce(sum(amount) filter (where kind = 'loss'), 0)::numeric(14,2) as loss_amount,
      coalesce(sum(case when kind = 'bonus' then amount * 0.30 else amount * -0.30 end), 0)::numeric(14,2) as global_delta,
      coalesce(sum(case when kind = 'bonus' then amount * 0.70 else amount * -0.70 end), 0)::numeric(14,2) as department_delta
    from public.atlas_fpe_entries;
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
        evidences,
        fpe,
        justificationWorkflow,
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
