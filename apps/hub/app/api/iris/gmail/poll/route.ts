import { NextResponse, type NextRequest } from "next/server";

import { ingestGmailInbox } from "@/lib/iris/gmail-inbound";

// Cron de ingestão de e-mail da Iris: lê os não-lidos da caixa robô caca@ e vira ticket +
// mensagem no caredesk (canal kind=email). Começa por poll (Pub/Sub em tempo real fica pra
// depois). Protegido como os demais crons: só o cron interno do Vercel (x-vercel-cron) ou
// Bearer CRON_SECRET. Entra na allowlist do proxy.ts. Ver [[project-iris-email-grupos]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  try {
    const result = await ingestGmailInbox({ maxResults: 25 });

    return NextResponse.json(
      { data: { ...result, source: "cron" } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao processar a caixa de e-mail da Iris.",
      },
      { status: 500 },
    );
  }
}

function isAuthorized(request: NextRequest) {
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
