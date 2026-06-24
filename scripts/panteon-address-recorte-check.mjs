#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_REGISTRY = "docs/operations/panteon-address-registry.json";
const DEFAULT_MANIFEST = "docs/operations/panteon-address-recorte-template.json";
const ADDRESS_CODE_PATTERN = /^PNT-\d{2}-\d{2}-\d{2}-\d{3}$/;
const PRODUCTION_STATUSES = new Set([
  "PRONTO_PARA_PRODUCAO",
  "EM_PRODUCAO",
  "PRODUCAO",
]);
const DEPLOYABLE_STATUSES = new Set([
  "PRONTO_PARA_HOMO",
  "EM_HOMOLOGACAO",
  "HOMOLOGADO",
  "PRONTO_PARA_PRODUCAO",
  "EM_PRODUCAO",
]);
const FORBIDDEN_PATH_PATTERNS = [
  /(^|\/)\.env($|[./])/i,
  /(^|\/)\.vercel(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)\.next(\/|$)/i,
  /(^|\/)\.turbo(\/|$)/i,
];

function usage() {
  console.log(`Panteon Address Recorte Check

Uso:
  node scripts/panteon-address-recorte-check.mjs --manifest <arquivo.json>
  node scripts/panteon-address-recorte-check.mjs --manifest <arquivo.json> --files <lista>
  node scripts/panteon-address-recorte-check.mjs --manifest <arquivo.json> --from-git
  node scripts/panteon-address-recorte-check.mjs --self-test

Opcoes:
  --manifest <path>   Manifesto de recorte com CEP operacional. Default: ${DEFAULT_MANIFEST}
  --registry <path>   Registry de CEPs. Default: ${DEFAULT_REGISTRY}
  --files <lista>     Arquivos separados por virgula ou ponto e virgula.
  --from-git          Usa arquivos alterados no Git.
  --self-test         Executa cenario local PASS/BLOQUEADO sintetico.
  --help              Mostra esta ajuda.
`);
}

function parseArgs(argv) {
  const options = {
    files: [],
    fromGit: false,
    help: false,
    manifestPath: DEFAULT_MANIFEST,
    registryPath: DEFAULT_REGISTRY,
    selfTest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--self-test") {
      options.selfTest = true;
      continue;
    }
    if (arg === "--from-git") {
      options.fromGit = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Opcao sem valor: ${arg}`);
    }

    if (arg === "--manifest") {
      options.manifestPath = next;
    } else if (arg === "--registry") {
      options.registryPath = next;
    } else if (arg === "--files") {
      options.files.push(...splitFiles(next));
    } else {
      throw new Error(`Opcao desconhecida: ${arg}`);
    }
    index += 1;
  }

  return options;
}

function splitFiles(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readJson(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Arquivo nao encontrado: ${absolutePath}`);
  }

  try {
    return JSON.parse(readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`JSON invalido em ${filePath}: ${error.message}`);
  }
}

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .trim();
}

function toArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern);
  let output = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "*" && next === "*") {
      output += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      output += "[^/]*";
      continue;
    }
    output += escapeRegExp(char);
  }

  output += "$";
  return new RegExp(output);
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

function hasGlob(value) {
  return /[*?]/.test(String(value || ""));
}

function gitChangedFiles() {
  const tracked = runGit(["diff", "--name-only", "--diff-filter=ACMRTUXB", "HEAD"]);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"]);

  return [...tracked, ...untracked]
    .map(normalizePath)
    .filter(Boolean);
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`Falha ao executar git ${args.join(" ")}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} falhou: ${result.stderr || result.stdout}`);
  }

  return String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildRegistryIndex(registry) {
  const addresses = Array.isArray(registry.addresses) ? registry.addresses : [];
  const byCode = new Map();
  const byId = new Map();
  const failures = [];

  for (const address of addresses) {
    if (!ADDRESS_CODE_PATTERN.test(String(address.addressCode || ""))) {
      failures.push(`CEP invalido no registry: ${address.addressCode || "(vazio)"}`);
    }
    if (byCode.has(address.addressCode)) {
      failures.push(`CEP duplicado no registry: ${address.addressCode}`);
    }
    if (byId.has(address.addressId)) {
      failures.push(`addressId duplicado no registry: ${address.addressId}`);
    }
    byCode.set(address.addressCode, address);
    byId.set(address.addressId, address);
  }

  return { addresses, byCode, byId, failures };
}

