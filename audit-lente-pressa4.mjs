// AUDITORIA 4 (leitura apenas): contagens no C2X para os avisos de valor-default
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
const digitos = (v) => String(v ?? "").replace(/\D/g, "");

const SEL = "id,display_name,document_masked,metadata";
const inicio = "2026-08-01T03:00:00Z";
const fim = "2026-08-02T03:00:00Z";
const criadasOntem = await ler(
  "apolo_entities",
  `select=${SEL}&created_at=gte.${inicio}&created_at=lt.${fim}&metadata->>source=eq.apolo&limit=2000`,
);
const syncadas = await ler("apolo_entities", `select=${SEL}&metadata->>c2xSynced=eq.true&limit=3000`);
const porId = new Map();
for (const e of [...criadasOntem, ...syncadas]) porId.set(e.id, e);
const docs = [...new Set([...porId.values()].map((e) => digitos(e.document_masked)).filter((d) => d.length === 11 || d.length === 14))];

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});
const limpo = (col) => `REPLACE(REPLACE(REPLACE(${col},'.',''),'-',''),'/','')`;
const users = [];
for (let i = 0; i < docs.length; i += 200) {
  const bloco = docs.slice(i, i + 200);
  const m = bloco.map(() => "?").join(",");
  const [us] = await c.query(
    `SELECT id, name, ${limpo("cpf")} cpf_limpo, naturalness, schooling_id, civil_state_id, salary_range_id
       FROM users WHERE ${limpo("cpf")} IN (${m}) OR ${limpo("cnpj")} IN (${m})`,
    [...bloco, ...bloco],
  );
  users.push(...us);
}
const pf = users.filter((u) => u.cpf_limpo);
const conta = (fn) => {
  const m = new Map();
  for (const u of pf) {
    const v = fn(u);
    if (v == null || v === "") continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
console.log("PF no C2X:", pf.length);
console.log("naturalness top10:", JSON.stringify(conta((u) => u.naturalness).slice(0, 10)));
console.log("schooling:", JSON.stringify(conta((u) => u.schooling_id)));
console.log("civil_state:", JSON.stringify(conta((u) => u.civil_state_id)));
console.log("salary_range:", JSON.stringify(conta((u) => u.salary_range_id)));
await c.end();
