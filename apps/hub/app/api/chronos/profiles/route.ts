import { type NextRequest } from "next/server";

import {
  authorizeChronosRequest,
  createChronosProfile,
  deleteChronosProfile,
  isChronosForbiddenError,
  isChronosSchemaMissingError,
  listChronosProfiles,
} from "@/lib/chronos/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const profiles = await listChronosProfiles(authorization);

    return Response.json(
      { profiles },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return createChronosProfileErrorResponse(
      error,
      "Nao foi possivel carregar os perfis Chronos.",
    );
  }
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const profile = await createChronosProfile({
      authorization,
      input: await request.json().catch(() => null),
    });

    return Response.json(
      { profile },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return createChronosProfileErrorResponse(
      error,
      "Nao foi possivel criar o perfil Chronos.",
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const profile = await deleteChronosProfile({
      authorization,
      input: await request.json().catch(() => null),
    });

    return Response.json(
      { profile },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return createChronosProfileErrorResponse(
      error,
      "Nao foi possivel excluir o perfil Chronos.",
    );
  }
}

function createChronosProfileErrorResponse(error: unknown, fallback: string) {
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
      error:
        error instanceof Error && error.message.trim()
          ? error.message
          : fallback,
    },
    { status: isChronosForbiddenError(error) ? 403 : 400 },
  );
}
