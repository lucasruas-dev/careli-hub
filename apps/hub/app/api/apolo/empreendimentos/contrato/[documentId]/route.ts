import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { d4signPdfHeaders, fetchD4SignContract } from "@/lib/guardian/d4sign";

// Contrato assinado (PDF) de uma unidade, servido on-the-fly pela API do D4Sign a
// partir do uuidDoc. Ver [[project-apolo-crm-grafo]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const { documentId } = await context.params;
  const id = decodeURIComponent(documentId ?? "").trim();

  if (!id) {
    return NextResponse.json(
      { error: "Documento nao informado." },
      { status: 400 },
    );
  }

  const result = await fetchD4SignContract(id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new Response(result.body, {
    headers: d4signPdfHeaders(id, result.contentType, result.contentLength),
  });
}
