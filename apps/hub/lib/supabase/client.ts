"use client";

import {
  createSupabaseAuthClient,
  hasSupabaseAuthConfig,
} from "@repo/auth";

export const hubSupabaseConfig = {
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  workspaceId: process.env.NEXT_PUBLIC_SUPABASE_WORKSPACE_ID ?? "careli",
};

let browserClient: ReturnType<typeof createSupabaseAuthClient> | null = null;

export function hasHubSupabaseConfig() {
  return hasSupabaseAuthConfig(hubSupabaseConfig);
}

export function getHubSupabaseClient() {
  if (!hasSupabaseAuthConfig(hubSupabaseConfig)) {
    return null;
  }

  browserClient ??= createSupabaseAuthClient(hubSupabaseConfig);

  return browserClient;
}
