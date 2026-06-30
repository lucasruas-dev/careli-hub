import { NextResponse, type NextRequest } from "next/server";

import { runNotificationSweep } from "@/lib/notifications/sweep";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Cron de varredura da central (Vercel cron, a cada 15min). Dispara notificacoes
// baseadas em ESTADO com dedup proprio (Meu dia / reuniao comecando / resumo Hades).
// Entra na allowlist do proxy.ts e se protege pelo segredo (mesma logica dos outros
// crons): so o cron interno do Vercel (header x-vercel-cron) ou Bearer CRON_SECRET.
export async function GET(request: NextRequest) {
  if (!isAuthorizedSweep(request)) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const result = await runNotificationSweep();

  return NextResponse.json({ data: { ...result, source: "cron" } });
}

function isAuthorizedSweep(request: NextRequest) {
  // Cron interno do Vercel — header removido de requisicoes externas.
  if (request.headers.get("x-vercel-cron")) {
    return true;
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const cronSecret = process.env.CRON_SECRET?.trim();

  return Boolean(cronSecret && token === cronSecret);
}
