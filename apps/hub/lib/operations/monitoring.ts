import type { OperationsRawCheck } from "./data-sources";

export type OperationsGeneralStatus =
  | "critico"
  | "indisponivel"
  | "operacional"
  | "operacional_com_atencao";

export type OperationsRiskLevel = "alto" | "baixo" | "critico" | "medio";

export type OperationsTimeRisk = "atencao" | "bom" | "critico" | "lento";

export type OperationsPayloadRisk = "atencao" | "bom" | "critico" | "pesado";

export type OperationsAlertType =
  | "api_lenta"
  | "banco_indisponivel"
  | "endpoint_inseguro"
  | "erro_recorrente"
  | "integracao_externa_com_atencao"
  | "payload_pesado"
  | "realtime_instavel"
  | "risco_de_producao"
  | "supabase_instavel"
  | "sync_atrasado";

export type OperationsCheckMetric = OperationsRawCheck & {
  alertGenerated: boolean;
  payloadRisk: OperationsPayloadRisk;
  risk: OperationsRiskLevel;
  timeRisk: OperationsTimeRisk;
};

export type OperationsAlert = {
  command: string;
  fingerprint: string;
  generatedAt: string;
  id: string;
  impact: string;
  level: OperationsRiskLevel;
  module: string;
  origin: string;
  recommendation: string;
  recommendedAgent: OperationsAgent;
  status: "ativo" | "observando";
  title: string;
  type: OperationsAlertType;
};

export type OperationsAgent =
  | "CareDesk Core"
  | "Guardian Core"
  | "Hub ReleaseOps"
  | "Hub SupportOps"
  | "PulseX Core"
  | "SquadOps Core";

export type OperationsMonitoringSnapshot = {
  alerts: OperationsAlert[];
  cards: {
    activeAlerts: {
      highestLevel: OperationsRiskLevel | "nenhum";
      lastAlert: string;
      total: number;
    };
    c2x: {
      checkedAt: string;
      database: string;
      responseMs: number;
      status: OperationsGeneralStatus;
    };
    guardianQueue: {
      checks: OperationsCheckMetric[];
      loadedCount: number;
      payloadBytes: number;
      responseMs: number;
      risk: OperationsRiskLevel;
      usedLimits: number[];
    };
    protectedApis: {
      unexpected: number;
      expectedUnauthorized: number;
      total: number;
    };
    status: {
      label: string;
      value: OperationsGeneralStatus;
    };
    supabase: {
      auth: OperationsGeneralStatus;
      lastCheck: string;
      realtime: OperationsGeneralStatus;
      responseMs: number;
      rest: OperationsGeneralStatus;
    };
  };
  checks: OperationsCheckMetric[];
  generatedAt: string;
  metrics: {
    criticalAlerts: number;
    highAlerts: number;
    payloadCritical: number;
    slowChecks: number;
    totalChecks: number;
  };
};

export type OpsWatcherDecision = {
  agent: OperationsAgent;
  command: string;
  cooldownSeconds: number;
  dedupeKey: string;
  generatedAt: string;
  impact: string;
  message: string;
  notifyLucas: boolean;
  reason: string;
  risk: OperationsRiskLevel;
  sourceAlertIds: string[];
  status: "notificar" | "silencioso";
};

const riskWeight = {
  baixo: 1,
  medio: 2,
  alto: 3,
  critico: 4,
} as const satisfies Record<OperationsRiskLevel, number>;

