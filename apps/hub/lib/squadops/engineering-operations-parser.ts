export const UNKNOWN_OPERATION_VALUE = "não informado";

export type EngineeringOperationRecord = {
  affectedFiles: string;
  changeCategory: string;
  commit: string;
  deploy: string;
  healthchecks: string;
  how: string;
  id: string;
  isCritical: boolean;
  isModuleImprovement: boolean;
  isRelease: boolean;
  isSupportInvestigation: boolean;
  lineStart: number;
  localDateTime: string;
  logic: string;
  macroSummary: string;
  module: string;
  nextSquad: string;
  protocol: string;
  rawContent: string;
  reason: string;
  risks: string;
  routine: string;
  screen: string;
  shortSummary: string;
  sourceIndex: number;
  squad: string;
  status: string;
  subject: string;
  type: string;
  validation: string;
};

export type EngineeringAuditRoutine = {
  consolidatedResult: string;
  frequency: string;
  history: EngineeringOperationRecord[];
  id: string;
  isOverdue: boolean;
  lastExecution: string;
  lastStatus: string;
  name: string;
  responsible: string;
  script: string;
};

export type EngineeringOperationsFilters = {
  modules: string[];
  routines: string[];
  squads: string[];
  statuses: string[];
  types: string[];
};

export type EngineeringOperationsMetrics = {
  latestDeploys: number;
  moduleImprovements: number;
  productionRecords: number;
  riskRecords: number;
  routinesOverdue: number;
  supportInvestigations: number;
  totalRecords: number;
  waitingReleaseOps: number;
};

export type EngineeringOperationsResponse = {
  auditRoutines: EngineeringAuditRoutine[];
  criticalRecords: EngineeringOperationRecord[];
  filters: EngineeringOperationsFilters;
  generatedAt: string;
  metrics: EngineeringOperationsMetrics;
  records: EngineeringOperationRecord[];
  releaseRecords: EngineeringOperationRecord[];
  sourcePath: string;
  statusConsolidated: string;
};

type ParseOptions = {
  generatedAt?: string;
  sourcePath?: string;
};

const recordMarker = "Registro de diario:";

const statusTerms = [
  "ANALISANDO",
  "IMPLEMENTANDO",
  "VALIDANDO",
  "AGUARDANDO RELEASEOPS",
  "AGUARDANDO ARCHITECT",
  "AGUARDANDO DEPLOY",
  "FINALIZADO",
  "BLOQUEADO",
  "EM PRODUCAO",
  "EM PRODUÇÃO",
  "OPERACIONAL COM ATENCAO",
  "OPERACIONAL COM ATENÇÃO",
  "NECESSITA CORRECAO",
  "NECESSITA CORREÇÃO",
  "AGUARDANDO QA",
  "APROVADO COM AJUSTES",
] as const;

const typeTerms = [
  "RELEASE",
  "HOTFIX",
  "INVESTIGACAO",
  "INVESTIGAÇÃO",
  "INCIDENTE",
  "MELHORIA",
  "DECISAO",
  "DECISÃO",
  "AUDITORIA",
  "HEALTHCHECK",
  "CORRECAO",
  "CORREÇÃO",
] as const;

const knownModules = [
  "Guardian",
  "CareDesk",
  "PulseX",
  "SquadOps",
  "ReleaseOps",
  "SupportOps",
  "Setup",
  "Hub Shell",
  "D4Sign",
  "Asaas",
  "Supabase",
  "Vercel",
  "Engenharia",
] as const;

