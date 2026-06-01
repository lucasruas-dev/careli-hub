#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_BOUNDARY_MANIFEST = "docs/operations/panteon-module-boundary-manifest-v1.json";
const DEFAULT_RECORTE_MANIFEST = "docs/operations/panteon-recorte-manifest-template.json";

const FORBIDDEN_PATH_PATTERNS = [
  ".env",
  ".env.*",
  ".vercel/**",
  ".git/**",
  "node_modules/**",
  ".next/**",
  ".turbo/**"
];

const VALID_RISK_LEVELS = new Set(["BAIXO", "MEDIO", "ALTO", "CRITICO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const VALID_STATUSES = new Set([
  "DRAFT",
  "PREPARADO",
  "VALIDADO_LOCAL",
  "BLOQUEADO",
  "PRONTO_PARA_HOMO",
  "EM_HOMOLOGACAO",
  "HOMOLOGADO",
  "PRONTO_PARA_PRODUCAO",
  "EM_PRODUCAO",
  "CANCELADO"
]);
const APPROVAL_REQUIRED_STATUSES = new Set([
  "PRONTO_PARA_HOMO",
  "EM_HOMOLOGACAO",
  "HOMOLOGADO",
  "PRONTO_PARA_PRODUCAO",
  "EM_PRODUCAO"
]);

