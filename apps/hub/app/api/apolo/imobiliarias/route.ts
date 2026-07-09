import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadApoloImobiliarias } from "@/lib/apolo/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lista as imobiliárias reais do Apolo (read-model) para o seletor de vínculo
// do cadastro de CAD. Nome + id da entidade.
export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);

  if (!auth.ok) {
    return auth.response;
  }

  const imobiliarias = await loadApoloImobiliarias();

  return NextResponse.json(
    { data: { imobiliarias } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
