import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

type ManualEventRow = {
  actor_user_id?: string | null;
  created_at: string;
  description?: string | null;
  event_type: string;
  id: string;
  metadata?: Record<string, unknown> | null;
  title: string;
};

type GuardianManualEventsDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      caredesk_ticket_events: {
        Insert: {
          actor_type?: string;
          actor_user_id?: string | null;
          description?: string | null;
          event_type: string;
          metadata?: Record<string, unknown>;
          title: string;
        };
        Relationships: [];
        Row: ManualEventRow;
        Update: {
          description?: string | null;
          metadata?: Record<string, unknown>;
          title?: string;
        };
      };
      hub_users: {
        Insert: never;
        Relationships: [];
        Row: {
          display_name?: string | null;
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

type ManualPayload = {
  client?: {
    c2xAcquisitionRequestId?: string;
    id?: string;
    name?: string;
  };
  commitment?: Record<string, unknown>;
  event?: Record<string, unknown>;
  id?: string;
  kind?: "commitment" | "timeline";
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  const clientId = request.nextUrl.searchParams.get("clientId")?.trim();

  if (!clientId) {
    return NextResponse.json(
      { error: "Cliente nao informado." },
      { status: 400 },
    );
  }

  const { data, error } = await context.adminClient
    .from("caredesk_ticket_events")
    .select("id,event_type,title,description,metadata,actor_user_id,created_at")
    .contains("metadata", {
      client_id: clientId,
      source_module: "guardian",
    })
    .order("created_at", { ascending: false })
    .returns<ManualEventRow[]>();

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel carregar eventos manuais do Guardian." },
      { status: 500 },
    );
  }

  return NextResponse.json(mapRows(data ?? []));
}

export async function POST(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  const payload = parsePayload(await request.json().catch(() => null));

  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  const metadata = buildMetadata(payload.data, context.user);
  const title = metadata.kind === "commitment"
    ? stringFromRecord(payload.data.commitment, "title") ||
      stringFromRecord(payload.data.commitment, "type") ||
      "Compromisso registrado"
    : stringFromRecord(payload.data.event, "title") ||
      "Evento operacional registrado";
  const description = metadata.kind === "commitment"
    ? stringFromRecord(payload.data.commitment, "note") ||
      stringFromRecord(payload.data.commitment, "description")
    : stringFromRecord(payload.data.event, "description");

  const { data, error } = await context.adminClient
    .from("caredesk_ticket_events")
    .insert({
      actor_type: "user",
      actor_user_id: context.user.id,
      description,
      event_type:
        metadata.kind === "commitment"
          ? "guardian_manual_commitment"
          : "guardian_manual_timeline",
      metadata,
      title,
    })
    .select("id,event_type,title,description,metadata,actor_user_id,created_at")
    .single<ManualEventRow>();

  if (error || !data) {
    return NextResponse.json(
      { error: "Nao foi possivel registrar evento manual no Guardian." },
      { status: 500 },
    );
  }

  return NextResponse.json(mapRows([data]));
}

