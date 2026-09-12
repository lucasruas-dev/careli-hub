import { NextResponse } from "next/server";

import { autorizarComercial } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import { nomeDaUnidade } from "@/lib/hercules/nome-da-unidade";
import { apurarFatosDoContrato, type EnvelopeDoContrato } from "@/lib/hercules/fatos-do-contrato";
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
  const auth = autorizarComercial(request);
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
      .eq("origem", "panteon")
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
        { error: "Esta unidade não tem contrato do Panteon para cancelar." },
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
  const auth = autorizarComercial(request);
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

    // ⚠️ O ERRO DO SELECT NÃO PODE VIRAR 409. Descartá-lo faz uma falha de banco (coluna que não
    // existe, tabela indisponível) chegar ao coordenador como "esta unidade não tem contrato do
    // Panteon para cancelar" — uma frase que ele acredita, porque é plausível, e que o manda
    // procurar o problema no lugar errado.
    const { data: linhaDaProposta, error: erroDaProposta } = await admin
      .from("hercules_propostas")
      .select(
        "id,codigo,protocolo_numero,cliente_nome,cliente_documento,etapa,empreendimento_codigo,empreendimento_id,cancelamento_pedido_em,data_assinatura,data_ato,data_faturamento",
      )
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidade.id)
      .eq("origem", "panteon")
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
      protocolo_numero: null | number;
    };
    if (erroDaProposta) throw new Error(erroDaProposta.message);
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
        cancelamento_pedido_por: auth.sessao.usuarioNome ?? null,
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
      const { data: jaNaFila } = await admin
        .from("temis_trabalhos")
        .select("id")
        .eq("proposta_id", proposta.id)
        .in("tipo", ["cancelamento", "distrato"])
        .neq("estagio", "finalizado")
        .limit(1);

      const antigo = (jaNaFila ?? [])[0] as undefined | { id: string };
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

      const aberto = await abrirTrabalho({
        abertoPor: auth.sessao.usuarioId,
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
            ? `AJUSTE MANUAL de ${auth.sessao.usuarioNome ?? "quem pediu"}: assinatura completa: ${
                comAjuste.assinaturaCompleta ? "sim" : "não"
              }, houve pagamento: ${comAjuste.houvePagamento ? "sim" : "não"} (o sistema apurou: ${
                fatos.comoSoube.assinatura
              }, ${fatos.comoSoube.pagamento})`
            : `apurado pelo sistema: ${fatos.comoSoube.assinatura}, ${fatos.comoSoube.pagamento}`
        } · ${classificacao.porque}`,
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
              : "A marca do pedido ficou registrada e o botão não vai aceitar nova tentativa: avise o jurídico e peça para o time do Panteon limpar a marca."
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

/**
 * O que está gravado sobre este contrato — a fonte da classificação.
 *
 * ⚠️ FALHA DE LEITURA NÃO VIRA "NÃO PAGOU". Um erro no select devolveria silêncio, e silêncio aqui
 * significa cancelamento simples: exatamente a classificação errada para um contrato pago. Por isso
 * a exceção sobe e vira 503 na tela, em vez de virar um pedido classificado no escuro.
 */
async function lerFatosDoContrato(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  proposta: {
    data_assinatura: null | string;
    data_ato: null | string;
    data_faturamento: null | string;
    id: string;
  },
) {
  const { data, error } = await admin
    .from("hercules_proposta_eventos")
    .select("tipo")
    .eq("proposta_id", proposta.id)
    .limit(500);

  if (error) throw new Error(error.message);

  // ⚠️ O ENVELOPE DA TÊMIS PRECISA ENTRAR AQUI, SENÃO A APURAÇÃO É CEGA PARA A ASSINATURA DO
  // PANTEON — e este era o defeito, não a função. As duas fontes acima são do C2X
  // (`hercules_proposta_eventos` e `data_assinatura` só são escritas pela carga do legado): uma
  // venda que nasceu aqui, cujo contrato a Têmis mandou para a Clicksign e cujos compradores
  // assinaram, respondia "nenhuma assinatura registrada" e o pedido saía classificado como
  // CANCELAMENTO SIMPLES — sem distrato, sem apuração do que devolver e sem devolução ao cliente.
  // `apurarFatosDoContrato` já sabe ler o envelope; faltava alguém buscá-lo, porque ela é pura.
  //
  // ⚠️ SÓ `assinado`, e o filtro é da própria consulta: `parcial` é meio contrato assinado, e pela
  // regra do Lucas (12/09/2026) esse ainda VOLTA para a análise — tratá-lo como completo empurraria
  // para o distrato uma venda que só precisava de correção.
  const { data: envelopes, error: erroDoEnvelope } = await admin
    .from("temis_envelopes")
    .select("estado, fechado_em")
    .eq("proposta_id", proposta.id)
    .eq("estado", "assinado")
    .order("criado_em", { ascending: false })
    .limit(1);

  // ⚠️ E FALHA DE LEITURA NÃO VIRA "NÃO ASSINOU", pelo mesmo desenho do select acima: silêncio aqui
  // significa cancelamento simples, que é a classificação errada para um contrato assinado.
  if (erroDoEnvelope) throw new Error(erroDoEnvelope.message);

  return apurarFatosDoContrato(
    (data ?? []) as Array<{ tipo: string }>,
    {
      data_assinatura: proposta.data_assinatura,
      data_ato: proposta.data_ato,
      data_faturamento: proposta.data_faturamento,
    },
    ((envelopes ?? []) as EnvelopeDoContrato[])[0] ?? null,
  );
}
