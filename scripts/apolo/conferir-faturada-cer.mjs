// CONFERENCIA read-only: a UNICA "faturada" que o BI do CER mostra existe mesmo? Qual e?
// ⚠️ READ-ONLY. ⚠️ Credencial do .env.local, nunca impressa. ⚠️ Nome do comprador NAO sai na tela.
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

// 1. Todo evento de FATURAMENTO (estagio 4) no VOC.
const [eventos] = await c.query(
  `select h.id, h.acquisition_request_id ar_id, h.old_acquisition_request_stage_id de,
          date_format(h.created_at, '%Y-%m-%d %H:%i') em,
          e.code emp, concat(e.code, u.block, u.lot) unidade, u.price,
          ar.acquisition_request_stage_id estagio_hoje, st.name estagio_hoje_nome
     from acquisition_request_historics h
     join acquisition_requests ar on ar.id = h.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join acquisition_request_stages st on st.id = ar.acquisition_request_stage_id
    where e.code = 'VOC' and h.new_acquisition_request_stage_id = 4
    order by h.created_at`,
);
console.log("### eventos de FATURAMENTO (estagio 4) no VOC: " + eventos.length);
for (const e of eventos) {
  console.log("  " + e.unidade + " · ar " + e.ar_id + " · faturada em " + e.em +
    " · veio do estagio " + e.de + " · HOJE esta em: " + e.estagio_hoje + " (" + e.estagio_hoje_nome + ")" +
    " · preco R$ " + Number(e.price).toLocaleString("pt-BR"));
}

// 2. E quantas unidades do VOC estao HOJE em cada estagio (o que alimenta VENDIDO / UNIDADES VENDIDAS).
const [hoje] = await c.query(
  `select ar.acquisition_request_stage_id id, st.name nome, count(*) qtd
     from enterprise_unities u
     join enterprises e on e.id = u.enterprise_id
     join acquisition_requests ar on ar.id = (
       select ar2.id from acquisition_requests ar2
        where ar2.enterprise_unity_id = u.id order by ar2.created_at desc, ar2.id desc limit 1)
     left join acquisition_request_stages st on st.id = ar.acquisition_request_stage_id
    where e.code = 'VOC'
    group by ar.acquisition_request_stage_id, st.name
    order by qtd desc`,
);
console.log("\n### as unidades do VOC, por estagio ATUAL");
for (const h of hoje) console.log("  " + String(h.qtd).padStart(4) + "  estagio " + h.id + " · " + h.nome);
await c.end();
