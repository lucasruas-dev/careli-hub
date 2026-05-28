import { type NextRequest } from "next/server";

import {
  authorizeChronosRequest,
  createChronosRoom,
  deleteChronosRoom,
  isChronosForbiddenError,
  isChronosSchemaMissingError,
  updateChronosRoom,
} from "@/lib/chronos/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const room = await createChronosRoom({
      authorization,
      input: await request.json().catch(() => null),
    });

    return Response.json(
      { room },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return createChronosRoomErrorResponse(
      error,
      "Nao foi possivel criar a sala Chronos.",
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const room = await updateChronosRoom({
      authorization,
      input: await request.json().catch(() => null),
    });

    return Response.json(
      { room },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return createChronosRoomErrorResponse(
      error,
      "Nao foi possivel atualizar a sala Chronos.",
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const room = await deleteChronosRoom({
      authorization,
      input: await request.json().catch(() => null),
    });

    return Response.json(
      { room },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return createChronosRoomErrorResponse(
      error,
      "Nao foi possivel excluir a sala Chronos.",
    );
  }
}

function createChronosRoomErrorResponse(error: unknown, fallback: string) {
  if (isChronosSchemaMissingError(error)) {
    return Response.json(
      {
        error: "Chronos aguarda aplicacao da migration Supabase 0019_chronos_core.sql.",
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      error: error instanceof Error && error.message.trim() ? error.message : fallback,
    },
    { status: isChronosForbiddenError(error) ? 403 : 400 },
  );
}
