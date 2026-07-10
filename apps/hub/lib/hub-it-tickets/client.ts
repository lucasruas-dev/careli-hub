"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  HubItTicket,
  HubItTicketCreateInput,
  HubItTicketEvidenceAnalysis,
  HubItTicketEvidenceAnalysisInput,
  HubItTicketListScope,
  HubItTicketUpdateInput,
} from "./types";

type HubItTicketsApiResponse = {
  error?: string;
  message?: string;
  status?: string;
  ticket?: HubItTicket;
  tickets?: HubItTicket[];
};

type HubItTicketEvidenceAnalysisApiResponse = Partial<HubItTicketEvidenceAnalysis> & {
  error?: string;
};

export async function getHubItTicketAccessToken(fallback?: string | null) {
  if (fallback) {
    return fallback;
  }

  const client = getHubSupabaseClient();

  if (!client) {
    return null;
  }

  const { data } = await client.auth.getSession();

  return data.session?.access_token ?? null;
}

export async function loadHubItTickets({
  accessToken,
  details = "list",
  protocol,
  scope = "mine",
}: {
  accessToken?: string | null;
  details?: "full" | "list";
  protocol?: string;
  scope?: HubItTicketListScope;
}) {
  const token = await getHubItTicketAccessToken(accessToken);

  if (!token) {
    throw new Error("Sessao ausente para carregar HelpDesk.");
  }

  const params = new URLSearchParams({
    details,
    scope,
  });

  if (protocol) {
    params.set("protocol", protocol);
  }

  const response = await fetch(`/api/hub/it-tickets?${params.toString()}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | HubItTicketsApiResponse
    | null;

  if (!response.ok || !Array.isArray(payload?.tickets)) {
    throw new Error(
      getHubItTicketResponseMessage(
        payload,
        "Nao foi possivel carregar HelpDesk.",
      ),
    );
  }

  return payload.tickets;
}

export async function createHubItTicket({
  accessToken,
  input,
}: {
  accessToken?: string | null;
  input: HubItTicketCreateInput;
}) {
  const token = await getHubItTicketAccessToken(accessToken);

  if (!token) {
    throw new Error("Sessao ausente para enviar HelpDesk.");
  }

  const response = await fetch("/api/hub/it-tickets", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | HubItTicketsApiResponse
    | null;

  if (!response.ok || !payload?.ticket) {
    throw new Error(
      getHubItTicketResponseMessage(
        payload,
        "Nao foi possivel enviar HelpDesk.",
      ),
    );
  }

  return payload.ticket;
}

export async function analyzeHubItTicketEvidence({
  accessToken,
  input,
}: {
  accessToken?: string | null;
  input: HubItTicketEvidenceAnalysisInput;
}) {
  const token = await getHubItTicketAccessToken(accessToken);

  if (!token) {
    throw new Error("Sessao ausente para analisar evidencias.");
  }

  const response = await fetch("/api/hub/it-tickets/evidence-analysis", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | HubItTicketEvidenceAnalysisApiResponse
    | null;

  if (!response.ok || !payload?.technicalSummary) {
    throw new Error(payload?.error ?? "Nao foi possivel analisar evidencias.");
  }

  return {
    actualResult: payload.actualResult,
    evidenceInsights: payload.evidenceInsights ?? [],
    expectedResult: payload.expectedResult,
    source: payload.source ?? "fallback",
    technicalSummary: payload.technicalSummary,
  } satisfies HubItTicketEvidenceAnalysis;
}

export async function updateHubItTicket({
  accessToken,
  input,
}: {
  accessToken?: string | null;
  input: HubItTicketUpdateInput;
}) {
  const token = await getHubItTicketAccessToken(accessToken);

  if (!token) {
    throw new Error("Sessao ausente para atualizar HelpDesk.");
  }

  const response = await fetch("/api/hub/it-tickets", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  const payload = (await response.json().catch(() => null)) as
    | HubItTicketsApiResponse
    | null;

  if (!response.ok || !payload?.ticket) {
    throw new Error(
      getHubItTicketResponseMessage(
        payload,
        "Nao foi possivel atualizar HelpDesk.",
      ),
    );
  }

  return payload.ticket;
}

export function isHubItTicketsMigrationPendingMessage(
  message: string | null | undefined,
) {
  const normalizedMessage = normalizeHubItTicketErrorMessage(message);

  return (
    normalizedMessage.includes("migration") &&
    (normalizedMessage.includes("ticket ti") ||
      normalizedMessage.includes("helpdesk"))
  );
}

function getHubItTicketResponseMessage(
  payload: HubItTicketsApiResponse | null,
  fallbackMessage: string,
) {
  if (payload?.status === "migration_pendente") {
    return (
      payload.message ??
      "HelpDesk aguarda aplicacao da migration Supabase no banco."
    );
  }

  return payload?.error ?? payload?.message ?? fallbackMessage;
}

function normalizeHubItTicketErrorMessage(
  message: string | null | undefined,
) {
  return (message ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
