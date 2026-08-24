import { NextResponse, type NextRequest } from "next/server";

import { createPrometeuClient, eventoOperavelId, getEvento } from "@/lib/prometeu/data";
import { linkDoRelatorio } from "@/lib/prometeu/link-do-relatorio";
import { autorizarOperacao } from "@/lib/prometeu/operador-server";

// A TELA RELATÓRIOS (Inteligência de Dados): devolve os DOIS links públicos do lançamento —
// comercial e performance — para pré-visualizar em iframe e copiar/encaminhar.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  let eventoId = (params.get("eventoId") ?? "").trim();
  if (!eventoId) eventoId = (await eventoOperavelId(client)) ?? "";
  if (!eventoId) {
    return NextResponse.json({ error: "Nenhum lancamento em andamento." }, { status: 404 });
  }

  const evento = await getEvento(client, eventoId);
  if (!evento || evento.arquivadoEm) {
    return NextResponse.json({ error: "Lancamento nao encontrado." }, { status: 404 });
  }

  const comercial = linkDoRelatorio(eventoId, "comercial");
  const performance = linkDoRelatorio(eventoId, "performance");
  if (!comercial || !performance) {
    return NextResponse.json(
      { error: "Segredo de assinatura ausente no ambiente (SESSAO_CAD_SECRET)." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { data: { comercial, eventoId, performance } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
