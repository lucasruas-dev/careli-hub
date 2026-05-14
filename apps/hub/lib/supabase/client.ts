"use client";

import {
  createSupabaseAuthClient,
  hasSupabaseAuthConfig,
} from "@repo/auth";

const EXPECTED_SUPABASE_URL = "https://bxgukywoxgivlrhjkwjx.supabase.co";

export const hubSupabaseConfig = {
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  workspaceId: process.env.NEXT_PUBLIC_SUPABASE_WORKSPACE_ID ?? "careli",
};

let browserClient: ReturnType<typeof createSupabaseAuthClient> | null = null;
let browserClientInstanceId: string | null = null;

export function hasHubSupabaseConfig() {
  return hasSupabaseAuthConfig(hubSupabaseConfig);
}

export function getHubSupabaseClient() {
  if (!hasSupabaseAuthConfig(hubSupabaseConfig)) {
    return null;
  }

  if (!browserClient) {
    browserClient = createSupabaseAuthClient(hubSupabaseConfig);
    browserClientInstanceId = `hub-supabase-${Date.now().toString(36)}`;
    logSupabaseDiagnostic("client", "created", getHubSupabaseDiagnostics());
  }

  return browserClient;
}

export function getHubSupabaseDiagnostics() {
  return {
    anonKey: maskSecret(hubSupabaseConfig.anonKey),
    clientInstanceId: browserClientInstanceId ?? "not-created",
    hasAnonKey: Boolean(hubSupabaseConfig.anonKey?.trim()),
    hasUrl: Boolean(hubSupabaseConfig.url?.trim()),
    expectedUrl: maskSupabaseUrl(EXPECTED_SUPABASE_URL),
    url: maskSupabaseUrl(hubSupabaseConfig.url),
    urlMatchesExpected: normalizeUrl(hubSupabaseConfig.url) === EXPECTED_SUPABASE_URL,
    workspaceId: hubSupabaseConfig.workspaceId,
  };
}

export type SupabaseDiagnosticScope =
  | "auth"
  | "client"
  | "health"
  | "pulsex"
  | "setup"
  | "shell";

export function logSupabaseDiagnostic(
  scope: SupabaseDiagnosticScope,
  event: string,
  detail?: unknown,
) {
  if (!isLocalDevelopmentRuntime()) {
    return;
  }

  const logger =
    typeof event === "string" && event.toLowerCase().includes("error")
      ? console.warn
      : console.debug;

  logger(`[${scope}] ${event}`, detail ?? "");
}

export function serializeDiagnosticError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  if (typeof error === "string") {
    return {
      message: error,
      name: "Error",
    };
  }

  if (error && typeof error === "object") {
    const maybeError = error as {
      code?: unknown;
      details?: unknown;
      hint?: unknown;
      message?: unknown;
      name?: unknown;
      stack?: unknown;
    };

    return {
      code: maybeError.code,
      details: maybeError.details,
      hint: maybeError.hint,
      message:
        typeof maybeError.message === "string"
          ? maybeError.message
          : "Erro desconhecido.",
      name: typeof maybeError.name === "string" ? maybeError.name : "Error",
      stack: typeof maybeError.stack === "string" ? maybeError.stack : undefined,
    };
  }

  return {
    message: "Erro desconhecido.",
    name: "UnknownError",
  };
}

export function isSupabaseNetworkError(error: unknown) {
  const message = serializeDiagnosticError(error).message.toLowerCase();

  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("fetch failed")
  );
}

export async function checkSupabaseHealth(context = "manual") {
  if (!isLocalDevelopmentRuntime()) {
    return;
  }

  const client = getHubSupabaseClient();

  logSupabaseDiagnostic("health", "start", {
    context,
    supabase: getHubSupabaseDiagnostics(),
  });

  if (!client) {
    logSupabaseDiagnostic("health", "error", {
      context,
      reason: "missing-client",
      supabase: getHubSupabaseDiagnostics(),
    });
    return;
  }

  let currentUser:
    | {
        email?: string;
        id: string;
      }
    | null = null;

  try {
    const userResult = await client.auth.getUser();
    currentUser = userResult.data.user
      ? {
          email: userResult.data.user.email,
          id: userResult.data.user.id,
        }
      : null;

    logSupabaseDiagnostic("health", "auth user result", {
      context,
      error: userResult.error
        ? serializeDiagnosticError(userResult.error)
        : null,
      user: currentUser,
    });
  } catch (error) {
    logSupabaseDiagnostic("health", "auth user error", {
      context,
      error: serializeDiagnosticError(error),
      supabase: getHubSupabaseDiagnostics(),
    });
  }

  await Promise.all(
    [
      {
        query: client.from("hub_users").select("id").limit(1),
        table: "hub_users",
      },
      {
        query: client.from("hub_departments").select("id").limit(1),
        table: "hub_departments",
      },
      {
        query: client.from("hub_sectors").select("id").limit(1),
        table: "hub_sectors",
      },
      {
        query: client.from("pulsex_channels").select("id").limit(1),
        table: "pulsex_channels",
      },
    ].map(async (probe) => {
      logSupabaseDiagnostic("health", "probe start", {
        context,
        currentUser,
        table: probe.table,
      });

      try {
        const result = (await probe.query) as {
          data: unknown[] | null;
          error: unknown;
        };

        if (result.error) {
          logSupabaseDiagnostic("health", "probe error", {
            context,
            currentUser,
            error: serializeDiagnosticError(result.error),
            supabase: getHubSupabaseDiagnostics(),
            table: probe.table,
          });
          return;
        }

        logSupabaseDiagnostic("health", "probe result", {
          context,
          currentUser,
          rowCount: result.data?.length ?? 0,
          table: probe.table,
        });
      } catch (error) {
        logSupabaseDiagnostic("health", "probe error", {
          context,
          currentUser,
          error: serializeDiagnosticError(error),
          supabase: getHubSupabaseDiagnostics(),
          table: probe.table,
        });
      }
    }),
  );
}

function maskSupabaseUrl(url?: string) {
  if (!url?.trim()) {
    return "missing";
  }

  try {
    const parsedUrl = new URL(url);
    const [projectRef = "unknown"] = parsedUrl.hostname.split(".");
    const visibleRef =
      projectRef.length > 8
        ? `${projectRef.slice(0, 4)}...${projectRef.slice(-4)}`
        : projectRef;

    return `${parsedUrl.protocol}//${visibleRef}.${parsedUrl.hostname
      .split(".")
      .slice(1)
      .join(".")}`;
  } catch {
    return "invalid-url";
  }
}

function maskSecret(secret?: string) {
  const value = secret?.trim();

  if (!value) {
    return "missing";
  }

  if (value.length <= 12) {
    return `present(len=${value.length})`;
  }

  return `${value.slice(0, 6)}...${value.slice(-6)}(len=${value.length})`;
}

function normalizeUrl(url?: string) {
  return url?.trim().replace(/\/+$/, "") ?? "";
}

function isLocalDevelopmentRuntime(): boolean {
  if (typeof globalThis.location === "undefined") {
    return false;
  }

  return ["localhost", "127.0.0.1"].includes(globalThis.location.hostname);
}
