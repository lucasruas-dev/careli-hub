// AUDITORIA 2 (leitura apenas): aprofundamento dos sinais
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

const achadosPrev = JSON.parse(fs.readFileSync("audit-lente-pressa-out.json", "utf8"));
console.log("== c_contato (8):");
console.log(JSON.stringify(achadosPrev.c_contato, null, 1));

// universo de novo
const SEL = "id,display_name,entity_kind,document_masked,created_at,metadata";
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
const todosIds = universo.map((e) => e.id);

// fichas
const fichaPorEntidade = new Map();
const contatosPorEntidade = new Map();
for (let i = 0; i < todosIds.length; i += 100) {
  const bloco = todosIds.slice(i, i + 100).join(",");
  const est = await ler("apolo_esteira", `select=entity_id,etapa,ficha&entity_id=in.(${bloco})`);
  for (const r of est) fichaPorEntidade.set(r.entity_id, r);
  const cts = await ler(
    "apolo_contacts",
    `select=entity_id,contact_type,value,normalized_value&entity_id=in.(${bloco})`,
  );
  for (const r of cts) {
    if (!contatosPorEntidade.has(r.entity_id)) contatosPorEntidade.set(r.entity_id, []);
    contatosPorEntidade.get(r.entity_id).push(r);
  }
}

// contatos duplicados ENTRE entidades diferentes (Apolo)
const porEmail = new Map();
const porFone = new Map();
for (const e of universo) {
  for (const ct of contatosPorEntidade.get(e.id) ?? []) {
    const v = (ct.normalized_value || ct.value || "").toLowerCase().trim();
    if (!v) continue;
    if (ct.contact_type === "email") {
      if (!porEmail.has(v)) porEmail.set(v, new Set());
      porEmail.get(v).add(`${e.display_name}|${digitos(e.document_masked)}`);
    } else {
      const f = digitos(v);
      if (f.length >= 10) {
        if (!porFone.has(f)) porFone.set(f, new Set());
        porFone.get(f).add(`${e.display_name}|${digitos(e.document_masked)}`);
      }
    }
  }
}
console.log("== emails repetidos entre entidades (Apolo):");
for (const [v, s] of porEmail) if (s.size >= 2) console.log(" ", v, "→", [...s].join(" ; "));
console.log("== fones repetidos entre entidades (Apolo):");
for (const [v, s] of porFone) if (s.size >= 2) console.log(" ", v, "→", [...s].join(" ; "));

// ── C2X ──
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});
const limpo = (col) => `REPLACE(REPLACE(REPLACE(${col},'.',''),'-',''),'/','')`;
const [civil] = await c.query("SELECT id, name FROM civil_states");
console.log("== civil_states:", JSON.stringify(civil));
const [regimes] = await c.query("SELECT id, name FROM property_regimes");
console.log("== property_regimes:", JSON.stringify(regimes));

const docsUniverso = [...new Set(universo.map((e) => digitos(e.document_masked)).filter((d) => d.length === 11 || d.length === 14))];
const users = [];
for (let i = 0; i < docsUniverso.length; i += 200) {
  const bloco = docsUniverso.slice(i, i + 200);
  const marcas = bloco.map(() => "?").join(",");
  const [rows] = await c.query(
    `SELECT id, name, ${limpo("cpf")} cpf_limpo, ${limpo("cnpj")} cnpj_limpo, email, cellphone,
            birthday, mother_name, civil_state_id, property_regime_id, created_at
       FROM users
      WHERE ${limpo("cpf")} IN (${marcas}) OR ${limpo("cnpj")} IN (${marcas})`,
    [...bloco, ...bloco],
  );
  users.push(...rows);
}
const uIds = users.map((u) => u.id);
const marcasU = uIds.map(() => "?").join(",");
const [sp] = await c.query(
  `SELECT ownertable_id uid, name, cpf FROM spouses WHERE ownertable_type='User' AND ownertable_id IN (${marcasU})`,
  uIds,
);
const spousePorUser = new Map(sp.map((s) => [s.uid, s]));
console.log(`== users=${users.length}, com spouse no C2X=${sp.length}`);

