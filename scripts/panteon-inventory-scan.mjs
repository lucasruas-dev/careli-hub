#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_BOUNDARY_MANIFEST = "docs/operations/panteon-module-boundary-manifest-v1.json";
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".css",
  ".scss",
  ".sql",
  ".yml",
  ".yaml",
  ".toml"
]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const EXCLUDED_DIRS = new Set([
  ".codex-artifacts",
  ".codex-deploy",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "node_modules",
  "dist",
  "build",
  "coverage"
]);

function usage() {
  return [
    "Uso:",
    "  node scripts/panteon-inventory-scan.mjs [--format markdown|json] [--top 30]",
    "",
    "Opcoes:",
    "  --format <tipo>      markdown ou json. Default: markdown.",
    "  --top <numero>       Quantidade de arquivos grandes/import edges. Default: 25.",
    `  --boundary <arquivo> Manifesto de fronteira. Default: ${DEFAULT_BOUNDARY_MANIFEST}`,
    "  --help               Mostra esta ajuda."
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    format: "markdown",
    top: 25,
    boundaryPath: DEFAULT_BOUNDARY_MANIFEST,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--format") {
      options.format = argv[index + 1] ?? options.format;
      index += 1;
    } else if (arg === "--top") {
      options.top = Number(argv[index + 1] ?? options.top);
      index += 1;
    } else if (arg === "--boundary") {
      options.boundaryPath = argv[index + 1] ?? options.boundaryPath;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Opcao desconhecida: ${arg}`);
    }
  }

  if (!Number.isFinite(options.top) || options.top <= 0) {
    throw new Error("--top precisa ser um numero positivo.");
  }

  if (!["markdown", "json"].includes(options.format)) {
    throw new Error("--format deve ser markdown ou json.");
  }

  return options;
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

function toArray(value) {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function readJsonIfExists(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function getBoundaryEntries(boundaryManifest) {
  if (!boundaryManifest) {
    return [];
  }

  return [
    ...toArray(boundaryManifest.modules),
    ...toArray(boundaryManifest.entries),
    ...toArray(boundaryManifest.hubModules),
    ...toArray(boundaryManifest.operationalLayers)
  ];
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
    if (matchesAnyPattern(filePath, getEntryPatterns(entry))) {
      return entry;
    }
  }

  return null;
}

function walkFiles(rootDir) {
  const files = [];

  function visit(currentDir) {
    if (!fs.existsSync(currentDir)) {
      return;
    }

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = normalizePath(path.relative(process.cwd(), absolutePath));

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          visit(absolutePath);
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  visit(path.resolve(rootDir));
  return files.sort((left, right) => left.localeCompare(right));
}

function countLines(filePath) {
  const extension = path.extname(filePath);
  if (!TEXT_EXTENSIONS.has(extension)) {
    return null;
  }

  const content = fs.readFileSync(path.resolve(filePath), "utf8");
  if (content.length === 0) {
    return 0;
  }

  return content.split(/\r\n|\r|\n/).length;
}

function getFirstSegmentAfterPrefix(filePath, prefix) {
  const normalizedPrefix = normalizePath(prefix);
  const normalizedPath = normalizePath(filePath);
  if (!normalizedPath.startsWith(`${normalizedPrefix}/`)) {
    return null;
  }

  return normalizedPath.slice(normalizedPrefix.length + 1).split("/")[0] ?? null;
}

function groupCount(files, prefix) {
  const counts = new Map();

  for (const filePath of files) {
    const segment = getFirstSegmentAfterPrefix(filePath, prefix);
    if (!segment) {
      continue;
    }

    counts.set(segment, (counts.get(segment) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function classifyLargeFile(lines) {
  if (lines >= 2000) {
    return "critico";
  }

  if (lines >= 1000) {
    return "ruim";
  }

  if (lines >= 500) {
    return "atencao";
  }

  return "ok";
}

function getRouteSummary(files) {
  const appFiles = files.filter((filePath) => filePath.startsWith("apps/hub/app/"));
  const pages = appFiles.filter((filePath) => /\/page\.(tsx|ts|jsx|js)$/.test(filePath));
  const layouts = appFiles.filter((filePath) => /\/layout\.(tsx|ts|jsx|js)$/.test(filePath));
  const routeHandlers = appFiles.filter((filePath) => /\/route\.(ts|js)$/.test(filePath));
  const apiRoutes = routeHandlers.filter((filePath) => filePath.startsWith("apps/hub/app/api/"));

  return {
    appFiles: appFiles.length,
    pages: pages.length,
    layouts: layouts.length,
    routeHandlers: routeHandlers.length,
    apiRoutes: apiRoutes.length
  };
}

function getSensitiveNames(files) {
  return files
    .filter((filePath) => {
      const basename = path.basename(filePath).toLowerCase();
      return basename === ".env" || basename.startsWith(".env.") || filePath.startsWith(".vercel/");
    })
    .map(normalizePath)
    .sort((left, right) => left.localeCompare(right));
}

function resolveImportTarget(sourceFile, specifier, allFileSet) {
  let basePath = null;

  if (specifier.startsWith(".")) {
    basePath = normalizePath(path.join(path.dirname(sourceFile), specifier));
  } else if (specifier.startsWith("@/")) {
    basePath = normalizePath(path.join("apps/hub", specifier.slice(2)));
  } else if (specifier.startsWith("apps/hub/") || specifier.startsWith("packages/")) {
    basePath = normalizePath(specifier);
  }

  if (!basePath) {
    return null;
  }

  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    `${basePath}.json`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
    `${basePath}/route.ts`,
    `${basePath}/page.tsx`
  ];

  return candidates.find((candidate) => allFileSet.has(candidate)) ?? null;
}

function extractImportSpecifiers(content) {
  const specifiers = new Set();
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match) {
      specifiers.add(match[1]);
      match = pattern.exec(content);
    }
  }

  return [...specifiers];
}

function getImportEdges(files, boundaryEntries, top) {
  const allFileSet = new Set(files);
  const codeFiles = files.filter((filePath) => CODE_EXTENSIONS.has(path.extname(filePath)));
  const edgeCounts = new Map();
  const examples = [];

  for (const filePath of codeFiles) {
    const sourceOwner = findOwnerForPath(filePath, boundaryEntries);
    const sourceOwnerId = sourceOwner ? getEntryId(sourceOwner) : null;
    if (!sourceOwnerId) {
      continue;
    }

    const content = fs.readFileSync(path.resolve(filePath), "utf8");
    for (const specifier of extractImportSpecifiers(content)) {
      const targetPath = resolveImportTarget(filePath, specifier, allFileSet);
      if (!targetPath) {
        continue;
      }

      const targetOwner = findOwnerForPath(targetPath, boundaryEntries);
      const targetOwnerId = targetOwner ? getEntryId(targetOwner) : null;
      if (!targetOwnerId || targetOwnerId === sourceOwnerId) {
        continue;
      }

      const key = `${sourceOwnerId} -> ${targetOwnerId}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      if (examples.length < top) {
        examples.push({
          edge: key,
          source: filePath,
          target: targetPath,
          specifier
        });
      }
    }
  }

  return {
    counts: [...edgeCounts.entries()]
      .map(([edge, count]) => ({ edge, count }))
      .sort((left, right) => right.count - left.count || left.edge.localeCompare(right.edge)),
    examples
  };
}

