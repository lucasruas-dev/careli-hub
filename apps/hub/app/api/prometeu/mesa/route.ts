import { NextResponse } from "next/server";

import { createPrometeuClient, sairDaMesa, sentarNaMesa } from "@/lib/prometeu/data";
import { autorizarOperacao } from "@/lib/prometeu/operador-server";

// QUEM ESTÁ ATENDENDO em cada mesa. O atendente "senta" ao entrar na mesa pela tela do Atendente e
// "sai" ao trocar/sair — é o que o Mapa do salão da Central mostra. Aceita a sessão do hub (admin
// testando) OU o cookie do operador do evento (freela, no dia). O nome vem do cliente (o próprio
// atendente-view já sabe quem está logado), então não há join no servidor.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    acao?: "sentar" | "sair";
    mesaId?: string;
    nome?: string;
  };

  if (!body.mesaId) {
    return NextResponse.json({ error: "Informe o mesaId." }, { status: 400 });
  }

  const resultado =
    body.acao === "sair"
      ? await sairDaMesa({ client, mesaId: body.mesaId })
      : await sentarNaMesa({ client, mesaId: body.mesaId, nome: body.nome ?? "" });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }

  return NextResponse.json({ data: { ok: true } });
}
