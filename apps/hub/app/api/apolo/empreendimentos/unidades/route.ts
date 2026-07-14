import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadApoloEnterpriseUnits } from "@/lib/apolo/empreendimentos";

// Unidades de um empreendimento. Aceita N códigos (?codes=LBR,LBP,LBF) porque a linha da
// tela pode ser um produto consolidado (regra ENTERPRISE_GROUPS).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const codes = (new URL(request.url).searchParams.get("codes") ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  if (!codes.length) {
    return NextResponse.json(
      { error: "Informe ao menos um codigo de empreendimento." },
      { status: 400 },
    );
  }

  try {
    const result = await loadApoloEnterpriseUnits(codes);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: { units: result.units } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][empreendimentos] falha ao carregar unidades", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar as unidades." },
      { status: 500 },
    );
  }
}
