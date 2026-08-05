import { NextResponse } from "next/server";

import { listarAcoes } from "@/lib/apolo/acoes";
import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// As AÇÕES de contato em massa (campanhas). Lista para a aba Ações da Iris escolher qual abrir.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base." }, { status: 503 });

  const acoes = await listarAcoes(client);
  return NextResponse.json({ data: { acoes } }, { headers: { "Cache-Control": "no-store" } });
}
