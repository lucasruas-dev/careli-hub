import { NextResponse } from "next/server";

import { autorizarOperacaoDeVenda } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { autorizarEscritaNoProduto } from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { portalConfeccionaContrato } from "@/lib/apolo/incorporador/perfis-de-portal";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import { lerComColunasDoApartamento, nomeDaUnidade } from "@/lib/hercules/nome-da-unidade";
import {
  NOME_DO_DOCUMENTO,
  servicoDisponivel,
  type TipoDeDocumento,
} from "@/lib/temis/documentos-do-empreendimento";
import { abrirTrabalho } from "@/lib/temis/trabalhos-db";

// A PROPOSTA VIRA CONTRATO — o terceiro passo da venda.
//
// Lucas (05/09/2026): *"depois da proposta gerada, tenho dois caminhos, cancelar e enviar para
// contrato, pode habilitar"*.
//
// ⚠️ ESTE PASSO NÃO PRODUZ DOCUMENTO NENHUM: ele marca que a proposta foi aceita e a ENTREGA à
// Têmis, que é quem confecciona, manda assinar e arquiva (Lucas: *"Hércules entrega a proposta"*).
// Prometer "contrato gerado" aqui seria anunciar um papel que ninguém consegue abrir.
//
// ⚠️ E POR ISSO NÃO DISPARA WHATSAPP. A reserva, a proposta e os dois cancelamentos avisam os três
// porque cada um deles muda o que o cliente TEM na mão: um lote segurado, um preço com prazo, um
// papel que deixou de valer. "Entrou na fila do jurídico" não muda nada para ele hoje, e uma
// mensagem a mais por etapa interna transforma o WhatsApp da venda em ruído — o dia em que a minuta
// sair de verdade, ela é que merece o aviso. A tela mostra o resultado; o histórico do lote guarda
// quem mandou e quando.
//
// ⚠️ SÓ A PROPOSTA NATIVA E ABERTA. `origem = 'panteon'` mantém de fora as 4.857 importadas do
// C2X: mover para contrato aqui uma venda que corre no legado faria os dois sistemas discordarem
// sobre a mesma unidade, e o Panteon não tem como escrever a mudança de volta lá.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE = "careli";

type PedidoDeContrato = {
  /** A proposta que a TELA está vendo — a mesma trava do cancelamento. */
  propostaId?: null | string;
  unidadeId: string;
};

