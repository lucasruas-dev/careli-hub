import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { getApoloDocumentSignedUrl } from "@/lib/apolo/documentos";
import { gerarESalvarCad } from "@/lib/apolo/salvar-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Baixa a CAD da ficha. A CAD já é salva AUTOMATICAMENTE na consulta de crédito; aqui reusamos a
// que existe (gerando na hora se ainda não houver, ex.: ficha sem consulta), e devolvemos uma URL
// assinada pra download.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const { id: entityId } = await context.params;

  // Reusa a CAD automática já salva; gera se não houver.
  const { data: existente } = await client
    .from("apolo_documents")
    .select("id")
    .eq("entity_id", entityId)
    .eq("document_type", "cad")
    .contains("metadata", { origem: "automatico" })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  let documentId = existente?.id ?? null;
  if (!documentId) {
    const gerado = await gerarESalvarCad(client, entityId, {
      uploadedByName: /^[0-9a-f-]{36}$/i.test(auth.userId) ? "Board" : null,
    });
    if (!gerado.ok || !gerado.documentId) {
      return NextResponse.json(
        { error: gerado.error ?? "Nao foi possivel gerar a CAD." },
        { status: 500 },
      );
    }
    documentId = gerado.documentId;
  }

  const signed = await getApoloDocumentSignedUrl(client, "entidade", documentId);
  if (signed.error || !signed.url) {
    return NextResponse.json({ error: signed.error ?? "Falha ao gerar o link." }, { status: 500 });
  }

  return NextResponse.json({ data: { documentId, url: signed.url } });
}
