import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

type ChannelMembersPayload = {
  channelId?: unknown;
  participantUserIds?: unknown;
};

export async function POST(request: NextRequest) {
  const serverEnv = process.env as Record<string, string | undefined>;
  const supabaseUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Configure a chave server-side para salvar participantes." },
      { status: 503 },
    );
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json(
      { error: "Sessao administrativa ausente." },
      { status: 401 },
    );
  }

  const payload = parsePayload(await request.json().catch(() => null));

  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: authData, error: authError } =
    await adminClient.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return NextResponse.json(
      { error: "Sessao administrativa invalida." },
      { status: 401 },
    );
  }

  const { data: currentUser, error: currentUserError } = await adminClient
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: HubUserRole; status: string }>();

  if (
    currentUserError ||
    currentUser?.role !== "admin" ||
    currentUser.status !== "active"
  ) {
    return NextResponse.json(
      { error: "Apenas administradores podem salvar participantes." },
      { status: 403 },
    );
  }

  const { data: channel, error: channelError } = await adminClient
    .from("pulsex_channels")
    .select("id")
    .eq("id", payload.data.channelId)
    .maybeSingle<{ id: string }>();

  if (channelError || !channel) {
    return NextResponse.json(
      { error: "Canal PulseX invalido." },
      { status: 400 },
    );
  }

  if (payload.data.participantUserIds.length > 0) {
    const { data: users, error: usersError } = await adminClient
      .from("hub_users")
      .select("id")
      .in("id", payload.data.participantUserIds);

    if (usersError || (users?.length ?? 0) !== payload.data.participantUserIds.length) {
      return NextResponse.json(
        { error: "Selecione apenas usuarios validos." },
        { status: 400 },
      );
    }
  }

  const { error: deleteError } = await adminClient
    .from("pulsex_channel_members")
    .delete()
    .eq("channel_id", payload.data.channelId);

  if (deleteError) {
    return NextResponse.json(
      { error: "Nao foi possivel limpar participantes antigos." },
      { status: 500 },
    );
  }

  if (payload.data.participantUserIds.length === 0) {
    return NextResponse.json({ members: [] });
  }

  const { data: members, error: insertError } = await adminClient
    .from("pulsex_channel_members")
    .insert(
      payload.data.participantUserIds.map((userId) => ({
        channel_id: payload.data.channelId,
        role: "member",
        status: "active",
        user_id: userId,
      })),
    )
    .select("channel_id,user_id");

  if (insertError) {
    return NextResponse.json(
      { error: "Nao foi possivel salvar participantes." },
      { status: 500 },
    );
  }

  return NextResponse.json({ members });
}

function parsePayload(payload: unknown):
  | {
      data: {
        channelId: string;
        participantUserIds: string[];
      };
      ok: true;
    }
  | { error: string; ok: false } {
  if (!payload || typeof payload !== "object") {
    return { error: "Informe os participantes.", ok: false };
  }

  const input = payload as ChannelMembersPayload;
  const channelId = getString(input.channelId);

  if (!channelId) {
    return { error: "Selecione um canal valido.", ok: false };
  }

  if (
    !Array.isArray(input.participantUserIds) ||
    input.participantUserIds.some((userId) => typeof userId !== "string")
  ) {
    return { error: "Informe usuarios validos.", ok: false };
  }

  return {
    data: {
      channelId,
      participantUserIds: [...new Set(input.participantUserIds.map(getString))].filter(
        Boolean,
      ),
    },
    ok: true,
  };
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
