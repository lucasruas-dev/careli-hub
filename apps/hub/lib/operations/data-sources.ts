import {
  getServerSupabaseAnonKey,
  getServerSupabaseUrl,
} from "@/lib/supabase/server-config";

export type OperationsSourceGroup =
  | "api"
  | "asaas"
  | "asana"
  | "c2x"
  | "d4sign"
  | "guardian-queue"
  | "meta"
  | "openai"
  | "page"
  | "protected-api"
  | "supabase"
  | "vercel";

export type OperationsRawCheck = {
  checkedAt: string;
  endpoint: string;
  error?: string;
  expected: {
    description: string;
    statusCodes: number[];
  };
  group: OperationsSourceGroup;
  id: string;
  label: string;
  meta?: Record<string, string | number | boolean | null>;
  method: "GET" | "HEAD";
  module: string;
  ok: boolean;
  payloadBytes: number;
  received: string;
  responseMs: number;
  statusCode: number;
};

type CollectOperationsDataSourcesInput = {
  origin: string;
};

type EndpointCheckConfig = {
  endpoint: string;
  expectedDescription: string;
  expectedStatusCodes: number[];
  group: OperationsSourceGroup;
  headers?: HeadersInit;
  id: string;
  label: string;
  method?: "GET" | "HEAD";
  module: string;
  // URL real do fetch quando o segredo precisa ir na query (ex.: D4Sign). Nunca e
  // armazenada/exibida: o estado salvo usa sempre `endpoint` (sanitizado, sem segredo).
  requestUrl?: string;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const QUEUE_TIMEOUT_MS = 8_000;

export async function collectOperationsDataSources({
  origin,
}: CollectOperationsDataSourcesInput) {
  const checks: OperationsRawCheck[] = [];
  const normalizedOrigin = origin.replace(/\/+$/, "");

  checks.push(
    ...(await Promise.all([
      measureEndpoint({
        endpoint: `${normalizedOrigin}/api/hades/db/health`,
        expectedDescription: "200 conectado",
        expectedStatusCodes: [200],
        group: "c2x",
        id: "guardian-db-health",
        label: "C2X DB Health",
        module: "Hades",
      }),
      ...createPageChecks(normalizedOrigin).map(measureEndpoint),
      ...createProtectedEndpointChecks(normalizedOrigin).map(measureEndpoint),
      ...createSupabaseChecks().map(measureEndpoint),
      ...createVercelChecks().map(measureEndpoint),
    ])),
  );

  checks.push(
    ...(await Promise.all([
      ...createAsaasChecks().map(measureEndpoint),
      ...createAsanaChecks().map(measureEndpoint),
      ...createD4SignChecks().map(measureEndpoint),
      ...createMetaWhatsappChecks().map(measureEndpoint),
      ...createOpenAiChecks().map(measureEndpoint),
    ])),
  );

  checks.push(
    ...(await Promise.all([
      measureEndpoint({
        endpoint: `${normalizedOrigin}/api/hades/attendance/queue?limit=20`,
        expectedDescription: "401 esperado sem bearer (fila protegida)",
        expectedStatusCodes: [401],
        group: "guardian-queue",
        id: "guardian-queue-20",
        label: "Hades Queue limit=20",
        module: "Hades",
        timeoutMs: QUEUE_TIMEOUT_MS,
      }),
      measureEndpoint({
        endpoint: `${normalizedOrigin}/api/hades/attendance/queue?limit=50`,
        expectedDescription: "401 esperado sem bearer (fila protegida)",
        expectedStatusCodes: [401],
        group: "guardian-queue",
        id: "guardian-queue-50",
        label: "Hades Queue limit=50",
        module: "Hades",
        timeoutMs: QUEUE_TIMEOUT_MS,
      }),
    ])),
  );

  return checks;
}

function createPageChecks(origin: string): EndpointCheckConfig[] {
  return [
    {
      endpoint: `${origin}/login`,
      expectedDescription: "200 abertura login",
      expectedStatusCodes: [200],
      group: "page",
      id: "page-login",
      label: "Login",
      module: "Panteon",
      timeoutMs: 5_000,
    },
    {
      endpoint: `${origin}/zeus`,
      expectedDescription: "200 abertura Zeus",
      expectedStatusCodes: [200],
      group: "page",
      id: "page-zeus",
      label: "Zeus",
      module: "Zeus",
      timeoutMs: 5_000,
    },
  ];
}

function createProtectedEndpointChecks(origin: string): EndpointCheckConfig[] {
  return [
    {
      endpoint: `${origin}/api/hades/overview`,
      expectedDescription: "401 esperado sem bearer",
      expectedStatusCodes: [401],
      group: "protected-api",
      id: "protected-guardian-overview",
      label: "Hades Overview protegido",
      module: "Hades",
    },
    {
      endpoint: `${origin}/api/hub/home`,
      expectedDescription: "401 esperado sem bearer",
      expectedStatusCodes: [401],
      group: "protected-api",
      id: "protected-hub-home",
      label: "Hub Home protegido",
      module: "Hub",
    },
    {
      endpoint: `${origin}/api/hermes/messages`,
      expectedDescription: "401 esperado sem bearer",
      expectedStatusCodes: [401],
      group: "protected-api",
      id: "protected-pulsex-messages",
      label: "Hermes Messages protegido",
      module: "Hermes",
    },
  ];
}

function createSupabaseChecks(): EndpointCheckConfig[] {
  const supabaseUrl = getServerSupabaseUrl()?.replace(/\/+$/, "");
  const anonKey = getServerSupabaseAnonKey();

  if (!supabaseUrl || !anonKey) {
    return [
      createSyntheticCheckConfig({
        group: "supabase",
        id: "supabase-config",
        label: "Supabase configuracao",
        module: "Supabase",
      }),
    ];
  }

  const headers = {
    Authorization: `Bearer ${anonKey}`,
    apikey: anonKey,
  };

  return [
    {
      endpoint: `${supabaseUrl}/auth/v1/health`,
      expectedDescription: "200 health Auth",
      expectedStatusCodes: [200],
      group: "supabase",
      headers,
      id: "supabase-auth-health",
      label: "Supabase Auth",
      module: "Supabase",
      timeoutMs: 4_000,
    },
    {
      endpoint: `${supabaseUrl}/rest/v1/`,
      expectedDescription: "200/401 REST respondendo",
      expectedStatusCodes: [200, 401],
      group: "supabase",
      headers,
      id: "supabase-rest-health",
      label: "Supabase REST",
      module: "Supabase",
      timeoutMs: 4_000,
    },
    {
      endpoint: `${supabaseUrl}/realtime/v1/api/health`,
      expectedDescription: "200/403 Realtime respondendo",
      expectedStatusCodes: [200, 403],
      group: "supabase",
      headers,
      id: "supabase-realtime-health",
      label: "Supabase Realtime",
      module: "Supabase",
      timeoutMs: 4_000,
    },
  ];
}

function createVercelChecks(): EndpointCheckConfig[] {
  const serverEnv = process.env as Record<string, string | undefined>;
  // Alvo estavel da producao publica. Override opcional via OPERATIONS_PRODUCTION_URL;
  // default no dominio oficial. Evita depender de NEXT_PUBLIC_APP_URL, que varia por
  // ambiente e ja apontou para uma URL errada (Supabase homolog) gerando falso vermelho.
  // `||` (e nao `??`) para que um override vazio caia no default.
  const productionUrl =
    serverEnv.OPERATIONS_PRODUCTION_URL?.trim() || "https://c2x.app.br";

  const endpoint = productionUrl.startsWith("http")
    ? productionUrl
    : `https://${productionUrl}`;

  return [
    {
      endpoint,
      expectedDescription: "200/307/308 producao acessivel",
      expectedStatusCodes: [200, 307, 308],
      group: "vercel",
      id: "vercel-production",
      label: "Vercel production",
      module: "Vercel",
      timeoutMs: 5_000,
    },
  ];
}

function createAsaasChecks(): EndpointCheckConfig[] {
  const env = process.env as Record<string, string | undefined>;
  const baseUrl = env.ASAAS_API_BASE_URL?.replace(/\/+$/, "");
  const apiKey = env.ASAAS_API_KEY;

  if (!baseUrl || !apiKey) {
    return [
      createSyntheticCheckConfig({
        group: "asaas",
        id: "asaas-config",
        label: "Asaas",
        module: "Asaas",
      }),
    ];
  }

  // A base do .env nao inclui /v3; normaliza para nao duplicar nem faltar o prefixo.
  const accountUrl = baseUrl.endsWith("/v3")
    ? `${baseUrl}/myAccount`
    : `${baseUrl}/v3/myAccount`;

  return [
    {
      endpoint: accountUrl,
      expectedDescription: "200 conta Asaas",
      expectedStatusCodes: [200],
      group: "asaas",
      headers: { access_token: apiKey },
      id: "asaas-myaccount",
      label: "Asaas",
      module: "Hades",
      timeoutMs: 5_000,
    },
  ];
}

function createAsanaChecks(): EndpointCheckConfig[] {
  const token = process.env.ASANA_ACCESS_TOKEN;

  if (!token) {
    return [
      createSyntheticCheckConfig({
        group: "asana",
        id: "asana-config",
        label: "Asana",
        module: "Asana",
      }),
    ];
  }

  return [
    {
      endpoint: "https://app.asana.com/api/1.0/users/me",
      expectedDescription: "200 usuario Asana",
      expectedStatusCodes: [200],
      group: "asana",
      headers: { Authorization: `Bearer ${token}` },
      id: "asana-users-me",
      label: "Asana",
      module: "Asana",
      timeoutMs: 5_000,
    },
  ];
}

function createD4SignChecks(): EndpointCheckConfig[] {
  const env = process.env as Record<string, string | undefined>;
  const tokenApi = env.D4SIGN_TOKEN_API;
  const cryptKey = env.D4SIGN_CRYPT_KEY;

  if (!tokenApi || !cryptKey) {
    return [
      createSyntheticCheckConfig({
        group: "d4sign",
        id: "d4sign-config",
        label: "D4Sign",
        module: "D4Sign",
      }),
    ];
  }

  const baseUrl =
    env.D4SIGN_API_BASE_URL?.replace(/\/+$/, "") ??
    "https://secure.d4sign.com.br/api/v1";
  const endpoint = `${baseUrl}/safes`;
  const query = `?tokenAPI=${encodeURIComponent(tokenApi)}&cryptKey=${encodeURIComponent(cryptKey)}`;

  return [
    {
      // Segredo vai apenas no requestUrl; o endpoint salvo/exibido fica sem a query.
      endpoint,
      expectedDescription: "200 safes D4Sign",
      expectedStatusCodes: [200],
      group: "d4sign",
      id: "d4sign-safes",
      label: "D4Sign",
      module: "D4Sign",
      requestUrl: `${endpoint}${query}`,
      timeoutMs: 6_000,
    },
  ];
}

function createMetaWhatsappChecks(): EndpointCheckConfig[] {
  const env = process.env as Record<string, string | undefined>;
  const token = env.META_WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env.META_WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion = env.META_WHATSAPP_GRAPH_VERSION ?? "v21.0";

  if (!token || !phoneNumberId) {
    return [
      createSyntheticCheckConfig({
        group: "meta",
        id: "meta-whatsapp-config",
        label: "Meta WhatsApp",
        module: "Iris",
      }),
    ];
  }

  return [
    {
      endpoint: `https://graph.facebook.com/${graphVersion}/${phoneNumberId}`,
      expectedDescription: "200 numero WhatsApp",
      expectedStatusCodes: [200],
      group: "meta",
      headers: { Authorization: `Bearer ${token}` },
      id: "meta-whatsapp-phone",
      label: "Meta WhatsApp",
      module: "Iris",
      timeoutMs: 5_000,
    },
  ];
}

function createOpenAiChecks(): EndpointCheckConfig[] {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return [
      createSyntheticCheckConfig({
        group: "openai",
        id: "openai-config",
        label: "OpenAI",
        module: "Iris",
      }),
    ];
  }

  return [
    {
      endpoint: "https://api.openai.com/v1/models",
      expectedDescription: "200 modelos OpenAI",
      expectedStatusCodes: [200],
      group: "openai",
      headers: { Authorization: `Bearer ${apiKey}` },
      id: "openai-models",
      label: "OpenAI",
      module: "Iris",
      timeoutMs: 6_000,
    },
  ];
}

