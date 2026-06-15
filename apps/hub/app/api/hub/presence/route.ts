import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import {
  HUB_AUTO_LOGOUT_TIMEOUT_MS,
  HUB_IDLE_TIMEOUT_MS,
} from "@/lib/hub-presence-policy";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

type HubPresenceStatus =
  | "agenda"
  | "away"
  | "busy"
  | "lunch"
  | "offline"
  | "online";

type HubPresenceRow = {
  id: string;
  last_seen_at: string;
  status: HubPresenceStatus;
  user_id: string;
};

type HubPresenceEventRow = {
  created_at: string;
  ended_at?: string | null;
  id: string;
  next_status: HubPresenceStatus;
  previous_status?: HubPresenceStatus | null;
  reason: string;
  source: string;
  started_at: string;
};

type HubUserAccessRow = {
  email: string;
  id: string;
  status: string;
};

type ChronosMeetingStatus =
  | "cancelled"
  | "closed"
  | "live"
  | "lobby"
  | "review"
  | "scheduled";

type ChronosCurrentMeetingRow = {
  ends_at: string | null;
  host_user_id: string | null;
  id: string;
  protocol: string;
  starts_at: string | null;
  status: ChronosMeetingStatus;
  title: string;
};

type ChronosParticipantRow = {
  email: string | null;
  meeting_id: string;
  user_id: string | null;
};

type HubPresenceActiveMeeting = {
  endsAt: string;
  id: string;
  protocol: string;
  startsAt: string;
  title: string;
};

type PresencePayload = {
  metadata?: unknown;
  reason?: unknown;
  source?: unknown;
  status?: unknown;
};

type PresenceDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      hub_activity_events: {
        Insert: {
          description?: string | null;
          metadata?: Record<string, unknown>;
          module_id?: string | null;
          severity?: "danger" | "info" | "neutral" | "success" | "warning";
          title: string;
          type: "module" | "notification" | "presence" | "sync" | "system";
          user_id?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [];
        Row: never;
        Update: never;
      };
      chronos_meetings: {
        Insert: never;
        Relationships: [];
        Row: ChronosCurrentMeetingRow;
        Update: never;
      };
      chronos_participants: {
        Insert: never;
        Relationships: [];
        Row: ChronosParticipantRow;
        Update: never;
      };
      hub_presence: {
        Insert: {
          last_seen_at?: string;
          module_id?: string | null;
          status: HubPresenceStatus;
          user_id: string;
          workspace_id?: string | null;
        };
        Relationships: [];
        Row: HubPresenceRow & {
          module_id?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          last_seen_at?: string;
          status?: HubPresenceStatus;
        };
      };
      hub_presence_events: {
        Insert: {
          ended_at?: string | null;
          metadata?: Record<string, unknown>;
          module_id?: string | null;
          next_status: HubPresenceStatus;
          previous_status?: HubPresenceStatus | null;
          reason: string;
          source: string;
          started_at?: string;
          user_id: string;
          workspace_id?: string | null;
        };
        Relationships: [];
        Row: HubPresenceEventRow & {
          module_id?: string | null;
          user_id: string;
          workspace_id?: string | null;
        };
        Update: {
          ended_at?: string | null;
        };
      };
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: HubUserAccessRow;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type SupabaseAdminClient = ReturnType<typeof createClient<PresenceDatabase>>;

type AuthorizedContext =
  | {
      adminClient: SupabaseAdminClient;
      ok: true;
      user: HubUserAccessRow;
    }
  | { ok: false; response: NextResponse };

type ParsedPresencePayload =
  | {
      data: {
        metadata: Record<string, unknown>;
        reason: string;
        source: string;
        status: Exclude<HubPresenceStatus, "busy">;
      };
      ok: true;
    }
  | { error: string; ok: false };

const workedStatuses = new Set<HubPresenceStatus>(["agenda", "online"]);

export async function GET(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  const { data, error } = await context.adminClient
    .from("hub_presence")
    .select("id,user_id,status,last_seen_at,module_id,workspace_id")
    .is("module_id", null)
    .is("workspace_id", null)
    .order("last_seen_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel carregar presenca." },
      { status: 500 },
    );
  }

  const presenceByUserId = new Map<string, HubPresenceRow>();

  for (const row of data ?? []) {
    if (!presenceByUserId.has(row.user_id)) {
      presenceByUserId.set(row.user_id, row);
    }
  }

  const responsePayload: {
    currentMeeting?: HubPresenceActiveMeeting | null;
    data: {
      lastSeenAt: string;
      status: HubPresenceStatus;
      userId: string;
    }[];
    summary?: ReturnType<typeof createPresenceSummary>;
  } = {
    data: [...presenceByUserId.values()].map((row) => ({
      lastSeenAt: row.last_seen_at,
      status: normalizeFreshPresence(row),
      userId: row.user_id,
    })),
  };

  if (request.nextUrl.searchParams.get("includeCurrentMeeting") === "true") {
    responsePayload.currentMeeting = await loadCurrentChronosMeeting(context);
  }

  if (request.nextUrl.searchParams.get("includeSummary") === "true") {
    const summary = await loadPresenceSummary({
      context,
      currentStatus:
        responsePayload.data.find((item) => item.userId === context.user.id)
          ?.status ?? "offline",
      rangeEnd: request.nextUrl.searchParams.get("end"),
      rangeStart: request.nextUrl.searchParams.get("start"),
    });

    if (!summary.ok) {
      return NextResponse.json({ error: summary.error }, { status: 500 });
    }

    responsePayload.summary = summary.data;
  }

  return NextResponse.json(responsePayload);
}

