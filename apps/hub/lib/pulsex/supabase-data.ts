"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import {
  pulsexChannels,
  pulsexMessages,
  pulsexPresenceUsers,
} from "./mock-data";
import type {
  PulseXChannel,
  PulseXDepartment,
  PulseXMessage,
  PulseXPresenceUser,
  PulseXSector,
} from "./types";

type QueryResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

export type PulseXOperationalData = {
  channels: PulseXChannel[];
  departments: PulseXDepartment[];
  messages: PulseXMessage[];
  sectors: PulseXSector[];
  users: PulseXPresenceUser[];
};

type DepartmentRow = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived" | "disabled";
};

type SectorRow = {
  department_id: string;
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived" | "disabled";
};

type ChannelMemberRow = {
  user_id: string;
};

type PulseXChannelRow = {
  department_id?: string | null;
  description?: string | null;
  hub_departments?: { name: string; slug: string } | null;
  hub_sectors?: { name: string; slug: string } | null;
  id: string;
  kind: "department" | "sector" | "direct" | "system";
  name: string;
  pulsex_channel_members?: ChannelMemberRow[];
  sector_id?: string | null;
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

type HubUserAssignmentRow = {
  department_id?: string | null;
  sector_id?: string | null;
  status: "active" | "archived" | "disabled";
};

type HubUserRow = {
  display_name: string;
  email: string;
  hub_user_assignments?: {
    department_id?: string | null;
    hub_departments?: { name: string } | null;
    hub_sectors?: { name: string } | null;
    sector_id?: string | null;
    status: "active" | "archived" | "disabled";
  }[];
  id: string;
  role: "admin" | "leader" | "operator" | "viewer";
  status: "active" | "archived" | "disabled";
};

export async function loadPulseXOperationalData(input: {
  currentUserId: string;
  userRole?: string;
}): Promise<PulseXOperationalData> {
  const client = getHubSupabaseClient();

  if (!client) {
    return createPulseXFallback();
  }

  const [departments, sectors, assignments, allChannels, users] =
    await Promise.all([
      listDepartments(),
      listSectors(),
      listUserAssignments(input.currentUserId),
      listPulseXChannels(),
      listDirectUsers(),
    ]);
  const channels = filterChannelsForUser({
    assignments,
    channels: allChannels,
    currentUserId: input.currentUserId,
    userRole: input.userRole,
  });
  const activeChannelId = channels[0]?.id;
  const messages = activeChannelId
    ? await listChannelMessages(activeChannelId)
    : [];

  return {
    channels: channels.length > 0 ? channels : [...pulsexChannels],
    departments,
    messages,
    sectors,
    users: users.length > 0 ? users : [...pulsexPresenceUsers],
  };
}

export async function listDepartments(): Promise<PulseXDepartment[]> {
  const client = getHubSupabaseClient();

  if (!client) {
    return [];
  }

  const result = await client
    .from("hub_departments")
    .select("id,name,slug,status")
    .eq("status", "active")
    .order("name");

  assertQuery("departamentos", result);

  return ((result as QueryResult<DepartmentRow[]>).data ?? []).map(
    (department) => ({
      id: department.id,
      name: department.name,
      slug: department.slug,
    }),
  );
}

export async function listSectors(): Promise<PulseXSector[]> {
  const client = getHubSupabaseClient();

  if (!client) {
    return [];
  }

  const result = await client
    .from("hub_sectors")
    .select("id,department_id,name,slug,status")
    .eq("status", "active")
    .order("name");

  assertQuery("setores", result);

  return ((result as QueryResult<SectorRow[]>).data ?? []).map((sector) => ({
    departmentId: sector.department_id,
    id: sector.id,
    name: sector.name,
    slug: sector.slug,
  }));
}

export async function listPulseXChannels(): Promise<PulseXChannel[]> {
  const client = getHubSupabaseClient();

  if (!client) {
    return pulsexChannels.map((channel) => ({ ...channel }));
  }

  const result = await client
    .from("pulsex_channels")
    .select(
      "id,name,description,kind,department_id,sector_id,status,hub_departments(name,slug),hub_sectors(name,slug),pulsex_channel_members(user_id)",
    )
    .eq("status", "active")
    .order("order");

  assertQuery("canais PulseX", result);

  return ((result as QueryResult<PulseXChannelRow[]>).data ?? []).map(
    mapChannel,
  );
}

export async function listDirectUsers(): Promise<PulseXPresenceUser[]> {
  const client = getHubSupabaseClient();

  if (!client) {
    return pulsexPresenceUsers.map((user) => ({ ...user }));
  }

  const result = await client
    .from("hub_users")
    .select(
      "id,email,display_name,role,status,hub_user_assignments(department_id,sector_id,status,hub_departments(name),hub_sectors(name))",
    )
    .eq("status", "active")
    .order("display_name");

  assertQuery("usuarios PulseX", result);

  return ((result as QueryResult<HubUserRow[]>).data ?? []).map(mapUser);
}

export async function listChannelMessages(
  channelId: PulseXChannel["id"],
): Promise<PulseXMessage[]> {
  const client = getHubSupabaseClient();

  if (!client || channelId.startsWith("direct-")) {
    return pulsexMessages
      .filter((message) => message.channelId === channelId)
      .map((message) => ({ ...message }));
  }

  const result = await client
    .from("pulsex_messages")
    .select("id,channel_id,author_user_id,body,created_at,deleted_at")
    .eq("channel_id", channelId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  assertQuery("mensagens PulseX", result);

  return ((result as QueryResult<PulseXMessageRow[]>).data ?? []).map(
    mapMessage,
  );
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

async function listUserAssignments(
  userId: string,
): Promise<HubUserAssignmentRow[]> {
  const client = getHubSupabaseClient();

  if (!client) {
    return [];
  }

  const result = await client
    .from("hub_user_assignments")
    .select("department_id,sector_id,status")
    .eq("user_id", userId)
    .eq("status", "active");

  assertQuery("vinculos PulseX", result);

  return (result as QueryResult<HubUserAssignmentRow[]>).data ?? [];
}

function filterChannelsForUser({
  assignments,
  channels,
  currentUserId,
  userRole,
}: {
  assignments: readonly HubUserAssignmentRow[];
  channels: readonly PulseXChannel[];
  currentUserId: string;
  userRole?: string;
}) {
  if (userRole === "admin") {
    return [...channels];
  }

  if (assignments.length === 0) {
    return channels.filter(
      (channel) =>
        !channel.memberUserIds?.length ||
        channel.memberUserIds.includes(currentUserId),
    );
  }

  const departmentIds = new Set(
    assignments
      .map((assignment) => assignment.department_id)
      .filter((id): id is string => Boolean(id)),
  );
  const sectorIds = new Set(
    assignments
      .map((assignment) => assignment.sector_id)
      .filter((id): id is string => Boolean(id)),
  );

  return channels.filter((channel) => {
    if (channel.memberUserIds?.includes(currentUserId)) {
      return true;
    }

    if (channel.sectorId && sectorIds.has(channel.sectorId)) {
      return true;
    }

    return Boolean(channel.departmentId && departmentIds.has(channel.departmentId));
  });
}

function mapChannel(row: PulseXChannelRow): PulseXChannel {
  const unit = row.hub_sectors?.name ?? row.hub_departments?.name ?? "PulseX";
  const kind = mapChannelKind(row.kind, row.hub_departments?.name);
  const memberUserIds =
    row.pulsex_channel_members?.map((member) => member.user_id) ?? [];

  return {
    avatar: getInitials(row.name),
    context: {
      filesCount: 0,
      owner: row.hub_departments?.name ?? "Hub",
      status: "Ativo",
      unit,
    },
    departmentId: row.department_id ?? undefined,
    departmentName: row.hub_departments?.name,
    description: row.description ?? `Canal ${row.name}`,
    id: row.id,
    kind,
    lastMessageAt: "-",
    memberUserIds,
    name: row.name,
    preview: row.description ?? "Canal operacional",
    sectorId: row.sector_id ?? undefined,
    sectorName: row.hub_sectors?.name,
    status: "online",
  };
}

function mapUser(row: HubUserRow): PulseXPresenceUser {
  const activeAssignments =
    row.hub_user_assignments?.filter(
      (assignment) => assignment.status === "active",
    ) ?? [];
  const primaryAssignment = activeAssignments[0];
  const role =
    primaryAssignment?.hub_sectors?.name ??
    primaryAssignment?.hub_departments?.name ??
    row.role;

  return {
    channelIds: [],
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

function createPulseXFallback(): PulseXOperationalData {
  return {
    channels: pulsexChannels.map((channel) => ({ ...channel })),
    departments: [],
    messages: pulsexMessages.map((message) => ({ ...message })),
    sectors: [],
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
