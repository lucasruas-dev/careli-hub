import { NextResponse } from "next/server";

import { authorizePrometeuRead, authorizePrometeuWrite } from "@/lib/prometeu/auth";
import { createPrometeuClient, listJanelas, salvarJanela } from "@/lib/prometeu/data";

// Janelas de credenciamento — uma por DIA ("no tal dia sera nessa hora"). E o que decide, no
// instante do bip, se a fila da recepcao segue a ordem do PIX ou a ordem de chegada.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizePrometeuRead(request);
  if (!auth.ok) return auth.response;

  const eventoId = new URL(request.url).searchParams.get("eventoId")?.trim() ?? "";
  if (!eventoId) {
    return NextResponse.json({ error: "Informe o eventoId." }, { status: 400 });
  }

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const janelas = await listJanelas(client, eventoId);
  return NextResponse.json({ data: janelas }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await authorizePrometeuWrite(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    data?: string;
    eventoId?: string;
    horaFim?: string;
    horaInicio?: string;
  };

  if (!body.eventoId || !body.data || !body.horaInicio || !body.horaFim) {
    return NextResponse.json(
      { error: "Informe eventoId, data, horaInicio e horaFim." },
      { status: 400 },
    );
  }

  const { error, ok } = await salvarJanela({
    client,
    data: body.data,
    eventoId: body.eventoId,
    horaFim: body.horaFim,
    horaInicio: body.horaInicio,
  });

  if (!ok) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ data: { ok: true } });
}
