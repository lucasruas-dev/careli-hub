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
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarLeituraDeContrato(request);
  if (!auth.ok) return auth.response;

  const propostaId = (new URL(request.url).searchParams.get("proposta") ?? "").trim();
  if (!propostaId) {
    return NextResponse.json({ error: "Proposta não informada." }, { status: 400 });
  }

  const sb = createApoloAdminClient();
  if (!sb) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  try {
    const { data: proposta, error: erroProposta } = await sb
      .from("hercules_propostas")
      .select(
        "id, codigo, etapa, etapa_c2x, etapa_desde, criado_em, criado_em_c2x, cliente_nome, valor, unidade_nome, corretor_nome, imobiliaria_nome, plano_nome, aberta, cancelada_em, cancelada_motivo",
      )
      .eq("id", propostaId)
      .maybeSingle();

    if (erroProposta) throw new Error(erroProposta.message);
    if (!proposta) {
      return NextResponse.json({ error: "Proposta não encontrada." }, { status: 404 });
    }

    const [movimentos, importados] = await Promise.all([
      sb
        .from("hercules_proposta_etapas")
        .select("proposta_id,de_c2x,para_c2x,de,para,quando,autor_nome,motivo,observacao")
        .eq("proposta_id", propostaId)
        .order("quando", { ascending: false })
        .limit(500),
      sb
        .from("hercules_proposta_eventos")
        .select("proposta_id,tipo,quando,quem,documento,valor,descricao")
        .eq("proposta_id", propostaId)
        .order("quando", { ascending: false })
        .limit(500),
    ]);

    if (movimentos.error) throw new Error(movimentos.error.message);
    if (importados.error) throw new Error(importados.error.message);

    const eventos: EventoDaUnidade[] = historicoDaUnidade(
      [proposta as PropostaDoHistorico],
      (movimentos.data ?? []) as MovimentoDoHistorico[],
      (importados.data ?? []) as EventoImportado[],
    ).sort((a, b) => (a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0));

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
