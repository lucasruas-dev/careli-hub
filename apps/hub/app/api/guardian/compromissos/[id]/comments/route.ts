import { NextResponse, type NextRequest } from "next/server";

import { authorizeHadesRead, authorizeHadesWrite } from "@/lib/guardian/auth";
import {
  addGuardianCompromissoComment,
  createGuardianMotorClient,
  listGuardianCompromissoComments,
} from "@/lib/guardian/compromissos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// Thread de comentarios de uma proposta (Central do gestor). Leitura para
// qualquer papel operacional; escrita para admin/leader/operator.
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

  const data = await listGuardianCompromissoComments(client, id);

  return NextResponse.json({ data });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await authorizeHadesWrite(request);

  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  const text = typeof body?.body === "string" ? body.body.trim() : "";

  if (!text) {
    return NextResponse.json(
      { error: "Comentario vazio." },
      { status: 400 },
    );
  }

  const client = createGuardianMotorClient();

  if (!client) {
    return NextResponse.json(
      { error: "Configure a chave server-side para comentar." },
      { status: 503 },
    );
  }

  const authorName =
    auth.user.displayName?.trim() || auth.user.email?.trim() || "Operador";

  const comment = await addGuardianCompromissoComment(
    client,
    { authorName, body: text, compromissoId: id, kind: "comment" },
    auth.user.id,
  );

  if (!comment) {
    return NextResponse.json(
      { error: "Nao foi possivel salvar o comentario." },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: comment }, { status: 201 });
}
