import { NextResponse } from "next/server";

import { getApoloDocumentSignedUrl, listApoloDocuments } from "@/lib/apolo/documentos";
import { foraDoEscopo } from "@/lib/apolo/incorporador/escopo";
import {
  adminOu503,
  autorizarComercial,
  cadNoEscopo,
  recorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";

// UM documento da ficha pelo portal comercial — GET /api/incorporador/board/[id]/documentos/[docId]?emp=
// Devolve a URL assinada (10 min) do arquivo no bucket privado, como /api/apolo/documentos/[id].
//
// ⚠️ O DOCUMENTO TEM QUE SER DESTA PESSOA. A rota do hub recebe só o id do documento (o operador
// do hub abre qualquer ficha por desenho); aqui o `docId` é conferido contra a lista de
// documentos da entidade `[id]` — que, por sua vez, já passou pelo escopo do produto. Sem isto,
// um docId de outra pessoa na URL abriria o RG dela.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ docId: string; id: string }> },
) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { docId, id } = await context.params;

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte);
  if (!escopo.ok) return escopo.response;

  const documentos = await listApoloDocuments(admin.client, "entidade", id);
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
