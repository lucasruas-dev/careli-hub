import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { loadApoloEnterprises, type ApoloEnterpriseRow } from "@/lib/apolo/empreendimentos";
import { listEnterpriseLogos } from "@/lib/apolo/enterprise-logos";
import {
  cardsDoPanteon,
  cardsSaemSemOC2x,
  juntarCards,
  type ProdutoDoIncorporador as CardDeProduto,
} from "@/lib/apolo/incorporador/cards-do-panteon";
import {
  masterplanInternoDe,
  nomeApresentavel,
} from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import { linhasSoDoPanteon } from "@/lib/apolo/incorporador/escopo";
import { type Cenario, linhasReaisDoC2x } from "@/lib/apolo/incorporador/painel-de-produtos";
import { sessaoDoRequest } from "@/lib/apolo/incorporador/sessao";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  carregarCadastroDeEmpreendimentos,
  type LinhaDoCadastro,
} from "@/lib/hercules/cadastro";
import { lerEstoquePelaRegua } from "@/lib/hercules/estoque-da-situacao";

// PRODUTOS: um card por empreendimento do incorporador logado.
//
// O recorte NÃO vem da query string: sai do cookie assinado. Uma rota de portal externo que
// aceitasse `enterpriseId` do cliente seria a mesma porta que o CRM interno abre de propósito
// para o analista — e aqui de propósito não pode.
//
// ⚠️ DUAS FONTES DESDE 16/09/2026. Os cards do legado seguem vindo do C2X, como sempre; o produto
// que só existe no Panteon vem do cadastro (`cardsDoPanteon`: nome, cidade e UF do cadastro,
// estoque de `hercules_unidades`). C2X fora do ar só deixa de ser 503 quando a sessão é 100% do
// Panteon: a lista sai com `avisoDaFonte`.
//
// ⚠️ A SITUAÇÃO QUE O ESTOQUE CONTA É A DA RÉGUA ÚNICA DESDE 18/09/2026 (`lerEstoqueDosProdutos`,
// abaixo). O card do legado continua sem estoque: nenhum número dele sai do `sale_status_id`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type ProdutoDoIncorporador = CardDeProduto;

const AVISO_DE_CARDS_PARCIAL =
  "Alguns empreendimentos não carregaram agora e podem estar faltando nesta lista.";

/**
 * O Apolo consolida etapas do mesmo produto numa linha só (Lavra do Ouro = LOS + LOU, Lagoa
 * Bonita = três glebas), e a linha consolidada tem id sintético `group:<nome>`, não um id do
 * C2X. A permissão do incorporador é por id REAL, então:
 *
 *   • grupo com TODAS as etapas liberadas -> um card só, com o nome do produto (é assim que o
 *     dono chama: "Lavra do Ouro", não "LOS e LOU");
 *   • grupo com só ALGUMAS liberadas -> um card por etapa, porque juntar somaria número de
 *     empreendimento que este incorporador não pode ver;
 *   • linha simples -> um card, o caso do piloto (Garden e Vale do Ouro não são agrupados).
 */
function recortar(
  linhas: ApoloEnterpriseRow[],
  permitidos: Set<string>,
): ApoloEnterpriseRow[] {
  const saida: ApoloEnterpriseRow[] = [];

  for (const linha of linhas) {
    const etapas = linha.stages ?? [];

    if (etapas.length === 0) {
      if (permitidos.has(String(linha.id))) saida.push(linha);
      continue;
    }

    const liberadas = etapas.filter((etapa) => permitidos.has(String(etapa.id)));

    if (liberadas.length === 0) continue;
    if (liberadas.length === etapas.length) {
      saida.push(linha);
      continue;
    }

    saida.push(...liberadas);
  }

  return saida;
}

function idsReais(linha: ApoloEnterpriseRow): string[] {
  const etapas = linha.stages ?? [];

  return etapas.length > 0
    ? etapas.map((etapa) => String(etapa.id))
    : [String(linha.id)];
}

