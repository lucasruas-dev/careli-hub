import {
  UNKNOWN_OPERATION_VALUE,
  type EngineeringOperationRecord,
} from "./engineering-operations-parser";

export type ReleaseProtocolEnvironment =
  | "desenvolvimento"
  | "homologacao"
  | "producao"
  | "qa";

export type ReleaseProtocolStatus =
  | "aguardando_homologacao"
  | "aguardando_producao"
  | "bloqueado"
  | "em_homologacao"
  | "em_producao"
  | "finalizado"
  | "homologado"
  | "planejado"
  | "rollback";

export type HubReleaseProtocol = {
  commit: string;
  deployment: string;
  environment: ReleaseProtocolEnvironment;
  healthchecks: string;
  includedProtocols: string[];
  module: string;
  modules: string[];
  plannedAt: string;
  protocol: string;
  record: EngineeringOperationRecord;
  records: EngineeringOperationRecord[];
  status: ReleaseProtocolStatus;
  summary: string;
  title: string;
};

const releaseProtocolStatusLabels = {
  aguardando_homologacao: "Aguardando homologacao",
  aguardando_producao: "Aguardando producao",
  bloqueado: "Bloqueado",
  em_homologacao: "Em homologacao",
  em_producao: "Em producao",
  finalizado: "Finalizado",
  homologado: "Homologado",
  planejado: "Planejado",
  rollback: "Rollback",
} as const satisfies Record<ReleaseProtocolStatus, string>;

const releaseProtocolEnvironmentLabels = {
  desenvolvimento: "Desenvolvimento",
  homologacao: "Homologacao",
  producao: "Producao",
  qa: "QA",
} as const satisfies Record<ReleaseProtocolEnvironment, string>;

export function buildReleaseProtocols(
  records: EngineeringOperationRecord[],
): HubReleaseProtocol[] {
  const releaseRecords = records
    .filter(isReleaseProtocolCandidate)
    .sort(compareOperationRecordsAsc);

  return releaseRecords
    .map((record, index) =>
      buildReleaseProtocol({
        index,
        record,
        records,
      }),
    )
    .sort((first, second) => compareOperationRecordsDesc(first.record, second.record));
}

export function getReleaseProtocolStatusLabel(status: ReleaseProtocolStatus) {
  return releaseProtocolStatusLabels[status];
}

export function getReleaseProtocolEnvironmentLabel(
  environment: ReleaseProtocolEnvironment,
) {
  return releaseProtocolEnvironmentLabels[environment];
}

export function buildReleaseCommitTemplate(releaseProtocol: HubReleaseProtocol) {
  const title = releaseProtocol.title
    .replace(/^\[[^\]]+\]\s*/, "")
    .toLowerCase()
    .slice(0, 70);

  return [
    `feat(squadops): ${title} [${releaseProtocol.protocol}]`,
    "",
    "Protocolos incluidos:",
    ...releaseProtocol.includedProtocols.map((protocol) => `- ${protocol}`),
    "",
    `Ambiente: ${getReleaseProtocolEnvironmentLabel(releaseProtocol.environment)}`,
    `Status esperado: ${getReleaseProtocolStatusLabel(releaseProtocol.status)}`,
  ].join("\n");
}

function buildReleaseProtocol({
  index,
  record,
  records,
}: {
  index: number;
  record: EngineeringOperationRecord;
  records: EngineeringOperationRecord[];
}): HubReleaseProtocol {
  const relatedRecords = getRelatedReleaseRecords(record, records);
  const includedProtocols = uniqueProtocols([
    record.protocol,
    ...relatedRecords.map((item) => item.protocol),
  ]);
  const modules = Array.from(
    new Set(
      relatedRecords
        .concat(record)
        .map((item) => item.module)
        .filter(isKnownValue),
    ),
  );

  return {
    commit: record.commit,
    deployment: record.deploy,
    environment: inferReleaseEnvironment(record),
    healthchecks: record.healthchecks,
    includedProtocols,
    module: record.module,
    modules,
    plannedAt: record.localDateTime,
    protocol: `DP-${String(index + 1).padStart(4, "0")}`,
    record,
    records: relatedRecords,
    status: inferReleaseStatus(record),
    summary: getReleaseSummary(record),
    title: record.subject,
  };
}

