// LEVANTAMENTO read-only: os "Ato" de R$ 1.000 vencidos e em aberto no Vale do Ouro.
//
// Pedido do Lucas (19/08/2026): dar baixa nos 1.000 vencidos de quem ja pagou. ANTES de qualquer
// escrita, saber exatamente quantos sao, de quais unidades, e o que o C2X ja registra sobre eles.
//
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

const VALE = ["VLO", "VOC", "VOL", "VOR"];

// 1. Panorama: todo pagamento tipo Ato no Vale do Ouro, por situacao.
const [porStatus] = await c.query(
  `select e.code emp, pt.name tipo, ps.name situacao, count(*) qtd, sum(p.initial_value) total
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join parcel_types pt on pt.id = p.parcel_type_id
     left join payment_statuses ps on ps.id = p.payment_status_id
    where e.code in (?) and pt.name like '%to%' and p.initial_value = 1000
    group by e.code, pt.name, ps.name
    order by e.code, qtd desc`,
  [VALE],
);
console.log("### Ato de R$ 1.000 no Vale do Ouro, por situacao");
for (const r of porStatus) {
  console.log("  " + r.emp + " · " + r.tipo + " · " + (r.situacao ?? "sem status") +
    " -> " + r.qtd + " parcelas · R$ " + Number(r.total).toLocaleString("pt-BR"));
}

// 2. Os VENCIDOS e EM ABERTO: a lista que o pedido do Lucas mira.
const [vencidos] = await c.query(
  `select p.id, e.code emp, concat(e.code, u.block, u.lot) unidade,
          date_format(p.due_date, '%Y-%m-%d') vence, datediff(curdate(), p.due_date) dias,
          p.initial_value valor, coalesce(p.paid_value, 0) pago,
          ps.name situacao, p.payment_asaas_url is not null tem_asaas,
          date_format(p.payment_date, '%Y-%m-%d') pago_em
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join parcel_types pt on pt.id = p.parcel_type_id
     left join payment_statuses ps on ps.id = p.payment_status_id
    where e.code in (?) and pt.name like '%to%' and p.initial_value = 1000
      and p.payment_date is null and p.due_date < curdate()
    order by p.due_date`,
  [VALE],
);
console.log("\n### VENCIDOS e SEM data de pagamento: " + vencidos.length);
for (const v of vencidos.slice(0, 40)) {
  console.log("  " + v.unidade.padEnd(10) + " vence " + v.vence + " (" + String(v.dias).padStart(3) +
    "d) · " + (v.situacao ?? "sem status").padEnd(22) + " · asaas: " + (v.tem_asaas ? "sim" : "NAO") +
    " · payment_id " + v.id);
}
if (vencidos.length > 40) console.log("  ... e mais " + (vencidos.length - 40));
await c.end();
