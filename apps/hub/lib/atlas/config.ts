export type AtlasSupabaseConfig = {
  anonKey?: string;
  projectRef?: string;
  url?: string;
};

export function getAtlasSupabaseConfig(): AtlasSupabaseConfig {
  const env = process.env as Record<string, string | undefined>;
  const url = readEnvValue(env.ATLAS_SUPABASE_URL);

  return {
    anonKey:
      readEnvValue(env.ATLAS_SUPABASE_ANON_KEY) ??
      readEnvValue(env.ATLAS_SUPABASE_PUBLISHABLE_KEY),
    projectRef: getProjectRef(url),
    url,
  };
}

export function maskAtlasProjectRef(projectRef?: string) {
  if (!projectRef) {
    return undefined;
  }

  if (projectRef.length <= 8) {
    return "configurado";
  }

  return `${projectRef.slice(0, 4)}...${projectRef.slice(-4)}`;
}

function readEnvValue(value: string | undefined) {
  const normalizedValue = value?.trim();

  return normalizedValue ? normalizedValue : undefined;
}

function getProjectRef(url?: string) {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).hostname.split(".")[0] || undefined;
  } catch {
    return undefined;
  }
}
