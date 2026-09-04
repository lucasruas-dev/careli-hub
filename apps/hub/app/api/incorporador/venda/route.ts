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
import { lerPlanosDoC2x } from "@/lib/apolo/planos-comerciais-c2x";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  espelhosADescartar,
  semEspelhoDuplicado,
} from "@/lib/hercules/sem-espelho-duplicado";
import { carregarCadastroDeEmpreendimentos, soDoPanteon } from "@/lib/hercules/cadastro";
import { expandirIdDoPainel } from "@/lib/hercules/expandir-id-do-painel";
import {
  agregarFluxo,
  type CadsDoEscopo,
  type PropostaDaCarga,
  type UnidadeDoMapa,
} from "@/lib/hercules/fluxo-de-venda";
import { reservaComoLinhaDoFluxo } from "@/lib/hercules/reserva";

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

  // ⚠️ O ESCOPO DO PORTAL É TRADUZIDO EM CÓDIGOS PELO CATÁLOGO DO C2X, e empreendimento que só
  // existe no Panteon não tem código lá. Sem esta linha ele some da tela inteira — sem produto no
  // seletor, sem lote no mapa, e o botão Reservar nunca fica clicável. É tradução, não permissão:
  // `soDoPanteon` filtra pelos ids que a sessão JÁ traz.
  const catalogoDoC2x = await catalogoDeEmpreendimentos(Date.now());
  const idsNoC2x = new Set(catalogoDoC2x.flatMap((e) => e.stageIds.map(String)));
  const cadastroDoPanteon = await carregarCadastroDeEmpreendimentos();
  const proprios = soDoPanteon(
    cadastroDoPanteon,
    await idsDaSessao(auth.sessao),
    idsNoC2x,
  );
  const codesComProprios = [...new Set([...codesAutorizados, ...proprios.map((p) => p.codigo)])];

  if (codesComProprios.length === 0) return indisponivel();

  // O MESMO `emp` das rotas irmas, resolvido pela MESMA funcao: entende "pai:<uuid>" do cadastro,
  // o id numerico de um filho e o id do catalogo. Cadastro fora do ar = 503 (resposta pronta).
  const catalogo = catalogoDoC2x;
  const resolvido = await codigosDoPedido({
    catalogo,
    codesAutorizados: codesComProprios,
    empreendimentos: empreendimentosDoPortal(catalogo, codesAutorizados),
    pedido: new URL(request.url).searchParams.get("emp"),
    proprios,
    sessao: auth.sessao,
  });

  if (!resolvido.ok) return resolvido.response;

  const { codes: codesDoPedido } = resolvido;
  if (codesDoPedido.length === 0) {
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
    // ── O ESPELHO SAI QUANDO OS FILHOS ESTÃO NA MESA ──────────────────────
    //
    // ⚠️ ISTO CONSERTA O CONSOLIDADO. Escolhendo um produto, `expandirIdDoPainel` já devolve só os
    // filhos; mas em "todos os empreendimentos" o escopo trazia o Vale do Ouro QUATRO vezes — o
    // espelho VLO (298 unidades, 165 propostas, R$ 1,5 mi faturado) somado a VOC + VOL + VOR, que
    // são os MESMOS lotes. As 114 unidades do espelho marcadas "vendida" sem proposta nenhuma eram
    // o rastro disso na grade.
    const cadastro = cadastroDoPanteon;

    const idsDoPedido = new Set<string>();
    const doPedido = new Set(codesDoPedido);
    for (const emp of catalogo) {
      emp.codes.forEach((code, i) => {
        const id = emp.stageIds[i];
        if (id && doPedido.has(code)) idsDoPedido.add(String(id));
      });
    }
    // Os do Panteon entram pelo cadastro, que é a única fonte que os conhece.
    for (const proprio of proprios) {
      if (doPedido.has(proprio.codigo)) idsDoPedido.add(proprio.enterpriseId);
    }

    const fora = espelhosADescartar(cadastro, {
      codigos: codesDoPedido,
      idsDoC2x: idsDoPedido,
    });
    const codes = semEspelhoDuplicado(codesDoPedido, fora.codigos);
    const idsDoEscopo = new Set(semEspelhoDuplicado([...idsDoPedido], fora.idsDoC2x));

    // ── As propostas do escopo, em páginas ────────────────────────────────
    const propostas: PropostaDaCarga[] = [];
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await supabase
        .from("hercules_propostas")
        .select(
          "id,codigo,empreendimento_codigo,unidade_id,unidade_nome,etapa,etapa_c2x,etapa_desde,cliente_nome,cliente_documento,imobiliaria_nome,valor,plano_nome,plano_parcelas,contrato_parcelas,plano_correcao,plano_juros,plano_personalizado,data_ato,data_assinatura,data_faturamento,motivo,criado_em_c2x",
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
    // O catálogo traz `codes` e `stageIds` na mesma ordem; é dele que sai a tradução, feita acima.
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

    // ⚠️ O PLANO COMERCIAL AINDA VEM DO C2X, e é o último dado desta tela que vem de lá. Os planos
    // moram em `enterprises` (quatro colunas: à vista, curto, investidor, normal) e `temis_planos`,
    // que é o destino deles no Panteon, está vazia — a frente da Têmis é quem vai preenchê-la, com
    // categoria e minuta ligadas. Popular por fora agora atrapalharia aquele cadastro; quando ele
    // existir, troca-se a fonte aqui e mais nada.
    //
    // ⚠️ FALHA NÃO DERRUBA A TELA: sem plano o simulador cai na conta simples, que é o que ele já
    // fazia. Perder a Venda inteira porque o legado não respondeu seria pior.
    const planos = await lerPlanosDoC2x(codes).catch(() => ({ ok: false }) as const);

    // ── AS RESERVAS NASCIDAS NO PANTEON ───────────────────────────────────
    //
    // ⚠️ ELAS NÃO ESTÃO NA CARGA DO C2X, e não estarão: a reserva do coordenador nasce aqui
    // (`hercules_reservas`, migration 0125). Convertidas em linha do fluxo, entram no funil, na
    // grade, no mapa e na lista analítica pelo mesmo caminho das propostas importadas — sem
    // ensinar cada uma dessas peças a conhecer uma segunda tabela.
    //
    // ⚠️ FALHA AQUI NÃO DERRUBA A TELA. Sem as reservas o coordenador vê o fluxo importado, que é
    // o que ele via ontem; perder a Venda inteira porque a tabela nova respondeu mal seria pior.
    const reservas = await lerReservasVivas(supabase, unidades).catch((erro) => {
      console.error("[incorporador/venda] reservas", erro);
      return [] as PropostaDaCarga[];
    });

    // ── O PISO DE ENTRADA DE CADA EMPREENDIMENTO ──────────────────────────
    //
    // Lucas (03/09/2026): *"vamos ter um campo dentro da parte que vamos cadastrar a política
    // comercial e lá vamos apontar a % mínima"*. O simulador precisa do número do produto DO LOTE:
    // num escopo de pai com filhos há mais de um, e o Garden aceita 8% onde os outros exigem 10%.
    //
    // ⚠️ AUSENTE ≠ ZERO. Empreendimento sem linha aqui não entra no mapa, e a tela cai no padrão da
    // casa. Mandar 0 para quem não cadastrou liberaria venda sem entrada em silêncio.
    const entradaMinima: Record<string, number> = {};
    {
      const { data, error } = await supabase
        .from("apolo_enterprise_settings")
        .select("enterprise_id, entrada_minima_percentual")
        .in("enterprise_id", [...idsDoEscopo]);

      if (error) {
        // Falha de leitura não derruba a tela, mas também não vira "sem mínimo": sem o mapa, o
        // simulador usa o padrão da casa, que é o comportamento conservador.
        console.error("[incorporador/venda] entrada minima", error);
      }
      for (const linha of (data ?? []) as Array<{
        enterprise_id: string;
        entrada_minima_percentual: null | number | string;
      }>) {
        if (linha.entrada_minima_percentual === null || linha.entrada_minima_percentual === undefined) {
          continue;
        }
        const valor = Number(linha.entrada_minima_percentual);
        if (Number.isFinite(valor)) entradaMinima[String(linha.enterprise_id)] = valor;
      }
    }

    return NextResponse.json(
      {
        data: {
          ...agregarFluxo({
            cads,
            periodo,
            propostas: [...reservas, ...propostas],
            unidades,
          }),
          entradaMinima,
          planos: planos.ok ? planos.empreendimentos.flatMap((e) => e.planos) : [],
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    // O detalhe vai para o log; a tela do coordenador não nomeia tabela nem banco.
    console.error("[incorporador/venda]", e);
    return indisponivel();
  }
}

/**
 * As reservas VIVAS das unidades deste escopo, já como linha do fluxo.
 *
 * ⚠️ FILTRA PELAS UNIDADES QUE A TELA JÁ CARREGOU, e não por empreendimento. As unidades vieram
 * filtradas pelo escopo da sessão; usar a mesma lista aqui garante que nenhuma reserva de fora
 * entre pela porta dos fundos, sem repetir a tradução `code → id do C2X`.
 *
 * ⚠️ `.in()` VAI EM LOTES DE 100. São 5.528 unidades: a URL do PostgREST estoura muito antes disso,
 * e o erro é de rede, não de banco — some como "falha ao carregar" sem dizer por quê.
 */
async function lerReservasVivas(
  supabase: ReturnType<typeof createApoloAdminClient>,
  unidades: UnidadeDoMapa[],
): Promise<PropostaDaCarga[]> {
  if (!supabase || unidades.length === 0) return [];

  const porId = new Map(unidades.map((u) => [u.id, u]));
  const ids = [...porId.keys()];
  const linhas: Array<{
    corretor_entity_id: null | string;
    criado_em: string;
    id: string;
    imobiliaria_entity_id: null | string;
    proponentes: unknown;
    unidade_id: string;
    validade_em: null | string;
  }> = [];

  for (let de = 0; de < ids.length; de += 100) {
    const { data, error } = await supabase
      .from("hercules_reservas")
      .select("id,unidade_id,proponentes,imobiliaria_entity_id,corretor_entity_id,criado_em,validade_em")
      .eq("workspace_id", "careli")
      .in("situacao", ["ativa", "proposta"])
      .in("unidade_id", ids.slice(de, de + 100));

    if (error) throw new Error(error.message);
    linhas.push(...((data ?? []) as typeof linhas));
  }

  if (linhas.length === 0) return [];

  // O nome da imobiliária, para a lista e o ranking não mostrarem um uuid.
  const imobiliarias = [
    ...new Set(linhas.map((l) => l.imobiliaria_entity_id).filter((id): id is string => Boolean(id))),
  ];
  const nomePorId = new Map<string, string>();
  if (imobiliarias.length > 0) {
    const { data } = await supabase
      .from("apolo_entities")
      .select("id, display_name, legal_name, trade_name")
      .in("id", imobiliarias);
    for (const e of (data ?? []) as Array<{
      display_name: null | string;
      id: string;
      legal_name: null | string;
      trade_name: null | string;
    }>) {
      nomePorId.set(e.id, (e.trade_name || e.display_name || e.legal_name || "").trim());
    }
  }

  return linhas.map((linha) => {
    const unidade = porId.get(linha.unidade_id) ?? null;
    return reservaComoLinhaDoFluxo(
      {
        criado_em: linha.criado_em,
        id: linha.id,
        imobiliaria_nome: linha.imobiliaria_entity_id
          ? (nomePorId.get(linha.imobiliaria_entity_id) ?? null)
          : null,
        proponentes: linha.proponentes,
        unidade_id: linha.unidade_id,
        validade_em: linha.validade_em,
      },
      unidade
        ? {
            codigo: unidade.codigo,
            lote: unidade.lote,
            // ⚠️ `numeric` do Postgres chega como STRING no PostgREST. Sem o Number, o VGV do
            // funil somaria "136521.00" com um número e viraria concatenação silenciosa.
            preco_tabela: unidade.preco_tabela == null ? null : Number(unidade.preco_tabela),
            quadra: unidade.quadra,
          }
        : null,
      null,
    ) as PropostaDaCarga;
  });
}
