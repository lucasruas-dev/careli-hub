import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadApoloParticipantStatement } from "@/lib/apolo/extrato";

// Extrato por participante (split dos pagamentos pagos), escopado a uma entidade. Espelha o
// relatório "Extrato por participante" do C2X. Lê o C2X read-only.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const params = new URL(request.url).searchParams;
  const c2xId = Number(params.get("c2xId"));
  const start = params.get("start") ?? "";
  const end = params.get("end") ?? "";
  const enterpriseCode = params.get("enterprise")?.trim() || null;

  if (!Number.isInteger(c2xId) || c2xId <= 0) {
    return NextResponse.json({ error: "Informe um c2xId valido." }, { status: 400 });
  }

  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return NextResponse.json({ error: "Informe periodo (start/end) valido." }, { status: 400 });
  }

  try {
    const result = await loadApoloParticipantStatement({ c2xId, end, enterpriseCode, start });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: result.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][extrato] falha ao carregar extrato", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar o extrato." },
      { status: 500 },
    );
  }
}
