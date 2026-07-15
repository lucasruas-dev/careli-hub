import { NextResponse } from "next/server";

import {
  createApoloAdminClient,
  createApoloUserClient,
  loadApoloDashboard,
} from "@/lib/apolo/server";
import type { ApoloDashboardData, ApoloProfile } from "@/lib/apolo/types";

type HubUserRole = "admin" | "leader" | "operator" | "viewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOCAL_DEV_CACHE_TTL_MS = 30_000;
const localDevCache = new Map<
  string,
  { data: ApoloDashboardData; expiresAt: number }
>();

export async function GET(request: Request) {
  const accessToken = getBearerToken(request);

  if (!accessToken) {
    return NextResponse.json(
      { error: "Sessao do Apolo ausente." },
      { status: 401 },
    );
  }

  const adminClient = createApoloAdminClient();
  const userClient = createApoloUserClient(accessToken);
  const authClient = adminClient ?? userClient;

  if (!authClient) {
    return NextResponse.json(
      { error: "Configure o Supabase server-side para carregar o Apolo." },
      { status: 503 },
    );
  }

  const authorization = await authorizeApoloReadRequest(accessToken, authClient);

  if (!authorization.ok) {
    return authorization.response;
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const profile = normalizeProfile(url.searchParams.get("profile"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const cacheKey = localDevCacheKey(url, authorization.userId);
  const cachedData = readLocalDevCache(cacheKey);

  if (cachedData) {
    return createApoloResponse(cachedData, "hit");
  }

  const data = await loadApoloDashboard({
    limit,
    profile,
    query,
  }, userClient ?? adminClient ?? undefined);

  writeLocalDevCache(cacheKey, data);

  return createApoloResponse(data, cacheKey ? "miss" : null);
}

function normalizeProfile(
  value: string | null,
): ApoloProfile | "comprador" | "prospect" | null {
  const allowed = new Set<ApoloProfile | "comprador" | "prospect">([
    "comprador",
    "prospect",
    "usuario",
    "incorporador",
    "imobiliaria",
    "corretor",
    "fornecedor",
    "parceiro",
    "colaborador",
    "acesso_incorporador",
    "pessoa_fisica",
    "pessoa_juridica",
  ]);

  return value &&
    allowed.has(value as ApoloProfile | "comprador" | "prospect")
    ? (value as ApoloProfile | "comprador" | "prospect")
    : null;
}

function parseLimit(value: string | null) {
  const parsed = Number(value ?? 20);

  if (!Number.isFinite(parsed)) {
    return 20;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}

function createApoloResponse(
  data: ApoloDashboardData,
  localCacheState: "hit" | "miss" | null,
) {
  return NextResponse.json(
    { data },
    {
      headers: {
        "Cache-Control": "no-store",
        ...(localCacheState
          ? { "X-Panteon-Local-Cache": localCacheState }
          : {}),
      },
    },
  );
}

async function authorizeApoloReadRequest(
  accessToken: string,
  client: NonNullable<
    ReturnType<typeof createApoloAdminClient> | ReturnType<typeof createApoloUserClient>
  >,
) {
  const { data: authData, error: authError } = await client.auth.getUser(
    accessToken,
  );

  if (authError || !authData.user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Sessao do Apolo invalida." },
        { status: 401 },
      ),
    };
  }

  const { data: user, error: userError } = await client
    .from("hub_users")
    .select("id,role,status")
    .eq("id", authData.user.id)
    .maybeSingle<{ id: string; role: HubUserRole; status: string }>();

  if (
    userError ||
    !user ||
    user.status !== "active" ||
    !isHubUserRole(user.role)
  ) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Usuario sem acesso ao Apolo." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    userId: user.id,
  };
}

function isHubUserRole(value: string): value is HubUserRole {
  return ["admin", "leader", "operator", "viewer"].includes(value);
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

function localDevCacheKey(url: URL, userId: string) {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  const params = new URLSearchParams(url.searchParams);
  params.sort();
  params.set("hubUserId", userId);

  return params.toString();
}

function readLocalDevCache(cacheKey: string | null) {
  if (!cacheKey) {
    return null;
  }

  const cached = localDevCache.get(cacheKey);

  if (!cached || cached.expiresAt < Date.now()) {
    localDevCache.delete(cacheKey);
    return null;
  }

  return cached.data;
}

function writeLocalDevCache(
  cacheKey: string | null,
  data: ApoloDashboardData,
) {
  if (!cacheKey) {
    return;
  }

  localDevCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + LOCAL_DEV_CACHE_TTL_MS,
  });
}