export function buildOperationsMonitoringSnapshot(
  rawChecks: OperationsRawCheck[],
): OperationsMonitoringSnapshot {
  const checks = rawChecks.map(classifyCheck);
  const alerts = generateOperationsAlerts(checks);
  const generatedAt = new Date().toISOString();
  const c2xCheck = checks.find((check) => check.id === "guardian-db-health");
  const supabaseChecks = checks.filter((check) => check.group === "supabase");
  const queueChecks = checks.filter((check) => check.group === "guardian-queue");
  const protectedChecks = checks.filter((check) => check.group === "protected-api");
  const highestAlert = getHighestAlert(alerts);
  const overallStatus = getOverallStatus(checks, alerts);

  return {
    alerts,
    cards: {
      activeAlerts: {
        highestLevel: highestAlert?.level ?? "nenhum",
        lastAlert: highestAlert?.title ?? "Sem alerta ativo",
        total: alerts.length,
      },
      c2x: {
        checkedAt: c2xCheck?.checkedAt ?? generatedAt,
        database: String(c2xCheck?.meta?.database ?? "nao informado"),
        responseMs: c2xCheck?.responseMs ?? 0,
        status: checkToStatus(c2xCheck),
      },
      guardianQueue: {
        checks: queueChecks,
        loadedCount: queueChecks.reduce(
          (total, check) => total + Number(check.meta?.loadedCount ?? 0),
          0,
        ),
        payloadBytes: Math.max(...queueChecks.map((check) => check.payloadBytes), 0),
        responseMs: Math.max(...queueChecks.map((check) => check.responseMs), 0),
        risk: getHighestRisk(queueChecks.map((check) => check.risk)),
        usedLimits: queueChecks
          .map((check) => Number(check.meta?.limit ?? 0))
          .filter((limit) => limit > 0),
      },
      protectedApis: {
        expectedUnauthorized: protectedChecks.filter((check) => check.statusCode === 401)
          .length,
        total: protectedChecks.length,
        unexpected: protectedChecks.filter((check) => !check.ok).length,
      },
      status: {
        label: generalStatusLabel(overallStatus),
        value: overallStatus,
      },
      supabase: {
        auth: checkToStatus(
          supabaseChecks.find((check) => check.id === "supabase-auth-health"),
        ),
        lastCheck: supabaseChecks[0]?.checkedAt ?? generatedAt,
        realtime: checkToStatus(
          supabaseChecks.find((check) => check.id === "supabase-realtime-health"),
        ),
        responseMs: Math.max(...supabaseChecks.map((check) => check.responseMs), 0),
        rest: checkToStatus(
          supabaseChecks.find((check) => check.id === "supabase-rest-health"),
        ),
      },
    },
    checks,
    generatedAt,
    metrics: {
      criticalAlerts: alerts.filter((alert) => alert.level === "critico").length,
      highAlerts: alerts.filter((alert) => alert.level === "alto").length,
      payloadCritical: checks.filter((check) => check.payloadRisk === "critico").length,
      slowChecks: checks.filter(
        (check) => check.timeRisk === "lento" || check.timeRisk === "critico",
      ).length,
      totalChecks: checks.length,
    },
  };
}

export function buildOpsWatcherDecision(
  snapshot: OperationsMonitoringSnapshot,
): OpsWatcherDecision {
  const actionableAlerts = snapshot.alerts.filter(
    (alert) => alert.level === "critico" || alert.level === "alto",
  );
  const primaryAlert = getHighestAlert(actionableAlerts) ?? getHighestAlert(snapshot.alerts);

  if (!primaryAlert) {
    return {
      agent: "Hub SupportOps",
      command: buildHealthyCommand(snapshot),
      cooldownSeconds: 300,
      dedupeKey: "ops-watcher:stable",
      generatedAt: new Date().toISOString(),
      impact: "baixo",
      message:
        "Lucas, o ambiente esta operacional. Nao ha alerta alto ou critico para acionar agora.",
      notifyLucas: false,
      reason: "Sem alerta acionavel no snapshot realtime.",
      risk: "baixo",
      sourceAlertIds: [],
      status: "silencioso",
    };
  }

  return {
    agent: primaryAlert.recommendedAgent,
    command: primaryAlert.command,
    cooldownSeconds: primaryAlert.level === "critico" ? 180 : 300,
    dedupeKey: primaryAlert.fingerprint,
    generatedAt: new Date().toISOString(),
    impact: primaryAlert.impact,
    message: buildWatcherMessage(primaryAlert),
    notifyLucas: actionableAlerts.length > 0,
    reason:
      actionableAlerts.length > 0
        ? "Alerta alto ou critico identificado."
        : "Alerta medio/baixo agrupado para observacao.",
    risk: primaryAlert.level,
    sourceAlertIds: actionableAlerts.map((alert) => alert.id),
    status: actionableAlerts.length > 0 ? "notificar" : "silencioso",
  };
}

