import { NextResponse, type NextRequest } from "next/server";

import {
  authorizeHadesRead,
  authorizeHadesWrite,
  type HadesAuthUser,
} from "@/lib/guardian/auth";
import { parseCreatePayload } from "@/app/api/guardian/compromissos/route";
import {
  createGuardianMotorClient,
  deleteGuardianCompromisso,
  getGuardianCompromissoDetail,
  replaceGuardianCompromissoDraft,
  updateGuardianCompromisso,
  type GuardianCompromissoDetail,
  type GuardianCompromissoStage,
  type GuardianCompromissoStatus,
  type UpdateCompromissoStageInput,
} from "@/lib/guardian/compromissos";
import { createSupabaseAdminClient } from "@/lib/guardian/read-model-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STAGES: GuardianCompromissoStage[] = [
  "aguardando_pagamento",
  "aguardando_emissao",
  "emitido",
  "enviado",
];

const STATUSES: GuardianCompromissoStatus[] = [
  "ativo",
  "cumprido",
  "quebrado",
  "cancelado",
];

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authorizeHadesRead(request);

  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const client = createGuardianMotorClient();

  if (!client) {
    return NextResponse.json(
      { error: "Configure a chave server-side para acessar a cobranca." },
      { status: 503 },
    );
  }

  const detail = await getGuardianCompromissoDetail(client, id);

  if (!detail) {
    return NextResponse.json(
      { error: "Compromisso nao encontrado." },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: detail });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await authorizeHadesWrite(request);

  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!body) {
    return NextResponse.json({ error: "Payload ausente." }, { status: 400 });
  }

  const update: UpdateCompromissoStageInput = {};
  const stage = body.stage;
  const status = body.status;

  if (typeof stage === "string") {
    if (!STAGES.includes(stage as GuardianCompromissoStage)) {
      return NextResponse.json({ error: "Stage invalido." }, { status: 400 });
    }

    update.stage = stage as GuardianCompromissoStage;
  }

  if (typeof status === "string") {
    if (!STATUSES.includes(status as GuardianCompromissoStatus)) {
      return NextResponse.json({ error: "Status invalido." }, { status: 400 });
    }

    update.status = status as GuardianCompromissoStatus;
  }

  if (update.stage === undefined && update.status === undefined) {
    return NextResponse.json(
      { error: "Informe stage ou status para atualizar." },
      { status: 400 },
    );
  }

  const client = createGuardianMotorClient();

  if (!client) {
    return NextResponse.json(
      { error: "Configure a chave server-side para atualizar a cobranca." },
      { status: 503 },
    );
  }

  const detail = await updateGuardianCompromisso(
    client,
    id,
    update,
    auth.user.id,
  );

  if (!detail) {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar o compromisso." },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: detail });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authorizeHadesWrite(request);

  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | { reason?: string }
    | null;
  const reason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : null;

  // Motivo obrigatorio: sem ele nao exclui (decisao do Lucas).
  if (!reason) {
    return NextResponse.json(
      { error: "Informe o motivo da exclusao." },
      { status: 400 },
    );
  }

  const client = createGuardianMotorClient();

  if (!client) {
    return NextResponse.json(
      { error: "Configure a chave server-side para excluir a proposta." },
      { status: 503 },
    );
  }

  const detail = await getGuardianCompromissoDetail(client, id);

  if (!detail) {
    return NextResponse.json(
      { error: "Proposta nao encontrada." },
      { status: 404 },
    );
  }

  // Registra a exclusao na timeline do cliente ANTES de apagar (auditavel; o
  // compromisso e suas notas somem no cascade).
  await emitDeletionNote({ detail, reason, user: auth.user });

  const ok = await deleteGuardianCompromisso(client, id);

  if (!ok) {
    return NextResponse.json(
      { error: "Nao foi possivel excluir a proposta." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

async function emitDeletionNote({
  detail,
  reason,
  user,
}: {
  detail: GuardianCompromissoDetail;
  reason: string;
  user: HadesAuthUser;
}) {
  const adminClient = createSupabaseAdminClient();

  if (!adminClient) {
    return;
  }

  const operator =
    user.displayName?.trim() || user.email?.trim() || "Operador Hades";
  const clientName =
    typeof detail.metadata.client_name === "string"
      ? detail.metadata.client_name
      : null;
  const isAcordo = detail.kind === "acordo";
  const title = isAcordo ? "Acordo excluído" : "Promessa excluída";
  const occurredAt = new Date().toISOString();

  try {
    await adminClient.from("caredesk_ticket_events").insert({
      actor_type: "user",
      actor_user_id: user.id,
      description: reason,
      event_type: "guardian_manual_timeline",
      metadata: {
        client_id: `c2x-client-${detail.clientC2xId}`,
        client_name: clientName ?? undefined,
        event: {
          description: reason,
          operator,
          protocol: detail.protocol,
          status: "Excluída",
          title,
          type: title,
        },
        history: [
          {
            action: "Exclusão",
            actorName: operator,
            actorUserId: user.id,
            occurredAt,
            protocol: detail.protocol,
          },
        ],
        kind: "timeline",
        protocol: detail.protocol,
        source_module: "guardian",
      },
      title,
    });
  } catch {
    // nota e auxiliar; a exclusao prossegue
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await authorizeHadesWrite(request);

  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const parsed = parseCreatePayload(await request.json().catch(() => null));

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const client = createGuardianMotorClient();

  if (!client) {
    return NextResponse.json(
      { error: "Configure a chave server-side para atualizar a cobranca." },
      { status: 503 },
    );
  }

  const submittedByName =
    auth.user.displayName?.trim() || auth.user.email?.trim() || "Operador";
  const inputWithAuthor: typeof parsed.input = {
    ...parsed.input,
    metadata: {
      ...(parsed.input.metadata ?? {}),
      submitted_by_name: submittedByName,
    },
  };

  const result = await replaceGuardianCompromissoDraft(
    client,
    id,
    inputWithAuthor,
    auth.user.id,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ data: result.compromisso });
}
