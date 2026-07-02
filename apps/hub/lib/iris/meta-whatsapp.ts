import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

export const META_WHATSAPP_WEBHOOK_PATH = "/api/iris/meta/webhook";

export const META_WHATSAPP_ENV_KEYS = [
  "META_WHATSAPP_APP_ID",
  "META_WHATSAPP_APP_SECRET",
  "META_WHATSAPP_ACCESS_TOKEN",
  "META_WHATSAPP_BUSINESS_ACCOUNT_ID",
  "META_WHATSAPP_PHONE_DISPLAY_NUMBER",
  "META_WHATSAPP_PHONE_NUMBER",
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
  appId?: string;
  phoneDisplayNumber?: string;
  graphVersion?: string;
  phoneNumberId?: string;
  whatsappBusinessAccountId?: string;
};

export type MetaWhatsAppSendMessageResult = {
  contactWaId: string | null;
  messageId: string | null;
  raw: unknown;
};

export type MetaWhatsAppDownloadedMedia = {
  buffer: Buffer;
  fileSize: number | null;
  mimeType: string | null;
  sha256: string | null;
};

export type MetaWhatsAppSendTextResult = MetaWhatsAppSendMessageResult;
export type MetaWhatsAppCreateTemplateResult = {
  category: string | null;
  id: string | null;
  name: string | null;
  raw: unknown;
  status: string | null;
};

export type MetaWhatsAppTemplateSummary = {
  category: string | null;
  components: unknown;
  id: string | null;
  language: string | null;
  name: string | null;
  status: string | null;
};

export type MetaWhatsAppTemplateHeaderMedia = {
  fileName?: string | null;
  id?: string | null;
  link?: string | null;
  type: "document" | "image" | "video";
};

export type MetaWhatsAppTemplateHeaderMediaUploadResult = {
  handle: string | null;
  raw: unknown;
  uploadSessionId: string | null;
};

export type MetaWhatsAppPhoneNumberSummary = {
  codeVerificationStatus: string | null;
  displayPhoneNumber: string | null;
  id: string;
  isDefault: boolean;
  label: string;
  nameStatus: string | null;
  qualityRating: string | null;
  verifiedName: string | null;
  whatsappBusinessAccountId: string | null;
};

export type MetaWhatsAppPhoneNumberLinkStatus = {
  configured: boolean;
  linked: boolean | null;
  phoneBusinessAccountDetected: boolean;
  phoneCount: number | null;
  templateBusinessAccountSource:
    | "configured"
    | "missing_config"
    | "phone"
    | "unavailable";
};

export class MetaWhatsAppSendError extends Error {
  code: number | string | null;
  details: unknown;
  status: number;

  constructor(
    message: string,
    status: number,
    options?: {
      code?: number | string | null;
      details?: unknown;
    },
  ) {
    super(message);
    this.name = "MetaWhatsAppSendError";
    this.code = options?.code ?? null;
    this.details = options?.details ?? null;
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
    appId: readEnvValue(env.META_WHATSAPP_APP_ID),
    graphVersion: readEnvValue(env.META_WHATSAPP_GRAPH_VERSION),
    phoneDisplayNumber:
      readEnvValue(env.META_WHATSAPP_PHONE_DISPLAY_NUMBER) ??
      readEnvValue(env.META_WHATSAPP_PHONE_NUMBER),
    phoneNumberId: readEnvValue(env.META_WHATSAPP_PHONE_NUMBER_ID),
    whatsappBusinessAccountId: readEnvValue(
      env.META_WHATSAPP_BUSINESS_ACCOUNT_ID,
    ),
  };
}

export type MetaWhatsAppSubscribeResult = {
  raw: unknown;
  success: boolean;
};

// Subscreve o app da Iris (identificado pelo proprio access token) ao webhook de
// uma WABA. Necessario para a Iris receber eventos (mensagens/status) de cada
// conta do WhatsApp Business — ter acesso de System User a WABA NAO subscreve o
// webhook; sao coisas separadas. Base do multi-WABA (principal/Gurgel/juridico).
export async function subscribeMetaWhatsAppAppToWaba({
  config = getMetaWhatsAppOutboundConfig(),
  wabaId,
}: {
  config?: MetaWhatsAppOutboundConfig;
  wabaId: string;
}): Promise<MetaWhatsAppSubscribeResult> {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const normalizedWabaId = readEnvValue(wabaId);

  if (!accessToken || !graphVersion) {
    throw new MetaWhatsAppSendError(
      "Configuracao Meta WhatsApp incompleta para subscrever a WABA.",
      503,
    );
  }

  if (!normalizedWabaId) {
    throw new MetaWhatsAppSendError("WABA id ausente.", 400);
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${normalizedWabaId}/subscribed_apps`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: unknown; message?: unknown }; success?: boolean }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou a subscricao da WABA.",
      response.status,
      {
        code: normalizeErrorCode(payload?.error?.code),
        details: payload?.error ?? null,
      },
    );
  }

  return {
    raw: payload,
    success: payload?.success === true,
  };
}

// Lista os apps subscritos ao webhook de uma WABA — usado para confirmar a
// subscricao depois do POST (read-only).
export async function listMetaWhatsAppWabaSubscribedApps({
  config = getMetaWhatsAppOutboundConfig(),
  wabaId,
}: {
  config?: MetaWhatsAppOutboundConfig;
  wabaId: string;
}): Promise<unknown> {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const normalizedWabaId = readEnvValue(wabaId);

  if (!accessToken || !graphVersion) {
    throw new MetaWhatsAppSendError(
      "Configuracao Meta WhatsApp incompleta para listar apps da WABA.",
      503,
    );
  }

  if (!normalizedWabaId) {
    throw new MetaWhatsAppSendError("WABA id ausente.", 400);
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${normalizedWabaId}/subscribed_apps`,
    {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
      method: "GET",
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: unknown };
  } | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Falha ao listar apps subscritos da WABA.",
      response.status,
    );
  }

  return payload;
}

