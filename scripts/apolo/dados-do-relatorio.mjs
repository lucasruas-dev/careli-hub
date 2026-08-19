// Numeros finais para o relatorio interno. READ-ONLY.
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
const [porEmp] = await c.query(
  `select e.code emp, ps.name situacao, count(*) qtd
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join parcel_types pt on pt.id = p.parcel_type_id
     left join payment_statuses ps on ps.id = p.payment_status_id
    where e.code in ('VOC','VOL') and pt.name like '%to%' and p.initial_value = 1000
    group by e.code, ps.name order by e.code, qtd desc`,
);
console.log("## Ato de R$ 1.000 por empreendimento (agora)");
for (const r of porEmp) console.log("  " + r.emp + " · " + r.situacao + " · " + r.qtd);

const [hoje] = await c.query(
  `select count(*) total,
          sum(case when p.payment_date is not null then 1 else 0 end) pagas,
          sum(case when p.payment_date is null and p.due_date < curdate() then 1 else 0 end) vencidas
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join parcel_types pt on pt.id = p.parcel_type_id
    where e.code in ('VOC','VOL','VLO','VOR') and pt.name like '%to%' and p.initial_value = 1000`,
);
console.log("\n## Total geral do Ato de R$ 1.000 no Vale do Ouro");
console.log("  parcelas: " + hoje[0].total + " · pagas: " + hoje[0].pagas + " · ainda vencidas: " + hoje[0].vencidas);
await c.end();
