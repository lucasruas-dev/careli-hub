import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloCoordenacao } from "@/lib/apolo/auth";
import { documentosDoPedido } from "@/lib/apolo/autonomo-do-link";
import { createApoloAdminClient } from "@/lib/apolo/server";

// OS DOCUMENTOS DE UM PEDIDO DO LINK DO CORRETOR AUTÔNOMO, em URL assinada de 10 minutos.
//
// Antes da aprovação eles moram no staging privado do bucket, e não no drive de ficha nenhuma: é aqui
// que a coordenação os confere para decidir. Só a coordenação (admin e líder), como a decisão.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloCoordenacao(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_RE.test(String(id ?? ""))) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }
  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base." }, { status: 503 });

  const lidos = await documentosDoPedido(client, id);
  if (!lidos.ok) {
    return NextResponse.json(
      { error: lidos.status === 404 ? "Pedido não encontrado." : "Não foi possível abrir os documentos agora." },
      { status: lidos.status },
    );
  }
  return NextResponse.json(
    { data: { documentos: lidos.documentos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
