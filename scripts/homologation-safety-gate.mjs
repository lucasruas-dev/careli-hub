#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_ALIAS = "https://homo.c2x.app.br";

const FORBIDDEN_PATH_PATTERNS = [
  /(^|\/)\.env($|[./])/i,
  /(^|\/)\.vercel(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)\.next(\/|$)/i,
  /(^|\/)\.turbo(\/|$)/i,
  /(^|\/)supabase\/migrations(\/|$)/i,
  /(^|\/)migrations(\/|$)/i,
];

function usage() {
  console.log(`Homologation Safety Gate

Uso:
  node scripts/homologation-safety-gate.mjs --manifest <arquivo.json>

Opcoes:
  --manifest <path>              Manifesto do pacote de homologacao.
  --alias <url>                  Alias a validar. Padrao: ${DEFAULT_ALIAS}
  --expected-deployment <id>     Sobrescreve expectedDeploymentId do manifesto.
  --current-deployment <id>      Usa deployment atual informado manualmente.
  --skip-alias-check             Nao chama Vercel inspect; exige registro manual.
  --init                         Imprime um manifesto exemplo.
  --help                         Mostra esta ajuda.
`);
}

function exampleManifest() {
  console.log(JSON.stringify({
    module: "iris",
    alias: DEFAULT_ALIAS,
    expectedDeploymentId: "dpl_atual_antes_do_deploy",
    packagePath: ".codex-deploy/iris-homolog-YYYYMMDD-HHMMSS/workspace",
    includedFiles: [
      "apps/hub/modules/caredesk/IrisPage.tsx",
      "apps/hub/app/api/iris/meta/templates/route.ts",
      "apps/hub/lib/iris/meta-whatsapp.ts",
      "turbo.json",
    ],
    excludedPaths: [
      "apps/hub/app/api/iris/attendant",
      "apps/hub/app/api/iris/meta/templates/media",
      ".env.local",
    ],
    validations: [
      "npm.cmd run check-types:hub",
      "npm.cmd run lint:hub",
      "npm.cmd run build --workspace @repo/hub",
    ],
    rollbackDeploymentId: "dpl_rollback_conhecido",
    approvedBy: "Lucas",
  }, null, 2));
}

