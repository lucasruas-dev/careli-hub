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
  const recordings = Array.isArray(meeting.recordings) ? meeting.recordings : [];

  return recordings.some((recording) => recording.status === "available");
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
