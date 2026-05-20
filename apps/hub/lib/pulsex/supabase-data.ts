"use client";

import {
  getHubSupabaseClient,
  getHubSupabaseDiagnostics,
  logSupabaseDiagnostic,
  serializeDiagnosticError,
} from "@/lib/supabase/client";
import {
  listHubPresence,
  markHubPresence,
} from "@/lib/hub-presence";
import type {
  HermesChannel,
  HermesDepartment,
  HermesMessage,
  HermesMessageAttachment,
  HermesMessageMention,
  HermesMessageTag,
  HermesPresenceUser,
  HermesSector,
  HermesThreadReply,
} from "./types";
import { normalizeHermesMessageTags } from "./message-tags";

type QueryResult<T> = {
  data: T | null;
  error: { message: string; name?: string; stack?: string } | null;
};

export type HermesOperationalData = {
  channels: HermesChannel[];
  departments: HermesDepartment[];
  messages: HermesMessage[];
  sectors: HermesSector[];
  users: HermesPresenceUser[];
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
  last_read_at?: string | null;
  status?: "active" | "archived" | "disabled";
  user_id: string;
};

type HermesChannelRow = {
  department_id?: string | null;
  description?: string | null;
  hub_departments?: { name: string; slug: string } | null;
  hub_sectors?: { name: string; slug: string } | null;
  id: string;
  kind: "department" | "sector" | "direct" | "system";
  metadata?: Record<string, unknown> | null;
  name: string;
  pulsex_channel_members?: ChannelMemberRow[];
  sector_id?: string | null;
  status: "active" | "archived" | "disabled";
};

type HermesMessageRow = {
  author_user_id?: string | null;
  body: string;
  channel_id: string;
  created_at: string;
  deleted_at?: string | null;
  hub_users?: {
    avatar_url?: string | null;
    display_name?: string | null;
    email?: string | null;
  } | null;
  id: string;
  metadata?: Record<string, unknown> | null;
};

type HubUserAssignmentRow = {
  department_id?: string | null;
  sector_id?: string | null;
  status: "active" | "archived" | "disabled";
};

