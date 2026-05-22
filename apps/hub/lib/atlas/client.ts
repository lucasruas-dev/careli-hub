"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";
import type { AtlasFpeEntryKind, AtlasSnapshot } from "./types";

type AtlasSnapshotResponse = {
  code?: string;
  data?: AtlasSnapshot;
  error?: string;
};

type AtlasMutationResponse<TData> = {
  code?: string;
  data?: TData;
  error?: string;
};

export type AtlasEvidenceClientInput = {
  name?: string | null;
  type?: string | null;
  url: string;
};

export type AtlasEvidenceUploadClientInput = {
  file: File;
  occurrenceId?: string | null;
};

export type AtlasEvidenceUploadClientResult = AtlasEvidenceClientInput & {
  bucket: string;
  path: string;
  size: number;
};

export type AddAtlasOccurrenceEvidencesClientInput = {
  evidences: AtlasEvidenceClientInput[];
  occurrenceId: string;
};

export type CreateAtlasOccurrenceClientInput = {
  collaboratorId: string;
  evidences?: AtlasEvidenceClientInput[];
  occurrenceDate: string;
  observation?: string | null;
  typeId: string;
};

export type CreateAtlasFpeEntryClientInput = {
  amount: number | string;
  collaboratorId: string;
  description?: string | null;
  entryDate: string;
  evidences?: AtlasEvidenceClientInput[];
  kind: AtlasFpeEntryKind;
  typeId: string;
};

export type ReviewAtlasJustificationClientInput = {
  action: "accept" | "reject";
  occurrenceId: string;
  reviewNote?: string | null;
};

export type SubmitAtlasJustificationClientInput = {
  justification: string;
  occurrenceId: string;
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

export async function createAtlasOccurrence(
  input: CreateAtlasOccurrenceClientInput,
  accessToken?: string | null,
) {
  return executeAtlasMutation<{
    code?: number | string | null;
    evidenceCount?: number;
    id: string;
  }>(
    "/api/atlas/occurrences",
    {
      body: input,
      method: "POST",
    },
    accessToken,
  );
}

export async function createAtlasFpeEntry(
  input: CreateAtlasFpeEntryClientInput,
  accessToken?: string | null,
) {
  return executeAtlasMutation<{
    id: string;
    occurrenceCode?: number | string | null;
    occurrenceId: string;
  }>(
    "/api/atlas/fpe/entries",
    {
      body: { ...input },
      method: "POST",
    },
    accessToken,
  );
}

export async function addAtlasOccurrenceEvidences(
  input: AddAtlasOccurrenceEvidencesClientInput,
  accessToken?: string | null,
) {
  return executeAtlasMutation<{ count: number; id: string }>(
    `/api/atlas/occurrences/${encodeURIComponent(
      input.occurrenceId,
    )}/evidences`,
    {
      body: {
        evidences: input.evidences,
      },
      method: "POST",
    },
    accessToken,
  );
}

export async function uploadAtlasEvidenceFile(
  input: AtlasEvidenceUploadClientInput,
  accessToken?: string | null,
) {
  const token = await getAtlasAccessToken(accessToken);
  const formData = new FormData();

  formData.append("file", input.file);

  if (input.occurrenceId) {
    formData.append("occurrenceId", input.occurrenceId);
  }

  const response = await fetch("/api/atlas/evidences/upload", {
    body: formData,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | AtlasMutationResponse<AtlasEvidenceUploadClientResult>
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel anexar o arquivo.");
  }

  return payload.data;
}

export async function submitAtlasOccurrenceJustification(
  input: SubmitAtlasJustificationClientInput,
  accessToken?: string | null,
) {
  return executeAtlasMutation<{ id: string }>(
    `/api/atlas/occurrences/${encodeURIComponent(
      input.occurrenceId,
    )}/justification`,
    {
      body: {
        action: "submit",
        justification: input.justification,
      },
      method: "PATCH",
    },
    accessToken,
  );
}

export async function reviewAtlasOccurrenceJustification(
  input: ReviewAtlasJustificationClientInput,
  accessToken?: string | null,
) {
  return executeAtlasMutation<{ id: string; operationalStatus: string }>(
    `/api/atlas/occurrences/${encodeURIComponent(
      input.occurrenceId,
    )}/justification`,
    {
      body: {
        action: input.action,
        reviewNote: input.reviewNote,
      },
      method: "PATCH",
    },
    accessToken,
  );
}

async function executeAtlasMutation<TData>(
  url: string,
  options: {
    body: Record<string, unknown>;
    method: "PATCH" | "POST";
  },
  accessToken?: string | null,
) {
  const token = await getAtlasAccessToken(accessToken);
  const response = await fetch(url, {
    body: JSON.stringify(options.body),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: options.method,
  });
  const payload = (await response.json().catch(() => null)) as
    | AtlasMutationResponse<TData>
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel atualizar o Atlas.");
  }

  return payload.data;
}
