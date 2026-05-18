"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  ChronosCreateMeetingInput,
  ChronosMeeting,
  ChronosSnapshot,
  ChronosUpdateInput,
} from "./types";

type ChronosApiResponse = Partial<ChronosSnapshot> & {
  error?: string;
  meeting?: ChronosMeeting;
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

  if (!response.ok || !Array.isArray(payload?.meetings) || !payload.rooms) {
    throw new Error(payload?.error ?? "Nao foi possivel carregar o Chronos.");
  }

  return {
    meetings: payload.meetings,
    rooms: payload.rooms,
    storage: payload.storage ?? { status: "offline" },
  } satisfies ChronosSnapshot;
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
