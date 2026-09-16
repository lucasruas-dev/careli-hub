import { NextResponse } from "next/server";

import { loadApoloEnterprises } from "@/lib/apolo/empreendimentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import {
  decidirPainelDeProdutos,
  montarPainelDeProdutos,
  type PainelDeProdutos,
} from "@/lib/apolo/incorporador/painel-de-produtos";
import { sessaoDoRequest } from "@/lib/apolo/incorporador/sessao";
import { lerCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
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
  // que um 503 no painel inteiro.
  //
  // ⚠️ E O C2X VIROU MOLDURA (16/09/2026): sem ele o painel sai pelo cadastro do Panteon, com
  // aviso, em vez de 503 — senão o produto que só existe no Panteon sumia junto com o legado. A
  // regra inteira está em `decidirPainelDeProdutos`. `loadApoloEnterprises` lança quando o MySQL
  // recusa a consulta (ele só devolve `ok: false` sem configuração): o `.catch` põe as duas
  // quedas no mesmo caminho.
  const [c2x, permitidos, cadastro, estoque] = await Promise.all([
    loadApoloEnterprises().catch((erro: unknown) => {
      console.error("[incorporador/produtos/painel] C2X indisponível", erro);
      return { error: "C2X indisponível.", ok: false as const };
    }),
    idsDaSessao(sessao),
    // `lerCadastro...` (e não `carregar...`) porque o painel precisa saber se a 0170 veio: sem a
    // coluna `operado_por`, nenhuma linha acende escrita no portal que confecciona (fail-closed).
    lerCadastroDeEmpreendimentos().catch(() => null),
    lerEstoqueDoPanteon(),
  ]);

  // ⚠️ `podeEscrever` DE CADA LINHA (decisão do Lucas, 16/09/2026): no portal que confecciona, só no
  // produto que ele opera. É dica para a tela esconder botão; cada rota de escrita confere de novo,
  // com a sessão revalidada (`autorizarEscritaNoProduto`). O cookie aqui só diz QUEM pergunta.
  const decidido = decidirPainelDeProdutos({
    cadastroRespondeu: cadastro !== null,
    c2xRespondeu: c2x.ok,
    painel: montarPainelDeProdutos({
      cadastro: cadastro?.linhas ?? [],
      com0170: cadastro?.com0170 === true,
      estoque,
      linhasDoC2x: c2x.ok ? c2x.data.rows : [],
      permitidos: new Set(permitidos),
      portal: { incorporadorId: sessao.incorporadorId, slug: sessao.slug, tipo: sessao.tipo },
    }),
  });

  if (!decidido.ok) {
    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos agora." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { data: decidido.painel },
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
