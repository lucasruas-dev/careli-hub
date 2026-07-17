import { NextResponse, type NextRequest } from "next/server";

import { fetchEvolutionMediaBase64 } from "@/lib/iris/evolution-api";
import { uploadInboundMediaBuffer } from "@/lib/iris/meta-media-storage";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Recupera as mídias (áudio/imagem/PDF/vídeo) que entraram ANTES do conserto do
// download — na época o processador só gravava o texto "[documento]" e nunca
// baixava o arquivo, então não havia o que abrir. A Evolution ainda guarda os
// binários, então dá pra buscar e preencher retroativamente.
//
// Roda em LOTE (limit) porque cada item é um download + upload: chamar de novo
// continua de onde parou (só pega quem ainda está sem arquivo).
//
// ⚠️ Fica FORA de /api/iris/evolution de propósito: aquele prefixo está na
// allowlist do proxy.ts (webhook público) e libera subcaminhos.

const MEDIA_TYPES = ["audio", "document", "image", "sticker", "video"];

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const { client } = authorization;

  let limit = 10;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
      limit = Math.min(Math.max(Math.trunc(body.limit), 1), 25);
    }
  } catch {
    // corpo opcional
  }

  const { data: rows, error } = await client
    .from("caredesk_messages")
    .select("id,external_message_id,message_type,provider_payload")
    .eq("provider_payload->>provider", "evolution")
    .in("message_type", MEDIA_TYPES)
    .not("external_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel listar as mensagens." },
      { status: 500 },
    );
  }

  // Só as que ainda estão sem arquivo (o filtro de jsonb null é chato no
  // PostgREST, então peneiramos aqui).
  const pending = (rows ?? []).filter((row: any) => {
    const media = row.provider_payload?.media;
    return !media || typeof media !== "object";
  });

  const result = {
    pendentes: pending.length,
    processados: 0,
    recuperados: 0,
    falharam: 0,
  };

  for (const row of pending.slice(0, limit)) {
    result.processados += 1;

    try {
      const downloaded = await fetchEvolutionMediaBase64(
        row.external_message_id as string,
      );

      if (!downloaded) {
        result.falharam += 1;
        continue;
      }

      const persisted = await uploadInboundMediaBuffer({
        buffer: Buffer.from(downloaded.base64, "base64"),
        client,
        mediaId: row.external_message_id as string,
        mimeType: downloaded.mimeType,
      });

      if (!persisted?.url) {
        result.falharam += 1;
        continue;
      }

      const payload =
        row.provider_payload && typeof row.provider_payload === "object"
          ? (row.provider_payload as Record<string, unknown>)
          : {};

      const { error: updateError } = await client
        .from("caredesk_messages")
        .update({
          provider_payload: {
            ...payload,
            media: {
              fileName: downloaded.fileName,
              mimeType: downloaded.mimeType,
              type: row.message_type,
              url: persisted.url,
            },
          },
        })
        .eq("id", row.id);

      if (updateError) {
        result.falharam += 1;
        continue;
      }

      result.recuperados += 1;
    } catch (error) {
      console.error("[iris] backfill de midia falhou", error);
      result.falharam += 1;
    }
  }

  return NextResponse.json(
    { ok: true, ...result, restantes: result.pendentes - result.recuperados },
    { headers: { "Cache-Control": "no-store" }, status: 200 },
  );
}
