import { NextResponse } from "next/server";

import { autorizarComercial } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import { nomeDaUnidade } from "@/lib/hercules/nome-da-unidade";
import { classificarCancelamento } from "@/lib/temis/cancelamento";
import { abrirTrabalho } from "@/lib/temis/trabalhos-db";

// O PEDIDO DE CANCELAMENTO DEPOIS QUE A VENDA FOI PARA CONTRATO.
//
// ⚠️ ATÉ AQUI, A VENDA EM `contrato` NÃO TINHA SAÍDA NENHUMA na tela: os quatro botões da ficha
// aparecem apagados, e quem despachou por engano — ou cujo cliente desistiu depois — ficava com o
// lote preso, sem um botão sequer.
//
// ⚠️ ISTO NÃO CANCELA NADA: ABRE UM PEDIDO. Depois do contrato despachado, quem desfaz é o
// jurídico, e o instrumento depende de fatos do contrato (assinou? pagou?), não da vontade de quem
// clica. `classificarCancelamento` (lib/temis/cancelamento.ts) é quem decide entre cancelamento
// simples e distrato com devolução — regra do Lucas em 02/09/2026: *"o botão que vamos ter é de
// cancelamento; o sistema vai ter que identificar se aquele cancelamento vai precisar de um
// distrato ou não"*.
//
// ⚠️ E A ETAPA DA VENDA NÃO SE MEXE. Marcar `cancelado` aqui devolveria o lote ao estoque com um
// contrato ainda de pé do outro lado, e a unidade poderia ser vendida duas vezes. A venda continua
// em contrato até a Têmis concluir — o que fica é o CARIMBO do pedido, que é o que impede o segundo
// card e o que a tela lê para trocar o botão.
//
// ⚠️ OS DOIS FATOS SÃO DECLARADOS, E ISSO ESTÁ DITO NA TELA. Não existe fonte confiável deles no
// Panteon: `hercules_proposta_eventos` só é escrita pela carga do C2X (a venda nativa nasce com
// zero eventos, por construção) e mente por omissão até no legado — são 1.979 propostas `faturado`
// com apenas 914 tendo evento de pagamento. Adivinhar a partir daí classificaria como
// "cancelamento" um contrato pago, que é justamente o caso com dinheiro do cliente no meio.
// Perguntar a quem está com o processo na mão é menos elegante e mais honesto; o jurídico confere
// depois, e o pedido registra quem respondeu o quê.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE = "careli";

/** As etapas em que o desfazer já é do jurídico. A mesma lista de `acao-de-cancelamento.ts`. */
const DEPOIS_DO_CONTRATO = ["assinatura", "contrato", "faturado"];

