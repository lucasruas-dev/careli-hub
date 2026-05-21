import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  UNKNOWN_OPERATION_VALUE,
  type EngineeringOperationRecord,
  type EngineeringOperationsFilters,
} from "./engineering-operations-parser";

type ReleaseRegisterEnvironment = "homologacao" | "producao";

type ReleaseRegisterFileDefinition = {
  environment: ReleaseRegisterEnvironment;
  marker: string;
  path: string;
};

export type ReleaseRegisterSourceSummary = {
  environment: ReleaseRegisterEnvironment;
  error: string | null;
  exists: boolean;
  path: string;
  recordsCount: number;
};

export type ReleaseRegistersResponse = {
  filters: EngineeringOperationsFilters;
  generatedAt: string;
  records: EngineeringOperationRecord[];
  releaseRecords: EngineeringOperationRecord[];
  sourcePath: string;
  sourcePaths: string[];
  sources: ReleaseRegisterSourceSummary[];
};

const releaseRegisterFiles = [
  {
    environment: "homologacao",
    marker: "Registro de homologacao:",
    path: path.join("docs", "operations", "releases-homologation.md"),
  },
  {
    environment: "producao",
    marker: "Registro de producao:",
    path: path.join("docs", "operations", "releases-production.md"),
  },
] as const satisfies ReleaseRegisterFileDefinition[];

export async function loadReleaseRegistersFromFiles() {
  const generatedAt = new Date().toISOString();
  const records: EngineeringOperationRecord[] = [];
  const sources: ReleaseRegisterSourceSummary[] = [];

  for (const file of releaseRegisterFiles) {
    const resolvedPath = await resolveWorkspacePath(file.path);

    if (!resolvedPath) {
      sources.push({
        environment: file.environment,
        error: "Arquivo nao encontrado no workspace.",
        exists: false,
        path: normalizePath(file.path),
        recordsCount: 0,
      });
      continue;
    }

    try {
      const content = await readFile(resolvedPath, "utf8");
      const parsedRecords = parseReleaseRegisterMarkdown(content, file, {
        sourceOffset: records.length,
      });

      records.push(...parsedRecords);
      sources.push({
        environment: file.environment,
        error: null,
        exists: true,
        path: normalizePath(file.path),
        recordsCount: parsedRecords.length,
      });
    } catch {
      sources.push({
        environment: file.environment,
        error: "Nao foi possivel ler o arquivo.",
        exists: true,
        path: normalizePath(file.path),
        recordsCount: 0,
      });
    }
  }

  const sortedRecords = records.sort(compareOperationRecordsDesc);

  return {
    filters: buildReleaseRegisterFilters(sortedRecords),
    generatedAt,
    records: sortedRecords,
    releaseRecords: sortedRecords,
    sourcePath: releaseRegisterFiles
      .map((file) => normalizePath(file.path))
      .join(" + "),
    sourcePaths: releaseRegisterFiles.map((file) => normalizePath(file.path)),
    sources,
  } satisfies ReleaseRegistersResponse;
}

function parseReleaseRegisterMarkdown(
  content: string,
  file: ReleaseRegisterFileDefinition,
  options: {
    sourceOffset: number;
  },
) {
  const lines = content.split(/\r?\n/);
  const recordsSectionStart = lines.findIndex(
    (line) => normalizeSearchText(line) === "## registros",
  );
  const searchableLines =
    recordsSectionStart >= 0 ? lines.slice(recordsSectionStart + 1) : lines;
  const searchableOffset = recordsSectionStart >= 0 ? recordsSectionStart + 1 : 0;
  const starts = searchableLines
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => line.trim() === file.marker)
    .map(({ index }) => index + searchableOffset);

  return starts.map((start, blockIndex) => {
    const end = starts[blockIndex + 1] ?? lines.length;
    const blockLines = lines.slice(start + 1, end);

    return parseReleaseRegisterBlock(blockLines, {
      environment: file.environment,
      lineStart: start + 1,
      sourceIndex: options.sourceOffset + blockIndex + 1,
      sourcePath: normalizePath(file.path),
    });
  });
}

