#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const sqlFile =
  readArg("--sql-file") ??
  "packages/database/migrations/0024_caredesk_meta_whatsapp_integration.sql";

loadEnvFile(".env");
loadEnvFile(".env.local");
loadEnvFile("apps/hub/.env.local");

const postgresUrl =
  readEnv("POSTGRES_URL") ??
  readEnv("POSTGRES_URL_NON_POOLING") ??
  readEnv("POSTGRES_PRISMA_URL") ??
  readEnv("HOMOLOG_POSTGRES_URL");

if (!postgresUrl) {
  fail(
    "Missing POSTGRES_URL, POSTGRES_URL_NON_POOLING, POSTGRES_PRISMA_URL or HOMOLOG_POSTGRES_URL. No secret values were printed.",
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
    select
      table_name,
      to_regclass('public.' || table_name) is not null as present
    from (
      values
        ('caredesk_meta_webhook_events'),
        ('caredesk_whatsapp_message_refs')
    ) as expected(table_name)
    order by table_name;
  `);

  const { rows: channelRows } = await client.query(`
    select
      slug,
      provider,
      config ->> 'webhook_path' as webhook_path,
      config ->> 'inbound_enabled' as inbound_enabled,
      config ->> 'outbound_enabled' as outbound_enabled
    from public.caredesk_channels
    where slug = 'whatsapp-careli'
      and provider = 'meta'
    limit 1;
  `);

  console.log("Iris Meta schema applied.");
  console.log(
    JSON.stringify(
      {
        tables: rows,
        whatsappChannel: channelRows[0] ?? null,
      },
      null,
      2,
    ),
  );
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
