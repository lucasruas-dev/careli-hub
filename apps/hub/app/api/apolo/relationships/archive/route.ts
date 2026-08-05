import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Exclui (ARQUIVA, mantém histórico) um relacionamento do cliente. Identifica pelo related_entity_id
// (quando o vínculo aponta para uma entidade) ou pelo label (contato leve). Arquiva TODAS as linhas
// que casam — a mesma entidade pode ter vindo em mais de um papel. Registra no histórico.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Escrita indisponível." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    entityId?: string;
    label?: string;
    relatedEntityId?: string | null;
  };
  const entityId = body.entityId?.trim();
  const relatedEntityId = body.relatedEntityId?.trim();
  const label = body.label?.trim();
  if (!entityId || (!relatedEntityId && !label)) {
    return NextResponse.json({ error: "Informe o relacionamento a excluir." }, { status: 400 });
  }

  const base = client
    .from("apolo_relationships")
    .select("id, label, metadata")
    .eq("entity_id", entityId)
    .neq("status", "archived");
  const sel = relatedEntityId
    ? base.eq("related_entity_id", relatedEntityId)
    : base.is("related_entity_id", null).eq("label", label ?? "");
  const { data: linhas, error: erroSel } = await sel.returns<
    Array<{ id: string; label: string | null; metadata: unknown }>
  >();
  if (erroSel) return NextResponse.json({ error: erroSel.message }, { status: 500 });
  if (!linhas?.length) {
    return NextResponse.json({ error: "Relacionamento não encontrado." }, { status: 404 });
  }

  const agora = new Date().toISOString();
  const rotulos = new Set<string>();
  for (const linha of linhas) {
    if (linha.label) rotulos.add(linha.label);
    const meta =
      linha.metadata && typeof linha.metadata === "object" && !Array.isArray(linha.metadata)
        ? { ...(linha.metadata as Record<string, unknown>) }
        : {};
    await client
      .from("apolo_relationships")
      .update({
        metadata: { ...meta, arquivadoEm: agora, arquivadoPor: auth.userId },
        status: "archived",
        updated_at: agora,
      })
      .eq("id", linha.id);
  }

  await client.from("apolo_timeline_events").insert({
    description: "Vínculo arquivado pelo Apolo.",
    entity_id: entityId,
    event_type: "relacionamento_excluido",
    metadata: { por: auth.userId, relatedEntityId: relatedEntityId ?? null },
    occurred_at: agora,
    status: "attention",
    title: `Relacionamento removido: ${[...rotulos].join(", ") || "vínculo"}`,
  });

  return NextResponse.json({ data: { arquivados: linhas.length, ok: true } });
}
