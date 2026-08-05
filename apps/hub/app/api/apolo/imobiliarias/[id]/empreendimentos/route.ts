import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { empreendimentosDaImobiliaria } from "@/lib/apolo/imobiliaria-cadastro";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Empreendimentos que UMA imobiliária trabalha (habilitados), para o cadastro manual decidir:
// >1 → o operador escolhe; ==1 → vincula direto; 0 → avisa. Só operador logado (authorizeApoloRead).
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

  const empreendimentos = await empreendimentosDaImobiliaria(client, id);
  return NextResponse.json(
    { data: { empreendimentos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
