import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadApoloEnterprises } from "@/lib/apolo/empreendimentos";

// Cenário comercial dos empreendimentos (lê o C2X read-only + regra de governança do Hades).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const result = await loadApoloEnterprises();

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: result.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][empreendimentos] falha ao carregar", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar os empreendimentos." },
      { status: 500 },
    );
  }
}