function requireAddress({ byCode, byId }, code, id, expectedLevel, label, failures) {
  if (!code) {
    failures.push(`${label}: addressCode obrigatorio.`);
    return null;
  }
  if (!ADDRESS_CODE_PATTERN.test(String(code))) {
    failures.push(`${label}: CEP fora do formato PNT-CC-BB-RR-HHH: ${code}`);
    return null;
  }

  const address = byCode.get(code);
  if (!address) {
    failures.push(`${label}: CEP ausente no registry: ${code}`);
    return null;
  }

  if (expectedLevel && address.level !== expectedLevel) {
    failures.push(`${label}: ${code} deveria ser level ${expectedLevel}, mas e ${address.level}.`);
  }

  if (id) {
    const addressById = byId.get(id);
    if (!addressById) {
      failures.push(`${label}: addressId ausente no registry: ${id}`);
    } else if (addressById.addressCode !== code) {
      failures.push(`${label}: addressId ${id} aponta para ${addressById.addressCode}, esperado ${code}.`);
    }
    if (address.addressId !== id) {
      failures.push(`${label}: CEP ${code} aponta para ${address.addressId}, esperado ${id}.`);
    }
  }

  return address;
}

function validateParent(child, parentCode, label, failures) {
  if (!child || !parentCode) {
    return;
  }
  if (child.parentAddressCode && child.parentAddressCode !== parentCode) {
    failures.push(`${label}: parentAddressCode ${child.parentAddressCode} diverge de ${parentCode}.`);
  }
}

function validateMarkers(markers, forbiddenMarkers, failures, warnings) {
  for (const marker of markers) {
    const markerPath = normalizePath(marker.path);
    if (!markerPath) {
      failures.push("requiredMarkers contem path vazio.");
      continue;
    }
    if (!existsSync(path.resolve(process.cwd(), markerPath))) {
      failures.push(`Arquivo de marcador obrigatorio ausente: ${markerPath}`);
      continue;
    }

    const content = readFileSync(path.resolve(process.cwd(), markerPath), "utf8");
    for (const token of toArray(marker.includes)) {
      if (!content.includes(token)) {
        failures.push(`Marcador obrigatorio ausente em ${markerPath}: ${token}`);
      }
    }
  }

  for (const marker of forbiddenMarkers) {
    const markerPath = normalizePath(marker.path);
    if (!markerPath || !existsSync(path.resolve(process.cwd(), markerPath))) {
      continue;
    }

    const content = readFileSync(path.resolve(process.cwd(), markerPath), "utf8");
    for (const token of toArray(marker.includes)) {
      if (content.includes(token)) {
        failures.push(`Marcador proibido encontrado em ${markerPath}: ${token}`);
      }
    }
  }

  if (markers.length === 0) {
    warnings.push("Manifesto sem requiredMarkers; recorte fica com menor capacidade de provar preservacao.");
  }
}

function validateChangedFiles(files, scope, failures, warnings) {
  const uniqueFiles = [...new Set(files.map(normalizePath).filter(Boolean))];
  const allowed = toArray(scope.allowedChangedPaths).map(normalizePath);
  const protectedPaths = toArray(scope.protectedPaths).map(normalizePath);
  const included = toArray(scope.includedFiles).map(normalizePath);

  for (const filePath of uniqueFiles) {
    if (FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(filePath))) {
      failures.push(`Arquivo sensivel/bloqueado no diff: ${filePath}`);
      continue;
    }
    if (matchesAnyPattern(filePath, protectedPaths)) {
      failures.push(`Arquivo em protectedPaths no diff: ${filePath}`);
      continue;
    }
    if (allowed.length > 0 && !matchesAnyPattern(filePath, allowed)) {
      failures.push(`Arquivo fora de allowedChangedPaths: ${filePath}`);
      continue;
    }
    if (included.length > 0 && !matchesAnyPattern(filePath, included)) {
      warnings.push(`Arquivo permitido, mas nao declarado em includedFiles: ${filePath}`);
    }
  }
}

