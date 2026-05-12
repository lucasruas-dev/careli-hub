import type {
  DatabaseClientStatus,
  DatabaseConnectionConfig,
  DatabaseHealthCheck,
} from "../types";

export type SupabaseDatabaseConfig = DatabaseConnectionConfig & {
  anonKey?: string;
  projectRef?: string;
};

export type SupabaseAdapterOptions = {
  initialStatus?: DatabaseClientStatus;
  readonly?: boolean;
  simulatedLatencyMs?: number;
};

export type SupabaseHealthCheckResult = DatabaseHealthCheck & {
  projectRef?: string;
  provider: "supabase";
  simulated: true;
};
