import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { atualizarEtapa, ehEtapaValida } from "@/lib/apolo/esteira";
import { comLimiteDeTempo, gerarESalvarCad } from "@/lib/apolo/salvar-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Move um item da esteira de ETAPA (apolo_esteira). Irmã do PATCH de ficha em [id]/route.ts.
// O Board deixou de ser esqueleto: avançar, indeferir, mandar à revisão e à correção gravam por
// aqui, em vez de viver só no estado local da tela. Ver [[project_esteira_credenciamento_venda]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A transição regenera a CAD (monta PDF + upload); dá folga pra não estourar o tempo da função.
export const maxDuration = 30;

const ehUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    // Qual CAD desta pessoa está sendo movida. `[id]` é a PESSOA; desde a 0080 ela pode ter uma
    // CAD por empreendimento, e a tela manda o `enterpriseId` do card. Sem ele, a mais recente.
    enterpriseId?: unknown;
    etapa?: unknown;
    motivo?: unknown;
  };

  if (!ehEtapaValida(body.etapa)) {
    return NextResponse.json({ error: "Etapa invalida." }, { status: 400 });
  }
  const motivo = typeof body.motivo === "string" ? body.motivo.trim() : "";
  const enterpriseId =
    typeof body.enterpriseId === "string" || typeof body.enterpriseId === "number"
      ? body.enterpriseId
      : null;

  const { bloqueado, error, etapa, semCad } = await atualizarEtapa(adminClient, id, body.etapa, {
    atualizadoPor: auth.userId,
    enterpriseId,
    // motivo só entra quando veio (indeferir/correção exigem motivo); avanço normal não mexe nele.
    motivo: motivo.length ? motivo : undefined,
  });

  // PROBLEMA 2 (Lucas, 04/08): 409, não 500 — um clique manual não pode tirar de "revisao" (crédito
  // reprovado) para avançar. Quem quiser destravar usa o override da coordenação (com evidência),
  // que é a única rota que passa `saidaDeRevisaoAutorizada`.
  if (bloqueado) return NextResponse.json({ error }, { status: 409 });

  // 409, não 500: "não existe CAD para mover" é um pedido incoerente, não uma falha do servidor —
  // e a mensagem já diz ao operador o que resolver.
  if (error) return NextResponse.json({ error }, { status: semCad ? 409 : 500 });

  // Trilha de auditoria, no mesmo padrão do PATCH de ficha: quem moveu, para qual etapa e por quê.
  await adminClient.from("apolo_audit_events").insert({
    action: "etapa_change",
    actor_user_id: ehUuid(auth.userId) ? auth.userId : null,
    entity_id: id,
    field_name: "etapa",
    metadata: { motivo: motivo || null, origem: "board", para: etapa },
    status: "mapped",
  });

  // CAD VIVA: a cada mudança de etapa, regenera a CAD com as informações atuais da ficha (decisão
  // do Lucas — a CAD acompanha o cliente pela esteira). Best-effort E com teto de tempo: a etapa já
  // foi gravada; sob C2X lento a CAD não pode segurar a resposta do clique além do maxDuration.
  try {
    await comLimiteDeTempo(
      gerarESalvarCad(adminClient, id, {
        enterpriseId,
        uploadedByName: ehUuid(auth.userId) ? "Board" : null,
      }),
      20000,
    );
  } catch {
    /* segue */
  }

  return NextResponse.json({ data: { etapa, ok: true } });
}
