// CONFIRMACOES finais (leitura apenas).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

// 1) CPF duplicado (normalizado) tocando a janela — confirmacao SQL do check JS
const [cpfDup] = await c.query(
  `SELECT REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),'/','') d, COUNT(*) n,
          GROUP_CONCAT(CONCAT(id, '|', name) SEPARATOR ' § ') quem
     FROM users
    WHERE cpf IS NOT NULL AND TRIM(cpf) <> ''
    GROUP BY d
   HAVING COUNT(*) > 1
      AND SUM(created_at >= '2026-08-01 00:00:00' AND created_at < '2026-08-03 00:00:00') > 0`,
);
console.log("CPF dup tocando janela:", JSON.stringify(cpfDup, null, 2));

// CNPJ dup idem
const [cnpjDup] = await c.query(
  `SELECT REPLACE(REPLACE(REPLACE(cnpj,'.',''),'-',''),'/','') d, COUNT(*) n,
          GROUP_CONCAT(CONCAT(id, '|', COALESCE(NULLIF(name,''), social_name)) SEPARATOR ' § ') quem
     FROM users
    WHERE cnpj IS NOT NULL AND TRIM(cnpj) <> ''
    GROUP BY d
   HAVING COUNT(*) > 1
      AND SUM(created_at >= '2026-08-01 00:00:00' AND created_at < '2026-08-03 00:00:00') > 0`,
);
console.log("CNPJ dup tocando janela:", JSON.stringify(cnpjDup, null, 2));

// 2) conjugue do 4455 (Carlos Henrique) — o e-mail kalline* e da esposa?
const [sp] = await c.query(
  "SELECT name, cpf, email FROM spouses WHERE ownertable_type = 'User' AND ownertable_id = 4455",
);
console.log("spouse do 4455:", JSON.stringify(sp, null, 2));

// 3) vinculed_by_id da janela aponta pra quem? todos imobiliaria (profile 6)?
const [vinc] = await c.query(
  `SELECT v.id, COALESCE(NULLIF(v.name,''), v.social_name, v.fantasy_name) nome, v.profile_id, COUNT(*) qtd
     FROM users u
     JOIN users v ON v.id = u.vinculed_by_id
    WHERE u.created_at >= '2026-08-01 00:00:00' AND u.created_at < '2026-08-03 00:00:00'
    GROUP BY v.id, nome, v.profile_id
    ORDER BY qtd DESC`,
);
console.log("vinculed_by da janela:", JSON.stringify(vinc, null, 2));

// 4) uso dos users 4199 x 4734 (incorporador duplicado): onde cada um aparece
for (const [tabela, coluna] of [
  ["enterprises", "incorporador_id"],
  ["acquisition_requests", "client_id"],
  ["users", "vinculed_by_id"],
  ["users", "incorporador_id"],
  ["incorporadores_users", "incorporador_id"],
]) {
  const [r] = await c.query(
    `SELECT ${coluna} ref, COUNT(*) n FROM ${tabela} WHERE ${coluna} IN (4199, 4734) GROUP BY ${coluna}`,
  );
  console.log(`uso ${tabela}.${coluna}:`, JSON.stringify(r));
}

// 5) tipo trocado na janela (SQL)
const [tt] = await c.query(
  `SELECT id, name, person_type_id, cpf, cnpj FROM users
    WHERE created_at >= '2026-08-01 00:00:00' AND created_at < '2026-08-03 00:00:00'
      AND ((person_type_id = 1 AND cnpj IS NOT NULL AND TRIM(cnpj) <> '')
        OR (person_type_id = 2 AND cpf IS NOT NULL AND TRIM(cpf) <> ''))`,
);
console.log("tipo trocado janela:", JSON.stringify(tt, null, 2));

// 6) pedidos criados desde 01/08 cujo client_id NAO esta na janela nem sincronizado (comprador antigo? ok, so contar)
const [arResumo] = await c.query(
  `SELECT ar.acquisition_request_stage_id st, COUNT(*) n
     FROM acquisition_requests ar
    WHERE ar.created_at >= '2026-08-01 00:00:00'
    GROUP BY ar.acquisition_request_stage_id`,
);
console.log("ARs desde 01/08 por stage:", JSON.stringify(arResumo));

// 7) mesmo cliente com 2+ pedidos vivos em unidades DIFERENTES criados desde 01/08 (pode ser legitimo, so conferir volume)
const [multiLote] = await c.query(
  `SELECT ar.client_id, u.name, COUNT(*) n,
          GROUP_CONCAT(CONCAT(ar.id, ':u', ar.enterprise_unity_id) ORDER BY ar.id) pedidos
     FROM acquisition_requests ar
     JOIN users u ON u.id = ar.client_id
    WHERE ar.acquisition_request_stage_id NOT IN (7, 8, 10, 11)
      AND ar.created_at >= '2026-08-01 00:00:00'
    GROUP BY ar.client_id, u.name
   HAVING COUNT(*) > 1`,
);
console.log("mesmo cliente 2+ unidades desde 01/08:", JSON.stringify(multiLote, null, 2));

await c.end();