function scan(options) {
  const files = walkFiles(".");
  const boundaryManifest = readJsonIfExists(options.boundaryPath);
  const boundaryEntries = getBoundaryEntries(boundaryManifest);
  const fileStats = files
    .map((filePath) => ({
      path: filePath,
      extension: path.extname(filePath),
      lines: countLines(filePath),
      owner: getEntryId(findOwnerForPath(filePath, boundaryEntries) ?? {}) ?? null
    }))
    .filter((stat) => stat.lines !== null);
  const largeFiles = fileStats
    .filter((stat) => stat.lines >= 500)
    .map((stat) => ({
      ...stat,
      severity: classifyLargeFile(stat.lines)
    }))
    .sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path));

  return {
    generatedAt: new Date().toISOString(),
    totalFiles: files.length,
    routeSummary: getRouteSummary(files),
    topLevel: groupCount(files, "."),
    hubApp: groupCount(files, "apps/hub/app"),
    hubModules: groupCount(files, "apps/hub/modules"),
    hubLib: groupCount(files, "apps/hub/lib"),
    hubComponents: groupCount(files, "apps/hub/components"),
    packages: groupCount(files, "packages"),
    scripts: files.filter((filePath) => filePath.startsWith("scripts/")).length,
    operationsDocs: files.filter((filePath) => filePath.startsWith("docs/operations/")).length,
    architectureDocs: files.filter((filePath) => filePath.startsWith("docs/architecture/")).length,
    sensitiveNames: getSensitiveNames(files),
    largeFiles: largeFiles.slice(0, options.top),
    largeFileTotals: {
      attention: largeFiles.filter((file) => file.severity === "atencao").length,
      poor: largeFiles.filter((file) => file.severity === "ruim").length,
      critical: largeFiles.filter((file) => file.severity === "critico").length
    },
    importEdges: getImportEdges(files, boundaryEntries, options.top)
  };
}

