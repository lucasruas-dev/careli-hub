#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envFile = readArg("--env-file");

if (!envFile) {
  fail("Informe --env-file=<arquivo>. Nenhum valor sensivel sera impresso.");
}

const env = readEnvFile(envFile);
const url = pickEnv(env, [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "HOMOLOG_SUPABASE_URL",
]);
const serviceRole = pickEnv(env, [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "HOMOLOG_SUPABASE_SERVICE_ROLE_KEY",
  "HOMOLOG_SUPABASE_SECRET_KEY",
]);

if (!url.value || !serviceRole.value) {
  console.log(
    JSON.stringify(
      {
        recommendations: ["URL ou service role ausente no ambiente analisado."],
        status: "bloqueado",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const client = createClient(url.value, serviceRole.value, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
const tables = [
  ["hub_users", "id,email,status"],
  ["atlas_collaborators", "id,email,status"],
  ["atlas_legacy_user_profiles", "legacy_user_id,display_name,active"],
  ["apolo_entities", "id,display_name,status"],
  ["apolo_contacts", "id,entity_id,contact_type,raw_value"],
  ["pulsex_channel_members", "id,user_id,status"],
  ["hub_departments", "id,slug,status"],
  ["hub_sectors", "id,slug,status"],
];
const result = {
  status: "ok",
  tables: {},
};

for (const [table, select] of tables) {
  const response = await client.from(table).select(select, {
    count: "exact",
    head: true,
  });
  result.tables[table] = response.error
    ? {
        available: false,
        error: response.error.message,
      }
    : {
        available: true,
        count: response.count ?? 0,
      };
}

console.log(JSON.stringify(result, null, 2));

function readArg(name) {
  const prefix = `${name}=`;
  const rawArg = process.argv.slice(2).find((arg) => arg.startsWith(prefix));

  return rawArg ? rawArg.slice(prefix.length) : undefined;
}

function pickEnv(env, names) {
  for (const name of names) {
    const value = env[name]?.trim();

    if (value) {
      return { name, value };
    }
  }

  return { name: null, value: null };
}

function readEnvFile(path) {
  const absolutePath = resolve(process.cwd(), path);

  if (!existsSync(absolutePath)) {
    fail(`Arquivo de env nao encontrado: ${path}`);
  }

  const result = {};
  const content = readFileSync(absolutePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    const key = trimmed.slice(0, separatorIndex);
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    result[key] = value;
  }

  return result;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
