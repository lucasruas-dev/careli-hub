import { egressChronosWherebyRecordingToStorage } from "@/lib/chronos/recording-egress";
import { deleteChronosWherebyRecording } from "@/lib/chronos/whereby";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

// Egress automatico das gravacoes do Whereby para o nosso storage (chronos-drive) +
// retencao (apaga do Whereby apos a copia + um periodo de seguranca). Roda via Vercel
// Cron. Videos sao grandes (70-320MB) e bufferizados em memoria, entao processa em
// lotes pequenos por execucao. Ver memoria project_chronos_drive.
export const maxDuration = 300;

// Quantas gravacoes COPIAR por execucao (limite por causa do tamanho/tempo/memoria).
const COPY_BATCH = 3;
// Dias que a gravacao fica no Whereby APOS a copia, como rede de seguranca, antes de
// ser apagada de la (corta o custo de storage do Whereby).
const RETENTION_DAYS = 7;
// Quantas gravacoes apagar do Whereby por execucao (operacao leve, so chamada de API).
const RETENTION_BATCH = 25;

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

type ChronosEgressFailure = {
  error: string;
  recordingId: string;
};

export async function GET(request: NextRequest) {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Configure a chave server-side." },
      { status: 503 },
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (!(await isAuthorizedEgressCron(request, admin))) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const copied: string[] = [];
  const copyFailures: ChronosEgressFailure[] = [];
  const deletedFromWhereby: string[] = [];
  const deleteFailures: ChronosEgressFailure[] = [];

  // === FASE 1: COPIAR (Whereby -> chronos-drive) ===
  const { data: pendingCopy } = await admin
    .from("chronos_recordings")
    .select("file_name,id,meeting_id,metadata,mime_type,storage_bucket")
    .eq("storage_bucket", "whereby")
    .order("created_at", { ascending: true })
    .limit(COPY_BATCH)
    .returns<ChronosRecordingRow[]>();

  for (const recording of pendingCopy ?? []) {
    const wherebyRecordingId = readNestedString(
      recording.metadata,
      "whereby",
      "recordingId",
    );

    if (!wherebyRecordingId) {
      continue;
    }

    try {
      const egress = await egressChronosWherebyRecordingToStorage({
        deleteFromWherebyAfterCopy: false,
        fileName: recording.file_name,
        meetingId: recording.meeting_id,
        mimeType: recording.mime_type,
        storage: admin.storage,
        wherebyRecordingId,
      });

      const { error: updateError } = await admin
        .from("chronos_recordings")
        .update({
          metadata: {
            ...(recording.metadata ?? {}),
            migratedFromWhereby: {
              at: new Date().toISOString(),
              deletedFromWhereby: false,
              wherebyRecordingId,
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

      copied.push(recording.id);
    } catch (error: unknown) {
      copyFailures.push({
        error: error instanceof Error ? error.message : "Falha ao copiar.",
        recordingId: recording.id,
      });
    }
  }

  // === FASE 2: RETENCAO (apaga do Whereby apos RETENTION_DAYS da copia) ===
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: pendingDelete } = await admin
    .from("chronos_recordings")
    .select("file_name,id,meeting_id,metadata,mime_type,storage_bucket")
    .eq("storage_bucket", "chronos-drive")
    .eq("metadata->migratedFromWhereby->>deletedFromWhereby", "false")
    .lt("metadata->migratedFromWhereby->>at", cutoff)
    .limit(RETENTION_BATCH)
    .returns<ChronosRecordingRow[]>();

  for (const recording of pendingDelete ?? []) {
    const wherebyRecordingId = readNestedString(
      recording.metadata,
      "migratedFromWhereby",
      "wherebyRecordingId",
    );

    if (!wherebyRecordingId) {
      continue;
    }

    try {
      await deleteChronosWherebyRecording(wherebyRecordingId);

      const migrated = readNestedObject(recording.metadata, "migratedFromWhereby");

      await admin
        .from("chronos_recordings")
        .update({
          metadata: {
            ...(recording.metadata ?? {}),
            migratedFromWhereby: {
              ...migrated,
              deletedFromWhereby: true,
              wherebyDeletedAt: new Date().toISOString(),
            },
          },
        })
        .eq("id", recording.id);

      deletedFromWhereby.push(recording.id);
    } catch (error: unknown) {
      deleteFailures.push({
        error: error instanceof Error ? error.message : "Falha ao apagar.",
        recordingId: recording.id,
      });
    }
  }

  return NextResponse.json({
    data: {
      copied,
      copyFailures,
      deletedFromWhereby,
      deleteFailures,
      retentionDays: RETENTION_DAYS,
    },
  });
}

async function isAuthorizedEgressCron(
  request: NextRequest,
  admin: SupabaseClient,
): Promise<boolean> {
  // Cron interno do Vercel — este header e removido de requisicoes externas.
  if (request.headers.get("x-vercel-cron")) {
    return true;
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";

  if (!token) {
    return false;
  }

  const cronSecret = process.env.CRON_SECRET?.trim();

  if (cronSecret && token === cronSecret) {
    return true;
  }

  // Fallback: admin logado (permite disparo manual para teste).
  const { data: authData } = await admin.auth.getUser(token);

  if (!authData.user) {
    return false;
  }

  const { data: hubUser } = await admin
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<HubUserRow>();

  return Boolean(
    hubUser && hubUser.status === "active" && hubUser.role === "admin",
  );
}

function readNestedObject(
  metadata: Record<string, unknown> | null,
  parentKey: string,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }

  const parent = metadata[parentKey];

  return parent && typeof parent === "object" && !Array.isArray(parent)
    ? (parent as Record<string, unknown>)
    : {};
}

function readNestedString(
  metadata: Record<string, unknown> | null,
  parentKey: string,
  childKey: string,
) {
  const value = readNestedObject(metadata, parentKey)[childKey];

  return typeof value === "string" ? value : "";
}
