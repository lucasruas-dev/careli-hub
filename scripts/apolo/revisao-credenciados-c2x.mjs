// REVISÃO COMPLETA: todo credenciado do EVENTO (prometeu_credenciados, qualquer etapa) + todo
// mundo na etapa `credenciado` do Board está no C2X? Cruza pelo CPF/CNPJ NO BANCO do C2X — o
// carimbo local mente (lição de 01/08: 8 "success" que nunca chegaram lá).
//
// Uso (da raiz do repo):
//   node scripts/apolo/revisao-credenciados-c2x.mjs
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

const digitos = (v) => String(v ?? "").replace(/\D/g, "");

// ── 1. Os credenciados do EVENTO (todas as etapas; encerrado fica de fora) ──
console.log("Lendo os credenciados do evento...");
const doEvento = await ler(
  "prometeu_credenciados",
  "select=id,nome,documento,entity_id,etapa,imobiliaria&encerrado_em=is.null&limit=2000",
);

// ── 2. O Board (etapa credenciado) — pega quem ainda não entrou na fila do evento ──
const esteira = await ler("apolo_esteira", "select=entity_id,imobiliaria&etapa=eq.credenciado");
const entityIdsDoEvento = new Set(doEvento.map((c) => c.entity_id).filter(Boolean));
const soDoBoard = esteira.filter((e) => !entityIdsDoEvento.has(e.entity_id));

// ── 3. Documento: o do Prometeu; se faltar, o da entidade do Apolo ──
const precisamEntidade = [
  ...doEvento.filter((c) => c.entity_id && digitos(c.documento).length < 11),
  ...soDoBoard,
]
  .map((c) => c.entity_id)
  .filter(Boolean);
const entidades = [];
for (let i = 0; i < precisamEntidade.length; i += 100) {
  entidades.push(
    ...(await ler(
      "apolo_entities",
      `select=id,display_name,document_masked&id=in.(${precisamEntidade.slice(i, i + 100).join(",")})`,
    )),
  );
}
const entPorId = new Map(entidades.map((e) => [e.id, e]));

const alvos = [
  ...doEvento.map((c) => {
    const doc = digitos(c.documento) || digitos(entPorId.get(c.entity_id)?.document_masked);
    return {
      documento: doc,
      etapa: c.etapa,
      imobiliaria: c.imobiliaria ?? "(sem imobiliária)",
      nome: c.nome,
      origem: "evento",
    };
  }),
  ...soDoBoard.map((e) => ({
    documento: digitos(entPorId.get(e.entity_id)?.document_masked),
    etapa: "credenciado (board)",
    imobiliaria: e.imobiliaria ?? "(sem imobiliária)",
    nome: entPorId.get(e.entity_id)?.display_name ?? "(sem nome)",
    origem: "board",
  })),
];

const semDocumento = alvos.filter((a) => a.documento.length !== 11 && a.documento.length !== 14);
const comDocumento = alvos.filter((a) => a.documento.length === 11 || a.documento.length === 14);

// ── 4. O cruzamento, no banco do C2X ──
console.log(`Conferindo ${comDocumento.length} documentos no C2X (produção)...`);
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

const noC2x = new Map();
const docs = [...new Set(comDocumento.map((a) => a.documento))];
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

console.log(`\n${"=".repeat(60)}`);
console.log(`Revisados (evento ∪ board) .... ${alvos.length}`);
console.log(`  do evento (fila/etiquetas) .. ${alvos.filter((a) => a.origem === "evento").length}`);
console.log(`  só no Board ................. ${alvos.filter((a) => a.origem === "board").length}`);
console.log(`JÁ ESTÃO no C2X ............... ${presentes.length}`);
console.log(`NÃO estão no C2X .............. ${ausentes.length}`);
console.log(`Sem documento válido .......... ${semDocumento.length}`);
console.log("=".repeat(60));

if (ausentes.length) {
  console.log("\nAUSENTES NO C2X:");
  for (const a of ausentes) {
    console.log(`  ${a.nome} · ${a.documento} · ${a.etapa} · ${a.imobiliaria}`);
  }
}
if (semDocumento.length) {
  console.log("\nSEM DOCUMENTO VÁLIDO (impossível cruzar):");
  for (const a of semDocumento) {
    console.log(`  ${a.nome} · doc="${a.documento}" · ${a.etapa} · ${a.imobiliaria}`);
  }
}

const saida = path.join(process.env.USERPROFILE || ".", "Desktop", "REVISAO_C2X.json");
fs.writeFileSync(saida, JSON.stringify({ ausentes, semDocumento }, null, 1));
console.log(`\nLista completa: ${saida}`);
