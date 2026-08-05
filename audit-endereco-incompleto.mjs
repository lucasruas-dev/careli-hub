// Complemento da lente: users do universo COM linha em addresses, mas endereço INCOMPLETO
// (sem cidade/estado, sem CEP ou sem logradouro) — também trava contrato. Cruza com a ficha.
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
const ler = async (t, q) => {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${t}?${q}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!r.ok) throw new Error(`${t}: ${r.status} ${await r.text()}`);
  return r.json();
};
const digitos = (v) => String(v ?? "").replace(/\D/g, "");
const texto = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

// universo de CPFs (mesma regra do principal)
const sel = "select=id,document_masked,entity_kind";
const a1 = await ler("apolo_entities", `${sel}&metadata->>c2xSynced=eq.true&limit=2000`);
const a2 = await ler("apolo_entities", `${sel}&created_at=gte.2026-08-01&limit=2000`);
const cpfs = [...new Set([...a1, ...a2].filter((e) => e.entity_kind === "pf").map((e) => digitos(e.document_masked)).filter((d) => d.length === 11))];

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});
const limpo = (col) => `REPLACE(REPLACE(REPLACE(${col},'.',''),'-',''),'/','')`;
const incompletos = [];
for (let i = 0; i < cpfs.length; i += 200) {
  const bloco = cpfs.slice(i, i + 200);
  const [rows] = await c.query(
    `SELECT u.id, u.name, ${limpo("u.cpf")} cpf_limpo, a.address, a.number, a.zipcode, a.district, a.city_id, a.state_id
       FROM users u JOIN addresses a ON a.ownertable_type='User' AND a.ownertable_id=u.id
      WHERE ${limpo("u.cpf")} IN (${bloco.map(() => "?").join(",")})
        AND (a.city_id IS NULL OR a.state_id IS NULL
             OR a.address IS NULL OR TRIM(a.address)=''
             OR a.zipcode IS NULL OR TRIM(a.zipcode)=''
             OR a.number IS NULL OR TRIM(a.number)='')`,
    bloco,
  );
  incompletos.push(...rows);
}
await c.end();
console.log(`Endereços incompletos: ${incompletos.length}`);
for (const r of incompletos.slice(0, 30)) {
  const faltam = [];
  if (r.city_id == null) faltam.push("cidade");
  if (r.state_id == null) faltam.push("estado");
  if (!texto(r.address)) faltam.push("logradouro");
  if (!texto(r.zipcode)) faltam.push("CEP");
  if (!texto(r.number)) faltam.push("número");
  console.log(`${r.name} (${r.cpf_limpo}) user ${r.id}: falta ${faltam.join(", ")} | address="${texto(r.address)}" nº="${texto(r.number)}" cep="${texto(r.zipcode)}" city_id=${r.city_id} state_id=${r.state_id}`);
}
fs.writeFileSync("audit-endereco-incompleto.json", JSON.stringify(incompletos, null, 1));
