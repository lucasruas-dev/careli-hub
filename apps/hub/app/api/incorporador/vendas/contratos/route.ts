import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { codigosDoPedido } from "@/lib/apolo/incorporador/codigos-do-pedido";
import { empreendimentosDoPortal } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import { TETO_DE_CONTRATOS } from "@/lib/apolo/incorporador/contratos";
import {
  autorizar,
  codigosDaSessao,
  foraDoEscopo,
  idsDosCodigosNoCadastro,
} from "@/lib/apolo/incorporador/escopo";
import { propriosDoPortal } from "@/lib/apolo/incorporador/proprios-do-portal";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { lerContratosDoPanteon } from "@/lib/assinatura/contratos-do-panteon";
import { contratosDoPortal } from "@/lib/assinatura/contratos-do-panteon-montagem";

// CONTRATOS GERADOS — a aba de Vendas do portal do incorporador.
//
// Mesmo esqueleto de /api/incorporador/vendas: o escopo vem do TOKEN (`codigosDaSessao`), o
// parâmetro `emp` só ESCOLHE um empreendimento que já saiu de lá (`codigosDoPedido` reduz, nunca
// amplia), e pedido que não sobra nada é 404 — nunca a visão consolidada.
//
// ⚠️ A LEITURA ÚNICA (F4 da fonte única, 28/09/2026): os contratos saem do Panteon
// (`lerContratosDoPanteon` + `contratosDoPortal`), a mesma leitura da aba Assinatura, e não mais do
// C2X. O botão de PDF leva `contratoId` (o envelope do Panteon) quando há documento; a rota do PDF
// reconfere o escopo pela unidade do envelope antes de qualquer leitura.
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
  // O cadastro e o escopo expandido da sessão: é deles que sai o id de cada código (a leitura é pelo
  // id, não pela sigla).
  const doPanteon = await propriosDoPortal({ catalogo, codesAutorizados, sessao: auth.sessao });

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

  if (codes.length === 0) {
    return foraDoEscopo();
  }

  const traduzido = idsDosCodigosNoCadastro(doPanteon.cadastro, catalogo, codes, doPanteon.idsDaSessao);
  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Não foi possível carregar os contratos agora." }, { status: 503 });
  }
  const leitura = await lerContratosDoPanteon({ admin, escopo: { enterpriseIds: traduzido.ids } });
  if (!leitura.ok) {
    return NextResponse.json({ error: leitura.erro }, { status: 503 });
  }
  const contratos = { data: contratosDoPortal(leitura.contratos, TETO_DE_CONTRATOS) };

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
