import { normalizePulseXMessageTags } from "@/lib/pulsex/message-tags";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

type HubUserAccessRow = {
  id: string;
  role: HubUserRole;
  status: string;
};

type PulseXChannelAccessRow = {
  department_id?: string | null;
  id: string;
  kind: "department" | "direct" | "sector" | "system";
  status: string;
};

type PulseXMessageRow = {
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
  label: string;
  mimeType?: string;
  sizeBytes?: number;
  type: "audio" | "file" | "image" | "video";
  url?: string;
};

type UpdateTagsPayload = {
  action?: unknown;
  channelId?: unknown;
  messageId?: unknown;
  tags?: unknown;
};

type PulseXMessagesApiDatabase = {
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
        Insert: never;
        Relationships: [];
        Row: {
          channel_id: string;
          status: string;
          user_id: string;
        };
        Update: {
          last_read_at?: string;
        };
      };
      pulsex_channels: {
        Insert: never;
        Relationships: [];
        Row: PulseXChannelAccessRow;
        Update: never;
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
        Row: PulseXMessageRow;
        Update: {
          metadata?: Record<string, unknown>;
        };
      };
    };
    Views: Record<string, never>;
  };
};

type SupabaseAdminClient = ReturnType<
  typeof createClient<PulseXMessagesApiDatabase>
>;

type AuthorizedContext =
  | {
      adminClient: SupabaseAdminClient;
      ok: true;
      user: HubUserAccessRow;
    }
  | { ok: false; response: NextResponse };

export async function GET(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  const threadParentMessageId =
    request.nextUrl.searchParams.get("threadParentMessageId")?.trim() ?? "";
  const channelId = request.nextUrl.searchParams.get("channelId")?.trim();

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

    const { data, error } = await context.adminClient
      .from("pulsex_messages")
      .select("id,channel_id,author_user_id,body,metadata,created_at,deleted_at,hub_users(display_name,avatar_url,email)")
      .eq("channel_id", parentMessage.channel_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "Nao foi possivel carregar respostas." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      data: (data ?? []).filter(
        (message) =>
          getString(getRecord(message.metadata).threadParentMessageId) ===
          threadParentMessageId,
      ),
    });
  }

  if (!channelId) {
    return NextResponse.json({ error: "Informe o canal." }, { status: 400 });
  }

  const access = await ensureChannelAccess(context.adminClient, context.user, channelId);

  if (!access.ok) {
    return access.response;
  }

  const { data, error } = await context.adminClient
    .from("pulsex_messages")
    .select("id,channel_id,author_user_id,body,metadata,created_at,deleted_at,hub_users(display_name,avatar_url,email)")
    .eq("channel_id", channelId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel carregar mensagens." },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: data ?? [] });
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

  const { data, error } = await context.adminClient
    .from("pulsex_messages")
    .insert({
      author_user_id: context.user.id,
      body: payload.data.body,
      channel_id: payload.data.channelId,
      metadata: {
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
      },
    })
    .select("id,channel_id,author_user_id,body,metadata,created_at,deleted_at,hub_users(display_name,avatar_url,email)")
    .single<PulseXMessageRow>();

  if (error || !data) {
    return NextResponse.json(
      { error: "Nao foi possivel enviar mensagem." },
      { status: 500 },
    );
  }

  return NextResponse.json({ data });
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
      metadata: {
        ...(message.metadata ?? {}),
        tags: payload.data.tags,
      },
    })
    .eq("id", payload.data.messageId)
    .select("id,channel_id,author_user_id,body,metadata,created_at,deleted_at,hub_users(display_name,avatar_url,email)")
    .single<PulseXMessageRow>();

  if (error || !data) {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar tags da mensagem." },
      { status: 500 },
    );
  }

  return NextResponse.json({ data });
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

async function createAuthorizedContext(
  request: NextRequest,
): Promise<AuthorizedContext> {
  const serverEnv = process.env as Record<string, string | undefined>;
  const supabaseUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

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

  const adminClient = createClient<PulseXMessagesApiDatabase>(
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
        { error: "Usuario sem acesso ao PulseX." },
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
  | { channel: PulseXChannelAccessRow; ok: true }
  | { ok: false; response: NextResponse }
> {
  const { data: channel, error: channelError } = await adminClient
    .from("pulsex_channels")
    .select("id,kind,department_id,status")
    .eq("id", channelId)
    .eq("status", "active")
    .maybeSingle<PulseXChannelAccessRow>();

  if (channelError || !channel) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Canal PulseX invalido." }, { status: 404 }),
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

function parseMessagePayload(payload: unknown):
  | {
      data: {
        body: string;
        channelId: string;
        clientMessageId: string;
        attachment?: MessageAttachment;
        mentionUserIds: string[];
        mentions: { displayName: string; trigger: string; userId: string }[];
        tags: ReturnType<typeof normalizePulseXMessageTags>;
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
      tags: normalizePulseXMessageTags(input.tags),
      threadParentMessageId,
    },
    ok: true,
  };
}

function parseUpdateTagsPayload(payload: unknown):
  | {
      data: {
        messageId: string;
        tags: ReturnType<typeof normalizePulseXMessageTags>;
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
      tags: normalizePulseXMessageTags(input.tags),
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
    label,
    mimeType: getString(input.mimeType) || undefined,
    sizeBytes: getPositiveNumber(input.sizeBytes),
    type,
    url: getString(input.url) || undefined,
  };
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item): item is string => typeof item === "string"))];
}

function isAttachmentType(value: string): value is MessageAttachment["type"] {
  return ["audio", "file", "image", "video"].includes(value);
}

function getPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
