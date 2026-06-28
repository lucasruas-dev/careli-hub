"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  AgendaItem,
  AgendaItemChannel,
  AgendaItemKind,
  AgendaItemPriority,
  AgendaItemStatus,
  AgendaMeeting,
  AgendaModule,
} from "@/lib/agenda/agenda";
import type { AsanaBridgeTask } from "@/lib/agenda/asana-bridge";

export type {
  AgendaItem,
  AgendaItemChannel,
  AgendaItemKind,
  AgendaItemPriority,
  AgendaItemStatus,
  AgendaMeeting,
  AgendaModule,
  AsanaBridgeTask,
};

export type CreateAgendaItemPayload = {
  attendanceProtocol?: string | null;
  channel?: AgendaItemChannel | null;
  clientC2xId?: number | null;
  clientName?: string | null;
  description?: string | null;
  dueAt?: string | null;
  kind: AgendaItemKind;
  module?: AgendaModule;
  priority?: AgendaItemPriority | null;
  remindAt?: string | null;
  title: string;
};

export type UpdateAgendaItemPayload = {
  channel?: AgendaItemChannel | null;
  description?: string | null;
  dueAt?: string | null;
  priority?: AgendaItemPriority | null;
  remindAt?: string | null;
  status?: AgendaItemStatus;
  title?: string;
};

export type MeuDiaSnapshot = {
  asana: AsanaBridgeTask[];
  items: AgendaItem[];
  meetings: AgendaMeeting[];
};

async function getAccessToken(): Promise<string | null> {
  const client = getHubSupabaseClient();
  if (!client) {
    return null;
  }
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Sessao ausente.");
  }
  return fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

// Carrega as 3 fontes em paralelo. Asana e bonus: falha vira lista vazia.
export async function loadMeuDia(): Promise<MeuDiaSnapshot> {
  const [itemsRes, meetingsRes, asanaRes] = await Promise.allSettled([
    authedFetch("/api/agenda/items"),
    authedFetch("/api/agenda/meetings"),
    authedFetch("/api/agenda/asana"),
  ]);

  return {
    asana: await readArray<AsanaBridgeTask>(asanaRes, "tasks"),
    items: await readArray<AgendaItem>(itemsRes, "items"),
    meetings: await readArray<AgendaMeeting>(meetingsRes, "meetings"),
  };
}

export async function loadItemsByProtocol(
  protocol: string,
): Promise<AgendaItem[]> {
  const res = await authedFetch(
    `/api/agenda/items?protocol=${encodeURIComponent(protocol)}`,
  );
  const payload = (await res.json().catch(() => null)) as
    | { items?: AgendaItem[] }
    | null;
  return payload?.items ?? [];
}

export async function createAgendaItem(
  payload: CreateAgendaItemPayload,
): Promise<AgendaItem | null> {
  const res = await authedFetch("/api/agenda/items", {
    body: JSON.stringify(payload),
    method: "POST",
  });
  const data = (await res.json().catch(() => null)) as
    | { item?: AgendaItem }
    | null;
  return res.ok ? data?.item ?? null : null;
}

export async function updateAgendaItem(
  id: string,
  payload: UpdateAgendaItemPayload,
): Promise<AgendaItem | null> {
  const res = await authedFetch("/api/agenda/items", {
    body: JSON.stringify({ id, ...payload }),
    method: "PATCH",
  });
  const data = (await res.json().catch(() => null)) as
    | { item?: AgendaItem }
    | null;
  return res.ok ? data?.item ?? null : null;
}

export async function deleteAgendaItem(id: string): Promise<boolean> {
  const res = await authedFetch(`/api/agenda/items?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return res.ok;
}

async function readArray<T>(
  result: PromiseSettledResult<Response>,
  key: string,
): Promise<T[]> {
  if (result.status !== "fulfilled" || !result.value.ok) {
    return [];
  }
  const payload = (await result.value.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const value = payload?.[key];
  return Array.isArray(value) ? (value as T[]) : [];
}
