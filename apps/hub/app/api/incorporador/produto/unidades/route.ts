import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { type ApoloEnterpriseUnit, loadApoloEnterpriseUnits } from "@/lib/apolo/empreendimentos";
import { codigosParaOC2x } from "@/lib/apolo/incorporador/cadastro-do-produto";
import { codigosDoPedido } from "@/lib/apolo/incorporador/codigos-do-pedido";
import { empreendimentosDoPortal } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import { autorizar, codigosDaSessao } from "@/lib/apolo/incorporador/escopo";
import {
  empreendimentosIndisponiveis,
  lidosDoPanteon,
  propriosDoPortal,
} from "@/lib/apolo/incorporador/proprios-do-portal";
import {
  lerUnidadesDoPanteon,
  unidadeDoPanteonNaTela,
} from "@/lib/apolo/incorporador/unidades-do-panteon";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { lerSituacaoDasUnidades } from "@/lib/hercules/situacao-da-unidade";
import { createPrometeuClient, eventoOperavelId } from "@/lib/prometeu/data";
import { topicoDaFila } from "@/lib/prometeu/fila-topic";

// AS UNIDADES DE UM PRODUTO DO HÉRCULES — a aba Unidades dentro de Vendas, na ficha do produto.
//
// Lucas (02/09/2026, olhando a ficha do Jardim das Gerais): *"precisamos trazer a tela de unidades
// para dentro de Venda"*. A tela é a MESMA `UnidadesTab` do Apolo
// (modules/apolo/blocks/empreendimentos/empreendimentos-view.tsx), montada pelo portal com a prop
// `api`; esta rota é a porta dela pelo COOKIE do portal, no lugar do Bearer do hub que
// /api/apolo/empreendimentos/unidades exige (o coordenador não tem sessão no hub).
//
// O PAYLOAD É O MESMO da rota do Apolo, de propósito — `{ data: { realtime: { topico }, units } }`
// — porque a tela é a mesma e lê os dois campos: `units` para a tabela e `realtime.topico` para se
// atualizar sozinha quando alguém reserva no salão durante um lançamento (broadcast, não poll: a
// regra de custo do Panteon desde o incidente de fatura do Hermes).
//
// ⚠️ O ESCOPO VEM DO TOKEN, NUNCA DA URL. Mesmo esqueleto das rotas irmãs (vendas,
// vendas/assinaturas, produto/resumo): `codigosDaSessao` é a única fonte dos códigos, o `emp` só
// REDUZ (`codigosDoPedido` entende os três formatos: "pai:<uuid>", id numérico e id do catálogo),
// e pedido que não sobra nada responde 404 — o mesmo que um produto inexistente (o TEXTO do 404
// é o do portal, não o "Nao encontrado." de `foraDoEscopo`: ver o comentário no ponto).
//
// ⚠️ SEM VOCABULÁRIO INTERNO NA RESPOSTA. O `error` de `loadApoloEnterpriseUnits` nomeia o C2X
// ("Configuracao C2X ausente: …"); a tela interna mostra isso ao time, o portal do coordenador
// não — mesma decisão da rota de assinaturas: aqui sai um texto neutro e o detalhe vai pro log.
//
// ⚠️ NOS DOIS RAMOS, A SITUAÇÃO É A DA RÉGUA ÚNICA (lib/hercules/situacao-da-unidade.ts, 18/09/2026):
// o do C2X já a recebe dentro de `loadApoloEnterpriseUnits`, e o do Panteon a lê ao lado das linhas
// (`lerUnidadesDoPanteonDoPedido`). Do C2X vem o resto da linha, nunca o livre/reservado/vendido; do
// cadastro do Panteon também não (o cadastro é a última palavra da régua, não a tela).
//
// ⚠️ CUSTO. Uma consulta ao C2X (a mesma da tela interna) + as reservas vivas do Prometeu, quando
// o coordenador ABRE a aba. A atualização depois disso é por broadcast; nada aqui vira polling. A
// régua é lida uma vez por ramo: pedido que mistura produto do C2X e do Panteon paga duas (a do C2X
// mora dentro de `loadApoloEnterpriseUnits`, que ainda não aceita uma leitura pronta).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const indisponivel = () =>
  NextResponse.json(
    { error: "Não foi possível carregar as unidades agora." },
    { status: 503 },
  );