function renderTable(rows, headers) {
  const headerLine = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${headers.map((header) => String(row[header] ?? "")).join(" | ")} |`);
  return [headerLine, divider, ...body].join("\n");
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Panteon Inventory Scan");
  lines.push("");
  lines.push(`Gerado em: \`${report.generatedAt}\``);
  lines.push(`Arquivos avaliados: \`${report.totalFiles}\``);
  lines.push("");
  lines.push("## Rotas do Hub");
  lines.push("");
  lines.push(renderTable([report.routeSummary], ["appFiles", "pages", "layouts", "routeHandlers", "apiRoutes"]));
  lines.push("");
  lines.push("## Diretorios principais");
  lines.push("");
  lines.push("### apps/hub/app");
  lines.push(renderTable(report.hubApp.slice(0, 20), ["name", "count"]));
  lines.push("");
  lines.push("### apps/hub/modules");
  lines.push(renderTable(report.hubModules, ["name", "count"]));
  lines.push("");
  lines.push("### apps/hub/lib");
  lines.push(renderTable(report.hubLib.slice(0, 30), ["name", "count"]));
  lines.push("");
  lines.push("### apps/hub/components");
  lines.push(renderTable(report.hubComponents.slice(0, 30), ["name", "count"]));
  lines.push("");
  lines.push("### packages");
  lines.push(renderTable(report.packages, ["name", "count"]));
  lines.push("");
  lines.push("## Arquivos grandes");
  lines.push("");
  lines.push(`Atencao: \`${report.largeFileTotals.attention}\`; ruim: \`${report.largeFileTotals.poor}\`; critico: \`${report.largeFileTotals.critical}\`.`);
  lines.push("");
  lines.push(renderTable(
    report.largeFiles.map((file) => ({
      severity: file.severity,
      lines: file.lines,
      owner: file.owner ?? "sem-owner",
      path: file.path
    })),
    ["severity", "lines", "owner", "path"]
  ));
  lines.push("");
  lines.push("## Imports entre owners");
  lines.push("");
  if (report.importEdges.counts.length === 0) {
    lines.push("Nenhum import cross-owner resolvido pelo scanner local.");
  } else {
    lines.push(renderTable(report.importEdges.counts.slice(0, 20), ["edge", "count"]));
  }
  lines.push("");
  lines.push("### Exemplos");
  lines.push("");
  if (report.importEdges.examples.length === 0) {
    lines.push("Nenhum exemplo resolvido.");
  } else {
    lines.push(renderTable(report.importEdges.examples, ["edge", "source", "target", "specifier"]));
  }
  lines.push("");
  lines.push("## Nomes sensiveis detectados");
  lines.push("");
  if (report.sensitiveNames.length === 0) {
    lines.push("Nenhum arquivo `.env*` ou `.vercel` incluido pela varredura.");
  } else {
    for (const filePath of report.sensitiveNames) {
      lines.push(`- \`${filePath}\``);
    }
  }

  return lines.join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    return;
  }

  const report = scan(options);
  if (options.format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderMarkdown(report));
  }
}

try {
  main();
} catch (error) {
  console.error(`BLOQUEADO: ${error.message}`);
  process.exitCode = 1;
}
