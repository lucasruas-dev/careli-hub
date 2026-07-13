// Cliente Gmail da Iris — motor de leitura/envio de e-mail das caixas compartilhadas
// (Grupos do Workspace) via a caixa robô `caca@careli.adm.br`.
//
// Autenticação: OAuth com REFRESH TOKEN da própria caca@ — mesmo padrão que o Chronos usa
// pro Google Agenda (a org bloqueia chave de service account por segurança, então nada de
// chave baixável). A caca@ autoriza uma vez (gmail.modify + gmail.send) e a Iris guarda o
// refresh token; a cada chamada troca por um access_token. Como o token é da própria caca@,
// as chamadas usam `users/me` (a caixa que recebe cópia de todos os grupos). Fetch cru, sem
// dependência googleapis. Ver [[project-iris-email-grupos]].
//
// Segredos (env): GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.
// Nunca hard-coded, nunca logados.

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
];

// Caixa robô (membro dos grupos). Usada só como remetente/rótulo — a leitura é sempre "me".
const DEFAULT_INGEST_MAILBOX = "caca@careli.adm.br";

type GmailMessageAttachment = {
  attachmentId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type ParsedGmailMessage = {
  attachments: GmailMessageAttachment[];
  bodyHtml: string | null;
  bodyText: string | null;
  date: string | null;
  deliveredTo: string | null;
  fromEmail: string | null;
  fromName: string | null;
  historyId: string | null;
  id: string;
  inReplyTo: string | null;
  labelIds: string[];
  messageIdHeader: string | null;
  references: string | null;
  snippet: string | null;
  subject: string | null;
  threadId: string;
  to: string | null;
};

type GmailApiMessage = {
  historyId?: string;
  id?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailApiPart;
  snippet?: string;
  threadId?: string;
};

type GmailApiPart = {
  body?: { attachmentId?: string; data?: string; size?: number };
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  mimeType?: string;
  parts?: GmailApiPart[];
};

// --- Config / credencial ---

export function getGmailIngestMailbox(): string {
  return process.env.GMAIL_INGEST_MAILBOX?.trim() || DEFAULT_INGEST_MAILBOX;
}

function readGmailOAuthConfig(): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} | null {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return { clientId, clientSecret, refreshToken };
}

export function isGmailConfigured(): boolean {
  return Boolean(readGmailOAuthConfig());
}

// --- Token (OAuth refresh token da caca@) ---

let cachedToken: { expiresAt: number; token: string } | null = null;

async function getGmailAccessToken(): Promise<string> {
  const config = readGmailOAuthConfig();

  if (!config) {
    throw new Error(
      "Gmail OAuth nao configurado (GMAIL_OAUTH_CLIENT_ID/SECRET + GMAIL_REFRESH_TOKEN).",
    );
  }

  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && cachedToken.expiresAt - 60 > now) {
    return cachedToken.token;
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
    }),
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    error?: string;
    error_description?: string;
    expires_in?: number;
  } | null;

  if (!response.ok || !payload?.access_token) {
    throw new Error(
      `Gmail token falhou (${response.status}): ${
        payload?.error_description ?? payload?.error ?? "sem detalhe"
      }`,
    );
  }

  cachedToken = {
    expiresAt: now + (payload.expires_in ?? 3600),
    token: payload.access_token,
  };

  return payload.access_token;
}

async function gmailFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getGmailAccessToken();
  const response = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");

    throw new Error(`Gmail API ${path} falhou (${response.status}): ${detail.slice(0, 300)}`);
  }

  return (await response.json()) as T;
}

// --- Leitura ---

// Lista ids de mensagens da caixa (query estilo Gmail, ex.: "is:unread"), mais recente
// primeiro. Retorna ids + threadIds.
export async function listGmailMessageIds({
  maxResults = 25,
  query = "is:unread",
}: {
  maxResults?: number;
  query?: string;
} = {}): Promise<Array<{ id: string; threadId: string }>> {
  const params = new URLSearchParams({
    maxResults: String(maxResults),
    q: query,
  });
  const data = await gmailFetch<{
    messages?: Array<{ id?: string; threadId?: string }>;
  }>(`/messages?${params.toString()}`);

  return (data.messages ?? [])
    .filter((message): message is { id: string; threadId: string } =>
      Boolean(message.id && message.threadId),
    )
    .map((message) => ({ id: message.id, threadId: message.threadId }));
}

export async function getGmailMessage(id: string): Promise<ParsedGmailMessage> {
  const message = await gmailFetch<GmailApiMessage>(
    `/messages/${encodeURIComponent(id)}?format=full`,
  );

  return parseGmailMessage(message);
}

