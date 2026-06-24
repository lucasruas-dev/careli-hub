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
  authorizationUrl?: string;
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

async function fetchChronosApi<TPayload>({
  accessToken,
  body,
  method = "GET",
  url,
}: {
  accessToken?: string | null;
  body?: FormData | unknown;
  method?: "DELETE" | "GET" | "PATCH" | "POST";
  url: string;
}) {
  const token = await getChronosAccessToken(accessToken);
  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
  };
  const init: RequestInit = {
    cache: "no-store",
    headers,
    method,
  };

  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as TPayload | null;

  return {
    payload,
    response,
  };
}

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
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    accessToken,
    url: "/api/chronos/meetings",
  });

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

export async function loadChronosRooms(accessToken?: string | null) {
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    accessToken,
    url: "/api/chronos/rooms",
  });

  if (!response.ok || !Array.isArray(payload?.rooms)) {
    throw new Error(payload?.error ?? "Nao foi possivel carregar as salas Chronos.");
  }

  return payload.rooms;
}

export async function loadChronosProfiles(accessToken?: string | null) {
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    accessToken,
    url: "/api/chronos/profiles",
  });

  if (!response.ok || !Array.isArray(payload?.profiles)) {
    throw new Error(payload?.error ?? "Nao foi possivel carregar os perfis Chronos.");
  }

  return payload.profiles;
}

export async function loadChronosGoogleCalendarStatus(
  accessToken?: string | null,
) {
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    accessToken,
    url: "/api/chronos/google-calendar/status",
  });

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

// Inicia a conexao com o Google Agenda: chama a rota /authorize via fetch
// AUTENTICADO (header Bearer) e devolve a URL de consentimento do Google. O
// chamador navega o browser para essa URL. Fazemos assim porque uma navegacao
// direta do browser para /authorize nao carrega o token e cai em "Sessao ausente".
export async function startChronosGoogleCalendarAuthorization(
  returnTo: string,
  accessToken?: string | null,
) {
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    accessToken,
    url: `/api/chronos/google-calendar/authorize?returnTo=${encodeURIComponent(returnTo)}`,
  });

  const authorizationUrl = payload?.authorizationUrl;

  if (!response.ok || typeof authorizationUrl !== "string" || !authorizationUrl) {
    throw new Error(
      payload?.error ?? "Nao foi possivel iniciar a conexao com o Google Agenda.",
    );
  }

  return authorizationUrl;
}

export async function syncChronosGoogleCalendar(
  direction: ChronosGoogleCalendarSyncDirection = "both",
  options: { forceFullSync?: boolean } = {},
) {
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    body: { direction, forceFullSync: options.forceFullSync === true },
    method: "POST",
    url: "/api/chronos/google-calendar/sync",
  });
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
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    body: input,
    method: "POST",
    url: "/api/chronos/meetings",
  });

  if (!response.ok || !payload?.meeting) {
    throw new Error(payload?.error ?? "Nao foi possivel criar a reuniao.");
  }

  return payload.meeting;
}

export async function deleteChronosMeeting(input: ChronosMeetingDeleteInput) {
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    body: input,
    method: "DELETE",
    url: "/api/chronos/meetings",
  });

  if (!response.ok || !payload?.meetingId) {
    throw new Error(payload?.error ?? "Nao foi possivel excluir o evento.");
  }

  return payload.meetingId;
}

export async function searchChronosInternalInvitees(query: string) {
  const params = new URLSearchParams({
    limit: "10",
    q: query,
  });
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    url: `/api/chronos/invitees?${params.toString()}`,
  });

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
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    body: input,
    method,
    url: "/api/chronos/rooms",
  });

  if (!response.ok || !payload?.room) {
    throw new Error(payload?.error ?? "Nao foi possivel salvar a sala.");
  }

  return payload.room;
}

async function mutateChronosProfile(
  method: "DELETE" | "POST",
  input: ChronosMeetingProfileDeleteInput | ChronosMeetingProfileInput,
) {
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    body: input,
    method,
    url: "/api/chronos/profiles",
  });

  if (!response.ok || !payload?.profile) {
    throw new Error(payload?.error ?? "Nao foi possivel salvar o perfil.");
  }

  return payload.profile;
}

export async function updateChronosMeeting(input: ChronosUpdateInput) {
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    body: input,
    method: "PATCH",
    url: "/api/chronos/meetings",
  });

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

  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    body: formData,
    method: "POST",
    url: "/api/chronos/meetings/agent",
  });

  if (!response.ok || !payload?.meeting) {
    throw new Error(payload?.error ?? "Nao foi possivel transcrever a reuniao.");
  }

  return payload.meeting;
}

export async function transcribeChronosExistingRecording(input: {
  meetingId: string;
  minutesProfile?: ChronosMinutesProfile;
  recordingId: string;
  speakerLabel?: string;
}) {
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    body: {
      action: "transcribe_existing_recording",
      meetingId: input.meetingId,
      minutesProfile: input.minutesProfile ?? "alinhamento",
      recordingId: input.recordingId,
      speakerLabel: input.speakerLabel ?? "Audio completo da reuniao",
    },
    method: "POST",
    url: "/api/chronos/meetings/agent",
  });

  if (!response.ok || !payload?.meeting) {
    throw new Error(
      payload?.error ?? "Nao foi possivel transcrever a gravacao salva.",
    );
  }

  return payload.meeting;
}

export async function draftChronosMinutes(input: {
  meetingId: string;
  minutesProfile: ChronosMinutesProfile;
}) {
  const { payload, response } = await fetchChronosApi<ChronosApiResponse>({
    body: {
      action: "draft_minutes",
      meetingId: input.meetingId,
      minutesProfile: input.minutesProfile,
    },
    method: "POST",
    url: "/api/chronos/meetings/agent",
  });

  if (!response.ok || !payload?.meeting) {
    throw new Error(payload?.error ?? "Nao foi possivel gerar a ata Chronos.");
  }

  return payload.meeting;
}
