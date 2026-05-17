import { type NextRequest } from "next/server";

import { authorizeSquadOpsAdminRequest } from "@/lib/squadops/admin-access";
import { loadEngineeringOperationsFromFile } from "@/lib/squadops/engineering-operations-source";
import {
  loadStructuredEngineeringOperations,
  syncEngineeringOperationsToStore,
} from "@/lib/squadops/engineering-operations-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeSquadOpsAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit = Math.min(
    Math.max(Number.parseInt(limitParam ?? "120", 10) || 120, 1),
    500,
  );
  const result = await loadStructuredEngineeringOperations(limit);

  if (!result.ok) {
    return Response.json(
      {
        error: result.error,
        storage: {
          records: [],
          status: result.status,
          syncRuns: [],
        },
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      storage: {
        records: result.records,
        status: result.status,
        syncRuns: result.syncRuns,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeSquadOpsAdminRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const operations = await loadEngineeringOperationsFromFile();

  if (!operations.data) {
    return Response.json(
      {
        error:
          operations.error ?? "Nao foi possivel ler o Engineering Operations.",
      },
      { status: operations.error?.includes("nao encontrado") ? 404 : 500 },
    );
  }

  const result = await syncEngineeringOperationsToStore({
    operations: operations.data,
    userId: authorization.userId,
  });

  if (!result.ok) {
    return Response.json(
      {
        error: result.error,
        storage: result,
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      storage: result,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
