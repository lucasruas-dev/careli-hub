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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const snapshot = await listChronosSnapshot(authorization);

    return Response.json(snapshot, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
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
