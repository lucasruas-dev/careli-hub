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

export function getHubSupabaseDiagnostics() {
  return {
    hasAnonKey: Boolean(hubSupabaseConfig.anonKey?.trim()),
    hasUrl: Boolean(hubSupabaseConfig.url?.trim()),
    url: maskSupabaseUrl(hubSupabaseConfig.url),
    workspaceId: hubSupabaseConfig.workspaceId,
  };
}

function maskSupabaseUrl(url?: string) {
  if (!url?.trim()) {
    return "missing";
  }

  try {
    const parsedUrl = new URL(url);
    const [projectRef = "unknown"] = parsedUrl.hostname.split(".");
    const visibleRef =
      projectRef.length > 8
        ? `${projectRef.slice(0, 4)}...${projectRef.slice(-4)}`
        : projectRef;

    return `${parsedUrl.protocol}//${visibleRef}.${parsedUrl.hostname
      .split(".")
      .slice(1)
      .join(".")}`;
  } catch {
    return "invalid-url";
  }
}
