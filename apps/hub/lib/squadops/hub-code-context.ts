import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type HubCodeContextFile = {
  excerpt: string;
  path: string;
  reason: string;
  size: number;
};

export type HubCodeContext = {
  excluded: string[];
  files: HubCodeContextFile[];
  generatedAt: string;
  root: string;
  scannedFiles: number;
  summary: string;
};

const MAX_CONTEXT_FILES = 34;
const MAX_EXCERPT_CHARS = 4_000;
const MAX_TOTAL_EXCERPT_CHARS = 72_000;

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "storybook-static",
]);

const ignoredExactFiles = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const allowedExtensions = new Set([
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
]);

const sensitiveFilePatterns = [
  /^\.env/i,
  /\.env/i,
  /\.key$/i,
  /\.pem$/i,
  /\.pfx$/i,
  /\.crt$/i,
  /secret/i,
  /token/i,
  /credential/i,
];

const corePathHints = [
  "apps/hub/app/api",
  "apps/hub/layouts",
  "apps/hub/lib",
  "apps/hub/modules",
  "packages/shared/src",
  "packages/uix/src",
  "docs/codex",
];

export async function loadHubCodeContext(question: string): Promise<HubCodeContext> {
  const root = await resolveHubRoot();
  const keywords = extractQuestionKeywords(question);
  const candidates = await collectCodeFiles(root);
  const rankedFiles = rankCodeFiles(candidates, keywords);
  const files: HubCodeContextFile[] = [];
  let totalExcerptChars = 0;

  for (const candidate of rankedFiles) {
    if (files.length >= MAX_CONTEXT_FILES) {
      break;
    }

    if (totalExcerptChars >= MAX_TOTAL_EXCERPT_CHARS) {
      break;
    }

    const absolutePath = path.join(root, candidate.relativePath);
    const content = await readFile(absolutePath, "utf8").catch(() => "");

    if (!content.trim()) {
      continue;
    }

    const excerpt = buildRelevantExcerpt(content, keywords);

    files.push({
      excerpt,
      path: candidate.relativePath,
      reason: candidate.reason,
      size: candidate.size,
    });
    totalExcerptChars += excerpt.length;
  }

  return {
    excluded: [
      ".env*",
      ".git",
      ".next",
      ".turbo",
      ".vercel",
      "node_modules",
      "dist",
      "coverage",
      "arquivos binarios",
      "chaves, tokens e credenciais",
      "lockfiles grandes",
    ],
    files,
    generatedAt: new Date().toISOString(),
    root,
    scannedFiles: candidates.length,
    summary:
      "Mapa server-side do codigo do Hub com arquivos ranqueados por relevancia. Segredos e artefatos gerados foram excluidos por seguranca.",
  };
}

async function resolveHubRoot() {
  let currentDirectory = process.cwd();

  for (let index = 0; index < 6; index += 1) {
    const diaryPath = path.join(
      currentDirectory,
      "docs",
      "codex",
      "engineering-operations.md",
    );
    const hasDiary = await stat(diaryPath)
      .then((entry) => entry.isFile())
      .catch(() => false);

    if (hasDiary) {
      return currentDirectory;
    }

    const parentDirectory = path.dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      break;
    }

    currentDirectory = parentDirectory;
  }

  return process.cwd();
}

async function collectCodeFiles(root: string) {
  const files: { relativePath: string; size: number }[] = [];

  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    );

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizePath(path.relative(root, absolutePath));

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          await walk(absolutePath);
        }
        continue;
      }

      if (!entry.isFile() || shouldIgnoreFile(relativePath)) {
        continue;
      }

      const fileStat = await stat(absolutePath).catch(() => null);

      if (!fileStat || fileStat.size > 160_000) {
        continue;
      }

      files.push({
        relativePath,
        size: fileStat.size,
      });
    }
  }

  await walk(root);
  return files;
}

function shouldIgnoreFile(relativePath: string) {
  const basename = path.basename(relativePath);
  const extension = path.extname(relativePath).toLowerCase();

  return (
    ignoredExactFiles.has(basename) ||
    !allowedExtensions.has(extension) ||
    sensitiveFilePatterns.some((pattern) => pattern.test(basename)) ||
    sensitiveFilePatterns.some((pattern) => pattern.test(relativePath))
  );
}

function rankCodeFiles(
  files: { relativePath: string; size: number }[],
  keywords: string[],
) {
  return files
    .map((file) => {
      const normalizedPath = normalizeSearchText(file.relativePath);
      const keywordScore = keywords.reduce(
        (score, keyword) =>
          normalizedPath.includes(keyword) ? score + 12 : score,
        0,
      );
      const coreScore = corePathHints.reduce(
        (score, hint) =>
          file.relativePath.startsWith(hint) ? score + 5 : score,
        0,
      );
      const rootScore = file.relativePath.split("/").length <= 2 ? 4 : 0;
      const squadOpsScore = normalizedPath.includes("squadops") ? 8 : 0;
      const hubScore = normalizedPath.includes("hub") ? 3 : 0;
      const score =
        keywordScore + coreScore + rootScore + squadOpsScore + hubScore;

      return {
        ...file,
        reason:
          keywordScore > 0
            ? "relacionado a pergunta"
            : coreScore > 0
              ? "area central do Hub"
              : "contexto estrutural",
        score,
      };
    })
    .sort((left, right) => right.score - left.score || left.size - right.size);
}

function buildRelevantExcerpt(content: string, keywords: string[]) {
  const normalizedContent = normalizeSearchText(content);
  const firstKeyword = keywords.find((keyword) =>
    normalizedContent.includes(keyword),
  );

  if (!firstKeyword) {
    return content.slice(0, MAX_EXCERPT_CHARS);
  }

  const index = normalizedContent.indexOf(firstKeyword);
  const start = Math.max(0, index - 1_200);
  const end = Math.min(content.length, index + MAX_EXCERPT_CHARS - 1_200);

  return content.slice(start, end);
}

function extractQuestionKeywords(question: string) {
  const explicitKeywords = [
    "guardian",
    "caredesk",
    "pulsex",
    "hubops",
    "squadops",
    "releaseops",
    "supportops",
    "setup",
    "supabase",
    "api",
    "sidebar",
    "timeline",
    "deploy",
    "auditoria",
    "codigo",
  ];
  const words = normalizeSearchText(question)
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length >= 4);

  return Array.from(new Set([...explicitKeywords, ...words])).slice(0, 40);
}

function normalizePath(value: string) {
  return value.split(path.sep).join("/");
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
