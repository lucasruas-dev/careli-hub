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
  readEnv("DATABASE_URL") ??
  readEnv("HOMOLOG_POSTGRES_URL");

if (!postgresUrl) {
  fail(
    "Missing POSTGRES_URL, POSTGRES_URL_NON_POOLING, POSTGRES_PRISMA_URL, DATABASE_URL or HOMOLOG_POSTGRES_URL. No secret values were printed.",
  );
}

const { Client } = pg;
const client = new Client({
  connectionString: postgresUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  const tableCounts = await queryRows(`
    select relname as table_name, n_live_tup::bigint as estimated_rows
    from pg_stat_user_tables
    where schemaname = 'public'
      and relname like 'apolo_%'
    order by relname;
  `);
  const rls = await queryRows(`
    select c.relname as table_name, c.relrowsecurity as rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname like 'apolo_%'
    order by c.relname;
  `);
  const policies = await queryRows(`
    select tablename as table_name, count(*)::int as policies
    from pg_policies
    where schemaname = 'public'
      and tablename like 'apolo_%'
    group by tablename
    order by tablename;
  `);

  console.log(
    JSON.stringify(
      {
        policies,
        rls,
        tableCounts,
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}

async function queryRows(sql) {
  const { rows } = await client.query(sql);

  return rows;
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
