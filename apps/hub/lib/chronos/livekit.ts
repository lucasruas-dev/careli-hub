import { createHmac, randomUUID } from "node:crypto";

const chronosLiveKitTokenTtlSeconds = 4 * 60 * 60;

type ChronosLiveKitConfig = {
  apiKey: string;
  apiSecret: string;
  url: string;
};

type ChronosLiveKitTokenInput = {
  displayName: string;
  isHost: boolean;
  meetingId: string;
  organization?: string | null;
  participantId: string;
  roomSlug: string;
};

export type ChronosLiveKitTokenPayload = {
  provider: "livekit";
  roomName: string;
  token: string;
  url: string;
};

type ChronosLiveKitEgressStorageConfig = {
  accessKey: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  region: string;
  secret: string;
};

type ChronosLiveKitEgressInput = {
  audioOnly?: boolean;
  customBaseUrl?: string | null;
  meetingId: string;
  participantId: string;
  roomSlug: string;
};

export type ChronosLiveKitParticipantAudioTrack = {
  muted: boolean;
  organization?: string | null;
  participantId: string;
  participantIdentity: string;
  participantName: string;
  trackId: string;
  trackMimeType?: string | null;
  trackName?: string | null;
  trackSource?: string | null;
};

export type ChronosLiveKitEgressPayload = {
  egressId: string;
  fileName: string;
  kind: "audio" | "participant-audio" | "video";
  mimeType: "audio/mp4" | "audio/ogg" | "video/mp4";
  participantAudioTrack?: ChronosLiveKitParticipantAudioTrack;
  provider: "livekit";
  roomName: string;
  status: string;
  storageBucket: string;
  storagePath: string;
};

export type ChronosLiveKitEgressFileResult = {
  durationSeconds?: number | null;
  fileName?: string | null;
  location?: string | null;
  sizeBytes?: number | null;
};

export type ChronosLiveKitEgressStatusPayload = {
  egressId: string;
  file?: ChronosLiveKitEgressFileResult | null;
  status: string;
};

export function getChronosLiveKitConfig() {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

  if (!url || !apiKey || !apiSecret) {
    return null;
  }

  return {
    apiKey,
    apiSecret,
    url,
  } satisfies ChronosLiveKitConfig;
}

export function isChronosLiveKitProviderEnabled() {
  return process.env.CHRONOS_VIDEO_PROVIDER === "livekit";
}

