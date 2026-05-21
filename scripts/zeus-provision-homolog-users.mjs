#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const fallbackCreateUser = args.has("--fallback-create-user");
const envFile = readArg("--env-file");
const redirectTo = readArg("--redirect-to") ?? "https://homo.c2x.app.br/login";

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
  fail("URL ou service role ausente. Nenhum valor foi impresso.");
}

const client = createClient(url.value, serviceRole.value, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
const authUsers = await listAuthUsers(client);
const authByEmail = new Map(
  authUsers
    .filter((user) => typeof user.email === "string" && user.email.trim())
    .map((user) => [normalizeEmail(user.email), user]),
);
const hubUsers = await fetchAll("hub_users", "id,email,status");
const hubByEmail = new Map(
  hubUsers
    .filter((user) => typeof user.email === "string" && user.email.trim())
    .map((user) => [normalizeEmail(user.email), user]),
);
const collaborators = await fetchAll(
  "atlas_collaborators",
  "id,name,email,status",
);
const candidates = collaborators
  .map((collaborator) => ({
    email: normalizeEmail(collaborator.email),
    name: normalizeName(collaborator.name, collaborator.email),
    status: normalizeStatus(collaborator.status),
  }))
  .filter((collaborator) => collaborator.email && collaborator.name)
  .filter((collaborator) => collaborator.status !== "disabled");
const missingCandidates = candidates.filter(
  (candidate) =>
    !authByEmail.has(candidate.email) && !hubByEmail.has(candidate.email),
);
const existingCandidates = candidates.length - missingCandidates.length;
const result = {
  apply,
  createdAuthUsers: 0,
  existingCandidates,
  failed: 0,
  fallbackCreatedUsers: 0,
  fallbackProfilesNeedPasswordRecovery: 0,
  invitedUsers: 0,
  missingCandidates: missingCandidates.length,
  profileUpserts: 0,
  sourceCandidates: candidates.length,
  targetAuthUsersBefore: authUsers.length,
  targetHubUsersBefore: hubUsers.length,
};

if (!apply) {
  console.log(
    JSON.stringify(
      {
        ...result,
        recommendations: [
          "Dry-run concluido. Execute novamente com --apply para enviar convites Supabase e criar perfis hub_users.",
          "Se o Supabase limitar envio de e-mail, execute com --fallback-create-user para criar Auth/perfil e solicitar recuperacao de senha depois.",
        ],
        status: "dry-run",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

for (const candidate of missingCandidates) {
  try {
    const authUser = await createAuthUser(candidate);

    await upsertHubUser({
      email: candidate.email,
      id: authUser.id,
      name: candidate.name,
    });
    result.profileUpserts += 1;
  } catch (error) {
    result.failed += 1;
    console.warn("[zeus-auth-provision] candidate failed", {
      error:
        error instanceof Error && error.message.trim()
          ? sanitizeError(error.message)
          : "unknown-error",
    });
  }
}

const finalAuthUsers = await listAuthUsers(client);
const finalHubUsers = await fetchAll("hub_users", "id,email,status");

console.log(
  JSON.stringify(
    {
      ...result,
      recommendations:
        result.fallbackProfilesNeedPasswordRecovery > 0
          ? [
              "Usuarios criados por fallback nao receberam convite por e-mail; solicitar recuperacao/reenvio de acesso quando o limite do Supabase liberar.",
            ]
          : [],
      status: result.failed > 0 ? "completed-with-errors" : "completed",
      targetAuthUsersAfter: finalAuthUsers.length,
      targetHubUsersAfter: finalHubUsers.length,
    },
    null,
    2,
  ),
);

async function createAuthUser(candidate) {
  const inviteResult = await client.auth.admin.inviteUserByEmail(
    candidate.email,
    {
      data: buildUserMetadata(candidate),
      redirectTo,
    },
  );

  if (!inviteResult.error && inviteResult.data.user) {
    result.invitedUsers += 1;
    result.createdAuthUsers += 1;
    return inviteResult.data.user;
  }

  const errorMessage = inviteResult.error?.message ?? "invite-failed";

  if (!fallbackCreateUser || !shouldFallbackCreateUser(errorMessage)) {
    throw new Error(errorMessage);
  }

  const createResult = await client.auth.admin.createUser({
    app_metadata: {
      role: "operator",
    },
    email: candidate.email,
    email_confirm: true,
    password: createTemporaryPassword(),
    user_metadata: buildUserMetadata(candidate),
  });

  if (createResult.error || !createResult.data.user) {
    throw new Error(
      `fallback-create-failed:${createResult.error?.message ?? "unknown-error"}`,
    );
  }

  result.createdAuthUsers += 1;
  result.fallbackCreatedUsers += 1;
  result.fallbackProfilesNeedPasswordRecovery += 1;
  return createResult.data.user;
}

async function upsertHubUser({ email, id, name }) {
  const payload = {
    display_name: name,
    email,
    id,
    operational_profile: "op1",
    role: "operator",
    status: "active",
  };
  const response = await client
    .from("hub_users")
    .upsert(payload, { onConflict: "id" });

  if (!response.error) {
    return;
  }

  if (!response.error.message.includes("operational_profile")) {
    throw new Error(`hub-users-upsert-failed:${response.error.message}`);
  }

  const fallbackResponse = await client.from("hub_users").upsert(
    {
      display_name: name,
      email,
      id,
      role: "operator",
      status: "active",
    },
    { onConflict: "id" },
  );

  if (fallbackResponse.error) {
    throw new Error(`hub-users-upsert-failed:${fallbackResponse.error.message}`);
  }
}

function buildUserMetadata(candidate) {
  return {
    full_name: candidate.name,
    name: candidate.name,
    operational_profile: "op1",
    role: "operator",
  };
}

function createTemporaryPassword() {
  return `${randomBytes(24).toString("base64url")}Aa1!`;
}

async function listAuthUsers(targetClient) {
  const users = [];

  for (let page = 1; page <= 20; page += 1) {
    const response = await targetClient.auth.admin.listUsers({
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

async function fetchAll(tableName, selectClause) {
  const rows = [];

  for (let from = 0; ; from += 500) {
    const response = await client
      .from(tableName)
      .select(selectClause)
      .range(from, from + 499);

    if (response.error) {
      throw new Error(`${tableName}-read-failed:${response.error.message}`);
    }

    const pageRows = response.data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < 500) {
      break;
    }
  }

  return rows;
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeName(name, email) {
  if (typeof name === "string" && name.trim()) {
    return name.trim();
  }

  if (typeof email === "string" && email.includes("@")) {
    return email.split("@")[0];
  }

  return "";
}

function normalizeStatus(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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

function sanitizeError(message) {
  return message.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
}

function shouldFallbackCreateUser(message) {
  return message.toLowerCase().includes("email rate limit");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
