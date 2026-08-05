// SANIDADE da lente (leitura apenas): confere no MySQL, sem passar pelo meu código de vazio(),
// quantos users do universo têm cada campo NULL/'' — e amostra os 96 sem endereço.
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

const resultado = JSON.parse(fs.readFileSync("audit-pendencias-resultado.json", "utf8"));
const userIds = resultado.casos.map((c) => c.userId);
console.log("Casos:", userIds.length);

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});

// 1. Todos os users do universo: contagem de vazios por campo, direto no SQL
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const ler = async (t, q) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`${t}: ${r.status}`);
  return r.json();
};
const ents = await ler("apolo_entities", "select=document_masked,entity_kind&metadata->>c2xSynced=eq.true&limit=2000");
const ents2 = await ler("apolo_entities", "select=document_masked,entity_kind&created_at=gte.2026-08-01&limit=2000");
const cpfs = [...new Set([...ents, ...ents2].filter((e) => e.entity_kind === "pf").map((e) => String(e.document_masked ?? "").replace(/\D/g, "")).filter((d) => d.length === 11))];
console.log("CPFs únicos PF:", cpfs.length);

const limpo = (col) => `REPLACE(REPLACE(REPLACE(${col},'.',''),'-',''),'/','')`;
let agg = { total: 0, nat: 0, mae: 0, rg: 0, prof: 0, civ: 0, nasc: 0 };
const dupCpf = [];
for (let i = 0; i < cpfs.length; i += 200) {
  const bloco = cpfs.slice(i, i + 200);
  const [rows] = await c.query(
    `SELECT ${limpo("cpf")} d, COUNT(*) n,
            SUM(naturalness IS NULL OR TRIM(naturalness)='') s_nat,
            SUM(mother_name IS NULL OR TRIM(mother_name)='') s_mae,
            SUM((rg IS NULL OR TRIM(rg)='') AND (identification_number IS NULL OR TRIM(identification_number)='')) s_rg,
            SUM(profession_id IS NULL OR profession_id=0) s_prof,
            SUM(civil_state_id IS NULL OR civil_state_id=0) s_civ,
            SUM(birthday IS NULL) s_nasc
       FROM users WHERE ${limpo("cpf")} IN (${bloco.map(() => "?").join(",")})
      GROUP BY d`, bloco);
  for (const r of rows) {
    agg.total += Number(r.n);
    agg.nat += Number(r.s_nat); agg.mae += Number(r.s_mae); agg.rg += Number(r.s_rg);
    agg.prof += Number(r.s_prof); agg.civ += Number(r.s_civ); agg.nasc += Number(r.s_nasc);
    if (Number(r.n) > 1) dupCpf.push({ cpf: r.d, n: Number(r.n) });
  }
}
console.log("Users no C2X batendo os CPFs:", JSON.stringify(agg));
console.log("CPFs DUPLICADOS no C2X (mais de um user):", dupCpf.length, JSON.stringify(dupCpf.slice(0, 20)));

// 2. Amostra de 5 casos "sem endereço": conferir que NÃO existe address row
const amostra = userIds.slice(0, 5);
const [addr] = await c.query(
  `SELECT ownertable_id, address, zipcode FROM addresses WHERE ownertable_type='User' AND ownertable_id IN (${amostra.map(() => "?").join(",")})`,
  amostra,
);
console.log("Amostra sem-endereço, rows em addresses:", JSON.stringify(addr));

// 3. Valores "placeholder" que podem ter passado como preenchidos
for (const col of ["naturalness", "mother_name", "rg"]) {
  const [rows] = await c.query(
    `SELECT ${col} v, COUNT(*) n FROM users
      WHERE ${limpo("cpf")} IN (${cpfs.slice(0, 200).map(() => "?").join(",")}) AND ${col} IS NOT NULL AND CHAR_LENGTH(TRIM(${col})) <= 3
      GROUP BY v LIMIT 10`, cpfs.slice(0, 200));
  if (rows.length) console.log(`Valores curtos em ${col}:`, JSON.stringify(rows));
}
await c.end();

// 4. Amostra: os 5 primeiros casos — a ficha do Apolo tem endereço mesmo vazio?
console.log("\nAmostra de casos:", JSON.stringify(resultado.casos.slice(0, 3), null, 1));
