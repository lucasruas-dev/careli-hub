import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const envRoots = [
  process.cwd(),
  resolve(process.cwd(), "../.."),
];
const envFiles = [".env", ".env.local", "apps/hub/.env.local"];

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

for (const root of envRoots) {
  for (const filePath of envFiles) {
    loadEnvFile(resolve(root, filePath));
  }
}

const postgresUrl = process.env.HOMOLOG_POSTGRES_URL;

if (!postgresUrl) {
  console.error(
    "HOMOLOG_POSTGRES_URL is required to apply the Chronos Google Calendar watch schema. No secret values were printed.",
  );
  process.exit(1);
}

const sqlPath = resolve(
  process.cwd(),
  "packages/database/migrations/0036_chronos_google_calendar_watch.sql",
);
const sql = readFileSync(sqlPath, "utf8");
const client = new pg.Client({
  connectionString: postgresUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(sql);

  const { rows } = await client.query(
    `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'chronos_google_calendar_connections'
        and column_name like 'watch_%'
      order by column_name
    `,
  );

  console.log(
    JSON.stringify(
      {
        applied: true,
        table: "public.chronos_google_calendar_connections",
        columns: rows.map((row) => row.column_name),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        applied: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
