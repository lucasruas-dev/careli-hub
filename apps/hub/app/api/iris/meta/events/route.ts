import { NextResponse, type NextRequest } from "next/server";

import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Json =
  | boolean
  | number
  | string
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type IrisMetaEventRow = {
  contact_name: string | null;
  contact_wa_id: string | null;
  display_phone_number: string | null;
  id: string;
  payload: Json;
  phone_number_id: string | null;
  provider_event_type: string;
  provider_message_id: string | null;
  provider_status_id: string | null;
  received_at: string;
  signature_valid: boolean;
  status: string;
};

type IrisMetaRefRow = {
  created_at: string;
  delivery_status: string | null;
  direction: string;
  id: string;
  phone_number_id: string | null;
  wa_contact_id: string | null;
  wa_message_id: string;
};

export async function GET(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const limit = normalizeLimit(request.nextUrl.searchParams.get("limit"));
  const { client } = authorization;
  const [eventsResult, refsResult] = await Promise.all([
    client
      .from("caredesk_meta_webhook_events")
      .select(
        "id,provider_event_type,provider_message_id,provider_status_id,contact_wa_id,contact_name,display_phone_number,phone_number_id,status,signature_valid,received_at,payload",
      )
      .order("received_at", { ascending: false })
      .limit(limit),
    client
      .from("caredesk_whatsapp_message_refs")
      .select(
        "id,wa_message_id,wa_contact_id,direction,delivery_status,phone_number_id,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (eventsResult.error) {
    return NextResponse.json(
      { error: "Nao foi possivel carregar eventos Meta da Iris." },
      { status: 500 },
    );
  }

  const events = ((eventsResult.data ?? []) as IrisMetaEventRow[]).map(
    mapEventRow,
  );
  const refs = ((refsResult.data ?? []) as IrisMetaRefRow[]).map((ref) => ({
    contactWaId: ref.wa_contact_id,
    createdAt: ref.created_at,
    deliveryStatus: ref.delivery_status,
    direction: ref.direction,
    id: ref.id,
    messageId: ref.wa_message_id,
    phoneNumberId: ref.phone_number_id,
  }));

  return NextResponse.json(
    {
      events,
      refs,
      summary: {
        inbound: events.filter((event) => event.direction === "inbound").length,
        refsKnown: refs.length,
        statuses: events.filter((event) => event.direction === "status").length,
        total: events.length,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function mapEventRow(row: IrisMetaEventRow) {
  const providerEventType = row.provider_event_type ?? "unknown";
  const direction = providerEventType.startsWith("message:")
    ? "inbound"
    : providerEventType.startsWith("status:")
      ? "status"
      : "system";
  const messageId = row.provider_message_id ?? row.provider_status_id;
  const payloadDetail =
    direction === "inbound"
      ? extractMessageDetail(row.payload, row.provider_message_id)
      : extractStatusDetail(row.payload, row.provider_status_id);

  return {
    contactName: row.contact_name,
    contactWaId: row.contact_wa_id,
    direction,
    displayPhoneNumber: row.display_phone_number,
    id: row.id,
    messageId,
    messageText: payloadDetail.messageText,
    phoneNumberId: row.phone_number_id,
    providerEventType,
    receivedAt: row.received_at,
    signatureValid: row.signature_valid,
    status: row.status,
    statusDetail: payloadDetail.statusDetail,
  };
}

function extractMessageDetail(payload: Json, messageId: string | null) {
  for (const message of findMessages(payload)) {
    if (messageId && readString(message.id) !== messageId) {
      continue;
    }

    return {
      messageText: truncateText(readString(asRecord(message.text)?.body), 320),
      statusDetail: null,
    };
  }

  return {
    messageText: null,
    statusDetail: null,
  };
}

function extractStatusDetail(payload: Json, statusId: string | null) {
  for (const status of findStatuses(payload)) {
    if (statusId && readString(status.id) !== statusId) {
      continue;
    }

    return {
      messageText: null,
      statusDetail: readString(status.status),
    };
  }

  return {
    messageText: null,
    statusDetail: null,
  };
}

function findMessages(payload: Json) {
  const messages: Array<Record<string, unknown>> = [];

  for (const change of findChanges(payload)) {
    const value = asRecord(change.value);
    const changeMessages = Array.isArray(value?.messages)
      ? value.messages
      : [];

    for (const message of changeMessages) {
      const normalizedMessage = asRecord(message);

      if (normalizedMessage) {
        messages.push(normalizedMessage);
      }
    }
  }

  return messages;
}

function findStatuses(payload: Json) {
  const statuses: Array<Record<string, unknown>> = [];

  for (const change of findChanges(payload)) {
    const value = asRecord(change.value);
    const changeStatuses = Array.isArray(value?.statuses)
      ? value.statuses
      : [];

    for (const status of changeStatuses) {
      const normalizedStatus = asRecord(status);

      if (normalizedStatus) {
        statuses.push(normalizedStatus);
      }
    }
  }

  return statuses;
}

function findChanges(payload: Json) {
  const changes: Array<Record<string, unknown>> = [];
  const root = asRecord(payload);
  const entries = Array.isArray(root?.entry) ? root.entry : [];

  for (const entry of entries) {
    const normalizedEntry = asRecord(entry);
    const entryChanges = Array.isArray(normalizedEntry?.changes)
      ? normalizedEntry.changes
      : [];

    for (const change of entryChanges) {
      const normalizedChange = asRecord(change);

      if (normalizedChange) {
        changes.push(normalizedChange);
      }
    }
  }

  return changes;
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function truncateText(value: string | null, limit: number) {
  if (!value) {
    return null;
  }

  return value.length > limit ? `${value.slice(0, limit - 1)}...` : value;
}

function normalizeLimit(value: string | null) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 30;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 50);
}
