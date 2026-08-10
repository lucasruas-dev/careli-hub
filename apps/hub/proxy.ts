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
  // ⚠️ Libera por PREFIXO: /api/iris/evolution/* tambem fica publico. NAO criar
  // rota de operador aqui dentro (o envio ao grupo mora em /api/iris/group-messages).
  "/api/iris/evolution", // webhook Evolution grupos (validado por segredo compartilhado)
  "/api/guardian/sync/c2x", // cron (segredo proprio)
  "/api/hades/sync/c2x", // cron (re-export)
  "/api/guardian/lembretes/cron", // cron da regua de lembretes (segredo proprio)
  "/api/apolo/sync/c2x", // cron
  "/api/apolo/imobiliarias/relatorio-diario", // cron do relatorio das imobiliarias (x-vercel-cron / CRON_SECRET)
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
  "/api/iris/report-render", // render de relatorio em imagem (edge, gated por chave/segredo)
  "/api/prometeu/tts", // voz da CACÁ no Telão publico (TVs sem login); teto de texto p/ custo
  // O telão da TV INDEPENDENTE (sem operador logado, pedido do Lucas 02/08): a rota valida POR
  // DENTRO — token HMAC `?tv=` (lib/prometeu/link-do-telao.ts, emitido no Setup) OU sessão/cookie
  // como antes. Sem nenhum dos três, a própria rota devolve 401.
  "/api/prometeu/telao",
  // Login proprio do operador do evento (conta do Prometeu, nao e' usuario do hub). Liberadas
  // UMA A UMA de proposito: /api/prometeu/operadores (admin, com 's') NAO cai aqui e continua
  // exigindo sessao do hub. Cada rota se protege por dentro (senha/cookie assinado por HMAC).
  "/api/prometeu/operador/login", // par username+senha; sem Bearer do hub
  "/api/prometeu/operador/logout", // apaga o cookie de sessao
  "/api/prometeu/operador/eu", // valida o cookie assinado e devolve o operador logado
  "/api/iris/gmail/authorize", // OAuth setup do Gmail da Iris (guardado por GMAIL_OAUTH_SETUP_KEY)
  "/api/iris/gmail/callback", // OAuth setup do Gmail (redirect do Google, sem Bearer)
  "/api/iris/gmail/status", // diagnostico da caixa Gmail (guardado por GMAIL_OAUTH_SETUP_KEY)
  "/api/iris/gmail/poll", // cron de ingestao de e-mail da Iris (x-vercel-cron / CRON_SECRET)
  "/api/iris/tickets/fechar-sem-interacao", // cron que fecha atendimento morto na mao da CACA (x-vercel-cron / CRON_SECRET)
  // ⚠️ ZONA HOSTIL: libera por PREFIXO — tudo abaixo destes caminhos fica acessivel sem
  // sessao, ao mundo. NUNCA criar rota de operador aqui dentro.
  // A autorizacao e por POSSE DE DADO (CPF cadastrado + CNPJ credenciado), nao por papel, e
  // cada rota valida por dentro a sessao assinada (lib/publico/cad/sessao.ts).
  // Ver [[project_esteira_credenciamento_venda]].
  "/api/publico/cad", // formulario publico de CAD do corretor (sem login, por desenho)
  "/api/publico/imobiliaria", // auto-cadastro de imobiliaria (sem login, por desenho)
  // Fila do CLIENTE no dia do lancamento: ele abre no celular o link que recebeu no check-in e
  // ve a PROPRIA posicao. Nao ha sessao possivel (o cliente nao e' usuario do hub); quem autoriza
  // e' o token HMAC do link (lib/prometeu/link-da-fila.ts), validado dentro da rota, e a resposta
  // carrega so' os campos daquela pessoa. Liberada UMA A UMA, sem soltar /api/publico/prometeu
  // inteiro: nenhuma outra rota do Prometeu pode nascer publica por tabela.
  "/api/publico/prometeu/fila",
  // NOME do lancamento ativo, so' para a tela de LOGIN do operador se identificar ("Vale do Ouro").
  // Responde APENAS o nome — que ja' e' publico (telao, etiqueta, WhatsApp do cliente). Sem fila,
  // sem contagem, sem pessoa. Liberada UMA A UMA, igual a de cima.
  "/api/publico/prometeu/evento",
  // Webhook do Asaas (pre-venda): maquina-a-maquina, valida por token proprio (asaas-access-token).
  "/api/publico/asaas",
  // BI publico de vendas do Vale do Ouro (pedido do Lucas, 01/08): o link circula com diretoria
  // e parceiros FORA do hub. A rota devolve APENAS agregados (contagens, somas, ranking de
  // imobiliarias) — nenhum dado pessoal de comprador. CDN cacheia 60s (custo). Liberada UMA A UMA.
  "/api/publico/bi/vale-do-ouro",
  // Tela publica da ACAO de contato (freela sem conta do hub): entra por senha da campanha, que
  // vira o token de sessao (x-acao-sessao), validado DENTRO de cada rota. Ver [[project_apolo_acao_contato]].
  "/api/publico/acao",
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
    // OPERADOR do evento: as telas do posto (/evento) nao carregam Bearer do hub — o operador
    // tem conta propria do Prometeu, nao e' usuario do hub. Sua prova de sessao e' o cookie
    // httpOnly assinado ("prometeu_op", = PROMETEU_SESSION_COOKIE de lib/prometeu/operador-auth).
    // Se a rota e' do Prometeu e o cookie esta presente, deixamos passar: a rota valida o cookie
    // por dentro (autorizarOperacao -> validarTokenSessao). Sem esse alivio o gate barraria a
    // leitura de fila/eventos e o check-in do operador com 401 antes de a rota rodar. Usamos o
    // literal (e nao o import) de proposito: este arquivo roda no runtime de middleware, e
    // operador-auth.ts puxa node:crypto — nao pode entrar no bundle do gate.
    const temCookieOperador = Boolean(
      request.cookies.get("prometeu_op")?.value,
    );
    if (pathname.startsWith("/api/prometeu/") && temCookieOperador) {
      return NextResponse.next();
    }

    // INCORPORADOR (o dono do loteamento): mesmo alivio, mesmo racional. Conta propria, cookie
    // httpOnly assinado ("apolo_inc", = INCORPORADOR_COOKIE de lib/apolo/incorporador/sessao).
    // A rota valida o cookie por dentro e, o que mais importa, o ESCOPO (quais empreendimentos)
    // sai de dentro do token assinado, nunca da query string. Literal de proposito: este arquivo
    // roda no runtime de middleware e sessao.ts puxa node:crypto.
    // ⚠️ So vale sob /api/incorporador/. Nenhuma rota do Apolo interno responde a este cookie.
    const temCookieIncorporador = Boolean(
      request.cookies.get("apolo_inc")?.value,
    );
    if (pathname.startsWith("/api/incorporador/") && temCookieIncorporador) {
      return NextResponse.next();
    }

    // A porta de entrada em si (login/logout) nasce sem cookie nenhum: precisa ser publica, como
    // a do operador do evento. Ela se protege por dentro (e-mail + senha em scrypt, resposta e
    // tempo iguais para e-mail inexistente e senha errada).
    if (pathname === "/api/incorporador/sessao") {
      return NextResponse.next();
    }

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
