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

export function proxy(request: NextRequest) {
  const host =
    request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  const { pathname } = request.nextUrl;

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

  if (
    hubHostsWithoutZeus.has(host) &&
    (pathname === "/zeus" ||
      pathname.startsWith("/zeus/") ||
      pathname === "/squadops" ||
      pathname.startsWith("/squadops/"))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";

    return NextResponse.redirect(url);
  }

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
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
