import { NextResponse, type NextRequest } from "next/server";

import { montarBiValeDoOuro } from "@/lib/prometeu/bi-vale-do-ouro";
import { createPrometeuClient, getEvento } from "@/lib/prometeu/data";
import { validarTokenDoRelatorio } from "@/lib/prometeu/link-do-relatorio";
import {
  paginaComercial,
  paginaPerformance,
  payloadPerformance,
} from "@/lib/prometeu/relatorios";

// O RELATÓRIO PÚBLICO DO LANÇAMENTO — o link que o gestor/loteador abre.
//
// PADRÃO dos entregáveis do Vale do Ouro (Lucas, 24/08): a página é o HTML rico do BI (placar,
// estoque, curvas, ranking, perfil / régua da jornada, funil, onda da fila) e se atualiza
// sozinha a cada 60s chamando ESTA MESMA rota com `formato=json`. O COMERCIAL reusa o motor
// bi-vale-do-ouro generalizado (payload idêntico ao do BI original); o PERFORMANCE sai do
// Prometeu. Token HS256 no padrão do telão; JSON com s-maxage=60 (1 consulta/min na CDN,
// não importa quantos abram); SÓ AGREGADOS — nenhum dado pessoal.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const token = params.get("t");
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

  // O refresh da página: o payload de dados, com cache de 60s na CDN.
  if (params.get("formato") === "json") {
    try {
      const dados =
        autorizado.tipo === "comercial"
          ? await montarBiValeDoOuro("todos", Number(evento.enterpriseId))
          : await payloadPerformance(client, evento);
      return NextResponse.json(
        { data: dados },
        {
          headers: {
            "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
          },
        },
      );
    } catch (erro) {
      return NextResponse.json(
        { error: erro instanceof Error ? erro.message : "Falha ao montar o relatório." },
        { status: 502 },
      );
    }
  }

  const html =
    autorizado.tipo === "comercial"
      ? paginaComercial(evento, token ?? "")
      : paginaPerformance(evento, token ?? "");

  return new NextResponse(html, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
