// SEGURANCA read-only: cada unidade da lista tem UMA unica linha de "Ato"? Se tiver mais de uma,
// clique posicional na tela pode acertar a parcela errada.
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
  `select ar.enterprise_unity_id unit_id, count(*) qtd,
          group_concat(concat(p.id, ':', coalesce(ps.name,'?'), ':', p.initial_value) order by p.id) detalhe
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     left join parcel_types pt on pt.id = p.parcel_type_id
     left join payment_statuses ps on ps.id = p.payment_status_id
    where ar.enterprise_unity_id in (?) and pt.name like '%to%'
    group by ar.enterprise_unity_id`,
  [lista.map((l) => l.unitId)],
);
const porUnit = new Map(linhas.map((l) => [Number(l.unit_id), l]));
const problemas = lista.filter((l) => (porUnit.get(l.unitId)?.qtd ?? 0) !== 1);
console.log("unidades na lista        : " + lista.length);
console.log("com UMA linha de Ato     : " + lista.filter((l) => (porUnit.get(l.unitId)?.qtd ?? 0) === 1).length);
console.log("com MAIS de uma (risco)  : " + problemas.length);
for (const p of problemas) {
  console.log("  " + p.unidade + " (unit " + p.unitId + ") -> " + porUnit.get(p.unitId)?.detalhe);
}
await c.end();
