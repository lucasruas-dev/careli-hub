import {
  mapLegacyRoleToOperationalProfile,
  type HubUserContext,
  type OperationalProfileRole,
} from "@repo/shared";

import type { QueueClient } from "@/modules/guardian/attendance/types";

export type OverdueRangeFilter = "all" | "1-30" | "31-60" | "60+";

const HADES_PROFILE_LABELS: Record<OperationalProfileRole, string> = {
  adm: "Admin | visão total",
  cdr: "Coordenador | visão total",
  ldr: "Líder | visão total",
  op1: "OP1 | 1 a 30 dias",
  op2: "OP2 | 31 a 60 dias",
  op3: "OP3 | 61 a 90 dias",
};

export function resolveHadesOperationalProfile(hubUser: HubUserContext | null) {
  const profileRole =
    hubUser?.operationalProfile?.profileRole ??
    (hubUser ? mapLegacyRoleToOperationalProfile(hubUser.role) : "op1");

  return {
    label: HADES_PROFILE_LABELS[profileRole],
    profileRole,
  };
}

export function isClientInHadesProfileScope(
  client: QueueClient,
  profileRole: OperationalProfileRole,
) {
  if (profileRole === "adm" || profileRole === "cdr" || profileRole === "ldr") {
    return true;
  }

  if (profileRole === "op1") {
    return client.atrasoDias >= 1 && client.atrasoDias <= 30;
  }

  if (profileRole === "op2") {
    return client.atrasoDias >= 31 && client.atrasoDias <= 60;
  }

  return client.atrasoDias >= 61 && client.atrasoDias <= 90;
}

export function isHadesLeadershipProfile(profileRole: OperationalProfileRole) {
  return profileRole === "adm" || profileRole === "cdr" || profileRole === "ldr";
}

export function isClientInOverdueRange(
  client: QueueClient,
  range: OverdueRangeFilter,
) {
  if (range === "1-30") {
    return client.atrasoDias >= 1 && client.atrasoDias <= 30;
  }

  if (range === "31-60") {
    return client.atrasoDias >= 31 && client.atrasoDias <= 60;
  }

  if (range === "60+") {
    return client.atrasoDias > 60;
  }

  return true;
}

export function buildOverdueRangeCounts(clients: QueueClient[]) {
  return {
    "1-30": clients.filter((client) => isClientInOverdueRange(client, "1-30")).length,
    "31-60": clients.filter((client) => isClientInOverdueRange(client, "31-60")).length,
    "60+": clients.filter((client) => isClientInOverdueRange(client, "60+")).length,
    all: clients.length,
  } satisfies Record<OverdueRangeFilter, number>;
}
