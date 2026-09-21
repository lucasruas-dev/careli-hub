import { NextResponse } from "next/server";

import { authorizeHadesWrite } from "@/lib/guardian/auth";
import { createGuardianMotorClient } from "@/lib/guardian/compromissos";
import { idDoClienteDaCobranca } from "@/lib/guardian/id-do-cliente";

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

  // ⚠️ A TELA MANDA TEXTO, NÃO NÚMERO. Aqui era `Number(corpo?.clienteId)`, e o id que a cobrança
  // carrega é `c2x-client-3757` (`lib/guardian/read-model.ts`): dava NaN e esta rota respondia 400
  // em TODA tentativa. Medido em 21/09/2026, quase um mês depois de ela existir:
  // `guardian_etapa_manual` com ZERO linhas. É o chamado TI-000138.
  const clienteId = idDoClienteDaCobranca(corpo?.clienteId);
  const etapa = String(corpo?.etapa ?? "").trim();
  const motivo = String(corpo?.motivo ?? "").trim();

  if (clienteId === null) {
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

  // ⚠️ A TABELA DA ETAPA GUARDA UMA LINHA POR CLIENTE, e isso é de propósito (0106: "NÃO É
  // HISTÓRICO ETERNO"): ela responde "em que etapa este cliente está". O HISTÓRICO, que é o que o
  // operador lê no card, vive na timeline manual do Hades — o mesmo canal do resto do módulo
  // (`caredesk_ticket_events` com `guardian_manual_timeline`), já lido pela tela por `client_id`.
  // Sem isto, o segundo comentário apagava o primeiro e o "Histórico de alteração" nunca passava
  // de uma entrada.
  const idDaTela = String(corpo?.clienteId ?? "").trim() || `c2x-client-${clienteId}`;
  // ⚠️ `as never` de novo: o client do motor tipa só as tabelas do Hades, e `caredesk_ticket_events`
  // é da Iris. É a mesma defasagem de tipagem do upsert acima, não gambiarra de dado.
  const { error: erroDoHistorico } = await (admin.from(
    "caredesk_ticket_events" as never,
  ) as never as {
    insert: (linha: Record<string, unknown>) => Promise<{ error: null | { message: string } }>;
  }).insert({
      actor_type: "user",
      actor_user_id: auth.user.id,
      description: motivo,
      event_type: "guardian_manual_timeline",
      metadata: {
        client_id: idDaTela,
        etapa,
        event: { description: motivo, title: `Workflow: ${etapa}` },
        history: [
          {
            action: "Etapa do workflow",
            actorName: auth.user.displayName,
            actorUserId: auth.user.id,
            occurredAt: new Date().toISOString(),
          },
        ],
        kind: "timeline",
        source_module: "guardian",
      },
    title: `Workflow: ${etapa}`,
  });

  // A etapa já está gravada; o histórico é o extra. Quem chamou fica sabendo em vez de supor.
  return NextResponse.json({
    data: { etapa, historicoRegistrado: !erroDoHistorico, ok: true },
  });
}
