import { createClient } from "@supabase/supabase-js";

import {
  loadGuardianOverview,
  type GuardianOverviewSnapshot,
} from "@/lib/guardian/overview";
import { loadGuardianAttendanceQueue } from "@/lib/guardian/attendance";
import type { AttendancePriority, QueueClient } from "@/modules/guardian/attendance/types";

type SyncResult =
  | {
      error: string;
      ok: false;
    }
  | {
      ok: true;
      rowsWritten: number;
      syncRunId: string;
    };

type SupabaseAdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

const PRIORITY_BY_LABEL: Record<AttendancePriority, "critical" | "high" | "low" | "medium"> = {
  Alta: "high",
  Baixa: "low",
  Crítica: "critical",
  Média: "medium",
};

export async function syncGuardianC2xReadModel(): Promise<SyncResult> {
  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    return {
      error: "Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para sincronizar o Guardian.",
      ok: false,
    };
  }

  const syncRun = await startSyncRun(adminClient);

  if (!syncRun.ok) {
    return syncRun;
  }

  try {
    const [overviewResult, queueClients] = await Promise.all([
      loadGuardianOverview(),
      loadGuardianAttendanceQueue({ includeInstallments: false }),
    ]);

    if (!overviewResult.ok) {
      throw new Error("Conexao C2X indisponivel para gerar o snapshot.");
    }

    let rowsWritten = 0;

    rowsWritten += await persistOverviewSnapshot(
      adminClient,
      syncRun.syncRunId,
      overviewResult.data,
    );
    rowsWritten += await persistAttendanceQueue(
      adminClient,
      syncRun.syncRunId,
      queueClients,
    );

    const { error: finishError } = await adminClient
      .from("c2x_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        rows_read: queueClients.length,
        rows_written: rowsWritten,
        status: "success",
      })
      .eq("id", syncRun.syncRunId);

    if (finishError) {
      throw finishError;
    }

    return {
      ok: true,
      rowsWritten,
      syncRunId: syncRun.syncRunId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao sincronizar o C2X.";

    await adminClient
      .from("c2x_sync_runs")
      .update({
        error_message: message,
        finished_at: new Date().toISOString(),
        status: "failed",
      })
      .eq("id", syncRun.syncRunId);

    return {
      error: message,
      ok: false,
    };
  }
}

