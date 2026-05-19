import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
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
          email?: string | null;
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

const MAX_MANUAL_ATTACHMENT_COUNT = 3;
const MAX_MANUAL_ATTACHMENT_DATA_URL_LENGTH = 8_500_000;
const MAX_MANUAL_ATTACHMENT_NAME_LENGTH = 140;
const MANUAL_ATTACHMENT_TYPES = new Set(["audio", "file", "image"]);

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

  const dataWithOperator = payloadWithAuthenticatedOperator(
    payload.data,
    context.user,
  );
  const metadata = buildMetadata(dataWithOperator, context.user);
  const title = metadata.kind === "commitment"
    ? stringFromRecord(dataWithOperator.commitment, "title") ||
      stringFromRecord(dataWithOperator.commitment, "type") ||
      "Compromisso registrado"
    : stringFromRecord(dataWithOperator.event, "title") ||
      "Evento operacional registrado";
  const description = metadata.kind === "commitment"
    ? stringFromRecord(dataWithOperator.commitment, "note") ||
      stringFromRecord(dataWithOperator.commitment, "description")
    : stringFromRecord(dataWithOperator.event, "description");

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

  const dataWithOperator = payloadWithAuthenticatedOperator(
    payload.data,
    context.user,
  );
  const id = dataWithOperator.id?.trim();

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
      dataWithOperator.kind === "commitment"
        ? dataWithOperator.commitment
        : currentMetadata.commitment,
    event:
      dataWithOperator.kind === "timeline"
        ? dataWithOperator.event
        : currentMetadata.event,
    history: [
      {
        action: "Atualizacao manual",
        actorName: authenticatedOperatorName(context.user),
        actorUserId: context.user.id,
        occurredAt: new Date().toISOString(),
      },
      ...arrayFromUnknown(currentMetadata.history).slice(0, 24),
    ],
    updated_at: new Date().toISOString(),
    updated_by_user_id: context.user.id,
  };
  const title = dataWithOperator.kind === "commitment"
    ? stringFromRecord(dataWithOperator.commitment, "title") ||
      stringFromRecord(dataWithOperator.commitment, "type") ||
      current.title
    : stringFromRecord(dataWithOperator.event, "title") || current.title;
  const description = dataWithOperator.kind === "commitment"
    ? stringFromRecord(dataWithOperator.commitment, "note") ||
      stringFromRecord(dataWithOperator.commitment, "description") ||
      current.description
    : stringFromRecord(dataWithOperator.event, "description") ||
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
  user: { display_name?: string | null; email?: string | null; id: string },
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
        actorName: authenticatedOperatorName(user),
        actorUserId: user.id,
        occurredAt: new Date().toISOString(),
      },
    ],
    kind: payload.kind,
    source_module: "guardian",
  };
}

function payloadWithAuthenticatedOperator(
  payload: ManualPayload,
  user: { display_name?: string | null; email?: string | null },
): ManualPayload {
  const operator = authenticatedOperatorName(user);

  return {
    ...payload,
    commitment: payload.commitment
      ? recordWithAuthenticatedOperator(payload.commitment, operator)
      : payload.commitment,
    event: payload.event
      ? recordWithAuthenticatedOperator(payload.event, operator)
      : payload.event,
  };
}

function authenticatedOperatorName(user: {
  display_name?: string | null;
  email?: string | null;
}) {
  return formatOperatorDisplayName(
    user.display_name?.trim() ||
      user.email?.trim() ||
      "Operador Guardian",
  );
}

function formatOperatorDisplayName(value: string) {
  const normalized = value.trim();

  if (!normalized || normalized.includes(" ")) {
    return normalized;
  }

  const localPart = normalized.includes("@")
    ? normalized.split("@")[0] ?? normalized
    : normalized;

  if (!/[._-]/.test(localPart)) {
    return normalized;
  }

  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function recordWithAuthenticatedOperator(
  record: Record<string, unknown>,
  operator: string,
) {
  const attachments = normalizeManualAttachments(record.attachments);

  return {
    ...record,
    attachments,
    operator,
  };
}

function normalizeManualAttachments(value: unknown) {
  return arrayFromUnknown(value)
    .map((item, index) => {
      const attachment = recordFromUnknown(item);

      if (!attachment) {
        return null;
      }

      const fileName = stringFromRecord(attachment, "fileName").slice(
        0,
        MAX_MANUAL_ATTACHMENT_NAME_LENGTH,
      );
      const mimeType =
        stringFromRecord(attachment, "mimeType").slice(0, 120) ||
        "application/octet-stream";
      const rawType = stringFromRecord(attachment, "type");
      const type = MANUAL_ATTACHMENT_TYPES.has(rawType)
        ? rawType
        : attachmentTypeFromMime(mimeType);
      const rawDataUrl = stringFromRecord(attachment, "dataUrl");
      const dataUrl =
        rawDataUrl.length <= MAX_MANUAL_ATTACHMENT_DATA_URL_LENGTH
          ? rawDataUrl
          : "";
      const rawSize = Number(attachment.sizeBytes);
      const sizeBytes = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 0;

      if (!fileName || !MANUAL_ATTACHMENT_TYPES.has(type)) {
        return null;
      }

      return {
        capturedAt:
          stringFromRecord(attachment, "capturedAt") ||
          new Date().toISOString(),
        dataUrl,
        fileName,
        id:
          stringFromRecord(attachment, "id") ||
          `guardian-attachment-${index + 1}`,
        mimeType,
        sizeBytes,
        type,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, MAX_MANUAL_ATTACHMENT_COUNT);
}

function attachmentTypeFromMime(mimeType: string) {
  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  return "file";
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
      operator: formatOperatorDisplayName(
        stringFromRecord(commitment, "operator") ||
        metadataActorName(metadata) ||
        "Operador Guardian",
      ),
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
    attachments: normalizeManualAttachments(event.attachments),
    description:
      stringFromRecord(event, "description") ||
      row.description ||
      "Evento registrado manualmente no Guardian.",
    id: row.id,
    occurredAt:
      stringFromRecord(event, "occurredAt") || formatDateTime(row.created_at),
    operator: formatOperatorDisplayName(
      stringFromRecord(event, "operator") ||
      metadataActorName(metadata) ||
      "Operador Guardian",
    ),
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
    operator: formatOperatorDisplayName(
      stringFromRecord(commitment, "operator") ||
        metadataActorName(metadata) ||
        "Operador Guardian",
    ),
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
              operator: formatOperatorDisplayName(
                stringFromRecord(commitment, "operator") ||
                metadataActorName(metadata) ||
                "Operador Guardian",
              ),
              protocol: stringFromRecord(commitment, "protocol"),
            },
          ],
  };
}

async function createAuthorizedContext(request: NextRequest) {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

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
    .select("id,role,status,display_name,email")
    .eq("id", authData.user.id)
    .maybeSingle<{
      display_name?: string | null;
      email?: string | null;
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
