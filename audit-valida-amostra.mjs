// Validação por amostra (leitura apenas):
// A) 3 casos "sem endereço": mostrar ficha CRUA (esteira + cadastro + apolo_addresses) — confirmar que não há endereço em lugar nenhum.
// B) 2 pessoas "completas": confirmar no MySQL que o user tem address row de verdade.
// C) Os 5 sem match: eram sincadas (carimbo mentindo) ou só espelho de 01/08?
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
const resultado = JSON.parse(fs.readFileSync("audit-pendencias-resultado.json", "utf8"));

// A) 3 casos sem endereço
console.log("── A) casos sem endereço — fontes cruas ──");
for (const caso of resultado.casos.slice(0, 3)) {
  const ents = await ler("apolo_entities", `select=id,display_name,c2xSynced:metadata->>c2xSynced,cadastro:metadata->cadastro&document_masked=like.*${caso.cpf.slice(0, 3)}.${caso.cpf.slice(3, 6)}.${caso.cpf.slice(6, 9)}*`);
  const doCpf = ents.filter((e) => true);
  console.log(`\n${caso.nome} (${caso.cpf}) userId ${caso.userId}: ${doCpf.length} entidades`);
  for (const e of doCpf) {
    const fichas = await ler("apolo_esteira", `select=ficha&entity_id=eq.${e.id}`);
    const f = fichas[0]?.ficha ?? null;
    const endKeys = f ? ["logradouro", "cep", "cidade", "uf", "bairro", "numero"].map((k) => `${k}="${f[k] ?? ""}"`).join(" ") : "(sem ficha)";
    const cadEnd = e.cadastro ? ["logradouro", "cep", "cidade"].map((k) => `${k}="${e.cadastro[k] ?? ""}"`).join(" ") : "(sem cadastro)";
    const addrs = await ler("apolo_addresses", `select=street,postal_code,city&entity_id=eq.${e.id}`);
    console.log(`  ent ${e.id.slice(0, 8)} sync=${e.c2xSynced}: ficha[${endKeys}] cadastro[${cadEnd}] apolo_addresses=${JSON.stringify(addrs)}`);
  }
}

// B) 2 completos de controle + C) os 5 sem match
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});
console.log("\n── B) controle: 2 pessoas completas ──");
const limpo = (col) => `REPLACE(REPLACE(REPLACE(${col},'.',''),'-',''),'/','')`;
const [ok] = await c.query(
  `SELECT u.id, u.name, u.naturalness, u.mother_name, u.rg, u.civil_state_id, u.birthday,
          (SELECT CONCAT(a.address, ', ', COALESCE(a.number,'')) FROM addresses a WHERE a.ownertable_type='User' AND a.ownertable_id=u.id LIMIT 1) endr
     FROM users u WHERE ${limpo("u.cpf")} IN (?, ?)`,
  ["09794932698", "11974561631"],
);
console.log(JSON.stringify(ok, null, 1));

console.log("\n── C) os 5 sem match: existem no C2X por CPF? eram sincadas? ──");
for (const s of resultado.semMatch) {
  const [rows] = await c.query(`SELECT id, name FROM users WHERE ${limpo("cpf")} = ?`, [s.cpf]);
  const ents = await ler("apolo_entities", `select=id,created_at,c2xSynced:metadata->>c2xSynced,source:metadata->>source&document_masked=eq.${s.cpf.slice(0, 3)}.${s.cpf.slice(3, 6)}.${s.cpf.slice(6, 9)}-${s.cpf.slice(9)}`);
  console.log(`${s.nome} (${s.cpf}): users=${JSON.stringify(rows)} entidades=${JSON.stringify(ents)}`);
}
await c.end();
