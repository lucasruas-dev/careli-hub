import { type NextRequest } from "next/server";

import {
  authorizeChronosRequest,
  createChronosMeeting,
  deleteChronosMeeting,
  isChronosForbiddenError,
  isChronosSchemaMissingError,
  listChronosSnapshot,
  updateChronosMeeting,
} from "@/lib/chronos/server";
import { syncChronosMeetingToGoogleCalendar } from "@/lib/chronos/google-calendar";
import { logMemory } from "@/lib/observability/memory";
import { type ChronosSnapshot } from "@/lib/chronos/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    logMemory("chronos-snapshot:inicio");

    const snapshot = await listChronosSnapshot(authorization);

    logMemory("chronos-snapshot:fim", {
      meetingCount: snapshot.meetings.length,
    });
    logChronosDriveSnapshotDiagnostic(snapshot);

    return Response.json(snapshot, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[chronos] snapshot_load_failed", getChronosSafeErrorLog(error));

    return Response.json(
      {
        error: getChronosApiErrorMessage(
          error,
          "Nao foi possivel carregar o Chronos.",
        ),
      },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const meeting = await createChronosMeeting({
      authorization,
      input: await request.json().catch(() => null),
    });

    try {
      await syncChronosMeetingToGoogleCalendar({
        meetingId: meeting.id,
        trigger: "chronos_agenda_create",
        userId: authorization.user.id,
      });
    } catch (syncError) {
      console.error(
        "[chronos] google_calendar_create_sync_failed",
        getChronosSafeErrorLog(syncError),
      );
    }

    return Response.json(
      { meeting },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("[chronos] meeting_create_failed", getChronosSafeErrorLog(error));

    return Response.json(
      {
        error: getChronosApiErrorMessage(
          error,
          "Nao foi possivel criar a reuniao Chronos.",
        ),
      },
      { status: getChronosApiErrorStatus(error) },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const meeting = await updateChronosMeeting({
      authorization,
      input: await request.json().catch(() => null),
    });

    try {
      await syncChronosMeetingToGoogleCalendar({
        meetingId: meeting.id,
        trigger: "chronos_agenda_update",
        userId: authorization.user.id,
      });
    } catch (syncError) {
      console.error(
        "[chronos] google_calendar_update_sync_failed",
        getChronosSafeErrorLog(syncError),
      );
    }

    return Response.json(
      { meeting },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error: getChronosApiErrorMessage(
          error,
          "Nao foi possivel atualizar a reuniao Chronos.",
        ),
      },
      { status: getChronosApiErrorStatus(error) },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const result = await deleteChronosMeeting({
      authorization,
      input: await request.json().catch(() => null),
    });

    try {
      await syncChronosMeetingToGoogleCalendar({
        meetingId: result.meetingId,
        trigger: "chronos_agenda_delete",
        userId: authorization.user.id,
      });
    } catch {
      // A exclusao no Chronos nao deve ficar presa se o espelho Google falhar.
    }

    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: getChronosApiErrorMessage(
          error,
          "Nao foi possivel excluir o evento Chronos.",
        ),
      },
      { status: getChronosApiErrorStatus(error) },
    );
  }
}

function getChronosApiErrorMessage(error: unknown, fallback: string) {
  if (isChronosSchemaMissingError(error)) {
    return "Chronos aguarda aplicacao da migration Supabase 0019_chronos_core.sql.";
  }

  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

function getChronosApiErrorStatus(error: unknown) {
  if (isChronosSchemaMissingError(error)) {
    return 503;
  }

  if (isChronosForbiddenError(error)) {
    return 403;
  }

  return 400;
}

function getChronosSafeErrorLog(error: unknown) {
  if (!error || typeof error !== "object") {
    return { message: String(error) };
  }

  const source = error as {
    code?: unknown;
    details?: unknown;
    hint?: unknown;
    message?: unknown;
    name?: unknown;
  };

  return {
    code: typeof source.code === "string" ? source.code : undefined,
    details: typeof source.details === "string" ? source.details : undefined,
    hint: typeof source.hint === "string" ? source.hint : undefined,
    message: typeof source.message === "string" ? source.message : undefined,
    name: typeof source.name === "string" ? source.name : undefined,
  };
}

// Diagnostico ENXUTO: a versao anterior imprimia ate 20 reunioes com detalhe
// de gravacoes em TODO carregamento — custo de log e memoria sem necessidade.
function logChronosDriveSnapshotDiagnostic(snapshot: ChronosSnapshot) {
  console.info("[chronos] drive_snapshot_diagnostic", {
    meetingCount: snapshot.meetings.length,
    recordingMeetingCount: snapshot.meetings.filter(
      (meeting) => meeting.recordings.length > 0,
    ).length,
    roomCount: snapshot.rooms.length,
    storageStatus: snapshot.storage.status,
  });
}
