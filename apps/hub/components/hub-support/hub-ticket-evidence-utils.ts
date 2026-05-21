import type { HubItTicketAttachmentInput } from "@/lib/hub-it-tickets/types";

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
