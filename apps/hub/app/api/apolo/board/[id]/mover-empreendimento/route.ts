import { NextResponse } from "next/server";

import { authorizeApoloCoordenacao } from "@/lib/apolo/auth";
import { type CorpoDoMover, moverCadDeEmpreendimento } from "@/lib/apolo/mover-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";

// MOVER A CAD DE EMPREENDIMENTO — POST /api/apolo/board/[id]/mover-empreendimento { de, para }
//
// Nasceu do caso do JONATAS (24/09/2026): a CAD foi criada no Veredas do Ouro (19) quando era do Vale
// do Ouro (35), o time trocou só o VÍNCULO no Apolo, e a CAD ficou no 19 (o crédito leu a regra do
// Veredas, o coordenador do Vale do Ouro não via o cliente). Esta rota troca a CAD inteira de produto:
// esteira, vínculos, documentos pessoais, a etapa pela regra de crédito do destino e o aviso ao
// coordenador e ao corretor do destino. O miolo mora em `lib/apolo/mover-cad.ts`; aqui fica só a porta.
//
// A resposta 200 é `{ data: { de, para, empreendimentoNovo, etapaAnterior, etapaNova, credito,
// avisos, incompleto } }`. `avisos` (sem repetição) diz tudo o que não saiu depois da troca: vínculo,
// documentos, etapa que devia subir, aviso ao coordenador do destino, PDF. `incompleto: true` é só
// para os passos de DADO (vínculo, documentos, etapa que devia subir): a CAD JÁ está no destino, mas
// o banco ficou diferente do que devia, e a tela destaca em vez de mostrar sucesso limpo. Aviso e PDF
// entram em `avisos` sem ligar `incompleto` (revisão de 24/09/2026, terceira rodada).
//
// Recusas sem escrever nada: 400 (corpo, destino igual ou que não recebe CAD, nome não achado), 404
// (CAD não está na origem), 409 (CAD já existe no destino, CAD com cobrança de pré-venda, CAD que mudou
// no meio) e 503 (leitura que falhou, inclusive o portão de CAD ilegível).
//
// ⚠️ SÓ A COORDENAÇÃO (admin/leader), pela mesma porta da aprovação com restrição
// (`authorizeApoloCoordenacao`). Mover pode tirar um credenciado do credenciamento, levar uma CAD
// reprovada para a pré-venda (quando a consulta passa no limite do produto certo) e disparar o aviso
// de etapa: é decisão de coordenação, não do analista.
//
// `[id]` é o `entity_id` da ficha, como nas rotas irmãs (`[id]/etapa`, `[id]/habilitar`). `de` é o
// `enterpriseId` do card (a chave da CAD na esteira); `para` é o empreendimento escolhido, que o
// servidor canoniza para o id de mercado (o pai).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Move a etapa (avisos por WhatsApp) e regenera o PDF da CAD (toca o C2X): folga como a da consulta.
export const maxDuration = 60;

const ehUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloCoordenacao(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const { id } = await context.params;
  const corpo = (await request.json().catch(() => ({}))) as CorpoDoMover;

  const resposta = await moverCadDeEmpreendimento({
    autor: { userId: auth.userId },
    client,
    corpo: corpo && typeof corpo === "object" ? corpo : {},
    entityId: id,
    // `authorizeApolo*` devolve "local-hub-user" quando não há Supabase server-side.
    uploadedByName: ehUuid(auth.userId) ? "Board" : null,
  });
  return NextResponse.json(resposta.corpo, { status: resposta.status });
}