function usage() {
  return [
    "Uso:",
    "  node scripts/panteon-recorte-manifest-check.mjs --manifest <arquivo>",
    "  node scripts/panteon-recorte-manifest-check.mjs --self-test",
    "",
    "Opcoes:",
    `  --manifest <arquivo>   Manifesto de recorte. Default: ${DEFAULT_RECORTE_MANIFEST}`,
    `  --boundary <arquivo>   Manifesto de fronteira. Default: ${DEFAULT_BOUNDARY_MANIFEST}`,
    "  --self-test            Roda um caso valido e um caso bloqueado embutidos.",
    "  --help                 Mostra esta ajuda."
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    manifestPath: DEFAULT_RECORTE_MANIFEST,
    boundaryPath: DEFAULT_BOUNDARY_MANIFEST,
    selfTest: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      options.manifestPath = argv[index + 1];
      index += 1;
    } else if (arg === "--boundary") {
      options.boundaryPath = argv[index + 1];
      index += 1;
    } else if (arg === "--self-test") {
      options.selfTest = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Opcao desconhecida: ${arg}`);
    }
  }

  return options;
}

function readJson(filePath) {
  const absolutePath = path.resolve(filePath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  return JSON.parse(raw);
}

function toArray(value) {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function normalizePath(filePath) {
  return String(filePath).replace(/\\/g, "/").replace(/^\.?\//, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern);
  let expression = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "*" && next === "*") {
      expression += ".*";
      index += 1;
    } else if (char === "*") {
      expression += "[^/]*";
    } else if (char === "?") {
      expression += "[^/]";
    } else {
      expression += escapeRegExp(char);
    }
  }

  return new RegExp(`^${expression}$`);
}

function matchesPattern(filePath, pattern) {
  const normalizedPath = normalizePath(filePath);
  const normalizedPattern = normalizePath(pattern);

  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }

  return globToRegExp(normalizedPattern).test(normalizedPath);
}

function matchesAnyPattern(filePath, patterns) {
  return patterns.some((pattern) => matchesPattern(filePath, pattern));
}

function getBoundaryEntries(boundaryManifest) {
  const entries = [
    ...toArray(boundaryManifest.modules),
    ...toArray(boundaryManifest.entries),
    ...toArray(boundaryManifest.hubModules),
    ...toArray(boundaryManifest.operationalLayers)
  ];

  if (!Array.isArray(entries)) {
    throw new Error("Manifesto de fronteira invalido: esperado array em modules ou entries.");
  }

  return entries;
}

function getEntryId(entry) {
  return entry.id ?? entry.module ?? entry.name;
}

function getEntryPatterns(entry) {
  return [
    ...toArray(entry.paths),
    ...toArray(entry.ownedPaths),
    ...toArray(entry.allowedPaths),
    ...toArray(entry.files)
  ].filter(Boolean);
}

function findOwnerForPath(filePath, entries) {
  for (const entry of entries) {
    const patterns = getEntryPatterns(entry);
    if (matchesAnyPattern(filePath, patterns)) {
      return entry;
    }
  }

  return null;
}

function findEntryById(entries, id) {
  return entries.find((entry) => String(getEntryId(entry)).toLowerCase() === String(id).toLowerCase()) ?? null;
}

function formatOwner(entry) {
  if (!entry) {
    return "sem dono";
  }

  const id = getEntryId(entry) ?? "sem-id";
  const agent = entry.agent ? `/${entry.agent}` : "";
  return `${id}${agent}`;
}

function validateRecorteManifest(recorteManifest, boundaryManifest, sourceLabel = "manifesto") {
  const errors = [];
  const warnings = [];
  const entries = getBoundaryEntries(boundaryManifest);
  const moduleEntry = findEntryById(entries, recorteManifest.module);
  const allowedLayerIds = toArray(recorteManifest.allowedLayers).map((layer) => String(layer).toLowerCase());
  const allowedEntries = [
    moduleEntry,
    ...allowedLayerIds.map((layerId) => findEntryById(entries, layerId))
  ].filter(Boolean);
  const allowedEntryIds = new Set(allowedEntries.map((entry) => String(getEntryId(entry)).toLowerCase()));

  if (recorteManifest.schemaVersion !== "panteon.recorte.v1") {
    errors.push("schemaVersion deve ser panteon.recorte.v1.");
  }

  if (!recorteManifest.protocolId || !/^[A-Z]{2,4}-\d{8}-\d{3}[A-Z0-9-]*$/.test(recorteManifest.protocolId)) {
    errors.push("protocolId obrigatorio no formato OP-YYYYMMDD-001-DESCRICAO.");
  }

  if (!recorteManifest.module) {
    errors.push("module e obrigatorio.");
  } else if (!moduleEntry) {
    errors.push(`module desconhecido no manifesto de fronteira: ${recorteManifest.module}.`);
  }

  if (!recorteManifest.agent) {
    errors.push("agent e obrigatorio.");
  } else if (moduleEntry?.agent && recorteManifest.agent !== moduleEntry.agent) {
    warnings.push(`agent declarado (${recorteManifest.agent}) difere do agente canonico (${moduleEntry.agent}).`);
  }

  for (const layerId of allowedLayerIds) {
    if (!findEntryById(entries, layerId)) {
      errors.push(`allowedLayers contem camada/modulo desconhecido: ${layerId}.`);
    }
  }

  const includedFiles = toArray(recorteManifest.includedFiles).map(normalizePath);
  if (includedFiles.length === 0) {
    errors.push("includedFiles precisa ter pelo menos um arquivo.");
  }

  const blocks = toArray(recorteManifest.blocks).filter(Boolean);
  if (blocks.length === 0) {
    errors.push("blocks precisa declarar ao menos um bloco de trabalho.");
  }

  const validations = toArray(recorteManifest.validations).filter(Boolean);
  if (validations.length === 0) {
    warnings.push("validations esta vazio; recorte ainda nao tem evidencia local registrada.");
  }

  if (!VALID_RISK_LEVELS.has(String(recorteManifest.riskLevel ?? "").toUpperCase())) {
    errors.push(`riskLevel invalido: ${recorteManifest.riskLevel ?? "(vazio)"}.`);
  }

  const status = String(recorteManifest.status ?? "").toUpperCase();
  if (!VALID_STATUSES.has(status)) {
    errors.push(`status invalido: ${recorteManifest.status ?? "(vazio)"}.`);
  }

  if (APPROVAL_REQUIRED_STATUSES.has(status) && recorteManifest.approvedBy !== "Lucas") {
    errors.push(`status ${status} exige approvedBy = Lucas.`);
  }

  const sensitiveOperations = toArray(recorteManifest.sensitiveOperations).filter(Boolean);
  if (sensitiveOperations.length > 0 && recorteManifest.approvedBy !== "Lucas") {
    errors.push("sensitiveOperations declaradas exigem approvedBy = Lucas.");
  }

  const explicitExcludedPaths = toArray(recorteManifest.excludedPaths).map(normalizePath);
  for (const forbiddenPattern of FORBIDDEN_PATH_PATTERNS) {
    const hasExclusion = explicitExcludedPaths.some((pattern) => pattern === forbiddenPattern);
    if (!hasExclusion) {
      warnings.push(`excludedPaths nao declara ${forbiddenPattern}.`);
    }
  }

  for (const filePath of includedFiles) {
    if (matchesAnyPattern(filePath, FORBIDDEN_PATH_PATTERNS)) {
      errors.push(`Arquivo proibido no recorte: ${filePath}.`);
      continue;
    }

    const owner = findOwnerForPath(filePath, entries);
    if (!owner) {
      warnings.push(`Arquivo sem owner no boundary manifest: ${filePath}.`);
      continue;
    }

    const ownerId = String(getEntryId(owner)).toLowerCase();
    if (!allowedEntryIds.has(ownerId)) {
      errors.push(`Arquivo fora do recorte ${recorteManifest.module}: ${filePath} pertence a ${formatOwner(owner)}.`);
    }

    if (!fs.existsSync(path.resolve(filePath))) {
      warnings.push(`Arquivo incluido ainda nao existe no workspace: ${filePath}.`);
    }
  }

  const baseline = recorteManifest.productionBaseline ?? null;
  const canonicalBaseline = boundaryManifest.productionBaseline ?? null;
  if (baseline && canonicalBaseline) {
    const baselinePairs = [
      ["deploymentId", "deploymentId"],
      ["rollbackDeploymentId", "rollbackDeploymentId"],
      ["publishedCommit", "codeCommit"],
      ["postDeployRecordCommit", "recordCommit"]
    ];

    for (const [localKey, canonicalKey] of baselinePairs) {
      if (baseline[localKey] && canonicalBaseline[canonicalKey] && baseline[localKey] !== canonicalBaseline[canonicalKey]) {
        errors.push(`productionBaseline.${localKey} diverge do manifesto de fronteira.`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    sourceLabel
  };
}

function printResult(result) {
  if (result.ok) {
    console.log(`PASS: ${result.sourceLabel}`);
  } else {
    console.log(`BLOQUEADO: ${result.sourceLabel}`);
  }

  for (const error of result.errors) {
    console.log(`- ERRO: ${error}`);
  }

  for (const warning of result.warnings) {
    console.log(`- AVISO: ${warning}`);
  }
}

function runSelfTest(boundaryManifest) {
  const validManifest = {
    schemaVersion: "panteon.recorte.v1",
    protocolId: "OP-20260530-999-SELFTEST",
    module: "zeus",
    agent: "Zeus",
    status: "VALIDADO_LOCAL",
    riskLevel: "BAIXO",
    approvedBy: null,
    blocks: ["self-test"],
    allowedLayers: [],
    includedFiles: [
      "docs/operations/panteon-agent-governance-v2.md",
      "scripts/panteon-boundary-check.mjs"
    ],
    excludedPaths: FORBIDDEN_PATH_PATTERNS,
    validations: ["self-test"],
    sensitiveOperations: []
  };

  const blockedManifest = {
    schemaVersion: "panteon.recorte.v1",
    protocolId: "CH-20260530-999-SELFTEST",
    module: "chronos",
    agent: "Chronos",
    status: "VALIDADO_LOCAL",
    riskLevel: "BAIXO",
    approvedBy: null,
    blocks: ["self-test"],
    allowedLayers: [],
    includedFiles: [
      "apps/hub/modules/chronos/ChronosPage.tsx",
      "apps/hub/modules/caredesk/IrisPage.tsx"
    ],
    excludedPaths: FORBIDDEN_PATH_PATTERNS,
    validations: ["self-test"],
    sensitiveOperations: []
  };

  const validResult = validateRecorteManifest(validManifest, boundaryManifest, "self-test valido");
  const blockedResult = validateRecorteManifest(blockedManifest, boundaryManifest, "self-test bloqueado");

  printResult(validResult);
  printResult(blockedResult);

  if (!validResult.ok) {
    throw new Error("Self-test valido falhou.");
  }

  if (blockedResult.ok) {
    throw new Error("Self-test bloqueado passou indevidamente.");
  }

  console.log("PASS: self-test confirmou recorte valido e bloqueio cross-module.");
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    return;
  }

  const boundaryManifest = readJson(options.boundaryPath);

  if (options.selfTest) {
    runSelfTest(boundaryManifest);
    return;
  }

  const recorteManifest = readJson(options.manifestPath);
  const result = validateRecorteManifest(recorteManifest, boundaryManifest, options.manifestPath);
  printResult(result);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(`BLOQUEADO: ${error.message}`);
  process.exitCode = 1;
}
