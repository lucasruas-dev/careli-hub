"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";

export type HubAiModule = "desk" | "guardian" | "hub" | "pulsex" | "setup";

export type HubAiClientMessage = {
  content: string;
  role: "assistant" | "user";
};

export type HubAiAskInput = {
  context?: unknown;
  feature?: string;
  messages?: HubAiClientMessage[];
  module: HubAiModule;
  prompt: string;
};

export async function askHubAi(input: HubAiAskInput) {
  const accessToken = await getHubAiAccessToken();
  const response = await fetch("/api/ai/chat", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | {
        error?: unknown;
        text?: unknown;
      }
    | null;

  if (!response.ok) {
    throw new Error(getHubAiErrorMessage(payload, response.status));
  }

  if (typeof payload?.text !== "string" || !payload.text.trim()) {
    throw new Error("A Careli AI nao retornou uma resposta.");
  }

  return {
    text: payload.text.trim(),
  };
}

export function mapHubAiMessages(
  messages: Array<{ content: string; role: "ai" | "user" }>,
): HubAiClientMessage[] {
  return messages.map((message) => ({
    content: message.content,
    role: message.role === "ai" ? "assistant" : "user",
  }));
}

async function getHubAiAccessToken() {
  const client = getHubSupabaseClient();

  if (!client) {
    return "local-hub-user";
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao ausente para usar a Careli AI.");
  }

  return accessToken;
}

function getHubAiErrorMessage(
  payload: { error?: unknown } | null,
  status: number,
) {
  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error;
  }

  if (status === 503) {
    return "Careli AI ainda nao configurada no ambiente.";
  }

  if (status === 401) {
    return "Sessao ausente para usar a Careli AI.";
  }

  return "Nao foi possivel consultar a Careli AI agora.";
}
