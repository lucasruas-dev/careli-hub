// SOMENTE LEITURA. O ACPP tem quantas unidades no C2X? E quantas no Panteon?
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

const [emp] = await c.query(
  "select id, code, name from enterprises where id = 42 or code like 'ACP%'",
);
console.log("\n## O empreendimento no C2X");
console.log(JSON.stringify(emp, null, 1));

const [total] = await c.query(`
  select count(*) as unidades, count(distinct eu.name) as nomes_distintos
  from enterprise_unities eu where eu.enterprise_id = 42`);
console.log("\n## Unidades do 42 no C2X");
console.log(JSON.stringify(total, null, 1));

const [porStatus] = await c.query(`
  select ss.name as situacao, count(*) as unidades
  from enterprise_unities eu
  left join sale_statuses ss on ss.id = eu.sale_status_id
  where eu.enterprise_id = 42
  group by ss.name order by count(*) desc`);
console.log("\n## Por situacao no C2X");
console.log(JSON.stringify(porStatus, null, 1));

// As unidades do C2X, para cruzar com o Panteon pelo nome.
const [nomes] = await c.query(`
  select eu.name, eu.block, eu.lot, ss.name as situacao, eu.price
  from enterprise_unities eu
  left join sale_statuses ss on ss.id = eu.sale_status_id
  where eu.enterprise_id = 42
  order by eu.name`);
fs.writeFileSync("audit-acpp-c2x.json", JSON.stringify(nomes, null, 1));
console.log("\n## Gravei", nomes.length, "unidades em audit-acpp-c2x.json");

// Quantas quadras distintas.
const [quadras] = await c.query(`
  select count(distinct eu.block) as quadras_por_block,
         count(distinct substring_index(eu.name, '-', 1)) as quadras_por_nome
  from enterprise_unities eu where eu.enterprise_id = 42`);
console.log("\n## Quadras no C2X");
console.log(JSON.stringify(quadras, null, 1));

await c.end();
