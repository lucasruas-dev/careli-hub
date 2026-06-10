import { type NextRequest } from "next/server";

import { createChronosLiveKitToken } from "@/lib/chronos/livekit";
import { joinChronosPublicRoom } from "@/lib/chronos/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomSlug: string }> },
) {
  const { roomSlug } = await params;

  try {
    const result = await joinChronosPublicRoom({
      authorizationHeader: request.headers.get("authorization"),
      input: await request.json().catch(() => null),
      roomSlug,
    });
    const livekit = createChronosLiveKitToken({
      displayName: result.participant.displayName,
      isHost: result.isHost,
      meetingId: result.meetingId,
      organization: result.participant.organization,
      participantId: result.participant.id,
      roomSlug,
    });

    return Response.json(
      {
        ...result,
        livekit,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return createChronosPublicErrorResponse(
      error,
      "Nao foi possivel preparar a sala LiveKit do Chronos.",
    );
  }
}

function createChronosPublicErrorResponse(error: unknown, fallback: string) {
  return Response.json(
    {
      error:
        error instanceof Error && error.message.trim()
          ? error.message
          : fallback,
    },
    { status: 400 },
  );
}
