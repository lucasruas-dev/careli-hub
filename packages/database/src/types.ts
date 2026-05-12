import type { CanonicalDatabaseTableName } from "./schema";

export type DatabaseClientStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "degraded"
  | "offline"
  | "error";

export type DatabaseEnvironment =
  | "local"
  | "development"
  | "staging"
  | "production";

export type DatabaseTableName = CanonicalDatabaseTableName;

export type DatabaseConnectionConfig = {
  environment: DatabaseEnvironment;
  projectUrl?: string;
  schema?: string;
  serviceRoleEnabled?: boolean;
};

export type DatabaseQueryResult<Row = unknown> =
  | {
      count?: number;
      data: readonly Row[];
      error?: never;
      ok: true;
    }
  | {
      count?: number;
      data?: never;
      error: string;
      ok: false;
    };

export type DatabaseMutationResult<Row = unknown> =
  | {
      affectedRows?: number;
      data?: Row;
      error?: never;
      ok: true;
    }
  | {
      affectedRows?: number;
      data?: never;
      error: string;
      ok: false;
    };

export type DatabaseHealthCheck = {
  checkedAt: string;
  environment: DatabaseEnvironment;
  latencyMs?: number;
  message?: string;
  status: DatabaseClientStatus;
};

export type DatabaseAdapter = {
  connect: (
    config: DatabaseConnectionConfig,
  ) => Promise<DatabaseHealthCheck>;
  disconnect: () => Promise<void>;
  healthCheck: () => Promise<DatabaseHealthCheck>;
  mutate: <Row = unknown>(
    tableName: DatabaseTableName,
    input: unknown,
  ) => Promise<DatabaseMutationResult<Row>>;
  query: <Row = unknown>(
    tableName: DatabaseTableName,
  ) => Promise<DatabaseQueryResult<Row>>;
};