// O canal que a tela escuta durante um lançamento — cópia fiel do trecho da rota do Apolo. Sem
// evento operável não há canal, e a tela simplesmente não assina nada.
async function topicoDoEvento(): Promise<null | string> {
  try {
    const prometeu = createPrometeuClient();
    if (!prometeu) return null;
    const eventoId = await eventoOperavelId(prometeu);
    return eventoId ? topicoDaFila(eventoId) : null;
  } catch {
    return null;
  }
}

/**
 * As unidades vivas dos produtos próprios do pedido, já no formato da `UnidadesTab`. Erro lança: o
 * `catch` da rota responde indisponível, nunca "zero unidades".
 *
 * ⚠️ A SITUAÇÃO É A DA RÉGUA ÚNICA (18/09/2026), e não `hercules_unidades.situacao` cru. Lucas: *"tem
 * unidades que estão com reserva, proposta no hercules, que dentro de unidade do apolo não estão com
 * o mesmo status"*. O cadastro não sabe da reserva nem da proposta: o lote reservado na Venda saía
 * "Disponível" nesta aba. Agora as linhas (quadra, lote, área, preço, matrícula) e a régua são lidas
 * juntas, e cada linha é pintada pelo terreno dela (`unidadeDoPanteonNaTela` com `situacoes`), a
 * mesma escrita da tela interna e do ramo do C2X desta rota.
 *
 * ⚠️ FALHA DA RÉGUA LANÇA COMO A DAS LINHAS: tabela com erro, nunca lote pintado de livre.
 */
