import { NextResponse } from "next/server";

import {
  adminOu503,
  autorDoCreditoNoPortal,
  autorizarOperacaoDeVenda,
  autorizarPortalQueOperaSozinho,
  cadNoEscopo,
  recorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";
import {
  escritaNoProduto,
  respostaDaEscrita,
} from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { aprovarComRestricao, type CorpoDaAprovacao } from "@/lib/serasa/aprovar-restricao-servico";

// APROVAR COM RESTRIÇÃO PELO PORTAL QUE OPERA SOZINHO
// POST /api/incorporador/board/[id]/serasa/aprovar-restricao?emp=
//
// Decisão do Lucas (16/09/2026): a equipe da Cecílio faz a análise de crédito e o credenciamento dos
// clientes dela. Crédito reprovado trava a CAD em revisão, e destravar é decisão de quem faz a
// análise; no portal que opera sozinho, QUALQUER conta do portal decide (no hub, só a coordenação).
// As regras são as do hub, no mesmo serviço (`lib/serasa/aprovar-restricao-servico.ts`): só sobre
// crédito reprovado, com a evidência do de-acordo anexada, e com o rastro de quem aprovou.
//
// A porta é a mesma da consulta, na mesma ordem: `autorizarOperacaoDeVenda` (401/404),
// `autorizarPortalQueOperaSozinho` (comercial e padrão: 404; conta revalidada), recorte com a sessão
// vigente e `cadNoEscopo` da CAD do endereço (fora do produto: 404). A ficha e o empreendimento que
// chegam ao serviço são os do escopo.
//
// Mesmo formato de requisição e de resposta de `/api/apolo/serasa/aprovar-restricao`.
//
// (16/09/2026, D1) SÓ NO PRODUTO QUE O PORTAL OPERA. A CAD do VOC (37) ou do VOR (41) está no escopo
// da Cecílio, mas o crédito dela é da Careli: 403 com `soConsulta`, antes de subir a evidência. A
// sessão já foi revalidada na porta, então a régua roda sobre ela (`escritaNoProduto`).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Sobe a evidência + regenera a CAD; folga para não estourar o tempo da função.
export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const sozinho = await autorizarPortalQueOperaSozinho(request, auth.sessao);
  if (!sozinho.ok) return sozinho.response;

  const rec = await recorteDoProduto(request, sozinho.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;
  const corpo = (await request.json().catch(() => ({}))) as CorpoDaAprovacao;

  const doPedido = typeof corpo.entityId === "string" ? corpo.entityId.trim() : "";
  if (doPedido && doPedido !== id) {
    return NextResponse.json(
      { error: "A ficha do pedido não confere com a do endereço." },
      { status: 400 },
    );
  }

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte, corpo.enterpriseId);
  if (!escopo.ok) return escopo.response;

  if (escopo.escopo.imobiliaria || !escopo.escopo.enterpriseId) {
    return NextResponse.json(
      { error: "Esta ficha não tem CAD na esteira: não há crédito para aprovar." },
      { status: 409 },
    );
  }

  // (16/09/2026, D1) Só na CAD do produto que o portal opera.
  const escrita = await escritaNoProduto(sozinho.sessao, [escopo.escopo.enterpriseId]);
  if (escrita !== "pode") return respostaDaEscrita(escrita);

  const resposta = await aprovarComRestricao({
    autor: autorDoCreditoNoPortal(sozinho.sessao),
    client: admin.client,
    corpo: { ...corpo, enterpriseId: escopo.escopo.enterpriseId, entityId: id },
  });
  return NextResponse.json(resposta.corpo, { status: resposta.status });
}
