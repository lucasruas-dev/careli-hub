import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
  .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]; }));
const c = await mysql.createConnection({ database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD, port: Number(env.GUARDIAN_DB_PORT||3306), user: env.GUARDIAN_DB_USER });
const [t] = await c.query(`select table_name from information_schema.tables where table_schema=? and table_name like '%monet%'`, [env.GUARDIAN_DB_NAME]);
console.log("tabelas:", t.map(x=>x.TABLE_NAME??x.table_name).join(", "));
for (const row of t) {
  const nome = row.TABLE_NAME ?? row.table_name;
  const [linhas] = await c.query(`select * from \`${nome}\``);
  console.log(`\n--- ${nome} ---`);
  for (const l of linhas) console.log(JSON.stringify(l));
}
await c.end();
