import { NextResponse } from "next/server";

import { authorizePrometeuRead } from "@/lib/prometeu/auth";
import {
  createPrometeuClient,
  filaDaRecepcao,
  getEvento,
  listAtividadeRecente,
  listChamadasRecentes,
  listCredenciados,
  listMesas,
} from "@/lib/prometeu/data";

// A fila do evento: credenciados (ja ordenados pela hora do PIX) + mesas. E o que a Central,
// o Atendente e o Telao leem.
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

  const evento = await getEvento(client, eventoId);
  if (!evento) {
    return NextResponse.json({ error: "Evento nao encontrado." }, { status: 404 });
  }

  const [credenciados, mesas, chamadas, atividade] = await Promise.all([
    listCredenciados(client, eventoId),
    listMesas(client, eventoId),
    listChamadasRecentes(client, eventoId),
    listAtividadeRecente(client, eventoId),
  ]);

  // Duas ordens diferentes, de proposito:
  //   credenciados  -> a FILA DO EVENTO (ordem do PIX / ajuste do admin), todos.
  //   filaRecepcao  -> quem JA CHEGOU, nos dois regimes da janela de credenciamento.
  // A tela precisa da segunda pra saber quem chamar; a primeira e o que foi vendido na
  // pre-venda. Confundir as duas inverte a fila no dia.
  return NextResponse.json(
    {
      data: {
        atividade,
        chamadas,
        credenciados,
        evento,
        filaRecepcao: filaDaRecepcao(credenciados),
        mesas,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
