import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// LOG DE ERROS do cadastro público: o que barrou quem tentou enviar CAD ou se credenciar.
//
// Alimentado no `responder()` das rotas públicas (lib/publico/cad/log-erros.ts). Aqui só se lê.
//
// ⚠️ LEITURA AUTENTICADA. A tabela guarda quem tentou (corretor e imobiliária) e é acessível só
// pela service role; esta rota é a única porta, e ela exige sessão do Apolo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DIAS_PADRAO = 7;
const TETO = 500;

type ItemDoLog = {
  corretor_cpf_mascarado: null | string;
  corretor_nome: null | string;
  created_at: string;
  duracao_ms: null | number;
  enterprise_id: null | string;
  enterprise_nome: null | string;
  id: string;
  imobiliaria_cnpj_mascarado: null | string;
  imobiliaria_nome: null | string;
  mensagem: null | string;
  origem_hash: null | string;
  rota: string;
  status: number;
};

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  const dias = Math.min(Math.max(Number(params.get("dias") ?? DIAS_PADRAO) || DIAS_PADRAO, 1), 90);
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

  // `count: "exact"` junto da página: o total do período tem que ser o NÚMERO REAL, não o tamanho
  // da página. Sem isso, um dia ruim com 3.000 recusas apareceria como "500 tentativas" e passaria
  // por normal — o oposto do que a tela existe para mostrar.
  const { count, data, error } = await adminClient
    .from("apolo_cad_log_erros")
    .select(
      // ⚠️ `imobiliaria_cnpj_mascarado` E `enterprise_id` ENTRAM AQUI de propósito. No fluxo de
      // credenciamento a imobiliária ainda não existe como entidade, então o único identificador
      // que a linha tem é o CNPJ — sem selecioná-lo, a coluna "Quem" ficaria "—" em todo o
      // credenciamento, que é justo o fluxo onde o Lucas viu o problema. O `enterprise_id` é o que
      // permite mostrar o empreendimento pelo código (VLO, LBF), já que o nome raramente é anotado.
      "id, rota, status, mensagem, corretor_nome, corretor_cpf_mascarado, imobiliaria_nome, imobiliaria_cnpj_mascarado, enterprise_id, enterprise_nome, origem_hash, duracao_ms, created_at",
      { count: "exact" },
    )
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(TETO);

  if (error) {
    // Tabela ausente = migration não aplicada naquele ambiente. Responde vazio com aviso, em vez
    // de erro cru: a tela diz "sem registros ainda" e o operador não abre chamado.
    if (error.code === "42P01" || /does not exist/i.test(error.message)) {
      return NextResponse.json({
        data: { itens: [], indisponivel: "O log de erros ainda não foi criado neste ambiente." },
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const itens = (data ?? []) as ItemDoLog[];

  // O empreendimento é anotado como ID do C2X, que não diz nada a quem lê a tela. O CÓDIGO (VLO,
  // LBF, GDN) é o vocabulário do time. Uma consulta ao Supabase resolve todos de uma vez — de
  // propósito não vamos ao C2X buscar o nome completo: seria acoplar a tela de log ao legado por
  // um rótulo.
  const ids = [...new Set(itens.map((i) => i.enterprise_id).filter(Boolean))] as string[];
  const codigoPorId = new Map<string, string>();

  if (ids.length > 0) {
    const { data: settings } = await adminClient
      .from("apolo_enterprise_settings")
      .select("enterprise_id, code")
      // Lotes de 100: `.in()` com muitos ids estoura o tamanho da URL do PostgREST (400).
      .in("enterprise_id", ids.slice(0, 100));

    for (const linha of (settings ?? []) as { code: null | string; enterprise_id: string }[]) {
      if (linha.code) codigoPorId.set(String(linha.enterprise_id), linha.code);
    }
  }

  const comEmpreendimento = itens.map((item) => ({
    ...item,
    enterprise_nome:
      item.enterprise_nome ??
      (item.enterprise_id ? (codigoPorId.get(item.enterprise_id) ?? null) : null),
  }));

  // Resumos que respondem as perguntas do Lucas: "qual imobiliária mais erra" e "o que mais barra".
  const contar = (chave: (i: (typeof comEmpreendimento)[number]) => null | string) => {
    const mapa = new Map<string, number>();
    for (const item of comEmpreendimento) {
      const valor = chave(item);
      if (!valor) continue;
      mapa.set(valor, (mapa.get(valor) ?? 0) + 1);
    }
    return [...mapa.entries()]
      .map(([nome, total]) => ({ nome, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  };

  return NextResponse.json(
    {
      data: {
        itens: comEmpreendimento,
        // ⚠️ OS RESUMOS SAEM DAS `itens`, ou seja, das 500 mais recentes — não do período inteiro.
        // A tela avisa isso quando `truncado`, para ninguém ler o ranking como se fosse completo.
        //
        // No credenciamento a imobiliária ainda não tem ficha, então o único identificador é o
        // CNPJ. Sem o `??`, o fluxo inteiro de credenciamento sumiria deste ranking.
        porImobiliaria: contar((i) => i.imobiliaria_nome ?? i.imobiliaria_cnpj_mascarado),
        porMotivo: contar((i) => i.mensagem),
        porRota: contar((i) => i.rota),
        // ⚠️ CONTADO NO SERVIDOR, sobre o período inteiro. O "sem saída" que a tela mostra é da
        // página; este é o total de verdade. São denominadores diferentes e a tela precisa dizer
        // isso, senão as duas frases parecem falar do mesmo conjunto.
        semSaidaNoPeriodo: comEmpreendimento.filter((i) => i.status < 400).length,
        totalNoPeriodo: count ?? comEmpreendimento.length,
        truncado: (count ?? comEmpreendimento.length) > comEmpreendimento.length,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