function validateAddressRecorte(manifest, registry, changedFiles = [], sourceLabel = "manifesto") {
  const failures = [];
  const warnings = [];
  const registryIndex = buildRegistryIndex(registry);
  failures.push(...registryIndex.failures);

  if (manifest.schemaVersion !== "panteon.address-recorte.v1") {
    failures.push("schemaVersion deve ser panteon.address-recorte.v1.");
  }
  if (!manifest.deploymentManifestId) {
    warnings.push("deploymentManifestId ausente; recomendado para rastreabilidade de pacote.");
  }
  if (!manifest.protocolId) {
    failures.push("protocolId e obrigatorio.");
  }
  if (!manifest.module) {
    failures.push("module e obrigatorio.");
  }
  if (!manifest.agent) {
    failures.push("agent e obrigatorio.");
  }

  const addressing = manifest.addressing || {};
  const city = requireAddress(
    registryIndex,
    addressing.cityAddressCode,
    addressing.cityAddressId,
    "city",
    "cidade",
    failures,
  );
  const district = requireAddress(
    registryIndex,
    addressing.districtAddressCode,
    addressing.districtAddressId,
    "district",
    "bairro",
    failures,
  );
  const street = requireAddress(
    registryIndex,
    addressing.streetAddressCode,
    addressing.streetAddressId,
    "street",
    "rua",
    failures,
  );
  validateParent(district, addressing.cityAddressCode, "bairro", failures);
  validateParent(street, addressing.districtAddressCode, "rua", failures);

  const houseCodes = toArray(addressing.houseAddressCodes);
  const houseIds = toArray(addressing.houseAddressIds);
  if (houseCodes.length === 0) {
    failures.push("houseAddressCodes precisa declarar ao menos uma casa.");
  }
  if (houseIds.length > 0 && houseIds.length !== houseCodes.length) {
    failures.push("houseAddressIds deve ter a mesma quantidade de houseAddressCodes.");
  }

  const houses = [];
  for (let index = 0; index < houseCodes.length; index += 1) {
    const house = requireAddress(
      registryIndex,
      houseCodes[index],
      houseIds[index],
      "house",
      `casa[${index}]`,
      failures,
    );
    validateParent(house, addressing.streetAddressCode, `casa[${index}]`, failures);
    if (house) {
      houses.push(house);
    }
  }

  const moduleName = String(manifest.module || "").toLowerCase();
  for (const address of [district, street, ...houses].filter(Boolean)) {
    if (address.module && String(address.module).toLowerCase() !== moduleName) {
      warnings.push(`CEP ${address.addressCode} pertence ao modulo ${address.module}, manifesto declara ${manifest.module}.`);
    }
  }

  const baseline = manifest.baseline || {};
  if (city?.rollbackReference && baseline.expectedProductionDeploymentId && city.rollbackReference !== baseline.expectedProductionDeploymentId) {
    warnings.push(`baseline.expectedProductionDeploymentId diverge da referencia da cidade ${city.addressCode}.`);
  }
  if (city?.releaseDomain && baseline.productionDomain && city.releaseDomain !== baseline.productionDomain) {
    warnings.push(`baseline.productionDomain diverge do dominio da cidade ${city.addressCode}.`);
  }

  const status = String(manifest.status || "").toUpperCase();
  if (PRODUCTION_STATUSES.has(status)) {
    if (!baseline.candidateSourceCommit) {
      failures.push("Producao exige baseline.candidateSourceCommit.");
    }
    if (baseline.sourceWorktreeClean !== true) {
      failures.push("Producao exige baseline.sourceWorktreeClean true.");
    }
    if (!baseline.basePackagePath || !baseline.candidatePackagePath) {
      failures.push("Producao exige basePackagePath e candidatePackagePath.");
    }
  } else if (DEPLOYABLE_STATUSES.has(status)) {
    warnings.push(`Status ${status} exige revisar autorizacao de Lucas, Safety Gate e rollback antes de publicar.`);
  }

  const scope = manifest.scope || {};
  const allowedChangedPaths = toArray(scope.allowedChangedPaths).filter(Boolean);
  const protectedPaths = toArray(scope.protectedPaths).filter(Boolean);
  if (allowedChangedPaths.length === 0) {
    failures.push("scope.allowedChangedPaths precisa declarar paths permitidos.");
  }
  if (protectedPaths.length === 0) {
    warnings.push("scope.protectedPaths vazio; recomenda-se declarar modulos protegidos.");
  }

  for (const includedPath of toArray(scope.includedFiles).map(normalizePath)) {
    if (FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(includedPath))) {
      failures.push(`includedFiles contem caminho sensivel/bloqueado: ${includedPath}`);
    }
    if (!hasGlob(includedPath) && !existsSync(path.resolve(process.cwd(), includedPath))) {
      warnings.push(`includedFiles aponta arquivo ausente no workspace: ${includedPath}`);
    }
  }

  if (toArray(scope.sensitiveOperations).length > 0 && !String(manifest.approvedBy || "").includes("Lucas")) {
    failures.push("sensitiveOperations exige aprovacao explicita do Lucas no manifesto.");
  }

  validateMarkers(
    toArray(scope.requiredMarkers),
    toArray(scope.forbiddenMarkers),
    failures,
    warnings,
  );

  if (changedFiles.length > 0) {
    validateChangedFiles(changedFiles, scope, failures, warnings);
  } else {
    warnings.push("Nenhum diff avaliado; use --files ou --from-git para validar arquivos alterados.");
  }

  return {
    failures,
    ok: failures.length === 0,
    sourceLabel,
    warnings,
  };
}

