type ChronosWherebyConfig = {
  apiKey: string;
  baseUrl: string;
};

export type ChronosWherebyMeeting = {
  endDate: string;
  hostRoomUrl?: string | null;
  meetingId: string;
  roomName: string;
  roomUrl: string;
  startDate?: string | null;
  viewerRoomUrl?: string | null;
};

export type ChronosWherebyRecording = {
  endDate?: string | null;
  filename?: string | null;
  recordingId: string;
  roomSessionId?: string | null;
  sizeInMegaBytes?: number | null;
  startDate?: string | null;
};

export type ChronosWherebyTranscription = {
  createdAt?: string | null;
  durationInSeconds?: number | null;
  endDate?: string | null;
  filename?: string | null;
  roomName?: string | null;
  roomSessionId?: string | null;
  startDate?: string | null;
  state?: "failed" | "in_progress" | "ready" | string;
  storageType?: string | null;
  transcriptionId: string;
  type?: string | null;
};

export type ChronosWherebyParticipant = {
  displayName?: string | null;
  externalId?: string | null;
  joinedAt?: string | null;
  leftAt?: string | null;
  participantId: string;
  roleName?: string | null;
};

type ChronosWherebyAccessLink = {
  accessLink: string;
  expires?: string | null;
};

type ChronosWherebyCreateMeetingInput = {
  backgroundDataUrl?: string | null;
  endDate: string;
  recordingRequired: boolean;
  roomNamePrefix: string;
  roomSlug: string;
  transcriptionRequired: boolean;
};

const defaultChronosWherebyBaseUrl = "https://api.whereby.dev/v1";
const defaultChronosWherebyEmbedScriptUrl =
  "https://cdn.srv.whereby.com/embed/v3-embed.js";

export function getChronosWherebyEmbedScriptUrl() {
  return (
    process.env.NEXT_PUBLIC_CHRONOS_WHEREBY_EMBED_SCRIPT_URL?.trim() ||
    defaultChronosWherebyEmbedScriptUrl
  );
}

export function isChronosWherebyProviderEnabled() {
  return process.env.CHRONOS_VIDEO_PROVIDER === "whereby";
}

export function getChronosWherebyConfig(): ChronosWherebyConfig {
  const apiKey =
    process.env.WHEREBY_API_KEY?.trim() ||
    process.env.CHRONOS_WHEREBY_API_KEY?.trim() ||
    "";
  const baseUrl =
    process.env.WHEREBY_API_BASE_URL?.trim() ||
    process.env.CHRONOS_WHEREBY_API_BASE_URL?.trim() ||
    defaultChronosWherebyBaseUrl;

  if (!apiKey) {
    throw new Error("Whereby nao esta configurado para o Chronos.");
  }

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
  };
}

export async function createChronosWherebyMeeting({
  backgroundDataUrl,
  endDate,
  recordingRequired,
  roomNamePrefix,
  roomSlug,
  transcriptionRequired,
}: ChronosWherebyCreateMeetingInput): Promise<ChronosWherebyMeeting> {
  const config = getChronosWherebyConfig();
  const body: Record<string, unknown> = {
    endDate,
    fields: ["hostRoomUrl"],
    isLocked: true,
    roomMode: "group",
    roomNamePattern: "human-short",
    roomNamePrefix: sanitizeChronosWherebyRoomNamePrefix(roomNamePrefix),
  };

  if (recordingRequired) {
    body.recording = {
      destination: {
        fileFormat: "mp4",
        provider: "whereby",
      },
      startTrigger: getChronosWherebyStartTrigger(
        process.env.CHRONOS_WHEREBY_RECORDING_START_TRIGGER,
      ),
      type: "cloud",
    };
  }

  if (transcriptionRequired) {
    body.liveTranscription = {
      destination: {
        provider: "whereby",
      },
      language: process.env.CHRONOS_WHEREBY_TRANSCRIPTION_LANGUAGE || "pt-BR",
      liveCaptions: true,
      startTrigger: getChronosWherebyTranscriptionStartTrigger(
        process.env.CHRONOS_WHEREBY_TRANSCRIPTION_START_TRIGGER,
      ),
    };
  }

  const meeting = normalizeChronosWherebyMeeting(
    await callChronosWherebyApi(config, "/meetings", {
      body,
      method: "POST",
    }),
  );

  await applyChronosWherebyRoomTheme({
    backgroundDataUrl,
    roomName: meeting.roomName,
    roomSlug,
  }).catch((error: unknown) => {
    console.warn(
      "[chronos] Whereby room theme update failed",
      error instanceof Error ? error.message : "unknown error",
    );
  });

  return meeting;
}

