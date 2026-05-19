import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

type HubUserRow = {
  avatar_url?: string | null;
  display_name: string;
  email: string;
  id: string;
  role: HubUserRole;
  status: string;
};

type AsanaUser = {
  email?: string | null;
  gid: string;
  name?: string | null;
};

type AsanaTask = {
  completed?: boolean | null;
  completed_at?: string | null;
  created_at?: string | null;
  due_at?: string | null;
  due_on?: string | null;
  gid: string;
  modified_at?: string | null;
  name?: string | null;
  permalink_url?: string | null;
};

type AsanaWorkspace = {
  gid: string;
  is_organization?: boolean | null;
  name?: string | null;
};

type AsanaEnvelope<T> = {
  data: T;
  next_page?: {
    offset?: string | null;
  } | null;
};

type HomeDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: HubUserRow;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

type AsanaCollaboratorPerformance = {
  asanaGid?: string;
  asanaGids: string[];
  asanaName?: string;
  averageDelayDays: number;
  completed: number;
  completedLate: number;
  completedOnTime: number;
  completedWithoutDue: number;
  email: string;
  hubUserId: string;
  lateRate: number | null;
  matched: boolean;
  name: string;
  onTimeRate: number | null;
  open: number;
  overdue: number;
  overdueRate: number;
  total: number;
  workspaceNames: string[];
};

type AsanaAnalysisPeriod = {
  endDate: string;
  endTime: number;
  label: string;
  preset: "custom" | "month" | "today" | "week";
  startDate: string;
  startTime: number;
};

const ASANA_API_BASE_URL = "https://app.asana.com/api/1.0";
const ASANA_DOCS_URL = "https://developers.asana.com/reference/gettasks";
const DEFAULT_WINDOW_DAYS = 90;
const DEFAULT_TASK_LIMIT_PER_USER = 200;
const MAX_TASK_LIMIT_PER_USER = 500;
const MS_PER_DAY = 86_400_000;

export async function GET(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  const usersResult = await context.adminClient
    .from("hub_users")
    .select("id,email,display_name,avatar_url,role,status")
    .eq("status", "active")
    .order("display_name");

  if (usersResult.error) {
    return NextResponse.json(
      { error: "Nao foi possivel carregar usuarios do Hub." },
      { status: 500 },
    );
  }

  const hubUsers = ((usersResult.data ?? []) as HubUserRow[]).filter(
    (user) => user.email,
  );
  const token = process.env.ASANA_ACCESS_TOKEN?.trim();
  const workspaceMode = readWorkspaceModeEnv();
  const configuredWorkspaceGids = readWorkspaceGidsEnv(workspaceMode);
  const windowDays = readNumberEnv(
    "ASANA_TASK_WINDOW_DAYS",
    DEFAULT_WINDOW_DAYS,
    7,
    730,
  );
  const analysisPeriod = resolveAnalysisPeriod(
    request.nextUrl.searchParams,
    windowDays,
  );
  const taskLimitPerUser = readNumberEnv(
    "ASANA_TASK_LIMIT_PER_USER",
    DEFAULT_TASK_LIMIT_PER_USER,
    50,
    MAX_TASK_LIMIT_PER_USER,
  );
  const missingEnv = [token ? null : "ASANA_ACCESS_TOKEN"].filter(
    Boolean,
  ) as string[];

  if (missingEnv.length > 0 || !token) {
    return NextResponse.json({
      data: buildSnapshot({
        collaborators: hubUsers.map((user) =>
          buildUnmatchedCollaborator(user),
        ),
        message:
          "Configure o Asana no ambiente para carregar tarefas reais dos colaboradores.",
        missingEnv,
        status: "missing_config",
        period: analysisPeriod,
        taskLimitPerUser,
        windowDays,
        workspaceMode,
        workspaces: [],
      }),
    });
  }

  try {
    const workspaces = await resolveAsanaWorkspaces({
      configuredWorkspaceGids,
      token,
    });

    const collaborators = await loadCollaboratorPerformance({
      hubUsers,
      taskLimitPerUser,
      token,
      period: analysisPeriod,
      workspaces,
    });

    return NextResponse.json({
      data: buildSnapshot({
        collaborators,
        missingEnv,
        status: "configured",
        period: analysisPeriod,
        taskLimitPerUser,
        windowDays,
        workspaceMode,
        workspaces,
      }),
    });
  } catch (error) {
    return NextResponse.json({
      data: buildSnapshot({
        collaborators: hubUsers.map((user) =>
          buildUnmatchedCollaborator(user),
        ),
        message:
          error instanceof Error
            ? error.message
            : "Nao foi possivel consultar a API do Asana.",
        missingEnv,
        status: "error",
        period: analysisPeriod,
        taskLimitPerUser,
        windowDays,
        workspaceMode,
        workspaces: [],
      }),
    });
  }
}

