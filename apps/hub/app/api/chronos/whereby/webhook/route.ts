import { createHmac, timingSafeEqual } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { egressChronosWherebyRecordingToStorage } from "@/lib/chronos/recording-egress";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

// Webhook do Whereby: motor da arquitetura "storage proprio, custo Whereby ~zero".
// Quando o Whereby avisa que a gravacao subiu (`recording.finished`), a gente COPIA o
// .mp4 pro nosso Supabase (chronos-drive) e APAGA do Whereby na hora. 1 gravacao por
// evento => sem estouro de rate limit (o problema do egress em massa) e o storage no
// Whereby nao acumula. Ver [[project-chronos-drive]].
//
// Seguranca: a rota e publica (Whereby POSTa sem Bearer), protegida pela assinatura HMAC
// no header `Whereby-Signature` (formato `t=<timestamp>,v1=<hex>` — HMAC-SHA256 de
// `${timestamp}.${rawBody}` com o segredo do webhook). Sem segredo configurado, recusa.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Toleramos ate 5 min de diferenca de relogio (anti-replay).
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

type ChronosRecordingRow = {
  file_name: string | null;
  id: string;
  meeting_id: string;
  metadata: Record<string, unknown> | null;
  mime_type: string | null;
  storage_bucket: string | null;
};

export async function POST(request: NextRequest) {
  const secret = process.env.WHEREBY_WEBHOOK_SECRET?.trim();

  if (!secret) {
    return NextResponse.json(
      { error: "Webhook Whereby sem segredo configurado." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const signatureHeader =
    request.headers.get("whereby-signature") ??
    request.headers.get("Whereby-Signature") ??
    "";

  if (!isValidChronosWherebySignature(rawBody, signatureHeader, secret)) {
    return NextResponse.json({ error: "Assinatura invalida." }, { status: 401 });
  }

  let event: {
    type?: unknown;
    data?: { recordingId?: unknown; roomName?: unknown };
  };

  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
  }

  // So agimos em recording.finished. Os demais eventos sao apenas confirmados (200)
  // para o Whereby nao ficar reenfileirando.
  if (event.type !== "recording.finished") {
    return NextResponse.json({ ok: true, ignored: event.type ?? null });
  }

  const recordingId =
    typeof event.data?.recordingId === "string"
      ? event.data.recordingId.trim()
      : "";

  if (!recordingId) {
    return NextResponse.json({ ok: true, ignored: "sem recordingId" });
  }

  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Supabase server-side nao configurado." },
      { status: 503 },
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const result = await egressChronosWherebyRecordingByRecordingId({
      admin,
      recordingId,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      "[chronos/whereby-webhook] egress falhou",
      error instanceof Error ? error.message : "erro desconhecido",
    );

    // 500 => Whereby reentrega (ate 2x). Se a gravacao ainda nao estiver persistida no
    // nosso banco, o egress-cron periodico pega no proximo ciclo (rede de seguranca).
    return NextResponse.json(
      { error: "Falha ao migrar a gravacao." },
      { status: 500 },
    );
  }
}

async function egressChronosWherebyRecordingByRecordingId({
  admin,
  recordingId,
}: {
  admin: SupabaseClient;
  recordingId: string;
}) {
  const { data: recording } = await admin
    .from("chronos_recordings")
    .select("file_name,id,meeting_id,metadata,mime_type,storage_bucket")
    .eq("metadata->whereby->>recordingId", recordingId)
    .maybeSingle<ChronosRecordingRow>();

  // Ainda nao persistida (o sync de artefatos cria a linha). Deixa o egress-cron pegar.
  if (!recording) {
    return { skipped: "gravacao ainda nao persistida" };
  }

  if (recording.storage_bucket !== "whereby") {
    return { skipped: "ja migrada" };
  }

  const egress = await egressChronosWherebyRecordingToStorage({
    // Apaga do Whereby JA (nao guarda 7 dias): o objetivo e custo de storage ~zero.
    deleteFromWherebyAfterCopy: true,
    fileName: recording.file_name,
    meetingId: recording.meeting_id,
    mimeType: recording.mime_type,
    storage: admin.storage,
    wherebyRecordingId: recordingId,
  });

  const { error: updateError } = await admin
    .from("chronos_recordings")
    .update({
      metadata: {
        ...(recording.metadata ?? {}),
        migratedFromWhereby: {
          at: new Date().toISOString(),
          deletedFromWhereby: egress.deletedFromWhereby,
          via: "webhook",
          wherebyRecordingId: recordingId,
        },
      },
      size_bytes: egress.sizeBytes,
      storage_bucket: egress.bucket,
      storage_path: egress.storagePath,
    })
    .eq("id", recording.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return { migrated: recording.id, sizeBytes: egress.sizeBytes };
}

function isValidChronosWherebySignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
) {
  const parts = signatureHeader.split(",").reduce<Record<string, string>>(
    (accumulator, segment) => {
      const [key, value] = segment.split("=");

      if (key && value) {
        accumulator[key.trim()] = value.trim();
      }

      return accumulator;
    },
    {},
  );

  const timestamp = parts.t;
  const provided = parts.v1;

  if (!timestamp || !provided) {
    return false;
  }

  const timestampSeconds = Number(timestamp);

  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const skew = Math.abs(Date.now() / 1000 - timestampSeconds);

  if (skew > WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