export async function PATCH(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  const payload = parsePresencePayload(await request.json().catch(() => null));

  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data: existingPresence, error: existingError } = await context.adminClient
    .from("hub_presence")
    .select("id,user_id,status,last_seen_at,module_id,workspace_id")
    .eq("user_id", context.user.id)
    .is("module_id", null)
    .is("workspace_id", null)
    .maybeSingle<HubPresenceRow & { module_id?: string | null; workspace_id?: string | null }>();

  if (existingError) {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar presenca." },
      { status: 500 },
    );
  }

  const storedPreviousStatus = existingPresence
    ? normalizeFreshPresence(existingPresence)
    : "offline";
  const previousStatusCloseOpenAt = existingPresence
    ? getPresenceTransitionCloseOpenAt(existingPresence, now)
    : undefined;
  const nextStatus = payload.data.status;

  if (
    existingPresence &&
    shouldPreserveManualPresence({
      nextStatus,
      reason: payload.data.reason,
      storedPreviousStatus,
    })
  ) {
    const { error: preserveError } = await context.adminClient
      .from("hub_presence")
      .update({
        last_seen_at: now,
        status: storedPreviousStatus,
      })
      .eq("id", existingPresence.id);

    if (preserveError) {
      return NextResponse.json(
        { error: "Nao foi possivel atualizar presenca." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      data: {
        lastSeenAt: now,
        status: storedPreviousStatus,
        userId: context.user.id,
      },
    });
  }

  const query = existingPresence
    ? context.adminClient
        .from("hub_presence")
        .update({
          last_seen_at: now,
          status: nextStatus,
        })
        .eq("id", existingPresence.id)
    : context.adminClient.from("hub_presence").insert({
        last_seen_at: now,
        module_id: null,
        status: nextStatus,
        user_id: context.user.id,
        workspace_id: null,
      });
  const { error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar presenca." },
      { status: 500 },
    );
  }

  if (
    shouldRecordPresenceTransition({
      metadata: payload.data.metadata,
      nextStatus,
      reason: payload.data.reason,
      storedPreviousStatus,
    })
  ) {
    const eventResult = await recordPresenceTransition({
      closeOpenAt: previousStatusCloseOpenAt,
      context,
      metadata: payload.data.metadata,
      nextStatus,
      now,
      previousStatus: storedPreviousStatus,
      reason: payload.data.reason,
      source: payload.data.source,
      storedPreviousStatus,
    });

    if (!eventResult.ok) {
      return NextResponse.json({ error: eventResult.error }, { status: 500 });
    }
  }

  return NextResponse.json({
    data: {
      lastSeenAt: now,
      status: nextStatus,
      userId: context.user.id,
    },
  });
}

