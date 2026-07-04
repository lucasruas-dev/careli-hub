// Rota TEMPORÁRIA de teste: verifica se o renderizador de relatório (next/og) funciona no
// runtime nodejs (mesmo do webhook da CACÁ) antes de ligar na agente. Protegida por
// IRIS_TTS_DEMO_KEY. Remover depois de validar. Ver [[project-caca-admin-assistant-mode]].
import type { NextRequest } from "next/server";

import { renderVendasEmpreendimentoPng } from "@/lib/iris/report-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const key = process.env.IRIS_TTS_DEMO_KEY?.trim();
  const provided = new URL(request.url).searchParams.get("key")?.trim() ?? "";

  if (!key || provided !== key) {
    return new Response("Nao autorizado.", { status: 401 });
  }

  try {
    const png = await renderVendasEmpreendimentoPng();

    if (!png) {
      return new Response("Sem dados.", { status: 404 });
    }

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: { "cache-control": "no-store", "content-type": "image/png" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : "erro";

    return new Response(`Erro no render: ${message}`, { status: 500 });
  }
}
