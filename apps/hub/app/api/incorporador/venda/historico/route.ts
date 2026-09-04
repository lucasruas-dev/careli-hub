import { NextResponse } from "next/server";

import { autorizar, codigosDaSessao, idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  type EventoDaUnidade,
  type EventoImportado,
  eventosDaReserva,
  historicoDaUnidade,
  type MovimentoDoHistorico,
  type PropostaDoHistorico,
  type ReservaDoHistorico,
} from "@/lib/hercules/historico-da-unidade";

// O HISTÓRICO DE UMA UNIDADE — sob demanda, ao clicar no lote.
//
// Pedido do Lucas (03/09/2026): *"aqui eu quero ter um histórico de tudo que foi feito naquela
// unidade, tudo tem que ficar registrado, trazendo o que foi feito, quando, por quem tudo"*.
//
// ⚠️ ROTA À PARTE, E NÃO NO PAYLOAD DA TELA. São 12.295 movimentações no total; mandá-las junto com
// a carga da Venda para o caso de alguém clicar num lote seria pagar o custo por uma pergunta que
// quase nunca é feita. É a mesma decisão do histórico do boleto no portal.
//
// ⚠️ O ESCOPO É CONFERIDO PELA PROPOSTA, e não pela unidade. `hercules_unidades` não guarda o código
// do empreendimento no formato da sessão (guarda o id numérico do C2X); as propostas guardam
// `empreendimento_codigo`, que é exatamente o que `codigosDaSessao` devolve. Quem não tem nenhuma
// proposta no escopo recebe lista vazia — nunca o histórico de um produto que não é dele.
//
// ⚠️ E A RESERVA DO PANTEON ENTRA PELA `unidade_id`, não pelo código. Lucas (04/09/2026), olhando a
// ficha do lote que ele mesmo tinha acabado de reservar: *"o histórico não está ligado"* — a tela
// dizia "nunca teve proposta" embaixo de uma reserva ativa. Eram duas travas na mesma linha: a
// leitura só olhava as três tabelas vindas do C2X, e a rota DESISTIA quando não havia proposta
// nenhuma (o `return` antecipado), que é exatamente o caso de todo lote reservado aqui pela
// primeira vez. O escopo da reserva é conferido pela UNIDADE, contra `idsDaSessao`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const unidade = (new URL(request.url).searchParams.get("unidade") ?? "").trim();
  if (!unidade) {
    return NextResponse.json({ error: "unidade não informada" }, { status: 400 });
  }

  const supabase = createApoloAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Não foi possível carregar o histórico." }, { status: 503 });
  }

  try {
    const codes = await codigosDaSessao(auth.sessao);
    if (codes.length === 0) {
      return NextResponse.json({ error: "Não foi possível carregar o histórico." }, { status: 503 });
    }

    const { data: propostas, error: erroPropostas } = await supabase
      .from("hercules_propostas")
      .select("id,codigo,cliente_nome,imobiliaria_nome,criado_em_c2x,etapa,valor")
      .eq("workspace_id", "careli")
      .eq("unidade_id", unidade)
      .in("empreendimento_codigo", codes)
      .order("criado_em_c2x", { ascending: false });

    if (erroPropostas) throw new Error(erroPropostas.message);

    const daUnidade = (propostas ?? []) as PropostaDoHistorico[];

    // As reservas nascidas aqui, com o escopo conferido pela unidade.
    const daReserva = await lerReservas(supabase, unidade, auth.sessao);

    // ⚠️ SÓ DESISTE QUANDO NÃO HÁ NADA DOS DOIS LADOS. Antes bastava não haver proposta para a
    // resposta sair vazia, e reserva nova nunca tem proposta.
    if (daUnidade.length === 0) {
      return NextResponse.json({
        data: { eventos: eventosDaReserva(daReserva), propostas: 0 },
      });
    }

    const { data: movimentos, error: erroMovimentos } = await supabase
      .from("hercules_proposta_etapas")
      .select("proposta_id,de_c2x,para_c2x,quando,autor_nome,motivo,observacao")
      .in(
        "proposta_id",
        daUnidade.map((p) => p.id),
      )
      .order("quando", { ascending: false })
      .limit(500);

    if (erroMovimentos) throw new Error(erroMovimentos.message);

    // Pagamento (ato e sinal) e assinatura — a outra metade da linha do tempo.
    const { data: importados, error: erroEventos } = await supabase
      .from("hercules_proposta_eventos")
      .select("proposta_id,tipo,quando,quem,documento,valor,descricao")
      .in(
        "proposta_id",
        daUnidade.map((p) => p.id),
      )
      .order("quando", { ascending: false })
      .limit(500);

    if (erroEventos) throw new Error(erroEventos.message);

    return NextResponse.json(
      {
        data: {
          // A linha do tempo é uma só: o que veio do C2X e o que nasceu aqui, na mesma ordem.
          eventos: [
            ...historicoDaUnidade(
              daUnidade,
              (movimentos ?? []) as MovimentoDoHistorico[],
              (importados ?? []) as EventoImportado[],
            ),
            ...eventosDaReserva(daReserva),
          ].sort((a: EventoDaUnidade, b: EventoDaUnidade) =>
            a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0,
          ),
          propostas: daUnidade.length,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[incorporador/venda/historico]", e);
    return NextResponse.json({ error: "Não foi possível carregar o histórico." }, { status: 503 });
  }
}

/**
 * As reservas desta unidade, se ela for de um empreendimento da sessão.
 *
 * ⚠️ O ESCOPO É CONFERIDO ANTES DA LEITURA, e pela UNIDADE: a reserva não guarda o código do
 * empreendimento no formato da sessão, e sem esta conferência trocar o id na barra de endereço
 * devolveria o cliente e o telefone de uma reserva de outro loteamento.
 *
 * ⚠️ FALHA AQUI NÃO DERRUBA O HISTÓRICO: sem as reservas, o que veio do C2X continua aparecendo —
 * meia linha do tempo é melhor do que um erro no lugar dela.
 */
async function lerReservas(
  supabase: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  unidadeId: string,
  sessao: Parameters<typeof idsDaSessao>[0],
): Promise<ReservaDoHistorico[]> {
  try {
    const permitidos = new Set(await idsDaSessao(sessao));

    const { data: unidade } = await supabase
      .from("hercules_unidades")
      .select("id, enterprise_id")
      .eq("workspace_id", "careli")
      .eq("id", unidadeId)
      .maybeSingle();

    const dona = unidade as null | { enterprise_id: string };
    if (!dona || !permitidos.has(String(dona.enterprise_id))) return [];

    const { data } = await supabase
      .from("hercules_reservas")
      .select(
        "id,proponentes,situacao,criado_em,criado_por_nome,observacao,validade_em,cancelada_em,cancelada_motivo,cancelada_por_nome,imobiliaria_entity_id,corretor_entity_id",
      )
      .eq("workspace_id", "careli")
      .eq("unidade_id", unidadeId)
      .order("criado_em", { ascending: false })
      .limit(50);

    const linhas = (data ?? []) as Array<
      ReservaDoHistorico & { corretor_entity_id: null | string; imobiliaria_entity_id: null | string }
    >;
    if (linhas.length === 0) return [];

    // Os nomes da imobiliária e do corretor, para a linha não mostrar uuid.
    const ids = [
      ...new Set(
        linhas.flatMap((l) => [l.imobiliaria_entity_id, l.corretor_entity_id]).filter(Boolean),
      ),
    ] as string[];
    const nomePorId = new Map<string, string>();
    if (ids.length > 0) {
      const { data: entidades } = await supabase
        .from("apolo_entities")
        .select("id, display_name, trade_name, legal_name")
        .in("id", ids);
      for (const e of (entidades ?? []) as Array<{
        display_name: null | string;
        id: string;
        legal_name: null | string;
        trade_name: null | string;
      }>) {
        nomePorId.set(e.id, (e.trade_name || e.display_name || e.legal_name || "").trim());
      }
    }

    return linhas.map((l) => ({
      ...l,
      corretor_nome: l.corretor_entity_id ? (nomePorId.get(l.corretor_entity_id) ?? null) : null,
      imobiliaria_nome: l.imobiliaria_entity_id
        ? (nomePorId.get(l.imobiliaria_entity_id) ?? null)
        : null,
    }));
  } catch (erro) {
    console.error("[incorporador/venda/historico] reservas", erro);
    return [];
  }
}
