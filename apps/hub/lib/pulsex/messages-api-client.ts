import { getHubSupabaseClient } from "@/lib/supabase/client";

import { HERMES_MESSAGES_API_ROUTE } from "./routes";

type HubSupabaseClient = NonNullable<ReturnType<typeof getHubSupabaseClient>>;

export async function fetchHermesMessagesApi<TPayload>({
  body,
  client,
  method = "GET",
  url = HERMES_MESSAGES_API_ROUTE,
}: {
  body?: unknown;
  client: HubSupabaseClient;
  method?: "GET" | "PATCH" | "POST";
  url?: string;
}) {
  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    return null;
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${accessToken}`,
  };
  const init: RequestInit = {
    headers,
    method,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as TPayload | null;

  return {
    payload,
    response,
  };
}
