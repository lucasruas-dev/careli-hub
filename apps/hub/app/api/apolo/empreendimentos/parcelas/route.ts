import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadApoloUnitInstallments } from "@/lib/apolo/carteira";

// Parcelas (boletos) de uma unidade — a carteira detalhada.
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
    const result = await loadApoloUnitInstallments(unitId);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: { installments: result.installments } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][empreendimentos] falha ao carregar parcelas", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar as parcelas." },
      { status: 500 },
    );
  }
}
