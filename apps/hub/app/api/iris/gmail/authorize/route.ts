import { NextResponse, type NextRequest } from "next/server";

import { GMAIL_SCOPES, getGmailIngestMailbox } from "@/lib/iris/gmail";

// Início do consentimento OAuth pra obter o refresh token da caixa robô (caca@). É uma rota
// de SETUP, de uso pontual: guardada por uma chave (GMAIL_OAUTH_SETUP_KEY na query ?key=)
// porque a navegação do browser não carrega Bearer. Redireciona pro consentimento do Google
// pedindo os escopos gmail.modify + gmail.send com access_type=offline + prompt=consent (pra
// garantir o refresh_token). Faça esta autorização LOGADO COMO caca@. Ver
// [[project-iris-email-grupos]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const setupKey = process.env.GMAIL_OAUTH_SETUP_KEY?.trim();
  const providedKey = request.nextUrl.searchParams.get("key")?.trim();

  if (!setupKey || providedKey !== setupKey) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();

  if (!clientId) {
    return NextResponse.json(
      { error: "GMAIL_OAUTH_CLIENT_ID ausente no ambiente." },
      { status: 503 },
    );
  }

  const redirectUri = `${request.nextUrl.origin}/api/iris/gmail/callback`;
  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("login_hint", getGmailIngestMailbox());

  return NextResponse.redirect(authorizeUrl.toString());
}
