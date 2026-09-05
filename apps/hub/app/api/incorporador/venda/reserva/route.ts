import { NextResponse } from "next/server";

import { autorizarComercial } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  avisarSobreAVenda,
  destinatariosDaVenda,
  type ResultadoDoAviso as ResultadoDoAvisoDaVenda,
} from "@/lib/hercules/avisos-da-venda";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { nomeDaUnidade } from "@/lib/hercules/nome-da-unidade";
import {
  familiaDoEmpreendimento,
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
  codigo: string;
  enterprise_id: string;
  id: string;
  lote: null | string;
  preco_tabela: null | number;
  quadra: null | string;
  situacao: string;
};

export async function GET(request: Request) {
  const auth = autorizarComercial(request);
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
    const { data } = await admin
      .from("hercules_unidades")
      .select("id,codigo,quadra,lote,situacao,preco_tabela,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidadeId)
      .maybeSingle();

    const unidade = data as null | UnidadeDaReserva;
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // ⚠️ A FAMÍLIA INTEIRA, e não só o empreendimento da unidade — ver `familiaDoEmpreendimento`.
    // As unidades do Vale do Ouro vivem em VLO/VOL/VOC e as imobiliárias estão vinculadas só ao
    // VLO: perguntar pelo id da unidade devolvia zero num produto com 37 credenciadas.
    const cadastro = await carregarCadastroDeEmpreendimentos();
    const escopo = familiaDoEmpreendimento(cadastro, String(unidade.enterprise_id));

    const lista = await quemPodeVender(admin, escopo);
    return NextResponse.json({ data: lista });
  } catch (erro) {
    console.error("[hercules][reserva] falha ao listar quem pode vender", erro);
    return NextResponse.json({ error: "Não foi possível carregar a lista agora." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = autorizarComercial(request);
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

    const { data } = await admin
      .from("hercules_unidades")
      .select("id,codigo,quadra,lote,situacao,preco_tabela,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", pedido.unidadeId)
      .maybeSingle();

    const unidade = data as null | UnidadeDaReserva;
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    if (unidade.situacao !== "disponivel") {
      return NextResponse.json(
        { error: `Esta unidade está ${unidade.situacao}. Só unidade disponível pode ser reservada.` },
        { status: 409 },
      );
    }

    // O mesmo escopo do GET: quem a lista ofereceu é quem a gravação aceita.
    const cadastro = await carregarCadastroDeEmpreendimentos();
    const escopo = familiaDoEmpreendimento(cadastro, String(unidade.enterprise_id));

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

    const { data: criada, error } = await admin
      .from("hercules_reservas")
      .insert({
        corretor_entity_id: pedido.corretorEntityId || null,
        criado_por: auth.sessao.usuarioId,
        criado_por_nome: auth.sessao.usuarioNome,
        empreendimento_id: empreendimento.id,
        imobiliaria_entity_id: pedido.imobiliariaEntityId,
        observacao: corpo.observacao?.trim() || null,
        origem: "coordenador",
        proponentes: [pedido.proponente],
        situacao: "ativa",
        unidade_id: unidade.id,
        validade_em: pedido.validadeEm,
        workspace_id: WORKSPACE,
      })
      .select("id, protocolo_numero")
      .maybeSingle();

    if (error) {
      // 23505 = a trava do índice parcial: alguém reservou primeiro.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Esta unidade acabou de ser reservada por outra pessoa." },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }

    // A unidade passa a `reservada`: é o campo que o mapa e a grade leem.
    await admin
      .from("hercules_unidades")
      .update({ atualizado_em: new Date().toISOString(), situacao: "reservada" })
      .eq("id", unidade.id);

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

    const avisos = await avisarSobreAVenda(admin, {
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
  const auth = autorizarComercial(request);
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

    const { data } = await admin
      .from("hercules_unidades")
      .select("id,codigo,quadra,lote,situacao,preco_tabela,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", pedido.unidadeId)
      .maybeSingle();

    const unidade = data as null | UnidadeDaReserva;
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

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

    const { error } = await admin
      .from("hercules_reservas")
      .update({
        atualizado_em: agora,
        cancelada_em: agora,
        cancelada_motivo: motivo,
        cancelada_por: auth.sessao.usuarioId,
        cancelada_por_nome: auth.sessao.usuarioNome,
        situacao: "cancelada",
      })
      .eq("id", reserva.id)
      // ⚠️ A CONDIÇÃO REPETIDA NÃO É PARANOIA: dois coordenadores no mesmo lote, e o segundo
      // clique cancelaria de novo uma reserva já cancelada, disparando um segundo WhatsApp.
      .eq("situacao", "ativa");

    if (error) throw new Error(error.message);

    await admin
      .from("hercules_unidades")
      .update({ atualizado_em: agora, situacao: "disponivel" })
      .eq("id", unidade.id);

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
      avisos = await avisarSobreAVenda(admin, {
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
      });
    }

    return NextResponse.json({ data: { avisos, codigo, id: reserva.id } });
  } catch (erro) {
    console.error("[hercules][reserva] falha ao cancelar", erro);
    return NextResponse.json({ error: "Não foi possível cancelar agora." }, { status: 503 });
  }
}
