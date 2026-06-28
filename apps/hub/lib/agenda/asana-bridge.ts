// Ponte Asana -> "Meu dia" (read-only). Enquanto o modulo nativo de tarefas nao
// esta completo, mostramos as tarefas ABERTAS do Asana do usuario logado junto
// com as nativas, pra ver tudo num lugar so. Reaproveita o token/workspaces ja
// configurados (mesmos envs da Saude do HUB). Resiliente: qualquer falha vira
// lista vazia -- Asana e uma fonte bonus, nunca derruba a tela.

const ASANA_API_BASE_URL = "https://app.asana.com/api/1.0";
const ASANA_TASK_OPT_FIELDS =
  "gid,name,completed,due_on,due_at,permalink_url";
const MAX_WORKSPACES = 25;
const MAX_TASKS_PER_USER = 100;
const ASANA_BRIDGE_CACHE_TTL_MS = 60_000;

export type AsanaBridgeTask = {
  completed: boolean;
  dueAt: string | null;
  id: string;
  title: string;
  url: string | null;
  workspaceName: string | null;
};

type AsanaUserRef = { gid: string };
type AsanaWorkspaceRef = { gid: string; name?: string | null };
type AsanaTaskRef = {
  completed?: boolean | null;
  due_at?: string | null;
  due_on?: string | null;
  gid: string;
  name?: string | null;
  permalink_url?: string | null;
};
type AsanaEnvelope<T> = { data: T; next_page?: { offset?: string | null } | null };

type CacheEntry = { expiresAt: number; tasks: AsanaBridgeTask[] };
const cacheByEmail = new Map<string, CacheEntry>();

// Tarefas abertas do Asana do usuario (por email). Vazio se nao configurado /
// sem match / erro. Cacheado por email (TTL curto) para nao bater a cada render.
export async function listUserAsanaTasks(
  email: string | null | undefined,
): Promise<AsanaBridgeTask[]> {
  const normalizedEmail = email?.trim().toLowerCase();
  const token = process.env.ASANA_ACCESS_TOKEN?.trim();

  if (!normalizedEmail || !token) {
    return [];
  }

  const cached = cacheByEmail.get(normalizedEmail);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tasks;
  }

  try {
    const workspaces = (await resolveWorkspaces(token)).slice(0, MAX_WORKSPACES);
    const collected = new Map<string, AsanaBridgeTask>();

    for (const workspace of workspaces) {
      if (collected.size >= MAX_TASKS_PER_USER) {
        break;
      }

      const asanaUser = await fetchUserByEmail(token, workspace.gid, normalizedEmail);
      if (!asanaUser) {
        continue;
      }

      const tasks = await fetchOpenTasks(token, workspace.gid, asanaUser.gid);
      for (const task of tasks) {
        if (task.completed) {
          continue;
        }
        collected.set(task.gid, {
          completed: false,
          dueAt: resolveDueIso(task),
          id: task.gid,
          title: task.name?.trim() || "(sem titulo)",
          url: task.permalink_url ?? null,
          workspaceName: workspace.name?.trim() || null,
        });
      }
    }

    const tasks = [...collected.values()];
    cacheByEmail.set(normalizedEmail, {
      expiresAt: Date.now() + ASANA_BRIDGE_CACHE_TTL_MS,
      tasks,
    });

    return tasks;
  } catch {
    return [];
  }
}

async function resolveWorkspaces(token: string): Promise<AsanaWorkspaceRef[]> {
  const mode =
    process.env.ASANA_WORKSPACE_MODE?.trim().toLowerCase() === "filtered"
      ? "filtered"
      : "all";

  if (mode === "filtered") {
    const raw =
      process.env.ASANA_WORKSPACE_GIDS?.trim() ||
      process.env.ASANA_WORKSPACE_GID?.trim() ||
      "";
    const gids = raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value && value.toLowerCase() !== "all");

    if (gids.length > 0) {
      return gids.map((gid) => ({ gid }));
    }
  }

  const envelope = await fetchAsana<AsanaWorkspaceRef[]>(token, "/workspaces", {
    limit: "100",
    opt_fields: "gid,name",
  });

  return envelope.data ?? [];
}

async function fetchUserByEmail(
  token: string,
  workspaceGid: string,
  email: string,
): Promise<AsanaUserRef | null> {
  try {
    const envelope = await fetchAsana<AsanaUserRef>(
      token,
      `/workspaces/${encodeURIComponent(workspaceGid)}/users/${encodeURIComponent(email)}`,
      { opt_fields: "gid" },
    );
    return envelope.data ?? null;
  } catch {
    return null;
  }
}

async function fetchOpenTasks(
  token: string,
  workspaceGid: string,
  userGid: string,
): Promise<AsanaTaskRef[]> {
  // completed_since=now devolve so as tarefas ainda abertas do usuario.
  const envelope = await fetchAsana<AsanaTaskRef[]>(token, "/tasks", {
    assignee: userGid,
    completed_since: "now",
    limit: String(MAX_TASKS_PER_USER),
    opt_fields: ASANA_TASK_OPT_FIELDS,
    workspace: workspaceGid,
  });

  return envelope.data ?? [];
}

async function fetchAsana<T>(
  token: string,
  path: string,
  query: Record<string, string | undefined>,
): Promise<AsanaEnvelope<T>> {
  const url = new URL(`${ASANA_API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Asana HTTP ${response.status}`);
  }

  const payload = (await response.json()) as AsanaEnvelope<T>;
  return payload;
}

function resolveDueIso(task: AsanaTaskRef): string | null {
  if (task.due_at) {
    const parsed = Date.parse(task.due_at);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (task.due_on) {
    // Data sem hora: ancora no fim do dia (horario de Brasilia) pra ordenar bem.
    const parsed = Date.parse(`${task.due_on}T23:59:59.999-03:00`);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  return null;
}
