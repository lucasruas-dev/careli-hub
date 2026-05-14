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
  id: string;
  status: string;
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

const HUB_IDLE_STALE_MS = 10 * 60 * 1000;
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

  const previousStatus = existingPresence
    ? normalizeFreshPresence(existingPresence)
    : "offline";
  const nextStatus = payload.data.status;
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

  if (previousStatus !== nextStatus) {
    const eventResult = await recordPresenceTransition({
      context,
      metadata: payload.data.metadata,
      nextStatus,
      now,
      previousStatus,
      reason: payload.data.reason,
      source: payload.data.source,
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
  context,
  metadata,
  nextStatus,
  now,
  previousStatus,
  reason,
  source,
}: {
  context: Extract<AuthorizedContext, { ok: true }>;
  metadata: Record<string, unknown>;
  nextStatus: Exclude<HubPresenceStatus, "busy">;
  now: string;
  previousStatus: HubPresenceStatus;
  reason: string;
  source: string;
}) {
  const { error: closeError } = await context.adminClient
    .from("hub_presence_events")
    .update({ ended_at: now })
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

  const { error: eventError } = await context.adminClient
    .from("hub_presence_events")
    .insert({
      metadata,
      module_id: null,
      next_status: nextStatus,
      previous_status: normalizeLegacyPresence(previousStatus),
      reason,
      source,
      started_at: now,
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
      description: getPresenceActivityDescription(previousStatus, nextStatus),
      metadata: {
        ...metadata,
        nextStatus,
        previousStatus: normalizeLegacyPresence(previousStatus),
        reason,
        source,
      },
      module_id: null,
      severity: getPresenceSeverity(nextStatus),
      title: getPresenceActivityTitle(previousStatus, nextStatus, reason),
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

  return { ok: true as const };
}

async function createAuthorizedContext(
  request: NextRequest,
): Promise<AuthorizedContext> {
  const serverEnv = process.env as Record<string, string | undefined>;
  const supabaseUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

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
    .select("id,status")
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

function normalizeFreshPresence(row: HubPresenceRow): HubPresenceStatus {
  const status = normalizeLegacyPresence(row.status);

  if (status === "offline" || status === "agenda" || status === "lunch") {
    return status;
  }

  const lastSeenTime = Date.parse(row.last_seen_at);

  if (
    Number.isNaN(lastSeenTime) ||
    Date.now() - lastSeenTime > HUB_IDLE_STALE_MS
  ) {
    return "away";
  }

  return status;
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
