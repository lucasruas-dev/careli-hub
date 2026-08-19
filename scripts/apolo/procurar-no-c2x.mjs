// BUSCA read-only por CPF no C2X: a pessoa existe? tem unidade? tem Ato de R$ 1.000?
// Uso: node scripts/apolo/procurar-no-c2x.mjs 14118749602
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
const cpf = (process.argv[2] || "").replace(/\D/g, "");
const [users] = await c.query(
  "select id, name, cpf from users where replace(replace(replace(cpf,'.',''),'-',''),' ','') = ? limit 5",
  [cpf],
);
console.log("### no C2X (users): " + users.length);
for (const u of users) console.log("  id " + u.id + " · " + u.name);
if (users.length) {
  const [pagamentos] = await c.query(
    `select p.id, concat(e.code, u2.block, u2.lot) unidade, pt.name tipo, p.initial_value valor,
            ps.name situacao, date_format(p.due_date,'%d/%m/%Y') vence,
            date_format(p.payment_date,'%d/%m/%Y') pago_em
       from payments p
       join acquisition_requests ar on ar.id = p.acquisition_request_id
       join enterprise_unities u2 on u2.id = ar.enterprise_unity_id
       join enterprises e on e.id = u2.enterprise_id
       left join parcel_types pt on pt.id = p.parcel_type_id
       left join payment_statuses ps on ps.id = p.payment_status_id
      where ar.client_id in (?) and p.initial_value = 1000 and pt.name like '%to%'`,
    [users.map((u) => u.id)],
  );
  console.log("\n### Ato de R$ 1.000 dessa pessoa: " + pagamentos.length);
  for (const p of pagamentos) {
    console.log("  " + p.unidade + " · pay " + p.id + " · " + p.situacao + " · vence " + p.vence + " · pago em " + (p.pago_em ?? "-"));
  }
}
await c.end();
