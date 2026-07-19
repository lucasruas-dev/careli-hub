import { NextResponse } from "next/server";

import { authorizePrometeuRead, authorizePrometeuWrite } from "@/lib/prometeu/auth";
import {
  atualizarEvento,
  createPrometeuClient,
  criarEvento,
  criarMesas,
  listEventos,
} from "@/lib/prometeu/data";
import type { PrometeuEventoConfig } from "@/lib/prometeu/types";

// Eventos do Prometeu (os lancamentos). GET lista, POST cria, PATCH salva o Setup.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizePrometeuRead(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const eventos = await listEventos(client);
  return NextResponse.json({ data: eventos }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await authorizePrometeuWrite(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    dataEvento?: string;
    enterpriseCode?: string;
    enterpriseId?: string;
    nome?: string;
  };

  const { error, evento } = await criarEvento({
    client,
    createdBy: auth.userId,
    dataEvento: body.dataEvento ?? null,
    enterpriseCode: body.enterpriseCode ?? null,
    enterpriseId: body.enterpriseId ?? null,
    nome: body.nome ?? "",
  });

  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ data: evento });
}

// Salva o Setup. As mesas da secretaria sao criadas junto: o numero delas e configuracao do
// evento, e o Atendente precisa que elas existam pra poder chamar.
export async function PATCH(request: Request) {
  const auth = await authorizePrometeuWrite(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    config?: PrometeuEventoConfig;
    dataEvento?: string | null;
    enterpriseCode?: string | null;
    enterpriseId?: string | null;
    eventoId?: string;
    nome?: string;
  };

  if (!body.eventoId) {
    return NextResponse.json({ error: "Informe o eventoId." }, { status: 400 });
  }

  const { error, evento } = await atualizarEvento({
    client,
    config: body.config,
    dataEvento: body.dataEvento,
    enterpriseCode: body.enterpriseCode,
    enterpriseId: body.enterpriseId,
    eventoId: body.eventoId,
    nome: body.nome,
  });

  if (error) return NextResponse.json({ error }, { status: 400 });

  const mesas = body.config?.mesasSecretaria;
  if (mesas && mesas > 0) {
    await criarMesas({
      client,
      eventoId: body.eventoId,
      quantidade: mesas,
      zona: "secretaria",
    });
  }

  return NextResponse.json({ data: evento });
}
