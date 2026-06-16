#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_ALLOWED_DOMAINS = ["https://c2x.app.br", "https://ops.c2x.app.br"];

const FORBIDDEN_PACKAGE_PATTERNS = [
  /(^|\/)\.env($|[./])/i,
  /(^|\/)\.git($|\/)/i,
  /(^|\/)\.next($|\/)/i,
  /(^|\/)\.turbo($|\/)/i,
  /(^|\/)\.vercel($|\/)/i,
  /(^|\/)node_modules($|\/)/i,
  /(^|\/)coverage($|\/)/i,
  /(^|\/)dist($|\/)/i,
  /\.log$/i,
];

const HELP = `
Panteon production recorte gate

Uso:
  node scripts/panteon-production-recorte-gate.mjs --manifest docs/operations/<manifest>.json
  node scripts/panteon-production-recorte-gate.mjs --self-test
  node scripts/panteon-production-recorte-gate.mjs --init

Regra central:
  Producao = pacote base validado em producao + recorte aprovado.
  Qualquer arquivo fora de allowedChangedPaths bloqueia o deploy.
`;

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern);
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function matchesPattern(relativePath, pattern) {
  const rel = normalizePath(relativePath);
  const normalized = normalizePath(pattern);
  if (!normalized) {
    return false;
  }
  if (normalized.endsWith("/**")) {
    const prefix = normalized.slice(0, -3).replace(/\/$/, "");
    return rel === prefix || rel.startsWith(`${prefix}/`);
  }
  if (normalized.includes("*")) {
    return globToRegExp(normalized).test(rel);
  }
  return rel === normalized;
}

function matchesAny(relativePath, patterns) {
  return (patterns || []).some((pattern) => matchesPattern(relativePath, pattern));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function isForbiddenPackagePath(relativePath) {
  const rel = normalizePath(relativePath);
  return FORBIDDEN_PACKAGE_PATTERNS.some((pattern) => pattern.test(rel));
}

function collectPackageFiles(rootPath) {
  const files = new Map();
  const forbidden = [];
  const resolvedRoot = path.resolve(rootPath);

  function walk(currentPath, prefix = "") {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const relativePath = normalizePath(path.posix.join(prefix, entry.name));
      const absolutePath = path.join(currentPath, entry.name);

      if (entry.isSymbolicLink()) {
        forbidden.push({ path: relativePath, reason: "symlink" });
        continue;
      }

      if (isForbiddenPackagePath(relativePath)) {
        forbidden.push({ path: relativePath, reason: "forbidden artifact" });
        continue;
      }

      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
        continue;
      }

      if (entry.isFile()) {
        files.set(relativePath, sha256(absolutePath));
      }
    }
  }

  walk(resolvedRoot);
  return { files, forbidden };
}

function diffPackages(baseFiles, candidateFiles) {
  const allPaths = new Set([...baseFiles.keys(), ...candidateFiles.keys()]);
  const changes = [];
  for (const relativePath of [...allPaths].sort()) {
    const baseHash = baseFiles.get(relativePath);
    const candidateHash = candidateFiles.get(relativePath);
    if (!baseHash && candidateHash) {
      changes.push({ path: relativePath, type: "added" });
    } else if (baseHash && !candidateHash) {
      changes.push({ path: relativePath, type: "deleted" });
    } else if (baseHash !== candidateHash) {
      changes.push({ path: relativePath, type: "modified" });
    }
  }
  return changes;
}

function isGitCommit(value) {
  return /^[0-9a-f]{7,40}$/i.test(String(value || ""));
}

function isDeploymentId(value) {
  return /^dpl_[A-Za-z0-9]+$/.test(String(value || ""));
}

function assertDirectory(label, value, failures) {
  if (!value) {
    failures.push(`${label} ausente.`);
    return null;
  }
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    failures.push(`${label} nao existe ou nao e diretorio: ${value}`);
    return null;
  }
  return resolved;
}

