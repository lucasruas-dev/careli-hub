import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { listEmpreendimentosAtivos } from "@/lib/apolo/credenciamento";
import { authorizePrometeuRead } from "@/lib/prometeu/auth";

// Os empreendimentos que o Setup pode escolher: os mesmos "na ativa" do credenciamento
// (`apolo_enterprise_settings.credenciamento_ativo`), com nome e sigla vindos do C2X.
// Amarrar o evento ao empreendimento REAL e o que deixa a etiqueta e a fila filtrarem por ele
// depois — evento novo com nome digitado a mao nao se liga a nada.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizePrometeuRead(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  try {
    const empreendimentos = await listEmpreendimentosAtivos(client);
    return NextResponse.json(
      { data: empreendimentos },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[prometeu][empreendimentos] falha ao carregar", error);
    return NextResponse.json(
      { error: "Nao foi possivel carregar os empreendimentos." },
      { status: 500 },
    );
  }
}
