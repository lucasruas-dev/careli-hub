import {
  getServerSupabaseAnonKey,
  getServerSupabaseUrl,
} from "@/lib/supabase/server-config";

export type OperationsSourceGroup =
  | "api"
  | "c2x"
  | "guardian-queue"
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
        endpoint: `${normalizedOrigin}/api/guardian/db/health`,
        expectedDescription: "200 conectado",
        expectedStatusCodes: [200],
        group: "c2x",
        id: "guardian-db-health",
        label: "C2X DB Health",
        module: "Guardian",
      }),
      ...createProtectedEndpointChecks(normalizedOrigin).map(measureEndpoint),
      ...createSupabaseChecks().map(measureEndpoint),
      ...createVercelChecks().map(measureEndpoint),
    ])),
  );

  checks.push(
    await measureEndpoint({
      endpoint: `${normalizedOrigin}/api/guardian/attendance/queue?limit=20`,
      expectedDescription: "200 com limite seguro 20",
      expectedStatusCodes: [200],
      group: "guardian-queue",
      id: "guardian-queue-20",
      label: "Guardian Queue limit=20",
      module: "Guardian",
      timeoutMs: QUEUE_TIMEOUT_MS,
    }),
  );
  checks.push(
    await measureEndpoint({
      endpoint: `${normalizedOrigin}/api/guardian/attendance/queue?limit=50`,
      expectedDescription: "200 com limite seguro 50",
      expectedStatusCodes: [200],
      group: "guardian-queue",
      id: "guardian-queue-50",
      label: "Guardian Queue limit=50",
      module: "Guardian",
      timeoutMs: QUEUE_TIMEOUT_MS,
    }),
  );

  return checks;
}

function createProtectedEndpointChecks(origin: string): EndpointCheckConfig[] {
  return [
    {
      endpoint: `${origin}/api/guardian/overview`,
      expectedDescription: "401 esperado sem bearer",
      expectedStatusCodes: [401],
      group: "protected-api",
      id: "protected-guardian-overview",
      label: "Guardian Overview protegido",
      module: "Guardian",
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
      endpoint: `${origin}/api/pulsex/messages`,
      expectedDescription: "401 esperado sem bearer",
      expectedStatusCodes: [401],
      group: "protected-api",
      id: "protected-pulsex-messages",
      label: "PulseX Messages protegido",
      module: "PulseX",
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
  const productionUrl =
    serverEnv.NEXT_PUBLIC_APP_URL ??
    serverEnv.VERCEL_PROJECT_PRODUCTION_URL ??
    serverEnv.VERCEL_URL;

  if (!productionUrl) {
    return [];
  }

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
    const response = await fetch(config.endpoint, {
      cache: "no-store",
      headers: config.headers,
      method: config.method ?? "GET",
      signal: controller.signal,
    });
    const responseText =
      config.method === "HEAD" ? "" : await response.text().catch(() => "");
    const payloadBytes = Buffer.byteLength(responseText, "utf8");
    const meta = extractSafeMeta(responseText);
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
      meta,
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
