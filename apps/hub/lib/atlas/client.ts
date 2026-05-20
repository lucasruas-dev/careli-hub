"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type { AtlasSnapshot } from "./types";

type AtlasSnapshotResponse = {
  code?: string;
  data?: AtlasSnapshot;
  error?: string;
};

export async function getAtlasAccessToken(fallback?: string | null) {
  if (fallback) {
    return fallback;
  }

  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Sessao real do Hub necessaria para carregar o Atlas.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao do Hub ausente para carregar o Atlas.");
  }

  return accessToken;
}

export async function loadAtlasSnapshot(accessToken?: string | null) {
  const token = await getAtlasAccessToken(accessToken);
  const response = await fetch("/api/atlas/snapshot", {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | AtlasSnapshotResponse
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel carregar o Atlas.");
  }

  return payload.data;
}
