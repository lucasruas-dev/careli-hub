import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { persistInboundMediaToStorage } from "@/lib/iris/meta-media-storage";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Backfill pontual: mídia de áudio que entrou ANTES da persistência automática ficou sem URL
// tocável (só guardávamos um booleano). Aqui re-baixamos da Meta (id recuperado do payload ou do
// log de webhook), subimos pro Storage e gravamos `provider_payload.media.url` na mensagem — assim
// os áudios já recebidos passam a tocar no app atual (que já lê `media.url`). Admin/líder apenas.
export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  const client = authorization.client;
  const body = (await request.json().catch(() => null)) as {
    limit?: unknown;
  } | null;
  const limit = normalizeLimit(body?.limit);

  const { data: rows, error } = await client
    .from("caredesk_messages")
    .select("id, external_message_id, provider_payload")
    .eq("direction", "inbound")
    .in("message_type", ["audio", "document", "image", "video"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: `Falha ao listar mensagens de audio: ${error.message}` },
      { status: 500 },
    );
  }

  const pending = (rows ?? [])
    .map((row) => ({
      id: row.id as string,
      externalMessageId: (row.external_message_id as string | null) ?? null,
      media: readMediaRecord(row.provider_payload),
      payload: asRecord(row.provider_payload),
    }))
    .filter((row) => row.media && !readString(row.media.url));

  // Recupera o providerMediaId que falta a partir do log cru do webhook (1 query em lote).
  const missingIds = pending
    .filter((row) => !readString(row.media?.providerMediaId))
    .map((row) => row.externalMessageId)
    .filter((value): value is string => Boolean(value));
  const recoveredById = await recoverMediaIds(client, missingIds);

  const result = {
    failed: [] as Array<{ id: string; reason: string }>,
    scanned: pending.length,
    skipped: 0,
    updated: 0,
  };

  for (const row of pending) {
    const media = row.media as Record<string, unknown>;
    const providerMediaId =
      readString(media.providerMediaId) ??
      (row.externalMessageId
        ? recoveredById.get(row.externalMessageId) ?? null
        : null);

    if (!providerMediaId) {
      result.skipped += 1;
      continue;
    }

    try {
      const persisted = await persistInboundMediaToStorage({
        client,
        mediaId: providerMediaId,
        mimeType: readString(media.mimeType),
      });

      if (!persisted) {
        result.skipped += 1;
        continue;
      }

      const nextPayload = {
        ...row.payload,
        media: {
          ...media,
          providerMediaId,
          url: persisted.url,
        },
      };

      const { error: updateError } = await client
        .from("caredesk_messages")
        .update({ provider_payload: nextPayload })
        .eq("id", row.id);

      if (updateError) {
        result.failed.push({ id: row.id, reason: updateError.message });
        continue;
      }

      result.updated += 1;
    } catch (cause) {
      result.failed.push({
        id: row.id,
        reason: cause instanceof Error ? cause.message : "erro desconhecido",
      });
    }
  }

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function recoverMediaIds(
  client: SupabaseClient,
  externalMessageIds: string[],
) {
  const map = new Map<string, string>();

  if (!externalMessageIds.length) {
    return map;
  }

  const { data } = await client
    .from("caredesk_meta_webhook_events")
    .select("provider_message_id, payload")
    .in("provider_message_id", externalMessageIds);

  for (const event of data ?? []) {
    const providerMessageId = readString(event.provider_message_id);

    if (!providerMessageId) {
      continue;
    }

    const mediaId = extractMediaId(event.payload);

    if (mediaId) {
      map.set(providerMessageId, mediaId);
    }
  }

  return map;
}

// Lê o id da mídia do payload cru, qualquer que seja o tipo (message[type].id).
function extractMediaId(payload: unknown): string | null {
  const entries = asArray(asRecord(payload)?.entry);
  const change = asArray(asRecord(entries[0])?.changes)[0];
  const value = asRecord(asRecord(change)?.value);
  const message = asRecord(asArray(value?.messages)[0]);
  const type = readString(message?.type);

  if (!type) {
    return null;
  }

  const mediaNode = asRecord(message?.[type]);

  return readString(mediaNode?.id);
}

function readMediaRecord(payload: unknown): Record<string, unknown> | null {
  const media = asRecord(payload)?.media;

  return media && typeof media === "object" && !Array.isArray(media)
    ? (media as Record<string, unknown>)
    : null;
}

function normalizeLimit(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.round(value)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
