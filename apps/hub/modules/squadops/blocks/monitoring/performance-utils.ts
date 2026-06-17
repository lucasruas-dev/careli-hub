import type {
  OperationsCheckMetric,
  OperationsMonitoringSnapshot,
  OperationsRiskLevel,
} from "@/lib/operations/monitoring";

export type PerformanceTone = "green" | "yellow" | "red" | "neutral";

type PerformanceSummary = {
  detail: string;
  evidence: string;
  tone: PerformanceTone;
  value: string;
};

export function sortMonitoringChecksByLatest(
  checks: OperationsCheckMetric[],
) {
  return checks
    .slice()
    .sort(
      (first, second) =>
        new Date(second.checkedAt).getTime() -
        new Date(first.checkedAt).getTime(),
    );
}

export function getSlowestCheck(checks: OperationsCheckMetric[]) {
  return checks
    .slice()
    .sort((first, second) => second.responseMs - first.responseMs)[0];
}

export function getHighestPayloadCheck(checks: OperationsCheckMetric[]) {
  return checks
    .slice()
    .sort((first, second) => second.payloadBytes - first.payloadBytes)[0];
}

export function getMaxResponseMs(checks: OperationsCheckMetric[]) {
  return Math.max(0, ...checks.map((check) => check.responseMs));
}

export function getAverageResponseMs(checks: OperationsCheckMetric[]) {
  if (checks.length === 0) {
    return 0;
  }

  return Math.round(
    checks.reduce((total, check) => total + check.responseMs, 0) /
      checks.length,
  );
}

export function formatMetricMs(value: number) {
  return value > 0 ? `${value}ms` : "--";
}

export function formatIndicatorEvidence(checks: OperationsCheckMetric[]) {
  if (checks.length === 0) {
    return "sem leitura";
  }

  return checks.map((check) => check.label).join(" / ");
}

export function getResponseChecksTone(
  checks: OperationsCheckMetric[],
): PerformanceTone {
  if (checks.length === 0) {
    return "neutral";
  }

  return responsePerformanceTone(getMaxResponseMs(checks));
}

export function payloadPerformanceTone(
  payloadRisk: OperationsCheckMetric["payloadRisk"],
): PerformanceTone {
  if (payloadRisk === "critico") {
    return "red";
  }

  if (payloadRisk === "pesado" || payloadRisk === "atencao") {
    return "yellow";
  }

  return "green";
}

export function getColdStartSummary(
  checks: OperationsCheckMetric[],
): PerformanceSummary {
  const checksById = new Map<string, OperationsCheckMetric[]>();

  checks.forEach((check) => {
    const currentChecks = checksById.get(check.id) ?? [];
    currentChecks.push(check);
    checksById.set(check.id, currentChecks);
  });

  const signals: OperationsCheckMetric[] = [];
  let comparableSeries = 0;

  checksById.forEach((series) => {
    const orderedSeries = sortMonitoringChecksByLatest(series);
    const latest = orderedSeries[0];
    const previous = orderedSeries[1];

    if (!latest || !previous) {
      return;
    }

    comparableSeries += 1;

    if (latest.responseMs > 1_500 && latest.responseMs - previous.responseMs > 800) {
      signals.push(latest);
    }
  });

  if (comparableSeries === 0) {
    return {
      detail: "Ainda falta serie temporal para inferir cold start.",
      evidence: "comparativo pendente",
      tone: "neutral",
      value: "sem base",
    };
  }

  if (signals.length === 0) {
    return {
      detail: "Sem salto brusco de latencia entre as ultimas leituras.",
      evidence: `${comparableSeries} serie(s) comparada(s)`,
      tone: "green",
      value: "0 sinais",
    };
  }

  return {
    detail: `Pico brusco em ${signals
      .slice(0, 2)
      .map((check) => check.label)
      .join(" / ")}.`,
    evidence: `${comparableSeries} serie(s) comparada(s)`,
    tone: signals.length > 1 ? "red" : "yellow",
    value: `${signals.length} sinal(is)`,
  };
}