export async function POST(request: Request) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  let corpo: {
    assinaturaCompleta?: unknown;
    houvePagamento?: unknown;
    motivo?: unknown;
    unidadeId?: unknown;
  };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const unidadeId = String(corpo.unidadeId ?? "").trim();
  const motivo = String(corpo.motivo ?? "").trim();
  if (!unidadeId) {
    return NextResponse.json({ error: "Unidade não informada." }, { status: 400 });
  }
  // ⚠️ O MOTIVO É OBRIGATÓRIO, como no cancelamento da proposta. É a única frase que explica ao
  // jurídico por que este contrato está sendo desfeito, e ela vira o texto do card na fila.
  if (motivo.length < 3) {
    return NextResponse.json({ error: "Diga o motivo do cancelamento." }, { status: 422 });
  }
  // ⚠️ AS DUAS RESPOSTAS SÃO OBRIGATÓRIAS E BOOLEANAS. `undefined` virando `false` classificaria
  // como cancelamento simples um contrato assinado e pago — o caso que exige distrato e devolução.
  if (typeof corpo.assinaturaCompleta !== "boolean" || typeof corpo.houvePagamento !== "boolean") {
    return NextResponse.json(
      { error: "Responda as duas perguntas sobre o contrato." },
      { status: 422 },
    );
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));
    const { data: linhaDaUnidade } = await admin
      .from("hercules_unidades")
      .select("id,codigo,quadra,lote,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidadeId)
      .maybeSingle();

    const unidade = linhaDaUnidade as null | {
      codigo: string;
      enterprise_id: string;
      id: string;
      lote: null | string;
      quadra: null | string;
    };
    // Fora do escopo responde como inexistente: o 403 não pode virar oráculo de "existe, mas não é
    // sua" — a mesma regra das irmãs.
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    const { data: linhaDaProposta } = await admin
      .from("hercules_propostas")
      .select(
        "id,codigo,protocolo_numero,cliente_nome,cliente_documento,etapa,empreendimento_codigo,empreendimento_id,cancelamento_pedido_em",
      )
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidade.id)
      .eq("origem", "panteon")
      .is("cancelada_em", null)
      .in("etapa", DEPOIS_DO_CONTRATO)
      .maybeSingle();

    const proposta = linhaDaProposta as null | {
      cancelamento_pedido_em: null | string;
      cliente_documento: null | string;
      cliente_nome: null | string;
      codigo: null | string;
      empreendimento_codigo: null | string;
      empreendimento_id: null | string;
      etapa: string;
      id: string;
      protocolo_numero: null | number;
    };
    if (!proposta) {
      return NextResponse.json(
        { error: "Esta unidade não tem contrato do Panteon para cancelar." },
        { status: 409 },
      );
    }
    if (proposta.cancelamento_pedido_em) {
      return NextResponse.json(
        { error: "Já existe um pedido de cancelamento na Têmis para esta venda." },
        { status: 409 },
      );
    }

    const classificacao = classificarCancelamento({
      assinaturaCompleta: corpo.assinaturaCompleta,
      houvePagamento: corpo.houvePagamento,
    });
    const agora = new Date().toISOString();
    const cod = proposta.codigo || codigoDaVenda(proposta.protocolo_numero) || "—";

    // ⚠️ O CARIMBO VEM ANTES DA TÊMIS, e com a condição `is null` na própria escrita: é ele que
    // impede o segundo card. Dois cliques rápidos no mesmo botão — o caso real de quem não vê a
    // tela responder — abririam dois pedidos para o mesmo contrato, e quem lê o board não teria
    // como saber qual dos dois vale.
    const { data: carimbadas } = await admin
      .from("hercules_propostas")
      .update({
        atualizado_em: agora,
        cancelamento_pedido_em: agora,
        cancelamento_pedido_por: auth.sessao.usuarioNome ?? null,
        cancelamento_pedido_tipo: classificacao.tipo,
      })
      .eq("id", proposta.id)
      .is("cancelamento_pedido_em", null)
      // ⚠️ SEM O `.select()` A CONTAGEM NÃO EXISTE: o PostgREST devolve zero linhas com sucesso, e
      // o segundo clique passaria por "gravou" sem ter gravado nada.
      .select("id");

    if (!carimbadas || carimbadas.length === 0) {
      return NextResponse.json(
        { error: "Já existe um pedido de cancelamento na Têmis para esta venda." },
        { status: 409 },
      );
    }

    const cadastro = await carregarCadastroDeEmpreendimentos().catch(() => []);
    const doCadastro =
      cadastro.find((l) => l.id === proposta.empreendimento_id) ??
      cadastro.find((l) => String(l.c2xEnterpriseId) === String(unidade.enterprise_id)) ??
      null;

    let trabalhoId: null | string = null;
    let avisoDaTemis: null | string = null;
    try {
      const aberto = await abrirTrabalho({
        abertoPor: auth.sessao.usuarioId,
        canal: "hercules",
        clienteCpf: proposta.cliente_documento,
        clienteNome: proposta.cliente_nome || "Cliente",
        empreendimentoCodigo: proposta.empreendimento_codigo || doCadastro?.codigo || "—",
        empreendimentoId: String(unidade.enterprise_id),
        empreendimentoNome: doCadastro?.nome || "Empreendimento",
        // ⚠️ AS RESPOSTAS VÃO ESCRITAS NO CARD. O jurídico precisa saber em cima de que fatos a
        // classificação foi feita — e de quem eles vieram — para conferir antes de redigir.
        observacao: `Pedido de cancelamento pela tela Venda do Hércules · COD ${cod} · motivo: ${motivo} · assinatura completa: ${
          corpo.assinaturaCompleta ? "sim" : "não"
        } · houve pagamento: ${corpo.houvePagamento ? "sim" : "não"} · ${classificacao.porque}`,
        propostaId: proposta.id,
        tipo: classificacao.tipo,
        unidade: nomeDaUnidade(unidade),
      });

      if (aberto.ok) trabalhoId = aberto.id;
      else {
        avisoDaTemis = aberto.erro;
        console.error("[hercules][cancelamento] a Têmis recusou o pedido", aberto.erro);
      }
    } catch (erro) {
      avisoDaTemis = "não foi possível abrir o pedido na Têmis";
      console.error("[hercules][cancelamento] falha ao abrir o pedido na Têmis", erro);
    }

    // ⚠️ O CARIMBO VOLTA ATRÁS QUANDO A TÊMIS NÃO RECEBEU. Aqui, ao contrário do envio para
    // contrato, não há nada feito do outro lado: sem card, o pedido não existe, e deixar a marca de
    // pé travaria o botão para sempre num contrato sem pedido nenhum na fila.
    if (!trabalhoId) {
      await admin
        .from("hercules_propostas")
        .update({
          cancelamento_pedido_em: null,
          cancelamento_pedido_por: null,
          cancelamento_pedido_tipo: null,
        })
        .eq("id", proposta.id);

      return NextResponse.json(
        {
          error: `O pedido não chegou à Têmis${
            avisoDaTemis ? ` (${avisoDaTemis})` : ""
          }. Nada foi registrado; avise o jurídico.`,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      data: {
        codigo: cod,
        devolveValores: classificacao.devolveValores,
        porque: classificacao.porque,
        tipo: classificacao.tipo,
        trabalhoId,
      },
    });
  } catch (erro) {
    console.error("[hercules][cancelamento] falha ao pedir o cancelamento", erro);
    return NextResponse.json(
      { error: "Não foi possível pedir o cancelamento agora." },
      { status: 503 },
    );
  }
}
