import { type NextRequest } from "next/server";

import { handleChronosGoogleCalendarWebhook } from "@/lib/chronos/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const result = await handleChronosGoogleCalendarWebhook(request);

  return Response.json(result.body, {
    headers: {
      "Cache-Control": "no-store",
    },
    status: result.status,
  });
}
