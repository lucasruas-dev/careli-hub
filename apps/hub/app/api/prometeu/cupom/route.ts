import { NextResponse, type NextRequest } from "next/server";

import { createPrometeuClient, getEvento } from "@/lib/prometeu/data";
import {
  autorizarOperacao,
  autorizarOperacaoDeEscrita,
} from "@/lib/prometeu/operador-server";
import { ehIdDeCupom, reservasDoGrupo } from "@/lib/prometeu/reservas-evento";

// O CUPOM BIPADO NA ÁREA DE IMPRESSÃO DA PA (Lucas, 24/08).
//
// GET ?grupoId= → a reserva completa do cupom (cliente + unidades + evento) para montar as
// folhas de PA — UMA POR UNIDADE. POST marca a impressão (pa_impressa_em/vezes): é o que faz
// o segundo bip avisar "já impressa às X" e oferecer 2ª via em vez de duplicar papel calado.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const grupoId = (new URL(request.url).searchParams.get("grupoId") ?? "").trim();
  if (!ehIdDeCupom(grupoId)) {
    return NextResponse.json({ error: "Cupom nao reconhecido." }, { status: 400 });
  }

  const { error, reservas } = await reservasDoGrupo(client, grupoId);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (reservas.length === 0) {
    return NextResponse.json({ error: "Cupom nao encontrado." }, { status: 404 });
  }

  const vivas = reservas.filter((r) => r.situacao === "reservada");
  if (vivas.length === 0) {
    return NextResponse.json({ error: "Esta reserva foi cancelada." }, { status: 410 });
  }

  const [{ data: credenciado }, evento] = await Promise.all([
    client
      .from("prometeu_credenciados")
      .select("id, nome, documento, imobiliaria, corretor, evento_id")
      .eq("id", vivas[0]!.credenciadoId)
      .maybeSingle<{
        corretor: null | string;
        documento: null | string;
        evento_id: string;
        id: string;
        imobiliaria: null | string;
        nome: string;
      }>(),
    (async () => {
      const { data } = await client
        .from("prometeu_reservas")
        .select("evento_id")
        .eq("grupo_id", grupoId)
        .limit(1)
        .maybeSingle<{ evento_id: string }>();
      return data ? getEvento(client, data.evento_id) : null;
    })(),
  ]);

  if (!credenciado) {
    return NextResponse.json({ error: "Cliente da reserva nao encontrado." }, { status: 404 });
  }

  return NextResponse.json(
    {
      data: {
        cliente: {
          corretor: credenciado.corretor,
          documento: credenciado.documento,
          imobiliaria: credenciado.imobiliaria,
          nome: credenciado.nome,
        },
        evento: evento
          ? {
              // O texto da PA fala em nome da incorporadora — configurável por evento no
              // Setup (config.paIncorporadora); sem ela, o nome do lançamento assina.
              incorporadora:
                String(
                  (evento.config as Record<string, unknown> | null)?.paIncorporadora ?? "",
                ).trim() || null,
              id: evento.id,
              nome: evento.nome,
            }
          : null,
        reservas: vivas,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const auth = await autorizarOperacaoDeEscrita(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as { grupoId?: unknown } | null;
  const grupoId = String(corpo?.grupoId ?? "").trim();
  if (!ehIdDeCupom(grupoId)) {
    return NextResponse.json({ error: "Cupom nao reconhecido." }, { status: 400 });
  }

  // Leitura-modificação simples (sem corrida real: o posto é um só por evento).
  const { data: linhas } = await client
    .from("prometeu_reservas")
    .select("id, pa_impressa_vezes")
    .eq("grupo_id", grupoId)
    .eq("situacao", "reservada");

  const agora = new Date().toISOString();
  for (const linha of (linhas ?? []) as { id: string; pa_impressa_vezes: number }[]) {
    await client
      .from("prometeu_reservas")
      .update({
        pa_impressa_em: agora,
        pa_impressa_vezes: (linha.pa_impressa_vezes ?? 0) + 1,
        updated_at: agora,
      })
      .eq("id", linha.id);
  }

  return NextResponse.json({ data: { ok: true } });
}
