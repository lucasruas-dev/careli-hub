import { type NextRequest } from "next/server";

import {
  authorizeChronosRequest,
  isChronosForbiddenError,
  isChronosSchemaMissingError,
  listChronosInternalInvitees,
} from "@/lib/chronos/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const invitees = await listChronosInternalInvitees({
      authorization,
      query: request.nextUrl.searchParams.get("q"),
    });

    return Response.json(
      { invitees },
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
          "Nao foi possivel buscar o time interno.",
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
