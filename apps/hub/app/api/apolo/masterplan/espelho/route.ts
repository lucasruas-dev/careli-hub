import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { espelharMasterplan } from "@/lib/apolo/espelho-masterplan";

// ESPELHO DO MASTERPLAN do Vale do Ouro, de minuto em minuto (cron do vercel.json).
//
// Por que tão rápido: o corretor oferece lote pela COR do mapa (`show_map/35` do C2X). A venda
// acontece no VOC/VOL; se a cor do master demorar a acompanhar, ele oferece um lote já vendido e
// a Careli perde a venda (razão do Lucas, 03/08: "isso tem impacto nas vendas").
//
// CUSTO: em minuto sem movimento é UM SELECT de comparação que volta vazio — sem escrita e sem
// tráfego. Só grava o que realmente divergiu. (Regra de custo da casa, incidente do Hermes.)
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function autorizadoPorCron(request: NextRequest): boolean {
  // Header interno do cron da Vercel: removido de qualquer requisição externa.
  if (request.headers.get("x-vercel-cron")) return true;
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && token === secret);
}

export async function GET(request: NextRequest) {
  if (!autorizadoPorCron(request)) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }
  return executar();
}

// POST = disparo MANUAL pelo hub (botão "atualizar mapa agora"), com sessão de admin.
export async function POST(request: NextRequest) {
  if (!autorizadoPorCron(request)) {
    const auth = await authorizeApoloWrite(request);
    if (!auth.ok) return auth.response;
  }
  return executar();
}

async function executar() {
  const resultado = await espelharMasterplan();
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 503 });
  }
  // Log só quando MUDOU: dia parado não polui, e o que mudou fica auditável nos logs da Vercel.
  if (resultado.atualizadas > 0) {
    console.info(
      `[masterplan] espelho: ${resultado.atualizadas} lote(s) atualizados no VLO ->`,
      resultado.detalhe.map((d) => `${d.nome}:${d.de}->${d.para}`).join(", "),
    );
  }
  return NextResponse.json({ data: resultado }, { headers: { "Cache-Control": "no-store" } });
}
