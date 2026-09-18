import { NextResponse } from "next/server";

import {
  autorizarOperacaoDeVenda,
  ORIGEM_ACEITA_SEM_A_0167,
  origemDaReserva,
  origemRecusadaSemA0167,
} from "@/lib/apolo/incorporador/board-do-portal";
import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { autorizarEscritaNoProduto } from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  avisarSobreAVenda,
  destinatariosDaVenda,
  registrarAvisoNaoEnviado,
  type ResultadoDoAviso as ResultadoDoAvisoDaVenda,
  vendaAvisaPeloWhatsapp,
} from "@/lib/hercules/avisos-da-venda";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { devolverCadastroSeNaoHaOutroDono } from "@/lib/hercules/cancelar-reserva-server";
import { criarReservaNoHercules } from "@/lib/hercules/criar-reserva";
import { lerComColunasDoApartamento, nomeDaUnidade } from "@/lib/hercules/nome-da-unidade";
import {
  escopoDeQuemVende,
  podemVender,
  quemPodeVender,
} from "@/lib/hercules/quem-pode-vender";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import {
  avisosDaReserva,
  avisosDeCancelamento,
  conferirCancelamento,
  conferirReserva,
  motivoEscrito,
  type PedidoDeCancelamento,
  type PedidoDeReserva,
  SEM_PRECO_PARA_RESERVA,
  semPrecoDeTabela,
} from "@/lib/hercules/reserva";

// A RESERVA DA UNIDADE — o primeiro passo da venda, gravado no Panteon.
//
// Lucas (03/09/2026): *"se a unidade estiver disponível, ter um botão para reservar (...) quando
// ele clicar para reservar, reserva essa unidade e automaticamente vai ser encaminhada uma mensagem
// para o corretor, imobiliária e coordenador de que a unidade X foi reservada para fulano (vai sair
// do número do relacionamento). Pronto, a reserva acaba aqui."*
//
// ⚠️ GET LISTA QUEM PODE VENDER, POST RESERVA. Duas rotas seriam duas autorizações e dois lugares
// para o escopo escapar; o escopo aqui é lido uma vez, do cookie, e vale para as duas.
//
// ⚠️ O ESCOPO VEM DO COOKIE, NUNCA DO CORPO. `idsDaSessao` é a única fonte do que este usuário
// enxerga: o `unidadeId` do POST é conferido contra ele, e unidade de fora responde 404 — a mesma
// resposta de unidade inexistente, para o 403 não virar um oráculo de "existe, mas não é sua".
//
// ⚠️ A TRAVA DE DUPLICIDADE É DO BANCO. `hercules_reservas_uma_viva_por_unidade` (índice parcial,
// migration 0125) é quem impede dois donos: no salão são dezenas de tablets na mesma tela, e no
// portal dois coordenadores podem clicar no mesmo lote no mesmo segundo. Conferir antes em
// JavaScript perderia essa corrida; o que fazemos com o 23505 é traduzi-lo numa frase.
//
// ⚠️ O AVISO NÃO DERRUBA A RESERVA. Se o WhatsApp falhar, a reserva continua gravada e a resposta
// diz quem não foi avisado. O contrário — desfazer uma reserva boa porque um número estava errado —
// seria perder a venda por causa do cadastro.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const WORKSPACE = "careli";

type UnidadeDaReserva = {
  /** Só no prédio (0171). Ausente quando a coluna ainda não existe. */
  apartamento?: null | string;
  codigo: string;
  enterprise_id: string;
  id: string;
  lote: null | string;
  preco_tabela: null | number | string;
  quadra: null | string;
  situacao: string;
  /** Só no prédio. Nulo = torre única. */
  torre?: null | string;
};

/**
 * A unidade pelo id, com as colunas do prédio quando a 0171 já existe.
 *
 * ⚠️ AS COLUNAS DO APARTAMENTO ENTRAM AQUI (16/09/2026) porque é desta linha que `nomeDaUnidade`
 * escreve o WhatsApp: sem elas, a reserva de um apto sairia com o código cru. Sem a 0171, a leitura
 * repete sem elas (`lerComColunasDoApartamento`), e o loteamento sai como sempre.
 */
async function unidadePorId(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  unidadeId: string,
): Promise<null | UnidadeDaReserva> {
  const { data } = await lerComColunasDoApartamento((extras) =>
    admin
      .from("hercules_unidades")
      .select(`id,codigo,quadra,lote,situacao,preco_tabela,enterprise_id${extras}`)
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidadeId)
      .maybeSingle(),
  );
  return (data ?? null) as unknown as null | UnidadeDaReserva;
}

