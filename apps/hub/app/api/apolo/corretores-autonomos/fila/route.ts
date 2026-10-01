import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { filaDoLinkDoAutonomo } from "@/lib/apolo/autonomo-do-link";
import { createApoloAdminClient } from "@/lib/apolo/server";

// A FILA DOS CORRETORES AUTÔNOMOS QUE SE CADASTRARAM PELO LINK PÚBLICO (01/10/2026).
//
// Em análise e em correção ficam até alguém decidir; aprovados e indeferidos ficam 30 dias, como no
// Board, para o time conferir o que acabou de fazer. A fila sai da trilha de `apolo_audit_events`
// (lib/apolo/autonomo-do-link.ts), e não do `metadata` da ficha, que o sync do C2X reescreve.
//
// Só operador logado (`authorizeApoloRead`): é PII de quem pediu cadastro.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base." }, { status: 503 });

  const fila = await filaDoLinkDoAutonomo(client);
  if (!fila.ok) {
    return NextResponse.json(
      { error: "Não foi possível carregar os pedidos agora. Tente de novo em instantes." },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { data: { itens: fila.itens } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
