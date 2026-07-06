import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import {
  HUB_AUTO_LOGOUT_TIMEOUT_MS,
  HUB_IDLE_TIMEOUT_MS,
  HUB_PRESENCE_POLICY_LABEL,
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

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

type HubUserRow = {
  avatar_url?: string | null;
  display_name: string;
  email: string;
  id: string;
  operational_profile?: string | null;
  role: HubUserRole;
  status: string;
};

type HubUserAssignmentRow = {
  created_at?: string;
  department_id?: string | null;
  is_primary?: boolean | null;
  sector_id?: string | null;
  status: string;
  user_id: string;
};

type HubPresenceRow = {
  last_seen_at: string;
  module_id?: string | null;
  status: HubPresenceStatus;
  user_id: string;
  workspace_id?: string | null;
};

type HubPresenceEventRow = {
  created_at: string;
  ended_at?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  next_status: HubPresenceStatus;
  previous_status?: HubPresenceStatus | null;
  reason: string;
  source: string;
  started_at: string;
  user_id: string;
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

type HubModuleRow = {
  base_path: string;
  id: string;
  name: string;
  order: number;
  status: string;
};

type HubDepartmentModuleRow = {
  department_id: string;
  module_id: string;
  status: string;
};

type HubActivityEventRow = {
  created_at: string;
  description?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  module_id?: string | null;
  severity: "danger" | "info" | "neutral" | "success" | "warning";
  title: string;
  type: "module" | "notification" | "presence" | "sync" | "system";
  user_id?: string | null;
};

type IdNameRow = {
  id: string;
  name: string;
};

type HomeDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      hub_activity_events: {
        Insert: never;
        Relationships: [];
        Row: HubActivityEventRow;
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
      hub_department_modules: {
        Insert: never;
        Relationships: [];
        Row: HubDepartmentModuleRow;
        Update: never;
      };
      hub_departments: {
        Insert: never;
        Relationships: [];
        Row: IdNameRow;
        Update: never;
      };
      hub_modules: {
        Insert: never;
        Relationships: [];
        Row: HubModuleRow;
        Update: never;
      };
      hub_notifications: {
        Insert: never;
        Relationships: [];
        Row: {
          id: string;
          read_at?: string | null;
          recipient_user_id: string;
        };
        Update: never;
      };
      hub_presence: {
        Insert: never;
        Relationships: [];
        Row: HubPresenceRow;
        Update: never;
      };
      hub_presence_events: {
        Insert: never;
        Relationships: [];
        Row: HubPresenceEventRow;
        Update: never;
      };
      hub_sectors: {
        Insert: never;
        Relationships: [];
        Row: IdNameRow;
        Update: never;
      };
      hub_user_assignments: {
        Insert: never;
        Relationships: [];
        Row: HubUserAssignmentRow;
        Update: never;
      };
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: HubUserRow;
        Update: never;
      };
      pulsex_messages: {
        Insert: never;
        Relationships: [];
        Row: {
          created_at: string;
          deleted_at?: string | null;
          id: string;
        };
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type SupabaseAdminClient = ReturnType<typeof createClient<HomeDatabase>>;

const availabilityHistoryDays = 7;
const availabilityHistoryLimitPerUser = 250;

export async function GET(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  const usersResult = await loadUsers(context.adminClient);

  if (usersResult.error) {
    return NextResponse.json(
      { error: "Nao foi possivel carregar usuarios da Home." },
      { status: 500 },
    );
  }

  const rangeStart = new Date();
  rangeStart.setHours(0, 0, 0, 0);

  const [
    assignmentsResult,
    departmentsResult,
    sectorsResult,
    presenceResult,
    modulesResult,
    departmentModulesResult,
    notificationsResult,
    hermesMessagesResult,
    activityEventsResult,
  ] = await Promise.all([
    context.adminClient
      .from("hub_user_assignments")
      .select("user_id,department_id,sector_id,status,is_primary,created_at")
      .order("created_at", { ascending: false }),
    context.adminClient.from("hub_departments").select("id,name"),
    context.adminClient.from("hub_sectors").select("id,name"),
    context.adminClient
      .from("hub_presence")
      .select("user_id,status,last_seen_at")
      .is("module_id", null)
      .is("workspace_id", null)
      .order("last_seen_at", { ascending: false }),
    context.adminClient
      .from("hub_modules")
      .select("id,name,base_path,status,order")
      .order("order"),
    context.adminClient
      .from("hub_department_modules")
      .select("department_id,module_id,status"),
    context.adminClient
      .from("hub_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", context.user.id)
      .is("read_at", null),
    context.adminClient
      .from("pulsex_messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", rangeStart.toISOString())
      .is("deleted_at", null),
    context.adminClient
      .from("hub_activity_events")
      .select("id,module_id,user_id,type,severity,title,description,metadata,created_at")
      .gte("created_at", rangeStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const assignmentsByUser = groupAssignments(
    assignmentsResult.error ? [] : ((assignmentsResult.data ?? []) as HubUserAssignmentRow[]),
  );
  const departmentNames = mapNames(
    departmentsResult.error ? [] : ((departmentsResult.data ?? []) as IdNameRow[]),
  );
  const sectorNames = mapNames(
    sectorsResult.error ? [] : ((sectorsResult.data ?? []) as IdNameRow[]),
  );
  const presenceByUserId = new Map<string, HubPresenceRow>();
  const users = ((usersResult.data ?? []) as HubUserRow[]);

  if (!presenceResult.error) {
    for (const row of (presenceResult.data ?? []) as HubPresenceRow[]) {
      if (!presenceByUserId.has(row.user_id)) {
        presenceByUserId.set(row.user_id, row);
      }
    }
  }

  const currentMeetingsByUserId = await loadCurrentChronosMeetingsByUserId(
    context.adminClient,
    users,
  );
  const presenceUserIds = new Set([...presenceByUserId.keys()]);
  const availability =
    context.user.role === "admin"
      ? await loadAvailabilitySnapshot({
          adminClient: context.adminClient,
          currentMeetingsByUserId,
          presenceByUserId,
          users,
        })
      : undefined;

  return NextResponse.json({
    data: {
      activityEvents: activityEventsResult.error
        ? []
        : ((activityEventsResult.data ?? []) as HubActivityEventRow[]).map(
            (event) => ({
              createdAt: event.created_at,
              description: event.description ?? undefined,
              id: event.id,
              metadata: event.metadata ?? {},
              moduleId: event.module_id ?? undefined,
              severity: event.severity,
              title: event.title,
              type: event.type,
              userId: event.user_id ?? undefined,
            }),
          ),
      departmentModules: departmentModulesResult.error
        ? []
        : ((departmentModulesResult.data ?? []) as HubDepartmentModuleRow[]).map(
            (access) => ({
              departmentId: access.department_id,
              moduleId: access.module_id,
              status: access.status,
            }),
          ),
      generatedAt: new Date().toISOString(),
      modules: modulesResult.error
        ? []
        : ((modulesResult.data ?? []) as HubModuleRow[]).map((module) => ({
            basePath: module.base_path,
            id: module.id,
            name: module.name,
            order: module.order,
            status: module.status,
          })),
      notifications: {
        unreadCount: notificationsResult.error
          ? 0
          : (notificationsResult.count ?? 0),
      },
      ...(availability ? { availability } : {}),
      presence: [...presenceUserIds].map((userId) => {
        const row = presenceByUserId.get(userId);
        const currentMeeting = currentMeetingsByUserId.get(userId);

        return {
          ...(currentMeeting ? { currentMeeting } : {}),
          lastSeenAt: row?.last_seen_at ?? new Date().toISOString(),
          status: row ? normalizeFreshPresence(row) : "offline",
          userId,
        };
      }),
      pulsex: {
        messagesTodayCount: hermesMessagesResult.error
          ? 0
          : (hermesMessagesResult.count ?? 0),
      },
      users: users.map((user) => {
        const assignment = assignmentsByUser.get(user.id);

        return {
          avatarUrl: user.avatar_url ?? undefined,
          departmentId: assignment?.department_id ?? undefined,
          departmentName: assignment?.department_id
            ? departmentNames.get(assignment.department_id) ?? undefined
            : undefined,
          displayName: user.display_name,
          email: user.email,
          id: user.id,
          operationalProfile: user.operational_profile ?? undefined,
          role: user.role,
          sectorId: assignment?.sector_id ?? undefined,
          sectorName: assignment?.sector_id
            ? sectorNames.get(assignment.sector_id) ?? undefined
            : undefined,
          status: user.status,
        };
      }),
    },
  });
}

async function createAuthorizedContext(request: NextRequest) {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Configure a chave server-side para carregar a Home." },
        { status: 503 },
      ),
    };
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sessao administrativa ausente." },
        { status: 401 },
      ),
    };
  }

  const adminClient = createClient<HomeDatabase>(supabaseUrl, serviceRoleKey, {
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
      ok: false as const,
      response: NextResponse.json(
        { error: "Sessao administrativa invalida." },
        { status: 401 },
      ),
    };
  }

  const { data: user, error: userError } = await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: HubUserRole; status: string }>();

  if (userError || !user || user.status !== "active") {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Usuario sem acesso ao Hub." },
        { status: 403 },
      ),
    };
  }

  return {
    adminClient,
    ok: true as const,
    user,
  };
}

