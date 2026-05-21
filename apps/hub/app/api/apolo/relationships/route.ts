import { NextResponse } from "next/server";

import { loadApoloDashboard } from "@/lib/apolo/server";
import type { ApoloDashboardData, ApoloProfile } from "@/lib/apolo/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LOCAL_DEV_CACHE_TTL_MS = 30_000;
const localDevCache = new Map<
  string,
  { data: ApoloDashboardData; expiresAt: number }
>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const profile = normalizeProfile(url.searchParams.get("profile"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const cacheKey = localDevCacheKey(url);
  const cachedData = readLocalDevCache(cacheKey);

  if (cachedData) {
    return createApoloResponse(cachedData, "hit");
  }

  const data = await loadApoloDashboard({
    limit,
    profile,
    query,
  });

  writeLocalDevCache(cacheKey, data);

  return createApoloResponse(data, cacheKey ? "miss" : null);
}

function normalizeProfile(value: string | null): ApoloProfile | null {
  const allowed = new Set<ApoloProfile>([
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

  return value && allowed.has(value as ApoloProfile)
    ? (value as ApoloProfile)
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

function localDevCacheKey(url: URL) {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  const params = new URLSearchParams(url.searchParams);
  params.sort();

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
