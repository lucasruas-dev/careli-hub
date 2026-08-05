// CHECK: todo credenciado do Board está no C2X? Cruza pelo CPF/CNPJ, no banco do C2X, não no
// nosso carimbo — a lição de 01/08, quando 8 cadastros responderam "success" e nunca chegaram lá.
//
// Uso (da raiz do repo):
//   node scripts/apolo/check-credenciados-no-c2x.mjs
//
// Só LEITURA nos dois lados.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");

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

console.log("Lendo os credenciados do Board...");
const esteira = await ler("apolo_esteira", "select=entity_id,imobiliaria,corretor&etapa=eq.credenciado");
const ids = esteira.map((e) => e.entity_id);

// Em blocos de 100: `in` com centenas de uuids estoura a URL do PostgREST.
const entidades = [];
for (let i = 0; i < ids.length; i += 100) {
  entidades.push(
    ...(await ler(
      "apolo_entities",
      `select=id,display_name,document_masked,metadata&id=in.(${ids.slice(i, i + 100).join(",")})`,
    )),
  );
}
const porId = new Map(entidades.map((e) => [e.id, e]));
console.log(`Credenciados no Board: ${esteira.length}`);

const digitos = (v) => String(v ?? "").replace(/\D/g, "");
const alvos = esteira
  .map((e) => {
    const ent = porId.get(e.entity_id);
    return {
      documento: digitos(ent?.document_masked),
      entityId: e.entity_id,
      imobiliaria: e.imobiliaria,
      nome: ent?.display_name ?? "",
      sincronizadoNoApolo: ent?.metadata?.c2xSynced === true,
    };
  })
  .filter((a) => a.nome);

const semDocumento = alvos.filter((a) => a.documento.length !== 11 && a.documento.length !== 14);
const comDocumento = alvos.filter((a) => a.documento.length === 11 || a.documento.length === 14);

console.log("Conferindo no C2X (produção)...");
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

const noC2x = new Map();
const docs = comDocumento.map((a) => a.documento);
const limpo = (col) => `REPLACE(REPLACE(REPLACE(${col},'.',''),'-',''),'/','')`;
for (let i = 0; i < docs.length; i += 200) {
  const bloco = docs.slice(i, i + 200);
  const marcas = bloco.map(() => "?").join(",");
  const [rows] = await c.query(
    `SELECT id, name, ${limpo("cpf")} d1, ${limpo("cnpj")} d2
       FROM users
      WHERE ${limpo("cpf")} IN (${marcas}) OR ${limpo("cnpj")} IN (${marcas})`,
    [...bloco, ...bloco],
  );
  for (const r of rows) {
    if (r.d1) noC2x.set(r.d1, r.id);
    if (r.d2) noC2x.set(r.d2, r.id);
  }
}
await c.end();

const presentes = comDocumento.filter((a) => noC2x.has(a.documento));
const ausentes = comDocumento.filter((a) => !noC2x.has(a.documento));
// O caso que mais dói: o Apolo diz que subiu, mas no C2X não está.
const mentirosos = ausentes.filter((a) => a.sincronizadoNoApolo);

console.log(`\n${"=".repeat(58)}`);
console.log(`Credenciados no Board ......... ${alvos.length}`);
console.log(`JÁ ESTÃO no C2X ............... ${presentes.length}`);
console.log(`NÃO estão no C2X .............. ${ausentes.length}`);
console.log(`  destes, o Apolo diz que subiu: ${mentirosos.length}  ${mentirosos.length ? "⚠️" : ""}`);
console.log(`Sem documento válido .......... ${semDocumento.length}`);
console.log("=".repeat(58));

if (mentirosos.length > 0) {
  console.log("\n⚠️  MARCADOS COMO SINCRONIZADOS MAS AUSENTES NO C2X:");
  for (const m of mentirosos.slice(0, 20)) console.log(`  ${m.nome} · ${m.documento}`);
}

if (ausentes.length > 0) {
  const porImob = {};
  for (const a of ausentes) porImob[a.imobiliaria ?? "(sem imobiliária)"] = (porImob[a.imobiliaria ?? "(sem imobiliária)"] ?? 0) + 1;
  console.log("\nAUSENTES por imobiliária:");
  for (const [imob, n] of Object.entries(porImob).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)} · ${imob}`);
  }
  fs.writeFileSync(
    path.join(process.env.USERPROFILE || ".", "Desktop", "AUSENTES_NO_C2X.json"),
    JSON.stringify(ausentes, null, 1),
  );
  console.log(`\nLista completa: Desktop/AUSENTES_NO_C2X.json`);
}
