import { type NextRequest } from "next/server";

import {
  authorizeChronosRequest,
  createChronosMeeting,
  isChronosForbiddenError,
  isChronosSchemaMissingError,
  listChronosSnapshot,
  updateChronosMeeting,
} from "@/lib/chronos/server";

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