// Registra um numero na Cloud API (POST /{phone_number_id}/register). Passo FINAL para
// ATIVAR um numero recem-adicionado/migrado para uma WABA: enquanto nao registrado, o
// numero fica "Pendente" (nao envia/recebe) e a Meta exibe "not registered with Cloud API".
// O `pin` de 6 digitos vira a verificacao em duas etapas do numero — guardar bem.
// Se o numero ja tinha 2FA (veio migrado), a Meta pode exigir o MESMO pin (erro de
// mismatch) — nesse caso desabilitar a verificacao em duas etapas antes e repetir.
export async function registerMetaWhatsAppPhoneNumber({
  config = getMetaWhatsAppOutboundConfig(),
  phoneNumberId,
  pin,
}: {
  config?: MetaWhatsAppOutboundConfig;
  phoneNumberId: string;
  pin: string;
}): Promise<MetaWhatsAppSubscribeResult> {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const normalizedPhoneNumberId = readEnvValue(phoneNumberId);
  const normalizedPin = readEnvValue(pin) ?? "";

  if (!accessToken || !graphVersion) {
    throw new MetaWhatsAppSendError(
      "Configuracao Meta WhatsApp incompleta para registrar o numero.",
      503,
    );
  }

  if (!normalizedPhoneNumberId) {
    throw new MetaWhatsAppSendError("phone_number_id ausente.", 400);
  }

  if (!/^\d{6}$/.test(normalizedPin)) {
    throw new MetaWhatsAppSendError(
      "PIN invalido — precisa ter exatamente 6 digitos.",
      400,
    );
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${normalizedPhoneNumberId}/register`,
    {
      body: JSON.stringify({
        messaging_product: "whatsapp",
        pin: normalizedPin,
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
    | { error?: { code?: unknown; message?: unknown }; success?: boolean }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou o registro do numero.",
      response.status,
      {
        code: normalizeErrorCode(payload?.error?.code),
        details: payload?.error ?? null,
      },
    );
  }

  return {
    raw: payload,
    success: payload?.success === true,
  };
}

// O WhatsApp usa *negrito* (UM asterisco), _italico_, ~tachado~ — NAO o Markdown com
// **negrito**. Os modelos (Cacá/Athena) e os operadores escrevem em Markdown, e o
// WhatsApp mostra os asteriscos/underscores literais sem formatar. Esta funcao converte
// a formatacao Markdown mais comum para a sintaxe do WhatsApp ANTES de enviar, para o
// negrito (e afins) aparecer certo no cliente. Roda no ponto unico de envio de texto.
export function toWhatsAppFormatting(input: string): string {
  return (
    input
      // Cabecalhos Markdown (## Titulo) viram negrito do WhatsApp, sem o #.
      .replace(/^\s{0,3}#{1,6}[ \t]+(.+?)[ \t]*$/gm, "*$1*")
      // **negrito** e __negrito__ (Markdown) -> *negrito* (WhatsApp).
      .replace(/\*\*(.+?)\*\*/gs, "*$1*")
      .replace(/__(.+?)__/gs, "*$1*")
  );
}

export async function sendMetaWhatsAppTextMessage({
  body,
  config = getMetaWhatsAppOutboundConfig(),
  contextMessageId,
  to,
}: {
  body: string;
  config?: MetaWhatsAppOutboundConfig;
  contextMessageId?: string | null;
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
        ...(contextMessageId
          ? { context: { message_id: contextMessageId } }
          : {}),
        messaging_product: "whatsapp",
        recipient_type: "individual",
        text: {
          body: toWhatsAppFormatting(body),
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
        error?: { code?: unknown; message?: unknown; type?: unknown };
        messages?: Array<{ id?: unknown }>;
      }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou o envio.",
      response.status,
      {
        code: normalizeErrorCode(payload?.error?.code),
        details: payload?.error ?? null,
      },
    );
  }

  return {
    contactWaId: normalizeText(payload?.contacts?.[0]?.wa_id),
    messageId: normalizeText(payload?.messages?.[0]?.id),
    raw: payload,
  };
}

export async function downloadMetaWhatsAppMedia({
  config = getMetaWhatsAppOutboundConfig(),
  mediaId,
}: {
  config?: MetaWhatsAppOutboundConfig;
  mediaId: string;
}): Promise<MetaWhatsAppDownloadedMedia> {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);

  if (!accessToken || !graphVersion) {
    throw new MetaWhatsAppSendError(
      "Configuracao Meta WhatsApp incompleta para leitura de midia.",
      503,
    );
  }

  const metadataResponse = await fetch(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(mediaId)}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "GET",
    },
  );
  const metadata = (await metadataResponse.json().catch(() => null)) as
    | {
        error?: { code?: unknown; message?: unknown; type?: unknown };
        file_size?: unknown;
        mime_type?: unknown;
        sha256?: unknown;
        url?: unknown;
      }
    | null;

  if (!metadataResponse.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(metadata?.error?.message) ??
        "Meta WhatsApp rejeitou a leitura de metadados da midia.",
      metadataResponse.status,
      {
        code: normalizeErrorCode(metadata?.error?.code),
        details: metadata?.error ?? null,
      },
    );
  }

  const mediaUrl = normalizeText(metadata?.url);

  if (!mediaUrl) {
    throw new MetaWhatsAppSendError(
      "Meta WhatsApp nao retornou URL temporaria da midia.",
      502,
    );
  }

  const mediaResponse = await fetch(mediaUrl, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    method: "GET",
  });

  if (!mediaResponse.ok) {
    throw new MetaWhatsAppSendError(
      "Meta WhatsApp rejeitou o download da midia.",
      mediaResponse.status,
    );
  }

  const arrayBuffer = await mediaResponse.arrayBuffer();

  return {
    buffer: Buffer.from(arrayBuffer),
    fileSize: normalizeNumber(metadata?.file_size),
    mimeType: normalizeText(metadata?.mime_type),
    sha256: normalizeText(metadata?.sha256),
  };
}

// Assina a mensagem livre enviada ao cliente com o nome de quem esta atendendo
// (operador ou "Caca"), em negrito do WhatsApp. Vai so no texto enviado ao cliente —
// o cockpit mostra o autor pelo selo, entao o corpo salvo localmente fica sem assinatura.
export function signWhatsAppBody(name: string, body: string): string {
  const cleanName = name.trim();

  if (!cleanName) {
    return body;
  }

  return `*${cleanName}*\n${body}`;
}

// REGRA ÚNICA DE IDENTIDADE DO NÚMERO (Lucas, 30/jun): a "base" de um número BR é
// sempre a mesma — o 9º dígito de celular e o DDI 55 são só formato. A Meta normaliza
// o waId removendo o 9 (e o cadastro do Apolo grava COM o 9), então o MESMO cliente
// chega em dois formatos. Para NUNCA duplicar contato/ticket, toda resolução de
// contato deve casar por TODAS as variantes equivalentes (com/sem 9, com/sem 55).
// Use isto em todo ponto que busca contato por telefone.
export function buildBrazilianPhoneVariants(
  value: string | null | undefined,
): string[] {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";

  if (digits.length < 8) {
    return [];
  }

  const variants = new Set<string>();
  variants.add(digits);

  // Garante uma forma com DDI 55 pra raciocinar sobre DDD + 9º dígito.
  const withCountry =
    digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  variants.add(withCountry);

  // Cruza o 9º dígito de celular (55 + DDD + [9] + 8 dígitos) nos dois sentidos.
  const withoutNinth = /^55(\d{2})9(\d{8})$/.exec(withCountry);
  const withNinth = /^55(\d{2})(\d{8})$/.exec(withCountry);

  if (withoutNinth) {
    variants.add(`55${withoutNinth[1]}${withoutNinth[2]}`);
  }

  if (withNinth) {
    variants.add(`55${withNinth[1]}9${withNinth[2]}`);
  }

  // Também oferece as variantes SEM o DDI 55 (contatos legados sem código de país).
  for (const variant of Array.from(variants)) {
    if (variant.startsWith("55") && variant.length > 11) {
      variants.add(variant.slice(2));
    }
  }

  return Array.from(variants).filter((variant) => variant.length >= 8);
}

export async function sendMetaWhatsAppTemplateMessage({
  bodyParameters = [],
  config = getMetaWhatsAppOutboundConfig(),
  headerMedia,
  language,
  name,
  to,
}: {
  bodyParameters?: string[];
  config?: MetaWhatsAppOutboundConfig;
  headerMedia?: MetaWhatsAppTemplateHeaderMedia | null;
  language: string;
  name: string;
  to: string;
}): Promise<MetaWhatsAppSendMessageResult> {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const phoneNumberId = readEnvValue(config.phoneNumberId);

  if (!accessToken || !graphVersion || !phoneNumberId) {
    throw new MetaWhatsAppSendError(
      "Configuracao outbound Meta WhatsApp incompleta.",
      503,
    );
  }

  const components = [
    ...(headerMedia ? [buildTemplateHeaderMediaComponent(headerMedia)] : []),
    ...(bodyParameters.length
      ? [
          {
            parameters: bodyParameters.map((text) => ({ text, type: "text" })),
            type: "body",
          },
        ]
      : []),
  ];

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
    {
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        template: {
          components,
          language: { code: language },
          name,
        },
        to,
        type: "template",
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
        error?: { code?: unknown; message?: unknown; type?: unknown };
        messages?: Array<{ id?: unknown }>;
      }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou o envio do template.",
      response.status,
      {
        code: normalizeErrorCode(payload?.error?.code),
        details: payload?.error ?? null,
      },
    );
  }

  return {
    contactWaId: normalizeText(payload?.contacts?.[0]?.wa_id),
    messageId: normalizeText(payload?.messages?.[0]?.id),
    raw: payload,
  };
}

export async function listMetaWhatsAppMessageTemplates({
  config = getMetaWhatsAppOutboundConfig(),
  language,
  limit = 20,
  name,
  phoneNumberId,
}: {
  config?: MetaWhatsAppOutboundConfig;
  language?: string | null;
  limit?: number;
  name?: string | null;
  phoneNumberId?: string | null;
} = {}): Promise<MetaWhatsAppTemplateSummary[]> {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const scope = await resolveMetaWhatsAppTemplateScope({
    config,
    phoneNumberId,
  });

  if (!accessToken || !graphVersion || !scope.whatsappBusinessAccountId) {
    throw new MetaWhatsAppSendError(
      "Configuracao de templates Meta WhatsApp incompleta.",
      503,
    );
  }

  const requestedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
  const pageLimit = Math.min(requestedLimit, 100);
  const normalizedName = normalizeMetaTemplateLookupName(name);
  const normalizedLanguage = normalizeMetaTemplateLookupLanguage(language);
  const templates: MetaWhatsAppTemplateSummary[] = [];
  let after: string | null = null;

  for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
    const searchParams = new URLSearchParams({
      fields: "id,name,status,category,language,components",
      limit: String(pageLimit),
    });

    if (after) {
      searchParams.set("after", after);
    }

    const page = await listMetaWhatsAppMessageTemplatesByNode({
      accessToken,
      graphVersion,
      nodeId: scope.whatsappBusinessAccountId,
      searchParams,
    });

    for (const template of page.templates) {
      const templateName = normalizeMetaTemplateLookupName(template.name);
      const templateLanguage = normalizeMetaTemplateLookupLanguage(
        template.language,
      );

      if (normalizedName && templateName !== normalizedName) {
        continue;
      }

      if (normalizedLanguage && templateLanguage !== normalizedLanguage) {
        continue;
      }

      templates.push(template);

      if (templates.length >= requestedLimit) {
        break;
      }
    }

    if (templates.length >= requestedLimit) {
      break;
    }

    if (normalizedName && templates.length > 0) {
      break;
    }

    if (!page.nextAfter || page.templates.length === 0) {
      break;
    }

    after = page.nextAfter;
  }

  return templates;
}

export async function uploadMetaWhatsAppTemplateHeaderMedia({
  config = getMetaWhatsAppOutboundConfig(),
  fileBuffer,
  fileLength,
  fileName,
  mimeType,
}: {
  config?: MetaWhatsAppOutboundConfig;
  fileBuffer: Buffer;
  fileLength: number;
  fileName: string;
  mimeType: string;
}): Promise<MetaWhatsAppTemplateHeaderMediaUploadResult> {
  const accessToken = readEnvValue(config.accessToken);
  const appId = readEnvValue(config.appId);
  const graphVersion = normalizeGraphVersion(config.graphVersion);

  if (!accessToken || !appId || !graphVersion) {
    throw new MetaWhatsAppSendError(
      "Configuracao de upload de midia para templates Meta incompleta.",
      503,
    );
  }

  const sessionParams = new URLSearchParams({
    file_length: String(fileLength),
    file_name: fileName,
    file_type: mimeType,
  });
  const sessionResponse = await fetch(
    `https://graph.facebook.com/${graphVersion}/${appId}/uploads?${sessionParams.toString()}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `OAuth ${accessToken}`,
      },
      method: "POST",
    },
  );
  const sessionPayload = (await sessionResponse.json().catch(() => null)) as
    | {
        error?: { code?: unknown; message?: unknown; type?: unknown };
        id?: unknown;
      }
    | null;

  if (!sessionResponse.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(sessionPayload?.error?.message) ??
        "Meta WhatsApp rejeitou o inicio do upload da midia.",
      sessionResponse.status,
      {
        code: normalizeErrorCode(sessionPayload?.error?.code),
        details: sessionPayload?.error ?? null,
      },
    );
  }

  const uploadSessionId = normalizeText(sessionPayload?.id);

  if (!uploadSessionId) {
    throw new MetaWhatsAppSendError(
      "Meta WhatsApp nao retornou a sessao de upload da midia.",
      502,
    );
  }

  const uploadResponse = await fetch(
    `https://graph.facebook.com/${graphVersion}/${uploadSessionId}`,
    {
      body: fileBuffer as unknown as BodyInit,
      cache: "no-store",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        "Content-Type": mimeType,
        file_offset: "0",
      },
      method: "POST",
    },
  );
  const uploadPayload = (await uploadResponse.json().catch(() => null)) as
    | {
        error?: { code?: unknown; message?: unknown; type?: unknown };
        h?: unknown;
      }
    | null;

  if (!uploadResponse.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(uploadPayload?.error?.message) ??
        "Meta WhatsApp rejeitou o upload da midia.",
      uploadResponse.status,
      {
        code: normalizeErrorCode(uploadPayload?.error?.code),
        details: uploadPayload?.error ?? null,
      },
    );
  }

  return {
    handle: normalizeText(uploadPayload?.h),
    raw: uploadPayload,
    uploadSessionId,
  };
}

