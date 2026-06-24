import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

type ParsedSubscription = {
  auth: string;
  endpoint: string;
  p256dh: string;
};

export async function POST(request: NextRequest) {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Configuracao server-side ausente." },
      { status: 503 },
    );
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json({ error: "Sessao ausente." }, { status: 401 });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } =
    await admin.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Sessao invalida." }, { status: 401 });
  }

  const subscription = parseSubscription(
    await request.json().catch(() => null),
  );

  if (!subscription) {
    return NextResponse.json(
      { error: "Subscription invalida." },
      { status: 400 },
    );
  }

  const { error } = await admin.from("hub_push_subscriptions").upsert(
    {
      auth: subscription.auth,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      updated_at: new Date().toISOString(),
      user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      user_id: authData.user.id,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel salvar a subscription." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!url || !serviceRoleKey) {
    return NextResponse.json({ ok: true });
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json({ error: "Sessao ausente." }, { status: 401 });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData } = await admin.auth.getUser(accessToken);

  if (!authData.user) {
    return NextResponse.json({ error: "Sessao invalida." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    endpoint?: unknown;
  } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";

  if (endpoint) {
    await admin
      .from("hub_push_subscriptions")
      .delete()
      .eq("endpoint", endpoint)
      .eq("user_id", authData.user.id);
  }

  return NextResponse.json({ ok: true });
}

function parseSubscription(value: unknown): ParsedSubscription | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as {
    endpoint?: unknown;
    keys?: { auth?: unknown; p256dh?: unknown } | null;
  };
  const endpoint = typeof input.endpoint === "string" ? input.endpoint : "";
  const p256dh =
    typeof input.keys?.p256dh === "string" ? input.keys.p256dh : "";
  const auth = typeof input.keys?.auth === "string" ? input.keys.auth : "";

  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  return { auth, endpoint, p256dh };
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