async function loadPresenceSummary({
  context,
  currentStatus,
  rangeEnd,
  rangeStart,
}: {
  context: Extract<AuthorizedContext, { ok: true }>;
  currentStatus: HubPresenceStatus;
  rangeEnd: string | null;
  rangeStart: string | null;
}) {
  const range = parsePresenceRange(rangeStart, rangeEnd);

  if (!range.ok) {
    return range;
  }

  const { data, error } = await context.adminClient
    .from("hub_presence_events")
    .select("id,previous_status,next_status,reason,source,started_at,ended_at,created_at")
    .eq("user_id", context.user.id)
    .is("module_id", null)
    .is("workspace_id", null)
    .gte("started_at", range.data.start)
    .lt("started_at", range.data.end)
    .order("started_at", { ascending: false })
    .limit(40);

  if (error) {
    return {
      data: createPresenceSummary({
        currentStatus,
        events: [],
        rangeEnd: range.data.end,
        rangeStart: range.data.start,
      }),
      ok: true as const,
    };
  }

  return {
    data: createPresenceSummary({
      currentStatus,
      events: data ?? [],
      rangeEnd: range.data.end,
      rangeStart: range.data.start,
    }),
    ok: true as const,
  };
}

function createPresenceSummary({
  currentStatus,
  events,
  rangeEnd,
  rangeStart,
}: {
  currentStatus: HubPresenceStatus;
  events: HubPresenceEventRow[];
  rangeEnd: string;
  rangeStart: string;
}) {
  const nowTime = Date.now();
  const rangeStartTime = Date.parse(rangeStart);
  const rangeEndTime = Date.parse(rangeEnd);
  const totals = createEmptyPresenceTotals();

  for (const event of events) {
    const startedAt = Math.max(Date.parse(event.started_at), rangeStartTime);
    const endedAt = Math.min(
      event.ended_at ? Date.parse(event.ended_at) : nowTime,
      rangeEndTime,
    );

    if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt <= startedAt) {
      continue;
    }

    const status = normalizeLegacyPresence(event.next_status);
    totals[status] += Math.round((endedAt - startedAt) / 1000);
  }

  return {
    currentStatus: normalizeLegacyPresence(currentStatus),
    events: events.map((event) => ({
      createdAt: event.created_at,
      endedAt: event.ended_at ?? undefined,
      id: event.id,
      nextStatus: normalizeLegacyPresence(event.next_status),
      previousStatus: event.previous_status
        ? normalizeLegacyPresence(event.previous_status)
        : undefined,
      reason: event.reason,
      source: event.source,
      startedAt: event.started_at,
    })),
    totals,
    workedSeconds: [...workedStatuses].reduce(
      (total, status) => total + totals[normalizeLegacyPresence(status)],
      0,
    ),
  };
}

