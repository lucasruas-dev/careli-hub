import { NextResponse, type NextRequest } from "next/server";

import {
  prepareBoletoResendAction,
  type BoletoResendMode,
} from "@/lib/guardian/asaas";

type SupabaseUserPayload = {
  id?: unknown;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await authorizeGuardianAction(request);

  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        deliveryMode?: unknown;
        paymentId?: unknown;
      }
    | null;
  const paymentId =
    typeof body?.paymentId === "string" ? body.paymentId.trim() : "";
  const deliveryMode = parseDeliveryMode(body?.deliveryMode);

  if (!paymentId) {
    return NextResponse.json(
      { error: "Parcela nao informada para reenvio." },
      { status: 400 },
    );
  }

  try {
    const action = await prepareBoletoResendAction(paymentId, deliveryMode);

    return NextResponse.json({
      action,
      source: "c2x",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel preparar o reenvio do boleto.",
      },
      { status: 422 },
    );
  }
}

function parseDeliveryMode(value: unknown): BoletoResendMode {
  return value === "asaas" ? "asaas" : "link";
}

async function authorizeGuardianAction(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return {
      ok: true as const,
      userId: "local-hub-user",
    };
  }

  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return {
      error: "Sessao ausente para executar a acao do Guardian.",
      ok: false as const,
      status: 401,
    };
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
      },
    });
    const payload = (await response.json().catch(() => null)) as
      | SupabaseUserPayload
      | null;

    if (!response.ok || typeof payload?.id !== "string") {
      return {
        error: "Sessao invalida para executar a acao do Guardian.",
        ok: false as const,
        status: response.status === 400 ? 401 : response.status,
      };
    }

    return {
      ok: true as const,
      userId: payload.id,
    };
  } catch {
    return {
      error: "Nao foi possivel validar a sessao do Guardian.",
      ok: false as const,
      status: 503,
    };
  }
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}
