import { NextResponse, type NextRequest } from "next/server";

import { runGuardianReguaCron } from "@/lib/guardian/regua-cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Cron diario da regua de lembretes (Vercel cron). Entra na allowlist do
// proxy.ts e se protege pelo proprio segredo (mesma logica do sync/c2x): so o
// cron interno do Vercel (header x-vercel-cron, removido de chamadas externas)
// ou um Bearer/header com segredo conhecido pode disparar.
export async function GET(request: NextRequest) {
  if (!isAuthorizedReguaCron(request)) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const result = await runGuardianReguaCron({ dryRun });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      cancelled: result.cancelled,
      dryRun,
      failed: result.failed,
      paid: result.paid,
      processed: result.processed,
      sent: result.sent,
      skipped: result.skipped,
      source: "cron",
    },
  });
}

function isAuthorizedReguaCron(request: NextRequest) {
  // Cron interno do Vercel — este header e removido de requisicoes externas.
  if (request.headers.get("x-vercel-cron")) {
    return true;
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (cronSecret && token === cronSecret) {
    return true;
  }

  const reguaSecret =
    process.env.GUARDIAN_REGUA_SECRET?.trim() ||
    process.env.GUARDIAN_SYNC_SECRET?.trim();

  if (
    reguaSecret &&
    request.headers.get("x-guardian-regua-secret") === reguaSecret
  ) {
    return true;
  }

  return false;
}
