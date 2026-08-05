import { NextResponse } from "next/server";

import { linkDaFilaDoCliente } from "@/lib/prometeu/link-da-fila";
import { autorizarOperacao } from "@/lib/prometeu/operador-server";

// QUEM PRODUZ o link da fila do cliente. A assinatura mora no servidor (HMAC), entao a tela nao
// tem como montar a URL sozinha: ela pede aqui e manda no WhatsApp.
//
// Rota RESTRITA (nao e' /api/publico): quem emite tem que ser do time. Aceita as duas
// identidades do dia — sessao do hub e cookie do operador do evento — porque quem faz o check-in
// na porta, e quem reenvia o link depois na secretaria, costuma ser freela sem login do hub.
//
// GET e nao POST de proposito: nao muda nada no banco, so' assina. Emitir de novo para a mesma
// pessoa devolve um link novo e igualmente valido (nao ha revogacao por emissao — ver o
// comentario de `emitirTokenDaFila`).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const parametros = new URL(request.url).searchParams;
  const credenciadoId = parametros.get("credenciadoId")?.trim() ?? "";
  const eventoId = parametros.get("eventoId")?.trim() ?? "";

  if (!credenciadoId || !eventoId) {
    return NextResponse.json(
      { error: "Informe o credenciadoId e o eventoId." },
      { status: 400 },
    );
  }

  const link = linkDaFilaDoCliente({ credenciadoId, eventoId });

  if (!link) {
    // Sem SESSAO_CAD_SECRET no ambiente nao da' para assinar. Falha explicita: um link sem
    // assinatura nao abriria nada, e mandar um link quebrado ao cliente e' pior que nao mandar.
    return NextResponse.json(
      { error: "Assinatura do link indisponivel neste ambiente." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { data: { link } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
