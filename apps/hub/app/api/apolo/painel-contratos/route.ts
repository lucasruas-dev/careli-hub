import { after, NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { carregarPainelDeContratos } from "@/lib/apolo/assinaturas/painel-contratos";
import { aquecerD4SignEmSegundoPlano } from "@/lib/guardian/d4sign-consulta";

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

  // ⚠️ O AQUECIMENTO RODA DEPOIS DA RESPOSTA, e é isso que tira a espera da tela. `after()` mantém
  // a função viva depois do envio: o usuário recebe a lista do C2X na hora (0,1 s de SQL) e a
  // D4Sign é buscada em segundo plano, para a próxima carga já sair conciliada. Chamar isto ANTES
  // do `NextResponse.json` desfaz o ganho inteiro — era exatamente a espera de ~12 s que o dono
  // sentiu em 18/08/2026.
  after(() => {
    aquecerD4SignEmSegundoPlano(resultado.uuids ?? []);
  });

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
