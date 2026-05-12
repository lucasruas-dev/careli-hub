import type {
  DatabaseAdapter,
  DatabaseClientStatus,
  DatabaseConnectionConfig,
  DatabaseHealthCheck,
  DatabaseMutationResult,
  DatabaseQueryResult,
  DatabaseTableName,
} from "../types";
import type {
  SupabaseAdapterOptions,
  SupabaseDatabaseConfig,
  SupabaseHealthCheckResult,
} from "./types";

const DEFAULT_SUPABASE_CONFIG: SupabaseDatabaseConfig = {
  environment: "development",
  schema: "public",
};

function createSupabaseHealthCheck(
  status: DatabaseClientStatus,
  config: SupabaseDatabaseConfig,
  options: SupabaseAdapterOptions,
): SupabaseHealthCheckResult {
  return {
    checkedAt: "agora",
    environment: config.environment,
    latencyMs:
      status === "connected"
        ? (options.simulatedLatencyMs ?? 28)
        : undefined,
    message:
      status === "connected"
        ? "Supabase adapter placeholder conectado em modo simulado."
        : "Supabase adapter placeholder sem conexao real.",
    projectRef: config.projectRef,
    provider: "supabase",
    simulated: true,
    status,
  };
}

function createNotConnectedHealthCheck(
  config: SupabaseDatabaseConfig,
  options: SupabaseAdapterOptions,
): DatabaseHealthCheck {
  return createSupabaseHealthCheck("offline", config, options);
}

export function createSupabaseDatabaseAdapter(
  config: SupabaseDatabaseConfig = DEFAULT_SUPABASE_CONFIG,
  options: SupabaseAdapterOptions = {},
): DatabaseAdapter {
  let activeConfig = config;
  let status: DatabaseClientStatus = options.initialStatus ?? "idle";

  return {
    async connect(
      connectionConfig: DatabaseConnectionConfig,
    ): Promise<DatabaseHealthCheck> {
      activeConfig = {
        ...activeConfig,
        ...connectionConfig,
      };
      status = "connected";

      return createSupabaseHealthCheck(status, activeConfig, options);
    },
    async disconnect(): Promise<void> {
      status = "offline";
    },
    async healthCheck(): Promise<DatabaseHealthCheck> {
      return createSupabaseHealthCheck(status, activeConfig, options);
    },
    async mutate<Row = unknown>(
      tableName: DatabaseTableName,
      input: unknown,
    ): Promise<DatabaseMutationResult<Row>> {
      void tableName;
      void input;

      if (status !== "connected") {
        return {
          affectedRows: 0,
          error:
            createNotConnectedHealthCheck(activeConfig, options).message ??
            "Supabase adapter placeholder nao conectado.",
          ok: false,
        };
      }

      if (options.readonly) {
        return {
          affectedRows: 0,
          error: "Supabase adapter placeholder esta em modo readonly.",
          ok: false,
        };
      }

      return {
        affectedRows: 0,
        ok: true,
      };
    },
    async query<Row = unknown>(
      tableName: DatabaseTableName,
    ): Promise<DatabaseQueryResult<Row>> {
      void tableName;

      if (status !== "connected") {
        return {
          count: 0,
          error:
            createNotConnectedHealthCheck(activeConfig, options).message ??
            "Supabase adapter placeholder nao conectado.",
          ok: false,
        };
      }

      return {
        count: 0,
        data: [],
        ok: true,
      };
    },
  };
}
