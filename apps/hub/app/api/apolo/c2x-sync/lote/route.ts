import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { processarLoteC2x } from "@/lib/apolo/c2x-write-server";

// Processa o LOTE de CADs para o C2X. `dryRun` (padrão) só diagnostica: mostra quantas estão
// prontas e o que falta em cada uma — a lista de trabalho do time. `dryRun:false` envia as prontas.
// Autoriza pela sessão admin do hub OU pelo CRON_SECRET (Bearer) — este só para os testes internos.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function autorizadoPorSecret(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && token === secret);
}

export async function POST(request: NextRequest) {
  if (!autorizadoPorSecret(request)) {
    const auth = await authorizeApoloWrite(request);
    if (!auth.ok) return auth.response;
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    dryRun?: boolean;
    limit?: number;
    maxEnvios?: number;
    tentarTodas?: boolean;
  };

  const resultado = await processarLoteC2x({
    // Envia de verdade SÓ quando dryRun é explicitamente false. Qualquer outra coisa = simulação.
    dryRun: corpo.dryRun !== false,
    limit: corpo.limit,
    maxEnvios: corpo.maxEnvios,
    tentarTodas: corpo.tentarTodas === true,
  });

  return NextResponse.json({ data: resultado });
}
