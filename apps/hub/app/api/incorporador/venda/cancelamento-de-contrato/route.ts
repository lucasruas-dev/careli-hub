import { NextResponse } from "next/server";

import { autorizarOperacaoDeVenda } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { autorizarEscritaNoProduto } from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { portalConfeccionaContrato } from "@/lib/apolo/incorporador/perfis-de-portal";
import type { SessaoIncorporador } from "@/lib/apolo/incorporador/sessao";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import { lerComColunasDoApartamento, nomeDaUnidade } from "@/lib/hercules/nome-da-unidade";
import { lerFatosDoContrato } from "@/lib/hercules/fatos-do-contrato-server";
import { classificarCancelamento } from "@/lib/temis/cancelamento";
import { rotuloDoMotivo } from "@/lib/temis/indeferimento";
import {
  MOVIMENTO_CANCELAMENTO_INDEFERIDO,
  MOVIMENTO_DISTRATO_INDEFERIDO,
  MOVIMENTO_PEDIDO_DE_CANCELAMENTO,
  MOVIMENTO_PEDIDO_DE_DISTRATO,
} from "@/lib/hercules/indeferimento-na-venda-server";
import { marcaEhResto } from "@/lib/hercules/marca-de-pedido";
import { cardsAbertosDaProposta } from "@/lib/temis/cards-abertos-db";
import { abrirTrabalho, ehColunaDoDonoAusente } from "@/lib/temis/trabalhos-db";

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
// ⚠️ OS DOIS FATOS QUEM APURA É O SERVIDOR, e não quem clica. Lucas (06/09/2026), vendo a primeira
// versão perguntar: *"essas informações do cancelamento de contrato é o sistema que tem que saber e
// dar opção com base nisso, não é o usuário que faz"*. A apuração está em
// `lib/hercules/fatos-do-contrato.ts` e lê o que está gravado: eventos de assinatura e de pagamento
// da proposta, mais as datas dela. Zero eventos numa venda que nasceu aqui NÃO é ignorância — é
// resposta, e o GET desta rota devolve a apuração para a tela mostrar antes de confirmar.
//
// ⚠️ E O AJUSTE MANUAL EXISTE, MAS É EXCEÇÃO DECLARADA. Pagamento por fora do sistema (PIX na mão
// do corretor) não deixa rastro nenhum aqui, e classificar como cancelamento simples um caso com
// dinheiro do cliente é o erro caro. Quem ajusta assume: o pedido grava que a classificação foi
// corrigida à mão, e o card da Têmis diz isso em letras claras para o jurídico conferir.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE = "careli";

/** As etapas em que o desfazer já é do jurídico. A mesma lista de `acao-de-cancelamento.ts`. */
const DEPOIS_DO_CONTRATO = ["assinatura", "contrato", "faturado"];

/**
 * O QUE O SISTEMA SABE, para a tela mostrar antes de perguntar qualquer coisa.
 *
 * ⚠️ ELE NÃO DECIDE NADA — só conta. Quem grava é o POST, que refaz a apuração no momento da
 * escrita: entre abrir a modal e confirmar pode entrar um pagamento, e a classificação que vale é a
 * do instante em que o pedido nasce.
 */
