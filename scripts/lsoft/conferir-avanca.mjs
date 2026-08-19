// CONFERENCIA read-only: a AVANCA (id 4175) e do Kleber? Quem ela ja vincula?
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
const [[imob]] = await c.query(
  "select id, name, social_name, fantasy_name, cnpj, email from users where id = 4175",
);
console.log("### AVANCA (id 4175)");
for (const [k, v] of Object.entries(imob)) if (v) console.log("  " + k + ": " + v);

const [vinculados] = await c.query(
  `select u.name, e.code emp
     from users u
     left join acquisition_requests ar on ar.client_id = u.id
     left join enterprise_unities eu on eu.id = ar.enterprise_unity_id
     left join enterprises e on e.id = eu.enterprise_id
    where u.vinculed_by_id = 4175 limit 10`,
);
console.log("\n### quem ela ja vincula:");
for (const v of vinculados) console.log("  " + v.name + " · " + (v.emp ?? "sem proposta"));
await c.end();