function parseGmailMessage(message: GmailApiMessage): ParsedGmailMessage {
  const headers = message.payload?.headers ?? [];
  const from = getHeader(headers, "From");
  const parsedFrom = parseAddress(from);
  const bodies = { html: null as string | null, text: null as string | null };
  const attachments: GmailMessageAttachment[] = [];

  walkParts(message.payload, bodies, attachments);

  const internalDate = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : null;

  return {
    attachments,
    bodyHtml: bodies.html,
    bodyText: bodies.text,
    date: getHeader(headers, "Date") ?? internalDate,
    deliveredTo: getHeader(headers, "Delivered-To") ?? getHeader(headers, "To"),
    fromEmail: parsedFrom.email,
    fromName: parsedFrom.name,
    historyId: message.historyId ?? null,
    id: message.id ?? "",
    inReplyTo: getHeader(headers, "In-Reply-To"),
    labelIds: message.labelIds ?? [],
    messageIdHeader: getHeader(headers, "Message-ID") ?? getHeader(headers, "Message-Id"),
    references: getHeader(headers, "References"),
    snippet: message.snippet ?? null,
    subject: getHeader(headers, "Subject"),
    threadId: message.threadId ?? "",
    to: getHeader(headers, "To"),
  };
}

function walkParts(
  part: GmailApiPart | undefined,
  bodies: { html: string | null; text: string | null },
  attachments: GmailMessageAttachment[],
): void {
  if (!part) {
    return;
  }

  const mimeType = part.mimeType ?? "";
  const filename = part.filename ?? "";

  // Anexo: tem nome de arquivo (guardamos só o metadado; o download vem depois, sob demanda).
  if (filename && part.body?.attachmentId) {
    attachments.push({
      attachmentId: part.body.attachmentId,
      filename,
      mimeType: mimeType || "application/octet-stream",
      sizeBytes: part.body.size ?? 0,
    });
  } else if (mimeType === "text/plain" && part.body?.data && !bodies.text) {
    bodies.text = decodeBase64Url(part.body.data);
  } else if (mimeType === "text/html" && part.body?.data && !bodies.html) {
    bodies.html = decodeBase64Url(part.body.data);
  }

  for (const child of part.parts ?? []) {
    walkParts(child, bodies, attachments);
  }
}

// --- Envio ---

// Envia (ou responde) um e-mail pela caixa. Para responder no MESMO thread, passe threadId +
// inReplyTo (o Message-ID original) + references. `from` deve ser um endereço que a caixa tem
// permissao de enviar (a propria caca@, ou um alias/Send-As do grupo).
export async function sendGmailMessage({
  bodyText,
  from = getGmailIngestMailbox(),
  inReplyTo,
  references,
  subjectLine,
  threadId,
  to,
}: {
  bodyText: string;
  from?: string;
  inReplyTo?: string | null;
  references?: string | null;
  subjectLine: string;
  threadId?: string | null;
  to: string;
}): Promise<{ id: string; threadId: string }> {
  const headerLines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subjectLine)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];

  if (inReplyTo) {
    headerLines.push(`In-Reply-To: ${inReplyTo}`);
    headerLines.push(`References: ${references ? `${references} ${inReplyTo}` : inReplyTo}`);
  }

  const rawMessage = `${headerLines.join("\r\n")}\r\n\r\n${bodyText}`;
  const data = await gmailFetch<{ id?: string; threadId?: string }>(
    "/messages/send",
    {
      body: JSON.stringify({
        raw: base64Url(rawMessage),
        ...(threadId ? { threadId } : {}),
      }),
      method: "POST",
    },
  );

  return { id: data.id ?? "", threadId: data.threadId ?? threadId ?? "" };
}

// --- Rótulos / marcar lido ---

export async function modifyGmailMessage({
  addLabelIds = [],
  id,
  removeLabelIds = [],
}: {
  addLabelIds?: string[];
  id: string;
  removeLabelIds?: string[];
}): Promise<void> {
  await gmailFetch(`/messages/${encodeURIComponent(id)}/modify`, {
    body: JSON.stringify({ addLabelIds, removeLabelIds }),
    method: "POST",
  });
}

export async function markGmailMessageRead(id: string): Promise<void> {
  await modifyGmailMessage({ id, removeLabelIds: ["UNREAD"] });
}

// Teste de fumaça: confirma que o refresh token funciona lendo o perfil da caixa.
export async function probeGmailMailbox(): Promise<{
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
}> {
  return gmailFetch<{
    emailAddress: string;
    messagesTotal: number;
    threadsTotal: number;
  }>("/profile");
}

// --- helpers ---

function base64Url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input) : input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function getHeader(
  headers: Array<{ name?: string; value?: string }>,
  name: string,
): string | null {
  const target = name.toLowerCase();
  const found = headers.find((header) => header.name?.toLowerCase() === target);

  return found?.value?.trim() || null;
}

function parseAddress(value: string | null): {
  email: string | null;
  name: string | null;
} {
  if (!value) {
    return { email: null, name: null };
  }

  const match = /^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(value);

  if (match) {
    return {
      email: match[2]?.trim().toLowerCase() ?? null,
      name: match[1]?.trim() || null,
    };
  }

  const trimmed = value.trim();

  return {
    email: /@/.test(trimmed) ? trimmed.toLowerCase() : null,
    name: null,
  };
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");

  return Buffer.from(normalized, "base64").toString("utf8");
}

// Assunto com acento/UTF-8 -> RFC 2047 (encoded-word) pra não quebrar o header.
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value;
  }

  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}
