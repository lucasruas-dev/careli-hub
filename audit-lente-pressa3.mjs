// AUDITORIA 3 (leitura apenas): confirmar valores no C2X (users.email + tabela phones)
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

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});
const limpo = (col) => `REPLACE(REPLACE(REPLACE(${col},'.',''),'-',''),'/','')`;

// 1. users.email dos casos suspeitos
const suspeitos = [
  "70642734623", "11535955678", "79298044615", "13899823605", "95750347672",
  "15358341617", "00545253659", "14742728602", "06317261601", "08426439667",
  "12788471629", "01316899675", "10834495678",
];
const marcas = suspeitos.map(() => "?").join(",");
const [rows] = await c.query(
  `SELECT id, name, ${limpo("cpf")} cpf_limpo, email FROM users WHERE ${limpo("cpf")} IN (${marcas})`,
  suspeitos,
);
console.log("== users.email dos suspeitos:");
for (const r of rows) console.log(` ${r.name} | ${r.cpf_limpo} | email C2X: "${r.email}"`);

// 2. universo completo -> phones do C2X
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
const universo = [...porId.values()];
const docs = [...new Set(universo.map((e) => digitos(e.document_masked)).filter((d) => d.length === 11 || d.length === 14))];
const userPorDoc = new Map();
const nomePorUid = new Map();
for (let i = 0; i < docs.length; i += 200) {
  const bloco = docs.slice(i, i + 200);
  const m = bloco.map(() => "?").join(",");
  const [us] = await c.query(
    `SELECT id, name, ${limpo("cpf")} cpf_limpo, ${limpo("cnpj")} cnpj_limpo, email FROM users
      WHERE ${limpo("cpf")} IN (${m}) OR ${limpo("cnpj")} IN (${m})`,
    [...bloco, ...bloco],
  );
  for (const u of us) {
    userPorDoc.set(u.cpf_limpo || u.cnpj_limpo, u);
    nomePorUid.set(u.id, { nome: u.name, doc: u.cpf_limpo || u.cnpj_limpo });
  }
}
const uids = [...nomePorUid.keys()];
const fonesPorUser = new Map();
for (let i = 0; i < uids.length; i += 300) {
  const bloco = uids.slice(i, i + 300);
  const m = bloco.map(() => "?").join(",");
  const [ph] = await c.query(
    `SELECT ownertable_id uid, phone_code, phone FROM phones WHERE ownertable_type='User' AND ownertable_id IN (${m})`,
    bloco,
  );
  for (const p of ph) {
    if (!fonesPorUser.has(p.uid)) fonesPorUser.set(p.uid, []);
    fonesPorUser.get(p.uid).push(`${p.phone_code ?? ""}${p.phone ?? ""}`);
  }
}
console.log(`== users com phone no C2X (tabela phones): ${fonesPorUser.size} de ${uids.length}`);
// sem NENHUM telefone no C2X
const semFone = uids.filter((u) => !fonesPorUser.has(u));
console.log(`== users SEM nenhum telefone no C2X: ${semFone.length}`);
for (const u of semFone.slice(0, 30)) console.log("  ", nomePorUid.get(u).nome, "|", nomePorUid.get(u).doc);

// telefones invalidos no C2X
console.log("== telefones invalidos na tabela phones (C2X):");
const foneRepet = new Map();
for (const [uid, fs2] of fonesPorUser) {
  for (const f of fs2) {
    const d = digitos(f);
    const quem = nomePorUid.get(uid);
    if (d.length < 10 || d.length > 13) console.log(`  ${quem.nome} | ${quem.doc} | phone C2X: "${f}" (${d.length} digitos)`);
    else if (/^(\d)\1+$/.test(d.slice(-9))) console.log(`  ${quem.nome} | ${quem.doc} | phone C2X: "${f}" (digitos repetidos)`);
    if (d.length >= 10) {
      if (!foneRepet.has(d)) foneRepet.set(d, new Set());
      foneRepet.get(d).add(uid);
    }
  }
}
console.log("== telefones repetidos entre users no C2X:");
for (const [f, s] of foneRepet)
  if (s.size >= 2) console.log(`  ${f} → ${[...s].map((u) => `${nomePorUid.get(u).nome}|${nomePorUid.get(u).doc}`).join(" ; ")}`);

// emails repetidos entre users no C2X (universo)
const emailRepet = new Map();
for (const u of userPorDoc.values()) {
  const em = (u.email ?? "").toLowerCase().trim();
  if (!em) continue;
  if (!emailRepet.has(em)) emailRepet.set(em, new Set());
  emailRepet.get(em).add(u.id);
}
console.log("== emails repetidos entre users no C2X:");
for (const [em, s] of emailRepet)
  if (s.size >= 2) console.log(`  ${em} → ${[...s].map((u) => `${nomePorUid.get(u)?.nome}|${nomePorUid.get(u)?.doc}`).join(" ; ")}`);

// schoolings + salary_ranges nomes
const [sch] = await c.query("SELECT id, name FROM schoolings");
console.log("== schoolings:", JSON.stringify(sch));
await c.end();
