import { NextResponse, type NextRequest } from "next/server";

const zeusDedicatedHost = "ops.c2x.app.br";
const hubHostsWithoutZeus = new Set([
  "c2x.app.br",
  "www.c2x.app.br",
  "homo.c2x.app.br",
]);
const legacyVisualRoutes = [
  ["/guardian", "/hades"],
  ["/caredesk", "/iris"],
  ["/pulsex", "/hermes"],
  ["/squadops", "/zeus"],
] as const;

// --- Gate central de seguranca do Panteon (defense-in-depth) ---
//
// Politica (Lucas, 2026-06-26): TODA tela/informacao exige login. UNICA excecao:
// a videochamada do Chronos (clientes externos sem login no sistema) + endpoints
// de maquina (webhook Meta, crons, OAuth callback) que se protegem pela propria
// chave/assinatura.
//
// Exigimos um Bearer de sessao em /api/* fora da allowlist. Assim nenhuma rota
// nova nasce "navegavel" no browser sem sessao (foi esse o vetor dos vazamentos
// de PII). A validacao REAL de identidade + papel continua dentro de cada rota
// (helpers de modulo: authorizeHadesRead, authorizeChronosRequest,
// authorizeApoloRead, etc.) — este gate e a rede de seguranca, nao a unica.
const PUBLIC_API_PREFIXES = [
  "/api/chronos/public", // videochamada Chronos (excecao da politica)
  "/api/iris/meta/webhook", // webhook Meta (validado por assinatura)
  "/api/caredesk/meta/webhook", // re-export do webhook Meta
  "/api/guardian/sync/c2x", // cron (segredo proprio)
  "/api/hades/sync/c2x", // cron (re-export)
  "/api/guardian/lembretes/cron", // cron da regua de lembretes (segredo proprio)
  "/api/apolo/sync/c2x", // cron
  "/api/chronos/recordings/egress-cron", // cron
  "/api/chronos/whereby/webhook", // webhook Whereby (validado por assinatura HMAC)
  "/api/notifications/sweep", // cron de varredura da central (segredo proprio)
  "/api/chronos/google-calendar/callback", // OAuth (redirect do Google, sem Bearer)
  "/api/chronos/google-calendar/authorize", // OAuth (inicio, navegacao do browser)
  "/api/auth/session", // login (ainda nao ha Bearer)
  "/api/auth/password", // troca de senha (valida por dentro)
  "/api/guardian/db/health", // liveness probe (sem dado sensivel)
  "/api/hades/db/health", // liveness probe (re-export)
  "/api/pwa/manifest", // manifest publico da PWA
  "/api/version", // versao do build (so string, sem dado sensivel; watcher de atualizacao)
  "/api/pwa/manifest-mobile", // manifest publico da PWA mobile (/m)
];

function isPublicApi(pathname: string) {
  return PUBLIC_API_PREFIXES.some((prefix) => {
    const base = prefix.replace(/\/+$/, "");

    return pathname === base || pathname.startsWith(`${base}/`);
  });
}

function guardApi(request: NextRequest, pathname: string) {
  // Preflight CORS nao carrega credencial — deixa passar.
  if (request.method === "OPTIONS") {
    return NextResponse.next();
  }

  if (isPublicApi(pathname)) {
    return NextResponse.next();
  }

  const authorization = request.headers.get("authorization") ?? "";
  const hasBearer = /^Bearer\s+.+/i.test(authorization);

  if (!hasBearer) {
    return NextResponse.json({ error: "Sessao ausente." }, { status: 401 });
  }

  return NextResponse.next();
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Gate de seguranca: /api/* exige sessao (fora da allowlist). Roda ANTES de
  // qualquer roteamento de pagina e retorna direto.
  if (pathname.startsWith("/api/")) {
    return guardApi(request, pathname);
  }

  const host =
    request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";

  // Em preview (host nao-produtivo) o modo OPS standalone pode ser forcado
  // com ?ops=1; um cookie persiste a escolha entre navegacoes. Nao afeta
  // os hosts reais de producao (ops/c2x).
  const isKnownHubHost =
    host === zeusDedicatedHost || hubHostsWithoutZeus.has(host);
  const queryOps = request.nextUrl.searchParams.get("ops") === "1";
  const previewOps =
    !isKnownHubHost &&
    (queryOps || request.cookies.get("zeus_preview_ops")?.value === "1");

  if (host === zeusDedicatedHost || previewOps) {
    if (pathname === "/zeus" || pathname === "/login") {
      const response = NextResponse.next();
      if (queryOps) {
        response.cookies.set("zeus_preview_ops", "1", { path: "/" });
      }
      return response;
    }

    const url = request.nextUrl.clone();
    url.pathname = "/zeus";
    url.search = "";

    const response = NextResponse.redirect(url);
    if (queryOps) {
      response.cookies.set("zeus_preview_ops", "1", { path: "/" });
    }
    return response;
  }

  // Zeus voltou a ser modulo do hub: /zeus fica acessivel no c2x.app.br (o
  // ZeusPage ja se restringe a admin via canAccessZeusAsAdmin). /squadops cai
  // no redirect legado abaixo (-> /zeus). O host dedicado ops.c2x.app.br vira
  // redundante e sera removido junto com o alias.

  for (const [legacyPath, pantheonPath] of legacyVisualRoutes) {
    if (pathname === legacyPath || pathname.startsWith(`${legacyPath}/`)) {
      const url = request.nextUrl.clone();
      url.pathname = `${pantheonPath}${pathname.slice(legacyPath.length)}`;

      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Inclui /api/* (gate de seguranca) + paginas (roteamento por host/legado).
  // Exclui apenas estaticos do Next e arquivos com extensao.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