export async function POST(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  let corpo: Partial<PedidoDeContrato>;
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const unidadeId = String(corpo.unidadeId ?? "").trim();
  const propostaId =
    typeof corpo.propostaId === "string" ? corpo.propostaId.trim() || null : null;

  if (!unidadeId) {
    return NextResponse.json({ error: "Escolha a unidade." }, { status: 422 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));

    // As colunas do prédio (0171) entram porque é desta linha que sai o nome da unidade no card da
    // Têmis ("Torre A · Apto 304"); sem a 0171 a leitura repete sem elas.
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
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // ⚠️ QUEM OPERA O PRODUTO DECIDE A ESCRITA (Lucas, 16/09/2026). No portal que confecciona (o
    // Cecílio) mandar para contrato só vale no produto operado por ele; no VOC e no VOR é 403 só
    // consulta, e sem a 0170 é 503. A Gurgel passa sem ida ao banco. Antes de mover a etapa.
    const escrita = await autorizarEscritaNoProduto(request, auth.sessao, [unidade.enterprise_id]);
    if (!escrita.ok) return escrita.response;
    const sessao = escrita.sessao;

    const { data: linha } = await admin
      .from("hercules_propostas")
      .select(
        "id, codigo, protocolo_numero, cliente_nome, cliente_documento, empreendimento_id, empreendimento_codigo, etapa_desde, etapa_por",
      )
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidade.id)
      .eq("origem", "panteon")
      .eq("etapa", "proposta")
      .maybeSingle();

    const proposta = linha as null | {
      cliente_documento: null | string;
      cliente_nome: null | string;
      codigo: null | string;
      empreendimento_codigo: null | string;
      empreendimento_id: null | string;
      /** O carimbo de antes: é o que volta se o card do incorporador não abrir (ver o desfazer). */
      etapa_desde?: null | string;
      etapa_por?: null | string;
      id: string;
      protocolo_numero: null | number;
    };

    if (!proposta) {
      return NextResponse.json({ error: "Não há proposta aberta nesta unidade." }, { status: 409 });
    }

    // A mesma trava do cancelamento: uma aba velha não move a proposta que nasceu depois.
    if (propostaId && propostaId !== proposta.id) {
      return NextResponse.json(
        { error: "Esta unidade já tem outra proposta. Recarregue a tela antes de seguir." },
        { status: 409 },
      );
    }

    // ── O EMPREENDIMENTO CONSEGUE CONTRATAR? ──────────────────────────────
    //
    // ⚠️ A RÉGUA JÁ EXISTIA E NINGUÉM A CHAMAVA. `servicoDisponivel` foi escrita com a regra do
    // Lucas (02/09/2026: *"vamos ter que incluir no setup, a minuta, termo de cessão, termo de
    // distrato por empreendimento"*) e nunca teve um chamador — então a venda seguia para o
    // jurídico em empreendimento sem minuta nenhuma publicada. Foi o que aconteceu com as duas
    // primeiras vendas de verdade: caíram no ZZ TESTE, que tem ZERO minutas publicadas. O card
    // chegava, o jurídico abria, e não havia documento possível para produzir.
    //
    // ⚠️ RECUSAR AQUI É MAIS BARATO QUE RECUSAR LÁ. Depois de aberto, o card já apareceu no board,
    // já contou como trabalho e já precisa ser explicado a alguém. Antes, é uma frase na tela de
    // quem clicou — e ela diz exatamente o que cadastrar.
    const { data: publicadas, error: erroDasMinutas } = await admin
      .from("temis_minutas")
      .select("tipo")
      .eq("workspace_id", WORKSPACE)
      .eq("enterprise_id", String(unidade.enterprise_id))
      .eq("situacao", "publicada");

    if (erroDasMinutas) throw new Error(erroDasMinutas.message);

    const preparo = {
      documentosPublicados: [
        ...new Set(
          ((publicadas ?? []) as Array<{ tipo: string }>)
            .map((m) => m.tipo)
            .filter((t): t is TipoDeDocumento => t in NOME_DO_DOCUMENTO),
        ),
      ],
      // A taxa de cessão não entra nesta conta: ela só é exigida pelo serviço de cessão.
      taxaDeCessao: null,
    };

    const podeContratar = servicoDisponivel("contrato", preparo);
    if (!podeContratar.ok) {
      return NextResponse.json(
        {
          error: `Este empreendimento ainda não pode gerar contrato: ${podeContratar.faltando.join(
            ", ",
          )}. Cadastre em Têmis › Setup › Planos e minutas.`,
        },
        { status: 409 },
      );
    }

    const agora = new Date().toISOString();

    const { data: movida, error } = await admin
      .from("hercules_propostas")
      .update({
        atualizado_em: agora,
        etapa: "contrato",
        // ⚠️ O MAPA PINTA PELA PROPOSTA DE `etapa_desde` MAIS RECENTE: sem esta data o lote
        // continuaria pintado como proposta e o funil não andaria.
        etapa_desde: agora,
        // ⚠️ E QUEM MOVEU FICA NA PRÓPRIA PROPOSTA. A linha de movimento também guarda o autor, mas
        // ela é um `insert` à parte que não derruba a transição quando falha — e foi assim que as
        // duas vendas de 05/09 ficaram no histórico sem "por quem". O carimbo aqui anda junto com a
        // etapa, na mesma escrita: ou os dois vão, ou nenhum vai.
        etapa_por: sessao.usuarioNome ?? null,
      })
      .eq("id", proposta.id)
      // Trava de clique duplo, como nas irmãs: sem ela, dois coordenadores movem a mesma proposta
      // duas vezes e a segunda resposta diz "feito" sobre um passo que já era.
      .eq("etapa", "proposta")
      .select("id");

    if (error) throw new Error(error.message);

    if (!movida || movida.length === 0) {
      return NextResponse.json(
        { error: "Esta proposta acabou de mudar de etapa em outra tela." },
        { status: 409 },
      );
    }

    // ── A PROPOSTA É ENTREGUE À TÊMIS ──────────────────────────────────────
    //
    // Lucas (05/09/2026): *"agora que vamos ligar o Hércules à Têmis (...) vai ter que chegar para
    // ser rodado na Têmis, e aí vamos seguir o fluxo por lá"*, *"vamos somente entregar (...) depois
    // vamos trabalhar nela"* e, fechando o vocabulário: *"Hércules entrega a PROPOSTA"*.
    //
    // ⚠️ O HÉRCULES NÃO FAZ CONTRATO — ele entrega a proposta pronta e o trabalho a ser feito. O
    // `tipo: "contrato"` aqui é o SERVIÇO que a Têmis vai executar, não um documento que já exista:
    // quem confecciona, manda assinar e arquiva é ela. Confundir os dois faria a tela prometer um
    // papel que ninguém consegue abrir, e é por isso que nem o botão nem o recado dizem "contrato
    // gerado".
    //
    // ⚠️ A TÊMIS JÁ ESPERAVA ISTO. O canal `hercules` existe em `CanalDoTrabalho` desde que a fila
    // nasceu, o tipo `contrato` está entre os cinco serviços, e `temis_trabalhos` tem as colunas
    // `venda_id` e `aberto_por` desde o começo — só ninguém as preenchia, o que a auditoria da casa
    // já tinha registrado como pendência. O que faltava era o Hércules bater na porta.
    //
    // ⚠️ O VÍNCULO COM A PROPOSTA É A PRÓPRIA ENTREGA, e não um enfeite de rastreabilidade: é dela
    // que a Têmis tira tudo o que precisa — cliente, compradores e suas participações, condições,
    // plano, cronograma e o PDF que o cliente já recebeu. Sem ele, o card entra na fila como um
    // pedido solto e a minuta nasce de um formulário em branco, que é exatamente o retrabalho que
    // ligar os dois módulos veio acabar. É o que faz o "depois vamos trabalhar nela" ser possível.
    //
    // ⚠️ NA VENDA DA GURGEL, NÃO DERRUBA A TRANSIÇÃO SE FALHAR. A venda já está em `contrato` no
    // Hércules; recusar aqui deixaria a venda parada num passo que já aconteceu, e o operador clicaria
    // de novo por cima de uma etapa que não aceita ser movida duas vezes. A resposta diz se o trabalho
    // abriu — a tela avisa quando não abriu, e o registro fica no log para alguém reabrir à mão. Na
    // venda do portal que confecciona a etapa é desfeita (ver o bloco depois do card).
    const cadastro = await carregarCadastroDeEmpreendimentos().catch(() => []);
    const doCadastro =
      cadastro.find((l) => l.id === proposta.empreendimento_id) ??
      cadastro.find((l) => String(l.c2xEnterpriseId) === String(unidade.enterprise_id)) ??
      null;

    // ⚠️ O DONO DO CARD É QUEM CONFECCIONA (Lucas, 16/09/2026). A venda feita no portal que opera
    // sozinho (o Cecílio) abre o trabalho na fila DELE, e não na da Careli; a da Gurgel continua nula
    // (a Careli confecciona). Sem a migration 0172 a Têmis RECUSA o card com dono (não passamos
    // `semDonoSeFaltarColuna`): cair calado na fila da Careli seria entregar o contrato do Cecílio para
    // outro time. Nesse caso a etapa é desfeita logo abaixo.
    const operadoPorDoCard = portalConfeccionaContrato(sessao.slug, sessao.tipo) ? sessao.incorporadorId : null;

    let trabalhoId: null | string = null;
    let avisoDaTemis: null | string = null;
    try {
      const aberto = await abrirTrabalho({
        abertoPor: sessao.usuarioId,
        canal: "hercules",
        clienteCpf: proposta.cliente_documento,
        clienteNome: proposta.cliente_nome || "Cliente",
        empreendimentoCodigo: proposta.empreendimento_codigo || doCadastro?.codigo || "—",
        empreendimentoId: String(unidade.enterprise_id),
        empreendimentoNome: doCadastro?.nome || "Empreendimento",
        observacao: `Proposta entregue pela tela Venda do Hércules · COD ${
          proposta.codigo || codigoDaVenda(proposta.protocolo_numero) || "—"
        }`,
        operadoPor: operadoPorDoCard,
        // A PROPOSTA E O VINCULO QUE FUNCIONA.
        //
        // Media em 06/09/2026: `temis_trabalhos` tinha 4 linhas (as de seed) e NENHUMA criada
        // depois de 05/09 — as duas vendas despachadas naquele dia nao abriram card. A causa e a
        // chave estrangeira: `venda_id` referencia `hercules_vendas`, que tem zero linhas, e o que
        // se mandava ali era o id de uma PROPOSTA. Toda tentativa violava a FK, `abrirTrabalho`
        // devolvia o erro e a tela avisava — mas o juridico nunca recebeu pedido nenhum. A coluna
        // certa nasceu na migration 0134; `venda_id` fica reservada para quando `hercules_vendas`
        // for preenchida de verdade (e de la que o catalogo de variaveis da minuta le a venda).
        propostaId: proposta.id,
        tipo: "contrato",
        unidade: nomeDaUnidade(unidade),
      });

      if (aberto.ok) trabalhoId = aberto.id;
      else {
        avisoDaTemis = aberto.erro;
        console.error("[hercules][contrato] a Têmis recusou o trabalho", aberto.erro);
      }
    } catch (erro) {
      avisoDaTemis = "não foi possível abrir o trabalho na Têmis";
      console.error("[hercules][contrato] falha ao abrir o trabalho na Têmis", erro);
    }

    // ⚠️ O CARD DO INCORPORADOR QUE NÃO ABRE DESFAZ A ETAPA (revisão do conjunto, 16/09/2026). Na venda
    // da Gurgel a Careli confecciona e reabre o card à mão pelo log. Na do portal que confecciona não há
    // ninguém do outro lado para isso: sem a 0172 a Têmis recusa SEMPRE o card com dono, e a proposta
    // ficaria em "contrato" sem card, com o "Enviar para contrato" sumido da Mesa e nenhuma tela que
    // reabra o trabalho. Como no cancelamento-de-contrato, a etapa volta para "proposta" (com o carimbo
    // de antes) e a tela recebe o erro. O desfazer é condicional ao carimbo DESTE envio: se outra tela
    // mexeu depois, nada é sobrescrito.
    if (!trabalhoId && operadoPorDoCard) {
      const { data: voltadas, error: erroDoDesfazer } = await admin
        .from("hercules_propostas")
        .update({
          atualizado_em: new Date().toISOString(),
          etapa: "proposta",
          etapa_desde: proposta.etapa_desde ?? null,
          etapa_por: proposta.etapa_por ?? null,
        })
        .eq("id", proposta.id)
        .eq("etapa", "contrato")
        .eq("etapa_desde", agora)
        .select("id");

      const desfeito = !erroDoDesfazer && (voltadas?.length ?? 0) > 0;
      if (!desfeito) {
        console.error("[hercules][contrato] a proposta ficou em contrato sem o card da Têmis", {
          erro: erroDoDesfazer?.message ?? null,
          proposta: proposta.id,
        });
      }

      return NextResponse.json(
        {
          error: desfeito
            ? `O contrato não chegou à Têmis${avisoDaTemis ? ` (${avisoDaTemis})` : ""}. A proposta continua em proposta; tente de novo em instantes.`
            : `O contrato não chegou à Têmis${avisoDaTemis ? ` (${avisoDaTemis})` : ""}, e a proposta ficou marcada como contrato. Avise a Careli para abrir o card.`,
        },
        { status: desfeito ? 503 : 502 },
      );
    }

    // ⚠️ A TRANSIÇÃO VIRA LINHA NO HISTÓRICO, e isto não é opcional (Lucas, 05/09/2026: *"tudo tem
    // que ter histórico; exemplo: encaminhei para contrato e não apareceu no histórico"*). A etapa
    // mudava, o mapa repintava e a faixa andava — e a ficha do lote não contava o passo, como se
    // ninguém tivesse feito nada. `hercules_proposta_etapas` é a tabela dos movimentos desde a
    // carga do C2X: o legado grava `de_c2x`/`para_c2x`, o Panteon grava `de`/`para` em texto, e a
    // linha do tempo lê os dois.
    //
    // (16/09/2026) Gravada DEPOIS do card, para o envio desfeito acima não deixar no histórico um passo
    // que não aconteceu.
    //
    // ⚠️ NÃO DERRUBA A TRANSIÇÃO SE FALHAR. A proposta já está em `contrato`; recusar aqui deixaria
    // a venda parada num passo que já aconteceu. O que se perde é a linha do histórico, e isso vira
    // log — não um erro na cara de quem clicou.
    const { error: erroDoMovimento } = await admin.from("hercules_proposta_etapas").insert({
      autor_nome: sessao.usuarioNome,
      de: "proposta",
      para: "contrato",
      proposta_id: proposta.id,
      quando: agora,
      workspace_id: WORKSPACE,
    });

    if (erroDoMovimento) {
      console.error("[hercules][contrato] falha ao registrar o movimento", erroDoMovimento);
    }

    // ⚠️ A UNIDADE NÃO MUDA. Ela já está ocupada desde a reserva, e continua: `hercules_unidades`
    // não distingue proposta de contrato — quem sabe em que passo a venda está é a proposta viva,
    // e é ela que a grade lê para pintar o lote.

    return NextResponse.json({
      data: {
        avisoDaTemis,
        codigo: proposta.codigo || codigoDaVenda(proposta.protocolo_numero),
        id: proposta.id,
        trabalhoId,
      },
    });
  } catch (erro) {
    console.error("[hercules][contrato] falha ao enviar para contrato", erro);
    return NextResponse.json({ error: "Não foi possível enviar para contrato agora." }, {
      status: 503,
    });
  }
}
