import { normalizeHermesMessageTags } from "@/lib/pulsex/message-tags";
import {
  compactHermesMessageMetadata,
  compactHermesMessageRow,
  compactHermesMessageRows,
} from "@/lib/pulsex/message-metadata";
import {
  getHermesDirectPeerUserId,
  parseHermesDirectChannelId,
} from "@/lib/pulsex/direct-channel";
import { sendHermesMessagePush } from "@/lib/pulsex/push";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import { createClient } from "@supabase/supabase-js";
import { after, NextResponse, type NextRequest } from "next/server";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

type HubUserAccessRow = {
  avatar_url?: string | null;
  display_name?: string | null;
  email?: string | null;
  id: string;
  role: HubUserRole;
  status: string;
};

type HermesChannelAccessRow = {
  department_id?: string | null;
  id: string;
  kind: "department" | "direct" | "sector" | "system";
  status: string;
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

type MessagePayload = {
  attachment?: unknown;
  body?: unknown;
  channelId?: unknown;
  clientMessageId?: unknown;
  mentionUserIds?: unknown;
  mentions?: unknown;
  tags?: unknown;
  threadParentMessageId?: unknown;
};

type MessageAttachment = {
  durationSeconds?: number;
  emoji?: string;
  label: string;
  mimeType?: string;
  sizeBytes?: number;
  stickerId?: string;
  type: "audio" | "file" | "image" | "sticker" | "video";
  url?: string;
};

type HermesReaction = {
  count: number;
  emoji: string;
  reactedByUserIds: string[];
};

type UpdateTagsPayload = {
  action?: unknown;
  channelId?: unknown;
  emoji?: unknown;
  messageId?: unknown;
  tags?: unknown;
};

type HermesMessagesApiDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: HubUserAccessRow & {
          avatar_url?: string | null;
          display_name?: string | null;
          email?: string | null;
        };
        Update: never;
      };
      pulsex_channel_members: {
        Insert: {
          channel_id: string;
          last_read_at?: string | null;
          role?: string;
          status?: string;
          user_id: string;
        };
        Relationships: [];
        Row: {
          channel_id: string;
          last_read_at?: string | null;
          status: string;
          user_id: string;
        };
        Update: {
          last_read_at?: string;
          status?: string;
        };
      };
      pulsex_channels: {
        Insert: {
          created_by_user_id?: string | null;
          department_id?: string | null;
          description?: string | null;
          id: string;
          kind?: "department" | "direct" | "sector" | "system";
          metadata?: Record<string, unknown>;
          name: string;
          order?: number;
          sector_id?: string | null;
          status?: string;
        };
        Relationships: [];
        Row: HermesChannelAccessRow & {
          created_by_user_id?: string | null;
          description?: string | null;
          metadata?: Record<string, unknown> | null;
          name?: string;
          order?: number;
          sector_id?: string | null;
        };
        Update: {
          metadata?: Record<string, unknown>;
          name?: string;
          status?: string;
        };
      };
      pulsex_messages: {
        Insert: {
          author_user_id?: string | null;
          body: string;
          channel_id: string;
          metadata?: Record<string, unknown>;
        };
        Relationships: [
          {
            columns: ["author_user_id"];
            foreignKeyName: "pulsex_messages_author_user_id_fkey";
            isOneToOne: false;
            referencedColumns: ["id"];
            referencedRelation: "hub_users";
          },
        ];
        Row: HermesMessageRow;
        Update: {
          body?: string;
          metadata?: Record<string, unknown>;
        };
      };
    };
    Views: Record<string, never>;
  };
};

type SupabaseAdminClient = ReturnType<
  typeof createClient<HermesMessagesApiDatabase>
>;

type AuthorizedContext =
  | {
      adminClient: SupabaseAdminClient;
      ok: true;
      user: HubUserAccessRow;
    }
  | { ok: false; response: NextResponse };

const HERMES_MESSAGES_DEFAULT_LIMIT = 50;
const HERMES_MESSAGES_MAX_LIMIT = 200;
const HERMES_MESSAGE_SELECT =
  "id,channel_id,author_user_id,body,metadata,created_at,deleted_at,hub_users(display_name,avatar_url,email)";