export async function listChronosWherebyRecordings(roomName: string) {
  const config = getChronosWherebyConfig();
  const payload = await callChronosWherebyApi(
    config,
    `/recordings?roomName=${encodeURIComponent(
      roomName,
    )}&sortBy=startDate:asc&limit=100`,
  );

  return readChronosWherebyList(payload)
    .map(normalizeChronosWherebyRecording)
    .filter(
      (recording): recording is ChronosWherebyRecording => Boolean(recording),
    );
}

export async function listChronosWherebyTranscriptions(roomName: string) {
  const config = getChronosWherebyConfig();
  const payload = await callChronosWherebyApi(
    config,
    `/transcriptions?roomName=${encodeURIComponent(
      roomName,
    )}&sortBy=startDate:asc&limit=100`,
  );

  return readChronosWherebyList(payload)
    .map(normalizeChronosWherebyTranscription)
    .filter(
      (transcription): transcription is ChronosWherebyTranscription =>
        Boolean(transcription),
    );
}

export async function listChronosWherebyRoomSessions(roomName: string) {
  const config = getChronosWherebyConfig();

  return readChronosWherebyList(
    await callChronosWherebyApi(
      config,
      `/insights/room-sessions?roomName=${encodeURIComponent(
        roomName,
      )}&limit=100`,
    ),
  );
}

export async function listChronosWherebyParticipants(roomSessionId: string) {
  const config = getChronosWherebyConfig();
  const payload = await callChronosWherebyApi(
    config,
    `/insights/participants?roomSessionId=${encodeURIComponent(
      roomSessionId,
    )}&sortBy=joinedAt:asc&limit=100`,
  );

  return readChronosWherebyList(payload)
    .map(normalizeChronosWherebyParticipant)
    .filter(
      (participant): participant is ChronosWherebyParticipant =>
        Boolean(participant),
    );
}

export async function getChronosWherebyRecordingAccessLink(recordingId: string) {
  const config = getChronosWherebyConfig();

  return normalizeChronosWherebyAccessLink(
    await callChronosWherebyApi(
      config,
      `/recordings/${encodeURIComponent(recordingId)}/access-link`,
    ),
  );
}

export async function createChronosWherebyTranscription(recordingId: string) {
  const config = getChronosWherebyConfig();

  await callChronosWherebyApi(config, "/transcriptions", {
    body: { recordingId },
    method: "POST",
  });
}

export async function getChronosWherebyTranscriptionAccessLink(
  transcriptionId: string,
) {
  const config = getChronosWherebyConfig();

  return normalizeChronosWherebyAccessLink(
    await callChronosWherebyApi(
      config,
      `/transcriptions/${encodeURIComponent(transcriptionId)}/access-link`,
    ),
  );
}

export async function applyChronosWherebyRoomTheme({
  backgroundDataUrl,
  roomName,
  roomSlug,
}: {
  backgroundDataUrl?: string | null;
  roomName: string;
  roomSlug: string;
}) {
  await updateChronosWherebyRoomThemeTokens({ roomName });

  if (!backgroundDataUrl) {
    return;
  }

  await Promise.all([
    updateChronosWherebyRoomBackground({
      dataUrl: backgroundDataUrl,
      roomName,
      roomSlug,
      themePath: "room-background",
    }),
    updateChronosWherebyRoomBackground({
      dataUrl: backgroundDataUrl,
      roomName,
      roomSlug,
      themePath: "room-knock-page-background",
    }),
  ]);
}

