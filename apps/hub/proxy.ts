import { NextResponse, type NextRequest } from "next/server";

const squadOpsDedicatedHost = "ops.c2x.app.br";
const hubHostsWithoutSquadOps = new Set([
  "c2x.app.br",
  "www.c2x.app.br",
  "homo.c2x.app.br",
]);

export function proxy(request: NextRequest) {
  const host =
    request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  const { pathname } = request.nextUrl;

  if (host === squadOpsDedicatedHost) {
    if (pathname === "/squadops" || pathname === "/login") {
      return NextResponse.next();
    }

    const url = request.nextUrl.clone();
    url.pathname = "/squadops";
    url.search = "";

    return NextResponse.redirect(url);
  }

  if (
    hubHostsWithoutSquadOps.has(host) &&
    (pathname === "/squadops" || pathname.startsWith("/squadops/"))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";

    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
