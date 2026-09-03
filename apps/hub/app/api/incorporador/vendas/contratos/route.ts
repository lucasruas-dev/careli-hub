import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { codigosDoPedido } from "@/lib/apolo/incorporador/codigos-do-pedido";
import { empreendimentosDoPortal } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import { lerContratosDoPortal, TETO_DE_CONTRATOS } from "@/lib/apolo/incorporador/contratos";
import { autorizar, codigosDaSessao, foraDoEscopo } from "@/lib/apolo/incorporador/escopo";

// CONTRATOS GERADOS — a aba de Vendas do portal do incorporador.
//
// Mesmo esqueleto de /api/incorporador/vendas: o escopo vem do TOKEN (`codigosDaSessao`), o
// parâmetro `emp` só ESCOLHE um empreendimento que já saiu de lá (`codigosDoPedido` reduz, nunca
// amplia), e pedido que não sobra nada é 404 — nunca a visão consolidada.
//
// O botão de PDF da tela aponta para /api/incorporador/contrato?unitId=…, que reconfere
// `unidadeNoEscopo` antes de qualquer leitura. Nenhum uuid trafega por aqui.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const codesAutorizados = await codigosDaSessao(auth.sessao);

  // Zero código aqui é catálogo do C2X fora do ar, não falta de permissão (a sessão só existe
  // com empreendimento). Mesma decisão da rota de vendas.
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

  const contratos = await lerContratosDoPortal(codes);

  if (!contratos.ok) {
    return NextResponse.json({ error: contratos.error }, { status: 503 });
  }

  return NextResponse.json(
    {
      data: {
        // Teto com aviso, nunca truncamento silencioso. Texto para o cliente: sem travessão e
        // sem jargão interno.
        aviso: contratos.data.truncado
          ? `A lista mostra os ${TETO_DE_CONTRATOS} contratos mais recentes de um total de ${contratos.data.total}. Filtre por empreendimento para ver os demais.`
          : null,
        contratos: contratos.data.contratos,
        filtro: pedido?.trim() ? pedido.trim() : null,
        // Contagem por situação do recorte INTEIRO (antes do teto): os chips da tela contam por
        // ela para não divergirem do total quando a lista corta nos 500 mais recentes.
        porSituacao: contratos.data.porSituacao,
        total: contratos.data.total,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