function parseReleaseRegisterBlock(
  blockLines: string[],
  context: {
    environment: ReleaseRegisterEnvironment;
    lineStart: number;
    sourceIndex: number;
    sourcePath: string;
  },
): EngineeringOperationRecord {
  const rawContent = trimBlankLines(blockLines).join("\n").trim();
  const fields = collectTopLevelFields(blockLines);
  const subject = normalizePanteonNaming(
    getField(fields, ["assunto"]) || inferSubject(rawContent),
  );
  const moduleName = inferModuleName(
    subject,
    getField(fields, ["modulo/agente", "squad/agente responsavel"]),
    rawContent,
  );
  const status = normalizeStatus(getField(fields, ["status"]));
  const deployment =
    context.environment === "homologacao"
      ? getField(fields, ["deployment/alias de homologacao"])
      : getField(fields, ["deployment novo"]);
  const affectedFiles =
    context.environment === "homologacao"
      ? getField(fields, ["arquivos/modulos afetados"])
      : getField(fields, ["arquivos/modulos incluidos"]);
  const macroSummary =
    context.environment === "homologacao"
      ? getField(fields, ["escopo do recorte"])
      : getField(fields, ["escopo publicado"]);
  const reason =
    context.environment === "homologacao"
      ? getField(fields, ["origem"])
      : getField(fields, ["origem/homologacao de referencia"]);
  const healthchecks =
    context.environment === "homologacao"
      ? getField(fields, ["healthchecks de homologacao"])
      : getField(fields, ["healthchecks pos-deploy"]);
  const validation = getField(fields, ["validacoes executadas"]);
  const risks = getField(fields, ["riscos conhecidos"]);
  const pending = getField(fields, ["pendencias"]);
  const nextAction = getField(fields, ["proxima acao"]);
  const relatedProtocols = getField(fields, [
    "protocolos/atividades relacionados",
  ]);
  const primaryProtocol =
    extractFirstProtocol(relatedProtocols) ??
    buildReleaseRegisterProtocol(context.environment, context.sourceIndex);
  const shortSummary = compactText(
    firstKnownValue([macroSummary, reason, pending, rawContent]),
    220,
  );

  return {
    affectedFiles,
    changeCategory:
      context.environment === "homologacao"
        ? "Deploy homologacao"
        : "Deploy producao",
    commit:
      context.environment === "homologacao"
        ? getField(fields, ["commit de homologacao"])
        : getField(fields, ["commit publicado"]),
    deploy: deployment,
    healthchecks,
    how: firstKnownValue([deployment, validation, healthchecks]),
    id: `release-${context.environment}-${context.lineStart}-${context.sourceIndex}`,
    isCritical: hasCriticalSignal(status, risks, pending, rawContent),
    isModuleImprovement: false,
    isRelease: true,
    isSupportInvestigation: false,
    lineStart: context.lineStart,
    localDateTime: getField(fields, ["data e hora local"]),
    logic: `Fonte: ${context.sourcePath}`,
    macroSummary,
    module: moduleName,
    nextSquad: firstKnownValue([nextAction, pending]),
    protocol: primaryProtocol,
    rawContent: rawContent || UNKNOWN_OPERATION_VALUE,
    reason,
    risks,
    routine: "Auditoria de deploy",
    screen: "Zeus / Deploys",
    shortSummary,
    sourceIndex: context.sourceIndex,
    squad: inferSquad(moduleName, context.environment),
    status,
    subject,
    type:
      context.environment === "homologacao"
        ? "RELEASE HOMOLOGACAO"
        : "RELEASE PRODUCAO",
    validation,
  };
}

function collectTopLevelFields(lines: string[]) {
  const fields = new Map<string, string>();
  let activeLabel: string | null = null;

  for (const line of lines) {
    const match = line.match(/^-\s*([^:]+):\s*(.*)$/);

    if (match) {
      activeLabel = normalizeLabel(match[1] ?? "");
      appendField(fields, activeLabel, match[2] ?? "");
      continue;
    }

    if (!activeLabel) {
      continue;
    }

    const value = line.trim();

    if (!value) {
      continue;
    }

    appendField(fields, activeLabel, value);
  }

  return fields;
}

