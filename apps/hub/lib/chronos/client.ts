"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import {
  chronosCaptureStatuses,
  chronosEventTypes,
  chronosFollowUpStatuses,
  chronosMeetingStatuses,
  chronosMeetingTypes,
  chronosMinutesStatuses,
  chronosParticipantRoles,
  defaultChronosMeetingProfiles,
  type ChronosCaptureStatus,
  type ChronosCreateMeetingInput,
  type ChronosEventType,
  type ChronosFollowUpStatus,
  type ChronosGoogleCalendarSyncDirection,
  type ChronosGoogleCalendarSyncResult,
  type ChronosGoogleCalendarStatus,
  type ChronosHubInvitee,
  type ChronosMeeting,
  type ChronosMeetingDeleteInput,
  type ChronosMeetingProfile,
  type ChronosMeetingProfileDeleteInput,
  type ChronosMeetingProfileInput,
  type ChronosMeetingStatus,
  type ChronosMeetingType,
  type ChronosMinutesStatus,
  type ChronosMinutesProfile,
  type ChronosParticipantRole,
  type ChronosRoom,
  type ChronosRoomDeleteInput,
  type ChronosRoomInput,
  type ChronosRoomUpdateInput,
  type ChronosSnapshot,
  type ChronosUpdateInput,
} from "./types";

type ChronosApiResponse = Partial<ChronosSnapshot> & {
  authorizationUrl?: string;
  error?: unknown;
  googleCalendar?: ChronosGoogleCalendarStatus | ChronosGoogleCalendarSyncResult;
  invitees?: ChronosHubInvitee[];
  meeting?: ChronosMeeting;
  meetingId?: string;
  minutes?: string;
  minutesProfile?: ChronosMinutesProfile;
  profile?: ChronosMeetingProfile;
  room?: ChronosRoom;
  source?: string;
  summary?: string;
  transcript?: string;
};

export async function getChronosAccessToken(fallback?: string | null) {
  if (fallback) {
    return fallback;
  }

  const client = getHubSupabaseClient();

  if (!client) {
    return "local-chronos-user";
  }

  const { data, error } = await client.auth.getSession();

  if (error || !data.session?.access_token) {
    throw new Error("Sessao ausente para carregar o Chronos.");
  }

  return data.session.access_token;
}