async function recordPresenceTransition({
  closeOpenAt,
  context,
  metadata,
  nextStatus,
  now,
  previousStatus,
  reason,
  source,
  storedPreviousStatus,
}: {
  closeOpenAt?: string;
  context: Extract<AuthorizedContext, { ok: true }>;
  metadata: Record<string, unknown>;
  nextStatus: Exclude<HubPresenceStatus, "busy">;
  now: string;
  previousStatus: HubPresenceStatus;
  reason: string;
  source: string;
  storedPreviousStatus: Exclude<HubPresenceStatus, "busy">;
}) {
  const transitionPlan = createPresenceTransitionPlan({
    closeOpenAt,
    metadata,
    nextStatus,
    now,
    previousStatus,
    reason,
    source,
    storedPreviousStatus,
  });
  const { error: closeError } = await context.adminClient
    .from("hub_presence_events")
    .update({ ended_at: transitionPlan.closeOpenAt })
    .eq("user_id", context.user.id)
    .is("module_id", null)
    .is("workspace_id", null)
    .is("ended_at", null);

  if (closeError) {
    return {
      error: "Nao foi possivel fechar o status anterior.",
      ok: false as const,
    };
  }

  for (const transitionEvent of transitionPlan.events) {
    const { error: eventError } = await context.adminClient
      .from("hub_presence_events")
      .insert({
        ended_at: transitionEvent.endedAt,
        metadata: transitionEvent.metadata,
        module_id: null,
        next_status: transitionEvent.nextStatus,
        previous_status: transitionEvent.previousStatus,
        reason: transitionEvent.reason,
        source: transitionEvent.source,
        started_at: transitionEvent.startedAt,
        user_id: context.user.id,
        workspace_id: null,
      });

    if (eventError) {
      return {
        error: "Nao foi possivel registrar log de presenca.",
        ok: false as const,
      };
    }

    const { error: activityError } = await context.adminClient
      .from("hub_activity_events")
      .insert({
        description: getPresenceActivityDescription(
          transitionEvent.previousStatus,
          transitionEvent.nextStatus,
        ),
        metadata: {
          ...transitionEvent.metadata,
          nextStatus: transitionEvent.nextStatus,
          previousStatus: transitionEvent.previousStatus,
          reason: transitionEvent.reason,
          source: transitionEvent.source,
        },
        module_id: null,
        severity: getPresenceSeverity(transitionEvent.nextStatus),
        title: getPresenceActivityTitle(
          transitionEvent.previousStatus,
          transitionEvent.nextStatus,
          transitionEvent.reason,
        ),
        type: "presence",
        user_id: context.user.id,
        workspace_id: null,
      });

    if (activityError) {
      return {
        error: "Nao foi possivel registrar atividade de presenca.",
        ok: false as const,
      };
    }
  }

  return { ok: true as const };
}

function createPresenceTransitionPlan({
  closeOpenAt,
  metadata,
  nextStatus,
  now,
  previousStatus,
  reason,
  source,
  storedPreviousStatus,
}: {
  closeOpenAt?: string;
  metadata: Record<string, unknown>;
  nextStatus: Exclude<HubPresenceStatus, "busy">;
  now: string;
  previousStatus: HubPresenceStatus;
  reason: string;
  source: string;
  storedPreviousStatus: Exclude<HubPresenceStatus, "busy">;
}) {
  const normalizedPreviousStatus = normalizeLegacyPresence(previousStatus);
  const staleLogoutEvent = createStaleLogoutEvent({
    closeOpenAt,
    metadata,
    normalizedPreviousStatus,
    now,
    source,
  });
  const bridgeAway = shouldBridgeAwayBeforeTransition({
    metadata,
    nextStatus,
    storedPreviousStatus,
  });

  if (bridgeAway) {
    const awayStartedAt = getIdleAwayStartedAt(now, metadata);
    const awayMetadata = {
      ...metadata,
      bridge: "idle_before_transition",
      rule: "idle_without_panteon_activity",
      synthetic: true,
    };

    return {
      closeOpenAt: closeOpenAt ?? awayStartedAt,
      events: [
        ...(staleLogoutEvent ? [staleLogoutEvent] : []),
        {
          endedAt: now,
          metadata: awayMetadata,
          nextStatus: "away" as const,
          previousStatus: storedPreviousStatus,
          reason: "idle",
          source,
          startedAt: awayStartedAt,
        },
        {
          endedAt: undefined,
          metadata,
          nextStatus,
          previousStatus: "away" as const,
          reason,
          source,
          startedAt: now,
        },
      ],
    };
  }

  const startedAt =
    nextStatus === "away" && reason === "idle"
      ? getIdleAwayStartedAt(now, metadata)
      : now;

  return {
    closeOpenAt: closeOpenAt ?? startedAt,
    events: [
      ...(staleLogoutEvent ? [staleLogoutEvent] : []),
      {
        endedAt: undefined,
        metadata,
        nextStatus,
        previousStatus: normalizedPreviousStatus,
        reason,
        source,
        startedAt,
      },
    ],
  };
}

