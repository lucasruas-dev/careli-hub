import { NextResponse } from "next/server";

import { authorizeHadesWrite } from "@/lib/guardian/auth";
import { createGuardianMotorClient } from "@/lib/guardian/compromissos";

// SALVAR A ETAPA DO WORKFLOW escolhida pelo operador.
//
// ⚠️ ISTO NÃO EXISTIA. O card "Workflow operacional" tinha seletor, motivo obrigatório e botão
// "Salvar alteração" prometendo que "fica registrado no histórico" — mas não havia rota nenhuma
// por trás: o componente chamava uma prop opcional que ninguém passava. Medido em 25/08/2026: 435
// dos 437 clientes da cobrança presos em "A acionar" porque nada nunca foi gravado.
//
// A etapa manual mora em tabela própria (0106) e GANHA da automática: o read-model é reescrito
// pelo sync a cada 15 minutos, então gravar lá seria perder a decisão na próxima rodada.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeHadesWrite(request);
  if (!auth.ok) return auth.response;

  const corpo = (await request.json().catch(() => null)) as
    | { clienteId?: number | string; etapa?: string; motivo?: string }
    | null;

  const clienteId = Number(corpo?.clienteId);
  const etapa = String(corpo?.etapa ?? "").trim();
  const motivo = String(corpo?.motivo ?? "").trim();

  if (!Number.isFinite(clienteId) || clienteId <= 0) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }
  if (!etapa) {
    return NextResponse.json({ error: "Informe a etapa." }, { status: 400 });
  }
  // O motivo é obrigatório na tela; a rota não pode ser mais frouxa que ela, senão a explicação
  // de por que a máquina foi contrariada se perde.
  if (!motivo) {
    return NextResponse.json({ error: "Informe o motivo da mudança." }, { status: 400 });
  }

  const admin = createGuardianMotorClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  // ⚠️ `as never` na tabela: os tipos gerados do Supabase ainda não conhecem
  // `guardian_etapa_manual` (migration 0106, criada hoje). O cast some quando os tipos forem
  // regerados — não é gambiarra de dado, é defasagem de tipagem.
  const { error } = await (admin.from("guardian_etapa_manual" as never) as never as {
    upsert: (
      linha: Record<string, unknown>,
      opcoes: { onConflict: string },
    ) => Promise<{ error: null | { message: string } }>;
  }).upsert(
    {
      cliente_c2x_id: clienteId,
      etapa,
      motivo,
      operador_id: auth.user.id,
      operador_nome: auth.user.displayName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "cliente_c2x_id" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ data: { etapa, ok: true } });
}
