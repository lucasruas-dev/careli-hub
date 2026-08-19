// BUSCA read-only no C2X: a imobiliaria vinculadora (Avanca / Kleber).
// ⚠️ READ-ONLY. ⚠️ Credencial do .env.local, nunca impressa.
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

const [imobs] = await c.query(
  `select u.id, u.name, u.social_name, u.fantasy_name, u.cnpj, u.cpf, p.name perfil,
          (select count(*) from users v where v.vinculed_by_id = u.id) vinculados
     from users u
     left join profiles p on p.id = u.profile_id
    where u.name like '%AVAN%' or u.social_name like '%AVAN%' or u.fantasy_name like '%AVAN%'
       or ((u.name like '%KLEBER%' or u.social_name like '%KLEBER%') and p.name like '%mobili%')
    order by vinculados desc limit 12`,
);
console.log("### candidatas no C2X: " + imobs.length);
for (const i of imobs) {
  console.log("  id " + i.id + " · " + (i.perfil ?? "-") + " · " + i.name);
  console.log("      social: " + (i.social_name ?? "-") + " · fantasia: " + (i.fantasy_name ?? "-"));
  console.log("      CNPJ: " + (i.cnpj ?? "-") + " · CPF: " + (i.cpf ?? "-") + " · vincula " + i.vinculados + " cliente(s)");
}
await c.end();
