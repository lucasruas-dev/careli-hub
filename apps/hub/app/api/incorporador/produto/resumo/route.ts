import { NextResponse } from "next/server";

import {
  catalogoDeEmpreendimentos,
  type EmpreendimentoDoCatalogo,
} from "@/lib/apolo/catalogo-empreendimentos";
import { codigosParaOC2x } from "@/lib/apolo/incorporador/cadastro-do-produto";
import {
  pedidoPrecisaDeExpansao,
  resolverCodigosDoPedido,
} from "@/lib/apolo/incorporador/codigos-do-pedido";
import { empreendimentosDoPortal } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import {
  autorizar,
  codigosDaSessao,
  foraDoEscopo,
  idsDaSessao,
} from "@/lib/apolo/incorporador/escopo";
import {
  lerEsteiraDoEscopo,
  lerImobiliariasVinculadas,
} from "@/lib/apolo/incorporador/crm";
import {
  empreendimentosIndisponiveis,
  idsDosProprios,
  lidosDoPanteon,
  propriosDoPortal,
} from "@/lib/apolo/incorporador/proprios-do-portal";
import {
  comIdsDoGrupo,
  montarResumoDoProduto,
  type ResumoDoProduto,
} from "@/lib/apolo/incorporador/resumo-do-produto";
import { createApoloAdminClient } from "@/lib/apolo/server";
import type { ApoloVendaStage } from "@/lib/apolo/vendas";
import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";
import { ehIdDoPai, expandirIdDoPainel } from "@/lib/hercules/expandir-id-do-painel";
import {
  lerSituacaoDasUnidades,
  type SituacaoDaUnidade,
} from "@/lib/hercules/situacao-da-unidade";

