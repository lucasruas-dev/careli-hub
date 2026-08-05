import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { enriquecerPeloMost } from "@/lib/apolo/enriquecer-most";

// Completa pelo MOST o que sobrou depois de aproveitar a ficha do operador.
//
// ⚠️ Esta rota GASTA: cada CPF consultado é cobrado (~R$ 1,06 na CARELI_PF_01). Por isso o padrão
// é `dryRun`, que devolve a lista de quem entraria e a conta estimada SEM chamar a base. Só um
// `dryRun:false` explícito consulta e grava — mesma convenção da rota do lote.
//
// A gravação nunca sobrescreve: `gravarFichaDoLote` só preenche chave vazia.
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
  };

  const resultado = await enriquecerPeloMost({
    dryRun: corpo.dryRun !== false,
    limit: corpo.limit,
  });

  return NextResponse.json({ data: resultado }, { headers: { "Cache-Control": "no-store" } });
}
