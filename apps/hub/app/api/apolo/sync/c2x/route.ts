import { NextResponse, type NextRequest } from "next/server";

// ⚠️ A PORTA DO ADMIN MORA EM lib/apolo/autorizar-sync.ts DESDE A F3 DA FONTE ÚNICA (o espelho da
// D4Sign usa a mesma); o comportamento desta rota não mudou.
import { authorizeApoloSyncRequest } from "@/lib/apolo/autorizar-sync";
import {
  createApoloAdminClient,
  syncApoloFromC2x,
} from "@/lib/apolo/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const adminClient = createApoloAdminClient();

  if (!adminClient) {
    return NextResponse.json(
      { error: "Configure a chave server-side para sincronizar o Apolo." },
      { status: 503 },
    );
  }

  const authorization = await authorizeApoloSyncRequest(request, adminClient);

  if (!authorization.ok) {
    return authorization.response;
  }

  const result = await syncApoloFromC2x();

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      rowsWritten: result.rowsWritten,
      syncRunId: result.syncRunId,
    },
  });
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedApoloSyncCron(request)) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const result = await syncApoloFromC2x();

  if (!result.ok) {
    console.error("[apolo:full] route 500:", result.error);
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      rowsWritten: result.rowsWritten,
      source: "cron",
      syncRunId: result.syncRunId,
    },
  });
}

function isAuthorizedApoloSyncCron(request: NextRequest) {
  // Cron interno do Vercel — este header e removido de requisicoes externas.
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