function appendField(fields: Map<string, string>, label: string, value: string) {
  const cleaned = cleanFieldValue(value);

  if (!cleaned) {
    return;
  }

  const current = fields.get(label);
  fields.set(label, current ? `${current}\n${cleaned}` : cleaned);
}

function getField(fields: Map<string, string>, labels: string[]) {
  for (const label of labels) {
    const value = fields.get(normalizeLabel(label));

    if (value) {
      return cleanFieldValue(value) || UNKNOWN_OPERATION_VALUE;
    }
  }

  return UNKNOWN_OPERATION_VALUE;
}

async function resolveWorkspacePath(relativePath: string) {
  const candidates = [
    path.join(/*turbopackIgnore: true*/ process.cwd(), relativePath),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "..", relativePath),
    path.join(/*turbopackIgnore: true*/ process.cwd(), "..", "..", relativePath),
    path.join(
      /*turbopackIgnore: true*/ process.cwd(),
      "..",
      "..",
      "..",
      relativePath,
    ),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function buildReleaseRegisterFilters(
  records: EngineeringOperationRecord[],
): EngineeringOperationsFilters {
  return {
    modules: uniqueSorted(records.map((record) => record.module)),
    routines: uniqueSorted(records.map((record) => record.routine)),
    squads: uniqueSorted(records.map((record) => record.squad)),
    statuses: uniqueSorted(records.map((record) => record.status)),
    types: uniqueSorted(records.map((record) => record.type)),
  };
}

function inferSubject(rawContent: string) {
  const bracketed = rawContent.match(/\[[^\]]+\][^\n.]*/)?.[0];

  if (bracketed) {
    return cleanFieldValue(bracketed);
  }

  const firstLine = rawContent
    .split("\n")
    .map((line) => cleanFieldValue(line.replace(/^-+\s*/, "")))
    .find(Boolean);

  return firstLine ? compactText(firstLine, 100) : UNKNOWN_OPERATION_VALUE;
}

function inferModuleName(subject: string, agent: string, rawContent: string) {
  const bracket = subject.match(/\[([^\]]+)\]/)?.[1];

  return normalizeModuleAlias(
    firstKnownValue([
      bracket ? cleanFieldValue(bracket) : UNKNOWN_OPERATION_VALUE,
      agent,
      inferModuleFromText(`${subject}\n${agent}\n${rawContent}`),
    ]),
  );
}

function inferModuleFromText(value: string) {
  const knownModules = [
    "Zeus",
    "Hefesto",
    "Iris",
    "Hermes",
    "Hades",
    "Atlas",
    "Chronos",
    "Setup",
    "Panteon",
  ];
  const normalizedValue = normalizeSearchText(value);
  const match = knownModules.find((moduleName) =>
    normalizedValue.includes(normalizeSearchText(moduleName)),
  );

  return match ?? UNKNOWN_OPERATION_VALUE;
}

function inferSquad(moduleName: string, environment: ReleaseRegisterEnvironment) {
  if (moduleName === "Hefesto") {
    return "Hefesto";
  }

  return `${moduleName} Core / ${environment}`;
}

function extractFirstProtocol(value: string) {
  const match = value.match(/\b(?:AT|CB|TI|OP|AL|DP)-[A-Z0-9-]+\b/i);

  return match?.[0]?.toUpperCase() ?? null;
}

function buildReleaseRegisterProtocol(
  environment: ReleaseRegisterEnvironment,
  sourceIndex: number,
) {
  const prefix = environment === "homologacao" ? "DP-HOM" : "DP-PROD";

  return `${prefix}-${String(sourceIndex).padStart(6, "0")}`;
}