const nomeCivil = new Map(civil.map((r) => [r.id, r.name]));
// contradicao: solteiro no C2X mas com spouse OU ficha dizendo casado
const fichaPorDoc = new Map();
for (const e of universo) {
  const fic = fichaPorEntidade.get(e.id)?.ficha ?? {};
  const cad = e.metadata?.cadastro ?? {};
  fichaPorDoc.set(digitos(e.document_masked), {
    nome: e.display_name,
    estadoCivilId: fic.estadoCivilId ?? cad.estadoCivilId ?? null,
    dataNascimento: fic.dataNascimento ?? cad.dataNascimento ?? null,
  });
}
let contradSpouse = [];
let regimeSolteiro = [];
let fichaDiverge = [];
for (const u of users) {
  const doc = u.cpf_limpo || u.cnpj_limpo;
  const f = fichaPorDoc.get(doc);
  const estC2x = nomeCivil.get(u.civil_state_id) ?? String(u.civil_state_id);
  const spo = spousePorUser.get(u.id);
  const solteiroC2x = u.civil_state_id === 1;
  if (solteiroC2x && spo) contradSpouse.push({ nome: u.name, doc, c2x: estC2x, spouse: spo.name });
  if (solteiroC2x && u.property_regime_id) regimeSolteiro.push({ nome: u.name, doc, regime: u.property_regime_id });
  if (f?.estadoCivilId && String(f.estadoCivilId) !== String(u.civil_state_id)) {
    fichaDiverge.push({ nome: u.name, doc, c2x: `${u.civil_state_id} (${estC2x})`, ficha: String(f.estadoCivilId) });
  }
}
console.log("== solteiro no C2X + spouse cadastrado:", JSON.stringify(contradSpouse, null, 1));
console.log("== solteiro no C2X + regime de bens preenchido:", regimeSolteiro.length, JSON.stringify(regimeSolteiro.slice(0, 20)));
console.log("== estado civil ficha != C2X:", fichaDiverge.length, JSON.stringify(fichaDiverge.slice(0, 30), null, 1));

// trio 1990-01-19: birthday no C2X
const trio = ["09794932698", "08608766671", "10134579607"];
for (const u of users.filter((x) => trio.includes(x.cpf_limpo))) {
  const f = fichaPorDoc.get(u.cpf_limpo);
  console.log("TRIO:", u.name, u.cpf_limpo, "C2X birthday=", u.birthday, "ficha=", f?.dataNascimento);
}

// sanity check (d): min/max idade no C2X
const idades = users
  .filter((u) => u.birthday)
  .map((u) => (Date.parse("2026-08-01") - +new Date(u.birthday)) / (365.25 * 864e5));
idades.sort((a, b) => a - b);
console.log(`== idades C2X: n=${idades.length} min=${idades[0]?.toFixed(1)} max=${idades[idades.length - 1]?.toFixed(1)}`);
const semBirthday = users.filter((u) => !u.birthday && u.cpf_limpo).map((u) => `${u.name}|${u.cpf_limpo}`);
console.log("== PF sem birthday no C2X:", semBirthday.length, semBirthday.slice(0, 10));
// nascimento igual no C2X entre 3+ users
const porNasc = new Map();
for (const u of users.filter((x) => x.birthday && x.cpf_limpo)) {
  const k = new Date(u.birthday).toISOString().slice(0, 10);
  if (!porNasc.has(k)) porNasc.set(k, []);
  porNasc.get(k).push(`${u.name}|${u.cpf_limpo}`);
}
console.log("== birthday repetido 3+ no C2X:");
for (const [k, xs] of porNasc) if (xs.length >= 3) console.log(" ", k, "→", xs.join(" ; "));
// email vazio no C2X (contexto de pressa)
const semEmail = users.filter((u) => !(u.email ?? "").trim());
const semCell = users.filter((u) => !digitos(u.cellphone));
console.log(`== users sem email no C2X: ${semEmail.length}; sem cellphone: ${semCell.length}`);
await c.end();
