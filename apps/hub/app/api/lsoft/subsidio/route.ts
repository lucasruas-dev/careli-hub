import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { lerParcelasDeSubsidio } from "@/lib/lsoft/classificacao";

// A TELA DO SUBSÍDIO DA CAIXA — as parcelas do financiamento, uma a uma.
//
// Pedido do Lucas (25/08/2026): *"eu queria uma tela diferente para os subsidio, eu precisava
// enxergar esses valores separados... parcela por parcela"*. A lista da carteira responde
// "quanto o cliente deve"; esta responde "o que a Caixa tem para pagar", item a item.
//
// Leitura usa a porta de leitura (mesmo padrão do módulo). Quem DECIDE passa por
// /api/lsoft/classificacao, que exige permissão de escrita.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const resultado = await lerParcelasDeSubsidio({
    busca: url.searchParams.get("busca"),
    empreendimento: url.searchParams.get("empreendimento") ?? "Vale do Sol",
    situacao: url.searchParams.get("situacao"),
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 400 });

  return NextResponse.json({ data: { linhas: resultado.linhas, resumo: resultado.resumo } });
}
