export type ServerSupabaseConfig = {
  anonKey?: string;
  serviceRoleKey?: string;
  url?: string;
};

export function getServerSupabaseConfig(): ServerSupabaseConfig {
  const env = process.env as Record<string, string | undefined>;

  return {
    anonKey:
      readEnvValue(env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ??
      readEnvValue(env.SUPABASE_ANON_KEY) ??
      readEnvValue(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
      readEnvValue(env.SUPABASE_PUBLISHABLE_KEY),
    serviceRoleKey:
      readEnvValue(env.SUPABASE_SERVICE_ROLE_KEY) ??
      readEnvValue(env.SUPABASE_SECRET_KEY),
    url:
      readEnvValue(env.NEXT_PUBLIC_SUPABASE_URL) ??
      readEnvValue(env.SUPABASE_URL),
  };
}

export function getServerSupabaseUrl() {
  return getServerSupabaseConfig().url;
}

export function getServerSupabaseAnonKey() {
  return getServerSupabaseConfig().anonKey;
}

function readEnvValue(value: string | undefined) {
  const normalizedValue = value?.trim();

  return normalizedValue ? normalizedValue : undefined;
}
