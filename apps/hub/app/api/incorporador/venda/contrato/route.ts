import { NextResponse } from "next/server";

import { autorizarComercial } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import { nomeDaUnidade } from "@/lib/hercules/nome-da-unidade";
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
  const auth = autorizarComercial(request);
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
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    const { data: linha } = await admin
      .from("hercules_propostas")
      .select(
        "id, codigo, protocolo_numero, cliente_nome, cliente_documento, empreendimento_id, empreendimento_codigo",
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

    const agora = new Date().toISOString();

    const { data: movida, error } = await admin
      .from("hercules_propostas")
      .update({
        atualizado_em: agora,
        etapa: "contrato",
        // ⚠️ O MAPA PINTA PELA PROPOSTA DE `etapa_desde` MAIS RECENTE: sem esta data o lote
        // continuaria pintado como proposta e o funil não andaria.
        etapa_desde: agora,
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

    // ⚠️ A TRANSIÇÃO VIRA LINHA NO HISTÓRICO, e isto não é opcional (Lucas, 05/09/2026: *"tudo tem
    // que ter histórico; exemplo: encaminhei para contrato e não apareceu no histórico"*). A etapa
    // mudava, o mapa repintava e a faixa andava — e a ficha do lote não contava o passo, como se
    // ninguém tivesse feito nada. `hercules_proposta_etapas` é a tabela dos movimentos desde a
    // carga do C2X: o legado grava `de_c2x`/`para_c2x`, o Panteon grava `de`/`para` em texto, e a
    // linha do tempo lê os dois.
    //
    // ⚠️ NÃO DERRUBA A TRANSIÇÃO SE FALHAR. A proposta já está em `contrato`; recusar aqui deixaria
    // a venda parada num passo que já aconteceu. O que se perde é a linha do histórico, e isso vira
    // log — não um erro na cara de quem clicou.
    const { error: erroDoMovimento } = await admin.from("hercules_proposta_etapas").insert({
      autor_nome: auth.sessao.usuarioNome,
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
    // ⚠️ `venda_id` É A PRÓPRIA ENTREGA, e não um enfeite de rastreabilidade: é ele que aponta para
    // a PROPOSTA, e é da proposta que a Têmis tira tudo o que precisa — cliente, compradores e suas
    // participações, condições, plano, cronograma e o PDF que o cliente já recebeu. Sem ele, o card
    // entra na fila como um pedido solto e a minuta nasce de um formulário em branco, que é
    // exatamente o retrabalho que ligar os dois módulos veio acabar. É o que faz o "depois vamos
    // trabalhar nela" ser possível.
    //
    // ⚠️ NÃO DERRUBA A TRANSIÇÃO SE FALHAR. A venda já está em `contrato` no Hércules; recusar aqui
    // deixaria a venda parada num passo que já aconteceu, e o operador clicaria de novo por cima de
    // uma etapa que não aceita ser movida duas vezes. A resposta diz se o trabalho abriu — a tela
    // avisa quando não abriu, e o registro fica no log para alguém reabrir à mão.
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
        observacao: `Proposta entregue pela tela Venda do Hércules · COD ${
          proposta.codigo || codigoDaVenda(proposta.protocolo_numero) || "—"
        }`,
        tipo: "contrato",
        unidade: nomeDaUnidade(unidade),
        vendaId: proposta.id,
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
