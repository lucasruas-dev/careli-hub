// READ-ONLY. Os planos comerciais reais de ACP e JDG no C2X, para o Lucas cadastrar no Panteon
// conferindo contra a fonte em vez de digitar de memória.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});

const [cols] = await c.query(
  `select column_name from information_schema.columns
    where table_schema = ? and table_name = 'commercial_plans' order by ordinal_position`, [env.GUARDIAN_DB_NAME]);
console.log("COLUNAS:", cols.map((x) => x.COLUMN_NAME ?? x.column_name).join(", "), "\n");

const [linhas] = await c.query(
  `select cp.*, e.code, e.name enterprise, dc.name minuta
     from commercial_plans cp
     join enterprises e on e.id = cp.enterprise_id
     left join draft_contracts dc on dc.id = cp.draft_contract_id
    where e.id in (40, 42)
    order by e.code, cp.id`);

for (const l of linhas) {
  console.log(`\n=== ${l.code} · ${l.name ?? "(sem nome)"} (plano #${l.id}) ===`);
  for (const [k, v] of Object.entries(l)) {
    if (["code", "enterprise", "id"].includes(k)) continue;
    if (v === null || v === "" ) continue;
    console.log(`  ${k}: ${v instanceof Date ? v.toISOString().slice(0,10) : v}`);
  }
}
await c.end();
