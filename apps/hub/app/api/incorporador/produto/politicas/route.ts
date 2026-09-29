import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { resolverCodigosDoPedido } from "@/lib/apolo/incorporador/codigos-do-pedido";
import { empreendimentosDoPortal } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import {
  autorizar,
  codigosDaSessao,
  idsDaSessao,
  linhasSoDoPanteon,
} from "@/lib/apolo/incorporador/escopo";
import {
  lerCategoriasDoPortal,
  lerPlanosDoPortal,
  lerUnidadesComCategoria,
  montarPoliticasDoProduto,
  type PoliticasDoProduto,
  type ProdutoDoRecorte,
} from "@/lib/apolo/incorporador/politicas-do-produto";
import {
  lerPlanosDoC2xPorIds,
  type PlanosDoEmpreendimento,
} from "@/lib/apolo/planos-comerciais-c2x";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  carregarCadastroDeEmpreendimentos,
  type LinhaDoCadastro,
} from "@/lib/hercules/cadastro";
import { lerFaixasDoPanteon } from "@/lib/hercules/planos-do-panteon";
import {
  espelhosADescartar,
  semEspelhoDuplicado,
} from "@/lib/hercules/sem-espelho-duplicado";

// AS POLÍTICAS COMERCIAIS DE UM PRODUTO NO PORTAL — planos, faixas de prazo e categorias, SÓ LEITURA.
//
// Lucas (16/09/2026): o portal da Cecílio Rocha vira réplica do Hércules operada pelo time deles, e
// os planos de pagamento continuam com a Careli, cadastrados no Apolo, mas VISÍVEIS dentro de
// Produtos, com a ressalva de disponibilidade do plano. A montagem (o que aparece e de onde vem) é
// pura e tem teste: `lib/apolo/incorporador/politicas-do-produto.ts`. Aqui é só escopo e leitura.
//
// ⚠️ NÃO HÁ ESCRITA NESTA ROTA, E NÃO É ESQUECIMENTO. Quem muda plano é a Careli, pela aba Planos
// do empreendimento no Apolo (`/api/temis/planos`, com Bearer do hub). O portal não ganha porta
// para isso nem por PATCH "só da ressalva".
//
// ⚠️ O ESCOPO VEM DO COOKIE, NUNCA DA URL — o mesmo esqueleto da rota da Venda
// (`incorporador/venda/route.ts`), que é a que já conhece o empreendimento que só existe no
// Panteon (`linhasSoDoPanteon`): `codigosDaSessao` é a fonte dos códigos, o `emp` só REDUZ, e o que não é
// da sessão responde 404, igual a produto inexistente. As rotas irmãs `produto/*` ainda traduzem
// só pelo catálogo do C2X; esta nasce com o conserto.
//
// ⚠️ O PAI ENTRA NA LEITURA, NUNCA NO RECORTE. O plano cadastrado só no pai vale para os filhos
// (Lucas, 15/09/2026: *"se eu cadastrar os planos somente no pai, prevalece em todas categorias (se
// tiver) em todos os filhos"*), então os planos e as categorias do pai são LIDOS. Mas o pai não é
// produto desta ficha: suas unidades não são contadas, suas faixas não valem (a Mesa não herda
// faixa) e a categoria dele só aparece se tiver unidade DESTE produto.
//
// ⚠️ CUSTO. Quatro leituras no Supabase quando o time ABRE a aba, e uma no C2X só se algum produto
// não tiver plano no Panteon. Nada aqui pode virar polling.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const indisponivel = () =>
  NextResponse.json(
    { error: "Não foi possível carregar as políticas comerciais agora." },
    { status: 503 },
  );