const auditRoutineDefinitions = [
  {
    frequency: "Diária",
    id: "daily-audit",
    match: ["auditoria diaria", "auditoria operacional diaria"],
    name: "Auditoria diária",
    responsible: "Hub ReleaseOps",
    script:
      "Revisar registros das últimas 24h, checar status abertos, pendências críticas, handoffs para ReleaseOps e divergências no diário.",
  },
  {
    frequency: "Semanal",
    id: "weekly-audit",
    match: ["auditoria semanal"],
    name: "Auditoria semanal",
    responsible: "Hub ReleaseOps",
    script:
      "Consolidar releases da semana, módulos com maior risco, bugs recorrentes, gaps de validação e prioridades para a próxima semana.",
  },
  {
    frequency: "Mensal",
    id: "monthly-audit",
    match: ["auditoria mensal"],
    name: "Auditoria mensal",
    responsible: "Hub ReleaseOps",
    script:
      "Revisar evolução mensal da engenharia, saúde dos módulos, riscos estruturais, qualidade das releases e backlog de governança.",
  },
  {
    frequency: "Diária",
    id: "operational-healthcheck",
    match: ["healthcheck operacional", "healthcheck operacional diario"],
    name: "Healthcheck operacional",
    responsible: "Hub ReleaseOps",
    script:
      "Checar rotas principais, APIs protegidas, Supabase, Vercel, logs críticos, produção e integrações sensíveis com sinais não destrutivos.",
  },
  {
    frequency: "Por release",
    id: "deploy-audit",
    match: ["deploy", "release", "producao"],
    name: "Auditoria de deploy",
    responsible: "Hub ReleaseOps",
    script:
      "Confirmar commit, deploy, ambiente, healthchecks, alias de produção, logs de erro, riscos conhecidos e status final da release.",
  },
  {
    frequency: "Sob demanda",
    id: "bugs-bottlenecks-audit",
    match: ["supportops", "investigacao", "bugs", "gargalos", "lentidao"],
    name: "Auditoria de bugs/gargalos",
    responsible: "Hub SupportOps",
    script:
      "Separar evidência de hipótese, revisar logs, APIs instáveis, gargalos, regressões, impacto operacional e próxima squad responsável.",
  },
  {
    frequency: "Diária",
    id: "critical-pending-audit",
    match: [
      "necessita correcao",
      "operacional com atencao",
      "bloqueado",
      "aguardando releaseops",
      "pendencias criticas",
    ],
    name: "Auditoria de pendências críticas",
    responsible: "Hub ReleaseOps",
    script:
      "Consolidar riscos conhecidos, status críticos, pendências aguardando ReleaseOps e rotinas vencidas ou ainda não executadas.",
  },
] as const;

export function parseEngineeringOperationsMarkdown(
  content: string,
  options: ParseOptions = {},
): EngineeringOperationsResponse {
  const lines = content.split(/\r?\n/);
  const starts = lines
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => line.trim() === recordMarker)
    .map(({ index }) => index);

  const records = starts
    .map((start, blockIndex) => {
      const end = starts[blockIndex + 1] ?? lines.length;
      const blockLines = lines.slice(start + 1, end);

      return parseRecordBlock(blockLines, {
        lineStart: start + 1,
        sourceIndex: blockIndex + 1,
      });
    })
    .reverse();
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const auditRoutines = buildAuditRoutines(records, generatedAt);
  const criticalRecords = records.filter((record) => record.isCritical);
  const releaseRecords = records.filter((record) => record.isRelease);
  const metrics = buildMetrics(records, auditRoutines);

  return {
    auditRoutines,
    criticalRecords,
    filters: buildFilters(records),
    generatedAt,
    metrics,
    records,
    releaseRecords,
    sourcePath: options.sourcePath ?? "docs/operations/engineering-operations.md",
    statusConsolidated: buildStatusConsolidated(metrics),
  };
}

