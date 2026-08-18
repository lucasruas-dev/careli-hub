import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { carregarPainelDeContratos } from "@/lib/apolo/assinaturas/painel-contratos";

// TELA CONTRATOS DO APOLO — a fila de assinatura dos contratos, por unidade.
//
// ⚠️ AQUI O `emp` DA QUERY STRING É ACEITO, e é a diferença desta rota para `/api/apolo/painel-
// assinatura` (escopo fixo) e para a rota do portal (escopo do token). O motivo: quem chama já
// passou por `authorizeApoloRead` — é o time da Careli, que vê a carteira inteira e escolhe o
// empreendimento na tela. Mesmo assim o código NÃO vira filtro cru: `resolverCodes` o confronta
// com a lista de empreendimentos que o próprio C2X devolveu, e o que não existe cai no padrão.
//
// O cache de 5 minutos POR RECORTE mora na lib, não aqui: assim o número de abas abertas não vira
// número de consultas no legado (pool de 5 conexões).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const parametro = new URL(request.url).searchParams.get("emp") ?? "";
  // "*" = todos os empreendimentos; vazio = o recorte padrão (o Vale do Ouro de hoje: VOC + VOL).
  const pedidos = parametro
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  const resultado = await carregarPainelDeContratos(pedidos);

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
