"use client";

import {
  getHubSupabaseClient,
  getHubSupabaseDiagnostics,
  logSupabaseDiagnostic,
  serializeDiagnosticError,
} from "@/lib/supabase/client";
import {
  listHubPresence,
} from "@/lib/hub-presence";
import type {
  HermesChannel,
  HermesDepartment,
  HermesMessage,
  HermesMessageAttachment,
  HermesMessageMention,
  HermesMessageTag,
  HermesPresenceUser,
  HermesReaction,
  HermesReactionEmoji,
  HermesSector,
  HermesThreadReply,
} from "./types";
import { normalizeHermesMessageTags } from "./message-tags";
import { isHermesDirectChannelId } from "./direct-channel";
import { fetchHermesMessagesApi } from "./messages-api-client";
import { getHermesMessagesApiUrl } from "./routes";

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

const HERMES_MESSAGES_PAGE_SIZE = 50;

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
  const messages: HermesMessage[] = [];
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

  if (!client) {
    return [];
  }

  const apiMessages = await listChannelMessagesViaApi(client, channelId);

  if (apiMessages) {
    return apiMessages;
  }

  if (isHermesDirectChannelId(channelId)) {
    return [];
  }

  const result = await runHermesQuery<HermesMessageRow[]>(
    "list channel messages",
    "pulsex_messages",
    client
      .from("pulsex_messages")
      .select("id,channel_id,author_user_id,body,metadata,created_at,deleted_at,hub_users(display_name,avatar_url,email)")
      .eq("channel_id", channelId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(HERMES_MESSAGES_PAGE_SIZE),
  );

  assertQuery("mensagens Hermes", result);

  return mapChannelMessages(
    [...((result as QueryResult<HermesMessageRow[]>).data ?? [])].reverse(),
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

  if (isHermesDirectChannelId(input.channelId)) {
    throw new Error("Nao foi possivel enviar a mensagem direta.");
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

  const apiResult = await fetchHermesMessagesApi<{
    data?: HermesMessageRow[];
    error?: string;
  }>({
    client,
    url: `${getHermesMessagesApiUrl({
      threadParentMessageId: input.messageId,
    })}&limit=${HERMES_MESSAGES_PAGE_SIZE}`,
  });

  if (apiResult) {
    if (apiResult.response.ok && apiResult.payload?.data) {
      return apiResult.payload.data.map(mapThreadReply);
    }
  }

  const result = await runHermesQuery<HermesMessageRow[]>(
    "list thread replies",
    "pulsex_messages",
    client
      .from("pulsex_messages")
      .select("id,channel_id,author_user_id,body,metadata,created_at,deleted_at,hub_users(display_name,avatar_url,email)")
      .contains("metadata", { threadParentMessageId: input.messageId })
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(HERMES_MESSAGES_PAGE_SIZE),
  );

  assertQuery("respostas Hermes", result);

  return ((result as QueryResult<HermesMessageRow[]>).data ?? []).map(
    mapThreadReply,
  );
}

export async function createHermesThreadReply(input: {
  attachment?: HermesMessageAttachment;
  authorUserId?: string;
  body: string;
  channelId: HermesChannel["id"];
  mentionUserIds?: readonly string[];
  mentions?: readonly HermesMessageMention[];
  messageId: HermesMessage["id"];
}): Promise<HermesThreadReply> {
  const message = await createHermesMessage({
    attachment: input.attachment,
    authorUserId: input.authorUserId,
    body: input.body,
    channelId: input.channelId,
    mentionUserIds: input.mentionUserIds,
    mentions: input.mentions,
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

  const apiResult = await fetchHermesMessagesApi<{
    data?: HermesMessageRow;
    error?: string;
  }>({
    body: {
      messageId: input.messageId,
      tags: input.tags,
    },
    client,
    method: "PATCH",
  });

  if (!apiResult?.response.ok || !apiResult.payload?.data) {
    return null;
  }

  return mapMessage(apiResult.payload.data);
}

export async function updateHermesMessageReaction(input: {
  emoji: HermesReactionEmoji;
  messageId: HermesMessage["id"];
}): Promise<HermesMessage | null> {
  const client = getHubSupabaseClient();

  if (!client || input.messageId.startsWith("local-")) {
    return null;
  }

  const apiResult = await fetchHermesMessagesApi<{
    data?: HermesMessageRow;
    error?: string;
  }>({
    body: {
      action: "toggle-reaction",
      emoji: input.emoji,
      messageId: input.messageId,
    },
    client,
    method: "PATCH",
  });

  if (!apiResult?.response.ok || !apiResult.payload?.data) {
    return null;
  }

  return mapMessage(apiResult.payload.data);
}

export async function updateHermesMessageBody(input: {
  body: string;
  messageId: HermesMessage["id"];
}): Promise<HermesMessage | null> {
  const client = getHubSupabaseClient();

  if (!client || input.messageId.startsWith("local-")) {
    return null;
  }

  const apiResult = await fetchHermesMessagesApi<{
    data?: HermesMessageRow;
    error?: string;
  }>({
    body: {
      action: "edit-message",
      body: input.body,
      messageId: input.messageId,
    },
    client,
    method: "PATCH",
  });

  if (!apiResult?.response.ok || !apiResult.payload?.data) {
    return null;
  }

  return mapMessage(apiResult.payload.data);
}

export async function markHermesChannelRead(input: {
  channelId: HermesChannel["id"];
}): Promise<{ channelId: string; lastReadAt: string; userId: string } | null> {
  const client = getHubSupabaseClient();

  if (!client) {
    return null;
  }

  const apiResult = await fetchHermesMessagesApi<{
    data?: {
      channelId: string;
      lastReadAt: string;
      userId: string;
    };
    error?: string;
  }>({
    body: {
      action: "mark-read",
      channelId: input.channelId,
    },
    client,
    method: "PATCH",
  });

  if (!apiResult?.response.ok || !apiResult.payload?.data) {
    return null;
  }

  return apiResult.payload.data;
}

async function listChannelMessagesViaApi(
  client: NonNullable<ReturnType<typeof getHubSupabaseClient>>,
  channelId: HermesChannel["id"],
) {
  const apiResult = await fetchHermesMessagesApi<{
    data?: HermesMessageRow[];
    error?: string;
  }>({
    client,
    url: `${getHermesMessagesApiUrl({
      channelId,
    })}&limit=${HERMES_MESSAGES_PAGE_SIZE}`,
  });

  if (!apiResult?.response.ok || !apiResult.payload?.data) {
    return null;
  }

  return mapChannelMessages(apiResult.payload.data);
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
  const apiResult = await fetchHermesMessagesApi<{
    data?: HermesMessageRow;
    error?: string;
  }>({
    body: {
      body: input.body,
      channelId: input.channelId,
      attachment: input.attachment,
      clientMessageId: input.clientMessageId,
      mentionUserIds: input.mentionUserIds ?? [],
      mentions: input.mentions ?? [],
      tags: input.tags ?? [],
      threadParentMessageId: input.threadParentMessageId,
    },
    client,
    method: "POST",
  });

  if (!apiResult?.response.ok || !apiResult.payload?.data) {
    return null;
  }

  return mapMessage(apiResult.payload.data);
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
  const replyActivityByMessageId = new Map<
    string,
    { count: number; latestCreatedAt?: string }
  >();

  for (const message of messages) {
    if (!message.threadParentMessageId) {
      continue;
    }

    const currentActivity = replyActivityByMessageId.get(
      message.threadParentMessageId,
    );
    const latestCreatedAt = getLatestHermesDateValue(
      currentActivity?.latestCreatedAt,
      message.createdAt,
    );

    replyActivityByMessageId.set(message.threadParentMessageId, {
      count: (currentActivity?.count ?? 0) + 1,
      latestCreatedAt,
    });
  }

  return messages
    .filter((message) => !message.threadParentMessageId)
    .map((message) => {
      const replyActivity = replyActivityByMessageId.get(message.id);

      return {
        ...message,
        lastThreadReplyAt:
          replyActivity?.latestCreatedAt ?? message.lastThreadReplyAt,
        threadCount: (message.threadCount ?? 0) + (replyActivity?.count ?? 0),
      };
    });
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
    reactions: normalizeHermesReactions(metadata.reactions),
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
    attachment: message.attachment,
    authorAvatarUrl: message.authorAvatarUrl,
    authorId: message.authorId,
    authorName: message.authorName,
    body: message.body,
    channelId: message.channelId,
    createdAt: message.createdAt,
    id: message.id,
    mentionUserIds: message.mentionUserIds,
    mentions: message.mentions,
    messageId: parentMessageId,
    reactions: message.reactions,
    tags: message.tags,
    timestamp: message.timestamp,
  };
}

function getLatestHermesDateValue(
  currentValue: string | undefined,
  nextValue: string | undefined,
) {
  if (!nextValue) {
    return currentValue;
  }

  if (!currentValue) {
    return nextValue;
  }

  const currentTime = Date.parse(currentValue);
  const nextTime = Date.parse(nextValue);

  if (Number.isNaN(currentTime)) {
    return nextValue;
  }

  if (Number.isNaN(nextTime)) {
    return currentValue;
  }

  return nextTime > currentTime ? nextValue : currentValue;
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
    emoji: getString(maybeAttachment.emoji) || undefined,
    label,
    mimeType: getString(maybeAttachment.mimeType) || undefined,
    sizeBytes: getPositiveNumber(maybeAttachment.sizeBytes),
    stickerId: getString(maybeAttachment.stickerId) || undefined,
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

function normalizeHermesReactions(value: unknown): HermesReaction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const reactions: HermesReaction[] = [];

  for (const reaction of value) {
    if (!reaction || typeof reaction !== "object" || Array.isArray(reaction)) {
      continue;
    }

    const maybeReaction = reaction as Record<string, unknown>;
    const emoji = getString(maybeReaction.emoji);
    const reactedByUserIds =
      normalizeStringList(maybeReaction.reactedByUserIds) ?? [];

    if (!emoji || reactedByUserIds.length === 0) {
      continue;
    }

    reactions.push({
      count: reactedByUserIds.length,
      emoji,
      reactedByUserIds,
    });
  }

  return reactions;
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
  return ["audio", "file", "image", "sticker", "video"].includes(value);
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
