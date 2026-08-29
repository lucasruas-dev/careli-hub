import { NextResponse } from "next/server";

import { createPrometeuClient, eventoOperavelId } from "@/lib/prometeu/data";
import { linkDoMasterplan, linkDoTelao } from "@/lib/prometeu/link-do-telao";
import { autorizarOperacao } from "@/lib/prometeu/operador-server";
import { avisarPalcoEmRealtime } from "@/lib/prometeu/realtime-fila";

// O MAESTRO dos telões: um comando aqui muda a música/vídeo de FUNDO de TODAS as TVs do evento
// ao mesmo tempo (broadcast no tópico da fila + estado persistido no evento, para telão que
// ligar depois entrar no mesmo fundo). As CHAMADAS de cada canal não passam por aqui — seguem
// independentes, que é o combinado (pedido do Lucas, 01/08, durante o evento).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Palco = {
  atualizadoEm?: string;
  mudo?: boolean;
  tocando?: boolean;
  videoId?: string | null;
  volume?: number;
};

export async function GET(request: Request) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json(
      { error: "Supabase indisponivel." },
      { status: 503 },
    );
  }
  const eventoId = await eventoOperavelId(client);
  if (!eventoId) {
    return NextResponse.json(
      { error: "Nenhum evento ativo." },
      { status: 404 },
    );
  }

  const { data } = await client
    .from("prometeu_eventos")
    .select("config")
    .eq("id", eventoId)
    .maybeSingle<{ config: Record<string, unknown> | null }>();

  return NextResponse.json(
    {
      data: {
        eventoId,
        // Links da TV INDEPENDENTE (token HMAC, sem login — ver lib/prometeu/link-do-telao.ts).
        // Só saem por aqui, atrás do login do Setup: quem monta a TV copia daqui.
        linksTv: {
          // ⚠️ O do masterplan NÃO MORRE com o evento, ao contrário dos dois de cima — o
          // requisito era "link que nunca expira". Ver linkDoMasterplan em link-do-telao.ts.
          masterplan: linkDoMasterplan(eventoId),
          salao: linkDoTelao(eventoId, "salao"),
          secretaria: linkDoTelao(eventoId, "secretaria"),
        },
        palco: (data?.config?.palco as Palco | undefined) ?? null,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Palco;

  // Só os campos do contrato entram — o payload vai direto para as TVs públicas.
  const comando: Palco = {};
  if (typeof body.videoId === "string" && /^[\w-]{11}$/.test(body.videoId)) {
    comando.videoId = body.videoId;
  }
  if (typeof body.tocando === "boolean") comando.tocando = body.tocando;
  if (typeof body.mudo === "boolean") comando.mudo = body.mudo;
  if (
    typeof body.volume === "number" &&
    body.volume >= 0 &&
    body.volume <= 100
  ) {
    comando.volume = Math.round(body.volume);
  }
  if (Object.keys(comando).length === 0) {
    return NextResponse.json(
      { error: "Nenhum comando reconhecido." },
      { status: 400 },
    );
  }

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json(
      { error: "Supabase indisponivel." },
      { status: 503 },
    );
  }
  const eventoId = await eventoOperavelId(client);
  if (!eventoId) {
    return NextResponse.json(
      { error: "Nenhum evento ativo." },
      { status: 404 },
    );
  }

  // Merge no estado persistido (ler → juntar → gravar): telão que ligar/recarregar depois pega
  // o fundo vigente pelo GET do telão, não só quem estava ouvindo o broadcast na hora.
  const { data: atual } = await client
    .from("prometeu_eventos")
    .select("config")
    .eq("id", eventoId)
    .maybeSingle<{ config: Record<string, unknown> | null }>();

  const palco: Palco = {
    ...((atual?.config?.palco as Palco | undefined) ?? {}),
    ...comando,
    atualizadoEm: new Date().toISOString(),
  };

  const { error } = await client
    .from("prometeu_eventos")
    .update({ config: { ...(atual?.config ?? {}), palco } })
    .eq("id", eventoId);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await avisarPalcoEmRealtime(eventoId, palco as Record<string, unknown>);

  return NextResponse.json({ data: { eventoId, palco } });
}
