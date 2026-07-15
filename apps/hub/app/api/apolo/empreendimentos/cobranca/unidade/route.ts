import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadApoloUnitCompromissos } from "@/lib/apolo/cobranca";

// Detalhe dos compromissos (promessa/acordo) de uma unidade — alimenta o modal de
// negociação (read-only) do Apolo. Ver [[project-apolo-crm-grafo]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const unitId = new URL(request.url).searchParams.get("unitId")?.trim();

  if (!unitId) {
    return NextResponse.json({ error: "Informe a unidade." }, { status: 400 });
  }

  try {
    const result = await loadApoloUnitCompromissos(unitId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(
      { data: { compromissos: result.compromissos } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][empreendimentos] falha ao carregar negociação", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar a negociação." },
      { status: 500 },
    );
  }
}
