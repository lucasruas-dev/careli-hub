import { NextResponse, type NextRequest } from "next/server";

// Callback do OAuth de setup do Gmail: recebe o `code`, troca por tokens e MOSTRA o
// refresh_token numa página simples pra o admin copiar pro ambiente (Vercel/.env.local). O
// segredo NUNCA é logado. Rota pública (o redirect do Google não carrega Bearer); só devolve
// token mediante um `code` válido do Google (que exige o nosso client_secret na troca).
// Uso pontual — depois de obter o refresh token, pode remover GMAIL_OAUTH_SETUP_KEY.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:40px}
  .card{max-width:760px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:16px;padding:28px}
  h1{font-size:20px;margin:0 0 8px}
  p{line-height:1.5;color:#cbd5e1}
  code,pre{background:#0f172a;border:1px solid #334155;border-radius:8px;color:#a7f3d0}
  pre{padding:14px;overflow:auto;word-break:break-all;white-space:pre-wrap}
  .warn{color:#fca5a5}
  b{color:#e2e8f0}
</style></head><body><div class="card"><h1>${title}</h1>${body}</div></body></html>`;

  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
    status,
  });
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return page(
      "Consentimento não concluído",
      `<p class="warn">O Google retornou: <b>${error}</b>. Feche e tente de novo pela rota de autorização.</p>`,
      400,
    );
  }

  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return page(
      "Faltou o código",
      `<p class="warn">Não veio o parâmetro <code>code</code>. Inicie de novo pela rota de autorização.</p>`,
      400,
    );
  }

  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return page(
      "Ambiente incompleto",
      `<p class="warn">Faltam <code>GMAIL_OAUTH_CLIENT_ID</code> e/ou <code>GMAIL_OAUTH_CLIENT_SECRET</code>.</p>`,
      503,
    );
  }

  const redirectUri = `${request.nextUrl.origin}/api/iris/gmail/callback`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    error_description?: string;
    refresh_token?: string;
    scope?: string;
  } | null;

  if (!response.ok) {
    return page(
      "Falha na troca do código",
      `<p class="warn">${payload?.error_description ?? payload?.error ?? "erro desconhecido"}</p>`,
      502,
    );
  }

  if (!payload?.refresh_token) {
    return page(
      "Sem refresh token",
      `<p class="warn">O Google não devolveu um <b>refresh_token</b>. Isso acontece quando a conta já tinha autorizado antes.</p>
       <p>Revogue o acesso do app em <a style="color:#7dd3fc" href="https://myaccount.google.com/permissions" target="_blank">myaccount.google.com/permissions</a> (logado como a caixa robô) e refaça a autorização — a rota já pede <code>prompt=consent</code>.</p>`,
      400,
    );
  }

  return page(
    "Refresh token gerado ✅",
    `<p>Copie o valor abaixo e coloque no ambiente (Vercel e/ou <code>apps/hub/.env.local</code>) como <b>GMAIL_REFRESH_TOKEN</b>. Depois é só recarregar/deploy. <span class="warn">Não compartilhe este valor.</span></p>
     <pre>${payload.refresh_token}</pre>
     <p style="margin-top:18px">Escopos concedidos: <code>${payload.scope ?? "(não informado)"}</code></p>
     <p>Variáveis do ambiente (as duas primeiras você já configurou):</p>
     <pre>GMAIL_OAUTH_CLIENT_ID=...
GMAIL_OAUTH_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=(o valor acima)</pre>`,
  );
}