export async function PATCH(request: NextRequest) {
  const context = await createAuthorizedContext(request);

  if (!context.ok) {
    return context.response;
  }

  const payload = parsePayload(await request.json().catch(() => null), true);

  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  const id = payload.data.id?.trim();

  if (!id) {
    return NextResponse.json(
      { error: "Evento manual nao informado." },
      { status: 400 },
    );
  }

  const { data: current, error: loadError } = await context.adminClient
    .from("caredesk_ticket_events")
    .select("id,event_type,title,description,metadata,actor_user_id,created_at")
    .eq("id", id)
    .maybeSingle<ManualEventRow>();

  if (loadError || !current) {
    return NextResponse.json(
      { error: "Evento manual nao encontrado." },
      { status: 404 },
    );
  }

  const currentMetadata = current.metadata ?? {};
  const nextMetadata = {
    ...currentMetadata,
    commitment:
      payload.data.kind === "commitment"
        ? payload.data.commitment
        : currentMetadata.commitment,
    event:
      payload.data.kind === "timeline"
        ? payload.data.event
        : currentMetadata.event,
    history: [
      {
        action: "Atualizacao manual",
        actorName: context.user.display_name ?? "Operador Guardian",
        actorUserId: context.user.id,
        occurredAt: new Date().toISOString(),
      },
      ...arrayFromUnknown(currentMetadata.history).slice(0, 24),
    ],
    updated_at: new Date().toISOString(),
    updated_by_user_id: context.user.id,
  };
  const title = payload.data.kind === "commitment"
    ? stringFromRecord(payload.data.commitment, "title") ||
      stringFromRecord(payload.data.commitment, "type") ||
      current.title
    : stringFromRecord(payload.data.event, "title") || current.title;
  const description = payload.data.kind === "commitment"
    ? stringFromRecord(payload.data.commitment, "note") ||
      stringFromRecord(payload.data.commitment, "description") ||
      current.description
    : stringFromRecord(payload.data.event, "description") ||
      current.description;

  const { data, error } = await context.adminClient
    .from("caredesk_ticket_events")
    .update({
      description,
      metadata: nextMetadata,
      title,
    })
    .eq("id", id)
    .select("id,event_type,title,description,metadata,actor_user_id,created_at")
    .single<ManualEventRow>();

  if (error || !data) {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar evento manual no Guardian." },
      { status: 500 },
    );
  }

  return NextResponse.json(mapRows([data]));
}

function parsePayload(
  input: unknown,
  allowId = false,
):
  | { data: ManualPayload; ok: true }
  | { error: string; ok: false } {
  if (!input || typeof input !== "object") {
    return { error: "Payload ausente.", ok: false };
  }

  const payload = input as ManualPayload;

  if (payload.kind !== "commitment" && payload.kind !== "timeline") {
    return { error: "Tipo de registro invalido.", ok: false };
  }

  if (allowId && typeof payload.id !== "string") {
    return { error: "Evento manual nao informado.", ok: false };
  }

  if (!payload.client?.id && !allowId) {
    return { error: "Cliente nao informado.", ok: false };
  }

  if (payload.kind === "commitment" && !payload.commitment) {
    return { error: "Compromisso nao informado.", ok: false };
  }

  if (payload.kind === "timeline" && !payload.event) {
    return { error: "Evento nao informado.", ok: false };
  }

  return { data: payload, ok: true };
}

function buildMetadata(
  payload: ManualPayload,
  user: { display_name?: string | null; id: string },
) {
  return {
    client_id: payload.client?.id,
    client_name: payload.client?.name,
    c2x_acquisition_request_id: payload.client?.c2xAcquisitionRequestId,
    commitment: payload.kind === "commitment" ? payload.commitment : undefined,
    event: payload.kind === "timeline" ? payload.event : undefined,
    history: [
      {
        action: "Registro manual",
        actorName: user.display_name ?? "Operador Guardian",
        actorUserId: user.id,
        occurredAt: new Date().toISOString(),
      },
    ],
    kind: payload.kind,
    source_module: "guardian",
  };
}

function mapRows(rows: ManualEventRow[]) {
  const events = rows
    .map((row) => mapTimelineEvent(row))
    .filter((event): event is NonNullable<typeof event> => Boolean(event));
  const commitments = rows
    .map((row) => mapCommitment(row))
    .filter((event): event is NonNullable<typeof event> => Boolean(event));

  return {
    commitments,
    events,
  };
}