type MessagePageOptions = {
  after?: string;
  before?: string;
  limit: number;
};

export async function GET(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  const threadParentMessageId =
    request.nextUrl.searchParams.get("threadParentMessageId")?.trim() ?? "";
  const channelId = request.nextUrl.searchParams.get("channelId")?.trim();
  const channelIds = parseChannelIds(
    request.nextUrl.searchParams.get("channelIds"),
  );
  const pageOptions = parseMessagePageOptions(request.nextUrl.searchParams);

  if (threadParentMessageId) {
    const { data: parentMessage, error: parentError } = await context.adminClient
      .from("pulsex_messages")
      .select("id,channel_id")
      .eq("id", threadParentMessageId)
      .is("deleted_at", null)
      .maybeSingle<{ channel_id: string; id: string }>();

    if (parentError || !parentMessage) {
      return NextResponse.json({ error: "Mensagem nao encontrada." }, { status: 404 });
    }

    const access = await ensureChannelAccess(
      context.adminClient,
      context.user,
      parentMessage.channel_id,
    );

    if (!access.ok) {
      return access.response;
    }

    let query = context.adminClient
      .from("pulsex_messages")
      .select(HERMES_MESSAGE_SELECT)
      .eq("channel_id", parentMessage.channel_id)
      .contains("metadata", { threadParentMessageId })
      .is("deleted_at", null)
      .limit(pageOptions.limit);

    if (pageOptions.after) {
      query = query
        .gt("created_at", pageOptions.after)
        .order("created_at", { ascending: true });
    } else {
      if (pageOptions.before) {
        query = query.lt("created_at", pageOptions.before);
      }

      query = query.order("created_at", { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Nao foi possivel carregar respostas." },
        { status: 500 },
      );
    }

    const rows = pageOptions.after ? (data ?? []) : [...(data ?? [])].reverse();

    return NextResponse.json({
      data: compactHermesMessageRows(rows),
      page: createMessagesPageMetadata(rows, pageOptions),
    });
  }

  if (channelIds.length > 0) {
    const accessibleChannelIds: string[] = [];

    for (const requestedChannelId of channelIds) {
      const access = await ensureChannelAccess(
        context.adminClient,
        context.user,
        requestedChannelId,
      );

      if (access.ok) {
        accessibleChannelIds.push(requestedChannelId);
      }
    }

    if (accessibleChannelIds.length === 0) {
      return NextResponse.json({
        data: [],
        page: createMessagesPageMetadata([], pageOptions),
      });
    }

    let query = context.adminClient
      .from("pulsex_messages")
      .select(HERMES_MESSAGE_SELECT)
      .in("channel_id", accessibleChannelIds)
      .is("deleted_at", null)
      .limit(pageOptions.limit);

    if (pageOptions.after) {
      query = query
        .gt("created_at", pageOptions.after)
        .order("created_at", { ascending: true });
    } else {
      if (pageOptions.before) {
        query = query.lt("created_at", pageOptions.before);
      }

      query = query.order("created_at", { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Nao foi possivel carregar mensagens recentes." },
        { status: 500 },
      );
    }

    const rows = pageOptions.after ? (data ?? []) : [...(data ?? [])].reverse();

    return NextResponse.json({
      data: compactHermesMessageRows(rows),
      page: createMessagesPageMetadata(rows, pageOptions),
    });
  }

  if (!channelId) {
    return NextResponse.json({ error: "Informe o canal." }, { status: 400 });
  }

  const access = await ensureChannelAccess(context.adminClient, context.user, channelId);

  if (!access.ok) {
    return access.response;
  }

  let query = context.adminClient
    .from("pulsex_messages")
    .select(HERMES_MESSAGE_SELECT)
    .eq("channel_id", channelId)
    .is("deleted_at", null)
    .limit(pageOptions.limit);

  if (pageOptions.after) {
    query = query
      .gt("created_at", pageOptions.after)
      .order("created_at", { ascending: true });
  } else {
    if (pageOptions.before) {
      query = query.lt("created_at", pageOptions.before);
    }

    query = query.order("created_at", { ascending: false });
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel carregar mensagens." },
      { status: 500 },
    );
  }

  const rows = pageOptions.after ? (data ?? []) : [...(data ?? [])].reverse();

  return NextResponse.json({
    data: compactHermesMessageRows(rows),
    page: createMessagesPageMetadata(rows, pageOptions),
  });
}

export async function POST(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  const payload = parseMessagePayload(await request.json().catch(() => null));

  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  const access = await ensureChannelAccess(
    context.adminClient,
    context.user,
    payload.data.channelId,
  );

  if (!access.ok) {
    return access.response;
  }

  if (payload.data.threadParentMessageId) {
    const { data: parentMessage, error: parentError } = await context.adminClient
      .from("pulsex_messages")
      .select("id,channel_id")
      .eq("id", payload.data.threadParentMessageId)
      .eq("channel_id", payload.data.channelId)
      .is("deleted_at", null)
      .maybeSingle<{ channel_id: string; id: string }>();

    if (parentError || !parentMessage) {
      return NextResponse.json({ error: "Mensagem principal invalida." }, { status: 400 });
    }
  }

  const metadata =
    compactHermesMessageMetadata({
      ...(payload.data.attachment ? { attachment: payload.data.attachment } : {}),
      ...(payload.data.clientMessageId
        ? { clientMessageId: payload.data.clientMessageId }
        : {}),
      mentionUserIds: payload.data.mentionUserIds,
      mentions: payload.data.mentions,
      tags: payload.data.tags,
      ...(payload.data.threadParentMessageId
        ? { threadParentMessageId: payload.data.threadParentMessageId }
        : {}),
    }) ?? {};

  const { data, error } = await context.adminClient
    .from("pulsex_messages")
    .insert({
      author_user_id: context.user.id,
      body: payload.data.body,
      channel_id: payload.data.channelId,
      metadata,
    })
    .select(HERMES_MESSAGE_SELECT)
    .single<HermesMessageRow>();

  if (error || !data) {
    return NextResponse.json(
      { error: "Nao foi possivel enviar mensagem." },
      { status: 500 },
    );
  }

  // Web Push best-effort, APOS a resposta (after) e sem bloquear o envio: notifica os
  // membros do canal com o app fechado/minimizado. Qualquer erro fica isolado aqui.
  after(async () => {
    try {
      await sendHermesMessagePush({
        authorUserId: context.user.id,
        body: payload.data.body,
        channelId: payload.data.channelId,
        messageId: data.id,
      });
    } catch {
      // Intencional: push nunca pode afetar o envio da mensagem.
    }
  });

  return NextResponse.json({ data: compactHermesMessageRow(data) });
}

export async function PATCH(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  const rawPayload = await request.json().catch(() => null);
  const readPayload = parseMarkReadPayload(rawPayload);

  if (readPayload.ok) {
    const access = await ensureChannelAccess(
      context.adminClient,
      context.user,
      readPayload.data.channelId,
    );

    if (!access.ok) {
      return access.response;
    }

    const lastReadAt = new Date().toISOString();
    const { error } = await context.adminClient
      .from("pulsex_channel_members")
      .update({ last_read_at: lastReadAt })
      .eq("channel_id", readPayload.data.channelId)
      .eq("user_id", context.user.id)
      .eq("status", "active");

    if (error) {
      return NextResponse.json(
        { error: "Nao foi possivel marcar o canal como lido." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      data: {
        channelId: readPayload.data.channelId,
        lastReadAt,
        userId: context.user.id,
      },
    });
  }

  const editPayload = parseEditMessagePayload(rawPayload);

  if (editPayload.ok) {
    const { data: message, error: messageError } = await context.adminClient
      .from("pulsex_messages")
      .select("id,channel_id,author_user_id,metadata")
      .eq("id", editPayload.data.messageId)
      .is("deleted_at", null)
      .maybeSingle<{
        author_user_id?: string | null;
        channel_id: string;
        id: string;
        metadata?: Record<string, unknown> | null;
      }>();

    if (messageError || !message) {
      return NextResponse.json({ error: "Mensagem nao encontrada." }, { status: 404 });
    }

    if (message.author_user_id !== context.user.id) {
      return NextResponse.json(
        { error: "Somente o autor pode editar a mensagem." },
        { status: 403 },
      );
    }

    const access = await ensureChannelAccess(
      context.adminClient,
      context.user,
      message.channel_id,
    );

    if (!access.ok) {
      return access.response;
    }

    const { data, error } = await context.adminClient
      .from("pulsex_messages")
      .update({
        body: editPayload.data.body,
        metadata: compactHermesMessageMetadata({
          ...(message.metadata ?? {}),
          editedAt: new Date().toISOString(),
        }) ?? {},
      })
      .eq("id", editPayload.data.messageId)
      .select(HERMES_MESSAGE_SELECT)
      .single<HermesMessageRow>();

    if (error || !data) {
      return NextResponse.json(
        { error: "Nao foi possivel editar a mensagem." },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: compactHermesMessageRow(data) });
  }

  const reactionPayload = parseToggleReactionPayload(rawPayload);

  if (reactionPayload.ok) {
    const { data: message, error: messageError } = await context.adminClient
      .from("pulsex_messages")
      .select("id,channel_id,metadata")
      .eq("id", reactionPayload.data.messageId)
      .is("deleted_at", null)
      .maybeSingle<{
        channel_id: string;
        id: string;
        metadata?: Record<string, unknown> | null;
      }>();

    if (messageError || !message) {
      return NextResponse.json({ error: "Mensagem nao encontrada." }, { status: 404 });
    }

    const access = await ensureChannelAccess(
      context.adminClient,
      context.user,
      message.channel_id,
    );

    if (!access.ok) {
      return access.response;
    }

    const currentMetadata = message.metadata ?? {};
    const reactions = toggleHermesReaction({
      currentUserId: context.user.id,
      emoji: reactionPayload.data.emoji,
      reactions: normalizeHermesReactions(currentMetadata.reactions),
    });
    const { data, error } = await context.adminClient
      .from("pulsex_messages")
      .update({
        metadata: compactHermesMessageMetadata({
          ...currentMetadata,
          reactions,
        }) ?? {},
      })
      .eq("id", reactionPayload.data.messageId)
      .select(HERMES_MESSAGE_SELECT)
      .single<HermesMessageRow>();

    if (error || !data) {
      return NextResponse.json(
        { error: "Nao foi possivel atualizar reacao da mensagem." },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: compactHermesMessageRow(data) });
  }

  const payload = parseUpdateTagsPayload(rawPayload);

  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  const { data: message, error: messageError } = await context.adminClient
    .from("pulsex_messages")
    .select("id,channel_id,metadata")
    .eq("id", payload.data.messageId)
    .is("deleted_at", null)
    .maybeSingle<{ channel_id: string; id: string; metadata?: Record<string, unknown> | null }>();

  if (messageError || !message) {
    return NextResponse.json({ error: "Mensagem nao encontrada." }, { status: 404 });
  }

  const access = await ensureChannelAccess(
    context.adminClient,
    context.user,
    message.channel_id,
  );

  if (!access.ok) {
    return access.response;
  }

  const { data, error } = await context.adminClient
    .from("pulsex_messages")
    .update({
      metadata: compactHermesMessageMetadata({
        ...(message.metadata ?? {}),
        tags: payload.data.tags,
      }) ?? {},
    })
    .eq("id", payload.data.messageId)
    .select(HERMES_MESSAGE_SELECT)
    .single<HermesMessageRow>();

  if (error || !data) {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar tags da mensagem." },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: compactHermesMessageRow(data) });
}

function parseMessagePageOptions(
  searchParams: URLSearchParams,
): MessagePageOptions {
  const limitParam = Number(searchParams.get("limit") ?? "");
  const limit = Number.isFinite(limitParam)
    ? Math.min(
        Math.max(Math.trunc(limitParam), 1),
        HERMES_MESSAGES_MAX_LIMIT,
      )
    : HERMES_MESSAGES_DEFAULT_LIMIT;
  const before = searchParams.get("before")?.trim();
  const after = searchParams.get("after")?.trim();

  return {
    ...(after ? { after } : {}),
    ...(before && !after ? { before } : {}),
    limit,
  };
}

function parseChannelIds(value: string | null) {
  if (!value) {
    return [];
  }

  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 80);
}

function createMessagesPageMetadata(
  rows: readonly HermesMessageRow[],
  options: MessagePageOptions,
) {
  return {
    count: rows.length,
    firstCursor: rows[0]?.created_at ?? null,
    hasMore: rows.length >= options.limit,
    lastCursor: rows.at(-1)?.created_at ?? null,
    limit: options.limit,
  };
}

function parseMarkReadPayload(payload: unknown):
  | {
      data: {
        channelId: string;
      };
      ok: true;
    }
  | { ok: false } {
  if (!payload || typeof payload !== "object") {
    return { ok: false };
  }

  const input = payload as UpdateTagsPayload;
  const action = getString(input.action);
  const channelId = getString(input.channelId);

  if (action !== "mark-read" || !channelId) {
    return { ok: false };
  }

  return {
    data: {
      channelId,
    },
    ok: true,
  };
}

function parseEditMessagePayload(payload: unknown):
  | {
      data: {
        body: string;
        messageId: string;
      };
      ok: true;
    }
  | { ok: false } {
  if (!payload || typeof payload !== "object") {
    return { ok: false };
  }

  const input = payload as UpdateTagsPayload & { body?: unknown };
  const action = getString(input.action);
  const body = getString(input.body);
  const messageId = getString(input.messageId);

  if (action !== "edit-message" || !body || !messageId) {
    return { ok: false };
  }

  return {
    data: {
      body,
      messageId,
    },
    ok: true,
  };
}

function parseToggleReactionPayload(payload: unknown):
  | {
      data: {
        emoji: string;
        messageId: string;
      };
      ok: true;
    }
  | { ok: false } {
  if (!payload || typeof payload !== "object") {
    return { ok: false };
  }

  const input = payload as UpdateTagsPayload;
  const action = getString(input.action);
  const emoji = getString(input.emoji);
  const messageId = getString(input.messageId);

  if (
    action !== "toggle-reaction" ||
    !emoji ||
    emoji.length > 16 ||
    !messageId
  ) {
    return { ok: false };
  }

  return {
    data: {
      emoji,
      messageId,
    },
    ok: true,
  };
}

async function createAuthorizedContext(
  request: NextRequest,
): Promise<AuthorizedContext> {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Configure a chave server-side para salvar mensagens." },
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

  const adminClient = createClient<HermesMessagesApiDatabase>(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
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
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<HubUserAccessRow>();

  if (userError || !user || user.status !== "active") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Usuario sem acesso ao Hermes." },
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

async function ensureChannelAccess(
  adminClient: SupabaseAdminClient,
  user: HubUserAccessRow,
  channelId: string,
): Promise<
  | { channel: HermesChannelAccessRow; ok: true }
  | { ok: false; response: NextResponse }
> {
  if (channelId.startsWith("direct-")) {
    return ensureDirectChannelAccess(adminClient, user, channelId);
  }

  const { data: channel, error: channelError } = await adminClient
    .from("pulsex_channels")
    .select("id,kind,department_id,status")
    .eq("id", channelId)
    .eq("status", "active")
    .maybeSingle<HermesChannelAccessRow>();

  if (channelError || !channel) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Canal Hermes invalido." }, { status: 404 }),
    };
  }

  const { data: channelMember } = await adminClient
    .from("pulsex_channel_members")
    .select("channel_id")
    .eq("channel_id", channel.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle<{ channel_id: string }>();

  if (channelMember) {
    return { channel, ok: true };
  }

  if (channel.kind === "department" && channel.department_id) {
    const { data: departmentMember } = await adminClient
      .from("pulsex_channel_members")
      .select("channel_id,pulsex_channels!inner(department_id,kind,status)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .eq("pulsex_channels.department_id", channel.department_id)
      .eq("pulsex_channels.status", "active")
      .neq("pulsex_channels.kind", "department")
      .limit(1)
      .maybeSingle<{ channel_id: string }>();

    if (departmentMember) {
      return { channel, ok: true };
    }
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: "Voce nao participa deste canal." },
      { status: 403 },
    ),
  };
}

async function ensureDirectChannelAccess(
  adminClient: SupabaseAdminClient,
  user: HubUserAccessRow,
  channelId: string,
): Promise<
  | { channel: HermesChannelAccessRow; ok: true }
  | { ok: false; response: NextResponse }
> {
  const parsedChannel = parseHermesDirectChannelId(channelId);
  const peerUserId = getHermesDirectPeerUserId(channelId, user.id);

  if (!parsedChannel || !peerUserId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Conversa direta invalida." },
        { status: 403 },
      ),
    };
  }

  const { data: participants, error: participantsError } = await adminClient
    .from("hub_users")
    .select("id,display_name,email,status")
    .in("id", [...parsedChannel.userIds]);

  if (participantsError || !participants || participants.length !== 2) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Participantes da conversa direta nao encontrados." },
        { status: 404 },
      ),
    };
  }

  const inactiveParticipant = participants.find(
    (participant) => participant.status !== "active",
  );

  if (inactiveParticipant) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Participante sem acesso ativo ao Hermes." },
        { status: 403 },
      ),
    };
  }

  const channelName = participants
    .map((participant) => getUserLabel(participant))
    .sort((first, second) => first.localeCompare(second, "pt-BR"))
    .join(" / ");

  const { data: channel, error: channelError } = await adminClient
    .from("pulsex_channels")
    .upsert(
      {
        created_by_user_id: user.id,
        description: "Conversa direta do Hermes.",
        id: channelId,
        kind: "direct",
        metadata: {
          source: "hermes_direct",
          userIds: [...parsedChannel.userIds],
        },
        name: channelName || "Conversa direta",
        status: "active",
      },
      { onConflict: "id" },
    )
    .select("id,kind,department_id,status")
    .single<HermesChannelAccessRow>();

  if (channelError || !channel) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Nao foi possivel preparar a conversa direta." },
        { status: 500 },
      ),
    };
  }

  const { error: membersError } = await adminClient
    .from("pulsex_channel_members")
    .upsert(
      parsedChannel.userIds.map((participantUserId) => ({
        channel_id: channelId,
        role: participantUserId === user.id ? "owner" : "member",
        status: "active",
        user_id: participantUserId,
      })),
      { onConflict: "channel_id,user_id" },
    );

  if (membersError) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Nao foi possivel preparar os membros da conversa direta." },
        { status: 500 },
      ),
    };
  }

  return { channel, ok: true };
}