function createStaleLogoutEvent({
  closeOpenAt,
  metadata,
  normalizedPreviousStatus,
  now,
  source,
}: {
  closeOpenAt?: string;
  metadata: Record<string, unknown>;
  normalizedPreviousStatus: Exclude<HubPresenceStatus, "busy">;
  now: string;
  source: string;
}) {
  if (!closeOpenAt || !isStaleCloseOpenAt(closeOpenAt, now)) {
    return null;
  }

  return {
    endedAt: now,
    metadata: {
      ...metadata,
      synthetic: true,
      trigger: "stale_presence_reconciliation",
    },
    nextStatus: "offline" as const,
    previousStatus: normalizedPreviousStatus,
    reason: "logout",
    source,
    startedAt: closeOpenAt,
  };
}

function isStaleCloseOpenAt(closeOpenAt: string, now: string) {
  const closeTime = Date.parse(closeOpenAt);
  const nowTime = Date.parse(now);

  if (Number.isNaN(closeTime) || Number.isNaN(nowTime)) {
    return false;
  }

  return nowTime - closeTime > 1_000;
}

function shouldBridgeAwayBeforeTransition({
  metadata,
  nextStatus,
  storedPreviousStatus,
}: {
  metadata: Record<string, unknown>;
  nextStatus: Exclude<HubPresenceStatus, "busy">;
  storedPreviousStatus: Exclude<HubPresenceStatus, "busy">;
}) {
  if (storedPreviousStatus === "away" || storedPreviousStatus === "lunch") {
    return false;
  }

  if (storedPreviousStatus !== "online") {
    return false;
  }

  if (nextStatus !== "offline" && nextStatus !== "online") {
    return false;
  }

  return getIdleMs(metadata) >= HUB_IDLE_TIMEOUT_MS;
}

function shouldRecordPresenceTransition({
  metadata,
  nextStatus,
  reason,
  storedPreviousStatus,
}: {
  metadata: Record<string, unknown>;
  nextStatus: Exclude<HubPresenceStatus, "busy">;
  reason: string;
  storedPreviousStatus: Exclude<HubPresenceStatus, "busy">;
}) {
  if (reason === "login" && nextStatus === "online") {
    return true;
  }

  if (
    shouldBridgeAwayBeforeTransition({
      metadata,
      nextStatus,
      storedPreviousStatus,
    })
  ) {
    return true;
  }

  return storedPreviousStatus !== nextStatus;
}

function shouldPreserveManualPresence({
  nextStatus,
  reason,
  storedPreviousStatus,
}: {
  nextStatus: Exclude<HubPresenceStatus, "busy">;
  reason: string;
  storedPreviousStatus: Exclude<HubPresenceStatus, "busy">;
}) {
  if (
    storedPreviousStatus === "lunch" &&
    nextStatus === "online" &&
    reason !== "manual" &&
    reason !== "login"
  ) {
    return true;
  }

  if (
    storedPreviousStatus === "agenda" &&
    nextStatus !== "agenda" &&
    reason !== "manual" &&
    reason !== "activity" &&
    reason !== "login"
  ) {
    return true;
  }

  if (
    (storedPreviousStatus === "away" || storedPreviousStatus === "offline") &&
    nextStatus === "online" &&
    reason === "heartbeat"
  ) {
    return true;
  }

  return false;
}

function getIdleAwayStartedAt(now: string, metadata: Record<string, unknown>) {
  const nowTime = Date.parse(now);
  const idleMs = getIdleMs(metadata);
  const offsetMs = Math.max(0, idleMs - HUB_IDLE_TIMEOUT_MS);

  if (Number.isNaN(nowTime)) {
    return now;
  }

  return new Date(nowTime - offsetMs).toISOString();
}