// WABAs adicionais consultadas ao listar telefones de envio (multi-WABA). O 4143
// (atendimento) vive na WABA da Elife, separada da WABA padrao (Panteon). Pode
// ser estendido via env META_WHATSAPP_EXTRA_BUSINESS_ACCOUNT_IDS (CSV) sem deploy.
const META_WHATSAPP_EXTRA_BUSINESS_ACCOUNT_IDS = ["1278786467773434"];

function readExtraBusinessAccountIds(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = readEnvValue(env.META_WHATSAPP_EXTRA_BUSINESS_ACCOUNT_IDS);
  const fromEnv = raw ? raw.split(",").map((value) => value.trim()) : [];
  return uniqueTextValues([
    ...fromEnv,
    ...META_WHATSAPP_EXTRA_BUSINESS_ACCOUNT_IDS,
  ]);
}

export async function listMetaWhatsAppPhoneNumbers({
  config = getMetaWhatsAppOutboundConfig(),
}: {
  config?: MetaWhatsAppOutboundConfig;
} = {}): Promise<MetaWhatsAppPhoneNumberSummary[]> {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const configuredBusinessAccountId = readEnvValue(
    config.whatsappBusinessAccountId,
  );
  const configuredDisplayPhoneNumber = normalizeMetaDisplayPhoneNumber(
    config.phoneDisplayNumber,
  );
  const configuredPhoneNumberId = readEnvValue(config.phoneNumberId);
  const phoneBusinessAccountId = await readMetaWhatsAppPhoneBusinessAccountId({
    config,
  });
  const businessAccountIds = uniqueTextValues([
    phoneBusinessAccountId,
    configuredBusinessAccountId,
    ...readExtraBusinessAccountIds(),
  ]);

  if (!accessToken || !graphVersion || !businessAccountIds.length) {
    throw new MetaWhatsAppSendError(
      "Configuracao de telefones Meta WhatsApp incompleta.",
      503,
    );
  }

  const phoneNumbers: MetaWhatsAppPhoneNumberSummary[] = [];
  const seen = new Set<string>();
  let lastUnsupportedNodeError: MetaWhatsAppSendError | null = null;

  for (const businessAccountId of businessAccountIds) {
    let businessPhoneNumbers: MetaWhatsAppPhoneNumberSummary[];

    try {
      businessPhoneNumbers = await listMetaWhatsAppPhoneNumbersByBusiness({
        accessToken,
        businessAccountId,
        configuredDisplayPhoneNumber,
        configuredPhoneNumberId,
        graphVersion,
      });
    } catch (error) {
      if (isMetaUnsupportedObjectError(error)) {
        lastUnsupportedNodeError =
          error instanceof MetaWhatsAppSendError ? error : null;
        continue;
      }

      throw error;
    }

    for (const phoneNumber of businessPhoneNumbers) {
      if (seen.has(phoneNumber.id)) {
        continue;
      }

      seen.add(phoneNumber.id);
      phoneNumbers.push(phoneNumber);
    }
  }

  if (
    configuredPhoneNumberId &&
    !phoneNumbers.some((phoneNumber) => phoneNumber.id === configuredPhoneNumberId)
  ) {
    const fallbackPhoneNumber = await readMetaWhatsAppPhoneNumberSummary({
      config,
      configuredDisplayPhoneNumber,
      phoneNumberId: configuredPhoneNumberId,
    });

    phoneNumbers.unshift(
      fallbackPhoneNumber ??
        createConfiguredMetaPhoneNumberSummary({
          displayPhoneNumber: configuredDisplayPhoneNumber,
          phoneNumberId: configuredPhoneNumberId,
          whatsappBusinessAccountId:
            phoneBusinessAccountId ?? configuredBusinessAccountId,
        }),
    );
  }

  if (!phoneNumbers.length && lastUnsupportedNodeError) {
    throw createMetaTemplateAccessError(lastUnsupportedNodeError);
  }

  const enrichedPhoneNumbers = await enrichMetaWhatsAppPhoneNumbers({
    config,
    configuredDisplayPhoneNumber,
    phoneNumbers,
  });

  return enrichedPhoneNumbers.sort((left, right) => {
    if (left.isDefault !== right.isDefault) {
      return left.isDefault ? -1 : 1;
    }

    return left.label.localeCompare(right.label, "pt-BR");
  });
}