function parseMessagePayload(payload: unknown):
  | {
      data: {
        body: string;
        channelId: string;
        clientMessageId: string;
        attachment?: MessageAttachment;
        mentionUserIds: string[];
        mentions: { displayName: string; trigger: string; userId: string }[];
        tags: ReturnType<typeof normalizeHermesMessageTags>;
        threadParentMessageId: string;
      };
      ok: true;
    }
  | { error: string; ok: false } {
  if (!payload || typeof payload !== "object") {
    return { error: "Informe a mensagem.", ok: false };
  }

  const input = payload as MessagePayload;
  const attachment = normalizeAttachment(input.attachment);
  const body = getString(input.body);
  const channelId = getString(input.channelId);
  const clientMessageId = getString(input.clientMessageId);
  const threadParentMessageId = getString(input.threadParentMessageId);

  if ((!body && !attachment) || !channelId) {
    return { error: "Informe canal e mensagem.", ok: false };
  }

  return {
    data: {
      attachment,
      body: body || attachment?.label || "Anexo",
      channelId,
      clientMessageId,
      mentionUserIds: normalizeStringList(input.mentionUserIds),
      mentions: normalizeMentions(input.mentions),
      tags: normalizeHermesMessageTags(input.tags),
      threadParentMessageId,
    },
    ok: true,
  };
}

