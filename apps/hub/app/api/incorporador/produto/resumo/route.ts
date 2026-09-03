import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
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
  comIdsDoGrupo,
  montarResumoDoProduto,
  type ResumoDoProduto,
} from "@/lib/apolo/incorporador/resumo-do-produto";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { loadApoloEnterpriseVendas } from "@/lib/apolo/vendas";
import {
  carregarCadastroDeEmpreendimentos,
  type LinhaDoCadastro,
} from "@/lib/hercules/cadastro";
import { ehIdDoPai, expandirIdDoPainel } from "@/lib/hercules/expandir-id-do-painel";

// O RESUMO DE UM PRODUTO DO HÉRCULES: a faixa do processo do coordenador.
//
// Lucas (02/09/2026): *"produtos é replicar a tela que temos hoje em empreendimento do apolo"* — a
// aba Resumo da ficha do produto. Os % e R$ do ResumoTab a tela já tem (vêm da linha do painel);
// o que esta rota devolve é o que o painel NÃO sabe: quem vende (imobiliárias, corretores), o
// cadastro (CADs por etapa, credenciados) e a venda (unidades por estágio). Montagem pura em
// `montarResumoDoProduto`, coberta por teste.
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
// ⚠️ CUSTO. Uma leitura do C2X (a mesma da aba Vendas) + duas do Apolo, quando o coordenador ABRE
// a ficha. Nada aqui pode virar polling.
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

  // Sessão só existe com empreendimento: zero código é catálogo do C2X fora do ar, não falta de
  // permissão (mesma leitura da rota de Vendas).
  if (codesAutorizados.length === 0) {
    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos agora." },
      { status: 503 },
    );
  }

  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  const empreendimentos = empreendimentosDoPortal(catalogo, codesAutorizados);

  const pedido = new URL(request.url).searchParams.get("emp");

  // O escopo expandido (grupo + divisões) — o teto de tudo o que sai daqui.
  const permitidos = new Set(await idsDaSessao(auth.sessao));

  // O cadastro do Panteon só entra quando o pedido é o PAI ("pai:<uuid>"). Sem cadastro não dá
  // para provar que o pai é dele: 503, e não 404. O id numérico não precisa dele.
  let cadastro: LinhaDoCadastro[] = [];
  if (ehIdDoPai(pedido)) {
    try {
      cadastro = await carregarCadastroDeEmpreendimentos();
    } catch {
      return NextResponse.json(
        { error: "Não foi possível carregar os empreendimentos agora." },
        { status: 503 },
      );
    }
  }

  // Os CÓDIGOS, pela régua única (pai → filhos autorizados; id numérico → ele mesmo, se
  // autorizado; id do catálogo → `codesDoRecorte`), sempre cruzados com `codesAutorizados`.
  const codes = resolverCodigosDoPedido({
    cadastro,
    catalogo,
    codesAutorizados,
    empreendimentos,
    pedido,
    permitidos,
  });

  // Os IDS do Apolo: no caminho expandido, os ids reais mais o grupo que eles cobrem por inteiro;
  // no id do catálogo, `idsDaSessao(sessao, pedido)` já devolve grupo E divisões dentro do que é
  // dele.
  const enterpriseIds = pedidoPrecisaDeExpansao(pedido)
    ? comIdsDoGrupo(expandirIdDoPainel(pedido, cadastro, permitidos), catalogo, permitidos)
    : await idsDaSessao(auth.sessao, pedido);

  // Pedido que não sobra nada = produto que não é dele. Nunca cai na visão consolidada.
  if (codes.length === 0) {
    return foraDoEscopo();
  }

  const admin = createApoloAdminClient();
  if (!admin) return indisponivel();

  // As três leituras correm juntas: mesmo escopo, um fetch só na tela.
  const [esteira, imobiliarias, vendas] = await Promise.all([
    lerEsteiraDoEscopo(admin, enterpriseIds),
    lerImobiliariasVinculadas(admin, enterpriseIds),
    loadApoloEnterpriseVendas(codes),
  ]);

  // Qualquer fonte fora do ar derruba o resumo inteiro, de propósito: uma faixa com "0 vendidas"
  // porque o C2X não respondeu é afirmação errada, e afirmação errada na tela do coordenador
  // vira ligação.
  if (!esteira.ok || !imobiliarias.ok || !vendas.ok) return indisponivel();

  const data: ResumoDoProduto = montarResumoDoProduto({
    esteira: esteira.linhas,
    imobiliarias: imobiliarias.credenciadas,
    unidades: vendas.data.units,
  });

  return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
}