export async function GET(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  const url = new URL(request.url);
  const unidadeId = (url.searchParams.get("unidade") ?? "").trim();
  if (!unidadeId) {
    return NextResponse.json({ error: "Informe a unidade." }, { status: 400 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));
    const unidade = await unidadePorId(admin, unidadeId);
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // ⚠️ A FAMÍLIA INTEIRA, e não só o empreendimento da unidade — ver `familiaDoEmpreendimento`.
    // As unidades do Vale do Ouro vivem em VLO/VOL/VOC e as imobiliárias estão vinculadas só ao
    // VLO: perguntar pelo id da unidade devolvia zero num produto com 37 credenciadas.
    // ⚠️ E O GRUPO DO CATÁLOGO que a família cobre — ver `escopoDeQuemVende`. A imobiliária
    // habilitada como "group:Lagoa Bonita" sumia desta lista em todo lote do Lagoa Bonita.
    const [cadastro, catalogo] = await Promise.all([
      carregarCadastroDeEmpreendimentos(),
      catalogoDeEmpreendimentos(Date.now()),
    ]);
    const escopo = escopoDeQuemVende(cadastro, catalogo, String(unidade.enterprise_id));

    const lista = await quemPodeVender(admin, escopo);
    return NextResponse.json({ data: lista });
  } catch (erro) {
    console.error("[hercules][reserva] falha ao listar quem pode vender", erro);
    return NextResponse.json({ error: "Não foi possível carregar a lista agora." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  let corpo: Partial<PedidoDeReserva> & { observacao?: string };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const pedido: PedidoDeReserva = {
    corretorEntityId: corpo.corretorEntityId ?? null,
    imobiliariaEntityId: String(corpo.imobiliariaEntityId ?? "").trim(),
    proponente: {
      cpf: String(corpo.proponente?.cpf ?? ""),
      nome: String(corpo.proponente?.nome ?? "").trim(),
      telefone: String(corpo.proponente?.telefone ?? ""),
    },
    unidadeId: String(corpo.unidadeId ?? "").trim(),
    validadeEm: String(corpo.validadeEm ?? ""),
  };

  const erros = conferirReserva(pedido, new Date().toISOString());
  if (erros.length > 0) {
    return NextResponse.json({ erros }, { status: 422 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));

    const unidade = await unidadePorId(admin, pedido.unidadeId);
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // ⚠️ QUEM OPERA O PRODUTO DECIDE A ESCRITA (Lucas, 16/09/2026). No portal que confecciona (o
    // Cecílio) a reserva só vale no produto operado por ele: o Garden sim, o VOC e o VOR não (lá é
    // só consulta, e a resposta é 403 com `soConsulta`). A Gurgel passa sem ida ao banco. Vem ANTES
    // de qualquer regra de negócio e de qualquer escrita, e a sessão que segue é a revalidada.
    const escrita = await autorizarEscritaNoProduto(request, auth.sessao, [unidade.enterprise_id]);
    if (!escrita.ok) return escrita.response;
    const sessao = escrita.sessao;

    // ⚠️ A CONFERÊNCIA DE "LIVRE" NÃO É MAIS AQUI, E NÃO PELO CADASTRO CRU. Ela mora em
    // `criarReservaNoHercules`, pela situação única do TERRENO: o cadastro desta linha dizia
    // "disponível" em lotes com proposta importada viva e em lotes reservados na linha do pai, e a
    // reserva passava. Ver `lib/hercules/trava-do-lote.ts`.

    // ⚠️ SEM PREÇO DE TABELA NÃO SE RESERVA (achado 15 da onda 2). A reserva é o primeiro passo de
    // uma proposta que congelaria "R$ 0" no documento; recusar aqui é mais barato do que desfazer lá.
    if (semPrecoDeTabela(unidade.preco_tabela)) {
      return NextResponse.json({ error: SEM_PRECO_PARA_RESERVA }, { status: 409 });
    }

    // O mesmo escopo do GET: quem a lista ofereceu é quem a gravação aceita.
    const [cadastro, catalogo] = await Promise.all([
      carregarCadastroDeEmpreendimentos(),
      catalogoDeEmpreendimentos(Date.now()),
    ]);
    const escopo = escopoDeQuemVende(cadastro, catalogo, String(unidade.enterprise_id));

    const habilitados = await podemVender(admin, escopo, {
      corretorId: pedido.corretorEntityId,
      imobiliariaId: pedido.imobiliariaEntityId,
    });
    if (!habilitados.ok) {
      return NextResponse.json({ error: habilitados.motivo }, { status: 403 });
    }

    // ⚠️ O EMPREENDIMENTO DA RESERVA É O PAI. As unidades moram no espelho (o pai do cadastro), e é
    // o `id` dele que `hercules_reservas.empreendimento_id` referencia. Um filho pode compartilhar
    // o código do C2X em outra coluna, então o pai ganha na escolha.
    const doC2x = cadastro.filter((l) => l.c2xEnterpriseId === String(unidade.enterprise_id));
    const empreendimento = doC2x.find((l) => l.paiId === null) ?? doC2x[0] ?? null;
    if (!empreendimento) {
      return NextResponse.json(
        { error: "Este empreendimento ainda não está no cadastro do Hércules." },
        { status: 409 },
      );
    }

    // "coordenador" no comercial, "incorporador" no portal que opera a própria venda (o Cecílio).
    // Sai da SESSÃO, nunca do corpo. Exige a migration 0167 no banco antes.
    const origem = origemDaReserva(sessao);

    // ⚠️ A PORTA ÚNICA DA RESERVA (Lucas, 18/09/2026: *"toda reserva, proposta deve ser criada no
    // hercules"* · *"eu não posso vender dois lotes para pessoas diferentes"*). Confere o terreno
    // antes, grava, confere de novo depois e desfaz se o lote ganhou outro dono no mesmo instante.
    const resultado = await criarReservaNoHercules(
      admin,
      {
        corretorEntityId: pedido.corretorEntityId,
        criadoPor: sessao.usuarioId,
        criadoPorNome: sessao.usuarioNome,
        empreendimentoId: empreendimento.id,
        enterpriseId: String(unidade.enterprise_id),
        imobiliariaEntityId: pedido.imobiliariaEntityId,
        observacao: corpo.observacao ?? null,
        origem,
        proponentes: [pedido.proponente],
        unidadeId: unidade.id,
        validadeEm: pedido.validadeEm,
      },
      {
        // (16/09/2026) A REDE DA ORDEM DE DEPLOY: sem a 0167 no banco, a CHECK recusa
        // 'incorporador'. Grava com a origem antiga e grita no log. Ver `origemRecusadaSemA0167`.
        origemSeRecusada: (erro) => {
          if (!origemRecusadaSemA0167(erro as never, origem)) return null;
          console.error(
            "[hercules][reserva] migration 0167 pendente: reserva do portal gravada com a origem antiga",
            { criadoPor: sessao.usuarioId, unidade: unidade.id },
          );
          return ORIGEM_ACEITA_SEM_A_0167;
        },
      },
    );

    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.motivo }, { status: resultado.status });
    }
    const criada = resultado.reserva;

    const codigo = codigoDaVenda(
      (criada as null | { protocolo_numero?: null | number })?.protocolo_numero,
    );

    // Os nomes primeiro, os textos depois: quem escreve a mensagem precisa saber o nome da
    // imobiliaria e o do corretor, e os dois saem do `apolo_entities` que a lib de avisos le.
    const destinatarios = await destinatariosDaVenda(admin, {
      corretorId: pedido.corretorEntityId ?? null,
      empreendimento: { c2xId: String(unidade.enterprise_id), nome: empreendimento.nome },
      imobiliariaId: pedido.imobiliariaEntityId,
    });

    // ⚠️ A RESERVA DO PORTAL QUE OPERA SOZINHO NÃO AVISA NINGUÉM (Lucas, 16/09/2026): nenhum
    // WhatsApp sai, e o histórico de disparos registra que o aviso não foi enviado por decisão. A
    // reserva da Gurgel avisa corretor, imobiliária e coordenador como sempre.
    const avisos = vendaAvisaPeloWhatsapp(sessao)
      ? await avisarSobreAVenda(admin, {
          corretorId: pedido.corretorEntityId ?? null,
          destinatarios,
          imobiliariaId: pedido.imobiliariaEntityId,
          origem: "reserva:whatsapp",
          textos: avisosDaReserva({
            cliente: pedido.proponente.nome,
            codigo,
            corretor: destinatarios.corretor?.nome ?? null,
            cpf: pedido.proponente.cpf,
            empreendimento: empreendimento.nome,
            imobiliaria: destinatarios.imobiliaria.nome,
            unidade: nomeDaUnidade(unidade),
            validadeEm: pedido.validadeEm,
          }),
          tipo: "hercules_reserva",
        })
      : await registrarAvisoNaoEnviado(admin, {
          corretorId: pedido.corretorEntityId ?? null,
          destinatarios,
          imobiliariaId: pedido.imobiliariaEntityId,
          origem: "reserva:whatsapp",
          tipo: "hercules_reserva",
        });

    return NextResponse.json({ data: { avisos, codigo, id: criada?.id ?? null } });
  } catch (erro) {
    console.error("[hercules][reserva] falha ao reservar", erro);
    return NextResponse.json({ error: "Não foi possível reservar agora." }, { status: 503 });
  }
}

