import { createClient } from "@supabase/supabase-js";

import type {
  OperationsAlert,
  OperationsAlertAnalysis,
  OperationsAlertFeedbackStatus,
  OperationsAlertProtocolStatus,
  OperationsAlertProtocolSummary,
  OperationsAlertType,
  OperationsMonitoringSnapshot,
  OperationsRiskLevel,
  OperationsAgent,
} from "./monitoring";

export const operationsAlertFeedbackStatuses = [
  "pendente",
  "em_analise",
  "persiste",
  "corrigido",
  "nao_observado",
  "bloqueado",
  "falso_positivo",
] as const satisfies readonly OperationsAlertFeedbackStatus[];

type AlertProtocolRow = {
  acknowledged_at: string | null;
  acknowledged_by_user_id: string | null;
  alert_type: OperationsAlertType;
  command: string;
  created_at: string;
  endpoint: string | null;
  expected_result: string | null;
  fingerprint: string;
  first_seen_at: string;
  http_status: number | null;
  id: string;
  impact: string;
  last_seen_at: string;
  level: OperationsRiskLevel;
  metadata: Record<string, unknown>;
  module: string;
  occurrence_count: number;
  origin: string;
  payload_bytes: number;
  protocol: string;
  received_result: string | null;
  recommendation: string;
  recommended_agent: OperationsAgent;
  response_ms: number;
  status: OperationsAlertProtocolStatus;
  technical_feedback: string | null;
  technical_feedback_at: string | null;
  technical_feedback_status: OperationsAlertFeedbackStatus;
  title: string;
  treated_at: string | null;
  treated_by_user_id: string | null;
  updated_at: string;
};

type AlertFeedbackRow = {
  alert_protocol_id: string;
  feedback: string;
  informed_by_user_id: string | null;
  metadata: Record<string, unknown>;
  status: OperationsAlertFeedbackStatus;
};

type AlertProtocolInsert = Omit<
  AlertProtocolRow,
  | "acknowledged_at"
  | "acknowledged_by_user_id"
  | "created_at"
  | "id"
  | "technical_feedback"
  | "technical_feedback_at"
  | "technical_feedback_status"
  | "treated_at"
  | "treated_by_user_id"
  | "updated_at"
> & {
  created_by_user_id: string | null;
  metadata: Record<string, unknown>;
  technical_feedback_status?: OperationsAlertFeedbackStatus;
  updated_by_user_id: string | null;
};

type AlertProtocolUpdate = Partial<
  Pick<
    AlertProtocolRow,
    | "alert_type"
    | "command"
    | "endpoint"
    | "expected_result"
    | "http_status"
    | "impact"
    | "last_seen_at"
    | "level"
    | "module"
    | "occurrence_count"
    | "origin"
    | "payload_bytes"
    | "received_result"
    | "recommendation"
    | "recommended_agent"
    | "response_ms"
    | "status"
    | "title"
  >
> & {
  metadata?: Record<string, unknown>;
  updated_by_user_id?: string | null;
};

type OperationsAlertProtocolDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: {
      hub_ops_alert_feedback_status: OperationsAlertFeedbackStatus;
      hub_ops_alert_status: OperationsAlertProtocolStatus;
    };
    Functions: {
      next_hub_operations_alert_protocol: {
        Args: Record<string, never>;
        Returns: string;
      };
    };
    Tables: {
      hub_operations_alert_feedbacks: {
        Insert: AlertFeedbackRow;
        Relationships: [];
        Row: AlertFeedbackRow & {
          created_at: string;
          id: string;
        };
        Update: Partial<AlertFeedbackRow>;
      };
      hub_operations_alert_protocols: {
        Insert: AlertProtocolInsert;
        Relationships: [];
        Row: AlertProtocolRow;
        Update: AlertProtocolUpdate & {
          acknowledged_at?: string | null;
          acknowledged_by_user_id?: string | null;
          technical_feedback?: string | null;
          technical_feedback_at?: string | null;
          technical_feedback_by_user_id?: string | null;
          technical_feedback_status?: OperationsAlertFeedbackStatus;
          treated_at?: string | null;
          treated_by_user_id?: string | null;
        };
      };
    };
    Views: Record<string, never>;
  };
};

