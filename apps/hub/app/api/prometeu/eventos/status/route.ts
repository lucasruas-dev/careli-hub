import { NextResponse } from "next/server";

import {
  authorizePrometeuOwner,
  authorizePrometeuWrite,
} from "@/lib/prometeu/auth";
import {
  arquivarEvento,
  ativarEvento,
  createPrometeuClient,
  encerrarDia,
  getEvento,
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
    acao?: "arquivar" | "ativar" | "desarquivar" | "iniciar-real" | "encerrar-dia";
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

    const { error, fila, ok } = await ativarEvento(client, body.eventoId);
    if (!ok) return NextResponse.json({ error }, { status: 409 });
    return NextResponse.json({ data: { fila, ok: true, status: "ativo" } });
  }

  // ARQUIVAR / DESARQUIVAR — tira o lancamento de circulacao, sem apagar nada.
  //
  // Regra do Lucas (21/08): *"os lancamentos que foram finalizados, pode arquivar tudo, gestao,
  // fila tudo, pois apos finalizacao nao vamos mais utilizar ele para aquele evento"*.
  //
  // ⚠️ NAO EXISTE, E NAO DEVE EXISTIR, UM DELETE AQUI. As FKs deste modulo sao ON DELETE CASCADE:
  // apagar o evento levaria junto os credenciados, as movimentacoes, as chamadas, as mesas e os
  // operadores — o registro de quem credenciou e quem comprou.
  //
  // `authorizePrometeuOwner` (e nao Write) porque isto some com o lancamento inteiro das telas de
  // todo mundo. Reversivel pelo `desarquivar`, que e o que torna o clique errado barato.
  if (body.acao === "arquivar" || body.acao === "desarquivar") {
    const auth = await authorizePrometeuOwner(request);
    if (!auth.ok) return auth.response;

    const arquivar = body.acao === "arquivar";

    // Um lancamento EM OPERACAO nao se arquiva por engano: encerre o dia primeiro. Sem esta
    // trava, um clique no meio do evento apagaria a fila da tela de todos os postos ao mesmo
    // tempo, com gente no salao.
    if (arquivar) {
      const evento = await getEvento(client, body.eventoId);
      if (!evento) return NextResponse.json({ error: "Lancamento nao encontrado." }, { status: 404 });

      if (evento.status === "ativo" || evento.status === "em_andamento") {
        return NextResponse.json(
          {
            error:
              "Este lancamento esta em operacao. Encerre o dia antes de arquivar.",
          },
          { status: 409 },
        );
      }
    }

    const { error, ok } = await arquivarEvento({
      arquivar,
      client,
      eventoId: body.eventoId,
      por: auth.userId,
    });

    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { arquivado: arquivar, ok: true } });
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
