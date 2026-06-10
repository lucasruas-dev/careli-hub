import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ roomSlug: string }> },
) {
  const { roomSlug } = await params;

  return Response.json(
    {
      error:
        "Entrada local bloqueada. Use o endpoint LiveKit do Chronos para entrar na sala.",
      roomSlug,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
      status: 410,
    },
  );
}
