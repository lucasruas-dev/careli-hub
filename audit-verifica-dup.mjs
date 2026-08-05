// VERIFICACAO complementar (leitura apenas).
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

// 1) Kalline (caso conhecido de e-mail duplicado)
const [kalline] = await c.query(
  "SELECT id, name, cpf, email, profile_id, vinculed_by_id, created_at FROM users WHERE name LIKE '%KALLINE%' OR name LIKE '%Kalline%' OR email LIKE '%kalline%'",
);
console.log("KALLINE:", JSON.stringify(kalline, null, 2));

// 2) PJ: name vazio e social_name — padrao ou anomalia?
const [pjNome] = await c.query(
  "SELECT COUNT(*) n, SUM(name IS NULL OR TRIM(name)='') name_vazio, SUM(social_name IS NULL OR TRIM(social_name)='') social_vazio FROM users WHERE person_type_id = 2",
);
console.log("PJ global name/social:", JSON.stringify(pjNome));
const [doisPj] = await c.query(
  "SELECT id, name, social_name, fantasy_name, cnpj, profile_id, created_at FROM users WHERE id IN (4318, 4734, 4199)",
);
console.log("users 4318/4734/4199:", JSON.stringify(doisPj, null, 2));

// 3) e-mails distintos entre os 417 da janela
const [emailJanela] = await c.query(
  `SELECT COUNT(*) n, COUNT(DISTINCT LOWER(TRIM(email))) distintos
     FROM users WHERE created_at >= '2026-08-01 00:00:00' AND created_at < '2026-08-03 00:00:00'`,
);
console.log("emails janela:", JSON.stringify(emailJanela));

// e-mails que se repetem DENTRO da janela ou contra o resto da base
const [emailDup] = await c.query(
  `SELECT LOWER(TRIM(u.email)) e, COUNT(*) n,
          GROUP_CONCAT(u.id ORDER BY u.id) ids
     FROM users u
    WHERE u.email IS NOT NULL AND TRIM(u.email) <> ''
    GROUP BY LOWER(TRIM(u.email))
   HAVING COUNT(*) > 1
      AND SUM(u.created_at >= '2026-08-01 00:00:00' AND u.created_at < '2026-08-03 00:00:00') > 0`,
);
console.log("email dup tocando a janela:", JSON.stringify(emailDup, null, 2));

// 4) profile e vinculo dos 417
const [profJanela] = await c.query(
  `SELECT profile_id, COUNT(*) n, SUM(vinculed_by_id IS NULL) sem_vinculo, SUM(imobiliaria_id IS NULL) sem_imob_col
     FROM users WHERE created_at >= '2026-08-01 00:00:00' AND created_at < '2026-08-03 00:00:00'
    GROUP BY profile_id`,
);
console.log("janela por profile:", JSON.stringify(profJanela));

// 5) pedidos: mesmo cliente + mesma unidade, 2+ vivos (qualquer cliente, qualquer data)
const [arDup] = await c.query(
  `SELECT ar.client_id, ar.enterprise_unity_id, COUNT(*) n,
          GROUP_CONCAT(CONCAT(ar.id, ':', ar.acquisition_request_stage_id) ORDER BY ar.id) pedidos
     FROM acquisition_requests ar
    WHERE ar.acquisition_request_stage_id NOT IN (7, 8, 10, 11)
    GROUP BY ar.client_id, ar.enterprise_unity_id
   HAVING COUNT(*) > 1`,
);
console.log("AR dup vivos (global):", JSON.stringify(arDup, null, 2));

// 5b) mesma UNIDADE com 2+ pedidos vivos criados desde 01/08 (clientes diferentes = briga de lote)
const [unidadeDup] = await c.query(
  `SELECT ar.enterprise_unity_id, eu.block, eu.lot, ent.code emp, COUNT(*) n,
          GROUP_CONCAT(CONCAT(ar.id, ':cli', ar.client_id, ':st', ar.acquisition_request_stage_id) ORDER BY ar.id) pedidos
     FROM acquisition_requests ar
     LEFT JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id
     LEFT JOIN enterprises ent ON ent.id = eu.enterprise_id
    WHERE ar.acquisition_request_stage_id NOT IN (7, 8, 10, 11)
      AND ar.created_at >= '2026-08-01 00:00:00'
    GROUP BY ar.enterprise_unity_id, eu.block, eu.lot, ent.code
   HAVING COUNT(*) > 1`,
);
console.log("UNIDADE com 2+ pedidos vivos desde 01/08:", JSON.stringify(unidadeDup, null, 2));

// 6) mesmo cliente como co-comprador duplicado (client_id tambem em client_2..5 do mesmo pedido)
const [coDup] = await c.query(
  `SELECT id, code, client_id, client_2_id, client_3_id, client_4_id, client_5_id
     FROM acquisition_requests
    WHERE acquisition_request_stage_id NOT IN (7, 8, 10, 11)
      AND (client_id IN (client_2_id, client_3_id, client_4_id, client_5_id))`,
);
console.log("cliente repetido como co-comprador:", JSON.stringify(coDup, null, 2));

// 7) CPF/CNPJ: users da janela SEM documento nenhum
const [semDoc] = await c.query(
  `SELECT id, name, person_type_id, profile_id FROM users
    WHERE created_at >= '2026-08-01 00:00:00' AND created_at < '2026-08-03 00:00:00'
      AND (cpf IS NULL OR TRIM(cpf) = '') AND (cnpj IS NULL OR TRIM(cnpj) = '')`,
);
console.log("janela sem CPF/CNPJ:", JSON.stringify(semDoc, null, 2));

// 8) nomes: minusculo/numeros/duplo espaco direto no SQL pra conferir o JS (janela)
const [nomes] = await c.query(
  `SELECT id, name FROM users
    WHERE created_at >= '2026-08-01 00:00:00' AND created_at < '2026-08-03 00:00:00'
      AND (name REGEXP '[0-9]' OR name LIKE '%  %' OR name REGEXP 'teste' OR BINARY name = LOWER(name))`,
);
console.log("nomes estranhos (SQL):", JSON.stringify(nomes, null, 2));

await c.end();