async function createAuthorizedContext(request: NextRequest) {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Configure a chave server-side para carregar o Asana." },
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

async function loadCollaboratorPerformance({
  hubUsers,
  period,
  taskLimitPerUser,
  token,
  workspaces,
}: {
  hubUsers: HubUserRow[];
  period: AsanaAnalysisPeriod;
  taskLimitPerUser: number;
  token: string;
  workspaces: AsanaWorkspace[];
}) {
  const collaborators: AsanaCollaboratorPerformance[] = [];
  const completedSince = new Date(period.startTime).toISOString();

  for (const user of hubUsers) {
    const matchedUsers: AsanaUser[] = [];
    const matchedWorkspaceNames: string[] = [];
    const tasksByWorkspace = new Map<string, AsanaTask>();
    let remainingLimit = taskLimitPerUser;

    for (const workspace of workspaces) {
      if (remainingLimit <= 0) {
        break;
      }

      const asanaUser = await fetchAsanaUserByEmail({
        email: user.email,
        token,
        workspaceGid: workspace.gid,
      });

      if (!asanaUser) {
        continue;
      }

      matchedUsers.push(asanaUser);
      matchedWorkspaceNames.push(workspace.name ?? workspace.gid);

      const workspaceTasks = await fetchAsanaTasksForUser({
        completedSince,
        limit: remainingLimit,
        token,
        userGid: asanaUser.gid,
        workspaceGid: workspace.gid,
      });

      for (const task of workspaceTasks) {
        tasksByWorkspace.set(`${workspace.gid}:${task.gid}`, task);
      }

      remainingLimit = Math.max(0, taskLimitPerUser - tasksByWorkspace.size);
    }

    if (matchedUsers.length === 0) {
      collaborators.push(buildUnmatchedCollaborator(user));
      continue;
    }

    collaborators.push(
      buildCollaboratorPerformance({
        asanaUsers: matchedUsers,
        period,
        tasks: filterTasksForPeriod([...tasksByWorkspace.values()], period),
        user,
        workspaceNames: matchedWorkspaceNames,
      }),
    );
  }

  return collaborators.sort((left, right) => {
    if (right.overdue !== left.overdue) {
      return right.overdue - left.overdue;
    }

    if (right.completedLate !== left.completedLate) {
      return right.completedLate - left.completedLate;
    }

    return right.total - left.total;
  });
}

async function fetchAsanaUserByEmail({
  email,
  token,
  workspaceGid,
}: {
  email: string;
  token: string;
  workspaceGid: string;
}) {
  try {
    const envelope = await fetchAsana<AsanaUser>({
      path: `/workspaces/${encodeURIComponent(workspaceGid)}/users/${encodeURIComponent(email)}`,
      query: {
        opt_fields: "gid,name,email",
      },
      token,
    });

    return envelope.data;
  } catch (error) {
    if (error instanceof AsanaHttpError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

async function resolveAsanaWorkspaces({
  configuredWorkspaceGids,
  token,
}: {
  configuredWorkspaceGids: string[];
  token: string;
}) {
  if (configuredWorkspaceGids.length > 0) {
    const workspaces = await Promise.all(
      configuredWorkspaceGids.map(async (workspaceGid) => {
        const envelope = await fetchAsana<AsanaWorkspace>({
          path: `/workspaces/${encodeURIComponent(workspaceGid)}`,
          query: {
            opt_fields: "gid,name,is_organization",
          },
          token,
        });

        return envelope.data;
      }),
    );

    return workspaces;
  }

  const workspaces = new Map<string, AsanaWorkspace>();
  let offset: string | undefined;

  do {
    const envelope = await fetchAsana<AsanaWorkspace[]>({
      path: "/workspaces",
      query: {
        limit: "100",
        offset,
        opt_fields: "gid,name,is_organization",
      },
      token,
    });

    for (const workspace of envelope.data) {
      workspaces.set(workspace.gid, workspace);
    }

    offset = envelope.next_page?.offset ?? undefined;
  } while (offset);

  if (workspaces.size === 0) {
    throw new Error("A chave do Asana nao retornou nenhum workspace acessivel.");
  }

  return [...workspaces.values()];
}

async function fetchAsanaTasksForUser({
  completedSince,
  limit,
  token,
  userGid,
  workspaceGid,
}: {
  completedSince: string;
  limit: number;
  token: string;
  userGid: string;
  workspaceGid: string;
}) {
  const tasks = new Map<string, AsanaTask>();
  let offset: string | undefined;

  do {
    const pageSize = Math.min(100, limit - tasks.size);
    const envelope = await fetchAsana<AsanaTask[]>({
      path: "/tasks",
      query: {
        assignee: userGid,
        completed_since: completedSince,
        limit: String(pageSize),
        offset,
        opt_fields:
          "gid,name,completed,completed_at,due_on,due_at,created_at,modified_at,permalink_url",
        workspace: workspaceGid,
      },
      token,
    });

    for (const task of envelope.data) {
      tasks.set(task.gid, task);
    }

    offset = envelope.next_page?.offset ?? undefined;
  } while (offset && tasks.size < limit);

  return [...tasks.values()];
}

async function fetchAsana<T>({
  path,
  query,
  token,
}: {
  path: string;
  query: Record<string, string | undefined>;
  token: string;
}) {
  const url = new URL(`${ASANA_API_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(query)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | AsanaEnvelope<T>
    | {
        errors?: Array<{ message?: string }>;
      }
    | null;

  if (!response.ok) {
    const errorMessage =
      payload && "errors" in payload
        ? payload.errors?.map((item) => item.message).filter(Boolean).join(" ")
        : null;

    throw new AsanaHttpError(
      response.status,
      errorMessage || `Asana retornou HTTP ${response.status}.`,
    );
  }

  if (!payload || !("data" in payload)) {
    throw new Error("Asana retornou uma resposta sem dados.");
  }

  return payload;
}

function buildCollaboratorPerformance({
  asanaUsers,
  period,
  tasks,
  user,
  workspaceNames,
}: {
  asanaUsers: AsanaUser[];
  period: AsanaAnalysisPeriod;
  tasks: AsanaTask[];
  user: HubUserRow;
  workspaceNames: string[];
}): AsanaCollaboratorPerformance {
  const referenceTime = Math.min(Date.now(), period.endTime);
  let completed = 0;
  let completedLate = 0;
  let completedOnTime = 0;
  let completedWithoutDue = 0;
  let overdue = 0;
  const delayDays: number[] = [];

  for (const task of tasks) {
    const dueTime = getTaskDueTime(task);
    const isCompleted = Boolean(task.completed);

    if (!isCompleted && dueTime && dueTime < referenceTime) {
      overdue += 1;
      delayDays.push((referenceTime - dueTime) / MS_PER_DAY);
      continue;
    }

    if (!isCompleted) {
      continue;
    }

    completed += 1;

    if (!dueTime) {
      completedWithoutDue += 1;
      continue;
    }

    const completedTime = task.completed_at
      ? Date.parse(task.completed_at)
      : Number.NaN;

    if (Number.isNaN(completedTime) || completedTime <= dueTime) {
      completedOnTime += 1;
      continue;
    }

    completedLate += 1;
    delayDays.push((completedTime - dueTime) / MS_PER_DAY);
  }

  const completedWithDue = completedOnTime + completedLate;
  const total = tasks.length;

  return {
    asanaGid: asanaUsers[0]?.gid,
    asanaGids: asanaUsers.map((asanaUser) => asanaUser.gid),
    asanaName: asanaUsers[0]?.name ?? undefined,
    averageDelayDays: roundNumber(average(delayDays), 1),
    completed,
    completedLate,
    completedOnTime,
    completedWithoutDue,
    email: user.email,
    hubUserId: user.id,
    lateRate:
      completedWithDue > 0
        ? roundNumber((completedLate / completedWithDue) * 100, 1)
        : null,
    matched: true,
    name: user.display_name,
    onTimeRate:
      completedWithDue > 0
        ? roundNumber((completedOnTime / completedWithDue) * 100, 1)
        : null,
    open: total - completed,
    overdue,
    overdueRate: total > 0 ? roundNumber((overdue / total) * 100, 1) : 0,
    total,
    workspaceNames,
  };
}

function buildUnmatchedCollaborator(
  user: HubUserRow,
): AsanaCollaboratorPerformance {
  return {
    asanaGids: [],
    averageDelayDays: 0,
    completed: 0,
    completedLate: 0,
    completedOnTime: 0,
    completedWithoutDue: 0,
    email: user.email,
    hubUserId: user.id,
    lateRate: null,
    matched: false,
    name: user.display_name,
    onTimeRate: null,
    open: 0,
    overdue: 0,
    overdueRate: 0,
    total: 0,
    workspaceNames: [],
  };
}

function filterTasksForPeriod(
  tasks: AsanaTask[],
  period: AsanaAnalysisPeriod,
) {
  return tasks.filter((task) => {
    const dueTime = getTaskDueTime(task);
    const completedTime = task.completed_at
      ? Date.parse(task.completed_at)
      : Number.NaN;

    if (Number.isFinite(completedTime) && isInPeriod(completedTime, period)) {
      return true;
    }

    if (dueTime && isInPeriod(dueTime, period)) {
      return true;
    }

    return Boolean(!task.completed && dueTime && dueTime <= period.endTime);
  });
}

function buildSnapshot({
  collaborators,
  message,
  missingEnv,
  period,
  status,
  taskLimitPerUser,
  windowDays,
  workspaceMode,
  workspaces,
}: {
  collaborators: AsanaCollaboratorPerformance[];
  message?: string;
  missingEnv: string[];
  period: AsanaAnalysisPeriod;
  status: "configured" | "error" | "missing_config";
  taskLimitPerUser: number;
  windowDays: number;
  workspaceMode: "all" | "filtered";
  workspaces: AsanaWorkspace[];
}) {
  const totals = collaborators.reduce(
    (accumulator, collaborator) => {
      const lateItems = collaborator.overdue + collaborator.completedLate;

      accumulator.averageDelayDays += collaborator.averageDelayDays * lateItems;
      accumulator.completed += collaborator.completed;
      accumulator.completedLate += collaborator.completedLate;
      accumulator.completedOnTime += collaborator.completedOnTime;
      accumulator.completedWithoutDue += collaborator.completedWithoutDue;
      accumulator.collaboratorsMatched += collaborator.matched ? 1 : 0;
      accumulator.lateDelayWeight += lateItems;
      accumulator.open += collaborator.open;
      accumulator.overdue += collaborator.overdue;
      accumulator.total += collaborator.total;

      return accumulator;
    },
    {
      averageDelayDays: 0,
      collaboratorsMatched: 0,
      completed: 0,
      completedLate: 0,
      completedOnTime: 0,
      completedWithoutDue: 0,
      lateDelayWeight: 0,
      open: 0,
      overdue: 0,
      total: 0,
    },
  );
  const completedWithDue = totals.completedOnTime + totals.completedLate;

  return {
    collaborators,
    generatedAt: new Date().toISOString(),
    message,
    source: {
      docsUrl: ASANA_DOCS_URL,
      missingEnv,
      period: {
        endDate: period.endDate,
        label: period.label,
        preset: period.preset,
        startDate: period.startDate,
      },
      taskLimitPerUser,
      windowDays,
      workspaceConfigured: workspaces.length > 0,
      workspaceMode,
      workspaces: workspaces.map((workspace) => ({
        gid: workspace.gid,
        name: workspace.name ?? undefined,
      })),
    },
    status,
    totals: {
      averageDelayDays:
        totals.lateDelayWeight > 0
          ? roundNumber(totals.averageDelayDays / totals.lateDelayWeight, 1)
          : 0,
      completed: totals.completed,
      completedLate: totals.completedLate,
      completedOnTime: totals.completedOnTime,
      completedWithoutDue: totals.completedWithoutDue,
      collaboratorsMatched: totals.collaboratorsMatched,
      collaboratorsTotal: collaborators.length,
      lateRate:
        completedWithDue > 0
          ? roundNumber((totals.completedLate / completedWithDue) * 100, 1)
          : null,
      onTimeRate:
        completedWithDue > 0
          ? roundNumber((totals.completedOnTime / completedWithDue) * 100, 1)
          : null,
      open: totals.open,
      overdue: totals.overdue,
      total: totals.total,
    },
  };
}

function getTaskDueTime(task: AsanaTask) {
  if (task.due_at) {
    const dueAt = Date.parse(task.due_at);

    return Number.isNaN(dueAt) ? null : dueAt;
  }

  if (!task.due_on) {
    return null;
  }

  const dueOn = Date.parse(`${task.due_on}T23:59:59.999-03:00`);

  return Number.isNaN(dueOn) ? null : dueOn;
}

function resolveAnalysisPeriod(
  searchParams: URLSearchParams,
  fallbackWindowDays: number,
): AsanaAnalysisPeriod {
  const preset = normalizePeriodPreset(searchParams.get("preset"));
  const requestedStart = normalizeDateInput(searchParams.get("startDate"));
  const requestedEnd = normalizeDateInput(searchParams.get("endDate"));

  if (requestedStart && requestedEnd) {
    return buildAnalysisPeriod({
      endDate: requestedEnd,
      preset: "custom",
      startDate: requestedStart,
    });
  }

  const now = new Date();

  if (preset === "today") {
    const date = formatDateInput(now);

    return buildAnalysisPeriod({
      endDate: date,
      preset,
      startDate: date,
    });
  }

  if (preset === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);

    return buildAnalysisPeriod({
      endDate: formatDateInput(now),
      preset,
      startDate: formatDateInput(start),
    });
  }

  if (preset === "month") {
    const start = new Date(now);
    start.setDate(now.getDate() - 29);

    return buildAnalysisPeriod({
      endDate: formatDateInput(now),
      preset,
      startDate: formatDateInput(start),
    });
  }

  const start = new Date(now);
  start.setDate(now.getDate() - Math.max(1, fallbackWindowDays - 1));

  return buildAnalysisPeriod({
    endDate: formatDateInput(now),
    preset: "custom",
    startDate: formatDateInput(start),
  });
}

function buildAnalysisPeriod({
  endDate,
  preset,
  startDate,
}: {
  endDate: string;
  preset: AsanaAnalysisPeriod["preset"];
  startDate: string;
}): AsanaAnalysisPeriod {
  const orderedStartDate = startDate <= endDate ? startDate : endDate;
  const orderedEndDate = startDate <= endDate ? endDate : startDate;
  const startTime = Date.parse(`${orderedStartDate}T00:00:00.000-03:00`);
  const endTime = Date.parse(`${orderedEndDate}T23:59:59.999-03:00`);

  return {
    endDate: orderedEndDate,
    endTime,
    label: formatPeriodLabel(orderedStartDate, orderedEndDate),
    preset,
    startDate: orderedStartDate,
    startTime,
  };
}

function normalizePeriodPreset(
  value: string | null,
): AsanaAnalysisPeriod["preset"] {
  if (value === "today" || value === "week" || value === "month") {
    return value;
  }

  return "custom";
}

function normalizeDateInput(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return Number.isNaN(Date.parse(`${value}T00:00:00.000-03:00`))
    ? null
    : value;
}

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatPeriodLabel(startDate: string, endDate: string) {
  if (startDate === endDate) {
    return formatDisplayDate(startDate);
  }

  return `${formatDisplayDate(startDate)} a ${formatDisplayDate(endDate)}`;
}

function formatDisplayDate(value: string) {
  const [year, month, day] = value.split("-");

  return `${day}/${month}/${year}`;
}

function isInPeriod(value: number, period: AsanaAnalysisPeriod) {
  return value >= period.startTime && value <= period.endTime;
}

function readNumberEnv(
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const rawValue = process.env[key];
  const value = rawValue ? Number(rawValue) : fallback;

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function readWorkspaceModeEnv(): "all" | "filtered" {
  return process.env.ASANA_WORKSPACE_MODE?.trim().toLowerCase() === "filtered"
    ? "filtered"
    : "all";
}

function readWorkspaceGidsEnv(mode: "all" | "filtered") {
  if (mode === "all") {
    return [];
  }

  const rawValue =
    process.env.ASANA_WORKSPACE_GIDS?.trim() ||
    process.env.ASANA_WORKSPACE_GID?.trim() ||
    "";

  if (!rawValue || rawValue.toLowerCase() === "all") {
    return [];
  }

  return rawValue
    .split(",")
    .map((workspaceGid) => workspaceGid.trim())
    .filter(Boolean);
}

function roundNumber(value: number, decimals: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** decimals;

  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

class AsanaHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AsanaHttpError";
  }
}
