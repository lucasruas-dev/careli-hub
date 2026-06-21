import { type NextRequest } from "next/server";

import { syncChronosGoogleCalendar } from "@/lib/chronos/google-calendar";
import {
  authorizeChronosRequest,
  isChronosForbiddenError,
} from "@/lib/chronos/server";
import type { ChronosGoogleCalendarSyncDirection } from "@/lib/chronos/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Agendas grandes processam muitos eventos por sincronizacao; o tempo padrao
// (curto) estourava com 504. Damos uma janela maior, ainda contida pelo teto
// de paginas do pull.
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const input = (await request.json().catch(() => null)) as {
      direction?: unknown;
      forceFullSync?: unknown;
    } | null;
    const direction = normalizeSyncDirection(input?.direction);
    const result = await syncChronosGoogleCalendar({
      direction,
      forceFullSync: input?.forceFullSync === true,
      userId: authorization.user.id,
    });
    const safeSyncLog = {
      diagnostics: result.diagnostics,
      direction: result.direction,
      error: result.error,
      forceFullSync: input?.forceFullSync === true,
      processed: result.processed,
      skipped: result.skipped,
      status: result.status,
      synced: result.synced,
    };

    if (result.status === "failed") {
      console.error("[chronos/google-calendar] sync_failed", safeSyncLog);
    } else {
      console.info("[chronos/google-calendar] sync_finished", safeSyncLog);
    }

    return Response.json(
      {
        ...(result.status === "failed" && result.error
          ? { error: result.error }
          : {}),
        googleCalendar: result,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
        status: result.status === "failed" ? 503 : 200,
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.message.trim()
            ? error.message
            : "Nao foi possivel sincronizar Google Agenda.",
      },
      { status: isChronosForbiddenError(error) ? 403 : 400 },
    );
  }
}

function normalizeSyncDirection(
  value: unknown,
): ChronosGoogleCalendarSyncDirection {
  return value === "pull" || value === "push" || value === "both"
    ? value
    : "both";
}
