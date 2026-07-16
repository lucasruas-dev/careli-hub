import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { loadApoloEntityTimeline } from "@/lib/apolo/timeline";

// Histórico (ficha corrida) da entidade: agrega Iris/Hades/Chronos/pagamentos/vendas + eventos
// manuais, por identidade (c2xId ∪ e-mails ∪ telefones). POST registra evento manual.
// Ver [[project_apolo_timeline]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csv(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  const c2xIdRaw = Number(params.get("c2xId"));
  const c2xId = Number.isInteger(c2xIdRaw) && c2xIdRaw > 0 ? c2xIdRaw : null;
  const entityId = params.get("entityId")?.trim() || null;
  const emails = csv(params.get("emails")).map((email) => email.toLowerCase());
  const phones = csv(params.get("phones"));

  if (!c2xId && !entityId && !emails.length && !phones.length) {
    return NextResponse.json(
      { error: "Sem identidade para montar o historico." },
      { status: 400 },
    );
  }

  try {
    const result = await loadApoloEntityTimeline({
      adminClient,
      c2xId,
      emails,
      entityId,
      phones,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json(
      { data: result.data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][timeline] falha ao carregar historico", error);

    return NextResponse.json(
      { error: "Nao foi possivel carregar o historico." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeApoloRead(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as {
    category?: string;
    description?: string;
    entityId?: string;
    occurredAt?: string;
    title?: string;
  } | null;

  const entityId = body?.entityId?.trim();
  const title = body?.title?.trim();

  if (!entityId || !title) {
    return NextResponse.json(
      { error: "Informe a entidade e o titulo do registro." },
      { status: 400 },
    );
  }

  // Nome do operador que está registrando (autor do evento).
  const { data: operator } = await adminClient
    .from("hub_users")
    .select("display_name, email")
    .eq("id", authorization.userId)
    .maybeSingle<{ display_name: string | null; email: string | null }>();
  const author = operator?.display_name ?? operator?.email ?? "Operador";

  const occurredAt = body?.occurredAt ? new Date(body.occurredAt) : new Date();
  const category = body?.category?.trim() || "Registro";

  const { error } = await adminClient.from("apolo_timeline_events").insert({
    description: body?.description?.trim() || null,
    entity_id: entityId,
    event_type: "manual",
    metadata: { author, category, source: "manual" },
    occurred_at: (Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt).toISOString(),
    status: "ok",
    title,
  });

  if (error) {
    console.error("[apolo][timeline] falha ao registrar evento manual", error);
    return NextResponse.json(
      { error: "Nao foi possivel registrar o evento." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
