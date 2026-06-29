import { getHubSupabaseClient } from "@/lib/supabase/client";

import type { ManualHadesOperations } from "../types/apolo-local";

// Acesso a dados / operacoes manuais do Apolo (extraidos do ApoloPage monolitico).

export const emptyManualHadesOperations: ManualHadesOperations = {
  commitments: [],
  events: [],
};

export async function getApoloAccessToken(required = true) {
  const client = getHubSupabaseClient();

  if (!client) {
    if (!required) {
      return null;
    }

    throw new Error("Sessao administrativa ausente.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token ?? null;

  if ((sessionResult.error || !accessToken) && required) {
    throw new Error("Sessao administrativa ausente.");
  }

  return accessToken;
}

export async function loadHadesManualOperations(
  clientId: string,
  accessToken: string,
): Promise<ManualHadesOperations> {
  const response = await fetch(
    `/api/hades/attendance/manual-events?clientId=${encodeURIComponent(clientId)}`,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | ManualHadesOperations
    | { error?: string }
    | null;

  if (!response.ok || !isManualHadesOperations(payload)) {
    return emptyManualHadesOperations;
  }

  return {
    commitments: payload.commitments ?? [],
    events: payload.events ?? [],
  };
}

export async function persistHadesManualOperation({
  body,
  method,
}: {
  body: Record<string, unknown>;
  method: "PATCH" | "POST";
}): Promise<ManualHadesOperations> {
  const accessToken = await getApoloAccessToken();
  const response = await fetch("/api/hades/attendance/manual-events", {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method,
  });
  const payload = (await response.json().catch(() => null)) as
    | ManualHadesOperations
    | { error?: string }
    | null;

  if (!response.ok || !isManualHadesOperations(payload)) {
    throw new Error(manualHadesError(payload) ?? "Nao foi possivel salvar registro operacional.");
  }

  return {
    commitments: payload.commitments ?? [],
    events: payload.events ?? [],
  };
}

export function upsertById<T extends { id: string }>(nextRows: T[], currentRows: T[]) {
  const nextIds = new Set(nextRows.map((row) => row.id));

  return [
    ...nextRows,
    ...currentRows.filter((row) => !nextIds.has(row.id)),
  ];
}

export function isManualHadesOperations(input: unknown): input is ManualHadesOperations {
  return (
    Boolean(input) &&
    typeof input === "object" &&
    Array.isArray((input as Partial<ManualHadesOperations>).commitments) &&
    Array.isArray((input as Partial<ManualHadesOperations>).events)
  );
}

export function manualHadesError(input: unknown) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const error = (input as { error?: unknown }).error;

  return typeof error === "string" ? error : null;
}