async function updateChronosWherebyRoomThemeTokens({
  roomName,
}: {
  roomName: string;
}) {
  const config = getChronosWherebyConfig();

  await callChronosWherebyApi(
    config,
    `/rooms/${encodeURIComponent(roomName)}/theme/tokens`,
    {
      body: {
        tokens: {
          colors: {
            focus: "#A07C3B",
            primary: "#A07C3B",
            secondary: "#101820",
          },
        },
        tokensPreset: "custom",
      },
      method: "PUT",
    },
  );
}

async function updateChronosWherebyRoomBackground({
  dataUrl,
  roomName,
  roomSlug,
  themePath,
}: {
  dataUrl: string;
  roomName: string;
  roomSlug: string;
  themePath: "room-background" | "room-knock-page-background";
}) {
  const file = readChronosWherebyDataUrlFile(dataUrl, roomSlug);

  if (!file) {
    return;
  }

  const config = getChronosWherebyConfig();
  const formData = new FormData();

  formData.set("image", file.blob, file.fileName);

  await callChronosWherebyApi(
    config,
    `/rooms/${encodeURIComponent(roomName)}/theme/${themePath}`,
    {
      body: formData,
      method: "PUT",
      rawBody: true,
    },
  );
}

async function callChronosWherebyApi(
  config: ChronosWherebyConfig,
  path: string,
  options: {
    body?: unknown;
    method?: "GET" | "POST" | "PUT";
    rawBody?: boolean;
  } = {},
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
  };
  const requestInit: RequestInit = {
    cache: "no-store",
    headers,
    method: options.method ?? "GET",
  };

  if (options.body !== undefined) {
    requestInit.body = options.rawBody
      ? (options.body as BodyInit)
      : JSON.stringify(options.body);

    if (!options.rawBody) {
      headers["Content-Type"] = "application/json";
    }
  }

  const response = await fetch(`${config.baseUrl}${path}`, requestInit);
  const text = await response.text();
  const payload = text ? parseChronosWherebyJson(text) : null;

  if (!response.ok) {
    const message =
      readChronosWherebyText(payload, ["message"]) ||
      readChronosWherebyText(payload, ["error"]) ||
      `Whereby falhou com status ${response.status}.`;

    throw new Error(message);
  }

  return payload;
}

function normalizeChronosWherebyMeeting(value: unknown): ChronosWherebyMeeting {
  const payload = readChronosWherebyObject(value);
  const meetingId = readChronosWherebyText(payload, ["meetingId", "id"]);
  const roomName = readChronosWherebyText(payload, ["roomName"]);
  const roomUrl = readChronosWherebyText(payload, ["roomUrl"]);
  const endDate = readChronosWherebyText(payload, ["endDate"]);

  if (!meetingId || !roomName || !roomUrl || !endDate) {
    throw new Error("Whereby nao retornou a sala criada para o Chronos.");
  }

  return {
    endDate,
    hostRoomUrl: readChronosWherebyText(payload, ["hostRoomUrl"]),
    meetingId,
    roomName,
    roomUrl,
    startDate: readChronosWherebyText(payload, ["startDate"]),
    viewerRoomUrl: readChronosWherebyText(payload, ["viewerRoomUrl"]),
  };
}

function normalizeChronosWherebyRecording(
  value: unknown,
): ChronosWherebyRecording | null {
  const payload = readChronosWherebyObject(value);
  const recordingId = readChronosWherebyText(payload, ["recordingId", "id"]);

  if (!recordingId) {
    return null;
  }

  return {
    endDate: readChronosWherebyText(payload, ["endDate", "endedAt"]),
    filename: readChronosWherebyText(payload, ["filename", "fileName"]),
    recordingId,
    roomSessionId: readChronosWherebyText(payload, ["roomSessionId"]),
    sizeInMegaBytes: readChronosWherebyNumber(payload, ["sizeInMegaBytes"]),
    startDate: readChronosWherebyText(payload, ["startDate", "startedAt"]),
  };
}

