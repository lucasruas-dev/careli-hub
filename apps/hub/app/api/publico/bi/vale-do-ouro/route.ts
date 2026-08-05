import { NextResponse } from "next/server";

import { montarBiValeDoOuro } from "@/lib/prometeu/bi-vale-do-ouro";

// Dados do BI PÚBLICO do Vale do Ouro. Sem login DE PROPÓSITO (liberada no proxy, uma a uma):
// o link do BI circula com a diretoria e parceiros fora do hub. Só agregados — nenhum dado
// pessoal de comprador sai daqui (checado na montagem, lib/prometeu/bi-vale-do-ouro.ts).
//
// CUSTO (regra do Hermes): o CDN segura por 60s (s-maxage) — N pessoas com o BI aberto geram
// no máximo 1 consulta ao MySQL por minuto, não N.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await montarBiValeDoOuro();
    return NextResponse.json(
      { data },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      },
    );
  } catch {
    // Sem detalhes de erro numa rota pública (não vazar infra). O front mantém o que está.
    return NextResponse.json({ error: "Indisponível agora." }, { status: 503 });
  }
}
