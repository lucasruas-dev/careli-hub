import { NextResponse } from "next/server";

import { listApoloDocuments } from "@/lib/apolo/documentos";
import {
  adminOu503,
  autorizarComercial,
  cadNoEscopo,
  recorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";

// DOCUMENTOS da ficha pelo portal comercial — GET /api/incorporador/board/[id]/documentos?emp=
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
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte);
  if (!escopo.ok) return escopo.response;

  try {
    const documents = await listApoloDocuments(admin.client, "entidade", id);
    return NextResponse.json({ documents }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[incorporador][board][documentos] falha ao listar", error);
    return NextResponse.json(
      { error: "Nao foi possivel carregar os documentos." },
      { status: 500 },
    );
  }
}