function parseArgs(argv) {
  const options = {
    alias: undefined,
    currentDeployment: undefined,
    expectedDeployment: undefined,
    manifestPath: undefined,
    skipAliasCheck: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--init") {
      options.init = true;
      continue;
    }
    if (arg === "--skip-alias-check") {
      options.skipAliasCheck = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Opcao sem valor: ${arg}`);
    }

    if (arg === "--manifest") {
      options.manifestPath = next;
    } else if (arg === "--alias") {
      options.alias = next;
    } else if (arg === "--current-deployment") {
      options.currentDeployment = next;
    } else if (arg === "--expected-deployment") {
      options.expectedDeployment = next;
    } else {
      throw new Error(`Opcao desconhecida: ${arg}`);
    }
    index += 1;
  }

  return options;
}

function normalizeRelativePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .trim();
}

function resolveFromCwd(value) {
  return path.resolve(process.cwd(), String(value || ""));
}

function readManifest(manifestPath) {
  const absolutePath = resolveFromCwd(manifestPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Manifesto nao encontrado: ${absolutePath}`);
  }

  const raw = readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, "");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Manifesto invalido (${manifestPath}): ${error.message}`);
  }
}

function commandName(base) {
  return process.platform === "win32" ? `${base}.cmd` : base;
}

function getGitStatus() {
  const git = spawnSync("git", ["status", "--short", "--branch"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (git.error) {
    return { ok: false, output: git.error.message };
  }

  return {
    ok: git.status === 0,
    output: `${git.stdout || ""}${git.stderr || ""}`.trim(),
  };
}

function inspectAlias(alias) {
  if (!/^[A-Za-z0-9:/.?=&_%#-]+$/.test(alias)) {
    return { ok: false, output: "Alias contem caracteres invalidos para chamada CLI segura." };
  }

  const npx = commandName("npx");
  const result = process.platform === "win32"
    ? spawnSync(`${npx} vercel inspect ${alias}`, {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: true,
    })
    : spawnSync(npx, ["vercel", "inspect", alias], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: false,
    });

  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.error) {
    return { ok: false, output: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, output: output.trim() };
  }

  const deploymentId = output.match(/\bid\s+(dpl_[A-Za-z0-9]+)/)?.[1]
    || output.match(/\b(dpl_[A-Za-z0-9]+)\b/)?.[1];

  return {
    ok: Boolean(deploymentId),
    deploymentId,
    output: output.trim(),
  };
}

function pathExistsInsidePackage(packageRoot, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const candidate = path.resolve(packageRoot, normalized);
  const relative = path.relative(packageRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { exists: false, escapesPackage: true };
  }
  return { exists: existsSync(candidate), absolutePath: candidate };
}

function hasForbiddenPattern(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  return FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function findEnvFiles(root, maxResults = 20) {
  const results = [];
  const ignoredDirectories = new Set([
    ".git",
    ".next",
    ".turbo",
    ".vercel",
    "node_modules",
    "coverage",
    "dist",
  ]);
  const allowedEnvExamplePattern = /\.env(?:[.\w-]+)?\.(?:example|sample|template)$/i;

  function visit(directory) {
    if (results.length >= maxResults) {
      return;
    }

    let entries = [];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) {
        return;
      }

      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizeRelativePath(path.relative(root, absolutePath));

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          visit(absolutePath);
        }
        continue;
      }

      if (entry.isFile() && entry.name.startsWith(".env") && !allowedEnvExamplePattern.test(entry.name)) {
        results.push(relativePath);
      }
    }
  }

  visit(root);
  return results;
}

function main() {
  const report = [];
  const failures = [];
  const warnings = [];

  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`BLOQUEADO: ${error.message}`);
    usage();
    process.exit(1);
  }

  if (options.help) {
    usage();
    return;
  }

  if (options.init) {
    exampleManifest();
    return;
  }

  if (!options.manifestPath) {
    console.error("BLOQUEADO: informe --manifest <arquivo.json>.");
    usage();
    process.exit(1);
  }

  let manifest;
  try {
    manifest = readManifest(options.manifestPath);
  } catch (error) {
    console.error(`BLOQUEADO: ${error.message}`);
    process.exit(1);
  }

  const alias = options.alias || manifest.alias || DEFAULT_ALIAS;
  const expectedDeploymentId = options.expectedDeployment
    || manifest.expectedDeploymentId
    || manifest.expectedCurrentDeploymentId
    || manifest.expectedHomologationDeploymentId;
  const currentDeploymentId = options.currentDeployment || manifest.currentDeploymentId;
  const packagePath = manifest.packagePath;
  const includedFiles = Array.isArray(manifest.includedFiles) ? manifest.includedFiles : [];
  const excludedPaths = Array.isArray(manifest.excludedPaths) ? manifest.excludedPaths : [];
  const validations = Array.isArray(manifest.validations) ? manifest.validations : [];

  if (!manifest.module) {
    failures.push("Manifesto sem module.");
  }

  if (!packagePath) {
    failures.push("Manifesto sem packagePath.");
  }

  if (!expectedDeploymentId && !options.skipAliasCheck) {
    failures.push("Manifesto sem expectedDeploymentId; nao e seguro comparar o alias atual.");
  }

  if (!manifest.rollbackDeploymentId) {
    warnings.push("Manifesto sem rollbackDeploymentId; registre rollback antes de publicar.");
  }

  if (!manifest.approvedBy) {
    warnings.push("Manifesto sem approvedBy; confirme autorizacao do Lucas no registro operacional.");
  }

  if (includedFiles.length === 0) {
    failures.push("Manifesto sem includedFiles.");
  }

  if (validations.length === 0) {
    warnings.push("Manifesto sem validations; registre validacoes proporcionais ao risco.");
  }

  let packageRoot;
  if (packagePath) {
    packageRoot = resolveFromCwd(packagePath);
    if (!existsSync(packageRoot)) {
      failures.push(`packagePath nao existe: ${packageRoot}`);
    } else if (!statSync(packageRoot).isDirectory()) {
      failures.push(`packagePath nao e diretorio: ${packageRoot}`);
    } else {
      report.push(`Pacote: ${packageRoot}`);

      const packageRelativeToCwd = path.relative(process.cwd(), packageRoot);
      if (!packageRelativeToCwd || packageRelativeToCwd === "") {
        failures.push("packagePath aponta para o worktree atual; monte pacote limpo fora do worktree sujo.");
      }

      if (existsSync(path.join(packageRoot, ".git"))) {
        failures.push("Pacote contem .git; deploy de homologacao deve usar pacote limpo sem repositorio interno.");
      }

      if (existsSync(path.join(packageRoot, ".vercel"))) {
        warnings.push("Pacote contem .vercel; permitido para link de projeto, mas nao registre nem inclua valores sensiveis.");
      }

      const envFiles = findEnvFiles(packageRoot);
      for (const envFile of envFiles) {
        failures.push(`Pacote contem arquivo de env bloqueado: ${envFile}`);
      }
    }
  }

  const gitStatus = getGitStatus();
  if (gitStatus.ok) {
    report.push(`Git atual:\n${gitStatus.output}`);
  } else {
    warnings.push(`Nao foi possivel ler git status: ${gitStatus.output}`);
  }

  if (packageRoot && existsSync(packageRoot)) {
    for (const file of includedFiles) {
      const normalized = normalizeRelativePath(file);
      const result = pathExistsInsidePackage(packageRoot, normalized);
      if (result.escapesPackage) {
        failures.push(`includedFiles escapa do pacote: ${file}`);
        continue;
      }
      if (!result.exists) {
        failures.push(`Arquivo declarado em includedFiles nao existe no pacote: ${normalized}`);
      }
      if (hasForbiddenPattern(normalized)) {
        failures.push(`includedFiles contem caminho sensivel/bloqueado: ${normalized}`);
      }
    }

    for (const excludedPath of excludedPaths) {
      const normalized = normalizeRelativePath(excludedPath);
      const result = pathExistsInsidePackage(packageRoot, normalized);
      if (result.escapesPackage) {
        warnings.push(`excludedPaths escapa do pacote e foi ignorado: ${excludedPath}`);
        continue;
      }
      if (result.exists) {
        failures.push(`Caminho explicitamente excluido existe no pacote: ${normalized}`);
      }
    }
  }

  let observedDeploymentId = currentDeploymentId;
  if (!options.skipAliasCheck && !observedDeploymentId) {
    const inspection = inspectAlias(alias);
    if (!inspection.ok) {
      failures.push(`Nao foi possivel inspecionar alias ${alias}: ${inspection.output || "sem saida"}`);
    } else {
      observedDeploymentId = inspection.deploymentId;
      report.push(`Alias ${alias} aponta para ${observedDeploymentId}.`);
    }
  } else if (options.skipAliasCheck) {
    warnings.push("Alias check foi pulado; registre manualmente o deployment atual antes do deploy/alias.");
  }

  if (expectedDeploymentId && observedDeploymentId && expectedDeploymentId !== observedDeploymentId) {
    failures.push(`Alias ${alias} mudou: esperado ${expectedDeploymentId}, atual ${observedDeploymentId}. Bloqueie e reconcilie antes de publicar.`);
  }

  const status = failures.length > 0 ? "BLOQUEADO" : "PASS";
  console.log(`Homologation Safety Gate: ${status}`);
  console.log(`Modulo: ${manifest.module || "nao informado"}`);
  console.log(`Alias: ${alias}`);
  console.log(`Expected deployment: ${expectedDeploymentId || "nao informado"}`);
  console.log(`Observed deployment: ${observedDeploymentId || "nao verificado"}`);

  if (report.length > 0) {
    console.log("\nContexto:");
    for (const item of report) {
      console.log(`- ${item}`);
    }
  }

  if (warnings.length > 0) {
    console.log("\nAvisos:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }

  if (failures.length > 0) {
    console.log("\nBloqueios:");
    for (const failure of failures) {
      console.log(`- ${failure}`);
    }
    process.exit(1);
  }
}

main();
