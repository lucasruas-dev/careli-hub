import { NextResponse } from "next/server";

import { getApoloDocumentSignedUrl } from "@/lib/apolo/documentos";
import { foraDoEscopo } from "@/lib/apolo/incorporador/escopo";
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

// UM documento da ficha pelo portal que opera a venda — GET /api/incorporador/board/[id]/documentos/[docId]?emp=
// Devolve a URL assinada (10 min) do arquivo no bucket privado, como /api/apolo/documentos/[id].
//
// ⚠️ O DOCUMENTO TEM QUE SER DESTA PESSOA. A rota do hub recebe só o id do documento (o operador
// do hub abre qualquer ficha por desenho); aqui o `docId` é conferido contra a lista de
// documentos da entidade `[id]` — que, por sua vez, já passou pelo escopo do produto. Sem isto,
// um docId de outra pessoa na URL abriria o RG dela.
//
// (16/09/2026) ⚠️ E CONTRA A LISTA FILTRADA, NÃO A CRUA. O id do comprovante do Serasa ou da CAD
// de outro loteamento É desta pessoa, e passaria na conferência de posse; ele só não existe para o
// portal. Conferir contra `documentosDoApoloParaPortal` (a mesma função da lista) faz o id que a
// lista esconde responder o mesmo 404 de um id inexistente.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ docId: string; id: string }> },
) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { docId, id } = await context.params;

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte);
  if (!escopo.ok) return escopo.response;

  let documentos;
  try {
    documentos = await documentosDoApoloParaPortal(admin.client, id, {
      comercial: ehPortalComercial(auth.sessao.tipo),
      imobiliaria: escopo.escopo.imobiliaria,
      // (16/09/2026) O portal que opera sozinho faz o crédito dos clientes dele: o comprovante do
      // Serasa das CADs do escopo sai (documentos-do-portal.ts, `operaSozinho`).
      operaSozinho: portalConfeccionaContrato(auth.sessao.slug, auth.sessao.tipo),
      recorte: rec.recorte.ids,
    });
  } catch (error) {
    // Sem as marcas não dá para provar que o documento pode sair: não abre.
    console.error("[incorporador][board][documentos][docId] falha ao conferir", error);
    return NextResponse.json(
      { error: "Não foi possível abrir o documento agora." },
      { status: 503 },
    );
  }
  if (!documentos.some((doc) => doc.id === docId)) return foraDoEscopo();

  const result = await getApoloDocumentSignedUrl(admin.client, "entidade", docId);
  if (result.error || !result.url) {
    return NextResponse.json(
      { error: result.error ?? "Documento nao encontrado." },
      { status: 404 },
    );
  }

  return NextResponse.json({ url: result.url }, { headers: { "Cache-Control": "no-store" } });
}
