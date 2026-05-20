import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const META_WHATSAPP_WEBHOOK_PATH = "/api/iris/meta/webhook";

export const META_WHATSAPP_ENV_KEYS = [
  "META_WHATSAPP_APP_ID",
  "META_WHATSAPP_APP_SECRET",
  "META_WHATSAPP_ACCESS_TOKEN",
  "META_WHATSAPP_BUSINESS_ACCOUNT_ID",
  "META_WHATSAPP_PHONE_NUMBER_ID",
  "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "META_WHATSAPP_GRAPH_VERSION",
] as const;

export type MetaWhatsAppEnvKey = (typeof META_WHATSAPP_ENV_KEYS)[number];

export type MetaWhatsAppConfigStatus = {
  graphVersionConfigured: boolean;
  inboundReady: boolean;
  missingInboundKeys: MetaWhatsAppEnvKey[];
  missingOutboundKeys: MetaWhatsAppEnvKey[];
  outboundReady: boolean;
  requiredInboundKeys: MetaWhatsAppEnvKey[];
  requiredOutboundKeys: MetaWhatsAppEnvKey[];
  webhookPath: typeof META_WHATSAPP_WEBHOOK_PATH;
};

export type MetaWhatsAppWebhookConfig = {
  appSecret?: string;
  phoneNumberId?: string;
  verifyToken?: string;
  whatsappBusinessAccountId?: string;
};

export type MetaWhatsAppOutboundConfig = {
  accessToken?: string;
  graphVersion?: string;
  phoneNumberId?: string;
  whatsappBusinessAccountId?: string;
};

export type MetaWhatsAppSendTextResult = {
  contactWaId: string | null;
  messageId: string | null;
  raw: unknown;
};

export class MetaWhatsAppSendError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MetaWhatsAppSendError";
    this.status = status;
  }
}

export type MetaWhatsAppWebhookEventSummary = {
  changeField: string | null;
  contactName: string | null;
  contactWaId: string | null;
  displayPhoneNumber: string | null;
  entryId: string | null;
  eventObject: string;
  phoneNumberId: string | null;
  providerEventType: string;
  providerMessageId: string | null;
  providerStatusId: string | null;
  whatsappBusinessAccountId: string | null;
};

type MetaWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      field?: unknown;
      value?: {
        contacts?: Array<{
          profile?: {
            name?: unknown;
          };
          wa_id?: unknown;
        }>;
        messages?: Array<{
          from?: unknown;
          id?: unknown;
          type?: unknown;
        }>;
        metadata?: {
          display_phone_number?: unknown;
          phone_number_id?: unknown;
        };
        statuses?: Array<{
          id?: unknown;
          recipient_id?: unknown;
          status?: unknown;
        }>;
      };
    }>;
    id?: unknown;
  }>;
  object?: unknown;
};

const REQUIRED_INBOUND_KEYS = [
  "META_WHATSAPP_APP_SECRET",
  "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN",
] as const satisfies MetaWhatsAppEnvKey[];

const REQUIRED_OUTBOUND_KEYS = [
  "META_WHATSAPP_ACCESS_TOKEN",
  "META_WHATSAPP_BUSINESS_ACCOUNT_ID",
  "META_WHATSAPP_PHONE_NUMBER_ID",
  "META_WHATSAPP_GRAPH_VERSION",
] as const satisfies MetaWhatsAppEnvKey[];

export function getMetaWhatsAppConfigStatus(
  env: NodeJS.ProcessEnv = process.env,
): MetaWhatsAppConfigStatus {
  const missingInboundKeys = REQUIRED_INBOUND_KEYS.filter(
    (key) => !readEnvValue(env[key]),
  );
  const missingOutboundKeys = REQUIRED_OUTBOUND_KEYS.filter(
    (key) => !readEnvValue(env[key]),
  );

  return {
    graphVersionConfigured: Boolean(readEnvValue(env.META_WHATSAPP_GRAPH_VERSION)),
    inboundReady: missingInboundKeys.length === 0,
    missingInboundKeys,
    missingOutboundKeys,
    outboundReady: missingOutboundKeys.length === 0,
    requiredInboundKeys: [...REQUIRED_INBOUND_KEYS],
    requiredOutboundKeys: [...REQUIRED_OUTBOUND_KEYS],
    webhookPath: META_WHATSAPP_WEBHOOK_PATH,
  };
}

export function getMetaWhatsAppWebhookConfig(
  env: NodeJS.ProcessEnv = process.env,
): MetaWhatsAppWebhookConfig {
  return {
    appSecret: readEnvValue(env.META_WHATSAPP_APP_SECRET),
    phoneNumberId: readEnvValue(env.META_WHATSAPP_PHONE_NUMBER_ID),
    verifyToken: readEnvValue(env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN),
    whatsappBusinessAccountId: readEnvValue(
      env.META_WHATSAPP_BUSINESS_ACCOUNT_ID,
    ),
  };
}