function classifyCheck(check: OperationsRawCheck): OperationsCheckMetric {
  const timeRisk = classifyResponseTime(check.responseMs);
  const payloadRisk = classifyPayload(check.payloadBytes);
  const baseRisk = check.ok ? "baixo" : "alto";
  const risk = getHighestRisk([
    baseRisk,
    timeRiskToRisk(timeRisk),
    payloadRiskToRisk(payloadRisk),
  ]);

  return {
    ...check,
    alertGenerated: false,
    payloadRisk,
    risk,
    timeRisk,
  };
}

function generateOperationsAlerts(checks: OperationsCheckMetric[]) {
  const alerts: OperationsAlert[] = [];

  for (const check of checks) {
    const checkAlerts = buildAlertsForCheck(check);
    alerts.push(...checkAlerts);

    if (checkAlerts.length > 0) {
      check.alertGenerated = true;
    }
  }

  return alerts;
}

function buildAlertsForCheck(check: OperationsCheckMetric): OperationsAlert[] {
  const alerts: OperationsAlert[] = [];

  if (check.id === "guardian-db-health" && !check.ok) {
    alerts.push(
      createAlert(check, {
        impact: "Operacao Guardian pode perder leitura do banco C2X.",
        level: "critico",
        recommendation: "Acionar Hub SupportOps para validar conexao, credenciais e rede.",
        title: "C2X indisponivel no healthcheck",
        type: "banco_indisponivel",
      }),
    );
  }

  if (check.id === "guardian-queue-20" && check.responseMs > 1_500) {
    alerts.push(
      createAlert(check, {
        impact: "Fila operacional pode abrir lenta mesmo com limite seguro.",
        level: "alto",
        recommendation: "Acionar Guardian Core para revisar query, read model e payload.",
        title: "Guardian Queue limit=20 lenta",
        type: "api_lenta",
      }),
    );
  }

  if (check.id === "guardian-queue-50" && check.responseMs > 2_000) {
    alerts.push(
      createAlert(check, {
        impact: "Aumento de volume ja afeta a leitura operacional da fila.",
        level: "alto",
        recommendation: "Acionar Guardian Core e evitar limit=1000 automatico.",
        title: "Guardian Queue limit=50 lenta",
        type: "api_lenta",
      }),
    );
  }

  if (check.group === "protected-api" && check.statusCode === 200) {
    alerts.push(
      createAlert(check, {
        impact: "Endpoint protegido respondeu sem bearer e pode expor dado operacional.",
        level: "critico",
        recommendation: "Acionar Hub SupportOps para revisar guarda server-side.",
        title: "Endpoint protegido respondeu 200 sem bearer",
        type: "endpoint_inseguro",
      }),
    );
  } else if (check.group === "protected-api" && !check.ok) {
    alerts.push(
      createAlert(check, {
        impact: "Contrato de seguranca mudou ou endpoint respondeu status inesperado.",
        level: "alto",
        recommendation: "Validar se o status recebido e esperado para chamada sem sessao.",
        title: "Endpoint protegido com resposta inesperada",
        type: "risco_de_producao",
      }),
    );
  }

  if (check.group === "supabase" && !check.ok) {
    alerts.push(
      createAlert(check, {
        impact: "Funcionalidades autenticadas, REST ou realtime podem ficar instaveis.",
        level: check.id.includes("realtime") ? "alto" : "critico",
        recommendation: "Acionar Hub SupportOps para validar Supabase e variaveis server-side.",
        title: `${check.label} instavel`,
        type: check.id.includes("realtime")
          ? "realtime_instavel"
          : "supabase_instavel",
      }),
    );
  }

  if (check.payloadRisk === "critico") {
    alerts.push(
      createAlert(check, {
        impact: "Payload acima de 2MB pode travar tela, rede e navegador.",
        level: "critico",
        recommendation: "Reduzir payload, paginar ou usar read model antes de ampliar limite.",
        title: "Payload critico detectado",
        type: "payload_pesado",
      }),
    );
  } else if (check.payloadRisk === "pesado") {
    alerts.push(
      createAlert(check, {
        impact: "Payload entre 1MB e 2MB pode gerar lentidao recorrente.",
        level: "alto",
        recommendation: "Monitorar crescimento e revisar campos retornados.",
        title: "Payload pesado detectado",
        type: "payload_pesado",
      }),
    );
  }

  if (
    check.timeRisk === "critico" &&
    !alerts.some((alert) => alert.type === "api_lenta")
  ) {
    alerts.push(
      createAlert(check, {
        impact: "Resposta acima de 3s prejudica a experiencia operacional.",
        level: "alto",
        recommendation: "Acionar SupportOps para medir origem da lentidao.",
        title: "API com tempo critico",
        type: "api_lenta",
      }),
    );
  }

  return alerts;
}

