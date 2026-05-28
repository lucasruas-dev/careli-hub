import { type NextRequest } from "next/server";

import { syncChronosGoogleCalendar } from "@/lib/chronos/google-calendar";
import {
  authorizeChronosRequest,
  isChronosForbiddenError,
} from "@/lib/chronos/server";
import type { ChronosGoogleCalendarSyncDirection } from "@/lib/chronos/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const input = (await request.json().catch(() => null)) as {
      direction?: unknown;
      full?: unknown;
    } | null;
    const direction = normalizeSyncDirection(input?.direction);
    const result = await syncChronosGoogleCalendar({
      direction,
      forceFull: input?.full === true,
      userId: authorization.user.id,
    });

    return Response.json(
      { googleCalendar: result },
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
