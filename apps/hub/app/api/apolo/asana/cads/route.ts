import { NextResponse } from "next/server";

import { asanaConfigurado, sondarCadsNoAsana } from "@/lib/apolo/asana-cads";
import { authorizeApoloRead } from "@/lib/apolo/auth";

// Sondagem READ-ONLY da central de CADs no Asana: quantas CADs existem em cada seção e que
// tipos de anexo aparecem. Serve pra dimensionar a migração (e o custo da MOST) ANTES de
// importar. Não cria nada e não lê documento.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A sondagem faz varias chamadas encadeadas ao Asana.
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  if (!asanaConfigurado()) {
    return NextResponse.json(
      { error: "ASANA_ACCESS_TOKEN nao configurado neste ambiente." },
      { status: 503 },
    );
  }

  try {
    const dados = await sondarCadsNoAsana();
    return NextResponse.json(
      { data: dados },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 502 },
    );
  }
}
