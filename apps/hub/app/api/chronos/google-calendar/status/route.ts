import { type NextRequest } from "next/server";

import { getChronosGoogleCalendarStatus } from "@/lib/chronos/google-calendar";
import { authorizeChronosRequest } from "@/lib/chronos/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  return Response.json(
    {
      googleCalendar: await getChronosGoogleCalendarStatus({
        baseUrl: request.nextUrl.origin,
      }),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
