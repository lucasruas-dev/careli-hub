import { NextResponse } from "next/server";

import { PANTEON_BUILD_TAG, PANTEON_VERSION } from "@/lib/build-info";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Versao do build ATUALMENTE no servidor. O cliente carrega a sua versao "cozida" no
// bundle (PANTEON_VERSION) e compara com esta para saber se saiu um deploy novo e
// oferecer "Atualizar". Publico (so uma string de versao, sem dado sensivel) para o
// watcher poder pollar sem Bearer. no-store para nunca vir do cache do CDN.
export function GET() {
  return NextResponse.json(
    { buildTag: PANTEON_BUILD_TAG, version: PANTEON_VERSION },
    { headers: { "Cache-Control": "no-store" } },
  );
}
