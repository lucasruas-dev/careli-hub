import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  type EventoDaUnidade,
  type EventoImportado,
  historicoDaUnidade,
  type MovimentoDoHistorico,
  type PropostaDoHistorico,
} from "@/lib/hercules/historico-da-unidade";
import { autorizarLeituraDeContrato } from "@/lib/temis/autorizacao";
import {
  type CardDoHistorico,
  historicoDeEtapas,
  type PassagemGravada,
} from "@/lib/temis/historico-de-etapas";
import { ehTabelaAusente } from "@/lib/temis/tabela-ausente";

// O HISTÓRICO DA VENDA, VISTO PELA TÊMIS — a terceira aba da coluna fixa.
//
// Lucas (09/09/2026): *"chat - documentos - historico"*, e *"ficam em todas as etapas"*.
//
// ⚠️ A MONTAGEM É A MESMA DO HÉRCULES, e de propósito: `historicoDaUnidade` é lib pura, testada
// (`historico-da-unidade.test.ts`), e junta numa linha do tempo só o que veio do C2X e o que
// nasceu aqui. Reimplementar a ordenação dos fatos daria duas versões da história da mesma venda.
//
// ⚠️ O RECORTE É A PROPOSTA, não o lote. A rota do Hércules lista o histórico da UNIDADE (todas as
// negociações que o lote já teve, o que faz sentido lá: a ficha é do lote). Num card da Têmis, que
// é de uma venda, o histórico das propostas anteriores seria a história de outro comprador.
//
// ⚠️ E AGORA SÃO DUAS FONTES NA MESMA LISTA. `?proposta=` traz o funil do HÉRCULES ("Proposta →
// Contrato", pagamentos, assinaturas importadas); `?trabalho=` traz as passagens de etapa do CARD
// da Têmis (a 0153), que é outro caminho sobre a mesma venda. Lucas (11/09/2026): *"o historico nao
// esta trazendo essas aprovacoes de analise - contrato - contrato para assinatura, tem que trazer"*.
//
// ⚠️ UMA LISTA SÓ, ORDENADA PELA DATA — e não duas listas lado a lado. Quem lê está perguntando "o
// que aconteceu com esta venda, em que ordem"; duas listas separadas obrigariam a costurar as duas
// de cabeça, que é exatamente o trabalho que esta aba existe para poupar. Quem diz de onde veio
// cada linha é o campo `fonte`, que na tela vira um selo de texto.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarLeituraDeContrato(request);
  if (!auth.ok) return auth.response;

  const parametros = new URL(request.url).searchParams;
  const propostaId = (parametros.get("proposta") ?? "").trim();
  const trabalhoId = (parametros.get("trabalho") ?? "").trim();

  // ⚠️ A FRASE CONTINUA A MESMA quando não vem nem um nem outro: sem `?trabalho`, esta rota
  // responde exatamente o que respondia antes — inclusive o erro.
  if (!propostaId && !trabalhoId) {
    return NextResponse.json({ error: "Proposta não informada." }, { status: 400 });
  }

  const sb = createApoloAdminClient();
  if (!sb) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  try {
    // ⚠️ CARD SEM PROPOSTA NÃO É ERRO, e é justamente onde a fonte nova faz diferença: os quatro
    // cards antigos (Garden e Lavra) nasceram antes do elo com a venda (0134) e têm `proposta_id`
    // nulo. Antes a aba respondia 400 e ficava vazia para sempre; agora ela mostra o caminho do
    // card, que é o que existe.
    const proposta = propostaId ? await lerProposta(sb, propostaId) : null;
    if (propostaId && !proposta) {
      return NextResponse.json({ error: "Proposta não encontrada." }, { status: 404 });
    }

    const [movimentos, importados, daTemis] = await Promise.all([
      propostaId
        ? movimentosDaProposta(sb, propostaId)
        : Promise.resolve<MovimentoDoHistorico[]>([]),
      propostaId ? eventosImportados(sb, propostaId) : Promise.resolve<EventoImportado[]>([]),
      trabalhoId ? etapasDoCard(sb, trabalhoId) : Promise.resolve<EventoDaUnidade[]>([]),
    ]);

    const doHercules = proposta
      ? historicoDaUnidade([proposta], movimentos, importados)
      : [];

    const eventos: EventoDaUnidade[] = [...doHercules, ...daTemis].sort((a, b) =>
      a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0,
    );

    return NextResponse.json(
      { data: { eventos } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erro) {
    console.error("[temis][historico] falha ao montar", erro);
    return NextResponse.json(
      { error: "Não foi possível carregar o histórico." },
      { status: 503 },
    );
  }
}

async function lerProposta(
  sb: SupabaseClient,
  propostaId: string,
): Promise<null | PropostaDoHistorico> {
  const { data, error } = await sb
    .from("hercules_propostas")
    .select(
      "id, codigo, etapa, etapa_c2x, etapa_desde, criado_em, criado_em_c2x, cliente_nome, valor, unidade_nome, corretor_nome, imobiliaria_nome, plano_nome, aberta, cancelada_em, cancelada_motivo",
    )
    .eq("id", propostaId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as null | PropostaDoHistorico) ?? null;
}

async function movimentosDaProposta(
  sb: SupabaseClient,
  propostaId: string,
): Promise<MovimentoDoHistorico[]> {
  const { data, error } = await sb
    .from("hercules_proposta_etapas")
    .select("proposta_id,de_c2x,para_c2x,de,para,quando,autor_nome,motivo,observacao")
    .eq("proposta_id", propostaId)
    .order("quando", { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);
  return (data ?? []) as MovimentoDoHistorico[];
}

async function eventosImportados(
  sb: SupabaseClient,
  propostaId: string,
): Promise<EventoImportado[]> {
  const { data, error } = await sb
    .from("hercules_proposta_eventos")
    .select("proposta_id,tipo,quando,quem,documento,valor,descricao")
    .eq("proposta_id", propostaId)
    .order("quando", { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);
  return (data ?? []) as EventoImportado[];
}

/**
 * As passagens de etapa do card, mais o próprio card para o caso de não haver nenhuma.
 *
 * ⚠️ ESTA LEITURA NÃO DERRUBA A ABA, e é a única das três assim. A tabela `temis_trabalho_etapas`
 * só existe depois que o Lucas aplicar a 0153, e o código sobe antes disso (regra da casa: migration
 * espera OK explícito). Um `throw` aqui apagaria o histórico do Hércules — que funciona — por causa
 * de uma pendência conhecida. A tabela ausente vira zero linhas, e a derivada do card diz o que dá
 * para provar.
 *
 * ⚠️ E QUEM DECIDE O QUE É "AUSENTE" É `ehTabelaAusente`, NÃO UM TESTE DE `42P01` À MÃO. Contra
 * tabela fora do schema cache a Supabase responde `PGRST205` / `Could not find the table ...`, que
 * não casa com `42P01` nem com `does not exist` — e era um `console.error` por abertura da aba, no
 * caso que é o NORMAL de hoje.
 *
 * ⚠️ E O CARD SEMPRE É LIDO, mesmo quando há passagens: sem ele não há como derivar nada, e é uma
 * consulta por chave primária.
 */
async function etapasDoCard(
  sb: SupabaseClient,
  trabalhoId: string,
): Promise<EventoDaUnidade[]> {
  const { data: card, error: erroDoCard } = await sb
    .from("temis_trabalhos")
    .select("estagio, estagio_desde, id, proposta_id, tipo")
    .eq("id", trabalhoId)
    .maybeSingle<CardDoHistorico>();

  if (erroDoCard) throw new Error(erroDoCard.message);
  // Card que não existe não tem linha do tempo — e quem responde 404 é a rota do card, não esta.
  if (!card) return [];

  const { data, error } = await sb
    .from("temis_trabalho_etapas")
    .select(
      "de, motivo, observacao, origem, para, proposta_id, quando, quem_nome, trabalho_id, trabalho_tipo",
    )
    .eq("trabalho_id", trabalhoId)
    .order("quando", { ascending: false })
    .limit(500);

  if (error) {
    if (!ehTabelaAusente(error, "temis_trabalho_etapas")) {
      console.error("[temis][historico] falha ao ler as passagens de etapa", error.message);
    }
    return historicoDeEtapas([], card);
  }

  return historicoDeEtapas((data ?? []) as PassagemGravada[], card);
}
