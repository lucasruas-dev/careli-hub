import { NextResponse, type NextRequest } from "next/server";

// Gate central de seguranca do Panteon (defense-in-depth).
//
// Politica (Lucas, 2026-06-26): TODA tela/informacao exige login. UNICA excecao:
// a videochamada do Chronos (clientes externos sem login no sistema) + endpoints
// de maquina (webhook Meta, crons, OAuth callback) que se protegem pela propria
// chave/assinatura.
//
// Aqui exigimos um Bearer de sessao em /api/* fora da allowlist. Assim nenhuma
// rota nova nasce "navegavel" no browser sem sessao (foi exatamente esse o vetor
// dos vazamentos de PII). A validacao REAL de identidade + papel continua dentro
// de cada rota (helpers de modulo: authorizeHadesRead, authorizeChronosRequest,
// authorizeApoloRead, etc.) — este middleware e a rede de seguranca, nao a unica.
//
// So mira /api/* (matcher abaixo): paginas NAO sao tocadas, entao ninguem e
// deslogado e o guard de pagina segue client-side.

// Prefixos liberados (publicos ou de maquina — nao exigem Bearer de usuario).
const PUBLIC_API_PREFIXES = [
  "/api/chronos/public", // videochamada Chronos (excecao da politica)
  "/api/iris/meta/webhook", // webhook Meta (validado por assinatura)
  "/api/caredesk/meta/webhook", // re-export do webhook Meta
  "/api/guardian/sync/c2x", // cron (segredo proprio)
  "/api/hades/sync/c2x", // cron (re-export)
  "/api/apolo/sync/c2x", // cron
  "/api/chronos/recordings/egress-cron", // cron
  "/api/chronos/google-calendar/callback", // OAuth (redirect do Google, sem Bearer)
  "/api/chronos/google-calendar/authorize", // OAuth (inicio, navegacao do browser)
  "/api/auth/session", // login (ainda nao ha Bearer)
  "/api/auth/password", // troca de senha (valida por dentro)
  "/api/guardian/db/health", // liveness probe (sem dado sensivel)
  "/api/hades/db/health", // liveness probe (re-export)
  "/api/pwa/manifest", // manifest publico da PWA
];

function isPublicApi(pathname: string) {
  return PUBLIC_API_PREFIXES.some((prefix) => {
    const base = prefix.replace(/\/+$/, "");

    return pathname === base || pathname.startsWith(`${base}/`);
  });
}

export function middleware(request: NextRequest) {
  // Preflight CORS nao carrega credencial — deixa passar.
  if (request.method === "OPTIONS") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (isPublicApi(pathname)) {
    return NextResponse.next();
  }

  const authorization = request.headers.get("authorization") ?? "";
  const hasBearer = /^Bearer\s+.+/i.test(authorization);

  if (!hasBearer) {
    return NextResponse.json(
      { error: "Sessao ausente." },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  // So rotas de API. Paginas, _next e estaticos ficam de fora de proposito.
  matcher: ["/api/:path*"],
};
