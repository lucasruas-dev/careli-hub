import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { evolucaoDosContratos } from "@/lib/apolo/reajuste/projecao-do-contrato";
import { type CenarioDeProjecao } from "@/lib/apolo/reajuste/projecao";

// A EVOLUÇÃO DA PARCELA — o relatório por cliente, na área Financeira do CRM.
//
// Lucas (23/09/2026): *"um relatório que mostra ao cliente a evolução das parcelas, com base na
// série histórica do índice de correção do contrato, e uma projeção para o futuro"*.
//
// ⚠️ MESMA PORTA DO EXTRATO (`authorizeApoloRead`): quem vê o extrato do cliente vê a evolução
// dele. Não há dado novo aqui — é o mesmo extrato, com o tempo somado.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const CENARIOS = ["conservador", "otimista", "tendencia"] as const;

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);
  if (!authorization.ok) return authorization.response;

  const params = new URL(request.url).searchParams;
  const c2xId = Number(params.get("c2xId"));
  if (!Number.isInteger(c2xId) || c2xId <= 0) {
    return NextResponse.json({ error: "Informe um c2xId valido." }, { status: 400 });
  }

  const contratoParam = params.get("contrato");
  const contratoId = contratoParam ? Number(contratoParam) : null;
  if (contratoParam && (!Number.isInteger(contratoId) || (contratoId ?? 0) <= 0)) {
    return NextResponse.json({ error: "Informe um contrato valido." }, { status: 400 });
  }

  const pedido = params.get("cenario");
  const cenario = CENARIOS.includes(pedido as never)
    ? (pedido as CenarioDeProjecao)
    : undefined;

  try {
    const resultado = await evolucaoDosContratos({ c2xId, cenario, contratoId });
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: 503 });
    }
    return NextResponse.json(
      { data: resultado.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erro) {
    console.error("[apolo][evolucao-da-parcela] falha", erro);
    return NextResponse.json(
      { error: "Não foi possível montar a evolução agora." },
      { status: 500 },
    );
  }
}
