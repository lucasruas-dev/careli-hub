// CHECK final (leitura apenas): users.imobiliaria_id e coluna viva ou morta para clientes?
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});
const [r] = await c.query(
  `SELECT (created_at >= '2026-08-01') novo, COUNT(*) n,
          SUM(imobiliaria_id IS NOT NULL) com_imob_col, SUM(vinculed_by_id IS NOT NULL) com_vinculo
     FROM users WHERE profile_id = 2 GROUP BY novo`,
);
console.log("clientes (profile 2):", JSON.stringify(r));
await c.end();
