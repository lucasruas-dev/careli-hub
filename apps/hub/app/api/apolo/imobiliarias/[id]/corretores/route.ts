import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { listarCorretoresDaImobiliaria } from "@/lib/apolo/imobiliaria-cadastro";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Corretores de UMA imobiliária, para o cadastro manual (o operador escolhe o corretor da CAD
// depois da imobiliária). Só operador logado (authorizeApoloRead).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base." }, { status: 503 });

  const corretores = await listarCorretoresDaImobiliaria(client, id);
  return NextResponse.json(
    { data: { corretores } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
