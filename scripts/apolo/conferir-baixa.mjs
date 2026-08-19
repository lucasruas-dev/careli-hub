// CONFERENCIA read-only de uma baixa recem-feita. Uso: node scripts/apolo/conferir-baixa.mjs 350656
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
const ids = process.argv.slice(2).map(Number).filter(Boolean);
const [linhas] = await c.query(
  `select p.id, concat(e.code, u.block, u.lot) unidade, ps.name situacao,
          date_format(p.payment_date, '%d/%m/%Y') pago_em, p.paid_value, p.initial_value,
          date_format(p.updated_at, '%d/%m/%Y %H:%i') alterado_em
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join payment_statuses ps on ps.id = p.payment_status_id
    where p.id in (?)`,
  [ids],
);
for (const l of linhas) {
  console.log(`${l.unidade} · ${l.situacao} · pago em ${l.pago_em ?? "-"} · R$ ${Number(l.paid_value).toLocaleString("pt-BR")} de R$ ${Number(l.initial_value).toLocaleString("pt-BR")} · alterado ${l.alterado_em}`);
}
await c.end();
