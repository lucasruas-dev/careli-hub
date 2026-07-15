import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { loadApoloCarteiraScoped } from "@/lib/apolo/carteira";
import type { ApoloCarteiraScope } from "@/lib/apolo/carteira";

// Carteira escopada pelo PAPEL da entidade (comprador/corretor/imobiliaria/incorporador).
// Mesma matemática do Hades, lendo o C2X read-only. Alimenta o drill-down da aba Carteira.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS = new Set<ApoloCarteiraScope["kind"]>([
  "comprador",
  "corretor",
  "imobiliaria",
  "incorporador",
]);

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const params = new URL(request.url).searchParams;
  const c2xId = Number(params.get("c2xId"));
  const kind = params.get("kind") ?? "";

  if (!Number.isInteger(c2xId) || c2xId <= 0) {
    return NextResponse.json({ error: "Informe um c2xId valido." }, { status: 400 });
  }

  if (!KINDS.has(kind as ApoloCarteiraScope["kind"])) {
    return NextResponse.json({ error: "Papel (kind) invalido." }, { status: 400 });
  }

  try {
    const result = await loadApoloCarteiraScoped({
      c2xId,
      kind: kind as ApoloCarteiraScope["kind"],
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: result.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][carteira] falha ao carregar carteira por papel", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar a carteira." },
      { status: 500 },
    );
  }
}