type OperationsAlertProtocolClient = ReturnType<
  typeof createClient<OperationsAlertProtocolDatabase>
>;

export type AlertProtocolSyncResult = {
  alerts: OperationsAlert[];
  protocols: OperationsAlertProtocolSummary[];
  status: OperationsMonitoringSnapshot["protocolSyncStatus"];
};

export async function syncOperationAlertProtocols(
  alerts: OperationsAlert[],
  userId: string | null,
): Promise<AlertProtocolSyncResult> {
  if (alerts.length === 0) {
    return {
      alerts,
      protocols: [],
      status: "sem_alertas",
    };
  }

  const adminClient = createAlertProtocolClient();

  if (!adminClient) {
    return buildUnavailableSyncResult(alerts);
  }

  try {
    const existingProtocols = await loadProtocolsByFingerprint(
      adminClient,
      alerts.map((alert) => alert.fingerprint),
    );
    const protocols: OperationsAlertProtocolSummary[] = [];

    for (const alert of alerts) {
      const existingProtocol = existingProtocols.get(alert.fingerprint);
      const savedProtocol = existingProtocol
        ? await updateExistingAlertProtocol(
            adminClient,
            existingProtocol,
            alert,
            userId,
          )
        : await insertNewAlertProtocol(adminClient, alert, userId);

      protocols.push(savedProtocol);
    }

    return {
      alerts: alerts.map((alert) => {
        const protocol = protocols.find(
          (item) => item.fingerprint === alert.fingerprint,
        );

        return protocol ? applyProtocolToAlert(alert, protocol) : alert;
      }),
      protocols,
      status: "sincronizado",
    };
  } catch (error) {
    console.warn(
      "[SquadOps] alert protocol sync unavailable",
      error instanceof Error ? error.message : "unknown error",
    );
    return buildUnavailableSyncResult(alerts);
  }
}

export async function loadOperationAlertProtocols(
  limit = 40,
): Promise<OperationsAlertProtocolSummary[]> {
  const adminClient = createAlertProtocolClient();

  if (!adminClient) {
    return [];
  }

  const { data, error } = await adminClient
    .from("hub_operations_alert_protocols")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(mapAlertProtocolRow);
}

export async function updateOperationAlertFeedback({
  feedback,
  protocol,
  status,
  userId,
}: {
  feedback: string;
  protocol: string;
  status: OperationsAlertFeedbackStatus;
  userId: string | null;
}): Promise<OperationsAlertProtocolSummary> {
  const adminClient = createAlertProtocolClient();

  if (!adminClient) {
    throw new Error("Supabase server-side nao configurado para SquadOps.");
  }

  const { data: currentProtocol, error: currentProtocolError } = await adminClient
    .from("hub_operations_alert_protocols")
    .select("*")
    .eq("protocol", protocol)
    .maybeSingle();

  if (currentProtocolError) {
    throw new Error(currentProtocolError.message);
  }

  if (!currentProtocol) {
    throw new Error("Protocolo de alerta nao encontrado.");
  }

  const normalizedFeedback = feedback.trim();
  const now = new Date().toISOString();
  const protocolStatus = technicalStatusToProtocolStatus(status);
  const isTreated = protocolStatus === "tratado";
  const { data: updatedProtocol, error: updateError } = await adminClient
    .from("hub_operations_alert_protocols")
    .update({
      status: protocolStatus,
      acknowledged_at: currentProtocol.acknowledged_at ?? now,
      acknowledged_by_user_id:
        currentProtocol.acknowledged_by_user_id ?? userId,
      technical_feedback: normalizedFeedback,
      technical_feedback_at: now,
      technical_feedback_by_user_id: userId,
      technical_feedback_status: status,
      treated_at: isTreated ? now : currentProtocol.treated_at,
      treated_by_user_id: isTreated
        ? userId
        : currentProtocol.treated_by_user_id,
      updated_by_user_id: userId,
    })
    .eq("id", currentProtocol.id)
    .select("*")
    .single();

  if (updateError) {
    throw new Error(updateError.message);
  }

  const { error: feedbackError } = await adminClient
    .from("hub_operations_alert_feedbacks")
    .insert({
      alert_protocol_id: currentProtocol.id,
      feedback: normalizedFeedback,
      informed_by_user_id: userId,
      metadata: {
        source: "squadops-operations-center",
      },
      status,
    });

  if (feedbackError) {
    throw new Error(feedbackError.message);
  }

  return mapAlertProtocolRow(updatedProtocol);
}

