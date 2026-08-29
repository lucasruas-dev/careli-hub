import { NextResponse, type NextRequest } from "next/server";

import { createPrometeuClient, eventoOperavelId } from "@/lib/prometeu/data";
import {
  autorizarOperacao,
  autorizarOperacaoDeEscrita,
} from "@/lib/prometeu/operador-server";
import { avisarFilaEmRealtime } from "@/lib/prometeu/realtime-fila";
import {
  cancelarReservaDoGrupo,
  reservasDoEvento,
} from "@/lib/prometeu/reservas-evento";

// AS RESERVAS DO LANÇAMENTO — listar e cancelar.
//
// ⚠️ ATÉ 28/08/2026 NÃO HAVIA NENHUMA TELA que mostrasse as reservas de um evento, nem forma de
// cancelar uma: as colunas de cancelamento existiam na migration desde o começo e nada escrevia
// nelas. Um lote reservado por engano no salão só voltava para a prateleira por SQL na mão.
//
// GET  = os cupons do evento (um por grupo), do mais novo para o mais velho.
// POST = cancela um grupo inteiro.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function eventoDaRequisicao(
  client: NonNullable<ReturnType<typeof createPrometeuClient>>,
  request: NextRequest,
): Promise<null | string> {
  const pedido = new URL(request.url).searchParams.get("eventoId")?.trim();
  if (pedido) return pedido;
  return (await eventoOperavelId(client)) ?? null;
}

export async function GET(request: NextRequest) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json(
      { error: "Supabase indisponivel." },
      { status: 503 },
    );
  }

  const eventoId = await eventoDaRequisicao(client, request);
  if (!eventoId) {
    return NextResponse.json(
      { error: "Nenhum evento em andamento." },
      { status: 404 },
    );
  }

  const { error, reservas } = await reservasDoEvento(client, eventoId);
  if (error) return NextResponse.json({ error }, { status: 502 });

  return NextResponse.json(
    { data: { eventoId, reservas: reservas ?? [] } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  // ⚠️ Escrita: cancelar reserva devolve lote à prateleira e pode desfazer o atendimento de um
  // cliente que já está com o cupom na mão. Não é operação de leitura disfarçada.
  const auth = await autorizarOperacaoDeEscrita(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json(
      { error: "Supabase indisponivel." },
      { status: 503 },
    );
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    grupoId?: unknown;
    codigos?: unknown;
    motivo?: unknown;
  };
  const grupoId = String(corpo?.grupoId ?? "").trim();
  if (!grupoId) {
    return NextResponse.json(
      { error: "Informe a reserva a cancelar." },
      { status: 400 },
    );
  }

  const eventoId = await eventoDaRequisicao(client, request);

  const { error, resultado } = await cancelarReservaDoGrupo(client, {
    canceladoPor: auth.operadorId ?? null,
    grupoId,
    // Quais lotes: vazio = o cupom inteiro (padrão). Ver a nota em cancelarReservaDoGrupo.
    codigos: Array.isArray(corpo?.codigos)
      ? (corpo.codigos as unknown[]).map((c) => String(c ?? ""))
      : null,
    motivo: typeof corpo?.motivo === "string" ? corpo.motivo : null,
  });

  if (error) return NextResponse.json({ error }, { status: 502 });

  // Zero linhas = já estava cancelada. Não é erro: o operador pode ter bipado duas vezes.
  if (resultado && resultado.quantos > 0 && eventoId) {
    // O telão e a tela de unidades repintam o lote em segundos.
    await avisarFilaEmRealtime(eventoId);
  }

  return NextResponse.json({ data: resultado });
}
