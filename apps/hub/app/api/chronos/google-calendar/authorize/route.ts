import { type NextRequest } from "next/server";

import {
  getChronosGoogleCalendarStatus,
  startChronosGoogleCalendarAuthorization,
} from "@/lib/chronos/google-calendar";
import { authorizeChronosRequest } from "@/lib/chronos/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeChronosRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const googleCalendar = await getChronosGoogleCalendarStatus({
    userId: authorization.user.id,
  });

  if (!googleCalendar.configured) {
    return Response.json(
      {
        error: "Google Agenda aguarda configuracao server-side segura.",
        googleCalendar,
      },
      { status: 503 },
    );
  }

  if (!googleCalendar.connection.storageReady) {
    return Response.json(
      {
        error:
          "OAuth Google preparado, mas a migration de storage seguro ainda nao foi aplicada.",
        googleCalendar,
      },
      { status: 503 },
    );
  }

  const authorizationUrl = await startChronosGoogleCalendarAuthorization({
    redirectAfter: request.nextUrl.searchParams.get("returnTo") ?? "/chronos",
    userId: authorization.user.id,
  });

  return Response.redirect(authorizationUrl, 302);
}
