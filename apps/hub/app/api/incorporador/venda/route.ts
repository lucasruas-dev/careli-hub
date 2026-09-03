import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import {
  codigosDoPedido,
  pedidoPrecisaDeExpansao,
} from "@/lib/apolo/incorporador/codigos-do-pedido";
import { lerEsteiraDoEscopo } from "@/lib/apolo/incorporador/crm";
import { empreendimentosDoPortal } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import { autorizar, codigosDaSessao, idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { comIdsDoGrupo } from "@/lib/apolo/incorporador/resumo-do-produto";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { expandirIdDoPainel } from "@/lib/hercules/expandir-id-do-painel";
import {
  agregarFluxo,
  type CadsDoEscopo,
  type PropostaDaCarga,
  type UnidadeDoMapa,
} from "@/lib/hercules/fluxo-de-venda";

/** As etapas da esteira que já PARARAM: virou credenciado, ou não seguiu. */
const ETAPAS_FINAIS = new Set(["credenciado", "indeferido"]);

const COMPETENCIA = /^\d{4}-\d{2}$/;

// O FLUXO DE VENDA — a tela Venda lendo o PANTEON, e não mais o legado.
//
// Lucas (03/09/2026): *"quero importar todos os dados do c2x, eles tem que existir dentro do
// panteon (...) e quero que hoje isso seja visto dentro do panteon"*. A carga trouxe 4.853
// propostas e 12.269 movimentações de etapa (`scripts/hercules/importar-fluxo-de-venda.mjs`); esta
// rota é a porta delas.
//
// ⚠️ O QUE MUDA EM RELAÇÃO A /api/incorporador/vendas. Aquela rota consulta o C2X a cada carga —
// duas consultas pesadas no MySQL do legado, e a tela morre junto se o legado cair. Esta lê o
// Supabase. O número é o mesmo porque a carga veio de lá; o dono do dado é que mudou.
//
// ⚠️ O ESCOPO VEM DO COOKIE, NUNCA DA URL — o mesmo esqueleto das rotas irmãs: `codigosDaSessao` é
// a única fonte, `emp` só REDUZ, e pedido que não sobra nada responde 404.
//
// ⚠️ PostgREST CORTA EM 1.000 LINHAS SEM ERRO. São 4.853 propostas e 5.528 unidades: as duas
// leituras PAGINAM, e a agregação é feita aqui (`agregarFluxo`, com teste). Sem a paginação a
// tela mostraria um funil silenciosamente truncado — que é pior do que uma tela vazia.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const PAGINA = 1000;

const indisponivel = () =>
  NextResponse.json({ error: "Não foi possível carregar o fluxo de venda agora." }, { status: 503 });

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const supabase = createApoloAdminClient();
  if (!supabase) return indisponivel();

  const codesAutorizados = await codigosDaSessao(auth.sessao);
  if (codesAutorizados.length === 0) return indisponivel();

  // O MESMO `emp` das rotas irmas, resolvido pela MESMA funcao: entende "pai:<uuid>" do cadastro,
  // o id numerico de um filho e o id do catalogo. Cadastro fora do ar = 503 (resposta pronta).
  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  const resolvido = await codigosDoPedido({
    catalogo,
    codesAutorizados,
    empreendimentos: empreendimentosDoPortal(catalogo, codesAutorizados),
    pedido: new URL(request.url).searchParams.get("emp"),
    sessao: auth.sessao,
  });

  if (!resolvido.ok) return resolvido.response;

  const { codes } = resolvido;
  if (codes.length === 0) {
    return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
  }

  // O recorte de tempo do painel. Vale para desempenho (faturamento, cancelamento, ranking,
  // série); a faixa do fluxo continua mostrando o pipeline VIVO — ver `agregarFluxo`.
  const url = new URL(request.url);
  const de = (url.searchParams.get("de") ?? "").trim();
  const ate = (url.searchParams.get("ate") ?? "").trim();
  const periodo = {
    ate: COMPETENCIA.test(ate) ? ate : undefined,
    de: COMPETENCIA.test(de) ? de : undefined,
  };

  try {
    // ── As propostas do escopo, em páginas ────────────────────────────────
    const propostas: PropostaDaCarga[] = [];
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await supabase
        .from("hercules_propostas")
        .select(
          "id,codigo,empreendimento_codigo,unidade_id,unidade_nome,etapa,etapa_c2x,etapa_desde,cliente_nome,cliente_documento,imobiliaria_nome,valor,plano_nome,data_ato,data_assinatura,data_faturamento,motivo,criado_em_c2x",
        )
        .eq("workspace_id", "careli")
        .in("empreendimento_codigo", codes)
        .order("etapa_desde", { ascending: false })
        .range(de, de + PAGINA - 1);

      if (error) throw new Error(error.message);
      propostas.push(...((data ?? []) as PropostaDaCarga[]));
      if ((data?.length ?? 0) < PAGINA) break;
    }

    // ── As unidades, para o mapa do estoque ───────────────────────────────
    //
    // ⚠️ AQUI A CHAVE É OUTRA, E ISSO JÁ CUSTOU UM MAPA VAZIO. `hercules_propostas` guarda o CÓDIGO
    // do empreendimento ("JDG"), mas `hercules_unidades.enterprise_id` guarda o ID NUMÉRICO do C2X
    // ("39") — foi assim que a carga das unidades gravou. Filtrar as duas pelo mesmo `codes` não
    // dá erro nenhum: devolve zero unidade, e a tela mostra um mapa em branco com o funil cheio.
    // O catálogo traz `codes` e `stageIds` na mesma ordem; é dele que sai a tradução.
    const idsDoEscopo = new Set<string>();
    const doEscopo = new Set(codes);
    for (const emp of catalogo) {
      emp.codes.forEach((code, i) => {
        const id = emp.stageIds[i];
        if (id && doEscopo.has(code)) idsDoEscopo.add(String(id));
      });
    }

    const unidades: UnidadeDoMapa[] = [];
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await supabase
        .from("hercules_unidades")
        .select("id,codigo,quadra,lote,situacao,preco_tabela,enterprise_id")
        .eq("workspace_id", "careli")
        .in("enterprise_id", [...idsDoEscopo])
        .range(de, de + PAGINA - 1);

      if (error) throw new Error(error.message);
      unidades.push(...((data ?? []) as UnidadeDoMapa[]));
      if ((data?.length ?? 0) < PAGINA) break;
    }

    // ── As CADs: o começo do processo, que mora no Apolo e não no fluxo importado ──
    //
    // Pedido do Lucas: *"quantas cads foram geradas, quantas reservas, propostas"* — na mesma
    // escada. ⚠️ A esteira filtra por ID (e em dois formatos: divisão e "group:Nome"), enquanto o
    // fluxo filtra por CÓDIGO: é a mesma tradução que a rota do resumo do produto faz, e sem
    // `comIdsDoGrupo` uma CAD gravada no grupo não entraria em nenhum recorte.
    const permitidos = new Set(await idsDaSessao(auth.sessao));
    const pedido = url.searchParams.get("emp");
    let enterpriseIds: string[] = [];
    if (pedidoPrecisaDeExpansao(pedido)) {
      // ⚠️ A funcao devolve a LISTA e lanca quando o Supabase falta — nao um { ok, linhas }.
      // O catch da rota ja traduz a queda em 503; aqui nao ha o que conferir.
      const cadastro = await carregarCadastroDeEmpreendimentos();
      enterpriseIds = comIdsDoGrupo(
        expandirIdDoPainel(pedido, cadastro, permitidos),
        catalogo,
        permitidos,
      );
    } else {
      enterpriseIds = await idsDaSessao(auth.sessao, pedido ?? undefined);
    }

    const esteira = await lerEsteiraDoEscopo(supabase, enterpriseIds);
    let cads: CadsDoEscopo | null = null;
    if (esteira.ok) {
      // Uma CAD é uma PESSOA (entity_id), e a mesma pessoa pode aparecer em mais de uma linha da
      // esteira: contar linhas infla o topo do funil.
      const porPessoa = new Map<string, string>();
      for (const l of esteira.linhas) {
        const etapa = String(l.etapa ?? "").trim().toLowerCase();
        porPessoa.set(String(l.entity_id), etapa);
      }
      const etapas = [...porPessoa.values()];
      cads = {
        credenciados: etapas.filter((e) => e === "credenciado").length,
        emAndamento: etapas.filter((e) => !ETAPAS_FINAIS.has(e)).length,
        emCorrecao: etapas.filter((e) => e === "correcao").length,
        reprovadas: etapas.filter((e) => e === "indeferido").length,
        total: etapas.length,
      };
    }

    return NextResponse.json(
      { data: agregarFluxo({ cads, periodo, propostas, unidades }) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    // O detalhe vai para o log; a tela do coordenador não nomeia tabela nem banco.
    console.error("[incorporador/venda]", e);
    return indisponivel();
  }
}