function createAlert(
  check: OperationsCheckMetric,
  input: {
    impact: string;
    level: OperationsRiskLevel;
    recommendation: string;
    title: string;
    type: OperationsAlertType;
  },
): OperationsAlert {
  const agent = getRecommendedAgent(check.module, input.type);
  const fingerprint = `${input.type}:${check.id}:${input.level}`;

  return {
    command: buildAgentCommand({
      agent,
      check,
      impact: input.impact,
      recommendation: input.recommendation,
      title: input.title,
    }),
    fingerprint,
    generatedAt: new Date().toISOString(),
    id: `${fingerprint}:${check.checkedAt}`,
    impact: input.impact,
    level: input.level,
    module: check.module,
    origin: check.label,
    recommendation: input.recommendation,
    recommendedAgent: agent,
    status: "ativo",
    title: input.title,
    type: input.type,
  };
}

function buildAgentCommand({
  agent,
  check,
  impact,
  recommendation,
  title,
}: {
  agent: OperationsAgent;
  check: OperationsCheckMetric;
  impact: string;
  recommendation: string;
  title: string;
}) {
  return `Assunto:
[${check.module}] ${title}

Contexto:
O Operations Center identificou um alerta realtime em ${check.label}.
Endpoint: ${check.endpoint}
Resultado esperado: ${check.expected.description}
Resultado recebido: ${check.received}
Tempo: ${check.responseMs}ms
Payload aproximado: ${formatBytes(check.payloadBytes)}
Risco: ${check.risk}

Objetivo:
Investigar a origem do alerta, reduzir risco operacional e orientar o proximo handoff.

Tarefas:
* Validar o endpoint e reproduzir o comportamento com limite seguro.
* Conferir logs, payload, tempo de resposta e contrato de seguranca.
* Identificar se o problema esta em banco, API, payload, auth, realtime ou integracao.
* Propor correcao pequena e rastreavel, sem alterar outros modulos fora do escopo.

Validacoes esperadas:
* Check-types, lint e build quando houver alteracao de codigo.
* Smoke do endpoint afetado.
* Registro do resultado no Engineering Operations.

Retorno esperado:
Origem, impacto, correcao proposta ou executada, validacoes, riscos restantes e proxima squad recomendada.

Status esperado:
AGUARDANDO RELEASEOPS

Agente recomendado:
${agent}

Impacto:
${impact}

Recomendacao:
${recommendation}`;
}

function buildHealthyCommand(snapshot: OperationsMonitoringSnapshot) {
  return `Assunto:
[SupportOps] Healthcheck operacional do Hub

Contexto:
O Ops Watcher nao encontrou alerta alto ou critico no snapshot realtime.
Status geral: ${snapshot.cards.status.label}
Checks executados: ${snapshot.metrics.totalChecks}
Alertas ativos: ${snapshot.alerts.length}

Objetivo:
Registrar healthcheck preventivo e manter observabilidade do ambiente.

Tarefas:
* Revisar checks com risco medio.
* Confirmar se ha falso positivo conhecido.
* Registrar qualquer pendencia no Engineering Operations.

Validacoes esperadas:
* Smoke das APIs principais.
* Confirmacao de Supabase Auth, REST e Realtime.

Retorno esperado:
Resumo executivo, riscos, pendencias e status operacional.

Status esperado:
FINALIZADO`;
}

