import { NextResponse, type NextRequest } from "next/server";

import { montarBiValeDoOuro, normalizarCarteira } from "@/lib/prometeu/bi-vale-do-ouro";

// Dados do BI PÚBLICO do Vale do Ouro. Sem login DE PROPÓSITO (liberada no proxy, uma a uma):
// o link do BI circula com a diretoria e parceiros fora do hub. Só agregados — nenhum dado
// pessoal de comprador sai daqui (checado na montagem, lib/prometeu/bi-vale-do-ouro.ts).
//
// RECORTE: `?carteira=voc` (Cecílio) ou `?carteira=vol` (Lino). Sem parâmetro, ou com valor
// desconhecido, responde o lançamento INTEIRO — que é o comportamento de sempre. O gate do
// proxy olha só o caminho, então a query string não muda nada na liberação.
//
// CUSTO (regra do Hermes): o CDN segura por 60s (s-maxage) — N pessoas com o BI aberto geram
// no máximo 1 consulta ao MySQL por minuto, não N (por recorte, já que a URL entra na chave).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const carteira = normalizarCarteira(request.nextUrl.searchParams.get("carteira"));
    const data = await montarBiValeDoOuro(carteira);
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