function buildTemplateHeaderMediaComponent(
  headerMedia: MetaWhatsAppTemplateHeaderMedia,
) {
  const mediaId = normalizeText(headerMedia.id);
  const mediaLink = normalizeText(headerMedia.link);

  if (!mediaId && !mediaLink) {
    throw new MetaWhatsAppSendError(
      "Template com midia precisa de id ou URL publica para envio.",
      400,
      {
        code: "IRIS_TEMPLATE_MEDIA_MISSING",
      },
    );
  }

  const mediaPayload = {
    ...(mediaId ? { id: mediaId } : { link: mediaLink }),
    ...(headerMedia.type === "document" && headerMedia.fileName
      ? { filename: headerMedia.fileName }
      : {}),
  };

  return {
    parameters: [
      {
        [headerMedia.type]: mediaPayload,
        type: headerMedia.type,
      },
    ],
    type: "header",
  };
}

export async function getMetaWhatsAppPhoneNumberLinkStatus({
  config = getMetaWhatsAppOutboundConfig(),
}: {
  config?: MetaWhatsAppOutboundConfig;
} = {}): Promise<MetaWhatsAppPhoneNumberLinkStatus> {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const phoneNumberId = readEnvValue(config.phoneNumberId);
  const whatsappBusinessAccountId = readEnvValue(
    config.whatsappBusinessAccountId,
  );
  const phoneBusinessAccountId = await readMetaWhatsAppPhoneBusinessAccountId({
    config,
  });

  if (!accessToken || !graphVersion || !phoneNumberId) {
    return {
      configured: false,
      linked: null,
      phoneBusinessAccountDetected: Boolean(phoneBusinessAccountId),
      phoneCount: null,
      templateBusinessAccountSource: "missing_config",
    };
  }

  const templateBusinessAccountId =
    phoneBusinessAccountId ?? whatsappBusinessAccountId;

  if (!templateBusinessAccountId) {
    return {
      configured: false,
      linked: null,
      phoneBusinessAccountDetected: Boolean(phoneBusinessAccountId),
      phoneCount: null,
      templateBusinessAccountSource: "missing_config",
    };
  }

  const searchParams = new URLSearchParams({
    fields: "id",
    limit: "100",
  });
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${templateBusinessAccountId}/phone_numbers?${searchParams.toString()}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        data?: Array<Record<string, unknown>>;
        error?: { code?: unknown; message?: unknown; type?: unknown };
      }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou a validacao do telefone de envio.",
      response.status,
      {
        code: normalizeErrorCode(payload?.error?.code),
        details: payload?.error ?? null,
      },
    );
  }

  const phoneNumberIds = Array.isArray(payload?.data)
    ? payload.data.map((phoneNumber) => normalizeText(phoneNumber.id))
    : [];

  return {
    configured: true,
    linked: phoneNumberIds.includes(phoneNumberId),
    phoneBusinessAccountDetected: Boolean(phoneBusinessAccountId),
    phoneCount: phoneNumberIds.length,
    templateBusinessAccountSource: phoneBusinessAccountId
      ? "phone"
      : "configured",
  };
}

