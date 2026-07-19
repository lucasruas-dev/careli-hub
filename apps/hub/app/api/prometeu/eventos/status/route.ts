import { NextResponse } from "next/server";

import {
  authorizePrometeuOwner,
  authorizePrometeuWrite,
} from "@/lib/prometeu/auth";
import {
  ativarEvento,
  createPrometeuClient,
  encerrarDia,
  iniciarEventoReal,
} from "@/lib/prometeu/data";

// Muda o estagio do evento.
//
//   ativar        -> libera a PREPARACAO (papel de operacao basta)
//   iniciar-real  -> comeca o evento e RESETA o ensaio        ⚠️ SO O DONO
//   encerrar-dia  -> fecha o dia, arquiva quem nao concluiu   ⚠️ SO O DONO
//
// As duas acoes irreversiveis exigem `authorizePrometeuOwner`: identidade por e-mail no token,
// nao papel. Papel de admin NAO substitui (regra do Lucas 19/jul, "somente o meu usuario").
//
// Nao existe parametro `forcar`. Depois que o evento entra em andamento o reset esta bloqueado
// em definitivo — zerar no meio apagaria a fila fisica de centenas de pessoas ja credenciadas.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    acao?: "ativar" | "iniciar-real" | "encerrar-dia";
    confirmado?: boolean;
    encerrarEvento?: boolean;
    eventoId?: string;
  };

  if (!body.eventoId) {
    return NextResponse.json({ error: "Informe o eventoId." }, { status: 400 });
  }

  // Ativar nao destroi nada: papel de operacao resolve.
  if (body.acao === "ativar") {
    const auth = await authorizePrometeuWrite(request);
    if (!auth.ok) return auth.response;

    const { error, ok } = await ativarEvento(client, body.eventoId);
    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { ok: true, status: "ativo" } });
  }

  if (body.acao === "iniciar-real") {
    const auth = await authorizePrometeuOwner(request);
    if (!auth.ok) return auth.response;

    if (!body.confirmado) {
      return NextResponse.json(
        {
          error:
            "Esta acao apaga chamadas, movimentacoes, unidades reservadas e o check-in de todos. Confirme explicitamente.",
        },
        { status: 428 },
      );
    }

    const { error, ok, resetados } = await iniciarEventoReal({
      client,
      eventoId: body.eventoId,
    });

    if (!ok) return NextResponse.json({ error }, { status: 409 });
    return NextResponse.json({
      data: { ok: true, resetados, status: "em_andamento" },
    });
  }

  if (body.acao === "encerrar-dia") {
    const auth = await authorizePrometeuOwner(request);
    if (!auth.ok) return auth.response;

    if (!body.confirmado) {
      return NextResponse.json(
        {
          error:
            "Encerrar o dia arquiva todos que nao concluiram o fluxo. Confirme explicitamente.",
        },
        { status: 428 },
      );
    }

    const { arquivados, concluidos, error, ok } = await encerrarDia({
      client,
      encerrar: body.encerrarEvento,
      eventoId: body.eventoId,
      por: auth.userId,
    });

    if (!ok) return NextResponse.json({ error }, { status: 409 });
    return NextResponse.json({ data: { arquivados, concluidos, ok: true } });
  }

  return NextResponse.json({ error: "Acao desconhecida." }, { status: 400 });
}
