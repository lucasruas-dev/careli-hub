import { NextResponse, type NextRequest } from "next/server";

import { isGmailConfigured, probeGmailMailbox } from "@/lib/iris/gmail";

// Diagnóstico da conexão Gmail da caixa robô (caca@): confirma que as envs estão setadas e
// que o refresh token funciona, lendo o /profile da caixa (nome + contadores). NÃO expõe
// segredo. Guardada pela mesma GMAIL_OAUTH_SETUP_KEY (?key=) das rotas de setup, porque a
// navegação do browser não carrega Bearer. Uso pontual de validação. Ver
// [[project-iris-email-grupos]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const setupKey = process.env.GMAIL_OAUTH_SETUP_KEY?.trim();
  const providedKey = request.nextUrl.searchParams.get("key")?.trim();

  if (!setupKey || providedKey !== setupKey) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  if (!isGmailConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        missing: [
          "GMAIL_OAUTH_CLIENT_ID",
          "GMAIL_OAUTH_CLIENT_SECRET",
          "GMAIL_REFRESH_TOKEN",
        ].filter((name) => !process.env[name]?.trim()),
      },
      { status: 200 },
    );
  }

  try {
    const mailbox = await probeGmailMailbox();

    return NextResponse.json(
      { configured: true, mailbox },
      { headers: { "Cache-Control": "no-store" }, status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        error: error instanceof Error ? error.message : "Falha ao ler a caixa.",
      },
      { status: 502 },
    );
  }
}
