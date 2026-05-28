import { type NextRequest } from "next/server";

import { completeChronosGoogleCalendarAuthorization } from "@/lib/chronos/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const redirectUrl = await completeChronosGoogleCalendarAuthorization(
    request.url,
  );

  return Response.redirect(redirectUrl, 302);
}
