import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { lerAssinaturasDoPortal } from "@/lib/apolo/incorporador/assinaturas";
import {
  codesDoRecorte,
  empreendimentosDoPortal,
} from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import { autorizar, codigosDaSessao, foraDoEscopo } from "@/lib/apolo/incorporador/escopo";

// GESTÃO DE ASSINATURA — a aba de Vendas do portal do incorporador.
//
// Mesmo esqueleto de /api/incorporador/vendas: escopo do TOKEN (`codigosDaSessao`), `emp` só
// reduz (`codesDoRecorte`), pedido que não sobra nada é 404. As regras de fila (assinado / na
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
  const codes = codesDoRecorte(empreendimentos, pedido);

  if (codes.length === 0) {
    return foraDoEscopo();
  }

  const quadro = await lerAssinaturasDoPortal(codes);

  if (!quadro.ok) {
    return NextResponse.json({ error: quadro.error }, { status: 503 });
  }

  return NextResponse.json(
    {
      data: {
        ...quadro.data,
        filtro: pedido?.trim() ? pedido.trim() : null,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
