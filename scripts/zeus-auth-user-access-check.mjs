#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const envFile = readArg("--env-file");
const email = normalizeEmail(readArg("--email"));
const sendRecovery = args.includes("--send-recovery");
const redirectTo = readArg("--redirect-to") ?? "https://homo.c2x.app.br/login";

if (!envFile) {
  fail("Informe --env-file=<arquivo>. Nenhum secret sera impresso.");
}

if (!email) {
  fail("Informe --email=<email>. O e-mail nao sera impresso no resultado.");
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
const publicClient = createClient(url.value, anon.value || serviceRole.value, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
const [authUser, hubUser, atlasCollaborator] = await Promise.all([
  findAuthUserByEmail(email),
  fetchOne("hub_users", "id,email,role,status,display_name", "email", email),
  fetchOne("atlas_collaborators", "id,email,status,name", "email", email),
]);
const result = {
  atlas: summarizeAtlas(atlasCollaborator),
  email: maskEmail(email),
  envSources: {
    anon: anon.name,
    serviceRole: serviceRole.name,
    url: url.name,
  },
  hubUser: summarizeHubUser(hubUser),
  recoverySent: false,
  status: "checked",
  supabaseUrl: maskSupabaseUrl(url.value),
  user: summarizeAuthUser(authUser),
};

if (sendRecovery) {
  if (!authUser) {
    result.status = "blocked-user-not-found";
    result.recommendations = [
      "Usuario nao encontrado no Auth de homologacao; corrigir cadastro antes de enviar recuperacao.",
    ];
  } else {
    const recovery = await publicClient.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (recovery.error) {
      result.status = "recovery-failed";
      result.error = sanitizeError(recovery.error.message);
      result.recommendations = [
        "Recuperacao nao enviada; verificar limite de e-mail do Supabase ou configurar reenvio manual.",
      ];
    } else {
      result.recoverySent = true;
      result.status = "recovery-sent";
      result.recommendations = [
        "Recuperacao de senha enviada pelo Supabase para o e-mail cadastrado.",
      ];
    }
  }
} else {
  result.recommendations = buildRecommendations({
    atlasCollaborator,
    authUser,
    hubUser,
  });
}

console.log(JSON.stringify(result, null, 2));

async function findAuthUserByEmail(targetEmail) {
  for (let page = 1; page <= 20; page += 1) {
    const response = await adminClient.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (response.error) {
      throw new Error(`auth-users-read-failed:${response.error.message}`);
    }

    const user = (response.data.users ?? []).find(
      (candidate) => normalizeEmail(candidate.email) === targetEmail,
    );

    if (user) {
      return user;
    }

    if ((response.data.users ?? []).length < 200) {
      break;
    }
  }

  return null;
}

async function fetchOne(tableName, selectClause, columnName, value) {
  const response = await adminClient
    .from(tableName)
    .select(selectClause)
    .eq(columnName, value)
    .limit(1)
    .maybeSingle();

  if (response.error) {
    throw new Error(`${tableName}-read-failed:${response.error.message}`);
  }

  return response.data ?? null;
}

function buildRecommendations({ atlasCollaborator, authUser, hubUser }) {
  const recommendations = [];

  if (!atlasCollaborator) {
    recommendations.push("E-mail nao encontrado em atlas_collaborators.");
  }

  if (!authUser) {
    recommendations.push("E-mail nao encontrado no Supabase Auth.");
  }

  if (!hubUser) {
    recommendations.push("E-mail nao possui perfil public.hub_users.");
  }

  if (hubUser && hubUser.status !== "active") {
    recommendations.push("Perfil public.hub_users nao esta ativo.");
  }

  if (authUser && hubUser && authUser.id !== hubUser.id) {
    recommendations.push("UUID do Auth difere do perfil public.hub_users.");
  }

  if (authUser && !authUser.email_confirmed_at && !authUser.confirmed_at) {
    recommendations.push("E-mail Auth nao confirmado.");
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Usuario existe e esta alinhado; erro de login aponta para senha invalida ou sessao antiga.",
    );
  }

  return recommendations;
}

function summarizeAuthUser(user) {
  if (!user) {
    return {
      exists: false,
    };
  }

  return {
    confirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
    exists: true,
    hasLastSignIn: Boolean(user.last_sign_in_at),
    idPrefix: typeof user.id === "string" ? user.id.slice(0, 8) : null,
  };
}

function summarizeHubUser(user) {
  if (!user) {
    return {
      exists: false,
    };
  }

  return {
    exists: true,
    idPrefix: typeof user.id === "string" ? user.id.slice(0, 8) : null,
    role: user.role ?? null,
    status: user.status ?? null,
  };
}

function summarizeAtlas(user) {
  if (!user) {
    return {
      exists: false,
    };
  }

  return {
    exists: true,
    status: user.status ?? null,
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
