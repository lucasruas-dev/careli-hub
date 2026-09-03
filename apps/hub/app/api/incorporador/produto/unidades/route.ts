import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { loadApoloEnterpriseUnits } from "@/lib/apolo/empreendimentos";
import { codigosDoPedido } from "@/lib/apolo/incorporador/codigos-do-pedido";
import { empreendimentosDoPortal } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import { autorizar, codigosDaSessao } from "@/lib/apolo/incorporador/escopo";
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
// ⚠️ CUSTO. Uma consulta ao C2X (a mesma da tela interna) + as reservas vivas do Prometeu, quando
// o coordenador ABRE a aba. A atualização depois disso é por broadcast; nada aqui vira polling.
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

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const codesAutorizados = await codigosDaSessao(auth.sessao);

  // Zero código = catálogo do C2X fora do ar, não falta de permissão (mesma leitura da rota de
  // vendas).
  if (codesAutorizados.length === 0) {
    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos agora." },
      { status: 503 },
    );
  }

  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  const empreendimentos = empreendimentosDoPortal(catalogo, codesAutorizados);

  const pedido = new URL(request.url).searchParams.get("emp");

  // O MESMO `emp` das rotas irmãs, resolvido pela MESMA função: é o `empFixo` que a ficha do
  // produto manda ("pai:<uuid>" do cadastro ou o id numérico de um filho). Cadastro fora do ar =
  // 503 (resposta pronta), como nas outras.
  const resolvido = await codigosDoPedido({
    catalogo,
    codesAutorizados,
    empreendimentos,
    pedido,
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
  if (codes.length === 0) {
    return NextResponse.json(
      { error: "Este produto não está mais no seu recorte." },
      { status: 404 },
    );
  }

  try {
    // As duas leituras correm juntas: o tópico não depende das unidades.
    const [result, topico] = await Promise.all([
      loadApoloEnterpriseUnits(codes),
      topicoDoEvento(),
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
    const units = result.units.map((unit) => ({
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
