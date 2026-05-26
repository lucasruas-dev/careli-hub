"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  AresDimension,
  AresFinancialBase,
  AresFinancialEntry,
  AresSnapshot,
  CreateAresDimensionInput,
  CreateAresEntryInput,
  CreateAresFinancialBaseInput,
  UpdateAresDimensionInput,
  UpdateAresFinancialBaseInput,
} from "./types";

type AresSnapshotResponse = {
  code?: string;
  data?: AresSnapshot;
  error?: string;
};

type AresEntryResponse = {
  code?: string;
  data?: AresFinancialEntry;
  error?: string;
};

type AresDimensionResponse = {
  code?: string;
  data?: AresDimension;
  error?: string;
};

type AresFinancialBaseResponse = {
  code?: string;
  data?: AresFinancialBase;
  error?: string;
};

export async function getAresAccessToken(fallback?: string | null) {
  if (fallback) {
    return fallback;
  }

  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Sessao real do Hub necessaria para carregar o Ares.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao do Hub ausente para carregar o Ares.");
  }

  return accessToken;
}

export async function loadAresSnapshot(
  accessToken?: string | null,
  financialBaseId?: string | null,
) {
  const token = await getAresAccessToken(accessToken);
  const params = new URLSearchParams();

  if (financialBaseId) {
    params.set("financialBaseId", financialBaseId);
  }

  const url = params.size
    ? `/api/ares/snapshot?${params.toString()}`
    : "/api/ares/snapshot";
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | AresSnapshotResponse
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel carregar o Ares.");
  }

  return payload.data;
}

export async function createAresEntry(
  input: CreateAresEntryInput,
  accessToken?: string | null,
) {
  const token = await getAresAccessToken(accessToken);
  const response = await fetch("/api/ares/entries", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | AresEntryResponse
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel criar o lancamento.");
  }

  return payload.data;
}

export async function createAresDimension(
  input: CreateAresDimensionInput,
  accessToken?: string | null,
) {
  const token = await getAresAccessToken(accessToken);
  const response = await fetch("/api/ares/dimensions", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | AresDimensionResponse
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel criar a dimensao.");
  }

  return payload.data;
}

export async function updateAresDimension(
  input: UpdateAresDimensionInput,
  accessToken?: string | null,
) {
  const token = await getAresAccessToken(accessToken);
  const response = await fetch("/api/ares/dimensions", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  const payload = (await response.json().catch(() => null)) as
    | AresDimensionResponse
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel atualizar a dimensao.");
  }

  return payload.data;
}

export async function createAresFinancialBase(
  input: CreateAresFinancialBaseInput,
  accessToken?: string | null,
) {
  const token = await getAresAccessToken(accessToken);
  const response = await fetch("/api/ares/financial-bases", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | AresFinancialBaseResponse
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel criar a empresa.");
  }

  return payload.data;
}

export async function updateAresFinancialBase(
  input: UpdateAresFinancialBaseInput,
  accessToken?: string | null,
) {
  const token = await getAresAccessToken(accessToken);
  const response = await fetch("/api/ares/financial-bases", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  const payload = (await response.json().catch(() => null)) as
    | AresFinancialBaseResponse
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel atualizar a empresa.");
  }

  return payload.data;
}
