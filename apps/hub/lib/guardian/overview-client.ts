"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  HadesEnterpriseDistributions,
  HadesKpiDrilldownKey,
  HadesKpiDrilldownRow,
  HadesOverviewSnapshot,
} from "@/lib/guardian/overview";
import type { HadesOperationalIntelligence } from "@/lib/guardian/read-model";

export async function getHadesOverviewSnapshot(): Promise<HadesOverviewSnapshot> {
  return fetchHadesOverviewData<HadesOverviewSnapshot>("/api/hades/overview");
}

export async function getHadesOperationalIntelligence(): Promise<HadesOperationalIntelligence> {
  return fetchHadesOverviewData<HadesOperationalIntelligence>(
    "/api/guardian/operational-intelligence",
  );
}

export async function getHadesKpiDrilldown(
  kpi: HadesKpiDrilldownKey,
): Promise<HadesKpiDrilldownRow[]> {
  const params = new URLSearchParams({ kpi });

  return fetchHadesOverviewData<HadesKpiDrilldownRow[]>(
    `/api/guardian/kpi-drilldown?${params.toString()}`,
  );
}

export async function getHadesOverviewEnterpriseDistributions(
  enterpriseName: string,
): Promise<HadesEnterpriseDistributions> {
  const params = new URLSearchParams({ enterprise: enterpriseName });

  return fetchHadesOverviewData<HadesEnterpriseDistributions>(
    `/api/hades/overview?${params.toString()}`,
  );
}

async function fetchHadesOverviewData<Result>(url: string): Promise<Result> {
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
    throw new Error(payload?.error ?? "Nao foi possivel carregar o Hades.");
  }

  return payload.data;
}