export async function GET(request: Request) {
  const sessao = sessaoDoRequest(request);

  if (!sessao) {
    return NextResponse.json({ error: "Sessão ausente." }, { status: 401 });
  }

  const permitidos = new Set(sessao.enterpriseIds);
  const comCarteira = new Set(sessao.enterpriseIdsComCarteira);

  // `loadApoloEnterprises` LANÇA quando o MySQL recusa a consulta (só devolve `ok: false` sem
  // configuração): o `.catch` põe as duas quedas no mesmo caminho. O cadastro fora do ar vira
  // `null` e só tira os produtos do Panteon, nunca os do C2X.
  const [c2x, cadastro] = await Promise.all([
    // Só a lista (nome, código, id): a situação das unidades não é usada aqui, e lê-la custaria
    // as propostas e reservas do banco inteiro a cada chamada.
    loadApoloEnterprises({ comSituacao: false }).catch((erro: unknown) => {
      console.error("[incorporador/produtos] C2X indisponível", erro);
      return { error: "C2X indisponível.", ok: false as const };
    }),
    carregarCadastroDeEmpreendimentos().catch((erro: unknown): LinhaDoCadastro[] | null => {
      console.error("[incorporador/produtos] cadastro do Panteon indisponível", erro);
      return null;
    }),
  ]);

  // Quem o C2X conhece: as linhas reais que acabaram de chegar; com o C2X fora, o catálogo (que
  // guarda a última leitura boa por 10 minutos, e vem vazio sem ela).
  const idsNoC2x = c2x.ok
    ? [{ stageIds: [...linhasReaisDoC2x(c2x.data.rows).keys()] }]
    : await catalogoDeEmpreendimentos(Date.now());

  const linhasDoPanteon = linhasSoDoPanteon({ cadastro, catalogo: idsNoC2x, permitidos });

  // ⚠️ C2X FORA COM PRODUTO DO LEGADO NA SESSÃO CONTINUA 503 (ver `cardsSaemSemOC2x`).
  if (!c2x.ok && !cardsSaemSemOC2x({ linhasDoPanteon, permitidos })) {
    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos agora." },
      { status: 503 },
    );
  }

  // Logo por empreendimento (a que o operador sobe na ficha). Falha aqui não derruba a tela: o
  // card cai no nome, mesmo comportamento do LogoEmpreendimento no resto do sistema.
  const admin = createApoloAdminClient();
  const logos: Record<string, string | null> = admin
    ? await listEnterpriseLogos(admin).catch(() => ({}))
    : {};

  // Masterplan de cada empreendimento (0085). Falha aqui não derruba a tela: o card aparece com
  // o botão desligado, que é o mesmo estado de quem ainda não tem mapa publicado.
  const masterplans: Record<string, string> = {};

  if (admin) {
    const { data } = await admin
      .from("apolo_enterprise_settings")
      .select("enterprise_id,masterplan_url")
      .in("enterprise_id", [...permitidos])
      .returns<Array<{ enterprise_id: string; masterplan_url: string | null }>>();

    for (const linha of data ?? []) {
      if (linha.masterplan_url) masterplans[String(linha.enterprise_id)] = linha.masterplan_url;
    }
  }

  const doC2x: ProdutoDoIncorporador[] = (c2x.ok ? recortar(c2x.data.rows, permitidos) : []).map(
    (linha) => {
      const ids = idsReais(linha);
      // Códigos reais desta linha (um na simples, N no produto consolidado).
      const codes = (linha.codes?.length ? linha.codes : [linha.code])
        .filter(Boolean)
        .map((code) => String(code).toUpperCase());

      return {
        // Carteira do produto: basta UMA etapa administrada para a aba fazer sentido no card.
        carteiraAdministrada: ids.some((id) => comCarteira.has(id)),
        cidade: linha.city ?? null,
        code: linha.code ?? "",
        enterpriseIds: ids,
        // O card do legado não conta estoque (ver cards-do-panteon.ts).
        estoque: null,
        id: String(linha.id),
        logoUrl: ids.map((id) => logos[id]).find(Boolean) ?? null,
        masterplanInterno: masterplanInternoDe(codes),
        masterplanUrl: ids.map((id) => masterplans[id]).find(Boolean) ?? null,
        nome: nomeApresentavel(linha.name ?? linha.code ?? "Empreendimento"),
        origem: "c2x" as const,
        // O legado só tem loteamento.
        tipoProduto: "loteamento" as const,
        uf: linha.state ?? null,
      };
    },
  );

  const doPanteon = cardsDoPanteon({
    cadastro,
    comCarteira,
    estoque: await lerEstoqueDosProdutos(linhasDoPanteon),
    idsNoC2x,
    logos,
    masterplans,
    permitidos,
  });

  const produtos = juntarCards(doC2x, doPanteon);

  return NextResponse.json(
    { data: { avisoDaFonte: c2x.ok ? null : AVISO_DE_CARDS_PARCIAL, produtos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * O estoque SÓ dos produtos do Panteon da lista, pela régua única
 * (lib/hercules/situacao-da-unidade.ts, 18/09/2026: *"esses status tem que morar em um so lugar"*).
 *
 * ⚠️ A CONTA NÃO MORA AQUI. Ela é `lerEstoquePelaRegua` (lib/hercules/estoque-da-situacao.ts), a
 * mesma do painel de Produtos e do funil do Resumo: quantidade e preço da linha, situação do terreno,
 * os cinco baldes de `baldeDaSituacao`, e a unidade fora do mapa ocupada. Até 18/09/2026 esta rota
 * tinha a sua cópia, e o card e o painel podiam discordar no dia em que só uma mudasse.
 *
 * ⚠️ FILTRADO POR PRODUTO, E NUNCA A TABELA INTEIRA: esta rota abre junto com o painel na TelaVenda.
 * A régua é chamada UMA vez, com todos os produtos da lista.
 *
 * ⚠️ FALHA NÃO DERRUBA A TELA E NÃO PINTA NADA DE LIVRE: o mapa sai vazio e o card sai com `estoque`
 * nulo (`cardsDoPanteon`), como o do C2X. Nunca com tudo disponível.
 */
async function lerEstoqueDosProdutos(linhas: LinhaDoCadastro[]): Promise<Map<string, Cenario>> {
  const ids = [...new Set(linhas.map((l) => l.c2xEnterpriseId).filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();

  const supabase = createApoloAdminClient();
  if (!supabase) return new Map();

  try {
    return await lerEstoquePelaRegua(supabase, ids);
  } catch (erro) {
    console.error("[incorporador/produtos] estoque do Panteon", erro);
    return new Map();
  }
}