export function createChronosLiveKitToken({
  displayName,
  isHost,
  meetingId,
  organization,
  participantId,
  roomSlug,
}: ChronosLiveKitTokenInput): ChronosLiveKitTokenPayload {
  const config = getChronosLiveKitConfig();

  if (!config) {
    throw new Error("LiveKit nao esta configurado para o Chronos.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const roomName = createChronosLiveKitRoomName({ meetingId, roomSlug });
  const metadata = {
    displayName,
    isHost,
    meetingId,
    organization: organization ?? "",
    participantId,
    roomSlug,
  };
  const payload = {
    exp: nowSeconds + chronosLiveKitTokenTtlSeconds,
    iat: nowSeconds,
    iss: config.apiKey,
    jti: randomUUID(),
    metadata: JSON.stringify(metadata),
    name: displayName,
    nbf: nowSeconds - 10,
    sub: participantId,
    video: {
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      room: roomName,
      roomAdmin: isHost,
      roomJoin: true,
    },
  };

  return {
    provider: "livekit",
    roomName,
    token: signChronosLiveKitJwt(payload, config.apiSecret),
    url: config.url,
  };
}

export async function startChronosLiveKitRoomCompositeEgress({
  audioOnly = false,
  customBaseUrl,
  meetingId,
  participantId,
  roomSlug,
}: ChronosLiveKitEgressInput): Promise<ChronosLiveKitEgressPayload> {
  const config = getChronosLiveKitConfig();

  if (!config) {
    throw new Error("LiveKit nao esta configurado para gravacao Chronos.");
  }

  const storage = getChronosLiveKitEgressStorageConfig();
  const roomName = createChronosLiveKitRoomName({ meetingId, roomSlug });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const kind = audioOnly ? "audio" : "video";
  const extension = "mp4";
  const fileName = `${roomSlug}-${timestamp}${audioOnly ? "-audio" : ""}.${extension}`;
  const storagePath = `recordings/${sanitizeChronosLiveKitPathSegment(
    roomSlug,
  )}/${sanitizeChronosLiveKitPathSegment(
    meetingId,
  )}/${sanitizeChronosLiveKitPathSegment(
    participantId,
  )}${audioOnly ? "-audio" : ""}-${timestamp}.${extension}`;
  const requestBody: Record<string, unknown> = {
    file_outputs: [
      {
        file_type: "MP4",
        filepath: storagePath,
        s3: {
          access_key: storage.accessKey,
          bucket: storage.bucket,
          endpoint: storage.endpoint,
          force_path_style: storage.forcePathStyle,
          region: storage.region,
          secret: storage.secret,
        },
      },
    ],
    room_name: roomName,
  };

  if (audioOnly) {
    requestBody.audio_only = true;
  } else {
    requestBody.layout = "grid";
    const normalizedCustomBaseUrl =
      normalizeChronosLiveKitCustomBaseUrl(customBaseUrl);

    if (normalizedCustomBaseUrl) {
      requestBody.custom_base_url = normalizedCustomBaseUrl;
    }
  }

  const payload = await callChronosLiveKitEgressApi(config, {
    body: requestBody,
    method: "StartRoomCompositeEgress",
    roomName,
  });

  return {
    egressId: readChronosLiveKitEgressId(payload),
    fileName,
    kind,
    mimeType: audioOnly ? "audio/mp4" : "video/mp4",
    provider: "livekit",
    roomName,
    status: readChronosLiveKitEgressStatus(payload),
    storageBucket: storage.bucket,
    storagePath,
  };
}

export async function listChronosLiveKitParticipantAudioTracks({
  meetingId,
  roomSlug,
}: {
  meetingId: string;
  roomSlug: string;
}): Promise<ChronosLiveKitParticipantAudioTrack[]> {
  const config = getChronosLiveKitConfig();

  if (!config) {
    throw new Error("LiveKit nao esta configurado para listar participantes.");
  }

  const roomName = createChronosLiveKitRoomName({ meetingId, roomSlug });
  const payload = await callChronosLiveKitRoomServiceApi(config, {
    body: {
      room: roomName,
    },
    method: "ListParticipants",
    roomName,
  });
  const participants = Array.isArray(payload.participants)
    ? payload.participants
    : [];
  const tracksById = new Map<string, ChronosLiveKitParticipantAudioTrack>();

  for (const participant of participants) {
    if (!participant || typeof participant !== "object") {
      continue;
    }

    const participantPayload = participant as Record<string, unknown>;

    if (isChronosLiveKitEgressParticipant(participantPayload)) {
      continue;
    }

    const metadata = readChronosLiveKitParticipantMetadata(
      readChronosLiveKitText(participantPayload, ["metadata"]),
    );
    const participantIdentity =
      readChronosLiveKitText(participantPayload, ["identity"]) ??
      metadata.participantId ??
      "";

    if (!participantIdentity) {
      continue;
    }

    const participantName =
      readChronosLiveKitText(participantPayload, ["name"]) ??
      metadata.displayName ??
      "Participante Chronos";
    const participantId = metadata.participantId || participantIdentity;
    const tracks = Array.isArray(participantPayload.tracks)
      ? participantPayload.tracks
      : [];

    for (const track of tracks) {
      if (!track || typeof track !== "object") {
        continue;
      }

      const trackPayload = track as Record<string, unknown>;

      if (!isChronosLiveKitMicrophoneAudioTrack(trackPayload)) {
        continue;
      }

      const trackId = readChronosLiveKitText(trackPayload, [
        "sid",
        "track_sid",
        "trackSid",
      ]);

      if (!trackId || tracksById.has(trackId)) {
        continue;
      }

      tracksById.set(trackId, {
        muted: readChronosLiveKitBoolean(trackPayload, ["muted"]) ?? false,
        organization: metadata.organization,
        participantId,
        participantIdentity,
        participantName,
        trackId,
        trackMimeType: readChronosLiveKitText(trackPayload, [
          "mime_type",
          "mimeType",
        ]),
        trackName: readChronosLiveKitText(trackPayload, ["name"]),
        trackSource: normalizeChronosLiveKitTrackSource(
          trackPayload.source,
        ),
      });
    }
  }

  return [...tracksById.values()];
}

export async function startChronosLiveKitParticipantAudioTrackEgress({
  meetingId,
  roomSlug,
  track,
}: {
  meetingId: string;
  roomSlug: string;
  track: ChronosLiveKitParticipantAudioTrack;
}): Promise<ChronosLiveKitEgressPayload> {
  const config = getChronosLiveKitConfig();

  if (!config) {
    throw new Error("LiveKit nao esta configurado para gravacao Chronos.");
  }

  const storage = getChronosLiveKitEgressStorageConfig();
  const roomName = createChronosLiveKitRoomName({ meetingId, roomSlug });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const participantSegment = sanitizeChronosLiveKitPathSegment(
    track.participantIdentity,
  );
  const trackSegment = sanitizeChronosLiveKitPathSegment(track.trackId);
  const fileName = `${roomSlug}-${timestamp}-${participantSegment}-${trackSegment}-audio.ogg`;
  const storagePath = `recordings/${sanitizeChronosLiveKitPathSegment(
    roomSlug,
  )}/${sanitizeChronosLiveKitPathSegment(
    meetingId,
  )}/participants/${participantSegment}/${trackSegment}-${timestamp}.ogg`;
  const payload = await callChronosLiveKitEgressApi(config, {
    body: {
      file: {
        filepath: storagePath,
        s3: {
          access_key: storage.accessKey,
          bucket: storage.bucket,
          endpoint: storage.endpoint,
          force_path_style: storage.forcePathStyle,
          region: storage.region,
          secret: storage.secret,
        },
      },
      room_name: roomName,
      track_id: track.trackId,
    },
    method: "StartTrackEgress",
    roomName,
  });

  return {
    egressId: readChronosLiveKitEgressId(payload),
    fileName,
    kind: "participant-audio",
    mimeType: "audio/ogg",
    participantAudioTrack: track,
    provider: "livekit",
    roomName,
    status: readChronosLiveKitEgressStatus(payload),
    storageBucket: storage.bucket,
    storagePath,
  };
}

export async function stopChronosLiveKitEgress(
  egressId: string,
): Promise<ChronosLiveKitEgressStatusPayload> {
  const config = getChronosLiveKitConfig();
  const normalizedEgressId = egressId.trim();

  if (!config) {
    throw new Error("LiveKit nao esta configurado para gravacao Chronos.");
  }

  if (!normalizedEgressId) {
    throw new Error("Egress LiveKit nao informado.");
  }

  const payload = await callChronosLiveKitEgressApi(config, {
    body: {
      egress_id: normalizedEgressId,
    },
    method: "StopEgress",
  });

  return {
    egressId: readChronosLiveKitEgressId(payload) || normalizedEgressId,
    file: readChronosLiveKitEgressFileResult(payload),
    status: readChronosLiveKitEgressStatus(payload),
  };
}

export async function getChronosLiveKitEgressStatus(
  egressId: string,
): Promise<ChronosLiveKitEgressStatusPayload> {
  const config = getChronosLiveKitConfig();
  const normalizedEgressId = egressId.trim();

  if (!config) {
    throw new Error("LiveKit nao esta configurado para gravacao Chronos.");
  }

  if (!normalizedEgressId) {
    throw new Error("Egress LiveKit nao informado.");
  }

  const payload = await callChronosLiveKitEgressApi(config, {
    body: {
      egress_id: normalizedEgressId,
    },
    method: "ListEgress",
  });
  const items = Array.isArray(payload.items) ? payload.items : [];
  const egressPayload = items.find(
    (item): item is Record<string, unknown> =>
      item !== null &&
      typeof item === "object" &&
      (item as Record<string, unknown>).egress_id === normalizedEgressId,
  );

  if (!egressPayload) {
    throw new Error("LiveKit nao encontrou o Egress informado.");
  }

  return {
    egressId: readChronosLiveKitEgressId(egressPayload),
    file: readChronosLiveKitEgressFileResult(egressPayload),
    status: readChronosLiveKitEgressStatus(egressPayload),
  };
}

export async function deleteChronosLiveKitRoom({
  meetingId,
  roomSlug,
}: {
  meetingId: string;
  roomSlug: string;
}) {
  const config = getChronosLiveKitConfig();

  if (!config) {
    throw new Error("LiveKit nao esta configurado para encerrar sala Chronos.");
  }

  const roomName = createChronosLiveKitRoomName({ meetingId, roomSlug });

  await callChronosLiveKitRoomServiceApi(config, {
    body: {
      room: roomName,
    },
    method: "DeleteRoom",
    roomName,
  });

  return {
    ok: true,
    roomName,
  };
}

export function createChronosLiveKitRoomName({
  meetingId,
  roomSlug,
}: {
  meetingId: string;
  roomSlug: string;
}) {
  const normalizedSlug = roomSlug.replace(/[^a-zA-Z0-9_-]/g, "-");
  const normalizedMeetingId = meetingId.replace(/[^a-zA-Z0-9_-]/g, "");

  return `chronos-${normalizedSlug}-${normalizedMeetingId}`.slice(0, 96);
}

async function callChronosLiveKitEgressApi(
  config: ChronosLiveKitConfig,
  {
    body,
    method,
    roomName,
  }: {
    body: Record<string, unknown>;
    method:
      | "ListEgress"
      | "StartRoomCompositeEgress"
      | "StartTrackEgress"
      | "StopEgress";
    roomName?: string;
  },
) {
  const response = await fetch(
    `${getChronosLiveKitHttpBaseUrl(config.url)}/twirp/livekit.Egress/${method}`,
    {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${createChronosLiveKitEgressToken({
          config,
          roomName,
        })}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    const message =
      typeof payload.msg === "string"
        ? payload.msg
        : typeof payload.error === "string"
          ? payload.error
          : `LiveKit Egress falhou com status ${response.status}.`;

    throw new Error(message);
  }

  return payload;
}

async function callChronosLiveKitRoomServiceApi(
  config: ChronosLiveKitConfig,
  {
    body,
    method,
    roomName,
  }: {
    body: Record<string, unknown>;
    method: "DeleteRoom" | "ListParticipants";
    roomName?: string;
  },
) {
  const response = await fetch(
    `${getChronosLiveKitHttpBaseUrl(config.url)}/twirp/livekit.RoomService/${method}`,
    {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${createChronosLiveKitRoomServiceToken({
          config,
          roomName,
        })}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  if (!response.ok) {
    const message =
      typeof payload.msg === "string"
        ? payload.msg
        : typeof payload.error === "string"
          ? payload.error
          : `LiveKit RoomService falhou com status ${response.status}.`;

    throw new Error(message);
  }

  return payload;
}

function createChronosLiveKitEgressToken({
  config,
  roomName,
}: {
  config: ChronosLiveKitConfig;
  roomName?: string;
}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const videoGrant: Record<string, unknown> = {
    roomRecord: true,
  };

  if (roomName) {
    videoGrant.room = roomName;
  }

  return signChronosLiveKitJwt(
    {
      exp: nowSeconds + 10 * 60,
      iat: nowSeconds,
      iss: config.apiKey,
      jti: randomUUID(),
      nbf: nowSeconds - 10,
      sub: "chronos-livekit-egress",
      video: videoGrant,
    },
    config.apiSecret,
  );
}

function createChronosLiveKitRoomServiceToken({
  config,
  roomName,
}: {
  config: ChronosLiveKitConfig;
  roomName?: string;
}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const videoGrant: Record<string, unknown> = {
    roomAdmin: true,
    roomCreate: true,
    roomList: true,
  };

  if (roomName) {
    videoGrant.room = roomName;
  }

  return signChronosLiveKitJwt(
    {
      exp: nowSeconds + 10 * 60,
      iat: nowSeconds,
      iss: config.apiKey,
      jti: randomUUID(),
      nbf: nowSeconds - 10,
      sub: "chronos-livekit-room-service",
      video: videoGrant,
    },
    config.apiSecret,
  );
}

function getChronosLiveKitHttpBaseUrl(url: string) {
  if (url.startsWith("wss://")) {
    return `https://${url.slice("wss://".length)}`.replace(/\/+$/, "");
  }

  if (url.startsWith("ws://")) {
    return `http://${url.slice("ws://".length)}`.replace(/\/+$/, "");
  }

  return url.replace(/\/+$/, "");
}

function getChronosLiveKitEgressStorageConfig(): ChronosLiveKitEgressStorageConfig {
  const explicitAccessKey =
    process.env.CHRONOS_LIVEKIT_EGRESS_S3_ACCESS_KEY?.trim() ||
    process.env.CHRONOS_LIVEKIT_EGRESS_S3_ACCESS_KEY_ID?.trim();
  const explicitSecret =
    process.env.CHRONOS_LIVEKIT_EGRESS_S3_SECRET?.trim() ||
    process.env.CHRONOS_LIVEKIT_EGRESS_S3_SECRET_ACCESS_KEY?.trim();
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim();
  const supabaseProjectRef = readChronosSupabaseProjectRef(supabaseUrl);
  const accessKey = explicitAccessKey;
  const bucket = process.env.CHRONOS_LIVEKIT_EGRESS_S3_BUCKET?.trim();
  const region = process.env.CHRONOS_LIVEKIT_EGRESS_S3_REGION?.trim();
  const secret = explicitSecret;

  if (!accessKey || !bucket || !region || !secret) {
    throw new Error(
      "LiveKit Egress storage nao configurado. Configure CHRONOS_LIVEKIT_EGRESS_S3_BUCKET, CHRONOS_LIVEKIT_EGRESS_S3_REGION e credenciais S3 explicitas em CHRONOS_LIVEKIT_EGRESS_S3_ACCESS_KEY e CHRONOS_LIVEKIT_EGRESS_S3_SECRET_ACCESS_KEY.",
    );
  }

  return {
    accessKey,
    bucket,
    endpoint:
      process.env.CHRONOS_LIVEKIT_EGRESS_S3_ENDPOINT?.trim() ||
      (supabaseProjectRef
        ? `https://${supabaseProjectRef}.storage.supabase.co/storage/v1/s3`
        : undefined),
    forcePathStyle:
      process.env.CHRONOS_LIVEKIT_EGRESS_S3_FORCE_PATH_STYLE === "true",
    region,
    secret,
  };
}

function readChronosSupabaseProjectRef(url?: string) {
  if (!url) {
    return undefined;
  }

  try {
    const host = new URL(url).host;
    const [projectRef] = host.split(".");

    return projectRef?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function readChronosLiveKitEgressId(payload: Record<string, unknown>) {
  const egressId = payload.egress_id;

  if (typeof egressId !== "string" || !egressId.trim()) {
    throw new Error("LiveKit nao retornou o identificador do Egress.");
  }

  return egressId;
}

function readChronosLiveKitEgressStatus(payload: Record<string, unknown>) {
  const status = payload.status;

  return typeof status === "string" || typeof status === "number"
    ? String(status)
    : "unknown";
}

function normalizeChronosLiveKitCustomBaseUrl(value?: string | null) {
  if (!value?.trim()) {
    return "";
  }

  try {
    const url = new URL(value.trim());

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "";
    }

    return url.toString();
  } catch {
    return "";
  }
}

function readChronosLiveKitEgressFileResult(
  payload: Record<string, unknown>,
): ChronosLiveKitEgressFileResult | null {
  const fileResults = Array.isArray(payload.file_results)
    ? payload.file_results
    : Array.isArray(payload.fileResults)
      ? payload.fileResults
      : [];
  const directFilePayload =
    payload.file && typeof payload.file === "object"
      ? (payload.file as Record<string, unknown>)
      : null;
  const filePayload = directFilePayload ?? fileResults.find(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === "object",
  );

  if (!filePayload) {
    return null;
  }

  return {
    durationSeconds: normalizeChronosLiveKitDurationSeconds(
      readChronosLiveKitNumber(filePayload, [
        "duration",
        "duration_ns",
        "durationNs",
      ]),
    ),
    fileName: readChronosLiveKitText(filePayload, [
      "filename",
      "file_name",
      "filepath",
    ]),
    location: readChronosLiveKitText(filePayload, ["location"]),
    sizeBytes: readChronosLiveKitNumber(filePayload, [
      "size",
      "size_bytes",
      "sizeBytes",
    ]),
  };
}

function readChronosLiveKitText(
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

function readChronosLiveKitNumber(
  payload: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = payload[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const numberValue = Number(value);

      if (Number.isFinite(numberValue)) {
        return numberValue;
      }
    }
  }

  return null;
}

function readChronosLiveKitBoolean(
  payload: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = payload[key];

    if (typeof value === "boolean") {
      return value;
    }
  }

  return null;
}

function readChronosLiveKitParticipantMetadata(value?: string | null) {
  if (!value) {
    return {};
  }

  try {
    const metadata = JSON.parse(value) as Record<string, unknown>;

    return {
      displayName: readChronosLiveKitText(metadata, ["displayName"]),
      organization: readChronosLiveKitText(metadata, ["organization"]),
      participantId: readChronosLiveKitText(metadata, ["participantId"]),
    };
  } catch {
    return {};
  }
}

function isChronosLiveKitEgressParticipant(
  participant: Record<string, unknown>,
) {
  const kind = participant.kind;

  return kind === 2 || kind === "EGRESS";
}

function isChronosLiveKitMicrophoneAudioTrack(
  track: Record<string, unknown>,
) {
  const type = track.type;
  const source = track.source;
  const isAudio =
    type === 0 ||
    type === "AUDIO" ||
    readChronosLiveKitText(track, ["mime_type", "mimeType"])?.startsWith(
      "audio/",
    );
  const isMicrophone =
    source === 2 ||
    source === "MICROPHONE" ||
    source === undefined ||
    source === null;

  return isAudio && isMicrophone;
}

function normalizeChronosLiveKitTrackSource(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (value === 2) {
    return "MICROPHONE";
  }

  if (value === 4) {
    return "SCREEN_SHARE_AUDIO";
  }

  return null;
}

function normalizeChronosLiveKitDurationSeconds(duration: number | null) {
  if (duration === null) {
    return null;
  }

  return duration > 100_000 ? Math.max(0, Math.round(duration / 1_000_000_000)) : duration;
}

function sanitizeChronosLiveKitPathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96) || "chronos";
}

function signChronosLiveKitJwt(
  payload: Record<string, unknown>,
  secret: string,
) {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}
