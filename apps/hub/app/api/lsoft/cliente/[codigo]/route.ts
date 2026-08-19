import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { lerFichaDoLsoft } from "@/lib/lsoft/carteira";

// A FICHA de um cliente do LSoft: cadastro completo + todas as parcelas (pagas e em aberto).
//
// ⚠️ Sob demanda, uma pessoa por vez. A carteira inteira tem ~20 mil parcelas; mandá-las junto da
// lista deixaria a tela lenta para mostrar o que quase ninguém abre de uma vez só.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const { codigo } = await params;
  const resultado = await lerFichaDoLsoft(codigo);

  if (!resultado.ok) {
    const naoAchou = resultado.erro === "Cliente não encontrado.";
    return NextResponse.json({ error: resultado.erro }, { status: naoAchou ? 404 : 503 });
  }

  return NextResponse.json(
    { data: { cadastro: resultado.cadastro, parcelas: resultado.parcelas } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
