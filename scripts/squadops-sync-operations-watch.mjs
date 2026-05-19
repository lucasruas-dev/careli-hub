#!/usr/bin/env node
import { createHash } from "node:crypto";
import { watch as watchFile } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const defaultSourcePath = "docs/operations/engineering-operations.md";
const defaultEndpoint =
  "http://localhost:3001/api/squadops/operations/structured";
const defaultIntervalMs = 5 * 60 * 1000;
const defaultDebounceMs = 1_500;
const logPath = resolve(repoRoot, ".codex-logs/squadops-sync-watch.log");

const args = parseArgs(process.argv.slice(2));
const sourceFile = resolve(repoRoot, args.file || defaultSourcePath);
const endpoint = args.endpoint || process.env.SQUADOPS_SYNC_ENDPOINT || defaultEndpoint;
const bearer =
  args.bearer ??
  process.env.SQUADOPS_SYNC_BEARER ??
  process.env.SQUADOPS_ADMIN_BEARER ??
  "";
const intervalMs = args.intervalMs ?? readNumberEnv("SQUADOPS_SYNC_INTERVAL_MS") ?? defaultIntervalMs;
const debounceMs = args.debounceMs ?? defaultDebounceMs;
const watchMode = args.watch || !args.once;

let lastSyncedHash = "";
let syncRunning = false;
let syncQueued = false;
let debounceTimer = null;

await ensureSafeConfiguration();

if (args.dryRun) {
  const hash = await hashFile(sourceFile);
  await log(
    `dry-run ok | file=${relativeSource()} | hash=${hash.slice(
      0,
      12,
    )} | endpoint=${endpoint}`,
  );
  process.exit(0);
}

if (!watchMode) {
  const ok = await syncIfChanged("manual", { force: true });
  process.exit(ok ? 0 : 1);
}

await log(
  `watch started | file=${relativeSource()} | endpoint=${endpoint} | intervalMs=${intervalMs}`,
);
await syncIfChanged("startup", { force: true });

const watcher = watchFile(sourceFile, { persistent: true }, () => {
  scheduleSync("file-change");
});

const interval = setInterval(() => {
  scheduleSync("interval");
}, intervalMs);

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function shutdown(signal) {
  clearInterval(interval);
  clearTimeout(debounceTimer);
  watcher.close();
  void log(`watch stopped | signal=${signal}`).finally(() => process.exit(0));
}

function scheduleSync(reason) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void syncIfChanged(reason);
  }, debounceMs);
}

async function syncIfChanged(reason, options = {}) {
  if (syncRunning) {
    syncQueued = true;
    return false;
  }

  syncRunning = true;

  try {
    const currentHash = await hashFile(sourceFile);

    if (!options.force && currentHash === lastSyncedHash) {
      await log(`skip | reason=${reason} | unchanged`);
      return true;
    }

    const content = await readFile(sourceFile, "utf8");
    const startedAt = Date.now();
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        action: "sync-markdown-content",
        content,
        sourcePath: relativeSource().replace(/\\/g, "/"),
      }),
      cache: "no-store",
      headers: buildHeaders(),
      method: "POST",
    });
    const payload = await readResponseJson(response);
    const elapsedMs = Date.now() - startedAt;

    if (!response.ok) {
      await log(
        `sync failed | reason=${reason} | status=${response.status} | elapsedMs=${elapsedMs} | error=${safeError(payload)}`,
      );
      return false;
    }

    lastSyncedHash = currentHash;

    const storage = payload?.storage ?? {};
    await log(
      [
        `sync ok | reason=${reason}`,
        `elapsedMs=${elapsedMs}`,
        `recordsTotal=${valueOrDash(storage.recordsTotal)}`,
        `recordsUpserted=${valueOrDash(storage.recordsUpserted)}`,
        `releasesUpserted=${valueOrDash(storage.releasesUpserted)}`,
        `mode=content-upload`,
        `hash=${currentHash.slice(0, 12)}`,
      ].join(" | "),
    );
    return true;
  } catch (error) {
    await log(`sync failed | reason=${reason} | error=${formatSyncError(error)}`);
    return false;
  } finally {
    syncRunning = false;

    if (syncQueued) {
      syncQueued = false;
      scheduleSync("queued");
    }
  }
}

function buildHeaders() {
  const headers = {
    "Content-Type": "application/json",
  };

  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }

  return headers;
}

async function ensureSafeConfiguration() {
  await hashFile(sourceFile);

  if (!isLocalEndpoint(endpoint) && !bearer) {
    throw new Error(
      "Endpoint remoto exige SQUADOPS_SYNC_BEARER. Para sincronizar arquivo local, use o endpoint local padrao com o Hub dev rodando.",
    );
  }
}

function isLocalEndpoint(value) {
  try {
    const url = new URL(value);

    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  const buffer = await readFile(filePath);

  return createHash("sha256").update(buffer).digest("hex");
}

async function readResponseJson(response) {
  const text = await response.text().catch(() => "");

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 240) };
  }
}

async function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);

  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${line}\n`, "utf8");
  } catch {
    // Logging must never stop the watcher.
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    bearer: "",
    debounceMs: null,
    dryRun: false,
    endpoint: "",
    file: "",
    intervalMs: null,
    once: false,
    watch: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--once") {
      parsed.once = true;
      continue;
    }

    if (arg === "--watch") {
      parsed.watch = true;
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--file") {
      parsed.file = rawArgs[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--endpoint") {
      parsed.endpoint = rawArgs[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--bearer") {
      parsed.bearer = rawArgs[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--interval-ms") {
      parsed.intervalMs = readNumber(rawArgs[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--debounce-ms") {
      parsed.debounceMs = readNumber(rawArgs[index + 1]);
      index += 1;
    }
  }

  return parsed;
}

function readNumberEnv(name) {
  return readNumber(process.env[name]);
}

function readNumber(value) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function relativeSource() {
  return sourceFile.replace(`${repoRoot}\\`, "").replace(`${repoRoot}/`, "");
}

function safeError(payload) {
  if (!payload) {
    return "sem corpo de resposta";
  }

  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  return "erro nao informado";
}

function valueOrDash(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatSyncError(error) {
  const message = getErrorMessage(error);

  if (message === "fetch failed" && isLocalEndpoint(endpoint)) {
    return "Hub local indisponivel; inicie npm.cmd run dev --workspace @repo/hub para importar o arquivo local";
  }

  return message;
}
