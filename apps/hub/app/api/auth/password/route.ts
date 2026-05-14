import { NextResponse, type NextRequest } from "next/server";

type PasswordPayload = {
  email: string;
  password: string;
};

type SupabaseAuthPayload = {
  access_token?: unknown;
  error?: unknown;
  error_description?: unknown;
  expires_at?: unknown;
  expires_in?: unknown;
  message?: unknown;
  msg?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  user?: unknown;
};

const AUTH_TIMEOUT_MS = 20_000;

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: "Supabase nao configurado no servidor." },
      { status: 503 },
    );
  }

  const payload = parsePasswordPayload(await request.json().catch(() => null));

  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`,
      {
        body: JSON.stringify(payload.data),
        cache: "no-store",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      },
    );
    const authPayload = (await response.json().catch(() => null)) as
      | SupabaseAuthPayload
      | null;

    if (!response.ok) {
      return NextResponse.json(
        { error: getAuthPayloadMessage(authPayload) },
        { status: response.status === 400 ? 401 : response.status },
      );
    }

    if (
      !authPayload ||
      typeof authPayload.access_token !== "string" ||
      typeof authPayload.refresh_token !== "string"
    ) {
      return NextResponse.json(
        { error: "Supabase nao retornou uma sessao valida." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      session: {
        access_token: authPayload.access_token,
        expires_at: authPayload.expires_at,
        expires_in: authPayload.expires_in,
        refresh_token: authPayload.refresh_token,
        token_type: authPayload.token_type,
        user: authPayload.user,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getServerAuthErrorMessage(error) },
      { status: 503 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function parsePasswordPayload(input: unknown):
  | {
      data: PasswordPayload;
      ok: true;
    }
  | {
      error: string;
      ok: false;
    } {
  if (!input || typeof input !== "object") {
    return {
      error: "Informe e-mail e senha para entrar.",
      ok: false,
    };
  }

  const maybePayload = input as Partial<PasswordPayload>;

  if (
    typeof maybePayload.email !== "string" ||
    typeof maybePayload.password !== "string" ||
    !maybePayload.email.trim() ||
    !maybePayload.password.trim()
  ) {
    return {
      error: "Informe e-mail e senha para entrar.",
      ok: false,
    };
  }

  return {
    data: {
      email: maybePayload.email.trim().toLowerCase(),
      password: maybePayload.password,
    },
    ok: true,
  };
}

function getAuthPayloadMessage(payload: SupabaseAuthPayload | null) {
  if (!payload) {
    return "Nao foi possivel autenticar com Supabase.";
  }

  for (const value of [
    payload.msg,
    payload.message,
    payload.error_description,
    payload.error,
  ]) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "Nao foi possivel autenticar com Supabase.";
}

function getServerAuthErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Tempo excedido ao autenticar com Supabase.";
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Nao foi possivel conectar ao Supabase.";
}
