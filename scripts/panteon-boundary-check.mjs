#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_MANIFEST = "docs/operations/panteon-module-boundary-manifest-v1.json";
const FORBIDDEN_PATTERNS = [
  /(^|\/)\.env($|[./])/i,
  /(^|\/)\.vercel(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)\.next(\/|$)/i,
  /(^|\/)\.turbo(\/|$)/i,
];

function usage() {
  console.log(`Panteon Boundary Check

Uso:
  node scripts/panteon-boundary-check.mjs --module <id> [opcoes]

Opcoes:
  --manifest <path>       Manifesto de fronteiras. Padrao: ${DEFAULT_MANIFEST}
  --module <id>           Modulo/camada principal do recorte.
  --allow <id>            Modulo/camada adicional permitida. Pode repetir.
  --files <lista>         Arquivos separados por virgula ou ponto e virgula.
  --from-git              Usa arquivos alterados no Git.
  --list                  Lista modulos/camadas conhecidos.
  --help                  Mostra esta ajuda.

Exemplos:
  node scripts/panteon-boundary-check.mjs --module chronos --from-git
  node scripts/panteon-boundary-check.mjs --module zeus --files docs/operations/x.md,scripts/y.mjs
  node scripts/panteon-boundary-check.mjs --module iris --allow athena --from-git
`);
}

function parseArgs(argv) {
  const options = {
    allowedIds: [],
    files: [],
    fromGit: false,
    help: false,
    list: false,
    manifestPath: DEFAULT_MANIFEST,
    moduleId: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--list") {
      options.list = true;
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
    } else if (arg === "--module") {
      options.moduleId = next;
    } else if (arg === "--allow") {
      options.allowedIds.push(next);
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

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .trim();
}

function readJson(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Manifesto nao encontrado: ${absolutePath}`);
  }

  try {
    return JSON.parse(readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Manifesto invalido: ${error.message}`);
  }
}

function getEntries(manifest) {
  return [
    ...(Array.isArray(manifest.hubModules) ? manifest.hubModules : []),
    ...(Array.isArray(manifest.operationalLayers) ? manifest.operationalLayers : []),
  ];
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

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function compileMatchers(entries) {
  return entries.map((entry) => ({
    entry,
    matchers: (entry.allowedPaths || []).map((allowedPath) => ({
      pattern: allowedPath,
      regex: globToRegExp(allowedPath),
    })),
  }));
}

function isAllowedBy(entryMatcher, filePath) {
  return entryMatcher.matchers.some(({ regex }) => regex.test(filePath));
}

function listKnown(entries) {
  console.log("Modulos/camadas conhecidos:");
  for (const entry of entries) {
    console.log(`- ${entry.id}: ${entry.label || entry.id} (${entry.type || "sem tipo"})`);
  }
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
      usage();
      return;
    }

    const manifest = readJson(options.manifestPath);
    const entries = getEntries(manifest);
    const compiled = compileMatchers(entries);

    if (options.list) {
      listKnown(entries);
      return;
    }

    if (!options.moduleId) {
      throw new Error("Informe --module <id>.");
    }

    const requestedIds = [options.moduleId, ...options.allowedIds].map((id) => id.toLowerCase());
    const allowedEntries = compiled.filter(({ entry }) => requestedIds.includes(String(entry.id).toLowerCase()));
    const knownIds = new Set(entries.map((entry) => String(entry.id).toLowerCase()));
    const unknownIds = requestedIds.filter((id) => !knownIds.has(id));

    if (unknownIds.length > 0) {
      throw new Error(`Modulo/camada desconhecido: ${unknownIds.join(", ")}`);
    }

    const files = [
      ...options.files,
      ...(options.fromGit ? gitChangedFiles() : []),
    ]
      .map(normalizePath)
      .filter(Boolean);

    const uniqueFiles = [...new Set(files)];
    if (uniqueFiles.length === 0) {
      throw new Error("Nenhum arquivo informado. Use --files ou --from-git.");
    }

    const failures = [];
    const warnings = [];

    for (const filePath of uniqueFiles) {
      const forbidden = FORBIDDEN_PATTERNS.find((pattern) => pattern.test(filePath));
      if (forbidden) {
        failures.push(`${filePath}: caminho sensivel/bloqueado pelo gate.`);
        continue;
      }

      const allowed = allowedEntries.some((entryMatcher) => isAllowedBy(entryMatcher, filePath));
      if (allowed) {
        continue;
      }

      const owners = compiled
        .filter((entryMatcher) => isAllowedBy(entryMatcher, filePath))
        .map(({ entry }) => entry.id);

      if (owners.length > 0) {
        failures.push(`${filePath}: fora de ${requestedIds.join("+")}; pertence a ${owners.join(", ")}.`);
      } else {
        warnings.push(`${filePath}: nao mapeado no manifesto; exige classificacao Zeus antes de seguir.`);
      }
    }

    console.log(`Panteon Boundary Check`);
    console.log(`Modulo/camadas declarados: ${requestedIds.join(", ")}`);
    console.log(`Arquivos avaliados: ${uniqueFiles.length}`);

    if (warnings.length > 0) {
      console.log("\nAvisos:");
      for (const warning of warnings) {
        console.log(`- ${warning}`);
      }
    }

    if (failures.length > 0) {
      console.log("\nBLOQUEADO:");
      for (const failure of failures) {
        console.log(`- ${failure}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("\nPASS: recorte dentro das fronteiras declaradas.");
  } catch (error) {
    console.error(`BLOQUEADO: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