function getIdleMs(metadata: Record<string, unknown>) {
  const value = metadata.idleMs;

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function createAuthorizedContext(
  request: NextRequest,
): Promise<AuthorizedContext> {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Configure a chave server-side para atualizar presenca." },
        { status: 503 },
      ),
    };
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao administrativa ausente." },
        { status: 401 },
      ),
    };
  }

  const adminClient = createClient<PresenceDatabase>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: authData, error: authError } = await adminClient.auth.getUser(
    accessToken,
  );

  if (authError || !authData.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sessao administrativa invalida." },
        { status: 401 },
      ),
    };
  }

  const { data: user, error: userError } = await adminClient
    .from("hub_users")
    .select("id,email,status")
    .eq("id", authData.user.id)
    .maybeSingle<HubUserAccessRow>();

  if (userError || !user || user.status !== "active") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuario sem acesso ao Hub." },
        { status: 403 },
      ),
    };
  }

  return {
    adminClient,
    ok: true,
    user,
  };
}

function parsePresencePayload(payload: unknown): ParsedPresencePayload {
  if (!payload || typeof payload !== "object") {
    return { error: "Informe a presenca.", ok: false };
  }

  const input = payload as PresencePayload;
  const status = normalizePresencePayloadStatus(getString(input.status));

  if (!status) {
    return { error: "Informe um status valido.", ok: false };
  }

  return {
    data: {
      metadata: getMetadata(input.metadata),
      reason: getLimitedString(input.reason, "heartbeat", 48),
      source: getLimitedString(input.source, "hub", 64),
      status,
    },
    ok: true,
  };
}

function normalizeFreshPresence(row: HubPresenceRow): Exclude<HubPresenceStatus, "busy"> {
  const status = normalizeLegacyPresence(row.status);

  const lastSeenTime = Date.parse(row.last_seen_at);

  if (status === "offline") {
    return "offline";
  }

  if (Number.isNaN(lastSeenTime)) {
    return "offline";
  }

  const presenceAgeMs = Date.now() - lastSeenTime;

  if (presenceAgeMs >= HUB_AUTO_LOGOUT_TIMEOUT_MS) {
    return "offline";
  }

  if (status === "agenda" || status === "lunch") {
    return status;
  }

  if (presenceAgeMs >= HUB_IDLE_TIMEOUT_MS) {
    return "away";
  }

  return status;
}

function getPresenceTransitionCloseOpenAt(row: HubPresenceRow, fallback: string) {
  const status = normalizeLegacyPresence(row.status);

  if (status === "offline") {
    return fallback;
  }

  const lastSeenTime = Date.parse(row.last_seen_at);
  const fallbackTime = Date.parse(fallback);

  if (Number.isNaN(lastSeenTime) || Number.isNaN(fallbackTime)) {
    return fallback;
  }

  if (fallbackTime - lastSeenTime < HUB_AUTO_LOGOUT_TIMEOUT_MS) {
    return fallback;
  }

  return new Date(lastSeenTime + HUB_AUTO_LOGOUT_TIMEOUT_MS).toISOString();
}

function normalizePresencePayloadStatus(
  value: string,
): Exclude<HubPresenceStatus, "busy"> | null {
  if (value === "busy") {
    return "agenda";
  }

  return ["agenda", "away", "lunch", "offline", "online"].includes(value)
    ? (value as Exclude<HubPresenceStatus, "busy">)
    : null;
}

function normalizeLegacyPresence(status: HubPresenceStatus): Exclude<HubPresenceStatus, "busy"> {
  return status === "busy" ? "agenda" : status;
}

function createEmptyPresenceTotals() {
  return {
    agenda: 0,
    away: 0,
    busy: 0,
    lunch: 0,
    offline: 0,
    online: 0,
  } as Record<HubPresenceStatus, number>;
}

