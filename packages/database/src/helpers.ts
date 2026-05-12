import type {
  DatabaseClientStatus,
  DatabaseEnvironment,
  DatabaseHealthCheck,
  DatabaseMutationResult,
  DatabaseQueryResult,
} from "./types";

export type DatabasePulseState =
  | "idle"
  | "live"
  | "syncing"
  | "delayed"
  | "offline";

export function createMockDatabaseStatus(
  status: DatabaseClientStatus = "connected",
  environment: DatabaseEnvironment = "development",
): DatabaseHealthCheck {
  return {
    checkedAt: "agora",
    environment,
    latencyMs: status === "connected" ? 24 : undefined,
    message:
      status === "connected"
        ? "Contrato database mockado ativo."
        : "Database sem conexao real configurada.",
    status,
  };
}

export function isDatabaseConnected(
  databaseStatus: DatabaseClientStatus | DatabaseHealthCheck,
): boolean {
  const status =
    typeof databaseStatus === "string"
      ? databaseStatus
      : databaseStatus.status;

  return status === "connected";
}

export function createDatabaseQueryResult<Row>(
  data: readonly Row[] = [],
  count = data.length,
): DatabaseQueryResult<Row> {
  return {
    count,
    data,
    ok: true,
  };
}

export function createDatabaseMutationResult<Row>(
  data?: Row,
  affectedRows = data ? 1 : 0,
): DatabaseMutationResult<Row> {
  return {
    affectedRows,
    data,
    ok: true,
  };
}

export function mapDatabaseStatusToPulseState(
  status: DatabaseClientStatus,
): DatabasePulseState {
  const statusMap: Record<DatabaseClientStatus, DatabasePulseState> = {
    connected: "live",
    connecting: "syncing",
    degraded: "delayed",
    error: "delayed",
    idle: "idle",
    offline: "offline",
  };

  return statusMap[status];
}