export async function acknowledgeOperationAlertProtocol({
  protocol,
  userId,
}: {
  protocol: string;
  userId: string | null;
}): Promise<OperationsAlertProtocolSummary> {
  const adminClient = createAlertProtocolClient();

  if (!adminClient) {
    throw new Error("Supabase server-side nao configurado para SquadOps.");
  }

  const now = new Date().toISOString();
  const { data, error } = await adminClient
    .from("hub_operations_alert_protocols")
    .update({
      acknowledged_at: now,
      acknowledged_by_user_id: userId,
      status: "monitorando",
      updated_by_user_id: userId,
    })
    .eq("protocol", protocol)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapAlertProtocolRow(data);
}

export async function ignoreOperationAlertProtocol({
  protocol,
  userId,
}: {
  protocol: string;
  userId: string | null;
}): Promise<OperationsAlertProtocolSummary> {
  const adminClient = createAlertProtocolClient();

  if (!adminClient) {
    throw new Error("Supabase server-side nao configurado para SquadOps.");
  }

  const now = new Date().toISOString();
  const { data, error } = await adminClient
    .from("hub_operations_alert_protocols")
    .update({
      acknowledged_at: now,
      acknowledged_by_user_id: userId,
      status: "silenciado",
      updated_by_user_id: userId,
    })
    .eq("protocol", protocol)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapAlertProtocolRow(data);
}

function createAlertProtocolClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient<OperationsAlertProtocolDatabase>(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

async function loadProtocolsByFingerprint(
  adminClient: OperationsAlertProtocolClient,
  fingerprints: string[],
) {
  const { data, error } = await adminClient
    .from("hub_operations_alert_protocols")
    .select("*")
    .in("fingerprint", fingerprints);

  if (error) {
    throw new Error(error.message);
  }

  return new Map(
    (data ?? []).map((protocol) => [protocol.fingerprint, protocol]),
  );
}

async function insertNewAlertProtocol(
  adminClient: OperationsAlertProtocolClient,
  alert: OperationsAlert,
  userId: string | null,
) {
  const protocol = await allocateAlertProtocolCode(adminClient, alert.protocol);
  const alertToSave = withAlertProtocolCode(alert, protocol);
  const { data, error } = await adminClient
    .from("hub_operations_alert_protocols")
    .insert({
      ...alertToInsert(alertToSave),
      created_by_user_id: userId,
      updated_by_user_id: userId,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapAlertProtocolRow(data);
}

async function updateExistingAlertProtocol(
  adminClient: OperationsAlertProtocolClient,
  existingProtocol: AlertProtocolRow,
  alert: OperationsAlert,
  userId: string | null,
) {
  const nextOccurrenceCount = Math.max(existingProtocol.occurrence_count + 1, 1);
  const alertToSave = withAlertProtocolCode(alert, existingProtocol.protocol);
  const { data, error } = await adminClient
    .from("hub_operations_alert_protocols")
    .update({
      ...alertToUpdate(alertToSave, existingProtocol, nextOccurrenceCount),
      updated_by_user_id: userId,
    })
    .eq("id", existingProtocol.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapAlertProtocolRow(data);
}

async function allocateAlertProtocolCode(
  adminClient: OperationsAlertProtocolClient,
  fallbackProtocol: string,
) {
  const { data, error } = await adminClient.rpc(
    "next_hub_operations_alert_protocol",
  );

  if (error || typeof data !== "string" || !data.trim()) {
    return fallbackProtocol;
  }

  return data.trim().toUpperCase();
}

function withAlertProtocolCode(
  alert: OperationsAlert,
  protocol: string,
): OperationsAlert {
  if (alert.protocol === protocol) {
    return alert;
  }

  return {
    ...alert,
    command: alert.command.split(alert.protocol).join(protocol),
    protocol,
  };
}

function alertToInsert(alert: OperationsAlert): AlertProtocolInsert {
  const base = alertToProtocolBase(alert);

  return {
    ...base,
    created_by_user_id: null,
    first_seen_at: alert.generatedAt,
    last_seen_at: alert.generatedAt,
    occurrence_count: 1,
    protocol: alert.protocol,
    status: "ativo",
    updated_by_user_id: null,
  };
}

function alertToUpdate(
  alert: OperationsAlert,
  existingProtocol: AlertProtocolRow,
  occurrenceCount: number,
): AlertProtocolUpdate {
  return {
    ...alertToProtocolBase(alert),
    last_seen_at: alert.generatedAt,
    occurrence_count: occurrenceCount,
    status: nextProtocolStatusForRecurringAlert(existingProtocol),
  };
}

function alertToProtocolBase(alert: OperationsAlert) {
  return {
    alert_type: alert.type,
    command: alert.command,
    endpoint: alert.endpoint,
    expected_result: alert.expectedResult,
    fingerprint: alert.fingerprint,
    http_status: alert.httpStatus,
    impact: alert.impact,
    level: alert.level,
    metadata: {
      alertId: alert.id,
      source: "operations-monitoring",
    },
    module: alert.module,
    origin: alert.origin,
    payload_bytes: alert.payloadBytes,
    received_result: alert.receivedResult,
    recommendation: alert.recommendation,
    recommended_agent: alert.recommendedAgent,
    response_ms: alert.responseMs,
    title: alert.title,
  } satisfies Omit<
    AlertProtocolInsert,
    | "created_by_user_id"
    | "first_seen_at"
    | "last_seen_at"
    | "occurrence_count"
    | "protocol"
    | "status"
    | "updated_by_user_id"
  >;
}

function mapAlertProtocolRow(
  row: AlertProtocolRow,
): OperationsAlertProtocolSummary {
  return {
    acknowledgedAt: row.acknowledged_at,
    analysis: buildAlertProtocolAnalysis(row),
    command: row.command,
    createdAt: row.created_at,
    endpoint: row.endpoint,
    expectedResult: row.expected_result,
    fingerprint: row.fingerprint,
    firstSeenAt: row.first_seen_at,
    httpStatus: row.http_status,
    id: row.id,
    impact: row.impact,
    lastSeenAt: row.last_seen_at,
    level: row.level,
    module: row.module,
    occurrenceCount: row.occurrence_count,
    origin: row.origin,
    payloadBytes: row.payload_bytes,
    protocol: row.protocol,
    receivedResult: row.received_result,
    recommendation: row.recommendation,
    recommendedAgent: row.recommended_agent,
    responseMs: row.response_ms,
    status: row.status,
    technicalFeedback: row.technical_feedback,
    technicalFeedbackAt: row.technical_feedback_at,
    technicalFeedbackStatus: row.technical_feedback_status,
    title: row.title,
    treatedAt: row.treated_at,
    type: row.alert_type,
    updatedAt: row.updated_at,
  };
}

function applyProtocolToAlert(
  alert: OperationsAlert,
  protocol: OperationsAlertProtocolSummary,
): OperationsAlert {
  return {
    ...alert,
    analysis: protocol.analysis,
    command: protocol.command,
    lastSeenAt: protocol.lastSeenAt,
    occurrenceCount: protocol.occurrenceCount,
    protocol: protocol.protocol,
    protocolStatus: protocol.status,
    protocolId: protocol.id,
    technicalFeedback: protocol.technicalFeedback,
    technicalFeedbackAt: protocol.technicalFeedbackAt,
    technicalFeedbackStatus: protocol.technicalFeedbackStatus,
  };
}

function buildUnavailableSyncResult(
  alerts: OperationsAlert[],
): AlertProtocolSyncResult {
  const protocols = alerts.map((alert) => fallbackProtocolFromAlert(alert));

  return {
    alerts: alerts.map((alert) => {
      const protocol = protocols.find(
        (item) => item.fingerprint === alert.fingerprint,
      );

      return protocol ? applyProtocolToAlert(alert, protocol) : alert;
    }),
    protocols,
    status: "indisponivel",
  };
}

function fallbackProtocolFromAlert(
  alert: OperationsAlert,
): OperationsAlertProtocolSummary {
  return {
    acknowledgedAt: null,
    analysis: alert.analysis,
    command: alert.command,
    createdAt: alert.generatedAt,
    endpoint: alert.endpoint,
    expectedResult: alert.expectedResult,
    fingerprint: alert.fingerprint,
    firstSeenAt: alert.generatedAt,
    httpStatus: alert.httpStatus,
    id: alert.id,
    impact: alert.impact,
    lastSeenAt: alert.generatedAt,
    level: alert.level,
    module: alert.module,
    occurrenceCount: 1,
    origin: alert.origin,
    payloadBytes: alert.payloadBytes,
    protocol: alert.protocol,
    receivedResult: alert.receivedResult,
    recommendation: alert.recommendation,
    recommendedAgent: alert.recommendedAgent,
    responseMs: alert.responseMs,
    status: "ativo",
    technicalFeedback: null,
    technicalFeedbackAt: null,
    technicalFeedbackStatus: "pendente",
    title: alert.title,
    treatedAt: null,
    type: alert.type,
    updatedAt: alert.generatedAt,
  };
}

function nextProtocolStatusForRecurringAlert(
  existingProtocol: AlertProtocolRow,
): OperationsAlertProtocolStatus {
  if (
    existingProtocol.status === "em_analise" ||
    existingProtocol.status === "monitorando" ||
    existingProtocol.status === "silenciado"
  ) {
    return existingProtocol.status;
  }

  return "ativo";
}

function buildAlertProtocolAnalysis(
  protocol: Pick<
    AlertProtocolRow,
    | "occurrence_count"
    | "protocol"
    | "status"
    | "technical_feedback_status"
  >,
): OperationsAlertAnalysis {
  if (protocol.status === "silenciado") {
    return {
      action: "ignorar",
      label: "Ignorado",
      reason: `O protocolo ${protocol.protocol} foi silenciado por Lucas.`,
      status: "ignorado",
    };
  }

  if (protocol.status === "tratado") {
    return {
      action: "acompanhar",
      label: "Tratado",
      reason: `O protocolo ${protocol.protocol} ja possui devolutiva conclusiva.`,
      status: "tratado",
    };
  }

  if (
    protocol.status === "em_analise" ||
    protocol.status === "monitorando" ||
    protocol.technical_feedback_status === "em_analise" ||
    protocol.technical_feedback_status === "persiste" ||
    protocol.technical_feedback_status === "bloqueado"
  ) {
    return {
      action: "acompanhar",
      label: "Em tratamento",
      reason: `O protocolo ${protocol.protocol} ja esta em acompanhamento.`,
      status: "em_tratamento",
    };
  }

  if (protocol.occurrence_count > 1) {
    return {
      action: "acompanhar",
      label: "Repetido",
      reason: `O mesmo alerta ja apareceu ${protocol.occurrence_count} vezes e foi agrupado no protocolo ${protocol.protocol}.`,
      status: "repetido",
    };
  }

  return {
    action: "acionar",
    label: "Novo",
    reason: `Primeira ocorrencia registrada no protocolo ${protocol.protocol}.`,
    status: "novo",
  };
}

function technicalStatusToProtocolStatus(
  status: OperationsAlertFeedbackStatus,
): OperationsAlertProtocolStatus {
  if (
    status === "corrigido" ||
    status === "nao_observado" ||
    status === "falso_positivo"
  ) {
    return "tratado";
  }

  if (status === "em_analise") {
    return "em_analise";
  }

  if (status === "persiste" || status === "bloqueado") {
    return "ativo";
  }

  return "monitorando";
}
