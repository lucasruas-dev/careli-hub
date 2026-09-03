import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { historicoDaFicha } from "@/lib/apolo/board-do-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";

// HISTÓRICO da ficha: o que mudou, para qual valor e quem — exigência do Lucas para poder
// validar depois. Os dados já são gravados a cada salvamento (`edit_ficha`, uma linha por
// campo) e a cada correção de identidade (`edit_identity`); aqui eles viram uma lista legível.
//
// O MIOLO MORA EM `lib/apolo/board-do-servidor.ts` (02/09/2026): o portal comercial (Hércules)
// lê o MESMO histórico pelo cookie do coordenador (/api/incorporador/board/[id]/historico), depois
// de conferir que a CAD está no escopo do produto dele. Esta rota é a porta do hub.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;

  return historicoDaFicha(client, id);
}