export async function createMetaWhatsAppMessageTemplate({
  category,
  components,
  config = getMetaWhatsAppOutboundConfig(),
  language,
  name,
  phoneNumberId,
}: {
  category: "AUTHENTICATION" | "MARKETING" | "UTILITY";
  components: unknown[];
  config?: MetaWhatsAppOutboundConfig;
  language: string;
  name: string;
  phoneNumberId?: string | null;
}): Promise<MetaWhatsAppCreateTemplateResult> {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const scope = await resolveMetaWhatsAppTemplateScope({
    config,
    phoneNumberId,
  });

  if (!accessToken || !graphVersion || !scope.whatsappBusinessAccountId) {
    throw new MetaWhatsAppSendError(
      "Configuracao de templates Meta WhatsApp incompleta.",
      503,
    );
  }

  return createMetaWhatsAppMessageTemplateByNode({
    accessToken,
    category,
    components,
    graphVersion,
    language,
    name,
    nodeId: scope.whatsappBusinessAccountId,
  });
}

async function createMetaWhatsAppMessageTemplateByNode({
  accessToken,
  category,
  components,
  graphVersion,
  language,
  name,
  nodeId,
}: {
  accessToken: string;
  category: "AUTHENTICATION" | "MARKETING" | "UTILITY";
  components: unknown[];
  graphVersion: string;
  language: string;
  name: string;
  nodeId: string;
}) {
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${nodeId}/message_templates`,
    {
      body: JSON.stringify({
        category,
        components,
        language,
        name,
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
        category?: unknown;
        error?: { code?: unknown; message?: unknown; type?: unknown };
        id?: unknown;
        name?: unknown;
        status?: unknown;
      }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou a criacao do template.",
      response.status,
      {
        code: normalizeErrorCode(payload?.error?.code),
        details: payload?.error ?? null,
      },
    );
  }

  return {
    category: normalizeText(payload?.category) ?? category,
    id: normalizeText(payload?.id),
    name: normalizeText(payload?.name) ?? name,
    raw: payload,
    status: normalizeText(payload?.status),
  };
}

async function readMetaWhatsAppPhoneBusinessAccountId({
  config,
}: {
  config: MetaWhatsAppOutboundConfig;
}) {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const phoneNumberId = readEnvValue(config.phoneNumberId);

  if (!accessToken || !graphVersion || !phoneNumberId) {
    return null;
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}?fields=id,whatsapp_business_account`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        error?: { code?: unknown; message?: unknown; type?: unknown };
        whatsapp_business_account?: { id?: unknown };
      }
    | null;

  if (!response.ok) {
    return null;
  }

  return normalizeText(payload?.whatsapp_business_account?.id);
}

async function listMetaWhatsAppMessageTemplatesByNode({
  accessToken,
  graphVersion,
  nodeId,
  searchParams,
}: {
  accessToken: string;
  graphVersion: string;
  nodeId: string;
  searchParams: URLSearchParams;
}): Promise<{
  nextAfter: string | null;
  templates: MetaWhatsAppTemplateSummary[];
}> {
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${nodeId}/message_templates?${searchParams.toString()}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        data?: Array<Record<string, unknown>>;
        error?: { code?: unknown; message?: unknown; type?: unknown };
        paging?: {
          cursors?: {
            after?: unknown;
          };
        };
      }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou a consulta de templates.",
      response.status,
      {
        code: normalizeErrorCode(payload?.error?.code),
        details: payload?.error ?? null,
      },
    );
  }

  return {
    nextAfter: normalizeText(payload?.paging?.cursors?.after),
    templates: Array.isArray(payload?.data)
      ? payload.data.map((template) => ({
          category: normalizeText(template.category),
          components: template.components ?? null,
          id: normalizeText(template.id),
          language: normalizeText(template.language),
          name: normalizeText(template.name),
          status: normalizeText(template.status),
        }))
      : [],
  };
}

function normalizeMetaTemplateLookupName(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/-/g, "_");

  return normalized || null;
}

function normalizeMetaTemplateLookupLanguage(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized || null;
}

