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
      file: Blob | ReadableStream<Uint8Array>,
      options?: { contentType?: string; duplex?: string; upsert?: boolean },
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
// opcionalmente, apaga do Whereby (retencao). O corpo é repassado em STREAMING
// (response.body -> upload) — bufferizar o vídeo inteiro (70-320MB) em memória
// matava a função por OOM (208 kills entre 22/jun e 6/jul nas rotas de gravação).
// Ver memoria project_chronos_drive.
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

  const storagePath = buildChronosDriveStoragePath({
    fileName,
    meetingId,
    wherebyRecordingId,
  });
  // O Whereby entrega o arquivo como application/octet-stream — o bucket RECUSA
  // esse MIME (33 falhas "mime type not supported" desde 2/jul, gravações presas).
  // Saneia: extensão do arquivo > mime confiável > video/mp4; octet-stream nunca.
  const contentType = resolveRecordingContentType({
    fileName,
    headerContentType: downloadResponse.headers.get("content-type"),
    mimeType,
  });
  const contentLength = Number(
    downloadResponse.headers.get("content-length") ?? "0",
  );
  const uploadBody: Blob | ReadableStream<Uint8Array> =
    downloadResponse.body ?? (await downloadResponse.blob());
  const uploadResult = await storage
    .from(bucket)
    .upload(storagePath, uploadBody, {
      contentType,
      duplex: "half",
      upsert: true,
    });

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
    sizeBytes: Number.isFinite(contentLength) ? contentLength : 0,
    storagePath: finalPath,
  };
}

const RECORDING_EXTENSION_MIME: Record<string, string> = {
  m4a: "audio/mp4",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  wav: "audio/wav",
  webm: "video/webm",
};

// Exportada para teste: nunca devolve application/octet-stream (o bucket recusa).
export function resolveRecordingContentType({
  fileName,
  headerContentType,
  mimeType,
}: {
  fileName?: string | null;
  headerContentType?: string | null;
  mimeType?: string | null;
}): string {
  const extension = (fileName ?? "").toLowerCase().split(".").pop() ?? "";
  const fromExtension = RECORDING_EXTENSION_MIME[extension];

  if (fromExtension) {
    return fromExtension;
  }

  for (const candidate of [mimeType, headerContentType]) {
    const clean = candidate?.trim().toLowerCase() ?? "";

    if (
      clean &&
      clean !== "application/octet-stream" &&
      (clean.startsWith("video/") || clean.startsWith("audio/"))
    ) {
      return clean;
    }
  }

  return "video/mp4";
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
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-120) || fallbackName;

  return `meetings/${meetingId}/${wherebyRecordingId}/${safeFileName}`;
}