async function loadUsers(adminClient: SupabaseAdminClient) {
  const result = await adminClient
    .from("hub_users")
    .select("id,email,display_name,avatar_url,role,operational_profile,status")
    .order("display_name");

  if (!result.error || !result.error.message.includes("operational_profile")) {
    return result;
  }

  return adminClient
    .from("hub_users")
    .select("id,email,display_name,avatar_url,role,status")
    .order("display_name");
}

function groupAssignments(assignments: HubUserAssignmentRow[]) {
  const assignmentsByUser = new Map<string, HubUserAssignmentRow>();

  for (const assignment of assignments) {
    const current = assignmentsByUser.get(assignment.user_id);

    if (!current) {
      assignmentsByUser.set(assignment.user_id, assignment);
      continue;
    }

    if (assignment.status === "active" && current.status !== "active") {
      assignmentsByUser.set(assignment.user_id, assignment);
      continue;
    }

    if (assignment.is_primary && !current.is_primary) {
      assignmentsByUser.set(assignment.user_id, assignment);
    }
  }

  return assignmentsByUser;
}

function mapNames(rows: IdNameRow[]) {
  return new Map(rows.map((row) => [row.id, row.name]));
}

function normalizeFreshPresence(row: HubPresenceRow): Exclude<HubPresenceStatus, "busy"> {
  const status = row.status === "busy" ? "agenda" : row.status;

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

async function loadAvailabilitySnapshot({
  adminClient,
  currentMeetingsByUserId,
  presenceByUserId,
  users,
}: {
  adminClient: SupabaseAdminClient;
  currentMeetingsByUserId: Map<string, HubPresenceActiveMeeting>;
  presenceByUserId: Map<string, HubPresenceRow>;
  users: HubUserRow[];
}) {
  const rangeStart = new Date();
  rangeStart.setHours(0, 0, 0, 0);

  const rangeEnd = new Date();
  const historyStart = new Date(rangeStart);
  historyStart.setDate(historyStart.getDate() - (availabilityHistoryDays - 1));

  const activeUsers = users.filter((user) => user.status === "active");
  const events = await loadAvailabilityHistoryEvents({
    activeUsers,
    adminClient,
    historyStart: historyStart.toISOString(),
  });
  const eventsByUserId = groupPresenceEventsByUser(events);
  const userNames = new Map(activeUsers.map((user) => [user.id, user.display_name]));
  const team = activeUsers.map((user) => {
    const currentMeeting = currentMeetingsByUserId.get(user.id);
    const presence = presenceByUserId.get(user.id);
    const currentStatus = presence ? normalizeFreshPresence(presence) : "offline";
    const userEvents = eventsByUserId.get(user.id) ?? [];
    const todayEvents = userEvents.filter(
      (event) => Date.parse(event.started_at) >= rangeStart.getTime(),
    );
    const totals = calculatePresenceTotals({
      events: userEvents,
      rangeEnd: rangeEnd.toISOString(),
      rangeStart: rangeStart.toISOString(),
    });
    const productiveSeconds = totals.agenda + totals.online;
    const trackedSeconds =
      totals.agenda + totals.away + totals.lunch + totals.online;
    const lastEvent = todayEvents[0];

    return {
      currentMeeting,
      currentStatus,
      displayName: user.display_name,
      email: user.email,
      lastEvent: lastEvent
        ? {
            nextStatus: normalizeLegacyPresence(lastEvent.next_status),
            reason: lastEvent.reason,
            source: lastEvent.source,
            startedAt: lastEvent.started_at,
          }
        : undefined,
      lastSeenAt: presence?.last_seen_at,
      productiveSeconds,
      productivityRate:
        trackedSeconds > 0 ? Math.round((productiveSeconds / trackedSeconds) * 100) : null,
      totals,
      trackedSeconds,
      transitionCount: todayEvents.length,
      userId: user.id,
    };
  });

  return {
    generatedAt: rangeEnd.toISOString(),
    history: events.map((event) => ({
      createdAt: event.created_at,
      endedAt: event.ended_at ?? undefined,
      id: event.id,
      metadata: event.metadata ?? {},
      nextStatus: normalizeLegacyPresence(event.next_status),
      previousStatus: event.previous_status
        ? normalizeLegacyPresence(event.previous_status)
        : undefined,
      reason: event.reason,
      source: event.source,
      startedAt: event.started_at,
      userId: event.user_id,
      userName: userNames.get(event.user_id) ?? "Usuario removido",
    })),
    policy: {
      awayTimeoutMs: HUB_IDLE_TIMEOUT_MS,
      label: HUB_PRESENCE_POLICY_LABEL,
      logoutTimeoutMs: HUB_AUTO_LOGOUT_TIMEOUT_MS,
      meetingException: true,
      meetingExceptionScope: "chronos_call_route",
    },
    rangeEnd: rangeEnd.toISOString(),
    rangeStart: rangeStart.toISOString(),
    summary: createAvailabilitySummary(team, events),
    team,
  };
}

async function loadAvailabilityHistoryEvents({
  activeUsers,
  adminClient,
  historyStart,
}: {
  activeUsers: HubUserRow[];
  adminClient: SupabaseAdminClient;
  historyStart: string;
}) {
  if (!activeUsers.length) {
    return [];
  }

  // UMA consulta pra todos (era 1 por usuário = 8 idas ao banco em toda carga da
  // Home, visível nos logs da API). O teto por usuário é reaplicado em memória.
  const { data, error } = await adminClient
    .from("hub_presence_events")
    .select(
      "id,user_id,previous_status,next_status,reason,source,metadata,started_at,ended_at,created_at",
    )
    .in(
      "user_id",
      activeUsers.map((user) => user.id),
    )
    .is("module_id", null)
    .is("workspace_id", null)
    .gte("started_at", historyStart)
    .order("started_at", { ascending: false })
    .limit(activeUsers.length * availabilityHistoryLimitPerUser);

  if (error) {
    return [];
  }

  const eventCountByUserId = new Map<string, number>();

  // Já vem ordenado do mais novo pro mais antigo — o corte por usuário preserva
  // exatamente o que o caminho antigo devolvia.
  return ((data ?? []) as HubPresenceEventRow[]).filter((event) => {
    const count = eventCountByUserId.get(event.user_id) ?? 0;

    if (count >= availabilityHistoryLimitPerUser) {
      return false;
    }

    eventCountByUserId.set(event.user_id, count + 1);
    return true;
  });
}

async function loadCurrentChronosMeetingsByUserId(
  adminClient: SupabaseAdminClient,
  users: HubUserRow[],
) {
  const currentMeetingsByUserId = new Map<string, HubPresenceActiveMeeting>();
  const activeUsers = users.filter((user) => user.status === "active");
  const userIds = new Set(activeUsers.map((user) => user.id));
  const userIdsByEmail = new Map(
    activeUsers.map((user) => [user.email.trim().toLowerCase(), user.id]),
  );
  const now = new Date().toISOString();
  const { data: meetings, error } = await adminClient
    .from("chronos_meetings")
    .select("id,protocol,title,status,starts_at,ends_at,host_user_id")
    .not("starts_at", "is", null)
    .not("ends_at", "is", null)
    .lte("starts_at", now)
    .gte("ends_at", now)
    .in("status", ["scheduled", "lobby", "live", "review"])
    .order("starts_at", { ascending: false })
    .limit(30);

  if (error || !meetings?.length) {
    return currentMeetingsByUserId;
  }

  const meetingById = new Map(meetings.map((meeting) => [meeting.id, meeting]));

  for (const meeting of meetings) {
    const mappedMeeting = mapChronosMeetingPresence(meeting);

    if (mappedMeeting && meeting.host_user_id && userIds.has(meeting.host_user_id)) {
      currentMeetingsByUserId.set(meeting.host_user_id, mappedMeeting);
    }
  }

  const { data: participants, error: participantsError } = await adminClient
    .from("chronos_participants")
    .select("meeting_id,user_id,email")
    .in(
      "meeting_id",
      meetings.map((meeting) => meeting.id),
    )
    .limit(300);

  if (participantsError || !participants?.length) {
    return currentMeetingsByUserId;
  }

  for (const participant of participants) {
    const meeting = meetingById.get(participant.meeting_id);
    const mappedMeeting = meeting ? mapChronosMeetingPresence(meeting) : null;

    if (!mappedMeeting) {
      continue;
    }

    const userId =
      (participant.user_id && userIds.has(participant.user_id)
        ? participant.user_id
        : null) ??
      userIdsByEmail.get(participant.email?.trim().toLowerCase() ?? "") ??
      null;

    if (userId && !currentMeetingsByUserId.has(userId)) {
      currentMeetingsByUserId.set(userId, mappedMeeting);
    }
  }

  return currentMeetingsByUserId;
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

function groupPresenceEventsByUser(events: HubPresenceEventRow[]) {
  const grouped = new Map<string, HubPresenceEventRow[]>();

  for (const event of events) {
    const userEvents = grouped.get(event.user_id) ?? [];
    userEvents.push(event);
    grouped.set(event.user_id, userEvents);
  }

  return grouped;
}

function calculatePresenceTotals({
  events,
  rangeEnd,
  rangeStart,
}: {
  events: HubPresenceEventRow[];
  rangeEnd: string;
  rangeStart: string;
}) {
  const totals = createEmptyPresenceTotals();
  const nowTime = Date.now();
  const rangeStartTime = Date.parse(rangeStart);
  const rangeEndTime = Date.parse(rangeEnd);

  for (const event of events) {
    const startedAt = Math.max(Date.parse(event.started_at), rangeStartTime);
    const endedAt = Math.min(
      event.ended_at ? Date.parse(event.ended_at) : nowTime,
      rangeEndTime,
    );

    if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt <= startedAt) {
      continue;
    }

    totals[normalizeLegacyPresence(event.next_status)] += Math.round(
      (endedAt - startedAt) / 1000,
    );
  }

  return totals;
}

function createAvailabilitySummary(
  team: Array<{
    currentStatus: Exclude<HubPresenceStatus, "busy">;
    productiveSeconds: number;
    trackedSeconds: number;
  }>,
  events: HubPresenceEventRow[],
) {
  const statusCounts = createEmptyPresenceTotals();
  const productiveSeconds = team.reduce(
    (total, user) => total + user.productiveSeconds,
    0,
  );
  const trackedSeconds = team.reduce(
    (total, user) => total + user.trackedSeconds,
    0,
  );

  for (const user of team) {
    statusCounts[user.currentStatus] += 1;
  }

  return {
    autoLogoutCount: events.filter(isAutoLogoutEvent).length,
    meetingCount: statusCounts.agenda,
    productivityRate:
      trackedSeconds > 0
        ? Math.round((productiveSeconds / trackedSeconds) * 100)
        : null,
    productiveSeconds,
    riskCount: statusCounts.away + statusCounts.offline,
    statusCounts,
    trackedSeconds,
    transitionCount: events.length,
  };
}

function isAutoLogoutEvent(event: HubPresenceEventRow) {
  return (
    event.reason === "logout" &&
    event.metadata &&
    typeof event.metadata === "object" &&
    event.metadata.trigger === "auto_logout"
  );
}

function normalizeLegacyPresence(
  status: HubPresenceStatus,
): Exclude<HubPresenceStatus, "busy"> {
  return status === "busy" ? "agenda" : status;
}

function createEmptyPresenceTotals() {
  return {
    agenda: 0,
    away: 0,
    lunch: 0,
    offline: 0,
    online: 0,
  } as Record<Exclude<HubPresenceStatus, "busy">, number>;
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
