"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  GuardianEnterpriseDistributions,
  GuardianOverviewSnapshot,
} from "@/lib/guardian/overview";

export async function getGuardianOverviewSnapshot(): Promise<GuardianOverviewSnapshot> {
  return fetchGuardianOverviewData<GuardianOverviewSnapshot>("/api/guardian/overview");
}

export async function getGuardianOverviewEnterpriseDistributions(
  enterpriseName: string,
): Promise<GuardianEnterpriseDistributions> {
  const params = new URLSearchParams({ enterprise: enterpriseName });

  return fetchGuardianOverviewData<GuardianEnterpriseDistributions>(
    `/api/guardian/overview?${params.toString()}`,
  );
}

async function fetchGuardianOverviewData<Result>(url: string): Promise<Result> {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao do Supabase indisponivel.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa ausente.");
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: Result; error?: string }
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel carregar o Guardian.");
  }

  return payload.data;
}
