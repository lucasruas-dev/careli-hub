import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  type CorpoDaFicha,
  lerFichaDoBoard,
  salvarFichaDoBoard,
} from "@/lib/apolo/board-do-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Ficha COMPLETA de um item da esteira, pro operador validar com o documento ao lado (GET), e o
// salvamento do que o OPERADOR completou na validação (PATCH, merge — nunca replace).
// Ver [[project_esteira_credenciamento_venda]].
//
// O MIOLO MORA EM `lib/apolo/board-do-servidor.ts` (02/09/2026): o portal comercial (Hércules)
// abre a MESMA ficha pelo cookie do coordenador (/api/incorporador/board/[id]), depois de conferir
// que a CAD está no escopo do produto dele. Esta rota é a porta do hub: autentica pelo Bearer e
// chama de lá. Comportamento e payload não mudaram.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;

  // ⚠️ `[id]` É A PESSOA, NÃO A CAD (a chave da esteira é `entity_id + enterprise_id` desde a
  // 0080). `?enterpriseId=` diz de qual CAD é a ficha; sem ele, a MAIS RECENTE. Enquanto o card
  // do Board for por pessoa, este default é o que mantém a tela coerente com o que ela lista.
  const enterpriseId = new URL(request.url).searchParams.get("enterpriseId");

  return lerFichaDoBoard(adminClient, id, enterpriseId);
}

// Faz MERGE, nunca replace: o operador salva um campo por vez e não pode zerar o resto.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as CorpoDaFicha;

  return salvarFichaDoBoard(adminClient, id, body, auth.userId);
}