function parsePresenceRange(start: string | null, end: string | null) {
  const startTime = start ? Date.parse(start) : Number.NaN;
  const endTime = end ? Date.parse(end) : Number.NaN;

  if (Number.isNaN(startTime) || Number.isNaN(endTime) || endTime <= startTime) {
    return {
      error: "Intervalo de presenca invalido.",
      ok: false as const,
    };
  }

  return {
    data: {
      end: new Date(endTime).toISOString(),
      start: new Date(startTime).toISOString(),
    },
    ok: true as const,
  };
}

function getPresenceActivityTitle(
  previousStatus: HubPresenceStatus,
  nextStatus: HubPresenceStatus,
  reason: string,
) {
  if (reason === "login" && normalizeLegacyPresence(nextStatus) === "online") {
    return "Login no Hub";
  }

  if (reason === "logout" || normalizeLegacyPresence(nextStatus) === "offline") {
    return "Logout no Hub";
  }

  return `Status alterado para ${getPresenceLabel(nextStatus)}`;
}

function getPresenceActivityDescription(
  previousStatus: HubPresenceStatus,
  nextStatus: HubPresenceStatus,
) {
  return `${getPresenceLabel(previousStatus)} para ${getPresenceLabel(nextStatus)}.`;
}

function getPresenceLabel(status: HubPresenceStatus) {
  const labels = {
    agenda: "agenda",
    away: "ausente",
    busy: "agenda",
    lunch: "almoco",
    offline: "offline",
    online: "online",
  } as const satisfies Record<HubPresenceStatus, string>;

  return labels[status];
}

function getPresenceSeverity(status: HubPresenceStatus) {
  if (status === "online") {
    return "success" as const;
  }

  if (status === "offline") {
    return "neutral" as const;
  }

  return "info" as const;
}

function getMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function getLimitedString(value: unknown, fallback: string, maxLength: number) {
  const text = getString(value);

  return text ? text.slice(0, maxLength) : fallback;
}

async function loadCurrentChronosMeeting(
  context: Extract<AuthorizedContext, { ok: true }>,
): Promise<HubPresenceActiveMeeting | null> {
  const now = new Date().toISOString();
  const { data: meetings, error } = await context.adminClient
    .from("chronos_meetings")
    .select("id,protocol,title,status,starts_at,ends_at,host_user_id")
    .not("starts_at", "is", null)
    .not("ends_at", "is", null)
    .lte("starts_at", now)
    .gte("ends_at", now)
    .in("status", ["scheduled", "lobby", "live", "review"])
    .order("starts_at", { ascending: false })
    .limit(20);

  if (error || !meetings?.length) {
    return null;
  }

  const hostedMeeting = meetings.find(
    (meeting) => meeting.host_user_id === context.user.id,
  );

  if (hostedMeeting) {
    return mapChronosMeetingPresence(hostedMeeting);
  }

  const meetingIds = meetings.map((meeting) => meeting.id);
  const { data: participants, error: participantsError } = await context.adminClient
    .from("chronos_participants")
    .select("meeting_id,user_id,email")
    .in("meeting_id", meetingIds)
    .limit(200);

  if (participantsError || !participants?.length) {
    return null;
  }

  const userEmail = context.user.email.trim().toLowerCase();
  const participantMeetingIds = new Set(
    participants
      .filter((participant) => {
        const participantEmail = participant.email?.trim().toLowerCase();

        return (
          participant.user_id === context.user.id ||
          (Boolean(participantEmail) && participantEmail === userEmail)
        );
      })
      .map((participant) => participant.meeting_id),
  );
  const participantMeeting = meetings.find((meeting) =>
    participantMeetingIds.has(meeting.id),
  );

  return participantMeeting ? mapChronosMeetingPresence(participantMeeting) : null;
}

function mapChronosMeetingPresence(
  meeting: ChronosCurrentMeetingRow,
): HubPresenceActiveMeeting | null {
  if (!meeting.starts_at || !meeting.ends_at) {
    return null;
  }

  return {
    endsAt: meeting.ends_at,
    id: meeting.id,
    protocol: meeting.protocol,
    startsAt: meeting.starts_at,
    title: meeting.title,
  };
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
