"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  ChronosCreateMeetingInput,
  ChronosGoogleCalendarSyncDirection,
  ChronosGoogleCalendarSyncResult,
  ChronosGoogleCalendarStatus,
  ChronosHubInvitee,
  ChronosMeeting,
  ChronosMeetingDeleteInput,
  ChronosMeetingProfile,
  ChronosMeetingProfileDeleteInput,
  ChronosMeetingProfileInput,
  ChronosMinutesProfile,
  ChronosRoom,
  ChronosRoomDeleteInput,
  ChronosRoomInput,
  ChronosRoomUpdateInput,
  ChronosSnapshot,
  ChronosUpdateInput,
} from "./types";

type ChronosApiResponse = Partial<ChronosSnapshot> & {
  error?: string;
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

  if (
    !response.ok ||
    !Array.isArray(payload?.meetings) ||
    !payload.rooms ||
    !payload.profiles
  ) {
    throw new Error(payload?.error ?? "Nao foi possivel carregar o Chronos.");
  }

  return {
    meetings: payload.meetings,
    profiles: payload.profiles,
    rooms: payload.rooms,
    storage: payload.storage ?? { status: "offline" },
  } satisfies ChronosSnapshot;
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
      payload?.error ?? "Nao foi possivel carregar o status do Google Agenda.",
    );
  }

  return googleCalendar;
}

export async function syncChronosGoogleCalendar(
  direction: ChronosGoogleCalendarSyncDirection = "both",
) {
  const token = await getChronosAccessToken();
  const response = await fetch("/api/chronos/google-calendar/sync", {
    body: JSON.stringify({ direction }),
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
      payload?.error ?? "Nao foi possivel sincronizar Google Agenda.",
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
    throw new Error(payload?.error ?? "Nao foi possivel criar a reuniao.");
  }

  return payload.meeting;
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
    throw new Error(payload?.error ?? "Nao foi possivel excluir o evento.");
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
    throw new Error(payload?.error ?? "Nao foi possivel buscar o time interno.");
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
    throw new Error(payload?.error ?? "Nao foi possivel salvar a sala.");
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
    throw new Error(payload?.error ?? "Nao foi possivel salvar o perfil.");
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
    throw new Error(payload?.error ?? "Nao foi possivel atualizar a reuniao.");
  }

  return payload.meeting;
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
    throw new Error(payload?.error ?? "Nao foi possivel transcrever a reuniao.");
  }

  return payload.meeting;
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
    throw new Error(payload?.error ?? "Nao foi possivel gerar a ata Chronos.");
  }

  return payload.meeting;
}
