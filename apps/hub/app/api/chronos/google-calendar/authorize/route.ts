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

  const googleCalendar = getChronosGoogleCalendarStatus();

  if (!googleCalendar.configured) {
    return Response.json(
      {
        error: "Google Agenda aguarda configuracao server-side segura.",
        googleCalendar,
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      error:
        "OAuth Google preparado, mas aguardando storage seguro de state/tokens antes de redirecionar.",
      googleCalendar,
    },
    { status: 501 },
  );
}
