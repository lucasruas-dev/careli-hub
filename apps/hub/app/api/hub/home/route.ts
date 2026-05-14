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

const HUB_IDLE_STALE_MS = 10 * 60 * 1000;

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
    pulseXMessagesResult,
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

  if (!presenceResult.error) {
    for (const row of (presenceResult.data ?? []) as HubPresenceRow[]) {
      if (!presenceByUserId.has(row.user_id)) {
        presenceByUserId.set(row.user_id, row);
      }
    }
  }

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
      presence: [...presenceByUserId.entries()].map(([userId, row]) => ({
        lastSeenAt: row.last_seen_at,
        status: normalizeFreshPresence(row),
        userId,
      })),
      pulsex: {
        messagesTodayCount: pulseXMessagesResult.error
          ? 0
          : (pulseXMessagesResult.count ?? 0),
      },
      users: ((usersResult.data ?? []) as HubUserRow[]).map((user) => {
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
  const serverEnv = process.env as Record<string, string | undefined>;
  const supabaseUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

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

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
