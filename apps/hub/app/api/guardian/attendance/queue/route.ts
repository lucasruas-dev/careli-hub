import { NextResponse } from "next/server";

import { loadGuardianAttendanceQueue } from "@/lib/guardian/attendance";
import { sanitizeGuardianDbError } from "@/lib/guardian/db";
import { loadGuardianAttendanceQueueReadModel } from "@/lib/guardian/read-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_QUEUE_LIMIT = 1_000;
const MIN_QUEUE_LIMIT = 20;
const MAX_QUEUE_LIMIT = 2_000;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = parseQueueLimit(url.searchParams.get("limit"));
    const readModelClients = await loadGuardianAttendanceQueueReadModel({ limit });

    if (readModelClients?.length) {
      return NextResponse.json({
        clients: readModelClients,
        meta: {
          count: readModelClients.length,
          limit,
        },
        source: "supabase-c2x",
      });
    }

    const clients = await loadGuardianAttendanceQueue({
      includeInstallments: false,
      limit,
    });

    return NextResponse.json({
      clients,
      meta: {
        count: clients.length,
        limit,
      },
      source: "c2x",
    });
  } catch (error) {
    return NextResponse.json(
      {
        detail: sanitizeGuardianDbError(error),
        error: "Nao foi possivel carregar a fila do C2X.",
      },
      { status: 500 },
    );
  }
}

function parseQueueLimit(value: string | null) {
  const parsed = Number(value ?? DEFAULT_QUEUE_LIMIT);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_QUEUE_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(parsed), MIN_QUEUE_LIMIT), MAX_QUEUE_LIMIT);
}
