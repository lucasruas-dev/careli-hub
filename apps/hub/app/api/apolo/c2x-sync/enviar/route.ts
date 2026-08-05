import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { enviarEntidadeParaC2x } from "@/lib/apolo/c2x-write-server";

// Envia UMA entidade do Apolo para o C2X (escrita de cadastro). É o gatilho unitário: a camada de
// LOTE chama esta mesma função por baixo. Autoriza pela sessão admin do hub OU pelo CRON_SECRET
// (Bearer) — este último só para os testes internos via curl, no mesmo padrão do sync do C2X.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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
    entityId?: string;
    vinculedById?: number;
  };

  if (!corpo.entityId) {
    return NextResponse.json({ error: "Informe entityId." }, { status: 400 });
  }

  const resultado = await enviarEntidadeParaC2x({
    entityId: corpo.entityId,
    vinculedById: corpo.vinculedById,
  });

  return NextResponse.json({ data: resultado });
}
