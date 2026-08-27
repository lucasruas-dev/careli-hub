import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadExtratoDoCliente } from "@/lib/apolo/extrato-cliente-c2x";

// EXTRATO DO CLIENTE COMPRADOR: o que ele já pagou + o saldo devedor, por contrato/unidade.
// Lê o C2X read-only. Não confundir com /api/apolo/extrato, que é o split por PARTICIPANTE.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const params = new URL(request.url).searchParams;
  const c2xId = Number(params.get("c2xId"));
  const contratoParam = params.get("contrato");
  const contratoId = contratoParam ? Number(contratoParam) : null;

  if (!Number.isInteger(c2xId) || c2xId <= 0) {
    return NextResponse.json({ error: "Informe um c2xId valido." }, { status: 400 });
  }

  if (contratoParam && (!Number.isInteger(contratoId) || (contratoId ?? 0) <= 0)) {
    return NextResponse.json({ error: "Informe um contrato valido." }, { status: 400 });
  }

  try {
    const result = await loadExtratoDoCliente({ c2xId, contratoId });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: result.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][extrato-cliente] falha ao carregar o extrato", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar o extrato do cliente." },
      { status: 500 },
    );
  }
}
