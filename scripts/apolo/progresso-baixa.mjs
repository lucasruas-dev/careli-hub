// PROGRESSO read-only: quantas da lista ja estao baixadas com data e valor certos?
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
const lista = JSON.parse(fs.readFileSync("scripts/apolo/baixa-ato-1000-conferidas.json", "utf8"));
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});
const [linhas] = await c.query(
  `select p.id, concat(e.code, u.block, u.lot) unidade, ps.name situacao,
          date_format(p.payment_date, '%Y-%m-%d') pago_em, p.paid_value
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join payment_statuses ps on ps.id = p.payment_status_id
    where p.id in (?)`,
  [lista.map((l) => l.paymentId)],
);
const porId = new Map(linhas.map((l) => [Number(l.id), l]));
const prontas = [], faltam = [], divergentes = [];
for (const item of lista) {
  const l = porId.get(item.paymentId);
  if (!l) { faltam.push(item); continue; }
  const dataOk = l.pago_em === item.dataDoPix;
  const valorOk = Number(l.paid_value) === 1000;
  const pagoOk = String(l.situacao || "").toLowerCase() === "pago";
  if (dataOk && valorOk && pagoOk) prontas.push(item);
  else if (pagoOk || l.pago_em) divergentes.push({ ...item, tem: `${l.situacao} · ${l.pago_em ?? "sem data"} · R$ ${l.paid_value}` });
  else faltam.push(item);
}
console.log("PRONTAS      : " + prontas.length + " de " + lista.length);
console.log("FALTAM       : " + faltam.length);
console.log("DIVERGENTES  : " + divergentes.length);
if (divergentes.length) { console.log("\n-- divergentes:"); divergentes.forEach((d) => console.log("  " + d.unidade + " (pay " + d.paymentId + ") esperado " + d.dataDoPix + " · tem " + d.tem)); }
if (faltam.length) { console.log("\n-- faltam (unitId unidade payId data):"); faltam.forEach((f) => console.log("  " + f.unitId + " " + f.unidade + " " + f.paymentId + " " + f.dataDoPix)); }
await c.end();
