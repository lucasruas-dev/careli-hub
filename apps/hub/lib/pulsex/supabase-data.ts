"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import {
  pulsexChannels,
  pulsexMessages,
  pulsexPresenceUsers,
} from "./mock-data";
import type {
  PulseXChannel,
  PulseXMessage,
  PulseXPresenceUser,
} from "./types";

type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

type SetupPulseXPayload = {
  channels: PulseXChannel[];
  messages: PulseXMessage[];
  users: PulseXPresenceUser[];
};

type PulseXChannelRow = {
  description?: string | null;
  hub_departments?: { name: string } | null;
  hub_sectors?: { name: string } | null;
  id: string;
  kind: "department" | "sector" | "direct" | "system";
  name: string;
  status: "active" | "archived" | "disabled";
};

type PulseXMessageRow = {
  author_user_id?: string | null;
  body: string;
  channel_id: string;
  created_at: string;
  deleted_at?: string | null;
  id: string;
};

type HubUserRow = {
  display_name: string;
  email: string;
  hub_user_assignments?: {
    hub_departments?: { name: string } | null;
    hub_sectors?: { name: string } | null;
  }[];
  id: string;
  role: "admin" | "leader" | "operator" | "viewer";
  status: "active" | "archived" | "disabled";
};

export async function loadPulseXOperationalData(): Promise<SetupPulseXPayload> {
  const client = getHubSupabaseClient();

  if (!client) {
    return createPulseXFallback();
  }

  const [channelsResult, usersResult, messagesResult] = await Promise.all([
    client
      .from("pulsex_channels")
      .select(
        "id,name,description,kind,status,hub_departments(name),hub_sectors(name)",
      )
      .eq("status", "active")
      .order("order"),
    client
      .from("hub_users")
      .select(
        "id,email,display_name,role,status,hub_user_assignments(hub_departments(name),hub_sectors(name))",
      )
      .eq("status", "active")
      .order("display_name"),
    client
      .from("pulsex_messages")
      .select("id,channel_id,author_user_id,body,created_at,deleted_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(200),
  ]);

  assertQuery("canais PulseX", channelsResult);
  assertQuery("usuarios PulseX", usersResult);
  assertQuery("mensagens PulseX", messagesResult);

  const channels = (
    (channelsResult as QueryResult<PulseXChannelRow[]>).data ?? []
  ).map(mapChannel);
  const users = ((usersResult as QueryResult<HubUserRow[]>).data ?? []).map(
    (user) => mapUser(user, channels),
  );
  const messages = (
    (messagesResult as QueryResult<PulseXMessageRow[]>).data ?? []
  ).map(mapMessage);

  return {
    channels: channels.length > 0 ? channels : [...pulsexChannels],
    messages,
    users: users.length > 0 ? users : [...pulsexPresenceUsers],
  };
}

export async function createPulseXMessage(input: {
  authorUserId?: string;
  body: string;
  channelId: string;
}): Promise<PulseXMessage> {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Supabase nao configurado.");
  }

  const result = await client
    .from("pulsex_messages")
    .insert({
      author_user_id: input.authorUserId,
      body: input.body,
      channel_id: input.channelId,
    })
    .select("id,channel_id,author_user_id,body,created_at,deleted_at")
    .single();

  assertQuery("enviar mensagem", result);

  return mapMessage((result as QueryResult<PulseXMessageRow>).data);
}

function mapChannel(row: PulseXChannelRow): PulseXChannel {
  const unit = row.hub_sectors?.name ?? row.hub_departments?.name ?? "PulseX";
  const kind = mapChannelKind(row.kind, row.hub_departments?.name);

  return {
    avatar: getInitials(row.name),
    context: {
      filesCount: 0,
      owner: row.hub_departments?.name ?? "Hub",
      status: "Ativo",
      unit,
    },
    description: row.description ?? `Canal ${row.name}`,
    id: row.id,
    kind,
    lastMessageAt: "-",
    name: row.name,
    preview: "Canal operacional conectado ao Supabase.",
    status: "online",
  };
}

function mapUser(row: HubUserRow, channels: readonly PulseXChannel[]): PulseXPresenceUser {
  const assignment = row.hub_user_assignments?.[0];
  const role = assignment?.hub_sectors?.name ?? assignment?.hub_departments?.name ?? row.role;

  return {
    channelIds: channels.map((channel) => channel.id),
    email: row.email,
    id: row.id,
    initials: getInitials(row.display_name),
    label: row.display_name,
    role,
    status: "online",
    username: row.email.split("@")[0],
  };
}

function mapMessage(row: PulseXMessageRow | null): PulseXMessage {
  if (!row) {
    throw new Error("Mensagem inexistente.");
  }

  return {
    authorId: row.author_user_id ?? "system",
    body: row.body,
    channelId: row.channel_id,
    deletedAt: row.deleted_at ?? undefined,
    id: row.id,
    reactions: [],
    status: "neutral",
    tags: [],
    threadCount: 0,
    timestamp: formatMessageTime(row.created_at),
  };
}

function assertQuery(label: string, result: unknown): asserts result is QueryResult<unknown> {
  const queryResult = result as QueryResult<unknown>;

  if (queryResult.error) {
    throw new Error(`Nao foi possivel carregar ${label}: ${queryResult.error.message}`);
  }
}

function createPulseXFallback(): SetupPulseXPayload {
  return {
    channels: pulsexChannels.map((channel) => ({ ...channel })),
    messages: pulsexMessages.map((message) => ({ ...message })),
    users: pulsexPresenceUsers.map((user) => ({ ...user })),
  };
}

function mapChannelKind(
  kind: PulseXChannelRow["kind"],
  departmentName?: string,
): PulseXChannel["kind"] {
  if (kind === "direct") {
    return "direct";
  }

  if (kind === "system") {
    return "system";
  }

  if (departmentName === "Tecnologia") {
    return "technology";
  }

  if (departmentName === "Relacao" || departmentName === "Diretoria") {
    return "relation";
  }

  return "operations";
}

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
