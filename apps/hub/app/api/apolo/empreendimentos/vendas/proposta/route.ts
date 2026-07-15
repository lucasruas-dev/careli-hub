import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadApoloVendaProposta } from "@/lib/apolo/vendas";

// Detalhe da proposta de uma unidade: plano comercial + parcelamento + movimentação.
// Ver [[project-apolo-crm-grafo]].
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
    const result = await loadApoloVendaProposta(unitId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: result.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][empreendimentos] falha ao carregar proposta", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar a proposta." },
      { status: 500 },
    );
  }
}