async function resolveMetaWhatsAppTemplateScope({
  config,
  phoneNumberId,
}: {
  config: MetaWhatsAppOutboundConfig;
  phoneNumberId?: string | null;
}) {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const requestedPhoneNumberId = readEnvValue(phoneNumberId ?? undefined);
  const configuredPhoneNumberId = readEnvValue(config.phoneNumberId);
  const selectedPhoneNumberId = requestedPhoneNumberId ?? configuredPhoneNumberId;

  if (!selectedPhoneNumberId) {
    throw new MetaWhatsAppSendError(
      "Selecione o telefone de envio antes de operar templates Meta.",
      400,
      {
        code: "IRIS_TEMPLATE_PHONE_MISSING",
      },
    );
  }

  const selectedConfig = {
    ...config,
    phoneNumberId: selectedPhoneNumberId,
  };
  const phoneBusinessAccountId = await readMetaWhatsAppPhoneBusinessAccountId({
    config: selectedConfig,
  });

  const configuredBusinessAccountId = readEnvValue(
    config.whatsappBusinessAccountId,
  );
  let whatsappBusinessAccountId = phoneBusinessAccountId;
  const templateBusinessAccountSource: MetaWhatsAppPhoneNumberLinkStatus["templateBusinessAccountSource"] =
    phoneBusinessAccountId ? "phone" : "configured";

  if (!whatsappBusinessAccountId && accessToken && graphVersion) {
    // Procura o telefone na WABA configurada (Panteon) E nas extras (Elife/4143)
    // — o {phone}?fields=whatsapp_business_account pode voltar vazio quando o
    // token nao le esse campo no telefone de outra WABA.
    const candidateBusinessAccountIds = uniqueTextValues([
      configuredBusinessAccountId,
      ...readExtraBusinessAccountIds(),
    ]);

    for (const candidateBusinessAccountId of candidateBusinessAccountIds) {
      let candidatePhoneNumbers: MetaWhatsAppPhoneNumberSummary[];

      try {
        candidatePhoneNumbers = await listMetaWhatsAppPhoneNumbersByBusiness({
          accessToken,
          businessAccountId: candidateBusinessAccountId,
          configuredPhoneNumberId,
          graphVersion,
        });
      } catch (error) {
        if (isMetaUnsupportedObjectError(error)) {
          continue;
        }

        throw error;
      }

      if (
        candidatePhoneNumbers.some(
          (phoneNumber) => phoneNumber.id === selectedPhoneNumberId,
        )
      ) {
        whatsappBusinessAccountId = candidateBusinessAccountId;
        break;
      }
    }
  }

  if (
    requestedPhoneNumberId &&
    !whatsappBusinessAccountId
  ) {
    throw new MetaWhatsAppSendError(
      "A Iris nao conseguiu confirmar a WABA do telefone selecionado.",
      400,
      {
        code: "IRIS_TEMPLATE_PHONE_WABA_MISSING",
        details: {
          hint:
            "Selecione um telefone listado com numero real no Setup. A Iris nao deve criar ou consultar template usando WABA diferente do telefone escolhido.",
        },
      },
    );
  }

  if (!whatsappBusinessAccountId) {
    throw new MetaWhatsAppSendError(
      "A Iris nao encontrou a WABA para criar ou consultar templates.",
      503,
      {
        code: "IRIS_TEMPLATE_WABA_MISSING",
      },
    );
  }

  return {
    phoneNumberId: selectedPhoneNumberId,
    templateBusinessAccountSource,
    whatsappBusinessAccountId,
  };
}

async function listMetaWhatsAppPhoneNumbersByBusiness({
  accessToken,
  businessAccountId,
  configuredDisplayPhoneNumber,
  configuredPhoneNumberId,
  graphVersion,
}: {
  accessToken: string;
  businessAccountId: string;
  configuredDisplayPhoneNumber?: string | null;
  configuredPhoneNumberId?: string | null;
  graphVersion: string;
}) {
  const searchParams = new URLSearchParams({
    fields:
      "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status",
    limit: "100",
  });
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${businessAccountId}/phone_numbers?${searchParams.toString()}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        data?: Array<Record<string, unknown>>;
        error?: { code?: unknown; message?: unknown; type?: unknown };
      }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou a consulta de telefones.",
      response.status,
      {
        code: normalizeErrorCode(payload?.error?.code),
        details: payload?.error ?? null,
      },
    );
  }

  return Array.isArray(payload?.data)
    ? payload.data
        .map((phoneNumber) =>
          mapMetaPhoneNumberSummary({
            configuredDisplayPhoneNumber,
            configuredPhoneNumberId,
            phoneNumber,
            whatsappBusinessAccountId: businessAccountId,
          }),
        )
        .filter((phoneNumber): phoneNumber is MetaWhatsAppPhoneNumberSummary =>
          Boolean(phoneNumber),
        )
    : [];
}

async function enrichMetaWhatsAppPhoneNumbers({
  config,
  configuredDisplayPhoneNumber,
  phoneNumbers,
}: {
  config: MetaWhatsAppOutboundConfig;
  configuredDisplayPhoneNumber?: string | null;
  phoneNumbers: MetaWhatsAppPhoneNumberSummary[];
}) {
  const enrichedPhoneNumbers: MetaWhatsAppPhoneNumberSummary[] = [];

  for (const phoneNumber of phoneNumbers) {
    if (phoneNumber.displayPhoneNumber) {
      enrichedPhoneNumbers.push(phoneNumber);
      continue;
    }

    const detail = await readMetaWhatsAppPhoneNumberSummary({
      config,
      configuredDisplayPhoneNumber,
      phoneNumberId: phoneNumber.id,
    });

    enrichedPhoneNumbers.push(
      detail ? mergeMetaPhoneNumberSummary(phoneNumber, detail) : phoneNumber,
    );
  }

  return enrichedPhoneNumbers;
}

