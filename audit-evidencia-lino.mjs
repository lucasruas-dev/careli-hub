// EVIDENCIA final (leitura apenas): empreendimentos do incorporador duplicado + Kalline no Apolo.
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

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const ler = async (tabela, query) => {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${await resp.text()}`);
  return resp.json();
};

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

const [emps] = await c.query(
  "SELECT id, name, code, incorporador_id, created_at FROM enterprises WHERE incorporador_id IN (4199, 4734)",
);
console.log("enterprises dos dois LINO E CECILIO:", JSON.stringify(emps, null, 2));

await c.end();

// Kalline no Apolo (por nome ou pelo CPF do user 4455)
const porNome = await ler(
  "apolo_entities",
  "select=id,display_name,document_masked,metadata->c2xUserId,metadata->>c2xSynced&display_name=ilike.*kalline*",
);
console.log("Apolo por nome kalline:", JSON.stringify(porNome, null, 2));
const porDoc = await ler(
  "apolo_entities",
  "select=id,display_name,document_masked,metadata->c2xUserId,metadata->>c2xSynced&document_masked=ilike.*103.634.656-00*",
);
console.log("Apolo pelo CPF do user 4455:", JSON.stringify(porDoc, null, 2));