// O RESUMO DE UM PRODUTO DO HÉRCULES: a faixa do processo do coordenador.
//
// Lucas (02/09/2026): *"produtos é replicar a tela que temos hoje em empreendimento do apolo"* — a
// aba Resumo da ficha do produto. Os % e R$ do ResumoTab a tela já tem (vêm da linha do painel);
// o que esta rota devolve é o que o painel NÃO sabe: quem vende (imobiliárias, corretores), o
// cadastro (CADs por etapa, credenciados) e a venda (unidades por estágio). Montagem pura em
// `montarResumoDoProduto`, coberta por teste.
//
// ⚠️ A VENDA (unidades por estágio) SAI DA RÉGUA ÚNICA DESDE 18/09/2026, e não mais do C2X. Lucas:
// *"esses status tem que morar em um so lugar"* · *"no c2x não precisa olhar"*. O funil contava o
// estágio da última proposta do legado (e, no produto do Panteon, o `hercules_unidades.situacao`
// cru): a reserva feita no Hércules ou no evento, e a proposta que anda no Panteon, não apareciam.
// Agora cada unidade entra no estágio da situação dela (lib/hercules/situacao-da-unidade.ts), a
// mesma que pinta a Venda e a aba Unidades da ficha.
//
// ⚠️ O ESCOPO VEM DO TOKEN, NUNCA DA URL. É a MESMA resolução do `emp` da rota de Vendas
// (../../vendas/route.ts): `codigosDaSessao` é a única fonte dos códigos, o `emp` só REDUZ, e o
// que não é dele responde 404 — o mesmo que um produto inexistente. A tradução do `emp` é a de
// `codigos-do-pedido.ts` (o núcleo puro, `resolverCodigosDoPedido`), e não uma cópia: a primeira
// versão desta rota copiou a resolução ANTIGA da Vendas (`codesDoRecorte`, que só conhece o id do
// catálogo) e a ficha de um FILHO de empreendimento agrupado (LBF, id "33", aberto pelo chevron
// do Lagoa Bonita) respondia 404 — para um produto que É do coordenador.
//
// ⚠️ DUAS LÍNGUAS. A Vendas lê o C2X por CÓDIGO; a esteira e os vínculos do Apolo filtram por ID,
// e em dois formatos (divisão e grupo). Por isso a rota carrega os dois: `codes` para o funil e
// `enterpriseIds` para as tabelas do Apolo. No caminho expandido (pai ou id numérico),
// `comIdsDoGrupo` completa os ids reais com o grupo que eles cobrem — só quando cobrem o grupo
// INTEIRO e a sessão o tem. É a MESMA regra das rotas irmãs (produto/imobiliarias, contratos) e do
// Board (`recorteDoProduto`): uma CAD gravada como "group:…" entra nas quatro abas ou em nenhuma.
//
// ⚠️ CUSTO. A régua única (poucas páginas do Panteon) + duas leituras do Apolo, quando o
// coordenador ABRE a ficha. Nada aqui pode virar polling.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const indisponivel = () =>
  NextResponse.json(
    { error: "Não foi possível carregar o resumo agora." },
    { status: 503 },
  );

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const codesAutorizados = await codigosDaSessao(auth.sessao);
  const catalogo = await catalogoDeEmpreendimentos(Date.now());

  // ⚠️ O EMPREENDIMENTO QUE SÓ EXISTE NO PANTEON — a mesma expansão da rota /venda, pela peça
  // comum (`propriosDoPortal`; o porquê e a guarda do cadastro estão lá). Sem ela o produto
  // nascido no Panteon respondia 404 nesta aba, com as outras abertas.
  const doPanteon = await propriosDoPortal({
    catalogo,
    codesAutorizados,
    sessao: auth.sessao,
  });

  // Sessão só existe com empreendimento: zero código (nem do C2X, nem do Panteon) é fonte fora do
  // ar, não falta de permissão (mesma leitura da rota de Vendas).
  if (doPanteon.codesComProprios.length === 0) return empreendimentosIndisponiveis();

  const empreendimentos = empreendimentosDoPortal(catalogo, codesAutorizados);

  const pedido = new URL(request.url).searchParams.get("emp");

  // O escopo expandido (grupo + divisões) — o teto de tudo o que sai daqui.
  const permitidos = new Set(doPanteon.idsDaSessao);

  // O pedido pelo PAI ("pai:<uuid>") depende do cadastro do Panteon. Sem cadastro não dá para
  // provar que o pai é dele: 503, e não 404. O id numérico não precisa dele.
  if (ehIdDoPai(pedido) && doPanteon.cadastro === null) return empreendimentosIndisponiveis();
  const cadastro = doPanteon.cadastro ?? [];

  // Os CÓDIGOS, pela régua única (pai → filhos autorizados; id numérico → ele mesmo, se
  // autorizado; id do catálogo → `codesDoRecorte`), sempre cruzados com os autorizados — que
  // agora incluem os do Panteon, e só os que a sessão JÁ traz.
  const codes = resolverCodigosDoPedido({
    cadastro,
    catalogo,
    codesAutorizados: doPanteon.codesComProprios,
    empreendimentos,
    pedido,
    permitidos,
    proprios: doPanteon.proprios,
  });

  // Os IDS do Apolo: no caminho expandido, os ids reais mais o grupo que eles cobrem por inteiro;
  // no id do catálogo, `idsDaSessao(sessao, pedido)` já devolve grupo E divisões dentro do que é
  // dele — e o produto do Panteon pedido pelo CÓDIGO entra pelo id que o cadastro guarda.
  const enterpriseIds = pedidoPrecisaDeExpansao(pedido)
    ? comIdsDoGrupo(expandirIdDoPainel(pedido, cadastro, permitidos), catalogo, permitidos)
    : [
        ...new Set([
          ...(await idsDaSessao(auth.sessao, pedido)),
          ...idsDosProprios(doPanteon.proprios, codes),
        ]),
      ];

  // Pedido que não sobra nada = produto que não é dele. Nunca cai na visão consolidada. Com o
  // cadastro fora do ar pode ser um produto do Panteon que só não deu para traduzir: 503.
  if (codes.length === 0) {
    return doPanteon.cadastro === null ? empreendimentosIndisponiveis() : foraDoEscopo();
  }

  const admin = createApoloAdminClient();
  if (!admin) return indisponivel();

  // OS IDS DO FUNIL, a partir dos CÓDIGOS do pedido — o mesmo recorte que o funil sempre contou.
  //
  // ⚠️ PELOS CÓDIGOS, E NÃO POR `enterpriseIds`. Os dois recortes quase sempre coincidem, mas não
  // sempre: quem tem só a gleba do Fernando (LBF, "33") e abre a linha do grupo ("group:Lagoa
  // Bonita") recebe `codes` = [LBF] e `enterpriseIds` vazio, porque a sessão não tem o grupo. O funil
  // saía com as unidades do LBF; pelos ids, sairia zerado.
  //
  // Os produtos que o Panteon mantém (os próprios e os com DONO MARCADO, `lidosDoPanteon`, a mesma
  // lista da aba Unidades) já vêm com o id; os outros códigos se traduzem pelo catálogo.
  const lidos = lidosDoPanteon({
    cadastro: doPanteon.cadastro,
    codes,
    idsDaSessao: doPanteon.idsDaSessao,
    proprios: doPanteon.proprios,
  });
  const doCatalogo = idsDosCodigos(catalogo, codigosParaOC2x(codes, lidos));

  // Código que ninguém traduz não tem unidade para contar: o funil sairia com "0" onde há venda.
  if (doCatalogo.faltando.length > 0) {
    console.error("[incorporador][produto/resumo] códigos sem id no catálogo", doCatalogo.faltando);
    return indisponivel();
  }

  const idsDoFunil = [...new Set([...doCatalogo.ids, ...lidos.map((lido) => lido.enterpriseId)])];

  // As leituras correm juntas: mesmo escopo, um fetch só na tela.
  const [esteira, imobiliarias, situacoes] = await Promise.all([
    lerEsteiraDoEscopo(admin, enterpriseIds),
    lerImobiliariasVinculadas(admin, enterpriseIds),
    // ⚠️ FALHA DA SITUAÇÃO DERRUBA O RESUMO. Mapa vazio viraria "0 reservas, 0 vendidas".
    lerSituacaoDasUnidades(admin, idsDoFunil).catch((erro: unknown) => {
      console.error("[incorporador][produto/resumo] situação das unidades", erro);
      return null;
    }),
  ]);

  // Qualquer fonte fora do ar derruba o resumo inteiro, de propósito: uma faixa com "0 vendidas"
  // porque a leitura não respondeu é afirmação errada, e afirmação errada na tela do coordenador
  // vira ligação.
  if (!esteira.ok || !imobiliarias.ok || situacoes === null) {
    return indisponivel();
  }

  // ⚠️ UMA UNIDADE POR TERRENO. `unidades` traz só a linha viva de cada lote: pedir o pai (VLO) e as
  // glebas (VOC, VOL) juntos não conta o mesmo lote duas vezes.
  const data: ResumoDoProduto = montarResumoDoProduto({
    esteira: esteira.linhas,
    imobiliarias: imobiliarias.credenciadas,
    unidades: situacoes.unidades.map((unidade) => ({ stage: estagioNoFunil(unidade.situacao) })),
  });

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Os ids do C2X (os que `hercules_unidades.enterprise_id` guarda) destes códigos, pelo catálogo:
 * `codes[i]` é a sigla de `stageIds[i]`. Devolve também o código que o catálogo não achou.
 *
 * ⚠️ OS CÓDIGOS QUE O FUNIL NUNCA CONTOU CONTINUAM FORA (`EXCLUDED_ENTERPRISE_CODES`: teste,
 * laboratório e o espelho do Lagoa Bonita). A leitura antiga do C2X os pulava; trocar a fonte da
 * situação não é motivo para o recorte do funil mudar.
 */
