import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import {
  createMetaWebhookBodyHash,
  extractMetaWhatsAppEventSummaries,
  getMetaWhatsAppWebhookConfig,
  normalizeSignatureHeader,
  verifyMetaWebhookSignature,
} from "@/lib/iris/meta-whatsapp";
import { processMetaWhatsAppWebhookEvents } from "@/lib/iris/meta-inbound-processor";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Json =
  | boolean
  | number
  | string
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type IrisMetaWebhookDatabase = {
  public: {
    CompositeTypes: Record<string, never>;
    Enums: {
      caredesk_meta_webhook_event_status:
        | "received"
        | "processed"
        | "ignored"
        | "failed";
    };
    Functions: Record<string, never>;
    Tables: {
      caredesk_meta_webhook_events: {
        Insert: {
          change_field?: string | null;
          contact_name?: string | null;
          contact_wa_id?: string | null;
          display_phone_number?: string | null;
          entry_id?: string | null;
          event_object: string;
          payload: Json;
          phone_number_id?: string | null;
          provider_event_type: string;
          provider_message_id?: string | null;
          provider_status_id?: string | null;
          raw_body_sha256: string;
          signature_sha256?: string | null;
          signature_valid: boolean;
          status?: "received" | "processed" | "ignored" | "failed";
          whatsapp_business_account_id?: string | null;
        };
        Relationships: [];
        Row: never;
        Update: never;
      };
    };
    Views: Record<string, never>;
  };
};

export async function GET(request: NextRequest) {
  const { verifyToken } = getMetaWhatsAppWebhookConfig();
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (!verifyToken) {
    return NextResponse.json(
      { error: "Webhook Meta WhatsApp nao configurado no Iris." },
      { status: 503 },
    );
  }

  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new Response(challenge, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
      status: 200,
    });
  }

  return NextResponse.json(
    { error: "Verificacao do webhook Meta WhatsApp rejeitada." },
    { status: 403 },
  );
}

export async function POST(request: NextRequest) {
  const { appSecret } = getMetaWhatsAppWebhookConfig();

  if (!appSecret) {
    return NextResponse.json(
      { error: "Assinatura Meta WhatsApp nao configurada no Iris." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-hub-signature-256");
  const signatureValid = verifyMetaWebhookSignature({
    appSecret,
    rawBody,
    signatureHeader,
  });

  if (!signatureValid) {
    return NextResponse.json(
      { error: "Assinatura Meta WhatsApp invalida." },
      { status: 401 },
    );
  }

  const payload = parseJson(rawBody);

  if (!payload) {
    return NextResponse.json(
      { error: "Payload Meta WhatsApp invalido." },
      { status: 400 },
    );
  }

  const adminClient = createIrisMetaWebhookClient();

  if (!adminClient) {
    return NextResponse.json(
      { error: "Persistencia server-side do Iris nao configurada." },
      { status: 503 },
    );
  }

  const bodyHash = createMetaWebhookBodyHash(rawBody);
  const signatureHash = normalizeSignatureHeader(signatureHeader);
  const eventRows = extractMetaWhatsAppEventSummaries(payload).map(
    (summary) => ({
      change_field: summary.changeField,
      contact_name: summary.contactName,
      contact_wa_id: summary.contactWaId,
      display_phone_number: summary.displayPhoneNumber,
      entry_id: summary.entryId,
      event_object: summary.eventObject,
      payload: payload as Json,
      phone_number_id: summary.phoneNumberId,
      provider_event_type: summary.providerEventType,
      provider_message_id: summary.providerMessageId,
      provider_status_id: summary.providerStatusId,
      raw_body_sha256: bodyHash,
      signature_sha256: signatureHash,
      signature_valid: true,
      status: "received" as const,
      whatsapp_business_account_id: summary.whatsappBusinessAccountId,
    }),
  );

  const { data: insertedEvents, error } = await adminClient
    .from("caredesk_meta_webhook_events")
    .insert(eventRows)
    .select(
      "id,provider_event_type,provider_message_id,provider_status_id,contact_wa_id,contact_name,display_phone_number,phone_number_id,payload,received_at",
    );

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel registrar o evento Meta WhatsApp." },
      { status: 500 },
    );
  }

  const processingResult = await processMetaWhatsAppWebhookEvents({
    client: adminClient,
    events: insertedEvents ?? [],
  });

  return NextResponse.json(
    {
      ok: true,
      processing: processingResult,
      received: eventRows.length,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
      status: 200,
    },
  );
}

function createIrisMetaWebhookClient() {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient<IrisMetaWebhookDatabase>(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

function parseJson(rawBody: string) {
  try {
    const parsed = JSON.parse(rawBody) as unknown;

    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isJsonObject(value: unknown): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
