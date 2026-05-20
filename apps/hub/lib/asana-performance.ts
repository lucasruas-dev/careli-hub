"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";

export type AsanaPerformanceStatus = "configured" | "error" | "missing_config";
export type AsanaTaskQueryMode = "created_at_search" | "tasks_list_fallback";

export type AsanaPerformanceTotals = {
  averageDelayDays: number;
  completed: number;
  completedLate: number;
  completedOnTime: number;
  completedRate: number;
  completedWithoutDue: number;
  collaboratorsMatched: number;
  collaboratorsTotal: number;
  lateRate: number | null;
  onTimeRate: number | null;
  open: number;
  overdue: number;
  overdueRate: number;
  pendingRate: number;
  total: number;
};

export type AsanaCollaboratorPerformance = {
  asanaGid?: string;
  asanaGids: string[];
  asanaName?: string;
  averageDelayDays: number;
  completed: number;
  completedLate: number;
  completedOnTime: number;
  completedRate: number;
  completedWithoutDue: number;
  email: string;
  hubUserId: string;
  lateRate: number | null;
  limitReached: boolean;
  matched: boolean;
  name: string;
  onTimeRate: number | null;
  open: number;
  overdue: number;
  overdueRate: number;
  pendingRate: number;
  taskQueryModes: AsanaTaskQueryMode[];
  total: number;
  workspaceNames: string[];
};

export type AsanaTeamPerformanceSnapshot = {
  collaborators: AsanaCollaboratorPerformance[];
  generatedAt: string;
  message?: string;
  source: {
    docsUrl: string;
    limitReached: boolean;
    missingEnv: string[];
    period: {
      endDate: string;
      label: string;
      preset: "custom" | "month" | "today" | "week";
      startDate: string;
    };
    periodBasis: "created_at";
    queryModes: AsanaTaskQueryMode[];
    taskOwnerBasis: "assignee";
    taskLimitPerUser: number;
    windowDays: number;
    workspaceConfigured: boolean;
    workspaceMode: "all" | "filtered";
    workspaces: Array<{
      gid: string;
      name?: string;
    }>;
  };
  status: AsanaPerformanceStatus;
  totals: AsanaPerformanceTotals;
};

export type AsanaPerformancePeriodRequest = {
  endDate: string;
  preset: "custom" | "month" | "today" | "week";
  startDate: string;
};

export async function getAsanaTeamPerformance(
  period?: AsanaPerformancePeriodRequest,
): Promise<AsanaTeamPerformanceSnapshot> {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao do Supabase indisponivel.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa ausente.");
  }

  const searchParams = new URLSearchParams();

  if (period) {
    searchParams.set("preset", period.preset);
    searchParams.set("startDate", period.startDate);
    searchParams.set("endDate", period.endDate);
  }

  const response = await fetch(
    `/api/hub/asana/performance${
      searchParams.size > 0 ? `?${searchParams.toString()}` : ""
    }`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | { data?: AsanaTeamPerformanceSnapshot; error?: string }
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel carregar o Asana.");
  }

  return payload.data;
}
