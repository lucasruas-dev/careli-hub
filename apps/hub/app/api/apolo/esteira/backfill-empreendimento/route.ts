import { NextResponse, type NextRequest } from "next/server";

import { asanaConfigurado } from "@/lib/apolo/asana-import";
import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { backfillEmpreendimentoViaAsana } from "@/lib/apolo/backfill-empreendimento";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Preenche o EMPREENDIMENTO das fichas que entraram na esteira sem ele (ex.: cadastro manual),
// buscando cada uma no Asana pelo nome. GET = simula (não grava); POST = aplica. Só roda em
// ambiente com o token do Asana (produção). Ver [[project_apolo_avisos_imobiliaria]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

async function executar(request: NextRequest, dryRun: boolean) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  if (!asanaConfigurado()) {
    return NextResponse.json(
      { error: "ASANA_ACCESS_TOKEN não configurado neste ambiente (rode em produção)." },
      { status: 503 },
    );
  }

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base." }, { status: 503 });

  try {
    const data = await backfillEmpreendimentoViaAsana(client, { dryRun });
    return NextResponse.json({ data: { ...data, dryRun } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function GET(request: NextRequest) {
  return executar(request, true);
}

export async function POST(request: NextRequest) {
  return executar(request, false);
}
