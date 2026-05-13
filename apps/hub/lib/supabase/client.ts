"use client";

import {
  createSupabaseAuthClient,
  hasSupabaseAuthConfig,
} from "@repo/auth";

const supabaseConfig = {
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
};

let browserClient: ReturnType<typeof createSupabaseAuthClient> | null = null;

export function hasHubSupabaseConfig() {
  return hasSupabaseAuthConfig(supabaseConfig);
}

export function getHubSupabaseClient() {
  if (!hasSupabaseAuthConfig(supabaseConfig)) {
    return null;
  }

  browserClient ??= createSupabaseAuthClient(supabaseConfig);

  return browserClient;
}
