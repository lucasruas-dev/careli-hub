import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { type CorpoDaEtapa, ehUuid, moverEtapaDoBoard } from "@/lib/apolo/board-do-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Move um item da esteira de ETAPA (apolo_esteira). Irmã do PATCH de ficha em [id]/route.ts.
// O Board deixou de ser esqueleto: avançar, indeferir, mandar à revisão e à correção gravam por
// aqui, em vez de viver só no estado local da tela. Ver [[project_esteira_credenciamento_venda]].
//
// O MIOLO MORA EM `lib/apolo/board-do-servidor.ts` (02/09/2026): o portal comercial (Hércules)
// move a MESMA etapa pelo cookie do coordenador (/api/incorporador/board/[id]/etapa), depois de
// conferir que a CAD está no escopo do produto dele. Esta rota é a porta do hub.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A transição regenera a CAD (monta PDF + upload); dá folga pra não estourar o tempo da função.
export const maxDuration = 30;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as CorpoDaEtapa;

  return moverEtapaDoBoard(adminClient, id, body, {
    nome: null,
    origem: "board",
    // `authorizeApoloWrite` devolve "local-hub-user" quando não há Supabase server-side.
    uploadedByName: ehUuid(auth.userId) ? "Board" : null,
    userId: auth.userId,
  });
}
