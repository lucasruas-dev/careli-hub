"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type { GuardianOverviewSnapshot } from "@/lib/guardian/overview";

export async function getGuardianOverviewSnapshot(): Promise<GuardianOverviewSnapshot> {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao do Supabase indisponivel.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa ausente.");
  }

  const response = await fetch("/api/guardian/overview", {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: GuardianOverviewSnapshot; error?: string }
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel carregar o Guardian.");
  }

  return payload.data;
}