export async function loadChronosSnapshot(accessToken?: string | null) {
  const token = await getChronosAccessToken(accessToken);
  const response = await fetch("/api/chronos/meetings", {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | ChronosApiResponse
    | null;

  if (!response.ok || !payload || !Array.isArray(payload.meetings)) {
    throw new Error(
      getChronosApiErrorMessage(payload, "Nao foi possivel carregar o Chronos."),
    );
  }

  return normalizeChronosSnapshot(payload);
}

export async function loadChronosGoogleCalendarStatus(
  accessToken?: string | null,
) {
  const token = await getChronosAccessToken(accessToken);
  const response = await fetch("/api/chronos/google-calendar/status", {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | ChronosApiResponse
    | null;

  const googleCalendar = payload?.googleCalendar as
    | ChronosGoogleCalendarStatus
    | undefined;

  if (!response.ok || !googleCalendar) {
    throw new Error(
      getChronosApiErrorMessage(
        payload,
        "Nao foi possivel carregar o status do Google Agenda.",
      ),
    );
  }

  return googleCalendar;
}

export async function startChronosGoogleCalendarConnection(
  returnTo = "/chronos",
) {
  const token = await getChronosAccessToken();
  const searchParams = new URLSearchParams({
    response: "json",
    returnTo,
  });
  const response = await fetch(
    `/api/chronos/google-calendar/authorize?${searchParams.toString()}`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | ChronosApiResponse
    | null;

  if (!response.ok || !payload?.authorizationUrl) {
    throw new Error(
      getChronosApiErrorMessage(
        payload,
        "Nao foi possivel iniciar a conexao com Google Agenda.",
      ),
    );
  }

  return payload.authorizationUrl;
}

export async function syncChronosGoogleCalendar(
  direction: ChronosGoogleCalendarSyncDirection = "both",
  options: { full?: boolean } = {},
) {
  const token = await getChronosAccessToken();
  const response = await fetch("/api/chronos/google-calendar/sync", {
    body: JSON.stringify({ direction, full: options.full === true }),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | ChronosApiResponse
    | null;
  const result = payload?.googleCalendar as
    | ChronosGoogleCalendarSyncResult
    | undefined;

  if (!response.ok || !result) {
    throw new Error(
      getChronosApiErrorMessage(
        payload,
        "Nao foi possivel sincronizar Google Agenda.",
      ),
    );
  }

  return result;
}

export async function createChronosMeeting(input: ChronosCreateMeetingInput) {
  const token = await getChronosAccessToken();
  const response = await fetch("/api/chronos/meetings", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | ChronosApiResponse
    | null;

  if (!response.ok || !payload?.meeting) {
    throw new Error(
      getChronosApiErrorMessage(payload, "Nao foi possivel criar a reuniao."),
    );
  }

  return normalizeChronosMeeting(payload.meeting);
}

export async function deleteChronosMeeting(input: ChronosMeetingDeleteInput) {
  const token = await getChronosAccessToken();
  const response = await fetch("/api/chronos/meetings", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "DELETE",
  });
  const payload = (await response.json().catch(() => null)) as
    | ChronosApiResponse
    | null;

  if (!response.ok || !payload?.meetingId) {
    throw new Error(
      getChronosApiErrorMessage(payload, "Nao foi possivel excluir o evento."),
    );
  }

  return payload.meetingId;
}

export async function searchChronosInternalInvitees(query: string) {
  const token = await getChronosAccessToken();
  const params = new URLSearchParams({
    limit: "10",
    q: query,
  });
  const response = await fetch(`/api/chronos/invitees?${params.toString()}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | ChronosApiResponse
    | null;

  if (!response.ok || !Array.isArray(payload?.invitees)) {
    throw new Error(
      getChronosApiErrorMessage(
        payload,
        "Nao foi possivel buscar o time interno.",
      ),
    );
  }

  return payload.invitees;
}

export async function createChronosRoom(input: ChronosRoomInput) {
  return mutateChronosRoom("POST", input);
}

export async function updateChronosRoom(input: ChronosRoomUpdateInput) {
  return mutateChronosRoom("PATCH", input);
}

export async function deleteChronosRoom(input: ChronosRoomDeleteInput) {
  return mutateChronosRoom("DELETE", input);
}

export async function createChronosProfile(input: ChronosMeetingProfileInput) {
  return mutateChronosProfile("POST", input);
}

export async function deleteChronosProfile(
  input: ChronosMeetingProfileDeleteInput,
) {
  return mutateChronosProfile("DELETE", input);
}

async function mutateChronosRoom(
  method: "DELETE" | "PATCH" | "POST",
  input: ChronosRoomDeleteInput | ChronosRoomInput | ChronosRoomUpdateInput,
) {
  const token = await getChronosAccessToken();
  const response = await fetch("/api/chronos/rooms", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method,
  });
  const payload = (await response.json().catch(() => null)) as
    | ChronosApiResponse
    | null;

  if (!response.ok || !payload?.room) {
    throw new Error(
      getChronosApiErrorMessage(payload, "Nao foi possivel salvar a sala."),
    );
  }

  return payload.room;
}

async function mutateChronosProfile(
  method: "DELETE" | "POST",
  input: ChronosMeetingProfileDeleteInput | ChronosMeetingProfileInput,
) {
  const token = await getChronosAccessToken();
  const response = await fetch("/api/chronos/profiles", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method,
  });
  const payload = (await response.json().catch(() => null)) as
    | ChronosApiResponse
    | null;

  if (!response.ok || !payload?.profile) {
    throw new Error(
      getChronosApiErrorMessage(payload, "Nao foi possivel salvar o perfil."),
    );
  }

  return payload.profile;
}

export async function updateChronosMeeting(input: ChronosUpdateInput) {
  const token = await getChronosAccessToken();
  const response = await fetch("/api/chronos/meetings", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  const payload = (await response.json().catch(() => null)) as
    | ChronosApiResponse
    | null;

  if (!response.ok || !payload?.meeting) {
    throw new Error(
      getChronosApiErrorMessage(
        payload,
        "Nao foi possivel atualizar a reuniao.",
      ),
    );
  }

  return normalizeChronosMeeting(payload.meeting);
}

export async function transcribeChronosRecording(input: {
  file: Blob;
  fileName?: string;
  meetingId: string;
  minutesProfile?: ChronosMinutesProfile;
  speakerLabel?: string;
}) {
  const token = await getChronosAccessToken();
  const formData = new FormData();

  formData.append("action", "transcribe_recording");
  formData.append("meetingId", input.meetingId);
  formData.append("minutesProfile", input.minutesProfile ?? "alinhamento");

  if (input.speakerLabel) {
    formData.append("speakerLabel", input.speakerLabel);
  }

  formData.append(
    "file",
    input.file,
    input.fileName || "chronos-recording.webm",
  );

  const response = await fetch("/api/chronos/meetings/agent", {
    body: formData,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | ChronosApiResponse
    | null;

  if (!response.ok || !payload?.meeting) {
    throw new Error(
      getChronosApiErrorMessage(
        payload,
        "Nao foi possivel transcrever a reuniao.",
      ),
    );
  }

  return normalizeChronosMeeting(payload.meeting);
}

export async function transcribeChronosExistingRecording(input: {
  meetingId: string;
  minutesProfile?: ChronosMinutesProfile;
  recordingId: string;
  speakerLabel?: string;
}) {
  const token = await getChronosAccessToken();
  const response = await fetch("/api/chronos/meetings/agent", {
    body: JSON.stringify({
      action: "transcribe_existing_recording",
      meetingId: input.meetingId,
      minutesProfile: input.minutesProfile ?? "alinhamento",
      recordingId: input.recordingId,
      speakerLabel: input.speakerLabel ?? "Athena",
    }),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | ChronosApiResponse
    | null;

  if (!response.ok || !payload?.meeting) {
    throw new Error(
      getChronosApiErrorMessage(
        payload,
        "Nao foi possivel transcrever a gravacao salva.",
      ),
    );
  }

  return normalizeChronosMeeting(payload.meeting);
}

export async function draftChronosMinutes(input: {
  meetingId: string;
  minutesProfile: ChronosMinutesProfile;
}) {
  const token = await getChronosAccessToken();
  const response = await fetch("/api/chronos/meetings/agent", {
    body: JSON.stringify({
      action: "draft_minutes",
      meetingId: input.meetingId,
      minutesProfile: input.minutesProfile,
    }),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | ChronosApiResponse
    | null;

  if (!response.ok || !payload?.meeting) {
    throw new Error(
      getChronosApiErrorMessage(
        payload,
        "Nao foi possivel gerar a ata Chronos.",
      ),
    );
  }

  return normalizeChronosMeeting(payload.meeting);
}

function normalizeChronosSnapshot(payload: ChronosApiResponse): ChronosSnapshot {
  const profiles = readRecordArray<ChronosMeetingProfile>(payload.profiles).map(
    normalizeChronosMeetingProfile,
  );

  return {
    meetings: readRecordArray<ChronosMeeting>(payload.meetings).map(
      (meeting, index) => normalizeChronosMeeting(meeting, index),
    ),
    profiles: profiles.length > 0 ? profiles : [...defaultChronosMeetingProfiles],
    rooms: readRecordArray<ChronosRoom>(payload.rooms).map(normalizeChronosRoom),
    storage: payload.storage ?? { status: "offline" },
  };
}

function normalizeChronosMeeting(
  meeting: ChronosMeeting,
  index = 0,
): ChronosMeeting {
  const raw = meeting as ChronosMeeting & Record<string, unknown>;
  const createdAt = readString(raw.createdAt, new Date(0).toISOString());
  const updatedAt = readString(raw.updatedAt, createdAt);

  return {
    ...meeting,
    chatMessages: readRecordArray<
      NonNullable<ChronosMeeting["chatMessages"]>[number]
    >(raw.chatMessages).map(normalizeChronosChatMessage),
    createdAt,
    endsAt: readDateStringOrNull(raw.endsAt),
    executiveSummary: readStringOrNull(raw.executiveSummary),
    externalReference: readStringOrNull(raw.externalReference),
    followUps: readRecordArray<ChronosMeeting["followUps"][number]>(
      raw.followUps,
    ).map(normalizeChronosFollowUp),
    hostName: readStringOrNull(raw.hostName),
    hostUserId: readStringOrNull(raw.hostUserId),
    id: readString(raw.id, `chronos-meeting-${index}`),
    meetingType: isChronosMeetingType(raw.meetingType)
      ? raw.meetingType
      : "alignment",
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
    minutes: readRecordArray<ChronosMeeting["minutes"][number]>(
      raw.minutes,
    ).map(normalizeChronosMinutes),
    minutesStatus: isChronosMinutesStatus(raw.minutesStatus)
      ? raw.minutesStatus
      : "not_started",
    objective: readStringOrNull(raw.objective),
    participants: readRecordArray<ChronosMeeting["participants"][number]>(
      raw.participants,
    ).map(normalizeChronosParticipant),
    protocol: readString(raw.protocol, "CHRONOS"),
    recordingStatus: isChronosCaptureStatus(raw.recordingStatus)
      ? raw.recordingStatus
      : "not_started",
    recordings: readRecordArray<ChronosMeeting["recordings"][number]>(
      raw.recordings,
    ).map(normalizeChronosRecording),
    room: isRecord(raw.room) ? normalizeChronosRoom(raw.room as ChronosRoom) : null,
    roomId: readStringOrNull(raw.roomId),
    startsAt: readDateStringOrNull(raw.startsAt),
    status: isChronosMeetingStatus(raw.status) ? raw.status : "scheduled",
    timeline: readRecordArray<ChronosMeeting["timeline"][number]>(
      raw.timeline,
    ).map(normalizeChronosTimelineEvent),
    title: readString(raw.title, "Reuniao Chronos"),
    transcriptionStatus: isChronosCaptureStatus(raw.transcriptionStatus)
      ? raw.transcriptionStatus
      : "not_started",
    transcript: readRecordArray<ChronosMeeting["transcript"][number]>(
      raw.transcript,
    ).map(normalizeChronosTranscriptSegment),
    updatedAt,
  };
}

function normalizeChronosMeetingProfile(
  profile: ChronosMeetingProfile & Record<string, unknown>,
  index: number,
): ChronosMeetingProfile {
  return {
    ...profile,
    createdAt: readDateStringOrNull(profile.createdAt) ?? undefined,
    description: readString(profile.description),
    id: readString(profile.id, `profile-${index}`),
    isDefault: profile.isDefault === true,
    label: readString(profile.label, "Perfil Chronos"),
    meetingType: isChronosMeetingType(profile.meetingType)
      ? profile.meetingType
      : "alignment",
    status: profile.status === "archived" ? "archived" : "active",
    updatedAt: readDateStringOrNull(profile.updatedAt) ?? undefined,
  };
}

function normalizeChronosRoom(
  room: ChronosRoom & Record<string, unknown>,
  index = 0,
): ChronosRoom {
  return {
    ...room,
    capacity: readFiniteNumber(room.capacity, 0),
    id: readString(room.id, `room-${index}`),
    metadata: isRecord(room.metadata) ? room.metadata : {},
    minutesRequired: room.minutesRequired !== false,
    name: readString(room.name, "Sala Chronos"),
    recordingRequired: room.recordingRequired !== false,
    roomType: readString(room.roomType, "alignment"),
    slug: readString(room.slug),
    status:
      room.status === "archived" || room.status === "disabled"
        ? room.status
        : "active",
    transcriptionRequired: room.transcriptionRequired !== false,
  };
}

function normalizeChronosMinutes(
  minutes: ChronosMeeting["minutes"][number] & Record<string, unknown>,
  index: number,
): ChronosMeeting["minutes"][number] {
  return {
    ...minutes,
    content: readString(minutes.content),
    createdAt: readDateString(minutes.createdAt, new Date(0).toISOString()),
    id: readString(minutes.id, `minutes-${index}`),
    status: isChronosMinutesStatus(minutes.status) ? minutes.status : "draft",
    version: readFiniteNumber(minutes.version, index + 1),
  };
}

function normalizeChronosParticipant(
  participant: ChronosMeeting["participants"][number] & Record<string, unknown>,
  index: number,
): ChronosMeeting["participants"][number] {
  return {
    ...participant,
    attendanceStatus: readString(participant.attendanceStatus, "pending"),
    displayName: readString(participant.displayName, "Participante"),
    email: readStringOrNull(participant.email),
    id: readString(participant.id, `participant-${index}`),
    joinedAt: readDateStringOrNull(participant.joinedAt),
    leftAt: readDateStringOrNull(participant.leftAt),
    organization: readStringOrNull(participant.organization),
    role: isChronosParticipantRole(participant.role)
      ? participant.role
      : "participant",
    userId: readStringOrNull(participant.userId),
  };
}

function normalizeChronosRecording(
  recording: ChronosMeeting["recordings"][number] & Record<string, unknown>,
  index: number,
): ChronosMeeting["recordings"][number] {
  return {
    ...recording,
    downloadUrl: readStringOrNull(recording.downloadUrl),
    durationSeconds: readFiniteNumberOrNull(recording.durationSeconds),
    fileName: readStringOrNull(recording.fileName),
    id: readString(recording.id, `recording-${index}`),
    mimeType: readStringOrNull(recording.mimeType),
    playbackUrl: readStringOrNull(recording.playbackUrl),
    sizeBytes: readFiniteNumberOrNull(recording.sizeBytes),
    startedAt: readDateStringOrNull(recording.startedAt),
    status: isChronosCaptureStatus(recording.status)
      ? recording.status
      : "not_started",
    stoppedAt: readDateStringOrNull(recording.stoppedAt),
    storageBucket: readStringOrNull(recording.storageBucket),
    storagePath: readStringOrNull(recording.storagePath),
  };
}

function normalizeChronosTimelineEvent(
  event: ChronosMeeting["timeline"][number] & Record<string, unknown>,
  index: number,
): ChronosMeeting["timeline"][number] {
  return {
    ...event,
    description: readStringOrNull(event.description),
    eventAt: readDateString(event.eventAt, new Date(0).toISOString()),
    eventType: isChronosEventType(event.eventType) ? event.eventType : "note",
    id: readString(event.id, `timeline-${index}`),
    title: readString(event.title, "Evento Chronos"),
  };
}

function normalizeChronosTranscriptSegment(
  segment: ChronosMeeting["transcript"][number] & Record<string, unknown>,
  index: number,
): ChronosMeeting["transcript"][number] {
  return {
    ...segment,
    content: readString(segment.content),
    createdAt: readDateString(segment.createdAt, new Date(0).toISOString()),
    endedAt: readDateStringOrNull(segment.endedAt),
    id: readString(segment.id, `transcript-${index}`),
    source: readString(segment.source, "chronos"),
    speakerLabel: readStringOrNull(segment.speakerLabel),
    startedAt: readDateStringOrNull(segment.startedAt),
  };
}

function normalizeChronosChatMessage(
  message: NonNullable<ChronosMeeting["chatMessages"]>[number] &
    Record<string, unknown>,
  index: number,
): NonNullable<ChronosMeeting["chatMessages"]>[number] {
  return {
    ...message,
    content: readString(message.content),
    createdAt: readDateString(message.createdAt, new Date(0).toISOString()),
    id: readString(message.id, `chat-${index}`),
    participantId: readStringOrNull(message.participantId),
    senderName: readString(message.senderName, "Participante"),
  };
}

function normalizeChronosFollowUp(
  followUp: ChronosMeeting["followUps"][number] & Record<string, unknown>,
  index: number,
): ChronosMeeting["followUps"][number] {
  return {
    ...followUp,
    completedAt: readDateStringOrNull(followUp.completedAt),
    dueAt: readDateStringOrNull(followUp.dueAt),
    id: readString(followUp.id, `follow-up-${index}`),
    ownerName: readStringOrNull(followUp.ownerName),
    ownerUserId: readStringOrNull(followUp.ownerUserId),
    status: isChronosFollowUpStatus(followUp.status)
      ? followUp.status
      : "open",
    title: readString(followUp.title, "Follow-up Chronos"),
  };
}

function readRecordArray<T>(
  value: unknown,
): Array<T & Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(isRecord).map((item) => item as T & Record<string, unknown>)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readStringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readDateString(value: unknown, fallback: string) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : fallback;
}

export function getChronosUnknownErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return normalizeChronosClientErrorMessage(error.message, fallback);
  }

  return readChronosClientErrorMessage(error) ?? fallback;
}

function getChronosApiErrorMessage(
  payload: ChronosApiResponse | null,
  fallback: string,
) {
  return readChronosClientErrorMessage(payload?.error) ?? fallback;
}

function readChronosClientErrorMessage(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = normalizeChronosClientErrorMessage(value, "");

    return normalized || null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    code?: unknown;
    detail?: unknown;
    description?: unknown;
    error?: unknown;
    message?: unknown;
  };

  return (
    readChronosClientErrorMessage(candidate.message) ??
    readChronosClientErrorMessage(candidate.error) ??
    readChronosClientErrorMessage(candidate.detail) ??
    readChronosClientErrorMessage(candidate.description) ??
    (typeof candidate.code === "string" && candidate.code.trim()
      ? `Erro Chronos retornou codigo ${candidate.code.trim()}.`
      : null)
  );
}

function normalizeChronosClientErrorMessage(value: string, fallback: string) {
  const message = value.trim();

  if (!message || message === "[object Object]") {
    return fallback;
  }

  return message;
}

function readDateStringOrNull(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

function readFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readFiniteNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isChronosMeetingType(value: unknown): value is ChronosMeetingType {
  return isOneOf(chronosMeetingTypes, value);
}

function isChronosMeetingStatus(value: unknown): value is ChronosMeetingStatus {
  return isOneOf(chronosMeetingStatuses, value);
}

function isChronosCaptureStatus(value: unknown): value is ChronosCaptureStatus {
  return isOneOf(chronosCaptureStatuses, value);
}

function isChronosMinutesStatus(value: unknown): value is ChronosMinutesStatus {
  return isOneOf(chronosMinutesStatuses, value);
}

function isChronosParticipantRole(
  value: unknown,
): value is ChronosParticipantRole {
  return isOneOf(chronosParticipantRoles, value);
}

function isChronosFollowUpStatus(
  value: unknown,
): value is ChronosFollowUpStatus {
  return isOneOf(chronosFollowUpStatuses, value);
}

function isChronosEventType(value: unknown): value is ChronosEventType {
  return isOneOf(chronosEventTypes, value);
}

function isOneOf<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}