function parseUpdateTagsPayload(payload: unknown):
  | {
      data: {
        messageId: string;
        tags: ReturnType<typeof normalizeHermesMessageTags>;
      };
      ok: true;
    }
  | { error: string; ok: false } {
  if (!payload || typeof payload !== "object") {
    return { error: "Informe a mensagem.", ok: false };
  }

  const input = payload as UpdateTagsPayload;
  const messageId = getString(input.messageId);

  if (!messageId) {
    return { error: "Informe a mensagem.", ok: false };
  }

  return {
    data: {
      messageId,
      tags: normalizeHermesMessageTags(input.tags),
    },
    ok: true,
  };
}

function normalizeMentions(value: unknown) {
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

      return { displayName, trigger, userId };
    })
    .filter(
      (
        mention,
      ): mention is { displayName: string; trigger: string; userId: string } =>
        Boolean(mention),
    );
}

function normalizeAttachment(value: unknown): MessageAttachment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const label = getString(input.label);
  const type = getString(input.type);

  if (!label || !isAttachmentType(type)) {
    return undefined;
  }

  return {
    durationSeconds: getPositiveNumber(input.durationSeconds),
    emoji: getString(input.emoji) || undefined,
    label,
    mimeType: getString(input.mimeType) || undefined,
    sizeBytes: getPositiveNumber(input.sizeBytes),
    stickerId: getString(input.stickerId) || undefined,
    type,
    url: getString(input.url) || undefined,
  };
}

