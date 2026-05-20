import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getMetaWhatsAppConfigStatus } from "@/lib/iris/meta-whatsapp";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

type IrisMetaStatusDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      caredesk_channels: {
        Insert: never;
        Relationships: [];
        Row: {
          config: Record<string, unknown>;
          id: string;
          provider: string;
          slug: string;
          status: string;
        };
        Update: never;
      };
      caredesk_meta_webhook_events: {
        Insert: never;
        Relationships: [];
        Row: {
          id: string;
        };
        Update: never;
      };
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: {
          id: string;
          role: HubUserRole;
          status: string;
        };
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

export async function GET(request: NextRequest) {
  const authorization = await authorizeIrisMetaStatus(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const configStatus = getMetaWhatsAppConfigStatus();
  const { client } = authorization;
  const { data: channel, error: channelError } = await client
    .from("caredesk_channels")
    .select("id,slug,provider,status,config")
    .eq("slug", "whatsapp-careli")
    .eq("provider", "meta")
    .maybeSingle();
  const { error: eventsError, count: eventCount } = await client
    .from("caredesk_meta_webhook_events")
    .select("id", { count: "exact", head: true });

  const eventLogReady = !eventsError;
  const channelReady = Boolean(channel && !channelError);

  return NextResponse.json(
    {
      module: "Iris",
      provider: "meta-whatsapp",
      config: configStatus,
      persistence: {
        channelReady,
        eventLogReady,
        eventRowsKnown: eventLogReady ? eventCount ?? 0 : null,
        legacyTablePrefix: "caredesk",
      },
      readiness: {
        inboundOperational: configStatus.inboundReady && eventLogReady,
        outboundOperational: false,
        outboundBlockedReason:
          "Envio ativo permanece bloqueado ate homologacao e aprovacao operacional.",
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

async function authorizeIrisMetaStatus(request: NextRequest) {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Persistencia server-side do Iris nao configurada." },
        { status: 503 },
      ),
    };
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sessao administrativa ausente." },
        { status: 401 },
      ),
    };
  }

  const client = createClient<IrisMetaStatusDatabase>(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
  const { data: authData, error: authError } = await client.auth.getUser(
    accessToken,
  );

  if (authError || !authData.user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sessao administrativa invalida." },
        { status: 401 },
      ),
    };
  }

  const { data: user, error: userError } = await client
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (
    userError ||
    !user ||
    user.status !== "active" ||
    !["admin", "leader"].includes(user.role)
  ) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Usuario sem permissao para consultar a integracao Meta." },
        { status: 403 },
      ),
    };
  }

  return {
    client,
    ok: true as const,
  };
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
