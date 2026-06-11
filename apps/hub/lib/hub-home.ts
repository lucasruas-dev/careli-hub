"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  HubPresenceActiveMeeting,
  HubPresenceStatus,
} from "@/lib/hub-presence";

export type HubHomeUser = {
  avatarUrl?: string;
  departmentId?: string;
  departmentName?: string;
  displayName: string;
  email: string;
  id: string;
  operationalProfile?: string;
  role: string;
  sectorId?: string;
  sectorName?: string;
  status: string;
};

export type HubHomePresence = {
  currentMeeting?: HubPresenceActiveMeeting;
  lastSeenAt: string;
  status: HubPresenceStatus;
  userId: string;
};

export type HubHomeModule = {
  basePath: string;
  id: string;
  name: string;
  order: number;
  status: string;
};

export type HubHomeDepartmentModule = {
  departmentId: string;
  moduleId: string;
  status: string;
};

export type HubHomeActivityEvent = {
  createdAt: string;
  description?: string;
  id: string;
  metadata: Record<string, unknown>;
  moduleId?: string;
  severity: "danger" | "info" | "neutral" | "success" | "warning";
  title: string;
  type: "module" | "notification" | "presence" | "sync" | "system";
  userId?: string;
};

export type HubAvailabilityTeamMember = {
  currentMeeting?: HubPresenceActiveMeeting;
  currentStatus: Exclude<HubPresenceStatus, "busy">;
  displayName: string;
  email: string;
  lastEvent?: {
    nextStatus: Exclude<HubPresenceStatus, "busy">;
    reason: string;
    source: string;
    startedAt: string;
  };
  lastSeenAt?: string;
  productiveSeconds: number;
  productivityRate: number | null;
  totals: Record<Exclude<HubPresenceStatus, "busy">, number>;
  trackedSeconds: number;
  transitionCount: number;
  userId: string;
};

export type HubAvailabilityHistoryEntry = {
  createdAt: string;
  endedAt?: string;
  id: string;
  metadata: Record<string, unknown>;
  nextStatus: Exclude<HubPresenceStatus, "busy">;
  previousStatus?: Exclude<HubPresenceStatus, "busy">;
  reason: string;
  source: string;
  startedAt: string;
  userId: string;
  userName: string;
};

export type HubAvailabilitySnapshot = {
  generatedAt: string;
  history: HubAvailabilityHistoryEntry[];
  policy: {
    awayTimeoutMs: number;
    label: string;
    logoutTimeoutMs: number;
    meetingException: boolean;
  };
  rangeEnd: string;
  rangeStart: string;
  summary: {
    autoLogoutCount: number;
    meetingCount: number;
    productiveSeconds: number;
    productivityRate: number | null;
    riskCount: number;
    statusCounts: Record<Exclude<HubPresenceStatus, "busy">, number>;
    trackedSeconds: number;
    transitionCount: number;
  };
  team: HubAvailabilityTeamMember[];
};

export type HubHomeSnapshot = {
  activityEvents: HubHomeActivityEvent[];
  availability?: HubAvailabilitySnapshot;
  departmentModules: HubHomeDepartmentModule[];
  generatedAt: string;
  modules: HubHomeModule[];
  notifications: {
    unreadCount: number;
  };
  presence: HubHomePresence[];
  pulsex: {
    messagesTodayCount: number;
  };
  users: HubHomeUser[];
};

export async function getHubHomeSnapshot(): Promise<HubHomeSnapshot> {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao do Supabase indisponivel.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa ausente.");
  }

  const response = await fetch("/api/hub/home", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: HubHomeSnapshot; error?: string }
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel carregar a Home.");
  }

  return payload.data;
}