export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function startSyncRun(adminClient: SupabaseAdminClient): Promise<SyncResult> {
  const { data, error } = await adminClient
    .from("c2x_sync_runs")
    .insert({
      metadata: {
        strategy: "guardian-read-model",
      },
      scope: "guardian",
      source: "c2x",
      status: "running",
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    return {
      error: error?.message ?? "Nao foi possivel registrar a sincronizacao.",
      ok: false,
    };
  }

  return {
    ok: true,
    rowsWritten: 1,
    syncRunId: String(data.id),
  };
}

async function persistOverviewSnapshot(
  adminClient: SupabaseAdminClient,
  syncRunId: string,
  snapshot: GuardianOverviewSnapshot,
) {
  await adminClient
    .from("c2x_guardian_financial_snapshots")
    .update({ is_current: false })
    .eq("is_current", true);

  const summary = snapshot.summary;
  const delinquencyBaseAmount =
    summary.overduePrincipalAmount + summary.liquidatedAmount;
  const delinquencyRate =
    delinquencyBaseAmount > 0
      ? (summary.overduePrincipalAmount / delinquencyBaseAmount) * 100
      : 0;
  const monthlyRecoveryRate =
    summary.overduePrincipalAmount > 0
      ? (summary.monthlyRecoveryAmount / summary.overduePrincipalAmount) * 100
      : 0;
  const { data: financialSnapshot, error: snapshotError } = await adminClient
    .from("c2x_guardian_financial_snapshots")
    .insert({
      critical_contracts: summary.criticalContracts,
      delinquency_base_amount: delinquencyBaseAmount,
      delinquency_rate: delinquencyRate,
      is_current: true,
      liquidated_amount: summary.liquidatedAmount,
      liquidated_payments: summary.liquidatedPayments,
      monthly_recovery_amount: summary.monthlyRecoveryAmount,
      monthly_recovery_payments: summary.monthlyRecoveryPayments,
      monthly_recovery_rate: monthlyRecoveryRate,
      overdue_amount: summary.overduePrincipalAmount,
      overdue_clients: summary.overdueClients,
      overdue_payments: summary.overduePrincipalPayments,
      pending_amount: summary.pendingAmount,
      pending_payments: summary.pendingPayments,
      source_sync_run_id: syncRunId,
      total_portfolio_amount: summary.totalPortfolioAmount,
      total_portfolio_payments: summary.totalPortfolioPayments,
    })
    .select("id")
    .single();

  if (snapshotError || !financialSnapshot?.id) {
    throw snapshotError ?? new Error("Snapshot financeiro sem ID.");
  }

  const snapshotId = String(financialSnapshot.id);
  const enterpriseRows = snapshot.enterprisePerformance.map((enterprise) => {
    const baseAmount =
      enterprise.delinquencyBaseAmount ||
      enterprise.overduePrincipalAmount + enterprise.totalPortfolioAmount;
    const enterpriseRecoveryRate =
      enterprise.overduePrincipalAmount > 0
        ? (enterprise.monthlyRecoveryAmount / enterprise.overduePrincipalAmount) * 100
        : 0;

    return {
      delinquency_base_amount: enterprise.delinquencyBaseAmount,
      delinquency_rate:
        baseAmount > 0 ? (enterprise.overduePrincipalAmount / baseAmount) * 100 : 0,
      enterprise_group_key: slugify(enterprise.enterpriseName),
      enterprise_name: enterprise.enterpriseName,
      monthly_recovery_amount: enterprise.monthlyRecoveryAmount,
      monthly_recovery_payments: enterprise.monthlyRecoveryPayments,
      monthly_recovery_rate: enterpriseRecoveryRate,
      overdue_amount: enterprise.overduePrincipalAmount,
      overdue_clients: enterprise.overdueClients,
      overdue_payments: enterprise.overduePrincipalPayments,
      snapshot_id: snapshotId,
      total_portfolio_amount: enterprise.totalPortfolioAmount,
      total_portfolio_payments: enterprise.totalPortfolioPayments,
    };
  });
  const agingRows = snapshot.overdueAging.map((bucket, index) => ({
    amount: 0,
    bucket_key: slugify(bucket.label),
    label: bucket.label,
    payments: bucket.total,
    snapshot_id: snapshotId,
    sort_order: index + 1,
  }));
  const compositionRows = snapshot.billingComposition.map((bucket, index) => ({
    amount: 0,
    label: bucket.label,
    parcel_type_key: slugify(bucket.label),
    payments: bucket.total,
    snapshot_id: snapshotId,
    sort_order: index + 1,
  }));

  await insertRows(adminClient, "c2x_guardian_enterprise_performance", enterpriseRows);
  await insertRows(adminClient, "c2x_guardian_overdue_aging", agingRows);
  await insertRows(adminClient, "c2x_guardian_billing_composition", compositionRows);

  return 1 + enterpriseRows.length + agingRows.length + compositionRows.length;
}

async function persistAttendanceQueue(
  adminClient: SupabaseAdminClient,
  syncRunId: string,
  queueClients: QueueClient[],
) {
  const users = queueClients
    .map((client) => {
      const c2xId = extractC2xId(client.id);

      if (!c2xId) {
        return null;
      }

      return {
        c2x_id: c2xId,
        display_name: client.nome,
        document: client.cpf,
        phone: client.dados360.telefone,
        synced_at: new Date().toISOString(),
        sync_run_id: syncRunId,
      };
    })
    .filter((user): user is NonNullable<typeof user> => user !== null);

  await insertRows(adminClient, "c2x_users", users, { onConflict: "c2x_id" });

  await adminClient
    .from("c2x_guardian_attendance_queue")
    .update({ is_current: false })
    .eq("is_current", true);

  const queueRows = queueClients
    .map((client) => {
      const clientC2xId = extractC2xId(client.id);

      if (!clientC2xId) {
        return null;
      }

      return {
        client_c2x_id: clientC2xId,
        client_name: client.nome,
        document: client.cpf,
        enterprise_name: client.carteira.empreendimento,
        is_current: true,
        linked_party_name: client.carteira.imobiliariaCorretor,
        metadata: {
          dados360: client.dados360,
          relationship: client.dados360.relacionamento,
          segment: client.segmento,
          unitIds: client.carteira.unidades.map((unit) => unit.id),
        },
        overdue_amount: parseCurrency(client.saldoDevedor),
        overdue_days: client.atrasoDias,
        overdue_payments: client.parcelas.vencidas,
        phone: client.dados360.telefone,
        priority: PRIORITY_BY_LABEL[client.prioridade],
        risk_score: client.scoreRisco,
        source_sync_run_id: syncRunId,
        synced_at: new Date().toISOString(),
        unit_label: client.carteira.unidades[0]?.unidadeLote ?? null,
        workflow_status: client.workflow.stage,
      };
    })
    .filter((queueRow): queueRow is NonNullable<typeof queueRow> => queueRow !== null);

  await insertRows(adminClient, "c2x_guardian_attendance_queue", queueRows);

  return users.length + queueRows.length;
}

async function insertRows(
  adminClient: SupabaseAdminClient,
  table: string,
  rows: Record<string, unknown>[],
  options: { onConflict?: string } = {},
) {
  if (rows.length === 0) {
    return;
  }

  const query = adminClient.from(table).upsert(rows, options);
  const { error } = await query;

  if (error) {
    throw error;
  }
}

function extractC2xId(value: string) {
  const match = value.match(/(\d+)$/);

  return match ? Number(match[1]) : null;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function parseCurrency(value: string) {
  const normalized = value
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}
