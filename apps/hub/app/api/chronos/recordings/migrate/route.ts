import { egressChronosWherebyRecordingToStorage } from "@/lib/chronos/recording-egress";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

// Videos vao de ~70 a ~320MB e sao bufferizados em memoria durante a copia — precisa
// de tempo. maxDuration alto (igual ao da geracao de ata).
export const maxDuration = 300;

type HubUserRow = {
  id: string;
  role: string;
  status: string;
};

type ChronosRecordingRow = {
  file_name: string | null;
  id: string;
  meeting_id: string;
  metadata: Record<string, unknown> | null;
  mime_type: string | null;
  storage_bucket: string | null;
};

// POST /api/chronos/recordings/migrate
// Body: { recordingId: string, deleteFromWhereby?: boolean }
// Copia UMA gravacao do Whereby para o nosso bucket (chronos-drive) e atualiza o
// registro. So admin. deleteFromWhereby=true tambem apaga do Whereby apos a copia.
export async function POST(request: NextRequest) {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Configure a chave server-side." },
      { status: 503 },
    );
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json({ error: "Sessao ausente." }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authData, error: authError } =
    await admin.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Sessao invalida." }, { status: 401 });
  }

  const { data: hubUser } = await admin
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<HubUserRow>();

  if (!hubUser || hubUser.status !== "active" || hubUser.role !== "admin") {
    return NextResponse.json(
      { error: "Apenas admin pode migrar gravacoes." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    deleteFromWhereby?: unknown;
    recordingId?: unknown;
  } | null;
  const recordingId =
    typeof body?.recordingId === "string" ? body.recordingId.trim() : "";

  if (!recordingId) {
    return NextResponse.json({ error: "Informe recordingId." }, { status: 400 });
  }

  const deleteFromWhereby = body?.deleteFromWhereby === true;

  const { data: recording, error: recordingError } = await admin
    .from("chronos_recordings")
    .select("file_name,id,meeting_id,metadata,mime_type,storage_bucket")
    .eq("id", recordingId)
    .maybeSingle<ChronosRecordingRow>();

  if (recordingError || !recording) {
    return NextResponse.json(
      { error: "Gravacao nao encontrada." },
      { status: 404 },
    );
  }

  if (recording.storage_bucket !== "whereby") {
    return NextResponse.json(
      {
        error: "Gravacao nao esta no Whereby (ja migrada ou outra origem).",
        storageBucket: recording.storage_bucket,
      },
      { status: 409 },
    );
  }

  const wherebyRecordingId = readWherebyRecordingId(recording.metadata);

  if (!wherebyRecordingId) {
    return NextResponse.json(
      { error: "Gravacao sem recordingId do Whereby." },
      { status: 422 },
    );
  }

  let egress;

  try {
    egress = await egressChronosWherebyRecordingToStorage({
      deleteFromWherebyAfterCopy: deleteFromWhereby,
      fileName: recording.file_name,
      meetingId: recording.meeting_id,
      mimeType: recording.mime_type,
      storage: admin.storage,
      wherebyRecordingId,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Falha ao migrar a gravacao.",
      },
      { status: 502 },
    );
  }

  const { error: updateError } = await admin
    .from("chronos_recordings")
    .update({
      metadata: {
        ...(recording.metadata ?? {}),
        migratedFromWhereby: {
          at: new Date().toISOString(),
          deletedFromWhereby: egress.deletedFromWhereby,
          wherebyRecordingId,
        },
      },
      size_bytes: egress.sizeBytes,
      storage_bucket: egress.bucket,
      storage_path: egress.storagePath,
    })
    .eq("id", recordingId);

  if (updateError) {
    return NextResponse.json(
      {
        egress,
        error: "Copiado para o storage, mas falhou ao atualizar o registro.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: { ...egress, recordingId } });
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

function readWherebyRecordingId(metadata: Record<string, unknown> | null) {
  if (!metadata || typeof metadata !== "object") {
    return "";
  }

  const whereby = metadata.whereby;

  if (!whereby || typeof whereby !== "object") {
    return "";
  }

  const recordingId = (whereby as Record<string, unknown>).recordingId;

  return typeof recordingId === "string" ? recordingId : "";
}
