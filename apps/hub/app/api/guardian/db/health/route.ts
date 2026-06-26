import { NextResponse } from "next/server";

import { pingHadesDb, sanitizeHadesDbError } from "@/lib/guardian/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await pingHadesDb();

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: "unconfigured",
          missing: result.missing,
        },
        { status: 503 },
      );
    }

    // Liveness probe (consumido server-side pelo monitor OPS, na allowlist do
    // middleware). NAO expor o nome do banco aqui — so sinal de vida + latencia.
    return NextResponse.json({
      ok: true,
      status: "connected",
      elapsedMs: result.elapsedMs,
      serverTime: result.serverTime,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: "error",
        error: sanitizeHadesDbError(error),
      },
      { status: 503 },
    );
  }
}