type HubUserRow = {
  avatar_url?: string | null;
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

export async function loadHermesOperationalData(input: {
  currentUserId: string;
  userRole?: string;
}): Promise<HermesOperationalData> {
  const client = getHubSupabaseClient();

  if (!client) {
    logSupabaseDiagnostic("pulsex", "client missing", {
      function: "loadHermesOperationalData",
      supabase: getHubSupabaseDiagnostics(),
    });
    return createHermesFallback();
  }

  await runHermesConnectivityProbe();

  await markHubPresence({
    reason: "heartbeat",
    source: "pulsex-load",
    status: "online",
  }).catch((error: unknown) => {
    logHermesDebug("presence heartbeat error", {
      error: serializeThrownError(error),
      supabase: getHubSupabaseDiagnostics(),
    });
  });

  const [
    departmentsLoad,
    sectorsLoad,
    assignmentsLoad,
    channelsLoad,
    usersLoad,
    presenceLoad,
  ] = await Promise.all([
      safeHermesLoad("departments", listDepartments, []),
      safeHermesLoad("sectors", listSectors, []),
      safeHermesLoad(
        "assignments",
        () => listUserAssignments(input.currentUserId),
        [],
      ),
      safeHermesLoad("channels", listHermesChannels, []),
      safeHermesLoad("users", listDirectUsers, []),
      safeHermesLoad("presence", listHubPresence, {}),
    ]);
  const departments = departmentsLoad.data;
  const sectors = sectorsLoad.data;
  const assignments = assignmentsLoad.data;
  const allChannels = channelsLoad.data;
  const users = usersLoad.data.map((user) => ({
    ...user,
    status: presenceLoad.data[user.id] ?? "offline",
  }));
  logHermesDebug("current user", {
    id: input.currentUserId,
  });
  logHermesDebug("current role", input.userRole ?? "unknown");
  const channels = filterChannelsForUser({
    assignments,
    channels: allChannels,
    currentUserId: input.currentUserId,
    userRole: input.userRole,
  });
  const messages = channels.length
    ? (
        await Promise.all(
          channels.map((channel) =>
            listChannelMessages(channel.id).catch((error: unknown) => {
              logHermesDebug("list channel messages error", {
                channelId: channel.id,
                error: serializeThrownError(error),
              });

              return [];
            }),
          ),
        )
      ).flat()
    : [];
  const hasRealStructure =
    departments.length > 0 ||
    sectors.length > 0 ||
    allChannels.length > 0 ||
    users.length > 0;

  if (!hasRealStructure) {
    logHermesDebug("channels count", {
      filtered: channels.length,
      total: allChannels.length,
    });
    if (
      departmentsLoad.failed ||
      sectorsLoad.failed ||
      channelsLoad.failed ||
      usersLoad.failed
    ) {
      throw new Error(
        "Nao foi possivel conectar ao Supabase. Verifique a conexao e tente novamente.",
      );
    }

    return createHermesFallback();
  }

  logHermesDebug("channels count", {
    filtered: channels.length,
    total: allChannels.length,
  });

  return {
    channels,
    departments,
    messages,
    sectors,
    users,
  };
}

export async function listHermesNotificationChannels(input: {
  currentUserId: string;
  userRole?: string;
}): Promise<HermesChannel[]> {
  const client = getHubSupabaseClient();

  if (!client) {
    return [];
  }

  const [assignmentsLoad, channelsLoad] = await Promise.all([
    safeHermesLoad(
      "notification assignments",
      () => listUserAssignments(input.currentUserId),
      [],
    ),
    safeHermesLoad("notification channels", listHermesChannels, []),
  ]);

  return filterChannelsForUser({
    assignments: assignmentsLoad.data,
    channels: channelsLoad.data,
    currentUserId: input.currentUserId,
    userRole: input.userRole,
  }).filter((channel) => channel.kind !== "direct");
}

export async function listDepartments(): Promise<HermesDepartment[]> {
  const client = getHubSupabaseClient();

  if (!client) {
    return [];
  }

  const result = await runHermesQuery<DepartmentRow[]>(
    "list departments",
    "hub_departments",
    client
      .from("hub_departments")
      .select("id,name,slug,status")
      .eq("status", "active")
      .order("name"),
  );

  assertQuery("departamentos", result);

  return ((result as QueryResult<DepartmentRow[]>).data ?? []).map(
    (department) => ({
      id: department.id,
      name: department.name,
      slug: department.slug,
    }),
  );
}

export async function listSectors(): Promise<HermesSector[]> {
  const client = getHubSupabaseClient();

  if (!client) {
    return [];
  }

  const result = await runHermesQuery<SectorRow[]>(
    "list sectors",
    "hub_sectors",
    client
      .from("hub_sectors")
      .select("id,department_id,name,slug,status")
      .eq("status", "active")
      .order("name"),
  );

  assertQuery("setores", result);

  return ((result as QueryResult<SectorRow[]>).data ?? []).map((sector) => ({
    departmentId: sector.department_id,
    id: sector.id,
    name: sector.name,
    slug: sector.slug,
  }));
}

export async function listHermesChannels(): Promise<HermesChannel[]> {
  const client = getHubSupabaseClient();

  if (!client) {
    return [];
  }

  logHermesDebug("list channels start", {
    function: "listHermesChannels",
    supabase: getHubSupabaseDiagnostics(),
    table: "pulsex_channels",
  });

  const result = await runHermesQuery<HermesChannelRow[]>(
    "list channels",
    "pulsex_channels",
    client
      .from("pulsex_channels")
      .select(
        "id,name,description,kind,department_id,sector_id,status,metadata,hub_departments(name,slug),hub_sectors(name,slug),pulsex_channel_members(user_id,last_read_at,status)",
      )
      .eq("status", "active")
      .order("order"),
  );

  if ((result as QueryResult<HermesChannelRow[]>).error) {
    logHermesDebug("list channels error", {
      message: (result as QueryResult<HermesChannelRow[]>).error?.message,
      stack: (result as QueryResult<HermesChannelRow[]>).error?.stack,
      retry: "without members relation",
      supabase: getHubSupabaseDiagnostics(),
    });

    const fallbackResult = await runHermesQuery<HermesChannelRow[]>(
      "list channels fallback without members",
      "pulsex_channels",
      client
        .from("pulsex_channels")
        .select(
          "id,name,description,kind,department_id,sector_id,status,metadata,hub_departments(name,slug),hub_sectors(name,slug)",
        )
        .eq("status", "active")
        .order("order"),
    );

    assertQuery("canais Hermes", fallbackResult);

    const fallbackChannels = (
      (fallbackResult as QueryResult<HermesChannelRow[]>).data ?? []
    )
      .filter((row) => !isDepartmentAnnouncementChannel(row))
      .map(mapChannel);

    logHermesDebug("list channels result", {
      count: fallbackChannels.length,
      withMembers: false,
    });

    return fallbackChannels;
  }

  const channels = ((result as QueryResult<HermesChannelRow[]>).data ?? [])
    .filter((row) => !isDepartmentAnnouncementChannel(row))
    .map(mapChannel);

  logHermesDebug("list channels result", {
    count: channels.length,
    withMembers: true,
  });

  return channels;
}

export async function listDirectUsers(): Promise<HermesPresenceUser[]> {
  const client = getHubSupabaseClient();

  if (!client) {
    return [];
  }

  const result = await runHermesQuery<HubUserRow[]>(
    "list direct users",
    "hub_users",
    client
      .from("hub_users")
      .select(
        "id,email,display_name,avatar_url,role,status,hub_user_assignments(department_id,sector_id,status,hub_departments(name),hub_sectors:hub_sectors!hub_user_assignments_sector_department_fk(name))",
      )
      .eq("status", "active")
      .order("display_name"),
  );

  if ((result as QueryResult<HubUserRow[]>).error) {
    const fallbackResult = await runHermesQuery<HubUserRow[]>(
      "list direct users fallback",
      "hub_users",
      client
        .from("hub_users")
        .select("id,email,display_name,avatar_url,role,status")
        .eq("status", "active")
        .order("display_name"),
    );

    assertQuery("usuarios Hermes", fallbackResult);

    return ((fallbackResult as QueryResult<HubUserRow[]>).data ?? []).map(mapUser);
  }

  assertQuery("usuarios Hermes", result);

  return ((result as QueryResult<HubUserRow[]>).data ?? []).map(mapUser);
}

export async function listChannelMessages(
  channelId: HermesChannel["id"],
): Promise<HermesMessage[]> {
  const client = getHubSupabaseClient();

  if (!client || channelId.startsWith("direct-")) {
    return [];
  }

  const apiMessages = await listChannelMessagesViaApi(client, channelId);

  if (apiMessages) {
    return apiMessages;
  }

  const result = await runHermesQuery<HermesMessageRow[]>(
    "list channel messages",
    "pulsex_messages",
    client
      .from("pulsex_messages")
      .select("id,channel_id,author_user_id,body,metadata,created_at,deleted_at,hub_users(display_name,avatar_url,email)")
      .eq("channel_id", channelId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
  );

  assertQuery("mensagens Hermes", result);

  return mapChannelMessages(
    (result as QueryResult<HermesMessageRow[]>).data ?? [],
  );
}

export async function createHermesMessage(input: {
  attachment?: HermesMessageAttachment;
  authorUserId?: string;
  body: string;
  channelId: string;
  clientMessageId?: string;
  mentionUserIds?: readonly string[];
  mentions?: readonly HermesMessageMention[];
  tags?: readonly HermesMessageTag[];
  threadParentMessageId?: HermesMessage["id"];
}): Promise<HermesMessage> {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Supabase nao configurado.");
  }

  const apiMessage = await createHermesMessageViaApi(client, input);

  if (apiMessage) {
    return apiMessage;
  }

  const tags = normalizeHermesMessageTags(input.tags);
  const result = await runHermesQuery<HermesMessageRow>(
    "create message",
    "pulsex_messages",
    client
      .from("pulsex_messages")
      .insert({
        author_user_id: input.authorUserId,
        body: input.body,
        channel_id: input.channelId,
        metadata: {
          ...(input.attachment ? { attachment: input.attachment } : {}),
          ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
          mentionUserIds: input.mentionUserIds ?? [],
          mentions: input.mentions ?? [],
          tags,
          ...(input.threadParentMessageId
            ? { threadParentMessageId: input.threadParentMessageId }
            : {}),
        },
      })
      .select("id,channel_id,author_user_id,body,metadata,created_at,deleted_at,hub_users(display_name,avatar_url,email)")
      .single(),
  );

  assertQuery("enviar mensagem", result);

  return mapMessage((result as QueryResult<HermesMessageRow>).data);
}

export async function listHermesThreadReplies(input: {
  messageId: HermesMessage["id"];
}): Promise<HermesThreadReply[]> {
  const client = getHubSupabaseClient();

  if (!client || input.messageId.startsWith("local-")) {
    return [];
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (!sessionResult.error && accessToken) {
    const response = await fetch(
      `/api/hermes/messages?threadParentMessageId=${encodeURIComponent(input.messageId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    const payload = (await response.json().catch(() => null)) as
      | { data?: HermesMessageRow[]; error?: string }
      | null;

    if (response.ok && payload?.data && payload.data.length > 0) {
      return payload.data.map(mapThreadReply);
    }
  }

  const result = await runHermesQuery<HermesMessageRow[]>(
    "list thread replies",
    "pulsex_messages",
    client
      .from("pulsex_messages")
      .select("id,channel_id,author_user_id,body,metadata,created_at,deleted_at,hub_users(display_name,avatar_url,email)")
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
  );

  assertQuery("respostas Hermes", result);

  return ((result as QueryResult<HermesMessageRow[]>).data ?? [])
    .filter(
      (message) =>
        getString(getMessageMetadata(message.metadata).threadParentMessageId) ===
        input.messageId,
    )
    .map(mapThreadReply);
}

export async function createHermesThreadReply(input: {
  authorUserId?: string;
  body: string;
  channelId: HermesChannel["id"];
  messageId: HermesMessage["id"];
}): Promise<HermesThreadReply> {
  const message = await createHermesMessage({
    authorUserId: input.authorUserId,
    body: input.body,
    channelId: input.channelId,
    threadParentMessageId: input.messageId,
  });

  return mapThreadReplyFromMessage(message, input.messageId);
}

export async function updateHermesMessageTags(input: {
  messageId: HermesMessage["id"];
  tags: readonly HermesMessageTag[];
}): Promise<HermesMessage | null> {
  const client = getHubSupabaseClient();

  if (!client || input.messageId.startsWith("local-")) {
    return null;
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    return null;
  }

  const response = await fetch("/api/hermes/messages", {
    body: JSON.stringify({
      messageId: input.messageId,
      tags: input.tags,
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: HermesMessageRow; error?: string }
    | null;

  if (!response.ok || !payload?.data) {
    return null;
  }

  return mapMessage(payload.data);
}

export async function updateHermesMessageBody(input: {
  body: string;
  messageId: HermesMessage["id"];
}): Promise<HermesMessage | null> {
  const client = getHubSupabaseClient();

  if (!client || input.messageId.startsWith("local-")) {
    return null;
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    return null;
  }

  const response = await fetch("/api/hermes/messages", {
    body: JSON.stringify({
      action: "edit-message",
      body: input.body,
      messageId: input.messageId,
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: HermesMessageRow; error?: string }
    | null;

  if (!response.ok || !payload?.data) {
    return null;
  }

  return mapMessage(payload.data);
}

export async function markHermesChannelRead(input: {
  channelId: HermesChannel["id"];
}): Promise<{ channelId: string; lastReadAt: string; userId: string } | null> {
  const client = getHubSupabaseClient();

  if (!client || input.channelId.startsWith("direct-")) {
    return null;
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    return null;
  }

  const response = await fetch("/api/hermes/messages", {
    body: JSON.stringify({
      action: "mark-read",
      channelId: input.channelId,
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  const payload = (await response.json().catch(() => null)) as
    | {
        data?: {
          channelId: string;
          lastReadAt: string;
          userId: string;
        };
        error?: string;
      }
    | null;

  if (!response.ok || !payload?.data) {
    return null;
  }

  return payload.data;
}

async function listChannelMessagesViaApi(
  client: NonNullable<ReturnType<typeof getHubSupabaseClient>>,
  channelId: HermesChannel["id"],
) {
  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    return null;
  }

  const response = await fetch(
    `/api/hermes/messages?channelId=${encodeURIComponent(channelId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | { data?: HermesMessageRow[]; error?: string }
    | null;

  if (!response.ok || !payload?.data) {
    return null;
  }

  return mapChannelMessages(payload.data);
}

async function createHermesMessageViaApi(
  client: NonNullable<ReturnType<typeof getHubSupabaseClient>>,
  input: {
    attachment?: HermesMessageAttachment;
    body: string;
    channelId: string;
    clientMessageId?: string;
    mentionUserIds?: readonly string[];
    mentions?: readonly HermesMessageMention[];
    tags?: readonly HermesMessageTag[];
    threadParentMessageId?: HermesMessage["id"];
  },
) {
  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    return null;
  }

  const response = await fetch("/api/hermes/messages", {
    body: JSON.stringify({
      body: input.body,
      channelId: input.channelId,
      attachment: input.attachment,
      clientMessageId: input.clientMessageId,
      mentionUserIds: input.mentionUserIds ?? [],
      mentions: input.mentions ?? [],
      tags: input.tags ?? [],
      threadParentMessageId: input.threadParentMessageId,
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: HermesMessageRow; error?: string }
    | null;

  if (!response.ok || !payload?.data) {
    return null;
  }

  return mapMessage(payload.data);
}

async function listUserAssignments(
  userId: string,
): Promise<HubUserAssignmentRow[]> {
  const client = getHubSupabaseClient();

  if (!client) {
    return [];
  }

  const result = await runHermesQuery<HubUserAssignmentRow[]>(
    "list user assignments",
    "hub_user_assignments",
    client
      .from("hub_user_assignments")
      .select("department_id,sector_id,status")
      .eq("user_id", userId)
      .eq("status", "active"),
  );

  assertQuery("vinculos Hermes", result);

  return (result as QueryResult<HubUserAssignmentRow[]>).data ?? [];
}

function filterChannelsForUser({
  assignments,
  channels,
  currentUserId,
  userRole,
}: {
  assignments: readonly HubUserAssignmentRow[];
  channels: readonly HermesChannel[];
  currentUserId: string;
  userRole?: string;
}) {
  const isAdmin = userRole === "admin" || userRole === "adm";

  logHermesDebug("filters applied", {
    assignments: assignments.length,
    channels: channels.length,
    currentUserId,
    isAdmin,
    userRole: userRole ?? "unknown",
  });

  return channels.filter((channel) =>
    channel.memberUserIds?.includes(currentUserId),
  );
}

function mapChannel(row: HermesChannelRow): HermesChannel {
  const unit = row.hub_sectors?.name ?? row.hub_departments?.name ?? "Hermes";
  const kind = mapChannelKind(row.kind, row.hub_departments?.name);
  const members =
    row.pulsex_channel_members?.filter(
      (member) => !member.status || member.status === "active",
    ) ?? [];
  const memberUserIds = members.map((member) => member.user_id);
  const memberReadAtByUserId = Object.fromEntries(
    members
      .filter((member) => Boolean(member.last_read_at))
      .map((member) => [member.user_id, member.last_read_at as string]),
  );

  return {
    accessType: mapChannelAccessType(row.kind),
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
    memberReadAtByUserId,
    memberUserIds,
    name: row.name,
    preview: row.description ?? "Canal operacional",
    sectorId: row.sector_id ?? undefined,
    sectorName: row.hub_sectors?.name,
    status: "offline",
  };
}

function isDepartmentAnnouncementChannel(row: HermesChannelRow) {
  return (
    row.kind === "department" &&
    getRecord(row.metadata).systemRole === "department_announcements"
  );
}

function mapChannelAccessType(
  kind: HermesChannelRow["kind"],
): HermesChannel["accessType"] {
  if (kind === "sector") {
    return "sector_channel";
  }

  if (kind === "department") {
    return "department_channel";
  }

  return "private_group";
}

function mapUser(row: HubUserRow): HermesPresenceUser {
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
    avatarUrl: row.avatar_url ?? undefined,
    channelIds: [],
    departmentId: primaryAssignment?.department_id ?? undefined,
    departmentName: primaryAssignment?.hub_departments?.name ?? undefined,
    email: row.email,
    id: row.id,
    initials: getInitials(row.display_name),
    label: row.display_name,
    role,
    sectorId: primaryAssignment?.sector_id ?? undefined,
    sectorName: primaryAssignment?.hub_sectors?.name ?? undefined,
    status: "offline",
    username: row.email.split("@")[0],
  };
}

function mapChannelMessages(rows: readonly HermesMessageRow[]): HermesMessage[] {
  const messages = rows.map(mapMessage);
  const replyCountByMessageId = new Map<string, number>();

  for (const message of messages) {
    if (!message.threadParentMessageId) {
      continue;
    }

    replyCountByMessageId.set(
      message.threadParentMessageId,
      (replyCountByMessageId.get(message.threadParentMessageId) ?? 0) + 1,
    );
  }

  return messages
    .filter((message) => !message.threadParentMessageId)
    .map((message) => ({
      ...message,
      threadCount:
        (message.threadCount ?? 0) + (replyCountByMessageId.get(message.id) ?? 0),
    }));
}

function mapMessage(row: HermesMessageRow | null): HermesMessage {
  if (!row) {
    throw new Error("Mensagem inexistente.");
  }

  const metadata = getMessageMetadata(row.metadata);
  const attachment = normalizeMessageAttachment(metadata.attachment);
  const mentions = normalizeMessageMentions(metadata.mentions);
  const mentionUserIds =
    normalizeStringList(metadata.mentionUserIds) ??
    mentions.map((mention) => mention.userId);

  return {
    authorAvatarUrl: row.hub_users?.avatar_url ?? undefined,
    authorId: row.author_user_id ?? "system",
    authorName:
      row.hub_users?.display_name ??
      row.hub_users?.email?.split("@")[0] ??
      undefined,
    attachment,
    body: row.body,
    channelId: row.channel_id,
    clientMessageId: getString(metadata.clientMessageId) || undefined,
    createdAt: row.created_at,
    deletedAt: row.deleted_at ?? undefined,
    editedAt: getString(metadata.editedAt) || undefined,
    id: row.id,
    mentionUserIds,
    mentions,
    reactions: [],
    status: "neutral",
    tags: normalizeHermesMessageTags(metadata.tags),
    threadParentMessageId: getString(metadata.threadParentMessageId) || undefined,
    threadCount: 0,
    timestamp: formatMessageTime(row.created_at),
  };
}

function mapThreadReply(row: HermesMessageRow): HermesThreadReply {
  const message = mapMessage(row);
  const parentMessageId = message.threadParentMessageId;

  if (!parentMessageId) {
    throw new Error("Resposta Hermes sem mensagem principal.");
  }

  return mapThreadReplyFromMessage(message, parentMessageId);
}

function mapThreadReplyFromMessage(
  message: HermesMessage,
  parentMessageId: HermesMessage["id"],
): HermesThreadReply {
  return {
    authorAvatarUrl: message.authorAvatarUrl,
    authorId: message.authorId,
    authorName: message.authorName,
    body: message.body,
    createdAt: message.createdAt,
    id: message.id,
    messageId: parentMessageId,
    timestamp: message.timestamp,
  };
}

function getMessageMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeMessageAttachment(
  value: unknown,
): HermesMessageAttachment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const maybeAttachment = value as Record<string, unknown>;
  const label = getString(maybeAttachment.label);
  const type = getString(maybeAttachment.type);

  if (!label || !isMessageAttachmentType(type)) {
    return undefined;
  }

  return {
    durationSeconds: getPositiveNumber(maybeAttachment.durationSeconds),
    label,
    mimeType: getString(maybeAttachment.mimeType) || undefined,
    sizeBytes: getPositiveNumber(maybeAttachment.sizeBytes),
    type,
    url: getString(maybeAttachment.url) || undefined,
  };
}

function normalizeMessageMentions(value: unknown): HermesMessageMention[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((mention) => {
      if (!mention || typeof mention !== "object") {
        return null;
      }

      const maybeMention = mention as Record<string, unknown>;
      const displayName = getString(maybeMention.displayName);
      const trigger = getString(maybeMention.trigger);
      const userId = getString(maybeMention.userId);

      if (!displayName || !trigger || !userId) {
        return null;
      }

      return {
        displayName,
        trigger,
        userId,
      };
    })
    .filter((mention): mention is HermesMessageMention => Boolean(mention));
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  return [...new Set(value.filter((item): item is string => typeof item === "string"))];
}

function isMessageAttachmentType(
  value: string,
): value is HermesMessageAttachment["type"] {
  return ["audio", "file", "image", "video"].includes(value);
}

function getPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function assertQuery(label: string, result: unknown): asserts result is QueryResult<unknown> {
  const queryResult = result as QueryResult<unknown>;

  if (queryResult.error) {
    logHermesDebug("list channels error", {
      label,
      message: queryResult.error.message,
      name: queryResult.error.name,
      stack: queryResult.error.stack,
      supabase: getHubSupabaseDiagnostics(),
    });
    throw new Error(`Nao foi possivel carregar ${label}: ${queryResult.error.message}`);
  }
}

async function runHermesQuery<Result>(
  label: string,
  table: string,
  query: PromiseLike<unknown>,
): Promise<QueryResult<Result>> {
  logSupabaseDiagnostic("pulsex", `${label} start`, {
    function: `pulsex.${label}`,
    supabase: getHubSupabaseDiagnostics(),
    table,
  });

  try {
    const result = (await query) as QueryResult<Result>;

    if (result.error) {
      logSupabaseDiagnostic("pulsex", `${label} error`, {
        error: serializeDiagnosticError(result.error),
        function: `pulsex.${label}`,
        supabase: getHubSupabaseDiagnostics(),
        table,
      });
      return result;
    }

    logSupabaseDiagnostic("pulsex", `${label} result`, {
      function: `pulsex.${label}`,
      rowCount: Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0,
      table,
    });

    return result;
  } catch (error) {
    const result = {
      data: null,
      error: serializeThrownError(error),
    } satisfies QueryResult<Result>;

    logSupabaseDiagnostic("pulsex", `${label} error`, {
      error: result.error,
      function: `pulsex.${label}`,
      supabase: getHubSupabaseDiagnostics(),
      table,
    });

    return result;
  }
}

async function safeHermesLoad<Result>(
  label: string,
  loader: () => Promise<Result>,
  fallback: Result,
) {
  try {
    return {
      data: await loader(),
      failed: false,
    };
  } catch (error) {
    logHermesDebug(`${label} error`, {
      error: serializeThrownError(error),
      supabase: getHubSupabaseDiagnostics(),
    });

    return {
      data: fallback,
      failed: true,
    };
  }
}

async function runHermesConnectivityProbe() {
  if (!isLocalDevelopmentRuntime()) {
    return;
  }

  const client = getHubSupabaseClient();

  if (!client) {
    logHermesDebug("connectivity probe", {
      client: "missing",
      supabase: getHubSupabaseDiagnostics(),
    });
    return;
  }

  const probes = [
    {
      label: "probe hub_departments",
      query: client.from("hub_departments").select("id").limit(1),
    },
    {
      label: "probe hub_sectors",
      query: client.from("hub_sectors").select("id").limit(1),
    },
    {
      label: "probe pulsex_channels",
      query: client.from("pulsex_channels").select("id").limit(1),
    },
  ];

  await Promise.all(
    probes.map(async (probe) => {
      try {
        const result = (await probe.query) as QueryResult<unknown[]>;

        if (result.error) {
          logHermesDebug(`${probe.label} error`, {
            error: result.error,
            supabase: getHubSupabaseDiagnostics(),
          });
          return;
        }

        logHermesDebug(`${probe.label} result`, {
          rowCount: result.data?.length ?? 0,
        });
      } catch (error) {
        logHermesDebug(`${probe.label} error`, {
          error: serializeThrownError(error),
          supabase: getHubSupabaseDiagnostics(),
        });
      }
    }),
  );
}

function serializeThrownError(error: unknown) {
  return serializeDiagnosticError(error);
}

function logHermesDebug(event: string, detail?: unknown) {
  if (!isLocalDevelopmentRuntime()) {
    return;
  }

  console.debug(`[pulsex] ${event}`, detail ?? "");
}

function isLocalDevelopmentRuntime() {
  if (typeof globalThis.location === "undefined") {
    return false;
  }

  return ["localhost", "127.0.0.1"].includes(globalThis.location.hostname);
}

function createHermesFallback(): HermesOperationalData {
  return {
    channels: [],
    departments: [],
    messages: [],
    sectors: [],
    users: [],
  };
}

function mapChannelKind(
  kind: HermesChannelRow["kind"],
  departmentName?: string,
): HermesChannel["kind"] {
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