export async function GET(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  const unidadeId = (new URL(request.url).searchParams.get("unidade") ?? "").trim();
  if (!unidadeId) {
    return NextResponse.json({ error: "Unidade não informada." }, { status: 400 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));
    const { data: linhaDaUnidade } = await admin
      .from("hercules_unidades")
      .select("id,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidadeId)
      .maybeSingle();

    const unidade = linhaDaUnidade as null | { enterprise_id: string; id: string };
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    const { data: linha, error } = await admin
      .from("hercules_propostas")
      .select("id,data_assinatura,data_ato,data_faturamento")
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidade.id)
      .is("cancelada_em", null)
      .in("etapa", DEPOIS_DO_CONTRATO)
      .order("etapa_desde", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    const proposta = linha as null | {
      data_assinatura: null | string;
      data_ato: null | string;
      data_faturamento: null | string;
      id: string;
    };
    if (!proposta) {
      return NextResponse.json(
        { error: "Esta unidade não tem contrato para cancelar." },
        { status: 409 },
      );
    }

    const fatos = await lerFatosDoContrato(admin, proposta);
    const classificacao = classificarCancelamento(fatos);

    return NextResponse.json({
      data: {
        assinaturaCompleta: fatos.assinaturaCompleta,
        comoSoube: fatos.comoSoube,
        devolveValores: classificacao.devolveValores,
        houvePagamento: fatos.houvePagamento,
        porque: classificacao.porque,
        tipo: classificacao.tipo,
      },
    });
  } catch (erro) {
    console.error("[hercules][cancelamento] falha ao apurar os fatos", erro);
    return NextResponse.json(
      { error: "Não foi possível apurar a situação deste contrato agora." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  let corpo: {
    /** A correção manual, quando o coordenador diz que a apuração não bate. */
    ajuste?: unknown;
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

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));
    // As colunas do prédio (0171) entram porque é desta linha que sai o nome da unidade no card do
    // pedido ("Torre A · Apto 304"); sem a 0171 a leitura repete sem elas.
    const { data: linhaDaUnidade } = await lerComColunasDoApartamento((extras) =>
      admin
        .from("hercules_unidades")
        .select(`id,codigo,quadra,lote,enterprise_id${extras}`)
        .eq("workspace_id", WORKSPACE)
        .eq("id", unidadeId)
        .maybeSingle(),
    );

    const unidade = linhaDaUnidade as unknown as null | {
      apartamento?: null | string;
      codigo: string;
      enterprise_id: string;
      id: string;
      lote: null | string;
      quadra: null | string;
      torre?: null | string;
    };
    // Fora do escopo responde como inexistente: o 403 não pode virar oráculo de "existe, mas não é
    // sua" — a mesma regra das irmãs.
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // ⚠️ QUEM OPERA O PRODUTO DECIDE A ESCRITA (Lucas, 16/09/2026). Pedir cancelamento abre card e
    // carimba a proposta: no portal que confecciona (o Cecílio) só vale no produto operado por ele;
    // no VOC e no VOR é 403 só consulta. A Gurgel passa sem ida ao banco. Antes do carimbo.
    const escrita = await autorizarEscritaNoProduto(request, auth.sessao, [unidade.enterprise_id]);
    if (!escrita.ok) return escrita.response;
    const sessao = escrita.sessao;

    // ⚠️ O ERRO DO SELECT NÃO PODE VIRAR 409. Descartá-lo faz uma falha de banco (coluna que não
    // existe, tabela indisponível) chegar ao coordenador como "esta unidade não tem contrato do
    // Panteon para cancelar" — uma frase que ele acredita, porque é plausível, e que o manda
    // procurar o problema no lugar errado.
    const { data: linhaDaProposta, error: erroDaProposta } = await admin
      .from("hercules_propostas")
      .select(
        "id,codigo,protocolo_numero,cliente_nome,cliente_documento,etapa,empreendimento_codigo,empreendimento_id,cancelamento_pedido_em,data_assinatura,data_ato,data_faturamento,origem",
      )
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidade.id)
      .is("cancelada_em", null)
      .in("etapa", DEPOIS_DO_CONTRATO)
      // ⚠️ A MAIS RECENTE, E UMA SÓ. `maybeSingle()` sobre duas linhas vivas lança, e a unidade que
      // já teve venda desfeita e refeita pode ter mais de uma: sem ordem, o erro chegaria como
      // "não foi possível" numa tela que mostra o contrato na cara de quem clicou.
      .order("etapa_desde", { ascending: false })
      .limit(1)
      .maybeSingle();

    const proposta = linhaDaProposta as null | {
      cancelamento_pedido_em: null | string;
      cliente_documento: null | string;
      cliente_nome: null | string;
      codigo: null | string;
      data_assinatura: null | string;
      data_ato: null | string;
      data_faturamento: null | string;
      empreendimento_codigo: null | string;
      empreendimento_id: null | string;
      etapa: string;
      id: string;
      origem: null | string;
      protocolo_numero: null | number;
    };
    if (erroDaProposta) throw new Error(erroDaProposta.message);
    if (!proposta) {
      return NextResponse.json(
        { error: "Esta unidade não tem contrato para cancelar." },
        { status: 409 },
      );
    }
    if (proposta.cancelamento_pedido_em) {
      // ⚠️ A MARCA SEM CARD ABERTO É RESTO, E NÃO PEDIDO (revisão de 18/09/2026). Ela fica quando o
      // pedido foi indeferido antes de o indeferimento limpar a marca (VOL1106 e VOC0306, 17/09/2026)
      // ou quando a limpeza falhou: a venda ficava presa para sempre, com a tela dizendo "Já existe
      // um pedido" sobre um pedido que ninguém mais anda. Sem card de pedido aberto, a história do
      // pedido antigo vai para a venda (como o indeferimento faz), a marca sai e o pedido novo segue.
      const resto = await limparMarcaOrfa(admin, proposta.id, proposta.cancelamento_pedido_em);
      if (resto === "tem_pedido_aberto") {
        return NextResponse.json(
          { error: "Já existe um pedido de cancelamento na Têmis para esta venda." },
          { status: 409 },
        );
      }
      if (resto === "falhou") {
        return NextResponse.json(
          { error: "Não foi possível conferir o pedido antigo desta venda. Nada foi registrado; tente de novo." },
          { status: 503 },
        );
      }
    }

    // ⚠️ A APURAÇÃO É REFEITA AQUI, mesmo com o GET já tendo respondido à tela: entre abrir a modal
    // e confirmar pode entrar um pagamento, e é a apuração do momento da gravação que vale. O corpo
    // não manda mais os fatos — quando ele traz `ajuste`, é uma correção declarada, não a fonte.
    const fatos = await lerFatosDoContrato(admin, proposta);
    const comAjuste = ajusteDoCorpo(corpo.ajuste);
    const classificacao = classificarCancelamento(comAjuste ?? fatos);
    const agora = new Date().toISOString();
    const cod = proposta.codigo || codigoDaVenda(proposta.protocolo_numero) || "—";

    // ⚠️ O CARIMBO VEM ANTES DA TÊMIS, e com a condição `is null` na própria escrita: é ele que
    // impede o segundo card. Dois cliques rápidos no mesmo botão — o caso real de quem não vê a
    // tela responder — abririam dois pedidos para o mesmo contrato, e quem lê o board não teria
    // como saber qual dos dois vale.
    const { data: carimbadas, error: erroDoCarimbo } = await admin
      .from("hercules_propostas")
      .update({
        atualizado_em: agora,
        cancelamento_pedido_em: agora,
        cancelamento_pedido_motivo: motivo,
        cancelamento_pedido_por: sessao.usuarioNome ?? null,
        cancelamento_pedido_tipo: classificacao.tipo,
      })
      .eq("id", proposta.id)
      .is("cancelamento_pedido_em", null)
      // ⚠️ SEM O `.select()` A CONTAGEM NÃO EXISTE: o PostgREST devolve zero linhas com sucesso, e
      // o segundo clique passaria por "gravou" sem ter gravado nada.
      .select("id");

    // ⚠️ FALHA DE ESCRITA NÃO É "JÁ EXISTE". Zero linhas por causa do `is null` significa que outro
    // clique chegou primeiro; zero linhas por causa de um erro do banco significa outra coisa
    // completamente — e mandar "já existe um pedido" faria o coordenador procurar na fila do
    // jurídico um card que ninguém abriu.
    if (erroDoCarimbo) throw new Error(erroDoCarimbo.message);
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
      // ⚠️ O CARD PODE JÁ EXISTIR SEM O CARIMBO. Se numa tentativa anterior o insert commitou e a
      // resposta se perdeu (timeout, cold start), o carimbo foi desfeito e o trabalho FICOU na
      // fila: abrir outro daria dois pedidos para o mesmo contrato, com o jurídico sem saber qual
      // vale. Procurar antes custa uma leitura e fecha a única janela que o rollback não fecha.
      //
      // ⚠️ "ABERTO" É FORA DE `faturado` E DE `indeferido` (18/09/2026). A procura antiga excluía
      // `finalizado`, um estágio que não existe mais desde a 0150: todo card antigo contava como
      // aberto, inclusive o INDEFERIDO. Com o indeferimento passando a limpar o carimbo (o pedido
      // recusado devolve a venda a quem pediu), o pedido novo acharia o card indeferido, responderia
      // "já existia" e não abriria card nenhum: carimbo de pé, fila vazia, venda presa de novo.
      // A régua mora em `cardsAbertosDaProposta`, a mesma que a conclusão e o indeferimento usam.
      const jaNaFila = await cardsAbertosDaProposta(admin, {
        propostaId: proposta.id,
        tipos: ["cancelamento", "distrato"],
      });
      // Leitura que falhou não vira "não há card": o carimbo é desfeito logo abaixo, e a tela diz
      // que o pedido não chegou, para ninguém abrir o segundo card de um pedido que pode existir.
      if (!jaNaFila.ok) throw new Error("não foi possível conferir se o pedido já estava na fila");

      const antigo = jaNaFila.cards[0];
      if (antigo) {
        return NextResponse.json({
          data: {
            codigo: cod,
            devolveValores: classificacao.devolveValores,
            jaExistia: true,
            porque: classificacao.porque,
            tipo: classificacao.tipo,
            trabalhoId: antigo.id,
          },
        });
      }

      // ⚠️ O DONO DO PEDIDO É O DO CONTRATO (Lucas, 16/09/2026). Quem desfaz é quem fez: ver
      // `donoDoPedido`. Lido aqui dentro, e não antes do carimbo, para uma falha de leitura cair no
      // mesmo desfazer do carimbo que uma recusa da Têmis.
      const operadoPor = await donoDoPedido(admin, proposta.id, sessao);

      const aberto = await abrirTrabalho({
        abertoPor: sessao.usuarioId,
        canal: "hercules",
        clienteCpf: proposta.cliente_documento,
        clienteNome: proposta.cliente_nome || "Cliente",
        empreendimentoCodigo: proposta.empreendimento_codigo || doCadastro?.codigo || "—",
        empreendimentoId: String(unidade.enterprise_id),
        empreendimentoNome: doCadastro?.nome || "Empreendimento",
        // ⚠️ O CARD DIZ DE ONDE VIERAM OS FATOS. O jurídico precisa conferir a classificação antes
        // de redigir, e a diferença entre "o sistema apurou" e "alguém corrigiu à mão" é
        // exatamente o que ele vai querer olhar primeiro.
        observacao: `Pedido de cancelamento pela tela Venda do Hércules · COD ${cod} · motivo: ${motivo} · ${
          comAjuste
            ? `AJUSTE MANUAL de ${sessao.usuarioNome ?? "quem pediu"}: assinatura completa: ${
                comAjuste.assinaturaCompleta ? "sim" : "não"
              }, houve pagamento: ${comAjuste.houvePagamento ? "sim" : "não"} (o sistema apurou: ${
                fatos.comoSoube.assinatura
              }, ${fatos.comoSoube.pagamento})`
            : `apurado pelo sistema: ${fatos.comoSoube.assinatura}, ${fatos.comoSoube.pagamento}`
        } · ${classificacao.porque}${
          // ⚠️ A VENDA DO C2X TAMBÉM SE CANCELA AQUI (Lucas, 16/09/2026: *"será feito aqui"* e *"não
          // precisa fazer nada no c2x, se precisar o time faz manualmente"*). O Panteon não escreve no
          // legado; o card avisa, para o jurídico decidir se o C2X precisa de ajuste à mão.
          proposta.origem === "c2x"
            ? " · VENDA IMPORTADA DO C2X: o Panteon não altera o legado; se precisar, o ajuste lá é manual"
            : ""
        }`,
        operadoPor,
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
      // ⚠️ O DESFAZER TAMBÉM SE CONFERE. Sem `.select()` e sem olhar o `error`, um rollback que não
      // acontece passa por feito — e o carimbo fica de pé apontando um pedido que não existe,
      // travando o botão PARA SEMPRE numa venda sem card nenhum na fila. A frase muda conforme o
      // que de fato ficou no banco: mandar "nada foi registrado" quando o carimbo sobreviveu faria
      // o coordenador tentar de novo contra uma trava que ele não vê.
      const { data: limpas, error: erroDoDesfazer } = await admin
        .from("hercules_propostas")
        .update({
          cancelamento_pedido_em: null,
          cancelamento_pedido_motivo: null,
          cancelamento_pedido_por: null,
          cancelamento_pedido_tipo: null,
        })
        .eq("id", proposta.id)
        // ⚠️ SÓ A MARCA DESTE PEDIDO (revisão de 18/09/2026): a que esta chamada gravou, e não a de
        // um pedido que tenha entrado depois dela.
        .eq("cancelamento_pedido_em", agora)
        .select("id");

      const desfeito = !erroDoDesfazer && (limpas?.length ?? 0) > 0;
      if (!desfeito) {
        console.error("[hercules][cancelamento] o carimbo do pedido ficou de pé", {
          erro: erroDoDesfazer?.message ?? null,
          proposta: proposta.id,
        });
      }

      return NextResponse.json(
        {
          error: `O pedido não chegou à Têmis${avisoDaTemis ? ` (${avisoDaTemis})` : ""}. ${
            desfeito
              ? "Nada foi registrado; avise o jurídico."
              : "A marca do pedido ficou registrada: o botão volta a aceitar o pedido em 15 minutos. Avise o jurídico; se o botão não voltar, avise o time do Panteon."
          }`,
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

/**
 * A marca de pedido que ficou sem card aberto: grava a história do pedido antigo e limpa a marca.
 *
 * ⚠️ A HISTÓRIA ANTES DA LIMPEZA, como no indeferimento: a ficha do lote tira "Cancelamento
 * solicitado" da marca, e limpá-la sem gravar o fato apagaria da ficha quem pediu e por quê. A
 * recusa vem do card indeferido mais recente, quando há um.
 *
 * ⚠️ A LIMPEZA É CONDICIONAL À MARCA LIDA (`eq`): se outro clique já limpou e remarcou, nada se
 * mexe, e o carimbo do pedido novo (`is null`, mais abaixo) decide quem ficou.
 */
async function limparMarcaOrfa(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  propostaId: string,
  marca: string,
): Promise<"falhou" | "limpa" | "tem_pedido_aberto"> {
  const abertos = await cardsAbertosDaProposta(admin, {
    propostaId,
    tipos: ["cancelamento", "distrato"],
  });
  if (!abertos.ok) return "falhou";
  if (abertos.cards.length > 0) return "tem_pedido_aberto";
  // ⚠️ A MARCA QUE ACABOU DE NASCER AINDA NÃO TEM CARD (18/09/2026): a própria rota grava a marca
  // antes de criar o card. Um segundo clique nesse intervalo leria "sem card", limparia a marca do
  // pedido em curso e abriria o segundo card. Ver `lib/hercules/marca-de-pedido.ts`.
  if (!marcaEhResto({ agora: new Date(), cardsAbertos: abertos.cards.length, marca })) {
    return "tem_pedido_aberto";
  }

  const { data: venda, error: erroDaVenda } = await admin
    .from("hercules_propostas")
    .select("cancelamento_pedido_motivo, cancelamento_pedido_por, cancelamento_pedido_tipo")
    .eq("id", propostaId)
    .maybeSingle<{
      cancelamento_pedido_motivo: null | string;
      cancelamento_pedido_por: null | string;
      cancelamento_pedido_tipo: null | string;
    }>();
  if (erroDaVenda || !venda) return "falhou";

  const { data: indeferidos, error: erroDoCard } = await admin
    .from("temis_trabalhos")
    .select("indeferido_em, indeferido_motivo, indeferido_observacao, indeferido_por_nome")
    .eq("workspace_id", WORKSPACE)
    .eq("proposta_id", propostaId)
    .in("tipo", ["cancelamento", "distrato"])
    .eq("estagio", "indeferido")
    .order("indeferido_em", { ascending: false })
    .limit(1);
  if (erroDoCard) return "falhou";
  const recusa = ((indeferidos ?? []) as Array<{
    indeferido_em: null | string;
    indeferido_motivo: null | string;
    indeferido_observacao: null | string;
    indeferido_por_nome: null | string;
  }>)[0];

  const distrato = String(venda.cancelamento_pedido_tipo ?? "").trim() === "distrato";
  const movimentos: Record<string, unknown>[] = [
    {
      autor_nome: venda.cancelamento_pedido_por,
      de: null,
      motivo: venda.cancelamento_pedido_motivo,
      observacao: null,
      para: distrato ? MOVIMENTO_PEDIDO_DE_DISTRATO : MOVIMENTO_PEDIDO_DE_CANCELAMENTO,
      proposta_id: propostaId,
      quando: marca,
      workspace_id: WORKSPACE,
    },
  ];
  if (recusa?.indeferido_em) {
    movimentos.push({
      autor_nome: recusa.indeferido_por_nome,
      de: null,
      motivo: recusa.indeferido_motivo ? rotuloDoMotivo(recusa.indeferido_motivo) : null,
      observacao: recusa.indeferido_observacao,
      para: distrato ? MOVIMENTO_DISTRATO_INDEFERIDO : MOVIMENTO_CANCELAMENTO_INDEFERIDO,
      proposta_id: propostaId,
      quando: recusa.indeferido_em,
      workspace_id: WORKSPACE,
    });
  }
  const { error: erroDaHistoria } = await admin.from("hercules_proposta_etapas").insert(movimentos);
  if (erroDaHistoria) {
    console.error("[hercules][cancelamento] a história do pedido antigo não foi gravada", erroDaHistoria);
    return "falhou";
  }

  const { error: erroDaLimpeza } = await admin
    .from("hercules_propostas")
    .update({
      cancelamento_pedido_em: null,
      cancelamento_pedido_motivo: null,
      cancelamento_pedido_por: null,
      cancelamento_pedido_tipo: null,
    })
    .eq("id", propostaId)
    .eq("cancelamento_pedido_em", marca);
  if (erroDaLimpeza) {
    console.error("[hercules][cancelamento] a marca órfã não saiu", erroDaLimpeza);
    return "falhou";
  }
  return "limpa";
}

/**
 * De quem é o card do pedido de cancelamento: o MESMO dono do card de contrato desta proposta.
 *
 * ⚠️ HERDA, E NÃO SAI DE QUEM CLICA. Lucas (16/09/2026): quem confecciona o contrato é quem
 * confecciona o distrato. Se a Gurgel vendeu (card de contrato na fila da Careli, dono nulo) e o
 * time do Cecílio pede o cancelamento, o distrato continua com a Careli; se o contrato é do Cecílio,
 * o distrato também é. Tirar o dono da sessão de quem clicou mandaria um distrato para quem nunca viu
 * o contrato.
 *
 *   • achou o card de contrato → o `operado_por` dele (nulo = Careli);
 *   • a coluna `operado_por` ainda não existe (migration 0172) → nulo: sem a coluna não há dono
 *     nenhum para herdar, e o card nasce na fila da Careli como todo card nascia;
 *   • não há card de contrato (a Têmis recusou lá atrás) → a regra da origem: o portal que
 *     confecciona é dono do que pede, o comercial é Careli.
 *
 * Qualquer outro erro de leitura LANÇA: adivinhar o dono aqui seria escolher a fila de um distrato no
 * escuro.
 */
async function donoDoPedido(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  propostaId: string,
  sessao: Pick<SessaoIncorporador, "incorporadorId" | "slug" | "tipo">,
): Promise<null | string> {
  const { data, error } = await admin
    .from("temis_trabalhos")
    .select("operado_por")
    .eq("workspace_id", WORKSPACE)
    .eq("proposta_id", propostaId)
    .eq("tipo", "contrato")
    .order("criado_em", { ascending: false })
    .limit(1);

  if (error) {
    if (ehColunaDoDonoAusente(error)) return null;
    throw new Error(error.message);
  }

  const card = ((data ?? []) as Array<{ operado_por: null | string }>)[0];
  if (card) return card.operado_por ?? null;
  return portalConfeccionaContrato(sessao.slug, sessao.tipo) ? sessao.incorporadorId : null;
}

/**
 * A correção declarada, quando ela vem — e só quando vem inteira.
 *
 * ⚠️ MEIO AJUSTE NÃO EXISTE. Aceitar um campo só faria o outro cair no `false` do JavaScript, e
 * "não pagou" por omissão é o erro que cancela sem devolver dinheiro do cliente.
 */
function ajusteDoCorpo(
  bruto: unknown,
): null | { assinaturaCompleta: boolean; houvePagamento: boolean } {
  if (!bruto || typeof bruto !== "object") return null;
  const a = bruto as { assinaturaCompleta?: unknown; houvePagamento?: unknown };
  if (typeof a.assinaturaCompleta !== "boolean" || typeof a.houvePagamento !== "boolean") {
    return null;
  }
  return { assinaturaCompleta: a.assinaturaCompleta, houvePagamento: a.houvePagamento };
}

// A LEITURA DOS FATOS (`lerFatosDoContrato`) MORA EM `lib/hercules/fatos-do-contrato-server.ts`
// desde 18/09/2026: a conclusão do cancelamento na Têmis refaz a MESMA apuração no instante de
// concluir, e duas cópias dela divergiriam no primeiro conserto.
