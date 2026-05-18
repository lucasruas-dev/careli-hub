import { createClient } from "@supabase/supabase-js";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import type {
  OperationsCheckMetric,
  OperationsGeneralStatus,
  OperationsMonitoringSnapshot,
  OperationsRiskLevel,
  OpsWatcherDecision,
} from "@/lib/operations/monitoring";

type MonitoringRunInsert = {
  alert_count: number;
  created_by_user_id: string | null;
  critical_alerts: number;
  generated_at: string;
  high_alerts: number;
  highest_risk: OperationsRiskLevel | null;
  metadata: Record<string, unknown>;
  payload_critical: number;
  slow_checks: number;
  source: string;
  status: OperationsGeneralStatus | "aguardando";
  total_checks: number;
};

type MonitoringCheckInsert = {
  alert_generated: boolean;
  check_id: string;
  checked_at: string;
  endpoint: string | null;
  expected_result: string | null;
  metadata: Record<string, unknown>;
  module: string;
  origin: string;
  payload_bytes: number;
  payload_risk: string;
  received_result: string | null;
  response_ms: number;
  risk: OperationsRiskLevel;
  run_id: string;
  status_code: number | null;
  time_risk: string;
};

type WatcherNotificationUpsert = {
  agent: string;
  command: string | null;
  cooldown_seconds: number;
  dedupe_key: string;
  generated_at: string;
  impact: string | null;
  last_seen_at: string;
  message: string;
  metadata: Record<string, unknown>;
  notify_lucas: boolean;
  occurrence_count?: number;
  protocol: string | null;
  reason: string | null;
  risk: OperationsRiskLevel;
  source_alert_ids: string[];
  source_alert_protocols: string[];
  status: OpsWatcherDecision["status"];
};

type MonitoringStoreDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: {
      hub_operations_monitoring_status: OperationsGeneralStatus | "aguardando";
      hub_operations_risk_level: OperationsRiskLevel;
    };
    Functions: Record<string, never>;
    Tables: {
      hub_operations_monitoring_check_runs: {
        Insert: MonitoringRunInsert;
        Relationships: [];
        Row: MonitoringRunInsert & {
          created_at: string;
          id: string;
        };
        Update: Partial<MonitoringRunInsert>;
      };
      hub_operations_monitoring_checks: {
        Insert: MonitoringCheckInsert;
        Relationships: [];
        Row: MonitoringCheckInsert & {
          created_at: string;
          id: string;
        };
        Update: Partial<MonitoringCheckInsert>;
      };
      hub_operations_watcher_notifications: {
        Insert: WatcherNotificationUpsert;
        Relationships: [];
        Row: WatcherNotificationUpsert & {
          created_at: string;
          id: string;
          occurrence_count: number;
          updated_at: string;
        };
        Update: Partial<WatcherNotificationUpsert>;
      };
    };
    Views: Record<string, never>;
  };
};

type MonitoringStoreClient = ReturnType<
  typeof createClient<MonitoringStoreDatabase>
>;

export async function persistOperationsMonitoringSnapshot({
  snapshot,
  userId,
}: {
  snapshot: OperationsMonitoringSnapshot;
  userId: string | null;
}) {
  const adminClient = createMonitoringStoreClient();

  if (!adminClient) {
    return;
  }

  try {
    const highestRisk =
      snapshot.cards.activeAlerts.highestLevel === "nenhum"
        ? null
        : snapshot.cards.activeAlerts.highestLevel;
    const { data: run, error: runError } = await adminClient
      .from("hub_operations_monitoring_check_runs")
      .insert({
        alert_count: snapshot.alerts.length,
        created_by_user_id: userId,
        critical_alerts: snapshot.metrics.criticalAlerts,
        generated_at: snapshot.generatedAt,
        high_alerts: snapshot.metrics.highAlerts,
        highest_risk: highestRisk,
        metadata: {
          protocolSyncStatus: snapshot.protocolSyncStatus,
        },
        payload_critical: snapshot.metrics.payloadCritical,
        slow_checks: snapshot.metrics.slowChecks,
        source: "squadops-center",
        status: snapshot.cards.status.value,
        total_checks: snapshot.metrics.totalChecks,
      })
      .select("id")
      .single();

    if (runError || !run) {
      throw new Error(runError?.message ?? "Nao foi possivel registrar run.");
    }

    const checks = snapshot.checks.map((check) =>
      mapMonitoringCheck(check, run.id),
    );

    if (checks.length > 0) {
      const { error: checksError } = await adminClient
        .from("hub_operations_monitoring_checks")
        .insert(checks);

      if (checksError) {
        throw new Error(checksError.message);
      }
    }
  } catch (error) {
    console.warn(
      "[SquadOps] monitoring history unavailable",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

export async function persistOpsWatcherDecision({
  decision,
  userId,
}: {
  decision: OpsWatcherDecision;
  userId: string | null;
}) {
  const adminClient = createMonitoringStoreClient();

  if (!adminClient) {
    return;
  }

  try {
    const { data: existingNotification } = await adminClient
      .from("hub_operations_watcher_notifications")
      .select("id, occurrence_count")
      .eq("dedupe_key", decision.dedupeKey)
      .maybeSingle();
    const nextOccurrenceCount =
      (existingNotification?.occurrence_count ?? 0) + 1;
    const payload: WatcherNotificationUpsert = {
      agent: decision.agent,
      command: decision.command || null,
      cooldown_seconds: decision.cooldownSeconds,
      dedupe_key: decision.dedupeKey,
      generated_at: decision.generatedAt,
      impact: decision.impact || null,
      last_seen_at: new Date().toISOString(),
      message: decision.message,
      metadata: {
        acknowledgedByDefault: userId ? false : null,
      },
      notify_lucas: decision.notifyLucas,
      occurrence_count: nextOccurrenceCount,
      protocol: decision.protocol ?? null,
      reason: decision.reason || null,
      risk: decision.risk,
      source_alert_ids: decision.sourceAlertIds,
      source_alert_protocols: decision.sourceAlertProtocols,
      status: decision.status,
    };

    const { error } = await adminClient
      .from("hub_operations_watcher_notifications")
      .upsert(payload, {
        onConflict: "dedupe_key",
      });

    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    console.warn(
      "[SquadOps] watcher notification history unavailable",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

function createMonitoringStoreClient(): MonitoringStoreClient | null {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient<MonitoringStoreDatabase>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function mapMonitoringCheck(
  check: OperationsCheckMetric,
  runId: string,
): MonitoringCheckInsert {
  return {
    alert_generated: check.alertGenerated,
    check_id: check.id,
    checked_at: check.checkedAt,
    endpoint: check.endpoint || null,
    expected_result: check.expected.description,
    metadata: {
      group: check.group,
      ok: check.ok,
      sourceMeta: check.meta ?? null,
    },
    module: check.module,
    origin: check.label,
    payload_bytes: check.payloadBytes,
    payload_risk: check.payloadRisk,
    received_result: check.received,
    response_ms: check.responseMs,
    risk: check.risk,
    run_id: runId,
    status_code: check.statusCode,
    time_risk: check.timeRisk,
  };
}