async function readMetaWhatsAppPhoneNumberSummary({
  config,
  configuredDisplayPhoneNumber,
  phoneNumberId,
}: {
  config: MetaWhatsAppOutboundConfig;
  configuredDisplayPhoneNumber?: string | null;
  phoneNumberId: string;
}) {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const configuredPhoneNumberId = readEnvValue(config.phoneNumberId);

  if (!accessToken || !graphVersion) {
    return null;
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,whatsapp_business_account`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | (Record<string, unknown> & {
        error?: { code?: unknown; message?: unknown; type?: unknown };
        whatsapp_business_account?: { id?: unknown };
      })
    | null;

  if (!response.ok || !payload) {
    return null;
  }

  return mapMetaPhoneNumberSummary({
    configuredDisplayPhoneNumber,
    configuredPhoneNumberId,
    phoneNumber: payload,
    whatsappBusinessAccountId: normalizeText(
      payload.whatsapp_business_account?.id,
    ),
  });
}

function mergeMetaPhoneNumberSummary(
  base: MetaWhatsAppPhoneNumberSummary,
  detail: MetaWhatsAppPhoneNumberSummary,
): MetaWhatsAppPhoneNumberSummary {
  const displayPhoneNumber =
    detail.displayPhoneNumber ?? base.displayPhoneNumber ?? null;
  const verifiedName = detail.verifiedName ?? base.verifiedName ?? null;

  return {
    codeVerificationStatus:
      detail.codeVerificationStatus ?? base.codeVerificationStatus,
    displayPhoneNumber,
    id: base.id,
    isDefault: base.isDefault || detail.isDefault,
    label:
      (base.isDefault || detail.isDefault) && !displayPhoneNumber && !verifiedName
        ? `Telefone configurado da Iris (${formatMetaNodeIdSuffix(base.id)})`
        : buildMetaPhoneNumberLabel({
            displayPhoneNumber,
            id: base.id,
            verifiedName,
          }),
    nameStatus: detail.nameStatus ?? base.nameStatus,
    qualityRating: detail.qualityRating ?? base.qualityRating,
    verifiedName,
    whatsappBusinessAccountId:
      detail.whatsappBusinessAccountId ?? base.whatsappBusinessAccountId,
  };
}

function mapMetaPhoneNumberSummary({
  configuredDisplayPhoneNumber,
  configuredPhoneNumberId,
  phoneNumber,
  whatsappBusinessAccountId,
}: {
  configuredDisplayPhoneNumber?: string | null;
  configuredPhoneNumberId?: string | null;
  phoneNumber: Record<string, unknown>;
  whatsappBusinessAccountId?: string | null;
}) {
  const id = normalizeText(phoneNumber.id);

  if (!id) {
    return null;
  }

  const isDefault = Boolean(configuredPhoneNumberId && id === configuredPhoneNumberId);
  const displayPhoneNumber =
    normalizeText(phoneNumber.display_phone_number) ??
    (isDefault ? normalizeMetaDisplayPhoneNumber(configuredDisplayPhoneNumber) : null);
  const verifiedName = normalizeText(phoneNumber.verified_name);
  const label =
    isDefault && !displayPhoneNumber && !verifiedName
      ? `Telefone configurado da Iris (${formatMetaNodeIdSuffix(id)})`
      : buildMetaPhoneNumberLabel({
          displayPhoneNumber,
          id,
          verifiedName,
        });

  return {
    codeVerificationStatus: normalizeText(phoneNumber.code_verification_status),
    displayPhoneNumber,
    id,
    isDefault,
    label,
    nameStatus: normalizeText(phoneNumber.name_status),
    qualityRating: normalizeText(phoneNumber.quality_rating),
    verifiedName,
    whatsappBusinessAccountId: normalizeText(whatsappBusinessAccountId),
  };
}

function buildMetaPhoneNumberLabel({
  displayPhoneNumber,
  id,
  verifiedName,
}: {
  displayPhoneNumber?: string | null;
  id: string;
  verifiedName?: string | null;
}) {
  const display = normalizeMetaDisplayPhoneNumber(displayPhoneNumber);
  const name = normalizeText(verifiedName);

  return (
    [display, name].filter(Boolean).join(" - ") ||
    `Telefone sem numero (${formatMetaNodeIdSuffix(id)})`
  );
}

function normalizeMetaDisplayPhoneNumber(value?: string | null) {
  const normalized = normalizeText(value);

  if (!normalized) {
    return null;
  }

  const digits = normalized.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  if (normalized.startsWith("+") && normalized.replace(/\D/g, "") === digits) {
    return normalized;
  }

  if (digits.length === 12 && digits.startsWith("55")) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }

  if (digits.length === 13 && digits.startsWith("55")) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }

  return normalized.startsWith("+") ? normalized : `+${digits}`;
}

function createConfiguredMetaPhoneNumberSummary({
  displayPhoneNumber,
  phoneNumberId,
  whatsappBusinessAccountId,
}: {
  displayPhoneNumber?: string | null;
  phoneNumberId: string;
  whatsappBusinessAccountId?: string | null;
}): MetaWhatsAppPhoneNumberSummary {
  const normalizedDisplayPhoneNumber =
    normalizeMetaDisplayPhoneNumber(displayPhoneNumber);

  return {
    codeVerificationStatus: null,
    displayPhoneNumber: normalizedDisplayPhoneNumber,
    id: phoneNumberId,
    isDefault: true,
    label: normalizedDisplayPhoneNumber
      ? buildMetaPhoneNumberLabel({
          displayPhoneNumber: normalizedDisplayPhoneNumber,
          id: phoneNumberId,
          verifiedName: null,
        })
      : `Telefone configurado da Iris (${formatMetaNodeIdSuffix(phoneNumberId)})`,
    nameStatus: null,
    qualityRating: null,
    verifiedName: null,
    whatsappBusinessAccountId: normalizeText(whatsappBusinessAccountId),
  };
}

function formatMetaNodeIdSuffix(value?: string | null) {
  const normalized = normalizeText(value);

  return normalized ? `ID final ${normalized.slice(-4)}` : "ID Meta sem numero";
}

function isMetaUnsupportedObjectError(error: unknown) {
  if (!(error instanceof MetaWhatsAppSendError)) {
    return false;
  }

  if (String(error.code ?? "") !== "100") {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("unsupported post request") ||
    message.includes("unsupported get request") ||
    message.includes("object with id") ||
    message.includes("missing permissions")
  );
}

function createMetaTemplateAccessError(error: MetaWhatsAppSendError) {
  return new MetaWhatsAppSendError(
    "A Meta recusou a operacao no telefone selecionado para templates. Verifique no Meta Manager se o telefone de envio e a WABA estao vinculados ao mesmo app/token da Iris.",
    error.status,
    {
      code: error.code,
      details: error.details,
    },
  );
}

export async function sendMetaWhatsAppAudioMessage({
  audioBase64,
  config = getMetaWhatsAppOutboundConfig(),
  contextMessageId,
  fileName,
  mimeType,
  to,
}: {
  audioBase64: string;
  config?: MetaWhatsAppOutboundConfig;
  contextMessageId?: string | null;
  fileName: string;
  mimeType: string;
  to: string;
}): Promise<MetaWhatsAppSendMessageResult> {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const phoneNumberId = readEnvValue(config.phoneNumberId);

  if (!accessToken || !graphVersion || !phoneNumberId) {
    throw new MetaWhatsAppSendError(
      "Configuracao outbound Meta WhatsApp incompleta.",
      503,
    );
  }

  const mediaId = await uploadMetaWhatsAppAudio({
    accessToken,
    audioBase64,
    fileName,
    graphVersion,
    mimeType,
    phoneNumberId,
  });

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
    {
      body: JSON.stringify({
        audio: {
          id: mediaId,
        },
        ...(contextMessageId
          ? { context: { message_id: contextMessageId } }
          : {}),
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "audio",
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
        error?: { code?: unknown; message?: unknown; type?: unknown };
        messages?: Array<{ id?: unknown }>;
      }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou o envio do audio.",
      response.status,
      {
        code: normalizeErrorCode(payload?.error?.code),
        details: payload?.error ?? null,
      },
    );
  }

  return {
    contactWaId: normalizeText(payload?.contacts?.[0]?.wa_id),
    messageId: normalizeText(payload?.messages?.[0]?.id),
    raw: payload,
  };
}

async function uploadMetaWhatsAppAudio({
  accessToken,
  audioBase64,
  fileName,
  graphVersion,
  mimeType,
  phoneNumberId,
}: {
  accessToken: string;
  audioBase64: string;
  fileName: string;
  graphVersion: string;
  mimeType: string;
  phoneNumberId: string;
}) {
  const bytes = Uint8Array.from(Buffer.from(audioBase64, "base64"));
  const formData = new FormData();

  formData.append("messaging_product", "whatsapp");
  formData.append("type", mimeType);
  formData.append("file", new Blob([bytes], { type: mimeType }), fileName);

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/media`,
    {
      body: formData,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "POST",
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        error?: { code?: unknown; message?: unknown; type?: unknown };
        id?: unknown;
      }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou o upload do audio.",
      response.status,
      {
        code: normalizeErrorCode(payload?.error?.code),
        details: payload?.error ?? null,
      },
    );
  }

  const mediaId = normalizeText(payload?.id);

  if (!mediaId) {
    throw new MetaWhatsAppSendError(
      "Meta WhatsApp nao retornou ID de midia.",
      502,
    );
  }

  return mediaId;
}

