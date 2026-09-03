import { NextResponse } from "next/server";

import { type CorpoDaEtapa, moverEtapaDoBoard } from "@/lib/apolo/board-do-servidor";
import {
  adminOu503,
  autorizarComercial,
  cadNoEscopo,
  recorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";

// MOVER DE ETAPA pelo portal comercial — PATCH (e POST) /api/incorporador/board/[id]/etapa?emp=
//
// Mesmas regras da rota do hub (`moverEtapaDoBoard`: etapa válida, `nuncaRebaixar`, saída de
// revisão barrada, auditoria, CAD regenerada), com o escopo conferido ANTES: a CAD alvo
// (entity_id + enterpriseId do card) tem que estar no produto do coordenador. Fora dele: 404.
//
// Aceita POST além de PATCH porque o contrato das frentes do Hércules cita POST; o BoardView
// manda PATCH, como sempre mandou.
//
// ⚠️ NEM TODA ETAPA É DO COORDENADOR. A tela esconde o botão de avanço em Crédito e Pré-venda
// (board-view.tsx: *"a consulta de verdade vive no painel da etapa, igual ao PIX"*), mas esconder
// é do cliente: com o cookie na mão, um PATCH direto com `etapa: "credenciado"` passava por
// `moverEtapaDoBoard`, que só barra a SAÍDA de revisão — e a CAD entrava na fila do Prometeu
// aprovada sem Serasa e sem PIX. A régua fica AQUI, no servidor: o coordenador anda com a CAD até
// a análise de crédito e pode pedir correção ou revisão; pré-venda, credenciado e indeferido são
// decisão da Careli (o servidor do crédito/PIX é quem grava essas).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A transição regenera a CAD (monta PDF + upload); dá folga pra não estourar o tempo da função.
export const maxDuration = 30;

// O vocabulário da esteira é `validacao | credito | revisao | prevenda | credenciado | correcao |
// indeferido` (lib/apolo/esteira.ts). Só estas quatro têm porta no portal.
const ETAPAS_DO_COORDENADOR: ReadonlySet<string> = new Set([
  "validacao",
  "credito",
  "correcao",
  "revisao",
]);

async function mover(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as CorpoDaEtapa;

  // Antes de tocar em qualquer CAD: etapa que não é do coordenador é 403 com a explicação, e não
  // o 400 "etapa invalida" (a etapa existe; quem não pode gravá-la é ele).
  if (!ETAPAS_DO_COORDENADOR.has(String(body.etapa ?? "").trim())) {
    return NextResponse.json(
      { error: "Esta etapa e decidida pela Careli (pre-venda, credenciamento e indeferimento)." },
      { status: 403 },
    );
  }

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte, body.enterpriseId);
  if (!escopo.ok) return escopo.response;

  // Imobiliária não passa pela esteira (a decisão dela é por /habilitar). Mesma resposta 409 que
  // `atualizarEtapa` daria para "sem CAD", só que antes de tocar no banco.
  if (escopo.escopo.imobiliaria) {
    return NextResponse.json(
      { error: "Esta ficha nao tem CAD na esteira: imobiliaria e decidida em Habilitar." },
      { status: 409 },
    );
  }

  return moverEtapaDoBoard(
    admin.client,
    id,
    // A CAD alvo é a que o escopo resolveu: nunca "a mais recente" de outro loteamento.
    { ...body, enterpriseId: escopo.escopo.enterpriseId },
    {
      nome: auth.sessao.usuarioNome,
      origem: "portal-comercial",
      uploadedByName: auth.sessao.usuarioNome,
      userId: auth.sessao.usuarioId,
    },
  );
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return mover(request, context);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return mover(request, context);
}