function readCandidateFile(candidateRoot, markerPath, failures) {
  const relativePath = normalizePath(markerPath);
  const absolutePath = path.join(candidateRoot, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    failures.push(`Marcador aponta para arquivo inexistente: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function runGate(manifest, options = {}) {
  const failures = [];
  const warnings = [];
  const changes = [];

  if (!manifest || typeof manifest !== "object") {
    failures.push("Manifesto invalido.");
    return { failures, warnings, changes };
  }

  const allowedDomains = Array.isArray(manifest.allowedDomains) && manifest.allowedDomains.length
    ? manifest.allowedDomains
    : DEFAULT_ALLOWED_DOMAINS;

  const requiredTextFields = [
    "protocolId",
    "module",
    "domain",
    "currentProductionDeploymentId",
    "rollbackDeploymentId",
    "candidateSourceCommit",
  ];

  for (const field of requiredTextFields) {
    if (!String(manifest[field] || "").trim()) {
      failures.push(`${field} ausente.`);
    }
  }

  if (manifest.domain && !allowedDomains.includes(manifest.domain)) {
    failures.push(`Dominio nao autorizado no gate: ${manifest.domain}`);
  }

  if (manifest.currentProductionDeploymentId && !isDeploymentId(manifest.currentProductionDeploymentId)) {
    failures.push("currentProductionDeploymentId precisa ser um deployment id Vercel dpl_*.");
  }

  if (manifest.rollbackDeploymentId && !isDeploymentId(manifest.rollbackDeploymentId)) {
    failures.push("rollbackDeploymentId precisa ser um deployment id Vercel dpl_*.");
  }

  if (manifest.candidateSourceCommit && !isGitCommit(manifest.candidateSourceCommit)) {
    failures.push("candidateSourceCommit precisa ser um SHA de commit Git.");
  }

  if (manifest.sourceWorktreeClean !== true) {
    failures.push("sourceWorktreeClean precisa ser true. Worktree sujo nao pode publicar producao.");
  }

  if (!Array.isArray(manifest.allowedChangedPaths) || manifest.allowedChangedPaths.length === 0) {
    failures.push("allowedChangedPaths precisa listar o recorte aprovado.");
  }

  const baseRoot = assertDirectory("basePackagePath", manifest.basePackagePath, failures);
  const candidateRoot = assertDirectory("candidatePackagePath", manifest.candidatePackagePath, failures);

  if (baseRoot && candidateRoot && baseRoot === candidateRoot) {
    failures.push("basePackagePath e candidatePackagePath nao podem apontar para o mesmo diretorio.");
  }

  if (failures.length) {
    return { failures, warnings, changes };
  }

  const basePackage = collectPackageFiles(baseRoot);
  const candidatePackage = collectPackageFiles(candidateRoot);

  for (const item of [...basePackage.forbidden, ...candidatePackage.forbidden]) {
    failures.push(`Artefato proibido no pacote: ${item.path} (${item.reason}).`);
  }

  changes.push(...diffPackages(basePackage.files, candidatePackage.files));

  if (changes.length === 0) {
    failures.push("Nenhuma mudanca detectada entre base validada e candidato.");
  }

  for (const change of changes) {
    if (!matchesAny(change.path, manifest.allowedChangedPaths)) {
      failures.push(`Mudanca fora do recorte aprovado: ${change.path} (${change.type}).`);
    }
    if (matchesAny(change.path, manifest.protectedPaths)) {
      failures.push(`Mudanca em caminho protegido: ${change.path} (${change.type}).`);
    }
    if (matchesAny(change.path, manifest.forbiddenChangedPaths)) {
      failures.push(`Mudanca em caminho explicitamente proibido: ${change.path} (${change.type}).`);
    }
  }

  for (const requiredPath of manifest.requiredPaths || []) {
    const relativePath = normalizePath(requiredPath);
    if (!candidatePackage.files.has(relativePath)) {
      failures.push(`Caminho obrigatorio nao encontrado no candidato: ${relativePath}`);
    }
  }

  for (const marker of manifest.requiredMarkers || []) {
    const contents = readCandidateFile(candidateRoot, marker.path, failures);
    if (contents && !contents.includes(marker.contains)) {
      failures.push(`Marcador obrigatorio ausente em ${normalizePath(marker.path)}.`);
    }
  }

  for (const marker of manifest.forbiddenMarkers || []) {
    const markerPath = normalizePath(marker.path);
    const absolutePath = path.join(candidateRoot, markerPath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      continue;
    }
    const contents = fs.readFileSync(absolutePath, "utf8");
    if (contents.includes(marker.contains)) {
      failures.push(`Marcador proibido encontrado em ${markerPath}.`);
    }
  }

  if (changes.length > 120) {
    warnings.push(`Recorte grande: ${changes.length} arquivos alterados. Reconfirme se ainda e modular.`);
  }

  if (options.strictWarnings && warnings.length) {
    failures.push(...warnings.map((warning) => `Warning tratado como bloqueio: ${warning}`));
  }

  return { failures, warnings, changes };
}

function printResult(result) {
  console.log("Panteon Production Recorte Gate");
  console.log(`Mudancas detectadas: ${result.changes.length}`);
  for (const change of result.changes.slice(0, 80)) {
    console.log(`- ${change.type}: ${change.path}`);
  }
  if (result.changes.length > 80) {
    console.log(`- ... ${result.changes.length - 80} mudancas adicionais`);
  }
  for (const warning of result.warnings) {
    console.log(`Aviso: ${warning}`);
  }
  if (result.failures.length) {
    console.error("Status: BLOQUEADO");
    for (const failure of result.failures) {
      console.error(`- ${failure}`);
    }
    return 1;
  }
  console.log("Status: PASS");
  return 0;
}

function template() {
  return {
    protocolId: "HOME-YYYYMMDD-001-RECORTE",
    module: "Home",
    domain: "https://c2x.app.br",
    currentProductionDeploymentId: "dpl_atual_validado",
    rollbackDeploymentId: "dpl_rollback",
    candidateSourceCommit: "commit_sha_do_worktree_limpo",
    sourceWorktreeClean: true,
    basePackagePath: ".codex-deploy/prod-base",
    candidatePackagePath: ".codex-deploy/prod-candidate",
    allowedChangedPaths: [
      "apps/hub/app/page.tsx",
      "apps/hub/modules/home/**",
      "apps/hub/lib/presence/**"
    ],
    protectedPaths: [
      "apps/hub/app/escritorio-virtual/**",
      "apps/hub/app/ares/**",
      "apps/hub/modules/ares/**",
      "apps/hub/app/api/ares/**"
    ],
    forbiddenChangedPaths: [],
    requiredPaths: [],
    requiredMarkers: [],
    forbiddenMarkers: []
  };
}

function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function assertSelfTest(name, result, expectedPass) {
  const passed = result.failures.length === 0;
  if (passed !== expectedPass) {
    console.error(`Self-test falhou: ${name}`);
    console.error(result.failures.join("\n"));
    process.exit(1);
  }
  console.log(`Self-test PASS: ${name}`);
}

function runSelfTest() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "panteon-recorte-gate-"));
  try {
    const base = path.join(tmpRoot, "base");
    const candidate = path.join(tmpRoot, "candidate");
    const badCandidate = path.join(tmpRoot, "bad-candidate");
    fs.mkdirSync(base, { recursive: true });
    fs.mkdirSync(candidate, { recursive: true });
    fs.mkdirSync(badCandidate, { recursive: true });

    writeFile(path.join(base, "apps/hub/app/page.tsx"), "export default function Page(){return 'prod';}\n");
    writeFile(path.join(candidate, "apps/hub/app/page.tsx"), "export default function Page(){return 'recorte';}\n");
    writeFile(path.join(badCandidate, "apps/hub/app/page.tsx"), "export default function Page(){return 'recorte';}\n");
    writeFile(path.join(badCandidate, "apps/hub/app/escritorio-virtual/page.tsx"), "export default function Escritorio(){return 'nao aprovado';}\n");

    const baseManifest = {
      protocolId: "HOME-20260616-TEST",
      module: "Home",
      domain: "https://c2x.app.br",
      currentProductionDeploymentId: "dpl_1234567890",
      rollbackDeploymentId: "dpl_0987654321",
      candidateSourceCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceWorktreeClean: true,
      basePackagePath: base,
      candidatePackagePath: candidate,
      allowedChangedPaths: ["apps/hub/app/page.tsx"],
      protectedPaths: ["apps/hub/app/escritorio-virtual/**"],
    };

    assertSelfTest("recorte permitido", runGate(baseManifest), true);
    assertSelfTest(
      "escritorio fora do recorte bloqueado",
      runGate({ ...baseManifest, candidatePackagePath: badCandidate }),
      false
    );
    assertSelfTest(
      "worktree sujo bloqueado",
      runGate({ ...baseManifest, sourceWorktreeClean: false }),
      false
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP.trim());
    return 0;
  }
  if (args.includes("--init")) {
    console.log(JSON.stringify(template(), null, 2));
    return 0;
  }
  if (args.includes("--self-test")) {
    runSelfTest();
    return 0;
  }

  const manifestIndex = args.indexOf("--manifest");
  if (manifestIndex === -1 || !args[manifestIndex + 1]) {
    console.error(HELP.trim());
    return 1;
  }

  const manifestPath = path.resolve(args[manifestIndex + 1]);
  const manifest = readJson(manifestPath);
  return printResult(runGate(manifest));
}

process.exitCode = main();