function getRelatedReleaseRecords(
  releaseRecord: EngineeringOperationRecord,
  records: EngineeringOperationRecord[],
) {
  const releaseTime = getRecordTime(releaseRecord);
  const isConsolidatedRelease = normalizeText(
    `${releaseRecord.subject} ${releaseRecord.reason} ${releaseRecord.how}`,
  ).includes("consolidad");

  const related = records.filter((record) => {
    if (record.id === releaseRecord.id) {
      return true;
    }

    if (record.isRelease) {
      return false;
    }

    const recordTime = getRecordTime(record);

    if (recordTime > releaseTime) {
      return false;
    }

    if (isConsolidatedRelease) {
      return isWaitingForRelease(record) || hasSameOperationalFamily(record, releaseRecord);
    }

    return (
      record.module === releaseRecord.module ||
      record.squad === releaseRecord.squad ||
      hasSharedFileSignal(record, releaseRecord)
    );
  });

  return related.sort(compareOperationRecordsDesc).slice(0, 12);
}

function isReleaseProtocolCandidate(record: EngineeringOperationRecord) {
  const text = normalizeText(
    `${record.subject} ${record.type} ${record.status} ${record.commit} ${record.deploy}`,
  );

  return (
    record.isRelease ||
    text.includes("release") ||
    text.includes("deploy") ||
    isKnownValue(record.commit) ||
    isKnownValue(record.deploy)
  );
}

function inferReleaseStatus(record: EngineeringOperationRecord): ReleaseProtocolStatus {
  const text = normalizeText(
    `${record.status} ${record.subject} ${record.deploy} ${record.healthchecks} ${record.risks}`,
  );

  if (text.includes("rollback")) {
    return "rollback";
  }

  if (text.includes("bloqueado") || text.includes("aguardando recorte")) {
    return "bloqueado";
  }

  if (text.includes("em producao") || isKnownValue(record.deploy)) {
    return "em_producao";
  }

  if (text.includes("homologado")) {
    return "homologado";
  }

  if (text.includes("homologacao")) {
    return "em_homologacao";
  }

  if (text.includes("aguardando deploy")) {
    return "aguardando_producao";
  }

  if (text.includes("aguardando releaseops")) {
    return "aguardando_homologacao";
  }

  return "planejado";
}

function inferReleaseEnvironment(
  record: EngineeringOperationRecord,
): ReleaseProtocolEnvironment {
  const text = normalizeText(
    `${record.status} ${record.subject} ${record.deploy} ${record.healthchecks}`,
  );

  if (text.includes("producao") || isKnownValue(record.deploy)) {
    return "producao";
  }

  if (text.includes("homolog")) {
    return "homologacao";
  }

  if (text.includes("qa") || text.includes("validacao")) {
    return "qa";
  }

  return "homologacao";
}

function getReleaseSummary(record: EngineeringOperationRecord) {
  return getKnownValue([
    record.macroSummary,
    record.how,
    record.reason,
    record.shortSummary,
  ]);
}

function isWaitingForRelease(record: EngineeringOperationRecord) {
  const status = normalizeText(record.status);

  return (
    status.includes("aguardando releaseops") ||
    status.includes("aguardando deploy") ||
    status.includes("aguardando homologacao")
  );
}

function hasSameOperationalFamily(
  record: EngineeringOperationRecord,
  releaseRecord: EngineeringOperationRecord,
) {
  const releaseText = normalizeText(
    `${releaseRecord.module} ${releaseRecord.subject} ${releaseRecord.affectedFiles}`,
  );
  const recordText = normalizeText(
    `${record.module} ${record.subject} ${record.affectedFiles}`,
  );

  return (
    releaseText.includes(normalizeText(record.module)) ||
    recordText.includes(normalizeText(releaseRecord.module)) ||
    releaseRecord.affectedFiles
      .split(/[;,]/)
      .some((file) => file.trim() && record.affectedFiles.includes(file.trim()))
  );
}

function hasSharedFileSignal(
  record: EngineeringOperationRecord,
  releaseRecord: EngineeringOperationRecord,
) {
  if (!isKnownValue(record.affectedFiles) || !isKnownValue(releaseRecord.affectedFiles)) {
    return false;
  }

  const files = record.affectedFiles
    .split(/[;,]/)
    .map((file) => file.trim())
    .filter(Boolean);

  return files.some((file) => releaseRecord.affectedFiles.includes(file));
}

function uniqueProtocols(protocols: string[]) {
  return Array.from(new Set(protocols.filter(isKnownValue)));
}

function getKnownValue(values: string[]) {
  return (
    values.find((value) => isKnownValue(value)) ?? "Resumo operacional nao informado."
  );
}

function isKnownValue(value: string) {
  return Boolean(value.trim() && value.trim() !== UNKNOWN_OPERATION_VALUE);
}

function compareOperationRecordsAsc(
  first: EngineeringOperationRecord,
  second: EngineeringOperationRecord,
) {
  return getRecordTime(first) - getRecordTime(second);
}

function compareOperationRecordsDesc(
  first: EngineeringOperationRecord,
  second: EngineeringOperationRecord,
) {
  return getRecordTime(second) - getRecordTime(first);
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

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
