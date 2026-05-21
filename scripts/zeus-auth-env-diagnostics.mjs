#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const envFile = readArg("--env-file");
const maxPages = readNumberArg("--max-pages", 20);

if (!envFile) {
  fail("Informe --env-file=<arquivo>. Nenhum valor de secret sera impresso.");
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
const anon = pickEnv(env, [
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
]);

const baseResult = {
  envSources: {
    anon: anon.name,
    serviceRole: serviceRole.name,
    url: url.name,
  },
  recommendations: [],
  status: "pending",
  supabaseUrl: maskSupabaseUrl(url.value),
};

if (!url.value || !serviceRole.value) {
  console.log(
    JSON.stringify(
      {
        ...baseResult,
        recommendations: [
          "URL ou service role ausente no ambiente analisado.",
        ],
        status: "bloqueado",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

try {
  const client = createClient(url.value, serviceRole.value, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const [authUsers, hubUsers] = await Promise.all([
    listAuthUserIds(client),
    listHubUsers(client),
  ]);
  const authUserIds = new Set(authUsers);
  const hubUserIds = new Set(hubUsers.map((row) => row.id));
  const activeHubUsers = hubUsers.filter((row) => row.status === "active");
  const validRoles = new Set(["admin", "leader", "operator", "viewer"]);
  const meta = {
    activeProfileWithoutAuth: activeHubUsers.filter(
      (row) => !authUserIds.has(row.id),
    ).length,
    activeProfiles: activeHubUsers.length,
    authUsers: authUsers.length,
    authWithoutProfile: authUsers.filter((id) => !hubUserIds.has(id)).length,
    disabledProfiles: hubUsers.filter((row) => row.status !== "active").length,
    hubProfiles: hubUsers.length,
    invalidRoleProfiles: hubUsers.filter((row) => !validRoles.has(row.role))
      .length,
  };
  const recommendations = [];

  if (meta.authUsers <= 4) {
    recommendations.push(
      "O ambiente analisado tem poucos Auth users; provavel falta de provisionamento dos usuarios neste projeto.",
    );
  }

  if (meta.authWithoutProfile > 0) {
    recommendations.push(
      "Existem Auth users sem perfil em public.hub_users; sincronizar perfil pelo mesmo UUID.",
    );
  }

  if (meta.activeProfileWithoutAuth > 0) {
    recommendations.push(
      "Existem perfis ativos sem Auth correspondente; criar usuario Auth ou desativar perfil.",
    );
  }

  if (meta.invalidRoleProfiles > 0) {
    recommendations.push(
      "Existem roles fora do enum admin, leader, operator ou viewer.",
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Auth e public.hub_users estao alinhados na amostra; investigar senha, confirmacao de e-mail ou projeto Supabase esperado.",
    );
  }

  console.log(
    JSON.stringify(
      {
        ...baseResult,
        meta,
        recommendations,
        status:
          meta.authWithoutProfile > 0 ||
          meta.activeProfileWithoutAuth > 0 ||
          meta.invalidRoleProfiles > 0
            ? "desalinhado"
            : "sincronizado",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ...baseResult,
        error:
          error instanceof Error && error.message.trim()
            ? error.message
            : "diagnostic-failed",
        recommendations: [
          "Nao foi possivel ler Auth ou public.hub_users com as envs analisadas.",
        ],
        status: "indisponivel",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

async function listAuthUserIds(client) {
  const ids = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await client.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (result.error) {
      throw new Error(`auth-users-read-failed:${result.error.message}`);
    }

    const users = result.data.users ?? [];
    ids.push(
      ...users
        .map((user) => user.id)
        .filter((id) => typeof id === "string" && id.length > 0),
    );

    if (users.length < 200) {
      break;
    }
  }

  return ids;
}

async function listHubUsers(client) {
  const rows = [];

  for (let page = 0; page < maxPages; page += 1) {
    const from = page * 500;
    const result = await client
      .from("hub_users")
      .select("id,role,status")
      .range(from, from + 499);

    if (result.error) {
      throw new Error(`hub-users-read-failed:${result.error.message}`);
    }

    const pageRows = (result.data ?? [])
      .map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        role: typeof row.role === "string" ? row.role : "",
        status: typeof row.status === "string" ? row.status : "",
      }))
      .filter((row) => row.id.length > 0);
    rows.push(...pageRows);

    if (pageRows.length < 500) {
      break;
    }
  }

  return rows;
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

function readArg(name) {
  const prefix = `${name}=`;
  const rawArg = args.find((arg) => arg.startsWith(prefix));

  return rawArg ? rawArg.slice(prefix.length) : undefined;
}

function readNumberArg(name, fallback) {
  const prefix = `${name}=`;
  const rawArg = args.find((arg) => arg.startsWith(prefix));
  const value = rawArg ? Number(rawArg.slice(prefix.length)) : fallback;

  return Number.isFinite(value) && value > 0 ? value : fallback;
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

function maskSupabaseUrl(url) {
  if (!url) {
    return "missing";
  }

  try {
    const parsedUrl = new URL(url);
    const [projectRef = "unknown"] = parsedUrl.hostname.split(".");

    return `${parsedUrl.protocol}//${projectRef.slice(0, 4)}...${projectRef.slice(-4)}.${parsedUrl.hostname
      .split(".")
      .slice(1)
      .join(".")}`;
  } catch {
    return "invalid-url";
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
