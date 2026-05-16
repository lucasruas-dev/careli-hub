import { NextResponse, type NextRequest } from "next/server";

import { loadGuardianAttendanceClient } from "@/lib/guardian/attendance";
import { sanitizeGuardianDbError } from "@/lib/guardian/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await context.params;

  if (!clientId) {
    return NextResponse.json(
      { error: "Cliente nao informado." },
      { status: 400 },
    );
  }

  try {
    const client = await loadGuardianAttendanceClient(
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
        detail: sanitizeGuardianDbError(error),
      },
      { status: 500 },
    );
  }
}
