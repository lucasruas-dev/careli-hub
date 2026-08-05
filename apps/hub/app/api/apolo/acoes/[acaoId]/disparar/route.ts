import { NextResponse } from "next/server";

import { dispararConvite } from "@/lib/apolo/acao-disparo";
import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Dispara o convite (template) para UM alvo pelo 4143. O operador cai aqui quando marca WhatsApp
// (não conseguiu falar por telefone). Registra o envio na campanha.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ acaoId: string }> },
) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base." }, { status: 503 });

  const { acaoId } = await params;
  const body = (await request.json().catch(() => ({}))) as { alvoId?: string };
  if (!body.alvoId) {
    return NextResponse.json({ error: "Informe o alvoId." }, { status: 400 });
  }

  const resultado = await dispararConvite(client, {
    acaoId,
    alvoId: body.alvoId,
    por: auth.userId,
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }

  return NextResponse.json({ data: { ok: true } });
}
