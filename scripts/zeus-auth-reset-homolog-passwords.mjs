#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const envFile = readArg("--env-file");
const passwordEnv = readArg("--password-env") ?? "ZEUS_TEMP_PASSWORD";
const verifyEmail = normalizeEmail(readArg("--verify-email"));

if (!envFile) {
  fail("Informe --env-file=<arquivo>. Nenhum secret sera impresso.");
}

const temporaryPassword = process.env[passwordEnv];

if (!temporaryPassword) {
  fail("Senha temporaria ausente no ambiente de execucao.");
}

if (temporaryPassword.length < 8) {
  fail("Senha temporaria curta demais.");
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

if (!url.value || !serviceRole.value) {
  fail("URL ou service role ausente. Nenhum valor foi impresso.");
}

const adminClient = createClient(url.value, serviceRole.value, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
const activeHubUsers = await fetchActiveHubUsers();
const authUsers = await listAuthUsers();
const authById = new Map(authUsers.map((user) => [user.id, user]));
const targets = activeHubUsers.filter((hubUser) => authById.has(hubUser.id));
const missingAuthProfiles = activeHubUsers.length - targets.length;
const result = {
  activeHubUsers: activeHubUsers.length,
  apply,
  failed: 0,
  missingAuthProfiles,
  resetAttempted: apply ? targets.length : 0,
  resetSucceeded: 0,
  status: apply ? "pending" : "dry-run",
  supabaseUrl: maskSupabaseUrl(url.value),
  targetAuthUsers: targets.length,
  verify: null,
};

if (apply) {
  for (const target of targets) {
    const response = await adminClient.auth.admin.updateUserById(target.id, {
      password: temporaryPassword,
    });

    if (response.error) {
      result.failed += 1;
      continue;
    }

    result.resetSucceeded += 1;
  }

  result.status = result.failed > 0 ? "completed-with-errors" : "completed";
}

if (apply && verifyEmail) {
  result.verify = await verifyPassword(verifyEmail);
}

console.log(JSON.stringify(result, null, 2));

async function fetchActiveHubUsers() {
  const rows = [];

  for (let from = 0; ; from += 500) {
    const response = await adminClient
      .from("hub_users")
      .select("id,email,status")
      .eq("status", "active")
      .range(from, from + 499);

    if (response.error) {
      throw new Error(`hub-users-read-failed:${response.error.message}`);
    }

    const pageRows = (response.data ?? [])
      .map((row) => ({
        email: normalizeEmail(row.email),
        id: typeof row.id === "string" ? row.id : "",
      }))
      .filter((row) => row.id && row.email);
    rows.push(...pageRows);

    if (pageRows.length < 500) {
      break;
    }
  }

  return rows;
}

async function listAuthUsers() {
  const users = [];

  for (let page = 1; page <= 20; page += 1) {
    const response = await adminClient.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (response.error) {
      throw new Error(`auth-users-read-failed:${response.error.message}`);
    }

    const pageUsers = response.data.users ?? [];
    users.push(...pageUsers);

    if (pageUsers.length < 200) {
      break;
    }
  }

  return users;
}

async function verifyPassword(email) {
  if (!anon.value) {
    return {
      email: maskEmail(email),
      ok: false,
      reason: "anon-key-missing",
    };
  }

  const verifyClient = createClient(url.value, anon.value, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const response = await verifyClient.auth.signInWithPassword({
    email,
    password: temporaryPassword,
  });

  if (response.error) {
    return {
      email: maskEmail(email),
      error: sanitizeError(response.error.message),
      ok: false,
    };
  }

  await verifyClient.auth.signOut();

  return {
    email: maskEmail(email),
    ok: Boolean(response.data.user),
  };
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

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function maskEmail(value) {
  const normalized = normalizeEmail(value);
  const [name = "", domain = ""] = normalized.split("@");

  if (!name || !domain) {
    return "invalid";
  }

  return `${name.slice(0, 2)}***@${domain}`;
}

function maskSupabaseUrl(value) {
  if (!value) {
    return "missing";
  }

  try {
    const parsedUrl = new URL(value);
    const [projectRef = "unknown"] = parsedUrl.hostname.split(".");

    return `${parsedUrl.protocol}//${projectRef.slice(0, 4)}...${projectRef.slice(-4)}.${parsedUrl.hostname
      .split(".")
      .slice(1)
      .join(".")}`;
  } catch {
    return "invalid-url";
  }
}

function sanitizeError(message) {
  return message.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