function parseRecordBlock(
  blockLines: string[],
  context: {
    lineStart: number;
    sourceIndex: number;
  },
): EngineeringOperationRecord {
  const rawContent = trimBlankLines(blockLines).join("\n").trim();
  const fields = collectFields(blockLines);
  const subject = normalizeSquadOpsNaming(
    getField(fields, ["assunto"]) || inferSubject(rawContent),
  );
  const moduleName = inferModule(subject, rawContent);
  const localDateTime = getField(fields, ["data e hora local"]);
  const status = normalizeStatus(getField(fields, ["status operacional"]));
  const type = normalizeType(getField(fields, ["tipo da alteracao"]), rawContent);
  const changeCategory = inferChangeCategory(type, subject, rawContent);
  const affectedFiles = getField(fields, [
    "arquivos/modulos afetados",
    "escopo avaliado",
    "ambiente afetado",
  ]);
  const risks = getField(fields, [
    "pendencias ou riscos conhecidos",
    "riscos operacionais",
    "problemas encontrados",
    "apis instaveis ou com atencao",
    "impacto operacional",
  ]);
  const commit = getField(fields, [
    "commit realizado",
    "commit semantico planejado",
  ]);
  const deploy = getField(fields, ["deploy realizado"]);
  const healthchecks = getField(fields, ["resultado dos healthchecks"]);
  const macroSummary = getField(fields, [
    "resumo macro do que foi alterado",
    "resumo macro",
  ]);
  const reason = getField(fields, ["motivo da mudanca"]);
  const how = getField(fields, ["como foi feito"]);
  const shortSummary = firstKnownValue([macroSummary, reason, how, rawContent]);
  const isRelease = hasReleaseSignal(type, subject, commit, deploy, healthchecks);
  const isSupportInvestigation = hasSupportSignal(type, subject, rawContent);
  const isModuleImprovement = hasImprovementSignal(type, subject, rawContent);
  const isCritical = hasCriticalSignal(status, risks, rawContent);
  const routine = inferRoutine({
    isCritical,
    isRelease,
    isSupportInvestigation,
    rawContent,
    subject,
    type,
  });

  return {
    affectedFiles,
    changeCategory,
    commit,
    deploy,
    healthchecks,
    how,
    id: `operation-${context.lineStart}-${context.sourceIndex}`,
    isCritical,
    isModuleImprovement,
    isRelease,
    isSupportInvestigation,
    lineStart: context.lineStart,
    localDateTime,
    logic: getField(fields, ["logica utilizada"]),
    macroSummary,
    module: moduleName,
    nextSquad: getField(fields, [
      "proxima squad recomendada",
      "recomendacoes",
      "recomendacao tecnica",
    ]),
    protocol: buildOperationProtocol(context.sourceIndex),
    rawContent: rawContent || UNKNOWN_OPERATION_VALUE,
    reason,
    risks,
    routine,
    screen: inferScreen(subject, affectedFiles, rawContent),
    shortSummary: compactText(shortSummary, 220),
    sourceIndex: context.sourceIndex,
    squad: getField(fields, ["nome da squad/agente"]) || inferSquad(moduleName),
    status,
    subject,
    type,
    validation: getField(fields, [
      "validacao executada",
      "validacao executada ou motivo de nao validar",
      "evidencias coletadas",
    ]),
  };
}

