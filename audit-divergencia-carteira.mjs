// SOMENTE LEITURA no C2X. Mede a divergência entre a carteira do Hades (97,2M) e a do Apolo (102,0M).
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

const ATIVO = "(p.payment_to_delete is null or p.payment_to_delete = 0)";
const q = async (rotulo, sql) => {
  const [linhas] = await c.query(sql);
  console.log("\n## " + rotulo);
  console.log(JSON.stringify(linhas, null, 1));
};

// 1. A carteira do Hades, como o código dele soma: sem join nenhum.
await q("HADES: carteira global (payments 5/6/7, ativo)", `
  select count(*) as parcelas, round(sum(coalesce(p.initial_value,0)),2) as carteira
  from payments p where p.payment_status_id in (5,6,7) and ${ATIVO}`);

// 2. A mesma carteira, mas pelo caminho do Apolo: por PARTICIPANTE (client_id..client_5_id).
//    Se a soma por participante for maior que a global, é contrato com mais de um comprador
//    somando a MESMA parcela em duas fichas.
await q("APOLO: soma das carteiras por participante", `
  select count(distinct participants.user_id) as pessoas,
         count(*) as linhas_parcela,
         round(sum(coalesce(p.initial_value,0)),2) as carteira_somada
  from (
    select id as request_id, client_id as user_id from acquisition_requests where client_id is not null
    union all select id, client_2_id from acquisition_requests where client_2_id is not null
    union all select id, client_3_id from acquisition_requests where client_3_id is not null
    union all select id, client_4_id from acquisition_requests where client_4_id is not null
    union all select id, client_5_id from acquisition_requests where client_5_id is not null
  ) participants
  join payments p on p.acquisition_request_id = participants.request_id
  where p.payment_status_id in (5,6,7) and ${ATIVO}`);

// 3. Quanto disso é contrato com 2+ compradores (a parcela contada mais de uma vez).
await q("Contratos com mais de um comprador", `
  select compradores, count(*) as contratos, round(sum(valor),2) as carteira
  from (
    select ar.id,
      (case when ar.client_id is not null then 1 else 0 end)
      + (case when ar.client_2_id is not null then 1 else 0 end)
      + (case when ar.client_3_id is not null then 1 else 0 end)
      + (case when ar.client_4_id is not null then 1 else 0 end)
      + (case when ar.client_5_id is not null then 1 else 0 end) as compradores,
      coalesce((select sum(coalesce(p.initial_value,0)) from payments p
                where p.acquisition_request_id = ar.id and p.payment_status_id in (5,6,7) and ${ATIVO}),0) as valor
    from acquisition_requests ar
  ) x where compradores > 0 group by compradores order by compradores`);

// 4. O vencido: a trava do payment_date. O Apolo subtrai paid_value SEM conferir a data.
await q("Vencidas (status 7) com paid_value preenchido e SEM data de pagamento", `
  select count(*) as parcelas,
         round(sum(coalesce(p.initial_value,0)),2) as principal,
         round(sum(coalesce(p.paid_value,0)),2) as paid_value_fantasma
  from payments p
  where p.payment_status_id = 7 and ${ATIVO}
    and p.payment_date is null and coalesce(p.paid_value,0) > 0`);

await q("Vencido pelas DUAS formulas (status 7, ativo)", `
  select
    round(sum(coalesce(p.initial_value,0)),2) as hades_principal,
    round(sum(greatest(coalesce(p.initial_value,0)+coalesce(p.interest_value,0)+coalesce(p.mulct_value,0)
      - (case when p.payment_date is not null then coalesce(p.paid_value,0) else 0 end),0)),2) as com_trava_de_data,
    round(sum(greatest(coalesce(p.initial_value,0)+coalesce(p.interest_value,0)+coalesce(p.mulct_value,0)
      - coalesce(p.paid_value,0),0)),2) as sem_trava_apolo,
    count(distinct ar.client_id) as clientes_com_vencida
  from payments p left join acquisition_requests ar on ar.id = p.acquisition_request_id
  where p.payment_status_id = 7 and ${ATIVO}`);

// 5. Parcela sem contrato: o Hades conta, o Apolo (que passa por acquisition_requests) perde.
await q("Parcelas ativas SEM acquisition_request valido", `
  select count(*) as parcelas, round(sum(coalesce(p.initial_value,0)),2) as valor
  from payments p left join acquisition_requests ar on ar.id = p.acquisition_request_id
  where p.payment_status_id in (5,6,7) and ${ATIVO} and ar.id is null`);

await c.end();
