import { NextResponse, type NextRequest } from "next/server";

import { authorizeHadesRead } from "@/lib/guardian/auth";
import { loadHadesAttendanceClient } from "@/lib/guardian/attendance";
import { sanitizeHadesDbError } from "@/lib/guardian/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const auth = await authorizeHadesRead(request);

  if (!auth.ok) {
    return auth.response;
  }

  const { clientId } = await context.params;

  if (!clientId) {
    return NextResponse.json(
      { error: "Cliente nao informado." },
      { status: 400 },
    );
  }

  try {
    const client = await loadHadesAttendanceClient(
      decodeURIComponent(clientId),
    );

    if (!client) {
      return NextResponse.json(
        { error: "Cliente nao encontrado no C2X." },
        { status: 404 },
      );
    }

    return NextResponse.json({ client });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Nao foi possivel carregar as parcelas do cliente.",
        detail: sanitizeHadesDbError(error),
      },
      { status: 500 },
    );
  }
}
