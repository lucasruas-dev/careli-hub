import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadApoloEnterpriseCarteira } from "@/lib/apolo/carteira";

// Carteira financeira do empreendimento (cenário + por unidade). Lê o C2X read-only, mesma
// matemática do Hades. Aceita N códigos (produto consolidado).
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
    // ⚠️ `conferirNoC2x` (PAN-124): a sigla desta tela foi lida AO VIVO do C2X (`loadApoloEnterprises`),
    // então é conferida no C2X no mesmo instante, e não só no catálogo em cache (até 10 minutos), que
    // ainda pode não conhecer uma sigla nova ou dar uma sigla trocada ao outro empreendimento.
    const result = await loadApoloEnterpriseCarteira(codes, { conferirNoC2x: true });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: result.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][empreendimentos] falha ao carregar carteira", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar a carteira." },
      { status: 500 },
    );
  }
}
