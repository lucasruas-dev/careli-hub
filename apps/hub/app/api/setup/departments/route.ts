import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

type DepartmentStatus = "active" | "archived" | "disabled";

type DepartmentPayload = {
  description?: unknown;
  name?: unknown;
  slug?: unknown;
  status?: unknown;
};

const departmentStatuses = ["active", "archived", "disabled"] as const;

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  logDepartmentApi("start", {
    endpoint: "/api/setup/departments",
    hasAnonKey: Boolean(anonKey),
    supabaseUrl: maskSupabaseUrl(supabaseUrl),
  });

  if (!supabaseUrl || !anonKey) {
    logDepartmentApi("error", {
      reason: "missing public Supabase env",
      supabaseUrl: maskSupabaseUrl(supabaseUrl),
    });
    return NextResponse.json(
      { error: "Supabase nao configurado no servidor." },
      { status: 503 },
    );
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    logDepartmentApi("error", {
      reason: "missing bearer token",
    });
    return NextResponse.json(
      { error: "Sessao administrativa ausente." },
      { status: 401 },
    );
  }

  const payload = parsePayload(await request.json().catch(() => null));

  if (!payload.ok) {
    logDepartmentApi("error", {
      message: payload.error,
      reason: "invalid payload",
    });
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  try {
    const { data, error } = await supabase
      .from("hub_departments")
      .insert(payload.data)
      .select("id,slug,name,description,status,created_at")
      .single();

    if (error) {
      logDepartmentApi("error", {
        error: serializeServerError(error),
        payload: payload.data,
        reason: "insert failed",
        table: "hub_departments",
      });
      return NextResponse.json(
        { error: "Nao foi possivel salvar departamento." },
        { status: 400 },
      );
    }

    logDepartmentApi("done", {
      id: data.id,
      table: "hub_departments",
    });

    return NextResponse.json({ data });
  } catch (error) {
    logDepartmentApi("error", {
      error: serializeServerError(error),
      payload: payload.data,
      reason: "network failure",
      table: "hub_departments",
    });
    return NextResponse.json(
      { error: "Nao foi possivel conectar ao Supabase." },
      { status: 503 },
    );
  }
}

function parsePayload(payload: unknown):
  | {
      data: {
        description: string | null;
        name: string;
        slug: string;
        status: DepartmentStatus;
      };
      ok: true;
    }
  | { error: string; ok: false } {
  if (!payload || typeof payload !== "object") {
    return { error: "Informe os dados do departamento.", ok: false };
  }

  const input = payload as DepartmentPayload;
  const name = getString(input.name);
  const slug = getString(input.slug) || createFallbackSlug(name);
  const status = getString(input.status);

  if (!name) {
    return { error: "Informe o nome do departamento.", ok: false };
  }

  if (!isDepartmentStatus(status)) {
    return { error: "Selecione um status valido.", ok: false };
  }

  return {
    data: {
      description: getString(input.description) || null,
      name,
      slug,
      status,
    },
    ok: true,
  };
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isDepartmentStatus(value: string): value is DepartmentStatus {
  return departmentStatuses.some((status) => status === value);
}

function createFallbackSlug(value: string) {
  const normalizedValue = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalizedValue || `departamento-${Date.now().toString(36)}`;
}

function logDepartmentApi(event: string, detail?: unknown) {
  const logger = event.includes("error") ? console.warn : console.debug;
  logger(`[setup-api] departments ${event}`, detail ?? "");
}

function serializeServerError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  if (!error || typeof error !== "object") {
    return error;
  }

  const maybeError = error as {
    code?: unknown;
    details?: unknown;
    hint?: unknown;
    message?: unknown;
    name?: unknown;
  };

  return {
    code: maybeError.code,
    details: maybeError.details,
    hint: maybeError.hint,
    message: maybeError.message,
    name: maybeError.name,
  };
}

function maskSupabaseUrl(url?: string) {
  if (!url) {
    return "missing";
  }

  try {
    const parsedUrl = new URL(url);
    const [projectRef = "unknown"] = parsedUrl.hostname.split(".");

    return `${parsedUrl.protocol}//${projectRef.slice(0, 4)}...${projectRef.slice(-4)}.${parsedUrl.hostname
      .split(".")
      .slice(1)
      .join(".")}`;
  } catch {
    return "invalid-url";
  }
}
