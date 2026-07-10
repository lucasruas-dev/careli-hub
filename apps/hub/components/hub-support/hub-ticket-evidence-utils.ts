import type { HubItTicketAttachmentInput } from "@/lib/hub-it-tickets/types";

// O arquivo cheio (alta qualidade) vive no Storage; pela API viaja so metadado.
// Mas a rota de analise da IA EXIGE um `dataUrl`, entao guardamos uma AMOSTRA
// reduzida (`analysisDataUrls`) so pra ela ler. A amostra nunca e salva.
// `previewUrl` e um object URL local, so pra desenhar a miniatura no formulario.
export type HubItTicketAttachmentDraft = HubItTicketAttachmentInput & {
  previewUrl?: string;
};

const ANALYSIS_SAMPLE_MAX_EDGE = 1600;
const ANALYSIS_SAMPLE_QUALITY = 0.72;

// Reduz a imagem so pra IA olhar. O print original continua PNG, sem perdas.
export async function buildImageAnalysisSample(blob: Blob) {
  if (typeof document === "undefined") {
    return "";
  }

  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await loadImageElement(objectUrl);
    const scale = Math.min(
      1,
      ANALYSIS_SAMPLE_MAX_EDGE / Math.max(image.width, image.height, 1),
    );
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      return "";
    }

    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL("image/jpeg", ANALYSIS_SAMPLE_QUALITY);
  } catch {
    return "";
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("image")), {
      once: true,
    });
    image.src = src;
  });
}

// Payload da ANALISE: a IA precisa de bytes, entao mandamos a amostra no lugar
// do arquivo. Anexo sem amostra nenhuma e descartado (a rota exigiria dataUrl).
export function toAnalysisAttachments(
  drafts: HubItTicketAttachmentDraft[],
): HubItTicketAttachmentInput[] {
  return drafts.flatMap((draft) => {
    const sample = draft.analysisDataUrls?.[0] ?? draft.dataUrl ?? "";

    if (!sample) {
      return [];
    }

    return [
      {
        analysisDataUrls: draft.analysisDataUrls,
        capturedAt: draft.capturedAt,
        dataUrl: sample,
        fileName: draft.fileName,
        mimeType: draft.mimeType,
        sizeBytes: draft.sizeBytes,
        type: draft.type,
      },
    ];
  });
}

// Payload da CRIACAO: so metadado + caminho no Storage. Nada de base64 aqui:
// era exatamente isso que enchia o Postgres e estourava o body da Vercel.
export function toCreateAttachments(
  drafts: HubItTicketAttachmentDraft[],
): HubItTicketAttachmentInput[] {
  return drafts.map((draft) => ({
    capturedAt: draft.capturedAt,
    // Sem storagePath o upload falhou: cai no base64 legado (arquivos pequenos).
    ...(draft.storagePath
      ? { storagePath: draft.storagePath }
      : { dataUrl: draft.dataUrl }),
    fileName: draft.fileName,
    mimeType: draft.mimeType,
    sizeBytes: draft.sizeBytes,
    type: draft.type,
  }));
}

export async function extractVideoFrameDataUrls(blob: Blob) {
  if (typeof document === "undefined") {
    return [];
  }

  const videoUrl = URL.createObjectURL(blob);
  const video = document.createElement("video");

  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = videoUrl;

  try {
    await waitForVideoMetadata(video);
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const frameTimes = Array.from(
      new Set(
        [
          duration > 1 ? Math.min(0.8, duration * 0.25) : 0,
          duration > 2 ? duration * 0.75 : 0,
        ]
          .map((time) =>
            Math.max(0, Math.min(time, Math.max(0, duration - 0.1))),
          )
          .map((time) => Number(time.toFixed(2))),
      ),
    );
    const frames: string[] = [];

    for (const frameTime of frameTimes) {
      await seekVideo(video, frameTime);
      const frame = captureVideoFrame(video);

      if (frame) {
        frames.push(frame);
      }
    }

    return frames.slice(0, 2);
  } catch {
    return [];
  } finally {
    URL.revokeObjectURL(videoUrl);
  }
}

export function waitForVideoMetadata(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("timeout")),
      4_000,
    );

    video.addEventListener(
      "loadedmetadata",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    video.addEventListener(
      "error",
      () => {
        window.clearTimeout(timeout);
        reject(new Error("video"));
      },
      { once: true },
    );
  });
}

export function seekVideo(video: HTMLVideoElement, currentTime: number) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("timeout")),
      4_000,
    );

    video.addEventListener(
      "seeked",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    video.currentTime = currentTime;
  });
}

export function captureVideoFrame(video: HTMLVideoElement) {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return "";
  }

  canvas.width = width;
  canvas.height = height;
  context.drawImage(video, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.72);
}

export function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.ceil((base64.length * 3) / 4);
}

export function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

export function formatAttachmentStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kilobytes = bytes / 1024;

  if (kilobytes < 1024) {
    return `${kilobytes.toFixed(kilobytes >= 100 ? 0 : 1)} KB`;
  }

  const megabytes = kilobytes / 1024;

  return `${megabytes.toFixed(megabytes >= 10 ? 1 : 2)} MB`;
}

export function getAttachmentTypeFromMime(
  mimeType: string,
): HubItTicketAttachmentInput["type"] {
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";

  return "file";
}

export function getAttachmentLabel(type: HubItTicketAttachmentInput["type"]) {
  const labels = {
    audio: "Audio",
    file: "Arquivo",
    image: "Print",
    video: "Video",
  } as const satisfies Record<HubItTicketAttachmentInput["type"], string>;

  return labels[type];
}
