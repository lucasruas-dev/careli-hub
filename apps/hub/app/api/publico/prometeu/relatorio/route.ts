import { NextResponse, type NextRequest } from "next/server";

import { createPrometeuClient, getEvento } from "@/lib/prometeu/data";
import { validarTokenDoRelatorio } from "@/lib/prometeu/link-do-relatorio";
import {
  dadosComerciais,
  dadosPerformance,
  renderComercial,
  renderPerformance,
} from "@/lib/prometeu/relatorios";

// O RELATÓRIO PÚBLICO DO LANÇAMENTO — a página que o gestor/loteador abre pelo link.
//
// Mesmo desenho do BI público do Vale do Ouro: HTML pronto, SEM dado pessoal (só agregados),
// cache de 60s na CDN (uma consulta por minuto, não importa quantos abram) e token HS256 no
// padrão do telão. Rota liberada UMA A UMA no proxy.ts, como manda o lockdown.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("t");
  const autorizado = validarTokenDoRelatorio(token);
  if (!autorizado) {
    return new NextResponse("Link inválido ou expirado.", { status: 401 });
  }

  const client = createPrometeuClient();
  if (!client) return new NextResponse("Indisponível.", { status: 503 });

  const evento = await getEvento(client, autorizado.eventoId);
  // Arquivado = link morto (a revogação é o ciclo de vida do evento, como no telão).
  if (!evento || evento.arquivadoEm) {
    return new NextResponse("Lançamento não disponível.", { status: 404 });
  }

  let html: null | string = null;
  if (autorizado.tipo === "comercial") {
    const dados = await dadosComerciais(client, evento);
    if (dados) html = renderComercial(evento, dados);
  } else {
    html = renderPerformance(evento, await dadosPerformance(client, evento));
  }
  if (!html) {
    return new NextResponse("Relatório indisponível para este lançamento.", { status: 422 });
  }

  return new NextResponse(html, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
