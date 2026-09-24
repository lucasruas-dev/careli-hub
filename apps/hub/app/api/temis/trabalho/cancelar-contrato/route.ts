import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { autorizarCancelamentoDoContrato } from "@/lib/temis/autorizacao";
import {
  apurarCancelamentoDoContrato,
  cancelarContratoDoCard,
} from "@/lib/temis/cancelar-contrato-servico";

// A PORTA DO CANCELAMENTO DE CONTRATO NA TÊMIS.
//
// Lucas (23/09/2026): *"coloca por favor um botão de cancelamento de contrato na temis. o time vai
// precisar cancelar"*.
//
// ⚠️ ROTA PRÓPRIA, E NÃO UMA QUARTA AÇÃO EM `/api/temis/trabalho`. Aquele POST é guardado por
// `autorizarEmissaoDeContrato` (a coordenação: admin + leader, 7 pessoas) e é COMPARTILHADO com
// `/api/incorporador/temis/trabalho`, a porta do portal que confecciona. Pendurar o cancelamento ali
// abriria o ato mais caro da Têmis para as duas plateias pela régua mais larga das duas, e a régua
// certa (nominal, `temis-contrato-editar`) nem existe para quem entra pelo cookie `apolo_inc`. Uma
// rota só do hub é o que deixa a régua ser lida na primeira linha.
//
// ⚠️ SÓ NO HUB, DE PROPÓSITO. Não há espelho desta rota em `/api/incorporador/temis`: a decisão de
// quem cancela é sobre o time da Careli, e o portal continua com o caminho dele (o pedido pela tela
// Venda, que abre o card e deixa a conclusão para o jurídico). A tela de trabalho só oferece o botão
// quando está aberta pela porta do hub.
//
// ⚠️ O GET É A PRÉVIA, E TEM A MESMA RÉGUA DO POST. Ele diz se este contrato vira cancelamento ou
// distrato e se há pedido na fila; quem não pode cancelar não precisa da prévia, e ler a recusa ao
// abrir a confirmação é melhor do que lê-la depois de escrever o motivo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// ⚠️ 60 PORQUE HÁ DUAS CHAMADAS EXTERNAS NO CAMINHO. O POST lê o estado do envelope na Clicksign e
// depois o cancela, e o cliente dela espera até 15 s por chamada
// (`lib/assinatura/clicksign/cliente.ts`). Com 30, uma Clicksign lenta somada às leituras seria
// cortada pela Vercel no pior lugar possível: ninguém saberia se o envelope morreu antes do corte.
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await autorizarCancelamentoDoContrato(request);
  if (!auth.ok) return auth.response;

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  const apuracao = await apurarCancelamentoDoContrato(sb, id);
  if (!apuracao.ok) {
    return NextResponse.json({ erro: apuracao.erro }, { status: apuracao.status });
  }

  return NextResponse.json(
    {
      data: {
        assinaturaCompleta: apuracao.fatos.assinaturaCompleta,
        codigo: apuracao.codigo,
        comoSoube: apuracao.fatos.comoSoube,
        devolveValores: apuracao.classificacao.devolveValores,
        houvePagamento: apuracao.fatos.houvePagamento,
        pedidoAberto: apuracao.pedidoAberto,
        porque: apuracao.classificacao.porque,
        tipo: apuracao.classificacao.tipo,
        vendaDoLegado: apuracao.vendaDoLegado,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await autorizarCancelamentoDoContrato(request);
  if (!auth.ok) return auth.response;

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  const corpo = (await request.json().catch(() => ({}))) as {
    declaracoes?: unknown;
    id?: unknown;
    motivo?: unknown;
  };

  const feito = await cancelarContratoDoCard(sb, {
    declaracoes: corpo.declaracoes,
    motivo: corpo.motivo,
    trabalhoId: String(corpo.id ?? "").trim(),
    usuarioId: auth.userId,
    // ⚠️ O NOME É O DA SESSÃO, e ausente vira nulo — nunca "Sistema". Ele vai para a marca do
    // pedido, para o motivo gravado na venda e para o histórico do card.
    usuarioNome: auth.nome?.trim() || null,
  });

  if (!feito.ok) {
    // ⚠️ `cardDoPedido` VIAJA NA FALHA quando o pedido JÁ nasceu: é o único jeito de a tela mandar o
    // jurídico terminar pelo card em vez de tentar de novo e abrir um segundo pedido.
    return NextResponse.json(
      { cardDoPedido: feito.cardDoPedido ?? null, erro: feito.erro },
      { status: feito.status },
    );
  }

  const { conclusao } = feito;
  const avisos = [...feito.avisos, ...conclusao.avisos];
  return NextResponse.json(
    {
      avisos,
      cardDoPedido: feito.cardDoPedido,
      codigo: conclusao.codigo,
      envelopeCancelado: conclusao.envelopeCancelado,
      ok: true,
      // ⚠️ O RECADO VEM DO MOTOR, e leva o que a tela não tem como saber: se o lote voltou e, se não
      // voltou, por quê. Reescrevê-lo aqui perderia justamente a parte que pede ação.
      recado: [conclusao.recado, ...feito.avisos].filter(Boolean).join(" "),
      tipo: feito.classificacao.tipo,
      unidade: conclusao.unidade,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
