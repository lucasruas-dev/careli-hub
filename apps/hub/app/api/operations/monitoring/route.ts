import { type NextRequest } from "next/server";

import { authorizeSquadOpsAdminRequest } from "@/lib/squadops/admin-access";
import { collectOperationsDataSources } from "@/lib/operations/data-sources";
import { syncOperationAlertProtocols } from "@/lib/operations/alert-protocols";
import { buildOperationsMonitoringSnapshot } from "@/lib/operations/monitoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeSquadOpsAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const rawChecks = await collectOperationsDataSources({
    origin: new URL(request.url).origin,
  });
  const snapshot = buildOperationsMonitoringSnapshot(rawChecks);
  const protocolSync = await syncOperationAlertProtocols(
    snapshot.alerts,
    authorization.userId,
  );
  const snapshotWithProtocols = {
    ...snapshot,
    alertProtocols: protocolSync.protocols,
    alerts: protocolSync.alerts,
    protocolSyncStatus: protocolSync.status,
  };

  return Response.json(snapshotWithProtocols, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
