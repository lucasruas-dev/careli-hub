#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const envFile = readArg("--env-file");

if (!envFile) {
  fail("Informe --env-file=<arquivo>. Nenhuma connection string sera impressa.");
}

const env = readEnvFile(envFile);
const postgresUrl = pickEnv(env, [
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
  "HOMOLOG_POSTGRES_URL",
]);

if (!postgresUrl.value) {
  console.log(
    JSON.stringify(
      {
        envSource: postgresUrl.name,
        recommendations: ["POSTGRES_URL ausente no arquivo analisado."],
        status: "bloqueado",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const client = new pg.Client({
  connectionString: postgresUrl.value,
  ssl: {
    rejectUnauthorized: false,
  },
});

try {
  await client.connect();
  const result = await client.query(`
    with
      auth_counts as (
        select count(*)::int as total
        from auth.users
      ),
      hub_counts as (
        select
          count(*)::int as total,
          count(*) filter (where status = 'active')::int as active,
          count(*) filter (where status <> 'active')::int as inactive,
          count(*) filter (
            where role::text not in ('admin', 'leader', 'operator', 'viewer')
          )::int as invalid_roles
        from public.hub_users
      ),
      mismatches as (
        select
          count(*) filter (where hu.id is null)::int as auth_without_profile,
          count(*) filter (where au.id is null and hu.status = 'active')::int
            as active_profile_without_auth
        from auth.users au
        full outer join public.hub_users hu on hu.id = au.id
      )
    select
      (select total from auth_counts) as auth_users,
      (select total from hub_counts) as hub_profiles,
      (select active from hub_counts) as active_profiles,
      (select inactive from hub_counts) as inactive_profiles,
      (select invalid_roles from hub_counts) as invalid_role_profiles,
      (select auth_without_profile from mismatches) as auth_without_profile,
      (select active_profile_without_auth from mismatches)
        as active_profile_without_auth
  `);
  const meta = result.rows[0] ?? {};

  console.log(
    JSON.stringify(
      {
        envSource: postgresUrl.name,
        meta,
        recommendations:
          Number(meta.auth_users ?? 0) <= 4
            ? [
                "A base analisada tambem tem poucos Auth users; ela nao parece ser a origem completa para provisionamento.",
              ]
            : ["Base analisada possui usuarios suficientes para comparar."],
        status: "ok",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.log(
    JSON.stringify(
      {
        envSource: postgresUrl.name,
        error:
          error instanceof Error && error.message.trim()
            ? error.message
            : "postgres-diagnostic-failed",
        recommendations: ["Nao foi possivel consultar contagens no Postgres."],
        status: "indisponivel",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

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