// ── O CANCELAMENTO ──────────────────────────────────────────────────────────
//
// Lucas (04/09/2026): *"da reserva eu tenho dois caminhos, gerar proposta ou cancelar"*.
//
// ⚠️ PATCH, E NÃO DELETE. A reserva cancelada continua existindo: é ela que responde "quem tinha
// este lote em agosto e por que soltou". Apagar a linha apagaria a resposta — e o histórico da
// unidade lê justamente `cancelada_em` para montar o evento.
//
// ⚠️ A UNIDADE VOLTA A `disponivel` ANTES DO AVISO. Se o WhatsApp falhar, o lote já está livre para
// vender; o contrário — lote preso porque uma mensagem não saiu — custaria uma venda.
export async function PATCH(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  let corpo: Partial<PedidoDeCancelamento>;
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const pedido: PedidoDeCancelamento = {
    detalhe: typeof corpo.detalhe === "string" ? corpo.detalhe : null,
    motivo: String(corpo.motivo ?? "").trim(),
    unidadeId: String(corpo.unidadeId ?? "").trim(),
  };

  const erros = conferirCancelamento(pedido);
  if (erros.length > 0) {
    return NextResponse.json({ erros }, { status: 422 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));

    const unidade = await unidadePorId(admin, pedido.unidadeId);
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // A mesma régua do POST: cancelar reserva é escrita, e no produto só de consulta não se escreve.
    const escrita = await autorizarEscritaNoProduto(request, auth.sessao, [unidade.enterprise_id]);
    if (!escrita.ok) return escrita.response;
    const sessao = escrita.sessao;

    const { data: viva } = await admin
      .from("hercules_reservas")
      .select(
        "id, situacao, protocolo_numero, proponentes, imobiliaria_entity_id, corretor_entity_id, empreendimento_id",
      )
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidade.id)
      .in("situacao", ["ativa", "proposta"])
      .maybeSingle();

    const reserva = viva as null | {
      corretor_entity_id: null | string;
      empreendimento_id: string;
      id: string;
      imobiliaria_entity_id: null | string;
      proponentes: unknown;
      protocolo_numero: null | number;
      situacao: string;
    };

    if (!reserva) {
      return NextResponse.json(
        { error: "Não há reserva ativa nesta unidade." },
        { status: 409 },
      );
    }

    // ⚠️ RESERVA QUE JÁ VIROU PROPOSTA NÃO SE CANCELA POR AQUI. A partir dali quem representa a
    // venda é a proposta, com condições comerciais gravadas — cancelar a reserva por baixo dela
    // deixaria uma proposta viva apontando para um lote disponível.
    if (reserva.situacao !== "ativa") {
      return NextResponse.json(
        { error: "Esta reserva já virou proposta. O cancelamento é o da proposta." },
        { status: 409 },
      );
    }

    const motivo = motivoEscrito(pedido.motivo, pedido.detalhe);
    const agora = new Date().toISOString();

    const { data: canceladas, error } = await admin
      .from("hercules_reservas")
      .update({
        atualizado_em: agora,
        cancelada_em: agora,
        cancelada_motivo: motivo,
        cancelada_por: sessao.usuarioId,
        cancelada_por_nome: sessao.usuarioNome,
        situacao: "cancelada",
      })
      .eq("id", reserva.id)
      // ⚠️ A CONDIÇÃO REPETIDA NÃO É PARANOIA: dois coordenadores no mesmo lote, e o segundo
      // clique cancelaria de novo uma reserva já cancelada, disparando um segundo WhatsApp.
      .eq("situacao", "ativa")
      .select("id, prometeu_reserva_id");

    if (error) throw new Error(error.message);

    // ⚠️ NENHUMA LINHA MUDOU = a reserva virou proposta (ou foi cancelada) entre a leitura e o
    // UPDATE. Responder sucesso aqui mandaria o WhatsApp de "reserva cancelada" com a venda viva.
    const cancelada = ((canceladas ?? []) as Array<{ id: string; prometeu_reserva_id: null | string }>)[0];
    if (!cancelada) {
      return NextResponse.json(
        { error: "Esta reserva mudou enquanto você cancelava. Recarregue a tela." },
        { status: 409 },
      );
    }

    // O cupom do salão ligado a esta reserva cai junto: a Central e a PA não mostram lote que a
    // Venda já soltou. Falha aqui não desfaz nada: quem lê o cupom já segue a reserva do Hércules.
    if (cancelada.prometeu_reserva_id) {
      const { error: erroDoCupom } = await admin
        .from("prometeu_reservas")
        .update({ cancelada_em: agora, cancelada_motivo: `${motivo} (cancelada na Venda)`, situacao: "cancelada" })
        .eq("id", cancelada.prometeu_reserva_id)
        .eq("situacao", "reservada");
      if (erroDoCupom) {
        console.error("[venda][reserva] cupom do salão não foi cancelado", {
          cupom: cancelada.prometeu_reserva_id,
          erro: erroDoCupom.message,
        });
      }
    }

    // ⚠️ O CADASTRO SÓ VOLTA A LIVRE SE O TERRENO FICOU SEM DONO E SE ELE ESTAVA `reservada`.
    // Lote bloqueado no Apolo (ou pela carga) enquanto a reserva estava viva continua bloqueado:
    // gravar `disponivel` sem condição foi como um lote de permuta voltaria à venda.
    await devolverCadastroSeNaoHaOutroDono(admin, unidade.id, {
      reservaDoEventoId: cancelada.prometeu_reserva_id,
      reservaId: cancelada.id,
    });

    const cadastro = await carregarCadastroDeEmpreendimentos();
    const nomeDoEmpreendimento =
      cadastro.find((l) => l.id === reserva.empreendimento_id)?.nome ?? "empreendimento";

    const titular = Array.isArray(reserva.proponentes)
      ? (reserva.proponentes[0] as null | { nome?: unknown })
      : null;
    const codigo = codigoDaVenda(reserva.protocolo_numero);

    // Reserva sem imobiliaria nao tem para quem avisar: o registro do disparo pendura na ficha
    // dela, inclusive o do coordenador.
    const imobiliariaId = reserva.imobiliaria_entity_id;
    let avisos: ResultadoDoAvisoDaVenda[] = [];
    if (imobiliariaId) {
      const destinatarios = await destinatariosDaVenda(admin, {
        corretorId: reserva.corretor_entity_id,
        empreendimento: { c2xId: String(unidade.enterprise_id), nome: nomeDoEmpreendimento },
        imobiliariaId,
      });
      // Portal que opera sozinho: nenhum WhatsApp, só o registro de que o aviso não saiu.
      avisos = vendaAvisaPeloWhatsapp(sessao)
        ? await avisarSobreAVenda(admin, {
            corretorId: reserva.corretor_entity_id,
            destinatarios,
            imobiliariaId,
            origem: "reserva:whatsapp",
            textos: avisosDeCancelamento({
              cliente: typeof titular?.nome === "string" ? titular.nome : "cliente",
              codigo,
              corretor: destinatarios.corretor?.nome ?? null,
              empreendimento: nomeDoEmpreendimento,
              imobiliaria: destinatarios.imobiliaria.nome,
              motivo,
              unidade: nomeDaUnidade(unidade),
            }),
            tipo: "hercules_reserva",
          })
        : await registrarAvisoNaoEnviado(admin, {
            corretorId: reserva.corretor_entity_id,
            destinatarios,
            imobiliariaId,
            origem: "reserva:whatsapp",
            tipo: "hercules_reserva",
          });
    }

    return NextResponse.json({ data: { avisos, codigo, id: reserva.id } });
  } catch (erro) {
    console.error("[hercules][reserva] falha ao cancelar", erro);
    return NextResponse.json({ error: "Não foi possível cancelar agora." }, { status: 503 });
  }
}
