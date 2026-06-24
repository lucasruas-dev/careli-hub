import { type NextRequest } from "next/server";

import { authorizeZeusAdminRequest } from "@/lib/squadops/admin-access";
import {
  getOperationsCostSnapshot,
  type OperationsCostSnapshot,
} from "@/lib/operations/cost";
import { collectOperationsDataSources } from "@/lib/operations/data-sources";
import { syncOperationAlertProtocols } from "@/lib/operations/alert-protocols";
import { buildOperationsMonitoringSnapshot } from "@/lib/operations/monitoring";
import { persistOperationsMonitoringSnapshot } from "@/lib/squadops/monitoring-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROTOCOL_SYNC_TIMEOUT_MS = 6_000;
const SNAPSHOT_PERSIST_TIMEOUT_MS = 4_000;
const COST_SNAPSHOT_TIMEOUT_MS = 6_000;

export async function GET(request: NextRequest) {
  const authorization = await authorizeZeusAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const shouldWriteMonitoringState = shouldPersistMonitoringState(request);
  const rawChecks = await collectOperationsDataSources({
    origin: new URL(request.url).origin,
  });
  const snapshot = buildOperationsMonitoringSnapshot(rawChecks);
  const protocolSync = shouldWriteMonitoringState
    ? await withMonitoringTimeout({
        fallback: {
          alerts: snapshot.alerts,
          protocols: [],
          status: "indisponivel" as const,
        },
        label: "alert protocol sync",
        promise: syncOperationAlertProtocols(
          snapshot.alerts,
          authorization.userId,
        ),
        timeoutMs: PROTOCOL_SYNC_TIMEOUT_MS,
      })
    : {
        alerts: snapshot.alerts,
        protocols: [],
        status: snapshot.protocolSyncStatus,
      };
  // Custo D-1 (cacheado 30min na fonte). Best-effort: se a Vercel demorar/falhar,
  // o snapshot sai sem custo, sem travar o monitoring.
  const cost = await withMonitoringTimeout<OperationsCostSnapshot | undefined>({
    fallback: undefined,
    label: "cost snapshot",
    promise: getOperationsCostSnapshot(),
    timeoutMs: COST_SNAPSHOT_TIMEOUT_MS,
  });
  const snapshotWithProtocols = {
    ...snapshot,
    alertProtocols: protocolSync.protocols,
    alerts: protocolSync.alerts,
    cost,
    protocolSyncStatus: protocolSync.status,
  };

  if (shouldWriteMonitoringState) {
    await withMonitoringTimeout({
      fallback: null,
      label: "snapshot persist",
      promise: persistOperationsMonitoringSnapshot({
        snapshot: snapshotWithProtocols,
        userId: authorization.userId,
      }).then(() => null),
      timeoutMs: SNAPSHOT_PERSIST_TIMEOUT_MS,
    });
  }

  return Response.json(snapshotWithProtocols, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function shouldPersistMonitoringState(request: NextRequest) {
  if (request.nextUrl.searchParams.get("persist") === "1") {
    return true;
  }

  const hostname = request.nextUrl.hostname.toLowerCase();

  return hostname !== "localhost" && hostname !== "127.0.0.1";
}

async function withMonitoringTimeout<T>({
  fallback,
  label,
  promise,
  timeoutMs,
}: {
  fallback: T;
  label: string;
  promise: Promise<T>;
  timeoutMs: number;
}) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(
            `[Zeus] monitoring ${label} timed out after ${timeoutMs}ms`,
          );
          resolve(fallback);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