function collectFields(lines: string[]) {
  const fields = new Map<string, string>();
  let activeLabel: string | null = null;

  for (const line of lines) {
    const match = line.match(/^\s*-\s*([^:]+):\s*(.*)$/);

    if (match) {
      activeLabel = normalizeLabel(match[1] ?? "");
      appendField(fields, activeLabel, match[2] ?? "");
      continue;
    }

    if (!activeLabel) {
      continue;
    }

    const value = line.trim();

    if (!value || value === recordMarker) {
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

function buildMetrics(
  records: EngineeringOperationRecord[],
  auditRoutines: EngineeringAuditRoutine[],
): EngineeringOperationsMetrics {
  return {
    latestDeploys: records.filter((record) => record.deploy !== UNKNOWN_OPERATION_VALUE)
      .length,
    moduleImprovements: records.filter((record) => record.isModuleImprovement)
      .length,
    productionRecords: records.filter((record) =>
      normalizeSearchText(record.status).includes("em producao"),
    ).length,
    riskRecords: records.filter((record) => record.isCritical).length,
    routinesOverdue: auditRoutines.filter((routine) => routine.isOverdue).length,
    supportInvestigations: records.filter(
      (record) => record.isSupportInvestigation,
    ).length,
    totalRecords: records.length,
    waitingReleaseOps: records.filter((record) =>
      normalizeSearchText(record.status).includes("aguardando releaseops"),
    ).length,
  };
}

function buildFilters(
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

function buildAuditRoutines(
  records: EngineeringOperationRecord[],
  generatedAt: string,
): EngineeringAuditRoutine[] {
  return auditRoutineDefinitions.map((definition) => {
    const history = records
      .filter((record) => record.routine === definition.name)
      .slice(0, 6);
    const lastRecord = history[0];
    const lastExecution = lastRecord?.localDateTime ?? UNKNOWN_OPERATION_VALUE;

    return {
      consolidatedResult:
        lastRecord?.shortSummary ??
        "Rotina ainda não possui registro explícito no Engineering Operations.",
      frequency: definition.frequency,
      history,
      id: definition.id,
      isOverdue: isRoutineOverdue(definition.frequency, lastExecution, generatedAt),
      lastExecution,
      lastStatus: lastRecord?.status ?? "não executada",
      name: definition.name,
      responsible: definition.responsible,
      script: definition.script,
    };
  });
}

function buildStatusConsolidated(metrics: EngineeringOperationsMetrics) {
  if (metrics.riskRecords > 0 || metrics.routinesOverdue > 0) {
    return "OPERACIONAL COM ATENCAO";
  }

  if (metrics.waitingReleaseOps > 0) {
    return "AGUARDANDO RELEASEOPS";
  }

  return "FINALIZADO";
}

function inferRoutine({
  isCritical,
  isRelease,
  isSupportInvestigation,
  rawContent,
  subject,
  type,
}: {
  isCritical: boolean;
  isRelease: boolean;
  isSupportInvestigation: boolean;
  rawContent: string;
  subject: string;
  type: string;
}) {
  const text = normalizeSearchText(`${subject}\n${type}\n${rawContent}`);

  if (text.includes("healthcheck operacional")) {
    return "Healthcheck operacional";
  }

  if (text.includes("auditoria semanal")) {
    return "Auditoria semanal";
  }

  if (text.includes("auditoria mensal")) {
    return "Auditoria mensal";
  }

  if (text.includes("auditoria diaria") || text.includes("auditoria operacional diaria")) {
    return "Auditoria diária";
  }

  if (isSupportInvestigation) {
    return "Auditoria de bugs/gargalos";
  }

  if (isRelease) {
    return "Auditoria de deploy";
  }

  if (isCritical) {
    return "Auditoria de pendências críticas";
  }

  return UNKNOWN_OPERATION_VALUE;
}

function isRoutineOverdue(
  frequency: string,
  lastExecution: string,
  generatedAt: string,
) {
  if (lastExecution === UNKNOWN_OPERATION_VALUE) {
    return true;
  }

  if (frequency === "Sob demanda" || frequency === "Por release") {
    return false;
  }

  const lastDate = parseLocalDateTime(lastExecution);
  const currentDate = new Date(generatedAt);

  if (!lastDate || Number.isNaN(currentDate.getTime())) {
    return true;
  }

  const elapsedDays =
    (currentDate.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000);

  if (frequency === "Diária") {
    return elapsedDays > 1.5;
  }

  if (frequency === "Semanal") {
    return elapsedDays > 8;
  }

  if (frequency === "Mensal") {
    return elapsedDays > 35;
  }

  return false;
}

function parseLocalDateTime(value: string) {
  const normalizedValue = normalizeDateTimeForParsing(value);
  const parsedWithTimeZone = hasExplicitTimeZone(value)
    ? new Date(normalizedValue)
    : null;

  if (parsedWithTimeZone && !Number.isNaN(parsedWithTimeZone.getTime())) {
    return parsedWithTimeZone;
  }

  const match = value.match(
    /(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{2}):(\d{2}):(\d{2}))?/,
  );

  if (!match) {
    return null;
  }

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function hasExplicitTimeZone(value: string) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}

function normalizeDateTimeForParsing(value: string) {
  return value
    .trim()
    .replace(
      /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+([+-]\d{2}:?\d{2})$/,
      "$1T$2$3",
    );
}

function normalizeStatus(value: string) {
  if (value === UNKNOWN_OPERATION_VALUE) {
    return value;
  }

  const backticked = value.match(/`([^`]+)`/)?.[1];
  const candidate = cleanFieldValue(backticked ?? value);
  const normalizedCandidate = normalizeSearchText(candidate);
  const exact = statusTerms.find(
    (status) => normalizeSearchText(status) === normalizedCandidate,
  );

  if (exact) {
    return exact.replace("PRODUÇÃO", "PRODUCAO").replace("ATENÇÃO", "ATENCAO");
  }

  const included = statusTerms.find((status) =>
    normalizedCandidate.includes(normalizeSearchText(status)),
  );

  return included
    ? included.replace("PRODUÇÃO", "PRODUCAO").replace("ATENÇÃO", "ATENCAO")
    : candidate || UNKNOWN_OPERATION_VALUE;
}

function normalizeType(value: string, rawContent: string) {
  const source = value === UNKNOWN_OPERATION_VALUE ? rawContent : value;
  const normalizedSource = normalizeSearchText(source);
  const exact = typeTerms.find((type) =>
    normalizedSource.includes(normalizeSearchText(type)),
  );

  if (exact) {
    return exact.replace("INVESTIGAÇÃO", "INVESTIGACAO")
      .replace("DECISÃO", "DECISAO")
      .replace("CORREÇÃO", "CORRECAO");
  }

  if (normalizedSource.includes("deploy") || normalizedSource.includes("release")) {
    return "RELEASE";
  }

  if (
    normalizedSource.includes("investigacao") ||
    normalizedSource.includes("logs") ||
    normalizedSource.includes("gargalo")
  ) {
    return "INVESTIGACAO";
  }

  if (
    normalizedSource.includes("melhoria") ||
    normalizedSource.includes("refinamento") ||
    normalizedSource.includes("visual")
  ) {
    return "MELHORIA";
  }

  if (
    normalizedSource.includes("decisao") ||
    normalizedSource.includes("regra") ||
    normalizedSource.includes("metodologia")
  ) {
    return "DECISAO";
  }

  return compactText(cleanFieldValue(value), 64) || UNKNOWN_OPERATION_VALUE;
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

function inferModule(subject: string, rawContent: string) {
  const bracket = subject.match(/\[([^\]]+)\]/)?.[1];

  if (bracket) {
    return normalizeModuleAlias(cleanFieldValue(bracket));
  }

  const normalizedContent = normalizeSearchText(`${subject}\n${rawContent}`);
  const match = knownModules.find((moduleName) =>
    normalizedContent.includes(normalizeSearchText(moduleName)),
  );

  return match ? normalizeModuleAlias(match) : UNKNOWN_OPERATION_VALUE;
}

function normalizeModuleAlias(moduleName: string) {
  return normalizeSearchText(moduleName) === "hubops" ? "SquadOps" : moduleName;
}

function normalizeSquadOpsNaming(value: string) {
  return value.replace(/\bHubOps\b/g, "SquadOps");
}

function buildOperationProtocol(sourceIndex: number) {
  return `AT-${String(Math.max(sourceIndex, 0)).padStart(4, "0")}`;
}

function inferScreen(subject: string, affectedFiles: string, rawContent: string) {
  const text = normalizeSearchText(`${subject}\n${affectedFiles}\n${rawContent}`);

  if (
    text.includes("squadopspage") ||
    text.includes("/squadops") ||
    text.includes("operations center") ||
    text.includes("hubops")
  ) {
    return "SquadOps / Operations Center";
  }

  if (text.includes("pulsex") || text.includes("/pulsex")) {
    return "PulseX";
  }

  if (text.includes("guardian") || text.includes("/guardian")) {
    return "Guardian";
  }

  if (text.includes("caredesk") || text.includes("/caredesk")) {
    return "CareDesk";
  }

  if (text.includes("setup") || text.includes("/setup")) {
    return "Setup";
  }

  if (text.includes("hub-shell") || text.includes("sidebar")) {
    return "Hub Shell";
  }

  if (text.includes("api/operations") || text.includes("database monitoring")) {
    return "Operations APIs";
  }

  return UNKNOWN_OPERATION_VALUE;
}

function inferChangeCategory(type: string, subject: string, rawContent: string) {
  const text = normalizeSearchText(`${type}\n${subject}\n${rawContent}`);

  if (text.includes("release") || text.includes("deploy")) {
    return "Release";
  }

  if (text.includes("correcao") || text.includes("hotfix")) {
    return "Correcao";
  }

  if (
    text.includes("criacao") ||
    text.includes("novo") ||
    text.includes("nova") ||
    text.includes("implementacao")
  ) {
    return "Criacao";
  }

  if (
    text.includes("melhoria") ||
    text.includes("refinamento") ||
    text.includes("ux") ||
    text.includes("visual")
  ) {
    return "Melhoria";
  }

  if (text.includes("auditoria") || text.includes("healthcheck")) {
    return "Auditoria";
  }

  if (text.includes("investigacao") || text.includes("supportops")) {
    return "Investigacao";
  }

  if (text.includes("decisao") || text.includes("governanca")) {
    return "Governanca";
  }

  return UNKNOWN_OPERATION_VALUE;
}

function inferSquad(moduleName: string) {
  if (moduleName === UNKNOWN_OPERATION_VALUE) {
    return UNKNOWN_OPERATION_VALUE;
  }

  if (moduleName === "ReleaseOps" || moduleName === "SupportOps") {
    return `Hub ${moduleName}`;
  }

  if (moduleName === "Engenharia") {
    return "Engenharia Careli Hub";
  }

  return `${moduleName} Core`;
}

function hasReleaseSignal(
  type: string,
  subject: string,
  commit: string,
  deploy: string,
  healthchecks: string,
) {
  const text = normalizeSearchText(
    `${type} ${subject} ${commit} ${deploy} ${healthchecks}`,
  );

  return (
    text.includes("release") ||
    text.includes("deploy") ||
    text.includes("healthcheck") ||
    commit !== UNKNOWN_OPERATION_VALUE ||
    deploy !== UNKNOWN_OPERATION_VALUE
  );
}

function hasSupportSignal(type: string, subject: string, rawContent: string) {
  const text = normalizeSearchText(`${type} ${subject} ${rawContent}`);

  return text.includes("supportops") || text.includes("investigacao");
}

function hasImprovementSignal(type: string, subject: string, rawContent: string) {
  const text = normalizeSearchText(`${type} ${subject} ${rawContent}`);

  return (
    text.includes("melhoria") ||
    text.includes("refinamento") ||
    text.includes("ux") ||
    text.includes("layout")
  );
}

function hasCriticalSignal(status: string, risks: string, rawContent: string) {
  const text = normalizeSearchText(`${status}\n${risks}\n${rawContent}`);
  const riskText = normalizeSearchText(risks);
  const riskIsKnown =
    risks !== UNKNOWN_OPERATION_VALUE &&
    !riskText.includes("nenhuma pendencia") &&
    !riskText.includes("nenhum risco") &&
    !riskText.includes("nenhuma pendencia tecnica");

  return (
    text.includes("necessita correcao") ||
    text.includes("operacional com atencao") ||
    text.includes("bloqueado") ||
    text.includes("aguardando releaseops") ||
    riskIsKnown
  );
}

function firstKnownValue(values: string[]) {
  return values.find((value) => value && value !== UNKNOWN_OPERATION_VALUE) ?? "";
}

function cleanFieldValue(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim()
    .replace(/\.$/, "");
}

function compactText(value: string, maxLength: number) {
  const cleaned = cleanFieldValue(value);

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLength - 1).trim()}…`;
}

function trimBlankLines(lines: string[]) {
  const nextLines = [...lines];

  while (nextLines[0]?.trim() === "") {
    nextLines.shift();
  }

  while (nextLines[nextLines.length - 1]?.trim() === "") {
    nextLines.pop();
  }

  return nextLines;
}

function normalizeLabel(value: string) {
  return normalizeSearchText(value.replace(/`/g, ""));
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter((value) => value !== UNKNOWN_OPERATION_VALUE))].sort(
    (first, second) => first.localeCompare(second, "pt-BR"),
  );
}
