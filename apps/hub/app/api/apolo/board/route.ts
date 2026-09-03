import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { montarFilaDoBoard } from "@/lib/apolo/board-do-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Fila da ESTEIRA de credenciamento: tudo que nasceu pelos canais externos e aguarda o time.
// A entidade já nasce com status 'review' (createApoloEntity), então a fila sai daí — sem tabela
// nova. Ver [[project_esteira_credenciamento_venda]].
//
// O MIOLO MORA EM `lib/apolo/board-do-servidor.ts` (02/09/2026): o portal comercial (Hércules)
// serve o MESMO board pelo cookie do coordenador, recortado pelo produto dele
// (/api/incorporador/board). Esta rota é a porta do hub: autentica pelo Bearer e chama de lá.
// Comportamento e payload não mudaram — { analistas, empreendimentos, itens, usuarioAtual }.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const fila = await montarFilaDoBoard(adminClient, { usuarioId: auth.userId });
  if (!fila.ok) {
    return NextResponse.json({ error: fila.error }, { status: fila.status });
  }

  return NextResponse.json(
    { data: fila.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
