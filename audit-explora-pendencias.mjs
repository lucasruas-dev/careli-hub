// EXPLORAÇÃO (leitura apenas): estrutura users/addresses no C2X + universo do Apolo
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

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const ler = async (tabela, query) => {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact" },
  });
  if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${await resp.text()}`);
  const total = resp.headers.get("content-range");
  return { rows: await resp.json(), total };
};

// ── Universo Apolo ──
const sync = await ler("apolo_entities", "select=id&metadata->>c2xSynced=eq.true&limit=1");
console.log("c2xSynced=true:", sync.total);
const criadas = await ler("apolo_entities", "select=id&created_at=gte.2026-08-01&limit=1");
console.log("criadas >= 01/08:", criadas.total);
const syncPf = await ler("apolo_entities", "select=id&metadata->>c2xSynced=eq.true&entity_kind=eq.pf&limit=1");
console.log("c2xSynced=true PF:", syncPf.total);

// exemplo de entidade sincada: chaves do metadata.cadastro
const ex = await ler(
  "apolo_entities",
  "select=id,display_name,entity_kind,document_masked,cadastro:metadata->cadastro,c2xUserId:metadata->>c2xUserId&metadata->>c2xSynced=eq.true&entity_kind=eq.pf&limit=2",
);
for (const e of ex.rows) {
  console.log("\nEntidade exemplo:", e.id, "| kind:", e.entity_kind, "| c2xUserId:", e.c2xUserId, "| doc:", e.document_masked);
  console.log("  chaves cadastro:", e.cadastro ? Object.keys(e.cadastro).join(", ") : "(sem cadastro)");
}
const fichas = await ler("apolo_esteira", `select=entity_id,etapa,ficha&entity_id=in.(${ex.rows.map((e) => e.id).join(",")})`);
for (const f of fichas.rows) {
  console.log("\nEsteira", f.entity_id, "etapa:", f.etapa);
  console.log("  chaves ficha:", f.ficha ? Object.keys(f.ficha).join(", ") : "(sem ficha)");
}

// ── C2X: colunas ──
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});
const [uCols] = await c.query("SHOW COLUMNS FROM users");
console.log("\nusers cols:", uCols.map((r) => r.Field).join(", "));
const [aCols] = await c.query("SHOW COLUMNS FROM addresses");
console.log("\naddresses cols:", aCols.map((r) => r.Field).join(", "));
const [cs] = await c.query("SELECT id, name FROM civil_states");
console.log("\ncivil_states:", JSON.stringify(cs));
await c.end();
