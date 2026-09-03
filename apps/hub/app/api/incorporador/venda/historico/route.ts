import { NextResponse } from "next/server";

import { autorizar, codigosDaSessao } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  historicoDaUnidade,
  type MovimentoDoHistorico,
  type PropostaDoHistorico,
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
    if (daUnidade.length === 0) {
      return NextResponse.json({ data: { eventos: [], propostas: 0 } });
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

    return NextResponse.json(
      {
        data: {
          eventos: historicoDaUnidade(daUnidade, (movimentos ?? []) as MovimentoDoHistorico[]),
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
