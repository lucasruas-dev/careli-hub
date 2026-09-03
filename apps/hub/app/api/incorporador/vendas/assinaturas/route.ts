import { after, NextResponse } from "next/server";

import { aquecerD4SignEmSegundoPlano } from "@/lib/guardian/d4sign-consulta";
import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { lerAssinaturasDoPortal } from "@/lib/apolo/incorporador/assinaturas";
import { codigosDoPedido } from "@/lib/apolo/incorporador/codigos-do-pedido";
import { empreendimentosDoPortal } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import { autorizar, codigosDaSessao, foraDoEscopo } from "@/lib/apolo/incorporador/escopo";

// GESTÃO DE ASSINATURA — a aba de Vendas do portal do incorporador.
//
// Mesmo esqueleto de /api/incorporador/vendas: escopo do TOKEN (`codigosDaSessao`), `emp` só
// reduz (`codigosDoPedido`), pedido que não sobra nada é 404. As regras de fila (assinado / na
// vez / aguardando) são as do painel interno, importadas em lib/apolo/incorporador/assinaturas.
//
// Os NOMES dos assinantes do fluxo aparecem (decisão já comunicada ao dono). Telefone e e-mail
// não atravessam.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const codesAutorizados = await codigosDaSessao(auth.sessao);

  // Zero código = catálogo do C2X fora do ar, não falta de permissão. Mesma decisão da rota de
  // vendas.
  if (codesAutorizados.length === 0) {
    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos agora." },
      { status: 503 },
    );
  }

  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  const empreendimentos = empreendimentosDoPortal(catalogo, codesAutorizados);

  const pedido = new URL(request.url).searchParams.get("emp");

  // ⚠️ O MESMO `emp` DA ROTA DE VENDAS, RESOLVIDO PELA MESMA FUNÇÃO. A TelaVendas manda para cá o
  // `empFixo` que o "Ver mais" da aba Produtos abriu ("pai:<uuid>" do cadastro do Panteon, ou o
  // id numérico de um filho). Só `codesDoRecorte` aqui não entendia nenhum dos dois e a visão
  // respondia 404 para um produto que É do coordenador. Cadastro fora do ar = 503 (resposta
  // pronta), como na rota de vendas.
  const resolvido = await codigosDoPedido({
    catalogo,
    codesAutorizados,
    empreendimentos,
    pedido,
    sessao: auth.sessao,
  });
  if (!resolvido.ok) return resolvido.response;

  const { codes } = resolvido;

  if (codes.length === 0) {
    return foraDoEscopo();
  }

  const quadro = await lerAssinaturasDoPortal(codes);

  if (!quadro.ok) {
    return NextResponse.json({ error: quadro.error }, { status: 503 });
  }

  // ⚠️ O QUE NÃO ATRAVESSA PARA O PORTAL, e por quê.
  //
  // 1. DIAGNÓSTICO. `montarQuadroComD4Sign` devolve `cancelados` (ids crus de
  //    `contract_signatures`) e `resumoDaFonte` (a contabilidade da reconciliação). Não é dado
  //    pessoal, mas é dado NOSSO, e este payload vai para o navegador de um cliente externo.
  //
  // 2. O VOCABULÁRIO INTERNO — decisão do Lucas em 18/08/2026, olhando a faixa no portal:
  //    *"não queria esse tipo de comunicado para o incorporador"*. Os avisos da lib nomeiam os
  //    sistemas ("o D4Sign confirmou… a marcação vem do sistema antigo (C2X)"), o que na tela do
  //    time é precisão e na vitrine do loteador é tripa à mostra: ele não decide nada com essa
  //    informação e ela só passa insegurança sobre o produto. Então saem daqui: o
  //    `avisoDosAssinantes` (que no Vale do Ouro ficava aceso todo dia) e o `aviso` de cada linha.
  //
  // ⚠️ A LIMPEZA É NO SERVIDOR, DE PROPÓSITO. Esconder na tela deixaria o texto técnico viajando
  // no JSON, visível a qualquer um que abra a aba de rede — o portal não fala de C2X nem em
  // payload. E a tela interna (/apolo/assinaturas) continua recebendo tudo, que é onde a decisão
  // de cobrar acontece.
  //
  // ⚠️ A QUEDA DA FONTE CONTINUA SENDO DITA, com outras palavras. Se a confirmação não acontece, o
  // que está na tela pode mostrar como pendente uma assinatura já colhida — calar isso seria
  // mentir por omissão. O texto abaixo diz o EFEITO (pode faltar atualizar) sem nomear sistema
  // nenhum, e é raro por construção: só aparece quando a confirmação falha de verdade.
  const { cancelados: _cancelados, resumoDaFonte: _resumoDaFonte, ...paraTela } = quadro.data;

  const AVISO_DE_ATUALIZACAO =
    "Estamos confirmando as assinaturas mais recentes. Alguns contratos podem levar alguns minutos para aparecer atualizados aqui.";

  // Ver o comentário gêmeo em app/api/apolo/painel-contratos/route.ts: o aquecimento roda DEPOIS
  // da resposta, e é isso que tira a espera da tela.
  after(() => {
    aquecerD4SignEmSegundoPlano(quadro.uuids);
  });

  return NextResponse.json(
    {
      data: {
        ...paraTela,
        avisoDaFonte: paraTela.avisoDaFonte ? AVISO_DE_ATUALIZACAO : null,
        avisoDosAssinantes: null,
        filtro: pedido?.trim() ? pedido.trim() : null,
        unidades: paraTela.unidades.map(({ aviso: _aviso, fonte: _fonte, ...unidade }) => unidade),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
