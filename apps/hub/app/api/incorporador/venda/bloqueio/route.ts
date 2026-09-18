import { NextResponse } from "next/server";

import { autorizarOperacaoDeVenda } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { autorizarEscritaNoProduto } from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { conferirBloqueio, type PedidoDeBloqueio } from "@/lib/hercules/bloqueio-de-unidade";
import {
  bloquearUnidade,
  desbloquearUnidade,
  lerUnidadeDoBloqueio,
} from "@/lib/hercules/bloquear-unidade-server";

// O BLOQUEIO DA UNIDADE — o coordenador tira um lote da venda, com o motivo escrito.
//
// Lucas (14/09/2026): *"o coordenador pode bloquear as unidades (...) ter um campo de justificativa
// do bloqueio"* · *"não pode ter nenhuma proposta, reserva, contrato, o bloqueio aparece somente
// quando não há nada na unidade. se tiver uma reserva, primeiro ele cancela a reserva para depois
// bloquear o lote"*.
//
// ⚠️ A REGRA NÃO MORA MAIS AQUI (18/09/2026). O Apolo ganhou o mesmo botão (Lucas: *"eu posso por
// exemplo, bloquear uma unidade dentro do apolo e isso tem que refletir no hercules"*), e as duas
// portas chamam lib/hercules/bloquear-unidade-server.ts: só bloqueia lote livre pela régua única,
// com UPDATE condicional; só desbloqueia bloqueio feito no Panteon, com a régua dizendo `bloqueada`
// e sem outro dono no terreno. Esta rota ficou com o que é SÓ do portal: a sessão e o escopo.
//
// ⚠️ `autorizarOperacaoDeVenda`, E NUNCA `autorizar`. A diferença já foi paga em produção:
// `autorizar` não olha o TIPO do portal, e por isso um usuário de portal de INCORPORADOR chegou a
// cancelar proposta do comercial. São 35 portais de incorporador contra 3 do comercial — usar o
// gate errado aqui daria a 35 donos de loteamento o poder de tirar lote da venda. A porta aceita o
// comercial e SÓ os incorporadores da lista explícita que operam a própria venda (o Cecílio,
// Lucas em 16/09/2026); os demais seguem recebendo 404.
//
// ⚠️ E O ESCOPO VEM DO COOKIE, NUNCA DO CORPO. O `unidadeId` do POST é conferido contra
// `idsDaSessao`; unidade de fora responde 404, e não 403 — a resposta não pode diferenciar "não é
// seu" de "não existe".

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Bloqueio indisponível." }, { status: 503 });
  }

  let corpo: { detalhe?: string; motivo?: string; unidadeId?: string } = {};
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const pedido: PedidoDeBloqueio = {
    detalhe: String(corpo.detalhe ?? "").trim(),
    motivo: String(corpo.motivo ?? "").trim(),
    unidadeId: String(corpo.unidadeId ?? "").trim(),
  };

  // A MESMA régua da tela, antes de qualquer leitura: pedido mal formado nem chega ao banco.
  const erros = conferirBloqueio(pedido);
  if (erros.length > 0) {
    return NextResponse.json({ erros }, { status: 422 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));

    const unidade = await lerUnidadeDoBloqueio(admin, pedido.unidadeId);
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // ⚠️ QUEM OPERA O PRODUTO DECIDE A ESCRITA (Lucas, 16/09/2026). No portal que confecciona (o
    // Cecílio) bloquear só vale no produto operado por ele; no VOC e no VOR é 403 só consulta. A
    // Gurgel passa sem ida ao banco. Antes de qualquer conferência que só serve a quem pode gravar.
    const escrita = await autorizarEscritaNoProduto(request, auth.sessao, [unidade.enterprise_id]);
    if (!escrita.ok) return escrita.response;

    const resultado = await bloquearUnidade(admin, {
      autor: { id: escrita.sessao.usuarioId, nome: escrita.sessao.usuarioNome },
      pedido,
      unidade,
    });
    return resultado.ok
      ? NextResponse.json({ data: resultado.data })
      : NextResponse.json(resultado.corpo, { status: resultado.status });
  } catch (erro) {
    console.error("[incorporador][bloqueio]", erro);
    return NextResponse.json({ error: "Não foi possível bloquear a unidade." }, { status: 500 });
  }
}

/**
 * DESBLOQUEAR — o lote volta ao estoque.
 *
 * ⚠️ ISTO NÃO FOI PEDIDO NO COMEÇO, E FOI CONSTRUÍDO MESMO ASSIM. Bloquear sem desbloquear cria um
 * estado que só sai com SQL na mão: o coordenador que errar o lote fica sem caminho na tela, e o
 * primeiro engano vira chamado. As três provas que a volta exige estão em `desbloquearUnidade`.
 */
export async function DELETE(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Bloqueio indisponível." }, { status: 503 });
  }

  let corpo: { unidadeId?: string } = {};
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const unidadeId = String(corpo.unidadeId ?? "").trim();
  if (!unidadeId) {
    return NextResponse.json({ error: "Escolha a unidade." }, { status: 422 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));

    const unidade = await lerUnidadeDoBloqueio(admin, unidadeId);
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // A mesma régua do bloqueio: devolver o lote ao estoque também é escrita.
    const escrita = await autorizarEscritaNoProduto(request, auth.sessao, [unidade.enterprise_id]);
    if (!escrita.ok) return escrita.response;

    const resultado = await desbloquearUnidade(admin, { unidade });
    return resultado.ok
      ? NextResponse.json({ data: resultado.data })
      : NextResponse.json(resultado.corpo, { status: resultado.status });
  } catch (erro) {
    console.error("[incorporador][bloqueio][DELETE]", erro);
    return NextResponse.json(
      { error: "Não foi possível desbloquear a unidade." },
      { status: 500 },
    );
  }
}
