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
        "Upload local de gravacao bloqueado. O Chronos deve gravar somente via LiveKit Egress.",
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
