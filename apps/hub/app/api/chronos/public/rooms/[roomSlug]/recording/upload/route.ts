import { type NextRequest } from "next/server";

import { uploadChronosPublicRecording } from "@/lib/chronos/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomSlug: string }> },
) {
  const { roomSlug } = await params;

  try {
    const result = await uploadChronosPublicRecording({
      input: await request.formData(),
      roomSlug,
    });

    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return createChronosPublicErrorResponse(
      error,
      "Nao foi possivel armazenar a gravacao Chronos.",
    );
  }
}

function createChronosPublicErrorResponse(error: unknown, fallback: string) {
  return Response.json(
    {
      error: error instanceof Error && error.message.trim() ? error.message : fallback,
    },
    { status: 400 },
  );
}
