import { NextResponse } from "next/server";

import {
  adminOu503,
  autorizarOperacaoDeVenda,
  cadNoEscopo,
  recorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";
import { documentosDoApoloParaPortal } from "@/lib/apolo/incorporador/documentos-do-portal";
import {
  ehPortalComercial,
  portalConfeccionaContrato,
} from "@/lib/apolo/incorporador/perfis-de-portal";

// DOCUMENTOS da ficha pelo portal que opera a venda — GET /api/incorporador/board/[id]/documentos?emp=
//
// O Board valida a CAD com o documento ORIGINAL ao lado dos dados (ValidacaoLadoALado). No hub a
// lista vem de /api/apolo/documentos?entityId=; aqui ela vem por baixo do `[id]` do board, para
// passar pelo MESMO escopo das demais rotas: a pessoa tem que ter CAD (ou vínculo de
// imobiliária) no produto do coordenador. Fora dele: 404.
//
// SÓ LEITURA. Upload e exclusão continuam no hub: o coordenador confere, não anexa.
//
// ⚠️ MESMO FORMATO da rota do hub — `{ documents }` na RAIZ, sem envelope `data`. O BoardView lê
// `payload.documents`; um envelope aqui faria a lista vir sempre vazia (foi o incidente da rota
// do hub, registrado no próprio BoardView).
//
// (16/09/2026) A LISTA É FILTRADA PARA O PORTAL (`documentosDoApoloParaPortal`): a pessoa estar no
// escopo não põe todos os documentos dela no escopo. O comprovante do Serasa, o dossiê jurídico e
// a CAD/PA que não dá para provar que é deste produto não saem; o RG, a CNH e o comprovante de
// endereço saem. `uploadedBy` vai nulo (é o nome ou o e-mail de quem da Careli anexou).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte);
  if (!escopo.ok) return escopo.response;

  try {
    const documents = await documentosDoApoloParaPortal(admin.client, id, {
      comercial: ehPortalComercial(auth.sessao.tipo),
      imobiliaria: escopo.escopo.imobiliaria,
      // (16/09/2026) O portal que opera sozinho faz o crédito dos clientes dele: o comprovante do
      // Serasa das CADs do escopo sai (documentos-do-portal.ts, `operaSozinho`).
      operaSozinho: portalConfeccionaContrato(auth.sessao.slug, auth.sessao.tipo),
      recorte: rec.recorte.ids,
    });
    return NextResponse.json({ documents }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[incorporador][board][documentos] falha ao listar", error);
    return NextResponse.json(
      { error: "Nao foi possivel carregar os documentos." },
      { status: 500 },
    );
  }
}