// (16/09/2026, revisão) O 404 da ABA, com a frase das irmãs (produto/cadastro, produto/unidades): a
// tela mostra o `error` cru, e o "Nao encontrado." de `foraDoEscopo` aparecia sem acento e sem
// sentido. O corpo é o mesmo para produto inexistente e produto de outro portal.
const foraDoRecorte = () =>
  NextResponse.json({ error: "Este produto não está mais no seu recorte." }, { status: 404 });

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  // ⚠️ SEM `emp`, SEM LEITURA. Esta é uma aba DA FICHA de um produto; "todas as políticas de
  // todos os produtos" não é pergunta que a tela faça, e responder a ela seria o caminho mais
  // curto para uma lista enorme que ninguém pediu.
  const pedido = (new URL(request.url).searchParams.get("emp") ?? "").trim();
  if (!pedido) {
    return NextResponse.json({ error: "Informe o produto." }, { status: 400 });
  }

  const supabase = createApoloAdminClient();
  if (!supabase) return indisponivel();

  // O cadastro entra sempre: é dele que sai o pai (herança) e o empreendimento só do Panteon. Sem
  // ele não dá para provar nem uma coisa nem outra, e a resposta é 503, nunca 404.
  let cadastro: LinhaDoCadastro[];
  try {
    cadastro = await carregarCadastroDeEmpreendimentos();
  } catch {
    return indisponivel();
  }

  const [codesAutorizados, catalogo, idsPermitidos] = await Promise.all([
    codigosDaSessao(auth.sessao),
    catalogoDeEmpreendimentos(Date.now()),
    idsDaSessao(auth.sessao),
  ]);
  const permitidos = new Set(idsPermitidos.map((id) => String(id).trim()));

  // Tradução, não permissão: `linhasSoDoPanteon` só devolve ids que a sessão JÁ traz.
  //
  // ⚠️ E COM A TRAVA DO LAB (onda 2, 16/09/2026). `soDoPanteon` puro não conhece a exclusão: numa
  // sessão com o 31, o LAB (fora do catálogo do C2X de propósito) virava produto "próprio" e a aba
  // mostrava as políticas dele. A trava de `linhasSoDoPanteon` é pelo ID (`EXCLUDED_ENTERPRISE_IDS`:
  // 2, 31, 34) desde o PAN-124, e não pela sigla do cadastro, que um renome muda.
  const proprios = linhasSoDoPanteon({
    cadastro,
    catalogo,
    permitidos: idsPermitidos,
  }).map((l) => ({ codigo: l.codigo, enterpriseId: String(l.c2xEnterpriseId) }));
  const codesComProprios = [
    ...new Set([...codesAutorizados, ...proprios.map((p) => p.codigo)]),
  ];

  // Sessão só existe com empreendimento: zero código é o catálogo fora do ar, não falta de permissão.
  if (codesComProprios.length === 0) return indisponivel();

  // A régua única do `emp` ("pai:<uuid>", id numérico, id do catálogo), já cruzada com o escopo.
  const codes = resolverCodigosDoPedido({
    cadastro,
    catalogo,
    codesAutorizados: codesComProprios,
    empreendimentos: empreendimentosDoPortal(catalogo, codesAutorizados),
    pedido,
    permitidos,
    proprios,
  }).map((code) => code.trim().toUpperCase());

  if (codes.length === 0) return foraDoRecorte();

  // Os IDS do C2X por trás dos códigos (as tabelas da Têmis e as unidades guardam id, não código).
  const doPedido = new Set(codes);
  const idsDoPedido = new Set<string>();
  const codigoNoC2x = new Map<string, string>();
  for (const emp of catalogo) {
    emp.codes.forEach((code, i) => {
      const id = emp.stageIds[i];
      const limpo = String(code ?? "").trim().toUpperCase();
      if (!id || !doPedido.has(limpo)) return;
      idsDoPedido.add(String(id));
      codigoNoC2x.set(String(id), limpo);
    });
  }
  for (const proprio of proprios) {
    if (doPedido.has(proprio.codigo.trim().toUpperCase())) idsDoPedido.add(proprio.enterpriseId);
  }

  // ⚠️ O ESPELHO SAI QUANDO OS FILHOS ESTÃO NO RECORTE (pedido pelo id do catálogo de um grupo): o
  // pai não é produto a mais, é de onde os filhos herdam. E o cinto: nenhum id fora da sessão
  // expandida passa, mesmo que a tradução acima errasse.
  const fora = espelhosADescartar(cadastro, { codigos: codes, idsDoC2x: idsDoPedido });
  const idsDoProduto = semEspelhoDuplicado([...idsDoPedido], fora.idsDoC2x).filter((id) =>
    permitidos.has(id),
  );
  if (idsDoProduto.length === 0) return foraDoRecorte();

  const porC2x = new Map<string, LinhaDoCadastro>();
  for (const linha of cadastro) {
    if (linha.c2xEnterpriseId && !porC2x.has(linha.c2xEnterpriseId)) {
      porC2x.set(linha.c2xEnterpriseId, linha);
    }
  }
  const porUuid = new Map(cadastro.map((linha) => [linha.id, linha]));

  const produtos: ProdutoDoRecorte[] = idsDoProduto.map((id) => {
    const linha = porC2x.get(id);
    const pai = linha?.paiId ? porUuid.get(linha.paiId) : undefined;
    const doCatalogo = catalogo.find((e) => e.stageIds.map(String).includes(id));
    return {
      codigo: codigoNoC2x.get(id) ?? linha?.codigo ?? id,
      enterpriseId: id,
      nome: linha?.nome ?? doCatalogo?.name ?? id,
      // O mesmo parentesco que a Venda manda à tela (`paiPorEmpreendimento`).
      paiEnterpriseId:
        pai?.c2xEnterpriseId && pai.c2xEnterpriseId !== id ? pai.c2xEnterpriseId : null,
    };
  });

  const idsDaConfiguracao = [
    ...new Set([
      ...idsDoProduto,
      ...produtos.map((p) => p.paiEnterpriseId).filter((id): id is string => Boolean(id)),
    ]),
  ];

  try {
    // ⚠️ FALHA FECHADA NO SUPABASE: qualquer das quatro lança, e a tela diz "não consegui" em vez
    // de "nenhum plano cadastrado", que seria afirmação de negócio feita por um timeout.
    const [planosDoPanteon, faixas, categorias, unidades] = await Promise.all([
      lerPlanosDoPortal(supabase, idsDaConfiguracao),
      lerFaixasDoPanteon(supabase, idsDoProduto),
      lerCategoriasDoPortal(supabase, idsDaConfiguracao),
      lerUnidadesComCategoria(supabase, idsDoProduto),
    ]);

    // O C2X só é consultado para o produto SEM plano no Panteon: com plano lá, o legado não entraria
    // de qualquer forma (`planosPreferindoOPanteon`), e a consulta ao MySQL seria custo sem uso.
    //
    // ⚠️ PELO ID, E NÃO PELA SIGLA (PAN-124). O id já está na mão (`enterpriseId` do produto); ir ao C2X
    // pela sigla do catálogo era traduzir id → sigla → id, e um renome no meio do caminho (o catálogo
    // relido entre as duas traduções) fazia o plano sumir calado. Continua indo só quem o catálogo
    // conhece (`codigoNoC2x`): produto nascido no Panteon não existe no legado, como antes.
    const comPlanoNoPanteon = new Set(planosDoPanteon.map((p) => p.enterpriseId));
    const idsParaOC2x = produtos
      .filter((p) => !comPlanoNoPanteon.has(p.enterpriseId) && codigoNoC2x.has(p.enterpriseId))
      .map((p) => p.enterpriseId);

    // ⚠️ NULO = O C2X NÃO RESPONDEU, e a montagem marca o bloco como incompleto. Lista vazia seria
    // "respondeu e não há plano", que é outra frase.
    let planosDoC2x: null | PlanosDoEmpreendimento[] = [];
    if (idsParaOC2x.length > 0) {
      const lido = await lerPlanosDoC2xPorIds(idsParaOC2x).catch(
        (erro: unknown) => ({ error: String(erro), ok: false }) as const,
      );
      if (lido.ok) {
        planosDoC2x = lido.empreendimentos;
      } else {
        console.error("[incorporador/produto/politicas] planos do C2X", lido.error);
        planosDoC2x = null;
      }
    }

    const data: PoliticasDoProduto = montarPoliticasDoProduto({
      categorias,
      faixas,
      planosDoC2x,
      planosDoPanteon,
      produtos,
      unidades,
    });

    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    // O detalhe vai para o log; a tela do portal não nomeia tabela nem banco.
    console.error("[incorporador/produto/politicas]", erro);
    return indisponivel();
  }
}
