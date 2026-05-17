import { NextResponse } from "next/server";

import { loadGuardianAttendanceQueue } from "@/lib/guardian/attendance";
import { sanitizeGuardianDbError } from "@/lib/guardian/db";
import { loadGuardianAttendanceQueueReadModel } from "@/lib/guardian/read-model";
import type { QueueClient } from "@/modules/guardian/attendance/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_QUEUE_LIMIT = 50;
const MIN_QUEUE_LIMIT = 20;
const MAX_QUEUE_LIMIT = 2_000;
const READ_MODEL_CACHE_TTL_MS = 10_000;

type QueueResponsePayload = {
  clients: QueueClient[];
  meta: {
    count: number;
    limit: number;
    loadedCount?: number;
  };
  source: "c2x" | "supabase-c2x";
};

const readModelResponseCache = new Map<
  number,
  { expiresAt: number; payload: QueueResponsePayload }
>();

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = parseQueueLimit(url.searchParams.get("limit"));

    const cachedPayload = getCachedReadModelPayload(limit);

    if (cachedPayload) {
      return queueJson(cachedPayload, "HIT");
    }

    const readModelResult = await loadGuardianAttendanceQueueReadModel({
      limit,
    });

    if (readModelResult?.clients.length) {
      const payload: QueueResponsePayload = {
        clients: readModelResult.clients,
        meta: {
          count: readModelResult.count ?? readModelResult.clients.length,
          limit,
          loadedCount: readModelResult.clients.length,
        },
        source: "supabase-c2x",
      };

      setCachedReadModelPayload(limit, payload);

      return queueJson(payload, "MISS");
    }

    const clients = await loadGuardianAttendanceQueue({
      includeInstallments: false,
      limit,
    });

    return queueJson(
      {
        clients,
        meta: {
          count: clients.length,
          limit,
        },
        source: "c2x",
      },
      "BYPASS",
    );
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

function queueJson(payload: QueueResponsePayload, cacheStatus: string) {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      "X-Guardian-Queue-Cache": cacheStatus,
    },
  });
}

function getCachedReadModelPayload(limit: number) {
  const cached = readModelResponseCache.get(limit);

  if (!cached || cached.expiresAt <= Date.now()) {
    readModelResponseCache.delete(limit);
    return null;
  }

  return cached.payload;
}

function setCachedReadModelPayload(
  limit: number,
  payload: QueueResponsePayload,
) {
  readModelResponseCache.set(limit, {
    expiresAt: Date.now() + READ_MODEL_CACHE_TTL_MS,
    payload,
  });
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