function idsDosCodigos(
  catalogo: readonly EmpreendimentoDoCatalogo[],
  codes: readonly string[],
): { faltando: string[]; ids: string[] } {
  const chave = (code: string) => String(code ?? "").trim().toUpperCase();
  const excluidos = new Set(EXCLUDED_ENTERPRISE_CODES.map(chave));
  const alvo = new Set(codes.map(chave).filter((code) => code && !excluidos.has(code)));

  const achados = new Set<string>();
  const ids: string[] = [];
  for (const emp of catalogo) {
    emp.codes.forEach((code, indice) => {
      const id = String(emp.stageIds[indice] ?? "").trim();
      if (!id || !alvo.has(chave(code))) return;
      achados.add(chave(code));
      ids.push(id);
    });
  }

  return { faltando: [...alvo].filter((code) => !achados.has(code)), ids };
}

/**
 * O estágio do funil de uma situação da régua única.
 *
 * O vocabulário é quase o mesmo; as três traduções são estas:
 *   • `reservada` (do cadastro, sem processo) é reserva, como `reservado`;
 *   • `vendida` sem proposta viva é venda que acabou: conta em Vendidas, como `faturado`;
 *   • `bloqueada` não é venda, e fica com `disponivel`, que a faixa não mostra. Nada aqui diz
 *     "livre": o Resumo não tem esse número.
 */
function estagioNoFunil(situacao: SituacaoDaUnidade): ApoloVendaStage {
  switch (situacao) {
    case "bloqueada":
    case "disponivel":
      return "disponivel";
    case "reservada":
    case "reservado":
      return "reservado";
    case "vendida":
      return "faturado";
    default:
      return situacao;
  }
}