export function getCacheSummary(
  checks: OperationsCheckMetric[],
): PerformanceSummary {
  const cacheReadings = checks
    .map((check) => ({
      check,
      value: getCacheHeaderValue(check),
    }))
    .filter(
      (item): item is { check: OperationsCheckMetric; value: string } =>
        Boolean(item.value),
    );

  if (cacheReadings.length === 0) {
    return {
      detail: "Headers de cache ainda nao foram observados nas fontes atuais.",
      evidence: "cache-control sem sinal",
      tone: "neutral",
      value: "sem sinal",
    };
  }

  const hitCount = cacheReadings.filter((item) =>
    normalizeMonitoringText(item.value).includes("hit"),
  ).length;
  const missCount = cacheReadings.filter((item) => {
    const normalizedValue = normalizeMonitoringText(item.value);

    return (
      normalizedValue.includes("miss") ||
      normalizedValue.includes("bypass") ||
      normalizedValue.includes("stale")
    );
  }).length;

  if (hitCount > 0) {
    return {
      detail: "Pelo menos uma fonte respondeu com cache aproveitado.",
      evidence: `${cacheReadings.length} header(s) de cache`,
      tone: "green",
      value: `${hitCount} HIT`,
    };
  }

  if (missCount > 0) {
    return {
      detail: "Cache observado, mas ainda sem reaproveitamento na leitura atual.",
      evidence: `${cacheReadings.length} header(s) de cache`,
      tone: "yellow",
      value: `${missCount} MISS`,
    };
  }

  return {
    detail: `Cache declarado em ${cacheReadings[0]?.check.label ?? "fonte monitorada"}.`,
    evidence: `${cacheReadings.length} header(s) de cache`,
    tone: "green",
    value: "ativo",
  };
}

export function getCacheHeaderValue(check: OperationsCheckMetric) {
  const keys = [
    "cacheStatus",
    "hadesQueueCache",
    "vercelCache",
    "cacheControl",
    "age",
  ];

  for (const key of keys) {
    const value = check.meta?.[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function monitoringSourceTone(
  risk?: OperationsRiskLevel | "nenhum",
  status?: OperationsMonitoringSnapshot["cards"]["status"]["value"],
): PerformanceTone {
  if (
    risk === "critico" ||
    status === "critico" ||
    status === "indisponivel"
  ) {
    return "red";
  }

  if (
    risk === "alto" ||
    risk === "medio" ||
    status === "operacional_com_atencao"
  ) {
    return "yellow";
  }

  if (risk === "baixo" || risk === "nenhum" || status === "operacional") {
    return "green";
  }

  return "neutral";
}

export function responsePerformanceBarClass(responseMs: number) {
  if (responseMs > 3000) {
    return "bg-red-500";
  }

  if (responseMs > 500) {
    return "bg-yellow-400";
  }

  return "bg-emerald-500";
}

export function responsePerformanceTone(responseMs: number): PerformanceTone {
  if (responseMs > 3000) {
    return "red";
  }

  if (responseMs > 500) {
    return "yellow";
  }

  return "green";
}

export function performanceChartColors(tone: PerformanceTone) {
  if (tone === "red") {
    return {
      area: "#ef4444",
      stroke: "#dc2626",
    };
  }

  if (tone === "yellow") {
    return {
      area: "#eab308",
      stroke: "#ca8a04",
    };
  }

  if (tone === "green") {
    return {
      area: "#10b981",
      stroke: "#059669",
    };
  }

  return {
    area: "#94a3b8",
    stroke: "#64748b",
  };
}

export function performanceCardBorderClass(tone: PerformanceTone) {
  if (tone === "red") {
    return "border-red-200 hover:border-red-300";
  }

  if (tone === "yellow") {
    return "border-yellow-200 hover:border-yellow-300";
  }

  if (tone === "green") {
    return "border-emerald-200 hover:border-emerald-300";
  }

  return "border-slate-200/70 hover:border-slate-300";
}

export function performanceIconClass(tone: PerformanceTone) {
  if (tone === "red") {
    return "bg-red-50 text-red-600 ring-red-200 group-hover:bg-red-100";
  }

  if (tone === "yellow") {
    return "bg-yellow-50 text-yellow-700 ring-yellow-200 group-hover:bg-yellow-100";
  }

  if (tone === "green") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200 group-hover:bg-emerald-100";
  }

  return "bg-slate-50 text-slate-500 ring-slate-200/70 group-hover:bg-slate-100";
}

export function performancePillClass(tone: PerformanceTone) {
  if (tone === "red") {
    return "bg-red-50 text-red-700 ring-red-200";
  }

  if (tone === "yellow") {
    return "bg-yellow-50 text-yellow-700 ring-yellow-200";
  }

  if (tone === "green") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }

  return "bg-slate-50 text-slate-500 ring-slate-200/70";
}

function normalizeMonitoringText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