async function lerUnidadesDoPanteonDoPedido(
  proprios: Array<{ codigo: string; enterpriseId: string }>,
): Promise<ApoloEnterpriseUnit[]> {
  const admin = createApoloAdminClient();
  if (!admin) throw new Error("Supabase indisponível para as unidades do Panteon.");
  const codigoPorId = new Map(proprios.map((p) => [p.enterpriseId, p.codigo]));
  const ids = [...codigoPorId.keys()];
  const [linhas, situacoes] = await Promise.all([
    lerUnidadesDoPanteon(admin, ids),
    lerSituacaoDasUnidades(admin, ids),
  ]);
  return linhas.map((linha) =>
    unidadeDoPanteonNaTela(linha, codigoPorId.get(String(linha.enterprise_id)) ?? "", situacoes),
  );
}

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const codesAutorizados = await codigosDaSessao(auth.sessao);
  const catalogo = await catalogoDeEmpreendimentos(Date.now());

  // ⚠️ O EMPREENDIMENTO QUE SÓ EXISTE NO PANTEON — a mesma expansão da rota /venda, pela peça
  // comum (`propriosDoPortal`; o porquê e a guarda do cadastro estão lá), inclusive os `proprios`
  // que seguem para `codigosDoPedido`.
  const doPanteon = await propriosDoPortal({
    catalogo,
    codesAutorizados,
    sessao: auth.sessao,
  });

  // Zero código (nem do C2X, nem do Panteon) = fonte fora do ar, não falta de permissão (mesma
  // leitura da rota de vendas).
  if (doPanteon.codesComProprios.length === 0) return empreendimentosIndisponiveis();

  const empreendimentos = empreendimentosDoPortal(catalogo, codesAutorizados);

  const pedido = new URL(request.url).searchParams.get("emp");

  // O MESMO `emp` das rotas irmãs, resolvido pela MESMA função: é o `empFixo` que a ficha do
  // produto manda ("pai:<uuid>" do cadastro ou o id numérico de um filho). Cadastro fora do ar =
  // 503 (resposta pronta), como nas outras.
  const resolvido = await codigosDoPedido({
    catalogo,
    codesAutorizados: doPanteon.codesComProprios,
    empreendimentos,
    pedido,
    proprios: doPanteon.proprios,
    sessao: auth.sessao,
  });
  if (!resolvido.ok) return resolvido.response;

  const { codes } = resolvido;

  // ⚠️ NÃO É `foraDoEscopo()` COMO NAS IRMÃS, de propósito. A UnidadesTab mostra o `error` da
  // resposta CRU numa caixa vermelha, e o "Nao encontrado." (sem acento, vocabulário da tela
  // interna) apareceria no portal da Gurgel ao lado dos textos acentuados do resto da ficha — num
  // caso legítimo: o painel recarregado com outro recorte enquanto a ficha estava aberta, ou o
  // pai cujo único filho perdeu a autorização entre a lista e o clique. Mesmo status (404), com
  // o mesmo texto que o ProdutosDoHercules usa quando a linha some do painel.
  //
  // Com o cadastro do Panteon fora do ar, "não sobrou nada" pode ser um produto do Panteon que só
  // não deu para traduzir: 503, e não a afirmação de que saiu do recorte.
  if (codes.length === 0) {
    if (doPanteon.cadastro === null) return empreendimentosIndisponiveis();
    return NextResponse.json(
      { error: "Este produto não está mais no seu recorte." },
      { status: 404 },
    );
  }

  // (16/09/2026, revisão) O PRODUTO QUE SÓ EXISTE NO PANTEON LÊ AS UNIDADES DO PANTEON. Antes o
  // pedido era aceito e a leitura ia só ao C2X, que não conhece o produto: 200 com a tabela vazia.
  // Os códigos que o C2X conhece continuam indo para lá; os próprios vêm de `hercules_unidades`
  // (lib/apolo/incorporador/unidades-do-panteon.ts). Só produto próprio no pedido = nem vai ao C2X.
  //
  // ⚠️ E O PRODUTO COM DONO MARCADO TAMBÉM (D2 do Lucas, 16/09/2026): o Garden da Cecílio tem preço,
  // área e matrícula corrigidos no Panteon, e a carga do C2X não o atualiza mais. `lidosDoPanteon`
  // decide a lista (os próprios mais os com `operado_por`), e o que sobra vai ao C2X como antes.
  const propriosDoPedido = lidosDoPanteon({
    cadastro: doPanteon.cadastro,
    codes,
    idsDaSessao: doPanteon.idsDaSessao,
    proprios: doPanteon.proprios,
  });
  const codesDoC2x = codigosParaOC2x(codes, propriosDoPedido);

  try {
    // As leituras correm juntas: o tópico não depende das unidades.
    const [result, topico, doPanteonNoPedido] = await Promise.all([
      codesDoC2x.length > 0
        ? loadApoloEnterpriseUnits(codesDoC2x)
        : Promise.resolve({ ok: true as const, units: [] }),
      topicoDoEvento(),
      propriosDoPedido.length > 0
        ? lerUnidadesDoPanteonDoPedido(propriosDoPedido)
        : Promise.resolve([]),
    ]);

    if (!result.ok) {
      console.error("[incorporador][produto/unidades] C2X indisponível:", result.error);
      return indisponivel();
    }

    // ⚠️ SEM AS CHAVES INTERNAS DAS PESSOAS NO PAYLOAD. Cada unidade traz o comprador e a
    // imobiliária da última movimentação com `code` (o user_code do C2X: "CLI4168", "IMO58") e
    // `entityId` (o uuid da ficha no Apolo, `deterministicUuid`). A tela do portal não desenha
    // nenhum dos dois — o PartyLink sem `onOpenEntity` já cai no ramo de texto — mas o JSON
    // viaja para o navegador de um cliente externo, e a aba Rede mostra tudo. Mesma decisão da
    // rota irmã de assinaturas (Lucas, 18/08/2026): a limpeza é no SERVIDOR, não na tela. O
    // shape continua EXATAMENTE o da UnidadesTab (os campos existem, só vazios), e a tela
    // interna (/api/apolo/empreendimentos/unidades) segue recebendo tudo.
    const units = [...result.units, ...doPanteonNoPedido].map((unit) => ({
      ...unit,
      movement: unit.movement
        ? {
            ...unit.movement,
            client: unit.movement.client
              ? { ...unit.movement.client, code: null, entityId: null }
              : null,
            imobiliaria: unit.movement.imobiliaria
              ? { ...unit.movement.imobiliaria, code: null, entityId: null }
              : null,
          }
        : null,
    }));

    return NextResponse.json(
      { data: { realtime: { topico }, units } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[incorporador][produto/unidades] falha ao carregar unidades", error);
    return indisponivel();
  }
}
