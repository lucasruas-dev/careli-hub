import { NextResponse } from "next/server";

import { backfillAtendimentosDaAcao } from "@/lib/apolo/acao-backfill";
import { dispararConvite } from "@/lib/apolo/acao-disparo";
import { sessaoDoRequestAcao } from "@/lib/apolo/acao-sessao";
import {
  lerAcaoPorId,
  listarAlvos,
  resumoDaAcao,
  salvarContato,
  type ContatoCanal,
  type Perfil,
  type UnidadesInteresse,
} from "@/lib/apolo/acoes";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Dados e operações da TELA PÚBLICA (a ação vem do token, não do corpo). GET = a campanha + alvos +
// KPIs. POST = marcar contato ou disparar o convite. Sempre confere que o alvo é DESTA ação.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const sessao = sessaoDoRequestAcao(request);
  if (!sessao) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Indisponível." }, { status: 503 });

  const acao = await lerAcaoPorId(client, sessao.acaoId);
  if (!acao) return NextResponse.json({ error: "Ação não encontrada." }, { status: 404 });

  const [alvos, resumo] = await Promise.all([
    listarAlvos(client, sessao.acaoId),
    resumoDaAcao(client, sessao.acaoId),
  ]);
  return NextResponse.json(
    { data: { acao, alvos, resumo } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const sessao = sessaoDoRequestAcao(request);
  if (!sessao) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Indisponível." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    alvoId?: string;
    canal?: ContatoCanal;
    op?: "contato" | "disparar" | "backfill";
    perfil?: Perfil | null;
    unidades?: UnidadesInteresse | null;
  };

  // Backfill: cria os atendimentos dos disparos já feitos (não reenvia nada). Opera sobre a ação
  // inteira, não precisa de alvoId.
  if (body.op === "backfill") {
    const r = await backfillAtendimentosDaAcao(client, sessao.acaoId);
    return NextResponse.json({ data: r });
  }

  if (!body.alvoId) return NextResponse.json({ error: "Informe o alvoId." }, { status: 400 });

  // O token só pode mexer em alvo da SUA ação.
  const { data: pertence } = await client
    .from("apolo_acao_alvos")
    .select("id")
    .eq("id", body.alvoId)
    .eq("acao_id", sessao.acaoId)
    .maybeSingle<{ id: string }>();
  if (!pertence) {
    return NextResponse.json({ error: "Alvo não pertence a esta ação." }, { status: 403 });
  }

  if (body.op === "disparar") {
    const r = await dispararConvite(client, {
      acaoId: sessao.acaoId,
      alvoId: body.alvoId,
      por: "publico",
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ data: { ok: true } });
  }

  if (!body.canal) return NextResponse.json({ error: "Informe o canal." }, { status: 400 });
  const r = await salvarContato(client, {
    alvoId: body.alvoId,
    canal: body.canal,
    perfil: body.perfil ?? null,
    por: "publico",
    unidades: body.unidades ?? null,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ data: { ok: true } });
}
