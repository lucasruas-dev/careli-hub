import { NextResponse } from "next/server";

import { authorizeHadesRead } from "@/lib/guardian/auth";
import {
  loadHadesAttendanceQueue,
  loadHadesAttendanceQueueSummary,
} from "@/lib/guardian/attendance";
import { sanitizeHadesDbError } from "@/lib/guardian/db";
import { loadHadesAttendanceQueueReadModel } from "@/lib/guardian/read-model";
import type { QueueClient } from "@/modules/guardian/attendance/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_QUEUE_LIMIT = 50;
const MIN_QUEUE_LIMIT = 20;
const MAX_QUEUE_LIMIT = 2_000;
const READ_MODEL_MAX_AGE_MS = 60_000;

type QueueResponsePayload = {
  clients: QueueClient[];
  meta: {
    count: number;
    limit: number;
    loadedCount?: number;
    stale?: boolean;
    syncedAt?: string | null;
  };
  source: "c2x" | "supabase-c2x";
};

export async function GET(request: Request) {
  const auth = await authorizeHadesRead(request);

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const url = new URL(request.url);
    const limit = parseQueueLimit(url.searchParams.get("limit"));

    try {
      const clients = await loadHadesAttendanceQueueSummary({
        limit,
        strict: true,
      });

      return queueJson(
        {
          clients,
          meta: {
            count: clients.length,
            limit,
            loadedCount: clients.length,
          },
          source: "c2x",
        },
        "LIVE_COMPACT",
      );
    } catch {
      try {
        const readModelResult = await loadHadesAttendanceQueueReadModel({
          limit,
        });

        if (readModelResult?.clients.length) {
          const isFresh = isFreshReadModel(readModelResult.syncedAt);

          return queueJson(
            readModelPayload(readModelResult, limit, { stale: !isFresh }),
            isFresh ? "FRESH_FALLBACK" : "STALE_FALLBACK",
          );
        }
      } catch (readModelError) {
        console.warn(
          "[guardian-attendance] Read model fallback failed",
          sanitizeHadesDbError(readModelError),
        );
      }

      const clients = await loadHadesAttendanceQueue({
        includeInstallments: false,
        limit,
        strict: true,
      });

      return queueJson(
        {
          clients,
          meta: {
            count: clients.length,
            limit,
            loadedCount: clients.length,
          },
          source: "c2x",
        },
        "LIVE_FULL_FALLBACK",
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        detail: sanitizeHadesDbError(error),
        error: "Nao foi possivel carregar a fila do C2X.",
      },
      { status: 500 },
    );
  }
}

function queueJson(payload: QueueResponsePayload, cacheStatus: string) {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      "X-Hades-Queue-Cache": cacheStatus,
    },
  });
}

function readModelPayload(
  readModelResult: NonNullable<
    Awaited<ReturnType<typeof loadHadesAttendanceQueueReadModel>>
  >,
  limit: number,
  options: { stale: boolean },
): QueueResponsePayload {
  return {
    clients: readModelResult.clients,
    meta: {
      count: readModelResult.count ?? readModelResult.clients.length,
      limit,
      loadedCount: readModelResult.clients.length,
      stale: options.stale,
      syncedAt: readModelResult.syncedAt,
    },
    source: "supabase-c2x",
  };
}

function parseQueueLimit(value: string | null) {
  const parsed = Number(value ?? DEFAULT_QUEUE_LIMIT);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_QUEUE_LIMIT;
  }

  return Math.min(
    Math.max(Math.trunc(parsed), MIN_QUEUE_LIMIT),
    MAX_QUEUE_LIMIT,
  );
}

function isFreshReadModel(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) && Date.now() - timestamp <= READ_MODEL_MAX_AGE_MS;
}
