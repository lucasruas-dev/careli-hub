"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";

export const HUB_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const HUB_PRESENCE_HEARTBEAT_MS = 30 * 1000;

export type HubPresenceStatus =
  | "agenda"
  | "away"
  | "busy"
  | "lunch"
  | "offline"
  | "online";

export type HubPresenceChangeReason =
  | "activity"
  | "agenda"
  | "heartbeat"
  | "idle"
  | "login"
  | "logout"
  | "manual";

export type HubPresenceRecord = {
  lastSeenAt: string;
  status: HubPresenceStatus;
  userId: string;
};

export type HubPresenceLogEntry = {
  createdAt: string;
  endedAt?: string;
  id: string;
  nextStatus: HubPresenceStatus;
  previousStatus?: HubPresenceStatus;
  reason: string;
  source: string;
  startedAt: string;
};

export type HubPresenceSummary = {
  currentStatus: HubPresenceStatus;
  events: HubPresenceLogEntry[];
  totals: Record<HubPresenceStatus, number>;
  workedSeconds: number;
};

export type HubPresenceSnapshot = {
  data: HubPresenceRecord[];
  summary?: HubPresenceSummary;
};

export const hubPresenceStatusLabels = {
  agenda: "agenda",
  away: "ausente",
  busy: "em agenda",
  lunch: "almoco",
  offline: "offline",
  online: "online",
} as const satisfies Record<HubPresenceStatus, string>;

export const hubPresenceStatusOptions = [
  "online",
  "away",
  "lunch",
  "agenda",
  "offline",
] as const satisfies readonly HubPresenceStatus[];

export function getHubPresenceLabel(status: HubPresenceStatus) {
  return hubPresenceStatusLabels[normalizeHubPresenceStatus(status)];
}

export function normalizeHubPresenceStatus(
  status: HubPresenceStatus,
): HubPresenceStatus {
  return status === "busy" ? "agenda" : status;
}

export async function listHubPresence(): Promise<
  Record<HubPresenceRecord["userId"], HubPresenceStatus>
> {
  const snapshot = await getHubPresenceSnapshot();

  return Object.fromEntries(
    snapshot.data.map((presence) => [
      presence.userId,
      normalizeHubPresenceStatus(presence.status),
    ]),
  );
}

export async function getHubPresenceSnapshot(input?: {
  includeSummary?: boolean;
  rangeEnd?: Date;
  rangeStart?: Date;
}): Promise<HubPresenceSnapshot> {
  const accessToken = await getHubPresenceAccessToken();

  if (!accessToken) {
    return { data: [] };
  }

  const searchParams = new URLSearchParams();

  if (input?.includeSummary) {
    const { rangeEnd, rangeStart } = createPresenceRange(input);

    searchParams.set("includeSummary", "true");
    searchParams.set("start", rangeStart.toISOString());
    searchParams.set("end", rangeEnd.toISOString());
  }

  const response = await fetch(
    `/api/hub/presence${searchParams.size ? `?${searchParams}` : ""}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | HubPresenceSnapshot
    | { error?: string }
    | null;

  if (!response.ok || !payload || !("data" in payload)) {
    const errorMessage =
      payload && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Nao foi possivel carregar presenca.";

    throw new Error(errorMessage);
  }

  return payload;
}

export async function getHubPresenceTodaySummary() {
  const { rangeEnd, rangeStart } = createTodayPresenceRange();

  return getHubPresenceSnapshot({
    includeSummary: true,
    rangeEnd,
    rangeStart,
  });
}

export async function markHubPresence(input: {
  metadata?: Record<string, unknown>;
  reason?: HubPresenceChangeReason;
  source?: string;
  status: HubPresenceStatus;
}): Promise<HubPresenceRecord | null> {
  const accessToken = await getHubPresenceAccessToken();

  if (!accessToken) {
    return null;
  }

  const response = await fetch("/api/hub/presence", {
    body: JSON.stringify({
      metadata: input.metadata,
      reason: input.reason ?? "heartbeat",
      source: input.source ?? "hub",
      status: normalizeHubPresenceStatus(input.status),
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: HubPresenceRecord; error?: string }
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel atualizar presenca.");
  }

  return {
    ...payload.data,
    status: normalizeHubPresenceStatus(payload.data.status),
  };
}

async function getHubPresenceAccessToken() {
  const client = getHubSupabaseClient();

  if (!client) {
    return null;
  }

  const sessionResult = await client.auth.getSession();

  if (sessionResult.error) {
    return null;
  }

  return sessionResult.data.session?.access_token ?? null;
}

function createPresenceRange(input: {
  rangeEnd?: Date;
  rangeStart?: Date;
}) {
  if (input.rangeStart && input.rangeEnd) {
    return {
      rangeEnd: input.rangeEnd,
      rangeStart: input.rangeStart,
    };
  }

  return createTodayPresenceRange();
}

function createTodayPresenceRange() {
  const rangeStart = new Date();

  rangeStart.setHours(0, 0, 0, 0);

  const rangeEnd = new Date(rangeStart);

  rangeEnd.setDate(rangeEnd.getDate() + 1);

  return {
    rangeEnd,
    rangeStart,
  };
}