function buildWatcherMessage(alert: OperationsAlert) {
  return `Lucas, o ambiente precisa de atencao em ${alert.module}: ${alert.title}.

Impacto:
${alert.impact}

Risco:
${alert.level}

Agente recomendado:
${alert.recommendedAgent}

Recomendacao:
${alert.recommendation}`;
}

function getRecommendedAgent(
  module: string,
  type: OperationsAlertType,
): OperationsAgent {
  if (module.toLowerCase().includes("guardian")) {
    return "Guardian Core";
  }

  if (module.toLowerCase().includes("pulsex")) {
    return "PulseX Core";
  }

  if (module.toLowerCase().includes("caredesk")) {
    return "CareDesk Core";
  }

  if (type === "risco_de_producao") {
    return "Hub ReleaseOps";
  }

  return "Hub SupportOps";
}

function getOverallStatus(
  checks: OperationsCheckMetric[],
  alerts: OperationsAlert[],
): OperationsGeneralStatus {
  if (checks.some((check) => check.id === "guardian-db-health" && !check.ok)) {
    return "indisponivel";
  }

  if (alerts.some((alert) => alert.level === "critico")) {
    return "critico";
  }

  if (
    alerts.some((alert) => alert.level === "alto" || alert.level === "medio") ||
    checks.some((check) => check.risk === "alto")
  ) {
    return "operacional_com_atencao";
  }

  return "operacional";
}

function checkToStatus(
  check: OperationsCheckMetric | undefined,
): OperationsGeneralStatus {
  if (!check) {
    return "operacional_com_atencao";
  }

  if (!check.ok && check.statusCode === 0) {
    return "indisponivel";
  }

  if (!check.ok) {
    return "critico";
  }

  if (check.risk === "alto" || check.risk === "medio") {
    return "operacional_com_atencao";
  }

  return "operacional";
}

function classifyResponseTime(responseMs: number): OperationsTimeRisk {
  if (responseMs <= 500) {
    return "bom";
  }

  if (responseMs <= 1_500) {
    return "atencao";
  }

  if (responseMs <= 3_000) {
    return "lento";
  }

  return "critico";
}

function classifyPayload(payloadBytes: number): OperationsPayloadRisk {
  if (payloadBytes <= 250 * 1024) {
    return "bom";
  }

  if (payloadBytes <= 1024 * 1024) {
    return "atencao";
  }

  if (payloadBytes <= 2 * 1024 * 1024) {
    return "pesado";
  }

  return "critico";
}

function timeRiskToRisk(timeRisk: OperationsTimeRisk): OperationsRiskLevel {
  if (timeRisk === "critico" || timeRisk === "lento") {
    return "alto";
  }

  if (timeRisk === "atencao") {
    return "medio";
  }

  return "baixo";
}

function payloadRiskToRisk(
  payloadRisk: OperationsPayloadRisk,
): OperationsRiskLevel {
  if (payloadRisk === "critico") {
    return "critico";
  }

  if (payloadRisk === "pesado") {
    return "alto";
  }

  if (payloadRisk === "atencao") {
    return "medio";
  }

  return "baixo";
}

function getHighestRisk(risks: OperationsRiskLevel[]): OperationsRiskLevel {
  return risks.reduce<OperationsRiskLevel>(
    (highest, risk) => (riskWeight[risk] > riskWeight[highest] ? risk : highest),
    "baixo",
  );
}

function getHighestAlert(alerts: OperationsAlert[]) {
  return alerts
    .slice()
    .sort((first, second) => riskWeight[second.level] - riskWeight[first.level])[0];
}

function generalStatusLabel(status: OperationsGeneralStatus) {
  if (status === "operacional") {
    return "Operacional";
  }

  if (status === "operacional_com_atencao") {
    return "Operacional com atencao";
  }

  if (status === "critico") {
    return "Critico";
  }

  return "Indisponivel";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 102.4) / 10} KB`;
  }

  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}