function toggleHermesReaction({
  currentUserId,
  emoji,
  reactions,
}: {
  currentUserId: string;
  emoji: string;
  reactions: readonly HermesReaction[];
}) {
  const nextReactions = reactions.map((reaction) => ({
    ...reaction,
    reactedByUserIds: [...reaction.reactedByUserIds],
  }));
  const reactionIndex = nextReactions.findIndex(
    (reaction) => reaction.emoji === emoji,
  );

  if (reactionIndex < 0) {
    return [
      ...nextReactions,
      {
        count: 1,
        emoji,
        reactedByUserIds: [currentUserId],
      },
    ];
  }

  const reaction = nextReactions[reactionIndex];

  if (!reaction) {
    return nextReactions;
  }

  const hasReacted = reaction.reactedByUserIds.includes(currentUserId);
  const reactedByUserIds = hasReacted
    ? reaction.reactedByUserIds.filter((userId) => userId !== currentUserId)
    : [...reaction.reactedByUserIds, currentUserId];

  if (reactedByUserIds.length === 0) {
    nextReactions.splice(reactionIndex, 1);
    return nextReactions;
  }

  nextReactions[reactionIndex] = {
    ...reaction,
    count: reactedByUserIds.length,
    reactedByUserIds,
  };

  return nextReactions;
}

function normalizeHermesReactions(value: unknown): HermesReaction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((reaction) => {
      if (!reaction || typeof reaction !== "object" || Array.isArray(reaction)) {
        return null;
      }

      const maybeReaction = reaction as Record<string, unknown>;
      const emoji = getString(maybeReaction.emoji);
      const reactedByUserIds = normalizeStringList(
        maybeReaction.reactedByUserIds,
      );

      if (!emoji || reactedByUserIds.length === 0) {
        return null;
      }

      return {
        count: reactedByUserIds.length,
        emoji,
        reactedByUserIds,
      } satisfies HermesReaction;
    })
    .filter((reaction): reaction is HermesReaction => Boolean(reaction));
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item): item is string => typeof item === "string"))];
}

function isAttachmentType(value: string): value is MessageAttachment["type"] {
  return ["audio", "file", "image", "sticker", "video"].includes(value);
}

function getPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getUserLabel(user: Pick<HubUserAccessRow, "display_name" | "email" | "id">) {
  return getString(user.display_name) || getString(user.email) || user.id;
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
