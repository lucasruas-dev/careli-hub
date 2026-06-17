#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_FORBIDDEN_PACKAGE_PATTERNS = [
  /(^|\/)\.env($|\.local$|\.production$|\.development$|\.preview$|\.homolog$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.vercel(\/|$)/i,
  /(^|\/)\.next(\/|$)/i,
  /(^|\/)\.turbo(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
];

const MODULE_DOMAIN_RULES = {
  zeus: "https://ops.c2x.app.br",
  squadops: "https://ops.c2x.app.br",
};

const DEFAULT_NON_ZEUS_DOMAIN = "https://c2x.app.br";

function usage() {
  console.log(`Production Module Safety Gate

Uso:
  node scripts/production-module-safety-gate.mjs --manifest <arquivo.json>

Opcoes:
  --manifest <path>   Manifesto do gate de producao modular.
  --init              Imprime um manifesto exemplo.
  --self-test         Executa um cenario local PASS/BLOQUEADO sintetico.
  --help              Mostra esta ajuda.
`);
}

function exampleManifest() {
  console.log(JSON.stringify({
    schemaVersion: "panteon.production-module-safety-gate.v1",
    protocolId: "HERMES-YYYYMMDD-001-EXAMPLE",
    module: "hermes",
    domain: "https://c2x.app.br",
    currentProductionDeploymentId: "dpl_atual_do_dominio",
    candidateSourceCommit: "0123456789abcdef0123456789abcdef01234567",
    sourceWorktreeClean: true,
    rollbackDeploymentId: "dpl_rollback_conhecido",
    addressManifest: "docs/operations/panteon-address-recorte-template.json",
    addressCheckFiles: [
      "apps/hub/components/pulsex/pulsex-workspace.tsx",
      "apps/hub/lib/pulsex/messages.ts",
    ],
    basePackagePath: ".codex-deploy/base-producao-atual",
    candidatePackagePath: ".codex-deploy/candidato-hermes",
    allowedChangedPaths: [
      "apps/hub/app/hermes/**",
      "apps/hub/app/api/hermes/**",
      "apps/hub/components/pulsex/**",
      "apps/hub/lib/pulsex/**",
      "docs/operations/**",
    ],
    protectedPaths: [
      "apps/hub/modules/chronos/**",
      "apps/hub/app/chronos/**",
      "apps/hub/app/api/chronos/**",
      "apps/hub/lib/chronos/**",
    ],
    ignoredPaths: [
      "docs/operations/engineering-operations.md",
      "docs/operations/releases-production.md",
    ],
    requiredMarkers: [
      {
        path: "apps/hub/modules/chronos/ChronosPage.tsx",
        includes: ["ChronosAgendaScreen", "ChronosDriveLibraryScreen"],
      },
    ],
    forbiddenMarkers: [
      {
        path: "apps/hub/modules/chronos/ChronosPage.tsx",
        includes: ["v1 executiva"],
      },
    ],
    requiredPaths: [
      "apps/hub/modules/chronos/components/chronos-agenda-screen.tsx",
      "apps/hub/modules/chronos/components/chronos-drive-library-screen.tsx",
    ],
  }, null, 2));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
    } else if (arg === "--init") {
      options.init = true;
    } else if (arg === "--self-test") {
      options.selfTest = true;
    } else if (arg === "--manifest") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Opcao --manifest exige caminho.");
      }
      options.manifestPath = value;
      index += 1;
    } else {
      throw new Error(`Opcao desconhecida: ${arg}`);
    }
  }
  return options;
}