export function getMetaWhatsAppOutboundConfig(
  env: NodeJS.ProcessEnv = process.env,
): MetaWhatsAppOutboundConfig {
  return {
    accessToken: readEnvValue(env.META_WHATSAPP_ACCESS_TOKEN),
    graphVersion: readEnvValue(env.META_WHATSAPP_GRAPH_VERSION),
    phoneNumberId: readEnvValue(env.META_WHATSAPP_PHONE_NUMBER_ID),
    whatsappBusinessAccountId: readEnvValue(
      env.META_WHATSAPP_BUSINESS_ACCOUNT_ID,
    ),
  };
}

export async function sendMetaWhatsAppTextMessage({
  body,
  config = getMetaWhatsAppOutboundConfig(),
  to,
}: {
  body: string;
  config?: MetaWhatsAppOutboundConfig;
  to: string;
}): Promise<MetaWhatsAppSendTextResult> {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const phoneNumberId = readEnvValue(config.phoneNumberId);

  if (!accessToken || !graphVersion || !phoneNumberId) {
    throw new MetaWhatsAppSendError(
      "Configuracao outbound Meta WhatsApp incompleta.",
      503,
    );
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
    {
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        text: {
          body,
          preview_url: false,
        },
        to,
        type: "text",
      }),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        contacts?: Array<{ wa_id?: unknown }>;
        error?: { message?: unknown; type?: unknown };
        messages?: Array<{ id?: unknown }>;
      }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou o envio.",
      response.status,
    );
  }

  return {
    contactWaId: normalizeText(payload?.contacts?.[0]?.wa_id),
    messageId: normalizeText(payload?.messages?.[0]?.id),
    raw: payload,
  };
}

export function verifyMetaWebhookSignature({
  appSecret,
  rawBody,
  signatureHeader,
}: {
  appSecret: string;
  rawBody: string;
  signatureHeader: string | null;
}) {
  const signature = normalizeSignatureHeader(signatureHeader);

  if (!signature) {
    return false;
  }

  const expectedSignature = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  const received = Buffer.from(signature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

export function createMetaWebhookBodyHash(rawBody: string) {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

export function normalizeSignatureHeader(signatureHeader: string | null) {
  const normalized = signatureHeader?.trim();

  if (!normalized?.startsWith("sha256=")) {
    return null;
  }

  const signature = normalized.slice("sha256=".length).trim().toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(signature)) {
    return null;
  }

  return signature;
}

export function extractMetaWhatsAppEventSummaries(
  payload: MetaWebhookPayload,
): MetaWhatsAppWebhookEventSummary[] {
  const eventObject = normalizeText(payload.object) ?? "unknown";
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const summaries: MetaWhatsAppWebhookEventSummary[] = [];

  for (const entry of entries) {
    const entryId = normalizeText(entry.id);
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const change of changes) {
      const changeField = normalizeText(change.field);
      const value = change.value ?? {};
      const metadata = value.metadata ?? {};
      const phoneNumberId = normalizeText(metadata.phone_number_id);
      const displayPhoneNumber = normalizeText(metadata.display_phone_number);
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];

      for (const message of messages) {
        const contact = findContact(contacts, normalizeText(message.from));

        summaries.push({
          changeField,
          contactName: normalizeText(contact?.profile?.name),
          contactWaId: normalizeText(contact?.wa_id) ?? normalizeText(message.from),
          displayPhoneNumber,
          entryId,
          eventObject,
          phoneNumberId,
          providerEventType: `message:${normalizeText(message.type) ?? "unknown"}`,
          providerMessageId: normalizeText(message.id),
          providerStatusId: null,
          whatsappBusinessAccountId: entryId,
        });
      }

      for (const status of statuses) {
        const statusRecipient = normalizeText(status.recipient_id);

        summaries.push({
          changeField,
          contactName: null,
          contactWaId: statusRecipient,
          displayPhoneNumber,
          entryId,
          eventObject,
          phoneNumberId,
          providerEventType: `status:${normalizeText(status.status) ?? "unknown"}`,
          providerMessageId: null,
          providerStatusId: normalizeText(status.id),
          whatsappBusinessAccountId: entryId,
        });
      }

      if (messages.length === 0 && statuses.length === 0) {
        summaries.push({
          changeField,
          contactName: null,
          contactWaId: null,
          displayPhoneNumber,
          entryId,
          eventObject,
          phoneNumberId,
          providerEventType: "change",
          providerMessageId: null,
          providerStatusId: null,
          whatsappBusinessAccountId: entryId,
        });
      }
    }
  }

  return summaries.length > 0
    ? summaries
    : [
        {
          changeField: null,
          contactName: null,
          contactWaId: null,
          displayPhoneNumber: null,
          entryId: null,
          eventObject,
          phoneNumberId: null,
          providerEventType: "unknown",
          providerMessageId: null,
          providerStatusId: null,
          whatsappBusinessAccountId: null,
        },
      ];
}

function findContact(
  contacts: Array<{ wa_id?: unknown; profile?: { name?: unknown } }>,
  waId: string | null,
) {
  if (!waId) {
    return contacts[0];
  }

  return contacts.find((contact) => normalizeText(contact.wa_id) === waId);
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readEnvValue(value: string | undefined) {
  const normalizedValue = value?.trim();

  return normalizedValue ? normalizedValue : undefined;
}

function normalizeGraphVersion(value: string | undefined) {
  const normalizedValue = readEnvValue(value)?.replace(/^\/+|\/+$/g, "");

  return normalizedValue || undefined;
}