function mapTimelineEvent(row: ManualEventRow) {
  const metadata = row.metadata ?? {};
  const event = recordFromUnknown(metadata.event);
  const commitment = recordFromUnknown(metadata.commitment);

  if (metadata.kind === "commitment" && commitment) {
    return {
      actionType: stringFromRecord(commitment, "type"),
      description:
        stringFromRecord(commitment, "note") ||
        row.description ||
        "Compromisso registrado manualmente no Guardian.",
      id: row.id,
      occurredAt: formatDateTime(row.created_at),
      operator:
        stringFromRecord(commitment, "operator") ||
        metadataActorName(metadata) ||
        "Operador Guardian",
      protocol: stringFromRecord(commitment, "protocol"),
      status:
        stringFromRecord(commitment, "timelineStatus") ||
        (stringFromRecord(commitment, "type") === "Acordo"
          ? "Gerado"
          : "Prometido"),
      title:
        stringFromRecord(commitment, "title") ||
        stringFromRecord(commitment, "type") ||
        row.title,
      type:
        stringFromRecord(commitment, "timelineType") ||
        (stringFromRecord(commitment, "type") === "Acordo"
          ? "Acordo gerado"
          : "Promessa de pagamento"),
      unitCode: stringFromRecord(commitment, "unitCode"),
      unitLabel: stringFromRecord(commitment, "unitLabel"),
    };
  }

  if (!event) {
    return null;
  }

  return {
    actionType: stringFromRecord(event, "actionType"),
    description:
      stringFromRecord(event, "description") ||
      row.description ||
      "Evento registrado manualmente no Guardian.",
    id: row.id,
    occurredAt:
      stringFromRecord(event, "occurredAt") || formatDateTime(row.created_at),
    operator:
      stringFromRecord(event, "operator") ||
      metadataActorName(metadata) ||
      "Operador Guardian",
    protocol: stringFromRecord(event, "protocol"),
    status: stringFromRecord(event, "status") || "Registrado",
    title: stringFromRecord(event, "title") || row.title,
    type: stringFromRecord(event, "type") || "Observação operacional",
    unitCode: stringFromRecord(event, "unitCode"),
    unitLabel: stringFromRecord(event, "unitLabel"),
  };
}

function mapCommitment(row: ManualEventRow) {
  const metadata = row.metadata ?? {};
  const commitment = recordFromUnknown(metadata.commitment);

  if (metadata.kind !== "commitment" || !commitment) {
    return null;
  }

  return {
    ...commitment,
    id: row.id,
    history:
      Array.isArray(commitment.history) && commitment.history.length > 0
        ? commitment.history
        : [
            {
              action: "Registro manual",
              description:
                row.description ||
                "Compromisso registrado manualmente no Guardian.",
              id: `${row.id}-history`,
              occurredAt: formatDateTime(row.created_at),
              operator:
                stringFromRecord(commitment, "operator") ||
                metadataActorName(metadata) ||
                "Operador Guardian",
              protocol: stringFromRecord(commitment, "protocol"),
            },
          ],
  };
}

async function createAuthorizedContext(request: NextRequest) {
  const serverEnv = process.env as Record<string, string | undefined>;
  const supabaseUrl = serverEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Configure a chave server-side para salvar registros do Guardian." },
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

  const adminClient = createClient<GuardianManualEventsDatabase>(
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
      ok: false as const,
      response: NextResponse.json(
        { error: "Sessao administrativa invalida." },
        { status: 401 },
      ),
    };
  }

  const { data: user, error: userError } = await adminClient
    .from("hub_users")
    .select("id,role,status,display_name")
    .eq("id", authData.user.id)
    .maybeSingle<{
      display_name?: string | null;
      id: string;
      role: HubUserRole;
      status: string;
    }>();

  if (
    userError ||
    !user ||
    user.status !== "active" ||
    !["admin", "leader", "operator"].includes(user.role)
  ) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Usuario sem acesso operacional ao Guardian." },
        { status: 403 },
      ),
    };
  }

  return {
    adminClient,
    ok: true as const,
    user,
  };
}

function getBearerToken(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);

  return match?.[1] ?? "";
}

function recordFromUnknown(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringFromRecord(
  record: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = record?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function arrayFromUnknown(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function metadataActorName(metadata: Record<string, unknown>) {
  const history = arrayFromUnknown(metadata.history);
  const first = recordFromUnknown(history[0]);

  return stringFromRecord(first, "actorName");
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
