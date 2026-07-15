import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadApoloEnterpriseCobranca } from "@/lib/apolo/cobranca";

// Situação de cobrança (promessa/acordo) por unidade + funil de recuperação do
// empreendimento. Leitura do motor da Cobrança (Hades). Ver [[project-apolo-crm-grafo]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const codesParam = new URL(request.url).searchParams.get("codes")?.trim();
  const codes = (codesParam ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  if (!codes.length) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  try {
    const result = await loadApoloEnterpriseCobranca(codes);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: result.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][empreendimentos] falha ao carregar cobrança", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar a cobrança." },
      { status: 500 },
    );
  }
}
