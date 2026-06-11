import type {
  ChronosMeeting,
  ChronosRoom,
  ChronosRoomInput,
} from "@/lib/chronos/types";

export type ChronosRoomDraft = {
  backgroundDataUrl: string;
  backgroundName: string;
  capacity: string;
  minutesRequired: boolean;
  name: string;
  recordingRequired: boolean;
  slug: string;
  transcriptionRequired: boolean;
};

export function createRoomDraft(room: ChronosRoom | null): ChronosRoomDraft {
  const background = readRoomBackground(room);

  return {
    backgroundDataUrl: background.dataUrl,
    backgroundName: background.name,
    capacity: String(room?.capacity ?? 12),
    minutesRequired: room?.minutesRequired ?? true,
    name: room?.name ?? "",
    recordingRequired: room?.recordingRequired ?? true,
    slug: room?.slug ?? "",
    transcriptionRequired: room?.transcriptionRequired ?? true,
  };
}

export function buildRoomInputFromDraft(
  draft: ChronosRoomDraft,
): ChronosRoomInput {
  const name = draft.name.trim();

  return {
    backgroundDataUrl: draft.backgroundDataUrl || undefined,
    backgroundName: draft.backgroundName || undefined,
    capacity: Number(draft.capacity || 12),
    minutesRequired: draft.minutesRequired,
    name,
    recordingRequired: draft.recordingRequired,
    slug: slugifyRoomName(draft.slug || name),
    transcriptionRequired: draft.transcriptionRequired,
  };
}

export function slugifyRoomName(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "";
}

export function buildExternalRoomLink(slug: string) {
  return `/chronos/${slug || "nome-da-sala"}`;
}

export function buildAbsoluteExternalRoomLink(slug: string) {
  const path = buildExternalRoomLink(slug);

  if (typeof window === "undefined") {
    return path;
  }

  return new URL(path, window.location.origin).toString();
}

export function hasChronosMeetingAvailableRecording(meeting: ChronosMeeting) {
  return meeting.recordings.some((recording) => recording.status === "available");
}

export async function readChronosRoomBackgroundFileAsDataUrl({
  file,
  maxBytes,
}: {
  file: File;
  maxBytes: number;
}) {
  const dataUrl = await readFileAsDataUrl(file);

  return optimizeChronosRoomBackgroundDataUrl({
    dataUrl,
    maxBytes,
  });
}

export async function optimizeChronosRoomBackgroundDataUrl({
  dataUrl,
  maxBytes,
}: {
  dataUrl: string;
  maxBytes: number;
}) {
  if (getChronosDataUrlByteLength(dataUrl) <= maxBytes) {
    return dataUrl;
  }

  const image = await loadChronosRoomBackgroundImage(dataUrl);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Nao foi possivel otimizar o fundo da sala.");
  }

  const maxWidths = [1600, 1280, 1024, 896, 768];
  const qualities = [0.82, 0.74, 0.66, 0.58, 0.5, 0.42];

  for (const maxWidth of maxWidths) {
    const scale = Math.min(1, maxWidth / Math.max(1, image.naturalWidth));

    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of qualities) {
      const optimizedDataUrl = canvas.toDataURL("image/jpeg", quality);

      if (getChronosDataUrlByteLength(optimizedDataUrl) <= maxBytes) {
        return optimizedDataUrl;
      }
    }
  }

  throw new Error(
    "Nao foi possivel reduzir o fundo para o limite aceito pela Whereby.",
  );
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve(typeof reader.result === "string" ? reader.result : "");
    });
    reader.addEventListener("error", () => {
      reject(new Error("Nao foi possivel ler o fundo da sala."));
    });
    reader.readAsDataURL(file);
  });
}

function loadChronosRoomBackgroundImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.addEventListener("load", () => {
      resolve(image);
    });
    image.addEventListener("error", () => {
      reject(new Error("Nao foi possivel carregar o fundo da sala."));
    });
    image.src = dataUrl;
  });
}

function getChronosDataUrlByteLength(dataUrl: string) {
  const base64Payload = dataUrl.split(",", 2)[1] ?? "";

  return Math.ceil((base64Payload.length * 3) / 4);
}

function readRoomBackground(room: ChronosRoom | null) {
  const background =
    room?.metadata && typeof room.metadata.background === "object"
      ? (room.metadata.background as Record<string, unknown>)
      : null;

  return {
    dataUrl:
      typeof background?.dataUrl === "string" ? background.dataUrl : "",
    name: typeof background?.name === "string" ? background.name : "",
  };
}