function writeFixtureFile(root, relativePath, content) {
  const absolutePath = path.resolve(root, normalizePath(relativePath));
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function runSelfTest() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "panteon-prod-gate-"));
  const baseRoot = path.join(tempRoot, "base");
  const candidateRoot = path.join(tempRoot, "candidate");
  try {
    const chronos = [
      "import { ChronosAgendaScreen } from './components/chronos-agenda-screen';",
      "import { ChronosDriveLibraryScreen } from './components/chronos-drive-library-screen';",
      "export function ChronosPage() { return null; }",
    ].join("\n");
    writeFixtureFile(baseRoot, "apps/hub/modules/chronos/ChronosPage.tsx", chronos);
    writeFixtureFile(candidateRoot, "apps/hub/modules/chronos/ChronosPage.tsx", chronos);
    writeFixtureFile(baseRoot, "apps/hub/modules/chronos/components/chronos-agenda-screen.tsx", "export const ChronosAgendaScreen = null;\n");
    writeFixtureFile(candidateRoot, "apps/hub/modules/chronos/components/chronos-agenda-screen.tsx", "export const ChronosAgendaScreen = null;\n");
    writeFixtureFile(baseRoot, "apps/hub/modules/chronos/components/chronos-drive-library-screen.tsx", "export const ChronosDriveLibraryScreen = null;\n");
    writeFixtureFile(candidateRoot, "apps/hub/modules/chronos/components/chronos-drive-library-screen.tsx", "export const ChronosDriveLibraryScreen = null;\n");
    writeFixtureFile(baseRoot, "apps/hub/components/pulsex/pulsex-workspace.tsx", "export const version = 1;\n");
    writeFixtureFile(candidateRoot, "apps/hub/components/pulsex/pulsex-workspace.tsx", "export const version = 2;\n");
    const addressManifestPath = path.join(tempRoot, "hermes-address-manifest.json");
    writeFileSync(addressManifestPath, JSON.stringify({
      schemaVersion: "panteon.address-recorte.v1",
      deploymentManifestId: "PNT-DEP-HERMES-SELFTEST-001",
      protocolId: "HERMES-SELFTEST-001-WORKSPACE",
      title: "Self-test CEP Hermes / Workspace",
      module: "hermes",
      agent: "Zeus",
      status: "SELF_TEST",
      riskLevel: "BAIXO",
      approvedBy: "Lucas aprovou self-test local documental",
      addressing: {
        cityAddressCode: "PNT-01-00-00-000",
        cityAddressId: "PNT-CID-01",
        districtAddressCode: "PNT-01-30-00-000",
        districtAddressId: "PNT-BRR-HERMES-01",
        streetAddressCode: "PNT-01-30-10-000",
        streetAddressId: "PNT-RUA-HERMES-WORKSPACE-01",
        houseAddressCodes: ["PNT-01-30-10-001"],
        houseAddressIds: ["PNT-CASA-HERMES-WORKSPACE-SCREEN-001"],
        registryFile: "docs/operations/panteon-address-registry.json",
        scopeSummary: "Self-test local do Safety Gate de producao para recorte Hermes/PulseX.",
      },
      baseline: {
        productionDomain: "https://c2x.app.br",
        expectedProductionDeploymentId: "dpl_selftest_base",
        rollbackDeploymentId: "dpl_selftest_rollback",
      },
      scope: {
        includedFiles: ["apps/hub/components/pulsex/pulsex-workspace.tsx"],
        allowedChangedPaths: [
          "apps/hub/components/pulsex/pulsex-workspace.tsx",
          "apps/hub/components/pulsex/**",
          "apps/hub/lib/pulsex/**",
          "docs/operations/**",
        ],
        protectedPaths: [
          "apps/hub/modules/chronos/**",
          "apps/hub/modules/guardian/**",
          "apps/hub/modules/caredesk/**",
        ],
        requiredMarkers: [{
          path: "apps/hub/components/pulsex/pulsex-workspace.tsx",
          includes: ["Hermes"],
        }],
        forbiddenMarkers: [],
        sensitiveOperations: [],
      },
    }, null, 2));

    const passManifest = {
      protocolId: "SELFTEST-PASS",
      module: "hermes",
      domain: "https://c2x.app.br",
      currentProductionDeploymentId: "dpl_base",
      candidateSourceCommit: "0123456789abcdef0123456789abcdef01234567",
      sourceWorktreeClean: true,
      rollbackDeploymentId: "dpl_rollback",
      addressManifest: addressManifestPath,
      addressCheckFiles: [
        "apps/hub/components/pulsex/pulsex-workspace.tsx",
      ],
      basePackagePath: baseRoot,
      candidatePackagePath: candidateRoot,
      allowedChangedPaths: ["apps/hub/components/pulsex/**"],
      protectedPaths: ["apps/hub/modules/chronos/**"],
      requiredMarkers: [{
        path: "apps/hub/modules/chronos/ChronosPage.tsx",
        includes: ["ChronosAgendaScreen", "ChronosDriveLibraryScreen"],
      }],
      forbiddenMarkers: [{
        path: "apps/hub/modules/chronos/ChronosPage.tsx",
        includes: ["v1 executiva"],
      }],
      requiredPaths: [
        "apps/hub/modules/chronos/components/chronos-agenda-screen.tsx",
        "apps/hub/modules/chronos/components/chronos-drive-library-screen.tsx",
      ],
    };
    const passResult = runGate(passManifest);
    if (passResult.failures.length > 0) {
      throw new Error(`Self-test PASS falhou: ${passResult.failures.join("; ")}`);
    }

    const noCommitResult = runGate({
      ...passManifest,
      protocolId: "SELFTEST-NO-COMMIT",
      candidateSourceCommit: "",
    });
    if (!noCommitResult.failures.some((failure) => failure.includes("candidateSourceCommit"))) {
      throw new Error("Self-test BLOQUEADO falhou: gate nao bloqueou manifesto sem commit limpo.");
    }

    writeFixtureFile(candidateRoot, "apps/hub/modules/chronos/ChronosPage.tsx", "export const label = 'v1 executiva';\n");
    const blockedResult = runGate({ ...passManifest, protocolId: "SELFTEST-BLOCKED" });
    if (blockedResult.failures.length === 0) {
      throw new Error("Self-test BLOQUEADO falhou: gate nao bloqueou regressao em Chronos.");
    }

    console.log("Self-test PASS: mudanca Hermes preservando Chronos foi aceita.");
    console.log("Self-test BLOQUEADO: manifesto sem commit limpo foi bloqueado.");
    console.log("Self-test BLOQUEADO: regressao Chronos foi bloqueada.");
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .trim();
}

