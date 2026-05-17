import { type NextRequest } from "next/server";

import { collectOperationsDataSources } from "@/lib/operations/data-sources";
import {
  buildOperationsMonitoringSnapshot,
  buildOpsWatcherDecision,
  type OperationsMonitoringSnapshot,
} from "@/lib/operations/monitoring";
import { authorizeSquadOpsAdminRequest } from "@/lib/squadops/admin-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return createWatcherResponse(request);
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as
    | { snapshot?: unknown }
    | null;
  const snapshot = isMonitoringSnapshot(payload?.snapshot)
    ? payload.snapshot
    : undefined;

  return createWatcherResponse(request, snapshot);
}

async function createWatcherResponse(
  request: NextRequest,
  inputSnapshot?: OperationsMonitoringSnapshot,
) {
  const authorization = await authorizeSquadOpsAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const snapshot =
    inputSnapshot ??
    buildOperationsMonitoringSnapshot(
      await collectOperationsDataSources({
        origin: new URL(request.url).origin,
      }),
    );
  const watcher = buildOpsWatcherDecision(snapshot);

  return Response.json(
    {
      snapshot: {
        alerts: snapshot.alerts,
        generatedAt: snapshot.generatedAt,
        metrics: snapshot.metrics,
        status: snapshot.cards.status,
      },
      watcher,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function isMonitoringSnapshot(
  value: unknown,
): value is OperationsMonitoringSnapshot {
  const snapshot = value as Partial<OperationsMonitoringSnapshot> | null;

  return Boolean(
    snapshot &&
      typeof snapshot === "object" &&
      Array.isArray(snapshot.alerts) &&
      Array.isArray(snapshot.checks) &&
      snapshot.cards &&
      typeof snapshot.cards === "object" &&
      typeof snapshot.generatedAt === "string" &&
      snapshot.metrics &&
      typeof snapshot.metrics === "object",
  );
}