function createSyntheticCheckConfig({
  group,
  id,
  label,
  module,
}: Pick<EndpointCheckConfig, "group" | "id" | "label" | "module">) {
  return {
    endpoint: "not-configured",
    expectedDescription: "variaveis server-side configuradas",
    expectedStatusCodes: [200],
    group,
    id,
    label,
    module,
  };
}

async function measureEndpoint(config: EndpointCheckConfig): Promise<OperationsRawCheck> {
  if (config.endpoint === "not-configured") {
    return {
      checkedAt: new Date().toISOString(),
      endpoint: config.endpoint,
      error: "Fonte nao configurada no ambiente.",
      expected: {
        description: config.expectedDescription,
        statusCodes: config.expectedStatusCodes,
      },
      group: config.group,
      id: config.id,
      label: config.label,
      method: config.method ?? "GET",
      module: config.module,
      ok: false,
      payloadBytes: 0,
      received: "not-configured",
      responseMs: 0,
      statusCode: 0,
    };
  }

  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(config.requestUrl ?? config.endpoint, {
      cache: "no-store",
      headers: config.headers,
      method: config.method ?? "GET",
      signal: controller.signal,
    });
    const responseText =
      config.method === "HEAD" ? "" : await response.text().catch(() => "");
    const payloadBytes = Buffer.byteLength(responseText, "utf8");
    const meta = extractSafeMeta(responseText) ?? {};
    copyResponseHeader(meta, "cacheStatus", response, "x-panteon-local-cache");
    copyResponseHeader(meta, "hadesQueueCache", response, "x-hades-queue-cache");
    copyResponseHeader(meta, "vercelCache", response, "x-vercel-cache");
    copyResponseHeader(meta, "cacheControl", response, "cache-control");
    copyResponseHeader(meta, "age", response, "age");
    const statusCode = response.status;

    return {
      checkedAt: new Date().toISOString(),
      endpoint: sanitizeEndpoint(config.endpoint),
      expected: {
        description: config.expectedDescription,
        statusCodes: config.expectedStatusCodes,
      },
      group: config.group,
      id: config.id,
      label: config.label,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
      method: config.method ?? "GET",
      module: config.module,
      ok: config.expectedStatusCodes.includes(statusCode),
      payloadBytes,
      received: `${statusCode} ${response.statusText}`.trim(),
      responseMs: Math.round(performance.now() - startedAt),
      statusCode,
    };
  } catch (error) {
    return {
      checkedAt: new Date().toISOString(),
      endpoint: sanitizeEndpoint(config.endpoint),
      error:
        error instanceof DOMException && error.name === "AbortError"
          ? "timeout"
          : "fetch-failed",
      expected: {
        description: config.expectedDescription,
        statusCodes: config.expectedStatusCodes,
      },
      group: config.group,
      id: config.id,
      label: config.label,
      method: config.method ?? "GET",
      module: config.module,
      ok: false,
      payloadBytes: 0,
      received: "sem resposta",
      responseMs: Math.round(performance.now() - startedAt),
      statusCode: 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractSafeMeta(responseText: string) {
  if (!responseText.trim()) {
    return undefined;
  }

  try {
    const payload = JSON.parse(responseText) as Record<string, unknown>;
    const meta: Record<string, string | number | boolean | null> = {};
    const payloadMeta = isRecord(payload.meta) ? payload.meta : null;

    copyPrimitive(meta, "status", payload.status);
    copyPrimitive(meta, "database", payload.database);
    copyPrimitive(meta, "source", payload.source);
    copyPrimitive(meta, "elapsedMs", payload.elapsedMs);

    if (payloadMeta) {
      copyPrimitive(meta, "count", payloadMeta.count);
      copyPrimitive(meta, "limit", payloadMeta.limit);
      copyPrimitive(meta, "loadedCount", payloadMeta.loadedCount);
    }

    return Object.keys(meta).length > 0 ? meta : undefined;
  } catch {
    return undefined;
  }
}

function copyResponseHeader(
  target: Record<string, string | number | boolean | null>,
  key: string,
  response: Response,
  headerName: string,
) {
  const value = response.headers.get(headerName);

  if (value?.trim()) {
    target[key] = value.trim();
  }
}

function copyPrimitive(
  target: Record<string, string | number | boolean | null>,
  key: string,
  value: unknown,
) {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    target[key] = value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeEndpoint(endpoint: string) {
  try {
    const parsedUrl = new URL(endpoint);
    return `${parsedUrl.origin}${parsedUrl.pathname}${parsedUrl.search}`;
  } catch {
    return endpoint;
  }
}
