import mysql, {
  type Pool,
  type QueryResult,
  type RowDataPacket,
} from "mysql2/promise";

type HadesDbConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
};

type HadesConfigResult =
  | { ok: true; config: HadesDbConfig }
  | { ok: false; missing: string[] };

type HadesPoolResult =
  | { ok: true; pool: Pool; config: HadesDbConfig }
  | { ok: false; missing: string[] };

export type HadesPingResult =
  | {
      ok: true;
      databaseName: string | null;
      elapsedMs: number;
      serverTime: string | null;
    }
  | { ok: false; missing: string[] };

type HadesHealthRow = RowDataPacket & {
  database_name: string | null;
  server_time: Date | string | null;
};

let guardianPool: Pool | null = null;
let guardianPoolSignature: string | null = null;

function readEnv(name: string) {
  const value = process.env[name]?.trim() ?? "";

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function getHadesDbConfig(): HadesConfigResult {
  const host = readEnv("GUARDIAN_DB_HOST");
  const portValue = readEnv("GUARDIAN_DB_PORT") || "3306";
  const database = readEnv("GUARDIAN_DB_NAME");
  const user = readEnv("GUARDIAN_DB_USER");
  const password = readEnv("GUARDIAN_DB_PASSWORD");
  const ssl = readEnv("GUARDIAN_DB_SSL").toLowerCase() === "true";
  const port = Number(portValue);
  const missing: string[] = [];

  if (!host) missing.push("GUARDIAN_DB_HOST");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    missing.push("GUARDIAN_DB_PORT");
  }
  if (!database) missing.push("GUARDIAN_DB_NAME");
  if (!user) missing.push("GUARDIAN_DB_USER");
  if (!password) missing.push("GUARDIAN_DB_PASSWORD");

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    config: {
      host,
      port,
      database,
      user,
      password,
      ssl,
    },
  };
}

export function getHadesDbPool(): HadesPoolResult {
  const configResult = getHadesDbConfig();

  if (!configResult.ok) {
    return configResult;
  }

  const { config } = configResult;
  const signature = [
    config.host,
    config.port,
    config.database,
    config.user,
    config.ssl ? "ssl" : "plain",
  ].join(":");

  if (!guardianPool || guardianPoolSignature !== signature) {
    guardianPool = mysql.createPool({
      charset: "utf8mb4",
      connectTimeout: 8000,
      connectionLimit: 5,
      database: config.database,
      host: config.host,
      password: config.password,
      port: config.port,
      queueLimit: 0,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      timezone: "Z",
      user: config.user,
      waitForConnections: true,
    });
    guardianPoolSignature = signature;
  }

  return { ok: true, pool: guardianPool, config };
}

export async function pingHadesDb(): Promise<HadesPingResult> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return poolResult;
  }

  const startedAt = Date.now();
  const [rows] = await poolResult.pool.query<HadesHealthRow[]>(
    "select database() as database_name, current_timestamp() as server_time",
  );
  const firstRow = rows[0];

  return {
    ok: true,
    databaseName: firstRow?.database_name ?? null,
    elapsedMs: Date.now() - startedAt,
    serverTime:
      firstRow?.server_time instanceof Date
        ? firstRow.server_time.toISOString()
        : firstRow?.server_time ?? null,
  };
}

export function sanitizeHadesDbError(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as Partial<{
      code: string;
      errno: number;
      message: string;
      sqlMessage: string;
      sqlState: string;
    }>;

    return {
      code: candidate.code ?? "GUARDIAN_DB_ERROR",
      errno: candidate.errno,
      message:
        candidate.sqlMessage ??
        candidate.message ??
        "Nao foi possivel conectar ao banco do Hades.",
      sqlState: candidate.sqlState,
    };
  }

  return {
    code: "GUARDIAN_DB_ERROR",
    message: "Nao foi possivel conectar ao banco do Hades.",
  };
}

export type HadesQueryResult<T extends QueryResult = RowDataPacket[]> = T;