function normalizeChronosWherebyTranscription(
  value: unknown,
): ChronosWherebyTranscription | null {
  const payload = readChronosWherebyObject(value);
  const transcriptionId = readChronosWherebyText(payload, [
    "transcriptionId",
    "id",
  ]);

  if (!transcriptionId) {
    return null;
  }

  return {
    createdAt: readChronosWherebyText(payload, ["createdAt"]),
    durationInSeconds: readChronosWherebyNumber(payload, ["durationInSeconds"]),
    endDate: readChronosWherebyText(payload, ["endDate", "endedAt"]),
    filename: readChronosWherebyText(payload, ["filename", "fileName"]),
    roomName: readChronosWherebyText(payload, ["roomName"]),
    roomSessionId: readChronosWherebyText(payload, ["roomSessionId"]),
    startDate: readChronosWherebyText(payload, ["startDate", "startedAt"]),
    state: readChronosWherebyText(payload, ["state"]) ?? undefined,
    storageType: readChronosWherebyText(payload, ["storageType"]),
    transcriptionId,
    type: readChronosWherebyText(payload, ["type"]),
  };
}

function normalizeChronosWherebyParticipant(
  value: unknown,
): ChronosWherebyParticipant | null {
  const payload = readChronosWherebyObject(value);
  const participantId = readChronosWherebyText(payload, ["participantId", "id"]);

  if (!participantId) {
    return null;
  }

  return {
    displayName: readChronosWherebyText(payload, ["displayName"]),
    externalId: readChronosWherebyText(payload, ["externalId"]),
    joinedAt: readChronosWherebyText(payload, ["joinedAt"]),
    leftAt: readChronosWherebyText(payload, ["leftAt"]),
    participantId,
    roleName: readChronosWherebyText(payload, ["roleName"]),
  };
}

function normalizeChronosWherebyAccessLink(
  value: unknown,
): ChronosWherebyAccessLink {
  const payload = readChronosWherebyObject(value);
  const accessLink = readChronosWherebyText(payload, ["accessLink", "url"]);

  if (!accessLink) {
    throw new Error("Whereby nao retornou link de acesso.");
  }

  return {
    accessLink,
    expires: readChronosWherebyText(payload, ["expires", "expiresAt"]),
  };
}

function readChronosWherebyDataUrlFile(dataUrl: string, roomSlug: string) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(
    dataUrl.trim(),
  );

  if (!match) {
    return null;
  }

  const dataUrlMimeType = match[1];
  const base64Payload = match[2];

  if (!dataUrlMimeType || !base64Payload) {
    return null;
  }

  const mimeType = dataUrlMimeType
    .toLowerCase()
    .replace("image/jpg", "image/jpeg");
  const bytes = Buffer.from(base64Payload, "base64");
  const maxBytes = Number(process.env.CHRONOS_WHEREBY_BACKGROUND_MAX_BYTES) ||
    600 * 1024;

  if (bytes.length > maxBytes) {
    throw new Error(
      "Fundo Chronos excede o limite de envio do Whereby para background.",
    );
  }

  const extension = mimeType === "image/png" ? "png" : "jpg";
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  return {
    blob: new Blob([arrayBuffer], { type: mimeType }),
    fileName: `${sanitizeChronosWherebyRoomNamePrefix(roomSlug)}.${extension}`,
  };
}

function getChronosWherebyStartTrigger(value?: string | null) {
  const normalized = value?.trim();

  return normalized === "none" ||
    normalized === "prompt" ||
    normalized === "automatic"
    ? normalized
    : "automatic-2nd-participant";
}

function getChronosWherebyTranscriptionStartTrigger(value?: string | null) {
  const normalized = value?.trim();

  return normalized === "none" ||
    normalized === "manual" ||
    normalized === "automatic"
    ? normalized
    : "automatic-2nd-participant";
}

function sanitizeChronosWherebyRoomNamePrefix(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);

  return normalized || "careli";
}

function readChronosWherebyList(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const objectPayload = readChronosWherebyObject(payload);
  const results =
    objectPayload.results ??
    objectPayload.data ??
    objectPayload.items ??
    objectPayload.recordings ??
    objectPayload.transcriptions ??
    objectPayload.roomSessions ??
    objectPayload.sessions ??
    objectPayload.participants;

  return Array.isArray(results) ? results : [];
}

function readChronosWherebyObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readChronosWherebyText(
  payload: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = payload[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readChronosWherebyNumber(
  payload: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = payload[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function parseChronosWherebyJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
