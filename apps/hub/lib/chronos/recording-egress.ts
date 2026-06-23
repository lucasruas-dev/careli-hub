import {
  deleteChronosWherebyRecording,
  getChronosWherebyRecordingAccessLink,
} from "./whereby";

// Bucket do Supabase Storage onde as gravacoes passam a viver sob nosso controle
// (em vez de acumularem custo no storage do Whereby). Mesmo bucket usado pelo fluxo
// legado de upload (server.ts `chronosDriveStorageBucket`).
export const CHRONOS_DRIVE_STORAGE_BUCKET = "chronos-drive";

type ChronosStorageUploadResult = {
  data: { path: string } | null;
  error: { message: string } | null;
};

// Tipo estrutural minimo de `client.storage` — desacopla este modulo dos tipos do
// supabase-js, mantendo-o testavel e independente do server.ts.
type ChronosStorageClient = {
  from: (bucket: string) => {
    upload: (
      path: string,
      file: Blob,
      options?: { contentType?: string; upsert?: boolean },
    ) => Promise<ChronosStorageUploadResult>;
  };
};

export type ChronosWherebyEgressInput = {
  storage: ChronosStorageClient;
  bucket?: string;
  meetingId: string;
  wherebyRecordingId: string;
  fileName?: string | null;
  mimeType?: string | null;
  deleteFromWherebyAfterCopy?: boolean;
};

export type ChronosWherebyEgressResult = {
  bucket: string;
  deletedFromWhereby: boolean;
  sizeBytes: number;
  storagePath: string;
};

// Copia UMA gravacao do storage do Whereby para o nosso bucket (Supabase Storage) e,
// opcionalmente, apaga do Whereby (retencao). Assim o video fica preservado, sob nosso
// controle e com custo de storage muito menor. Streaming nao e usado ainda: o blob e
// bufferizado em memoria, entao quem chamar deve rodar num contexto com maxDuration alto
// e memoria suficiente (videos vao de ~70 a ~320MB). Ver memoria project_chronos_drive.
export async function egressChronosWherebyRecordingToStorage({
  storage,
  bucket = CHRONOS_DRIVE_STORAGE_BUCKET,
  meetingId,
  wherebyRecordingId,
  fileName,
  mimeType,
  deleteFromWherebyAfterCopy = false,
}: ChronosWherebyEgressInput): Promise<ChronosWherebyEgressResult> {
  const { accessLink } = await getChronosWherebyRecordingAccessLink(
    wherebyRecordingId,
  );

  if (!accessLink) {
    throw new Error("Whereby nao retornou o link de download da gravacao.");
  }

  const downloadResponse = await fetch(accessLink, { cache: "no-store" });

  if (!downloadResponse.ok) {
    throw new Error(
      `Download da gravacao Whereby falhou (HTTP ${downloadResponse.status}).`,
    );
  }

  const fileBlob = await downloadResponse.blob();
  const storagePath = buildChronosDriveStoragePath({
    fileName,
    meetingId,
    wherebyRecordingId,
  });
  const contentType =
    mimeType ||
    downloadResponse.headers.get("content-type") ||
    "video/mp4";
  const uploadResult = await storage
    .from(bucket)
    .upload(storagePath, fileBlob, { contentType, upsert: true });

  if (uploadResult.error) {
    throw new Error(
      `Upload da gravacao para o storage falhou: ${uploadResult.error.message}`,
    );
  }

  const finalPath = uploadResult.data?.path ?? storagePath;
  let deletedFromWhereby = false;

  // So apaga do Whereby DEPOIS do upload ter dado certo — evita perder a gravacao.
  if (deleteFromWherebyAfterCopy) {
    await deleteChronosWherebyRecording(wherebyRecordingId);
    deletedFromWhereby = true;
  }

  return {
    bucket,
    deletedFromWhereby,
    sizeBytes: fileBlob.size,
    storagePath: finalPath,
  };
}

function buildChronosDriveStoragePath({
  fileName,
  meetingId,
  wherebyRecordingId,
}: {
  fileName?: string | null;
  meetingId: string;
  wherebyRecordingId: string;
}) {
  const fallbackName = `whereby-${wherebyRecordingId}.mp4`;
  const safeFileName =
    (fileName ?? fallbackName)
      .trim()
      .replace(/[^\w.\-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-120) || fallbackName;

  return `meetings/${meetingId}/${wherebyRecordingId}/${safeFileName}`;
}
