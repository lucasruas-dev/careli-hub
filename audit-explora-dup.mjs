// EXPLORATORIO (leitura apenas): valida volumes e estruturas antes da auditoria de duplicados.
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

// 1) Apolo: quantas entidades sincronizadas / criadas 01-02/08
const contar = async (q) => {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/apolo_entities?${q}&select=id&limit=1`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: "count=exact",
    },
  });
  return resp.headers.get("content-range");
};
console.log("apolo synced:", await contar("metadata->>c2xSynced=eq.true"));
console.log("apolo criadas 01-02/08:", await contar("created_at=gte.2026-08-01&created_at=lt.2026-08-03"));

const amostra = await ler(
  "apolo_entities",
  "select=id,display_name,document_masked,entity_kind,metadata->c2xUserId,created_at&metadata->>c2xSynced=eq.true&limit=3",
);
console.log("amostra synced:", JSON.stringify(amostra, null, 2));

// 2) C2X
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

const [[tot]] = await c.query("SELECT COUNT(*) n FROM users");
console.log("users total:", tot.n);
const [novos] = await c.query(
  "SELECT COUNT(*) n, MIN(created_at) mn, MAX(created_at) mx FROM users WHERE created_at >= '2026-08-01 00:00:00' AND created_at < '2026-08-03 00:00:00'",
);
console.log("users criados 01-02/08:", JSON.stringify(novos));

const [profiles] = await c.query("SELECT id, name FROM profiles ORDER BY id");
console.log("profiles:", JSON.stringify(profiles));

const [ptype] = await c.query(
  "SELECT person_type_id, COUNT(*) n, SUM(cpf IS NOT NULL AND cpf<>'') com_cpf, SUM(cnpj IS NOT NULL AND cnpj<>'') com_cnpj FROM users GROUP BY person_type_id",
);
console.log("por person_type (global):", JSON.stringify(ptype));

const [stages] = await c.query("SELECT id, name FROM acquisition_request_stages ORDER BY id");
console.log("stages:", JSON.stringify(stages));

const [arNovos] = await c.query(
  "SELECT COUNT(*) n FROM acquisition_requests WHERE created_at >= '2026-08-01 00:00:00'",
);
console.log("acquisition_requests criados desde 01/08:", JSON.stringify(arNovos));

await c.end();
