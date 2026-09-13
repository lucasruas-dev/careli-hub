// SOMENTE LEITURA. Confere se a "mensalidade vigente" do AR 1083 esta contaminada por mora.
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

const AR = 1083;

const [resumo] = await c.query(`
  select pt.name as tipo, p.payment_status_id as status, count(*) as parcelas,
         round(min(p.initial_value),2) as menor, round(max(p.initial_value),2) as maior,
         round(sum(p.initial_value),2) as soma
  from payments p left join parcel_types pt on pt.id = p.parcel_type_id
  where p.acquisition_request_id = ? and (p.payment_to_delete is null or p.payment_to_delete = 0)
  group by pt.name, p.payment_status_id order by pt.name, p.payment_status_id`, [AR]);
console.log("\n## AR 1083 por tipo e status");
console.log(JSON.stringify(resumo, null, 1));

// Os valores DISTINTOS das mensalidades: um contrato com reajuste mostra degraus limpos;
// mora embutida aparece como valores unicos e quebrados no meio da serie.
const [degraus] = await c.query(`
  select round(p.initial_value,2) as valor, count(*) as quantas,
         min(p.due_date) as primeiro_vencimento, max(p.due_date) as ultimo_vencimento,
         sum(case when p.payment_date is not null then 1 else 0 end) as pagas
  from payments p left join parcel_types pt on pt.id = p.parcel_type_id
  where p.acquisition_request_id = ? and (p.payment_to_delete is null or p.payment_to_delete = 0)
    and pt.id in (1,2,3)
  group by round(p.initial_value,2) order by min(p.due_date)`, [AR]);
console.log("\n## Os valores distintos da serie (degrau limpo = reajuste; valor unico quebrado = mora)");
console.log(JSON.stringify(degraus, null, 1));

// Nominal x o que o extrato chamaria de "a valor de hoje" se levantasse tudo para a maior face.
const [totais] = await c.query(`
  select count(*) as em_aberto,
         round(sum(p.initial_value),2) as nominal_em_aberto
  from payments p
  where p.acquisition_request_id = ? and (p.payment_to_delete is null or p.payment_to_delete = 0)
    and p.payment_date is null`, [AR]);
console.log("\n## Em aberto");
console.log(JSON.stringify(totais, null, 1));

await c.end();