function printResult(result) {
  console.log(`Panteon Address Recorte Check - ${result.sourceLabel}`);
  console.log(`Status: ${result.ok ? "PASS" : "BLOQUEADO"}`);

  if (result.failures.length > 0) {
    console.log("\nBloqueios:");
    for (const failure of result.failures) {
      console.log(`- ${failure}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log("\nAvisos:");
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function runSelfTest() {
  const registry = {
    addresses: [
      {
        addressCode: "PNT-01-00-00-000",
        addressId: "PNT-CID-01",
        level: "city",
        module: "panteon",
        releaseDomain: "https://c2x.app.br",
        rollbackReference: "dpl_base",
      },
      {
        addressCode: "PNT-01-10-00-000",
        addressId: "PNT-BRR-HADES-01",
        level: "district",
        module: "hades",
        parentAddressCode: "PNT-01-00-00-000",
      },
      {
        addressCode: "PNT-01-10-20-000",
        addressId: "PNT-RUA-HADES-COBRANCA-01",
        level: "street",
        module: "hades",
        parentAddressCode: "PNT-01-10-00-000",
      },
      {
        addressCode: "PNT-01-10-20-003",
        addressId: "PNT-CASA-HADES-IRIS-EMBED-003",
        level: "house",
        module: "hades",
        parentAddressCode: "PNT-01-10-20-000",
      },
    ],
  };
  const manifest = {
    schemaVersion: "panteon.address-recorte.v1",
    deploymentManifestId: "PNT-DEP-HADES-SELFTEST-001",
    protocolId: "HADES-20990101-001-SELFTEST",
    title: "self-test",
    module: "hades",
    agent: "Zeus",
    status: "PILOTO_DOCUMENTAL",
    approvedBy: "Lucas",
    addressing: {
      cityAddressCode: "PNT-01-00-00-000",
      cityAddressId: "PNT-CID-01",
      districtAddressCode: "PNT-01-10-00-000",
      districtAddressId: "PNT-BRR-HADES-01",
      streetAddressCode: "PNT-01-10-20-000",
      streetAddressId: "PNT-RUA-HADES-COBRANCA-01",
      houseAddressCodes: ["PNT-01-10-20-003"],
      houseAddressIds: ["PNT-CASA-HADES-IRIS-EMBED-003"],
    },
    baseline: {
      productionDomain: "https://c2x.app.br",
      expectedProductionDeploymentId: "dpl_base",
      candidateSourceCommit: null,
      sourceWorktreeClean: false,
    },
    scope: {
      includedFiles: ["apps/hub/modules/caredesk/embeds/iris-collection-queue-embed.tsx"],
      allowedChangedPaths: ["apps/hub/modules/caredesk/embeds/**"],
      protectedPaths: ["apps/hub/modules/chronos/**"],
      requiredMarkers: [],
      forbiddenMarkers: [],
      sensitiveOperations: [],
    },
  };

  const passResult = validateAddressRecorte(
    manifest,
    registry,
    ["apps/hub/modules/caredesk/embeds/iris-collection-queue-embed.tsx"],
    "self-test valido",
  );
  const blockedResult = validateAddressRecorte(
    manifest,
    registry,
    ["apps/hub/modules/chronos/ChronosPage.tsx"],
    "self-test bloqueado",
  );

  printResult(passResult);
  printResult(blockedResult);

  if (!passResult.ok) {
    throw new Error("Self-test valido falhou.");
  }
  if (blockedResult.ok) {
    throw new Error("Self-test bloqueado passou indevidamente.");
  }
  console.log("\nPASS: self-test confirmou recorte valido e bloqueio por protectedPaths.");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (options.selfTest) {
    runSelfTest();
    return;
  }

  const registry = readJson(options.registryPath);
  const manifest = readJson(options.manifestPath);
  const changedFiles = [
    ...options.files,
    ...(options.fromGit ? gitChangedFiles() : []),
  ];
  const result = validateAddressRecorte(manifest, registry, changedFiles, options.manifestPath);
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
