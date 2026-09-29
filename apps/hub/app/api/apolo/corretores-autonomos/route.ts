import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { listarCorretoresAutonomos } from "@/lib/apolo/habilitacao-do-autonomo";
import { createApoloAdminClient } from "@/lib/apolo/server";

// OS CORRETORES AUTÔNOMOS DA CASA, para o bloco Vínculo do wizard e para a tela de habilitação.
//
// ⚠️ ROTA PRÓPRIA, SEPARADA DE `/api/apolo/imobiliarias`, E ISSO É A REGRA E NÃO ARRUMAÇÃO. Lucas
// (27/09/2026): *"nao quero ter a informacao que pode ter pessoa fisica como imobiliaria, isso sera bem
// restrito"*. Acrescentar o autônomo na lista de imobiliárias o faria aparecer em TODA tela que pede
// imobiliárias (o seletor do wizard, a aba do produto, o relatório de 18h30), porque aquela rota tem
// mais de um consumidor. Duas portas, dois conjuntos.
//
// Só operador logado (`authorizeApoloRead`): é PII de parceiro.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base." }, { status: 503 });

  const corretores = await listarCorretoresAutonomos(client);
  return NextResponse.json(
    { data: { corretores } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
