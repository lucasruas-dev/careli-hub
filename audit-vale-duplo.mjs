// EVIDENCIA (leitura apenas): dois VALE DO OURO no C2X — tamanho do estrago.
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

// unidades e pedidos por enterprise 35 x 36
const [unids] = await c.query(
  "SELECT enterprise_id, COUNT(*) unidades FROM enterprise_unities WHERE enterprise_id IN (35, 36) GROUP BY enterprise_id",
);
console.log("unidades por enterprise:", JSON.stringify(unids));

const [peds] = await c.query(
  `SELECT eu.enterprise_id, ar.acquisition_request_stage_id st, COUNT(*) n
     FROM acquisition_requests ar
     JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id
    WHERE eu.enterprise_id IN (35, 36)
    GROUP BY eu.enterprise_id, ar.acquisition_request_stage_id
    ORDER BY eu.enterprise_id, st`,
);
console.log("pedidos por enterprise/stage:", JSON.stringify(peds));

// detalhes do enterprise 36
const [e36] = await c.query(
  "SELECT id, name, code, incorporador_id, manager_id, captivator_id, created_at, updated_at FROM enterprises WHERE id IN (35, 36)",
);
console.log("enterprises 35/36:", JSON.stringify(e36, null, 2));

// Kalline tem user no C2X?
const [k] = await c.query(
  "SELECT id, name, cpf, email, created_at FROM users WHERE REPLACE(REPLACE(cpf,'.',''),'-','') = '14008362630'",
);
console.log("user CPF Kalline no C2X:", JSON.stringify(k, null, 2));

// quem e cliente nos pedidos do Vale (35): quantos distintos, pra fechar resumo
const [cli] = await c.query(
  `SELECT COUNT(DISTINCT ar.client_id) clientes, COUNT(*) pedidos
     FROM acquisition_requests ar
     JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id
    WHERE eu.enterprise_id = 35 AND ar.created_at >= '2026-08-01 00:00:00'`,
);
console.log("pedidos do Vale (35) desde 01/08:", JSON.stringify(cli));

await c.end();
