import { NextResponse, type NextRequest } from "next/server";

const squadOpsHosts = new Set(["ops.c2x.app.br", "squadops.c2x.app.br"]);

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "")
    .split(":")[0]
    ?.toLowerCase();

  if (!host || !squadOpsHosts.has(host)) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;

  if (pathname === "/" || pathname === "") {
    const url = request.nextUrl.clone();
    url.pathname = "/squadops";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
