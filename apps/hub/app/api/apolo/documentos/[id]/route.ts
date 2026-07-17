import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  deleteApoloDocument,
  getApoloDocumentSignedUrl,
  type ApoloDocScope,
} from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Um documento do Apolo: GET devolve a URL assinada (10 min) pra abrir o arquivo do bucket
// privado; DELETE remove o arquivo + a linha. O escopo (entidade/empreendimento) vem por query
// porque o id sozinho não diz de qual tabela é. Ver [[project_apolo_cadastro_prospect]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function scopeFromRequest(request: NextRequest): ApoloDocScope {
  return request.nextUrl.searchParams.get("scope") === "empreendimento"
    ? "empreendimento"
    : "entidade";
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  const result = await getApoloDocumentSignedUrl(adminClient, scopeFromRequest(request), id);

  if (result.error || !result.url) {
    return NextResponse.json(
      { error: result.error ?? "Documento nao encontrado." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { url: result.url },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  const result = await deleteApoloDocument(adminClient, scopeFromRequest(request), id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
