import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { conferirBloqueio, type PedidoDeBloqueio } from "@/lib/hercules/bloqueio-de-unidade";
import {
  bloquearUnidade,
  desbloquearUnidade,
  lerUnidadeDoBloqueio,
} from "@/lib/hercules/bloquear-unidade-server";

// BLOQUEAR E DESBLOQUEAR A UNIDADE PELO APOLO — a porta do hub da MESMA regra do Hércules.
//
// Lucas (18/09/2026): *"cadastro apolo, interações comerciais hercules"* · *"eu posso por exemplo,
// bloquear uma unidade dentro do apolo e isso tem que refletir no hercules"*.
//
// ⚠️ A REGRA NÃO MORA AQUI. Mora em lib/hercules/bloquear-unidade-server.ts, a mesma que a rota do
// portal chama (/api/incorporador/venda/bloqueio): só bloqueia lote livre pela régua única, grava
// o carimbo (quando, quem, motivo) com UPDATE condicional, e só desbloqueia o que foi bloqueado no
// Panteon, com a régua dizendo `bloqueada` e sem outro dono no terreno. Uma regra, duas portas: o
// lote bloqueado aqui sai `bloqueada` na Venda do Hércules na hora, porque as duas telas leem o
// mesmo cadastro pela mesma régua.
//
// ⚠️ `authorizeApoloWrite` (e não `Read`), como as outras escritas de app/api/apolo/empreendimentos:
// bloquear tira o lote do espelho público e da Venda, e o `viewer` só olha. O time da Careli alcança
// qualquer produto, então não há recorte por sessão aqui (o mesmo desenho de ./panteon).
//
// ⚠️ O ID É O DA LINHA DO PANTEON (`hercules_unidades.id`), nunca o do C2X. A aba Unidades recebe o
// `panteonId` de cada unidade já casado pela régua (`acharUnidade`); unidade sem cadastro no Panteon
// não tem botão, porque não há o que bloquear.
//
// Corpo: POST `{ unidadeId, motivo, detalhe? }` · DELETE `{ unidadeId }`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEM_CACHE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Bloqueio indisponível." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as null | {
    detalhe?: unknown;
    motivo?: unknown;
    unidadeId?: unknown;
  };
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const pedido: PedidoDeBloqueio = {
    detalhe: String(corpo.detalhe ?? "").trim(),
    motivo: String(corpo.motivo ?? "").trim(),
    unidadeId: String(corpo.unidadeId ?? "").trim(),
  };

  // A MESMA conferência da modal, antes de qualquer leitura: pedido mal formado nem chega ao banco.
  const erros = conferirBloqueio(pedido);
  if (erros.length > 0) {
    return NextResponse.json({ erros }, { headers: SEM_CACHE, status: 422 });
  }

  try {
    const unidade = await lerUnidadeDoBloqueio(admin, pedido.unidadeId);
    if (!unidade) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    const resultado = await bloquearUnidade(admin, {
      autor: { id: auth.userId, nome: auth.nome },
      pedido,
      unidade,
    });
    return resultado.ok
      ? NextResponse.json({ data: resultado.data }, { headers: SEM_CACHE })
      : NextResponse.json(resultado.corpo, { headers: SEM_CACHE, status: resultado.status });
  } catch (erro) {
    console.error("[apolo][empreendimentos/unidades/bloqueio]", erro);
    return NextResponse.json({ error: "Não foi possível bloquear a unidade." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Bloqueio indisponível." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as null | { unidadeId?: unknown };
  const unidadeId = String(corpo?.unidadeId ?? "").trim();
  if (!unidadeId) {
    return NextResponse.json({ error: "Escolha a unidade." }, { status: 422 });
  }

  try {
    const unidade = await lerUnidadeDoBloqueio(admin, unidadeId);
    if (!unidade) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    const resultado = await desbloquearUnidade(admin, { unidade });
    return resultado.ok
      ? NextResponse.json({ data: resultado.data }, { headers: SEM_CACHE })
      : NextResponse.json(resultado.corpo, { headers: SEM_CACHE, status: resultado.status });
  } catch (erro) {
    console.error("[apolo][empreendimentos/unidades/bloqueio][DELETE]", erro);
    return NextResponse.json({ error: "Não foi possível desbloquear a unidade." }, { status: 500 });
  }
}