// Envio de mídia genérico (imagem/documento/vídeo) — mesmo padrão do áudio: sobe o binário
// pro /media do Meta (pega media_id) e manda a mensagem com o id. A legenda (caption) passa
// pelo normalizador de formatação do WhatsApp (*negrito*). Documento leva o filename.
export async function sendMetaWhatsAppMediaMessage({
  caption,
  config = getMetaWhatsAppOutboundConfig(),
  contextMessageId,
  fileName,
  kind,
  mediaBase64,
  mimeType,
  to,
}: {
  caption?: string | null;
  config?: MetaWhatsAppOutboundConfig;
  contextMessageId?: string | null;
  fileName: string;
  kind: "document" | "image" | "video";
  mediaBase64: string;
  mimeType: string;
  to: string;
}): Promise<MetaWhatsAppSendMessageResult> {
  const accessToken = readEnvValue(config.accessToken);
  const graphVersion = normalizeGraphVersion(config.graphVersion);
  const phoneNumberId = readEnvValue(config.phoneNumberId);

  if (!accessToken || !graphVersion || !phoneNumberId) {
    throw new MetaWhatsAppSendError(
      "Configuracao outbound Meta WhatsApp incompleta.",
      503,
    );
  }

  const mediaId = await uploadMetaWhatsAppMediaFile({
    accessToken,
    base64: mediaBase64,
    fileName,
    graphVersion,
    mimeType,
    phoneNumberId,
  });

  const normalizedCaption =
    typeof caption === "string" && caption.trim()
      ? toWhatsAppFormatting(caption.trim())
      : null;

  const mediaObject: Record<string, unknown> = { id: mediaId };

  // Caption só vale pra imagem/vídeo/documento (o Meta ignora em outros tipos).
  if (normalizedCaption) {
    mediaObject.caption = normalizedCaption;
  }

  // Documento mostra o nome do arquivo pro cliente.
  if (kind === "document") {
    mediaObject.filename = fileName;
  }

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
    {
      body: JSON.stringify({
        [kind]: mediaObject,
        ...(contextMessageId
          ? { context: { message_id: contextMessageId } }
          : {}),
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: kind,
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
        error?: { code?: unknown; message?: unknown; type?: unknown };
        messages?: Array<{ id?: unknown }>;
      }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou o envio do anexo.",
      response.status,
      {
        code: normalizeErrorCode(payload?.error?.code),
        details: payload?.error ?? null,
      },
    );
  }

  return {
    contactWaId: normalizeText(payload?.contacts?.[0]?.wa_id),
    messageId: normalizeText(payload?.messages?.[0]?.id),
    raw: payload,
  };
}

async function uploadMetaWhatsAppMediaFile({
  accessToken,
  base64,
  fileName,
  graphVersion,
  mimeType,
  phoneNumberId,
}: {
  accessToken: string;
  base64: string;
  fileName: string;
  graphVersion: string;
  mimeType: string;
  phoneNumberId: string;
}) {
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  const formData = new FormData();

  formData.append("messaging_product", "whatsapp");
  formData.append("type", mimeType);
  formData.append("file", new Blob([bytes], { type: mimeType }), fileName);

  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/media`,
    {
      body: formData,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      method: "POST",
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        error?: { code?: unknown; message?: unknown; type?: unknown };
        id?: unknown;
      }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou o upload do anexo.",
      response.status,
      {
        code: normalizeErrorCode(payload?.error?.code),
        details: payload?.error ?? null,
      },
    );
  }

  const mediaId = normalizeText(payload?.id);

  if (!mediaId) {
    throw new MetaWhatsAppSendError(
      "Meta WhatsApp nao retornou ID de midia.",
      502,
    );
  }

  return mediaId;
}

export async function sendMetaWhatsAppReactionMessage({
  config = getMetaWhatsAppOutboundConfig(),
  emoji,
  messageId,
  to,
}: {
  config?: MetaWhatsAppOutboundConfig;
  emoji: string;
  messageId: string;
  to: string;
}): Promise<MetaWhatsAppSendMessageResult> {
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
        reaction: {
          emoji,
          message_id: messageId,
        },
        recipient_type: "individual",
        to,
        type: "reaction",
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
        error?: { code?: unknown; message?: unknown; type?: unknown };
        messages?: Array<{ id?: unknown }>;
      }
    | null;

  if (!response.ok) {
    throw new MetaWhatsAppSendError(
      normalizeText(payload?.error?.message) ??
        "Meta WhatsApp rejeitou a reacao.",
      response.status,
      {
        code: normalizeErrorCode(payload?.error?.code),
        details: payload?.error ?? null,
      },
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

function uniqueTextValues(values: Array<string | null | undefined>) {
  const seen = new Set<string>();

  return values
    .map((value) => normalizeText(value))
    .filter((value): value is string => {
      if (!value || seen.has(value)) {
        return false;
      }

      seen.add(value);
      return true;
    });
}

function normalizeErrorCode(value: unknown) {
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }

  return null;
}

function normalizeNumber(value: unknown) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function readEnvValue(value: string | undefined) {
  const normalizedValue = value?.trim();

  return normalizedValue ? normalizedValue : undefined;
}

function normalizeGraphVersion(value: string | undefined) {
  const normalizedValue = readEnvValue(value)?.replace(/^\/+|\/+$/g, "");

  return normalizedValue || undefined;
}
