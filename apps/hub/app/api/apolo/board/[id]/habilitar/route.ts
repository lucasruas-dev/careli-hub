import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  type CorpoDaDecisao,
  decidirCredenciamento,
  pedidosDaImobiliaria,
} from "@/lib/apolo/board-do-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";

// HABILITAR / INDEFERIR o credenciamento de uma imobiliária.
//
// ⚠️ POR QUE ESTA ROTA EXISTE, e não é o `[id]/etapa`: o Board desenha a trilha da imobiliária
// como `cadastro -> habilitada`, mas `ehEtapaValida` só conhece as etapas da esteira de CAD
// (validacao/credito/revisao/prevenda/credenciado/correcao/indeferido). O clique em "Habilitada"
// devolvia **400 "Etapa invalida."** e nada acontecia — era isso que fazia a aprovação "não ir
// para habilitação", com 16 imobiliárias paradas desde 11/08/2026 sem conseguir enviar CAD.
//
// O MIOLO MORA EM `lib/apolo/board-do-servidor.ts` (02/09/2026): o portal comercial (Hércules)
// habilita pelo cookie do coordenador (/api/incorporador/board/[id]/habilitar), restrito aos
// empreendimentos do produto dele. Esta rota é a porta do hub. Comportamento não mudou.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// O que a imobiliária PEDIU, para a tela montar as caixinhas. Fica na mesma rota de propósito:
// quem decide precisa ver exatamente a lista sobre a qual vai decidir.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  // Mesma régua das outras leituras do Board: sem isto, os empreendimentos pedidos por uma
  // imobiliária ficariam legíveis para qualquer um que soubesse o id.
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;

  return pedidosDaImobiliaria(adminClient, id);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  const corpo = (await request.json().catch(() => ({}))) as CorpoDaDecisao;

  return decidirCredenciamento(adminClient, id, corpo, auth.userId);
}
