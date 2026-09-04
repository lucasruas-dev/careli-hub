import { NextResponse } from "next/server";

import { loadApoloEnterprises } from "@/lib/apolo/empreendimentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import {
  montarPainelDeProdutos,
  type PainelDeProdutos,
} from "@/lib/apolo/incorporador/painel-de-produtos";
import { sessaoDoRequest } from "@/lib/apolo/incorporador/sessao";
import {
  carregarCadastroDeEmpreendimentos,
  type LinhaDoCadastro,
} from "@/lib/hercules/cadastro";
import {
  estoquePorEmpreendimento,
  type PropostaDaCarga,
  type UnidadeDoMapa,
} from "@/lib/hercules/fluxo-de-venda";

// O PAINEL DE PRODUTOS DO HÉRCULES: os seis cards e a tabela pai/filhos da aba Produtos.
//
// Lucas (02/09/2026): *"queria trazer aquela tela que temos no empreendimento (...) vendas tem que
// morar dentro da tela de produtos"*. Mesma tela de Empreendimentos do Apolo, mas agrupada pelo
// CADASTRO DO PANTEON (hercules_empreendimentos) e recortada pela sessão do portal.
//
// O recorte NÃO vem da query string: sai do cookie assinado (mesma regra de ../route.ts). O
// cadastro diz quem é pai de quem, e a montagem é pura (`montarPainelDeProdutos`), coberta por
// teste.
//
// ⚠️ OS NÚMEROS VÊM DO PANTEON DESDE 04/09/2026, e não mais do C2X. Lucas, vendo o empreendimento
// de teste com 12 unidades na tela Venda e ZERO aqui: *"a informação de unidades tem que ser
// alimentada de um local somente"* e *"o panteon tem que ler do panteon"*. As duas telas
// respondiam a mesma pergunta por fontes diferentes — a Venda contava `hercules_unidades`, esta
// contava `enterprise_unities` do legado.
//
// A troca foi MEDIDA antes: as 5.528 unidades batem uma a uma nos 35 empreendimentos, então
// nenhum número de incorporador se mexe. O que muda é que empreendimento cadastrado só aqui
// deixa de aparecer zerado, e a classificação passa a ser a MESMA da Venda — inclusive a coluna
// "Em negociação", que o legado tinha em `sale_status_id` e que a importação não trouxe: ela volta
// pela PROPOSTA, que sabe dizer se está em proposta, contrato ou assinatura.
//
// O C2X continua entrando para a MOLDURA (quais linhas existem, nome e cidade de quem não está no
// cadastro do Panteon) — não para contar unidade.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type PainelDeProdutosDoIncorporador = PainelDeProdutos;

export async function GET(request: Request) {
  const sessao = sessaoDoRequest(request);

  if (!sessao) {
    return NextResponse.json({ error: "Sessão ausente." }, { status: 401 });
  }

  // As três leituras não dependem uma da outra: C2X (números), sessão expandida (escopo) e
  // cadastro (agrupamento) correm juntas.
  //
  // ⚠️ O CADASTRO É ENRIQUECIMENTO, O ESCOPO NÃO. Cadastro fora do ar degrada: todo
  // empreendimento vira linha simples com o nome do C2X (é a tela antiga, sem pai/filho) — melhor
  // que um 503 no painel inteiro. Já o C2X é a fonte dos números: sem ele não há painel.
  const [c2x, permitidos, cadastro, estoque] = await Promise.all([
    loadApoloEnterprises(),
    idsDaSessao(sessao),
    carregarCadastroDeEmpreendimentos().catch((): LinhaDoCadastro[] => []),
    lerEstoqueDoPanteon(),
  ]);

  if (!c2x.ok) {
    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos agora." },
      { status: 503 },
    );
  }

  const painel = montarPainelDeProdutos({
    cadastro,
    estoque,
    linhasDoC2x: c2x.data.rows,
    permitidos: new Set(permitidos),
  });

  return NextResponse.json(
    { data: painel },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * O estoque de cada empreendimento, contado no Panteon.
 *
 * ⚠️ PAGINA NAS DUAS LEITURAS. São 5.528 unidades e 4.857 propostas, e o PostgREST corta em 1.000
 * linhas SEM ERRO: sem paginar, a tela mostraria um estoque silenciosamente truncado — que é pior
 * do que uma tela vazia, porque parece certo.
 *
 * ⚠️ FALHA NÃO DERRUBA A TELA: sem estoque, cada linha aparece zerada e o resto do painel (nomes,
 * agrupamento, quem é pai de quem) continua de pé.
 */
async function lerEstoqueDoPanteon() {
  const supabase = createApoloAdminClient();
  if (!supabase) return new Map();

  const PAGINA = 1000;

  try {
    const unidades: UnidadeDoMapa[] = [];
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await supabase
        .from("hercules_unidades")
        .select("id,codigo,quadra,lote,situacao,preco_tabela,enterprise_id")
        .eq("workspace_id", "careli")
        .range(de, de + PAGINA - 1);
      if (error) throw new Error(error.message);
      unidades.push(...((data ?? []) as UnidadeDoMapa[]));
      if ((data?.length ?? 0) < PAGINA) break;
    }

    const propostas: PropostaDaCarga[] = [];
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await supabase
        .from("hercules_propostas")
        .select("id,unidade_id,etapa,etapa_desde,criado_em_c2x")
        .eq("workspace_id", "careli")
        .range(de, de + PAGINA - 1);
      if (error) throw new Error(error.message);
      propostas.push(...((data ?? []) as PropostaDaCarga[]));
      if ((data?.length ?? 0) < PAGINA) break;
    }

    return estoquePorEmpreendimento({ propostas, unidades });
  } catch (erro) {
    console.error("[incorporador/produtos/painel] estoque do Panteon", erro);
    return new Map();
  }
}