function resolveFromCwd(value) {
  return path.resolve(process.cwd(), String(value || ""));
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function hasGlobPattern(value) {
  return /[*?]/.test(String(value || ""));
}

function collectAddressCheckFiles(manifest, changedFiles) {
  const explicitFiles = asArray(manifest.addressCheckFiles)
    .map(normalizePath)
    .filter(Boolean)
    .filter((file) => !hasGlobPattern(file));

  if (explicitFiles.length > 0) {
    return [...new Set(explicitFiles)];
  }

  return [...new Set((changedFiles || [])
    .map(normalizePath)
    .filter(Boolean)
    .filter((file) => !hasGlobPattern(file)))];
}

function getAddressManifestPath(manifest) {
  return String(
    manifest.addressManifest
      || manifest.addressRecorteManifest
      || manifest.addressManifestPath
      || "",
  ).trim();
}

function checkAddressManifestConfigured(manifest, failures) {
  const addressManifest = getAddressManifestPath(manifest);
  if (!addressManifest) {
    failures.push("addressManifest e obrigatorio; producao exige CEP operacional do recorte.");
    return "";
  }
  if (!existsSync(resolveFromCwd(addressManifest))) {
    failures.push(`addressManifest nao encontrado: ${addressManifest}`);
    return "";
  }
  return addressManifest;
}

function runAddressPreflight(manifest, changedFiles) {
  const failures = [];
  const warnings = [];
  const addressManifest = getAddressManifestPath(manifest);
  const files = collectAddressCheckFiles(manifest, changedFiles);
  const args = [
    "scripts/panteon-address-recorte-check.mjs",
    "--manifest",
    addressManifest,
  ];

  if (manifest.addressRegistry) {
    args.push("--registry", String(manifest.addressRegistry));
  }
  if (files.length > 0) {
    args.push("--files", files.join(";"));
  } else {
    warnings.push("CEP preflight sem addressCheckFiles ou diff concreto; registre os arquivos antes de produzir.");
  }

  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();

  if (result.error) {
    failures.push(`Falha ao executar CEP preflight: ${result.error.message}`);
  } else if (result.status !== 0) {
    failures.push(`CEP preflight retornou BLOQUEADO para ${addressManifest}:\n${output || "sem saida"}`);
  } else {
    warnings.push(`CEP preflight PASS: ${addressManifest}.`);
  }

  return { failures, warnings };
}

function readJson(filePath) {
  const absolutePath = resolveFromCwd(filePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Manifesto nao encontrado: ${absolutePath}`);
  }
  return JSON.parse(readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, ""));
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern);
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesAny(relativePath, patterns) {
  const normalized = normalizePath(relativePath);
  return (patterns || []).some((pattern) => {
    const normalizedPattern = normalizePath(pattern);
    if (!normalizedPattern) {
      return false;
    }
    if (normalizedPattern.endsWith("/**")) {
      const prefix = normalizedPattern.slice(0, -3);
      return normalized === prefix || normalized.startsWith(`${prefix}/`);
    }
    return globToRegExp(normalizedPattern).test(normalized);
  });
}

function assertInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function listFiles(root, relativePrefix = "") {
  const absoluteRoot = path.resolve(root);
  const current = path.resolve(absoluteRoot, relativePrefix);
  if (!existsSync(current)) {
    return [];
  }

  const entries = readdirSync(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = normalizePath(path.join(relativePrefix, entry.name));
    if (DEFAULT_FORBIDDEN_PACKAGE_PATTERNS.some((pattern) => pattern.test(relativePath))) {
      files.push({ forbidden: true, path: relativePath });
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...listFiles(absoluteRoot, relativePath));
    } else if (entry.isFile()) {
      files.push({ path: relativePath });
    }
  }
  return files;
}

function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function buildFileMap(root) {
  const map = new Map();
  const forbidden = [];
  for (const file of listFiles(root)) {
    if (file.forbidden) {
      forbidden.push(file.path);
      continue;
    }
    const absolutePath = path.resolve(root, file.path);
    if (!assertInside(path.resolve(root), absolutePath)) {
      forbidden.push(file.path);
      continue;
    }
    map.set(file.path, hashFile(absolutePath));
  }
  return { forbidden, map };
}

function diffMaps(baseMap, candidateMap) {
  const paths = new Set([...baseMap.keys(), ...candidateMap.keys()]);
  const changes = [];
  for (const relativePath of [...paths].sort()) {
    const baseHash = baseMap.get(relativePath);
    const candidateHash = candidateMap.get(relativePath);
    if (baseHash === candidateHash) {
      continue;
    }
    changes.push({
      path: relativePath,
      type: baseHash ? (candidateHash ? "modified" : "deleted") : "added",
    });
  }
  return changes;
}

function checkPathExists(root, relativePath) {
  const normalized = normalizePath(relativePath);
  const absolutePath = path.resolve(root, normalized);
  if (!assertInside(path.resolve(root), absolutePath)) {
    return false;
  }
  return existsSync(absolutePath);
}

function readCandidateFile(root, relativePath) {
  const normalized = normalizePath(relativePath);
  const absolutePath = path.resolve(root, normalized);
  if (!assertInside(path.resolve(root), absolutePath) || !existsSync(absolutePath)) {
    return null;
  }
  const stats = statSync(absolutePath);
  if (!stats.isFile()) {
    return null;
  }
  return readFileSync(absolutePath, "utf8");
}

function expectedDomainForModule(moduleName) {
  const normalized = String(moduleName || "").toLowerCase();
  return MODULE_DOMAIN_RULES[normalized] || DEFAULT_NON_ZEUS_DOMAIN;
}

function isLikelyGitCommit(value) {
  return /^[a-f0-9]{7,64}$/i.test(String(value || "").trim());
}

function runGate(manifest) {
  const failures = [];
  const warnings = [];

  const moduleName = manifest.module;
  const expectedDomain = expectedDomainForModule(moduleName);
  if (!manifest.domain) {
    failures.push("domain e obrigatorio no manifesto.");
  } else if (manifest.domain !== expectedDomain && !manifest.allowCrossDomain) {
    failures.push(`Dominio ${manifest.domain} nao permitido para modulo ${moduleName}; esperado ${expectedDomain}.`);
  }

  if (!manifest.protocolId) {
    failures.push("protocolId e obrigatorio.");
  }
  if (!manifest.currentProductionDeploymentId) {
    failures.push("currentProductionDeploymentId e obrigatorio.");
  }
  if (!manifest.rollbackDeploymentId) {
    failures.push("rollbackDeploymentId e obrigatorio.");
  }
  if (!manifest.candidateSourceCommit) {
    failures.push("candidateSourceCommit e obrigatorio para producao; nada sobe sem commit limpo.");
  } else if (!isLikelyGitCommit(manifest.candidateSourceCommit)) {
    failures.push("candidateSourceCommit deve ser um SHA de Git valido do recorte limpo.");
  }
  if (manifest.sourceWorktreeClean !== true) {
    failures.push("sourceWorktreeClean deve ser true; producao sem fonte limpa fica BLOQUEADO.");
  }
  checkAddressManifestConfigured(manifest, failures);

  const baseRoot = resolveFromCwd(manifest.basePackagePath);
  const candidateRoot = resolveFromCwd(manifest.candidatePackagePath);
  if (!existsSync(baseRoot)) {
    failures.push(`basePackagePath nao encontrado: ${baseRoot}`);
  }
  if (!existsSync(candidateRoot)) {
    failures.push(`candidatePackagePath nao encontrado: ${candidateRoot}`);
  }
  if (failures.length > 0) {
    return { changes: [], failures, warnings };
  }

  const base = buildFileMap(baseRoot);
  const candidate = buildFileMap(candidateRoot);
  for (const forbiddenPath of candidate.forbidden) {
    failures.push(`Pacote candidato contem caminho proibido: ${forbiddenPath}`);
  }

  const changes = diffMaps(base.map, candidate.map);
  const ignoredPaths = manifest.ignoredPaths || [];
  const allowedChangedPaths = manifest.allowedChangedPaths || [];
  const protectedPaths = manifest.protectedPaths || [];
  const addressPreflight = runAddressPreflight(manifest, changes.map((change) => change.path));
  failures.push(...addressPreflight.failures);
  warnings.push(...addressPreflight.warnings);

  for (const change of changes) {
    if (matchesAny(change.path, ignoredPaths)) {
      continue;
    }
    if (matchesAny(change.path, protectedPaths)) {
      failures.push(`Mudanca em caminho protegido (${change.type}): ${change.path}`);
      continue;
    }
    if (!matchesAny(change.path, allowedChangedPaths)) {
      failures.push(`Mudanca fora do modulo autorizado (${change.type}): ${change.path}`);
    }
  }

  for (const requiredPath of manifest.requiredPaths || []) {
    if (!checkPathExists(candidateRoot, requiredPath)) {
      failures.push(`Caminho obrigatorio ausente no candidato: ${requiredPath}`);
    }
  }

  for (const marker of manifest.requiredMarkers || []) {
    const content = readCandidateFile(candidateRoot, marker.path);
    if (content === null) {
      failures.push(`Arquivo de marcador obrigatorio ausente: ${marker.path}`);
      continue;
    }
    for (const expected of marker.includes || []) {
      if (!content.includes(expected)) {
        failures.push(`Marcador obrigatorio ausente em ${marker.path}: ${expected}`);
      }
    }
  }

  for (const marker of manifest.forbiddenMarkers || []) {
    const content = readCandidateFile(candidateRoot, marker.path);
    if (content === null) {
      continue;
    }
    for (const forbidden of marker.includes || []) {
      if (content.includes(forbidden)) {
        failures.push(`Marcador proibido encontrado em ${marker.path}: ${forbidden}`);
      }
    }
  }

  return { changes, failures, warnings };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (options.init) {
    exampleManifest();
    return;
  }
  if (options.selfTest) {
    runSelfTest();
    return;
  }
  if (!options.manifestPath) {
    throw new Error("Use --manifest <arquivo.json>.");
  }

  const manifest = readJson(options.manifestPath);
  const result = runGate(manifest);

  console.log(`Production Module Safety Gate - ${manifest.protocolId || "sem-protocolo"}`);
  console.log(`Modulo: ${manifest.module || "-"}`);
  console.log(`Dominio: ${manifest.domain || "-"}`);
  console.log(`Mudancas detectadas: ${result.changes.length}`);

  if (result.warnings.length > 0) {
    console.log("\nAvisos:");
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }

  if (result.failures.length > 0) {
    console.log("\nStatus: BLOQUEADO");
    for (const failure of result.failures) {
      console.log(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("\nStatus: PASS");
  console.log("Deploy modular pode seguir somente se as demais validacoes do protocolo tambem passaram e Lucas autorizou producao.");
}

try {
  main();
} catch (error) {
  console.error(`Status: BLOQUEADO\n- ${error.message}`);
  process.exitCode = 1;
}
