import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// O BOARD DA TÊMIS — o que cada empreendimento consegue contratar hoje.
//
// Uma chamada devolve a contagem de TODOS os empreendimentos. Fazer uma consulta por empreendimento
// seriam 35 requisições para desenhar uma tela de resumo.
//
// ⚠️ A PERGUNTA QUE O BOARD RESPONDE É "O QUE TRAVA", e não "quantos planos existem". Um
// empreendimento com dez planos e nenhuma minuta publicada não vende: a venda acontece e o contrato
// não sai. Por isso o número que aparece em destaque é o de planos ATIVOS SEM MINUTA.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Contagem = {
  minutasPublicadas: number;
  minutasRascunho: number;
  planosAtivos: number;
  planosSemMinuta: number;
};

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const [planosRes, minutasRes, recepcaoRes] = await Promise.all([
    admin
      .from("temis_planos")
      .select("enterprise_id, ativo, minuta_id")
      .eq("workspace_id", "careli")
      .limit(5000),
    admin
      .from("temis_minutas")
      .select("enterprise_id, situacao")
      .eq("workspace_id", "careli")
      .limit(5000),
    // ⚠️ SÓ OS EMPREENDIMENTOS QUE RECEBEM CAD. Regra do Lucas (02/09/2026): *"os empreendimentos
    // que vamos ter ali no setup será habilitados para aqueles que temos recepção de cad ativo, o
    // resto não precisa mostrar"*. São 11 dos 27 — os outros dezesseis apareciam como "nada
    // cadastrado" e empurravam para baixo justamente os que precisam de atenção. Lista longa de
    // pendência falsa é o mesmo que lista nenhuma.
    admin
      .from("apolo_enterprise_settings")
      .select("enterprise_id")
      .eq("workspace_id", "careli")
      .eq("recepcao_cad", true)
      .limit(500),
  ]);

  // ⚠️ FALHA FECHADA. Devolver contagem zerada num erro de leitura pintaria TODOS os
  // empreendimentos como "nada cadastrado" — e alguém cadastraria tudo de novo por cima.
  if (planosRes.error || minutasRes.error || recepcaoRes.error) {
    return NextResponse.json({ error: "Não consegui montar o board." }, { status: 502 });
  }

  // ⚠️ FALHA FECHADA TAMBÉM AQUI: lista vazia significaria "nenhum empreendimento recebe CAD", e a
  // tela abriria sem nada. Se a leitura não trouxe nenhum, é sinal de problema, não de configuração.
  const recebemCad = new Set((recepcaoRes.data ?? []).map((r) => String(r.enterprise_id)));
  if (recebemCad.size === 0) {
    return NextResponse.json(
      { error: "Não consegui ler quais empreendimentos recebem CAD." },
      { status: 502 },
    );
  }

  const porEmpreendimento = new Map<string, Contagem>();
  const garantir = (id: string): Contagem => {
    const atual = porEmpreendimento.get(id);
    if (atual) return atual;
    const novo: Contagem = {
      minutasPublicadas: 0,
      minutasRascunho: 0,
      planosAtivos: 0,
      planosSemMinuta: 0,
    };
    porEmpreendimento.set(id, novo);
    return novo;
  };

  for (const plano of planosRes.data ?? []) {
    if (!plano.ativo) continue;
    const conta = garantir(plano.enterprise_id as string);
    conta.planosAtivos += 1;
    if (!plano.minuta_id) conta.planosSemMinuta += 1;
  }

  for (const minuta of minutasRes.data ?? []) {
    const conta = garantir(minuta.enterprise_id as string);
    if (minuta.situacao === "publicada") conta.minutasPublicadas += 1;
    else if (minuta.situacao === "rascunho") conta.minutasRascunho += 1;
  }

  // ⚠️ A LISTA DE QUEM RECEBE CAD VIAJA JUNTO, e a tela filtra por ela em vez de decidir sozinha:
  // a regra de quem aparece no Setup é a mesma que o board usa para contar, e duas cópias dela
  // divergiriam no dia em que alguém habilitasse a recepção de um empreendimento novo.
  return NextResponse.json({
    data: {
      contagens: Object.fromEntries(porEmpreendimento),
      recebemCad: [...recebemCad],
    },
  });
}
