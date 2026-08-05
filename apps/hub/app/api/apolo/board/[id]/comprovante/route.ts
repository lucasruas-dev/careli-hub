import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { getApoloDocumentSignedUrl } from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { COMPROVANTE_DOC_TYPE, gerarESalvarComprovante } from "@/lib/serasa/comprovante";

// Baixa o COMPROVANTE da última consulta de crédito da ficha. Gera na hora se ainda não existir
// (fichas consultadas antes do gatilho automático), e devolve uma URL assinada pra download.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const { id: entityId } = await context.params;

  // O comprovante é DO TITULAR. Como a consulta de crédito do cônjuge fica gravada no mesmo
  // entity_id, filtramos também pelo documento: sem isso, depois de consultar o cônjuge este
  // botão passaria a entregar o comprovante dele na ficha do titular.
  const { data: dono } = await client
    .from("apolo_entities")
    .select("document_masked")
    .eq("id", entityId)
    .maybeSingle<{ document_masked: string | null }>();

  const { data: consulta } = await client
    .from("serasa_consultas")
    .select("id")
    .eq("entity_id", entityId)
    .eq("documento", (dono?.document_masked ?? "").replace(/\D/g, ""))
    .eq("status", "sucesso")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!consulta) {
    return NextResponse.json(
      { error: "Nenhuma consulta de credito para esta ficha." },
      { status: 404 },
    );
  }

  // Reusa o comprovante já salvo desta consulta; gera se não houver.
  const { data: existente } = await client
    .from("apolo_documents")
    .select("id")
    .eq("entity_id", entityId)
    .eq("document_type", COMPROVANTE_DOC_TYPE)
    .contains("metadata", { consultaId: consulta.id })
    .maybeSingle<{ id: string }>();

  let documentId = existente?.id ?? null;
  if (!documentId) {
    const gerado = await gerarESalvarComprovante(client, consulta.id, {
      uploadedByName: "Analise de credito",
    });
    if (!gerado.ok || !gerado.documentId) {
      return NextResponse.json(
        { error: gerado.error ?? "Nao foi possivel gerar o comprovante." },
        { status: 500 },
      );
    }
    documentId = gerado.documentId;
  }

  const signed = await getApoloDocumentSignedUrl(client, "entidade", documentId);
  if (signed.error || !signed.url) {
    return NextResponse.json({ error: signed.error ?? "Falha ao gerar o link." }, { status: 500 });
  }

  return NextResponse.json({ data: { url: signed.url } });
}
