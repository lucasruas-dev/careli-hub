import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { carregarPainelAssinatura, VALE_DO_OURO } from "@/lib/apolo/painel-assinatura";

// Painel de assinatura de contratos (por enquanto, Vale do Ouro).
//
// O cache de 5 minutos mora na lib, não aqui: assim ele vale para qualquer chamador e o número
// de abas abertas não vira número de consultas no legado.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  // ⚠️ A lista de empreendimentos NÃO vem da query string: é escopo, e escopo que o cliente
  // escolhe é escopo que o cliente burla. Quando outros empreendimentos entrarem, a escolha vem
  // de uma lista fechada no servidor.
  const resultado = await carregarPainelAssinatura(VALE_DO_OURO);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.erro }, { status: 503 });
  }

  return NextResponse.json(
    { data: resultado.dados },
    {
      headers: {
        // O navegador pode reusar por 1 min; o cache de verdade (5 min) é o do servidor.
        "Cache-Control": "private, max-age=60",
      },
    },
  );
}
