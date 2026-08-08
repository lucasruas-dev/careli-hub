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
    apenasReconciliar?: boolean;
    dryRun?: boolean;
    limit?: number;
    maxEnvios?: number;
    tentarTodas?: boolean;
  };

  const resultado = await processarLoteC2x({
    // 🔴 MODO CONSERTO: grava quem JÁ ESTÁ no C2X e não envia NINGUÉM.
    //
    // É o par de execução do ensaio para as fichas invisíveis — as que existem no legado sem uma
    // linha sequer na nossa `apolo_c2x_sync` (entraram por importação antiga ou cadastro feito lá
    // dentro), e por isso o card acusa "não subiu" para gente que está lá. Neste modo NÃO existe
    // caminho até o POST, então rodá-lo não pode criar cadastro nenhum.
    //
    // ENSAIO:   { dryRun: true }                            -> conta quantas são, grava NADA.
    // EXECUÇÃO: { dryRun: false, apenasReconciliar: true }   -> grava só a reconciliação, envia
    //                                                          NINGUÉM.
    // (`dryRun: false` sozinho continua sendo o envio real de sempre.)
    apenasReconciliar: corpo.apenasReconciliar === true,
    // Envia de verdade SÓ quando dryRun é explicitamente false. Qualquer outra coisa = simulação.
    dryRun: corpo.dryRun !== false,
    limit: corpo.limit,
    maxEnvios: corpo.maxEnvios,
    tentarTodas: corpo.tentarTodas === true,
  });

  return NextResponse.json({ data: resultado });
}
