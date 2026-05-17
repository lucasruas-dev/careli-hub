import { type NextRequest } from "next/server";

import { authorizeSquadOpsAdminRequest } from "@/lib/squadops/admin-access";
import { collectOperationsDataSources } from "@/lib/operations/data-sources";
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

  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