function normalizeStatus(value: string) {
  const cleaned = cleanFieldValue(value);
  const backticked = cleaned.match(/`([^`]+)`/)?.[1];
  const status = cleanFieldValue(backticked ?? cleaned);

  return status || UNKNOWN_OPERATION_VALUE;
}

function normalizeLabel(value: string) {
  return normalizeSearchText(value)
    .replace(/dominos/g, "dominios")
    .replace(/modulos/g, "modulos")
    .replace(/\s+/g, " ");
}

function cleanFieldValue(value: string) {
  return value
    .trim()
    .replace(/^`([^`]+)`\.?$/, "$1")
    .replace(/\s+$/g, "")
    .trim();
}

function trimBlankLines(lines: string[]) {
  let start = 0;
  let end = lines.length;

  while (start < end && !lines[start]?.trim()) {
    start += 1;
  }

  while (end > start && !lines[end - 1]?.trim()) {
    end -= 1;
  }

  return lines.slice(start, end);
}

function firstKnownValue(values: Array<string | null | undefined>) {
  return (
    values
      .map((value) => value?.trim() ?? "")
      .find((value) => value && value !== UNKNOWN_OPERATION_VALUE) ??
    UNKNOWN_OPERATION_VALUE
  );
}

function compactText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return UNKNOWN_OPERATION_VALUE;
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`
    : normalized;
}

function hasCriticalSignal(
  status: string,
  risks: string,
  pending: string,
  rawContent: string,
) {
  const text = normalizeSearchText(`${status} ${risks} ${pending} ${rawContent}`);

  return (
    text.includes("bloqueado") ||
    text.includes("necessita correcao") ||
    text.includes("operacional com atencao") ||
    text.includes("rollback") ||
    text.includes("risco")
  );
}

function compareOperationRecordsDesc(
  first: EngineeringOperationRecord,
  second: EngineeringOperationRecord,
) {
  const firstTime = getRecordTime(first);
  const secondTime = getRecordTime(second);

  if (secondTime !== firstTime) {
    return secondTime - firstTime;
  }

  return second.sourceIndex - first.sourceIndex;
}

function getRecordTime(record: EngineeringOperationRecord) {
  const normalizedDateTime = record.localDateTime
    .trim()
    .replace(
      /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+([+-]\d{2}:?\d{2})$/,
      "$1T$2$3",
    )
    .replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  const parsed = new Date(normalizedDateTime).getTime();

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return record.sourceIndex;
}

function uniqueSorted(values: string[]) {
  return Array.from(
    new Set(values.filter((value) => value && value !== UNKNOWN_OPERATION_VALUE)),
  ).sort((first, second) => first.localeCompare(second, "pt-BR"));
}

function normalizePanteonNaming(value: string) {
  return value
    .replace(/\bHubOps\b/g, "Zeus")
    .replace(/\bSquadOps\b/g, "Zeus")
    .replace(/\bGuardian\b/g, "Hades")
    .replace(/\bCareDesk\b|\bCoreDesk\b/g, "Iris")
    .replace(/\bPulseX\b/g, "Hermes");
}

function normalizeModuleAlias(value: string) {
  const cleaned = normalizePanteonNaming(value)
    .replace(/\bCore\b/gi, "")
    .replace(/\bautorizado\b/gi, "")
    .trim();
  const normalized = normalizeSearchText(cleaned);

  if (normalized.includes("zeus")) {
    return "Zeus";
  }

  if (normalized.includes("hefesto")) {
    return "Hefesto";
  }

  if (normalized.includes("iris")) {
    return "Iris";
  }

  if (normalized.includes("hermes")) {
    return "Hermes";
  }

  if (normalized.includes("hades")) {
    return "Hades";
  }

  if (normalized.includes("atlas")) {
    return "Atlas";
  }

  if (normalized.includes("chronos")) {
    return "Chronos";
  }

  if (normalized.includes("setup")) {
    return "Setup";
  }

  if (normalized.includes("panteon")) {
    return "Panteon";
  }

  return cleaned || UNKNOWN_OPERATION_VALUE;
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/");
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
