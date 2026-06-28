import { NextResponse, type NextRequest } from "next/server";

import { authorizeHadesAdmin } from "@/lib/guardian/auth";
import {
  addGuardianCompromissoComment,
  createGuardianMotorClient,
  decideGuardianCompromisso,
} from "@/lib/guardian/compromissos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// Decisao da Central do gestor: aprovar ou reprovar uma proposta pendente.
// SO Admin (authorizeHadesAdmin). Motivo obrigatorio na reprovacao. A decisao
// tambem vira uma nota na thread (auditavel).
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await authorizeHadesAdmin(request);

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

  const decision = body.decision;

  if (
    decision !== "aprovado" &&
    decision !== "reprovado" &&
    decision !== "devolvido"
  ) {
    return NextResponse.json(
      { error: "Decisao invalida (use aprovado, reprovado ou devolvido)." },
      { status: 400 },
    );
  }

  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : null;

  // Reprovar e devolver exigem motivo (a aprovacao nao).
  if (decision !== "aprovado" && !reason) {
    return NextResponse.json(
      {
        error:
          decision === "reprovado"
            ? "Informe o motivo da reprovacao."
            : "Informe o motivo da devolucao.",
      },
      { status: 400 },
    );
  }

  const client = createGuardianMotorClient();

  if (!client) {
    return NextResponse.json(
      { error: "Configure a chave server-side para decidir a proposta." },
      { status: 503 },
    );
  }

  const detail = await decideGuardianCompromisso(
    client,
    id,
    { decision, reason },
    auth.user.id,
  );

  if (!detail) {
    return NextResponse.json(
      { error: "Proposta nao encontrada ou ja decidida." },
      { status: 409 },
    );
  }

  // Nota da decisao na thread (best-effort; a decisao ja esta gravada).
  const adminName =
    auth.user.displayName?.trim() || auth.user.email?.trim() || "Admin";
  const verb =
    decision === "aprovado"
      ? "Aprovada"
      : decision === "reprovado"
        ? "Reprovada"
        : "Devolvida para ajuste";
  const commentKind =
    decision === "aprovado"
      ? "aprovacao"
      : decision === "reprovado"
        ? "reprovacao"
        : "sistema";

  await addGuardianCompromissoComment(
    client,
    {
      authorName: adminName,
      body: reason ? `${verb} por ${adminName}: ${reason}` : `${verb} por ${adminName}.`,
      compromissoId: id,
      kind: commentKind,
    },
    auth.user.id,
  );

  return NextResponse.json({ data: detail });
}
