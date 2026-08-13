// ESTUDO das tabelas de CONTRATO e ASSINATURA no C2X (leitura pura).
//
// Objetivo: entender estrutura, relações e como os dados REALMENTE estão preenchidos, para
// montar o painel do cenário de assinatura do Vale do Ouro (VLO 35, VOL 36, VOC 37).
//
// ⚠️ READ-ONLY. Uma conexão só, consultas sequenciais: o C2X tem `max_connections` escasso.
//
//   node scripts/apolo/estudo-assinaturas-c2x.mjs <pasta-de-saida>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

const saida = process.argv[2];
if (!saida) { console.error("informe a pasta de saída"); process.exit(1); }
fs.mkdirSync(saida, { recursive: true });

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: +(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});

const banco = env.GUARDIAN_DB_NAME;
const linhas = [];
const diz = (t) => { linhas.push(t); console.log(t); };

// ── 1. QUAIS TABELAS EXISTEM nesse território ────────────────────────────────
const [tabelas] = await c.query(
  `select table_name, table_rows, table_comment
     from information_schema.tables
    where table_schema = ?
      and (table_name like '%contract%' or table_name like '%signat%' or table_name like '%signer%')
    order by table_name`, [banco],
);
diz("## TABELAS DO TERRITÓRIO CONTRATO/ASSINATURA\n");
for (const t of tabelas) diz(`- ${t.TABLE_NAME}  (~${t.TABLE_ROWS} linhas)  ${t.TABLE_COMMENT || ""}`);

const nomes = tabelas.map((t) => t.TABLE_NAME);

// ── 2. ESTRUTURA de cada uma ─────────────────────────────────────────────────
diz("\n\n## ESTRUTURA\n");
for (const nome of nomes) {
  const [cols] = await c.query(
    `select column_name, column_type, is_nullable, column_default, column_comment
       from information_schema.columns
      where table_schema = ? and table_name = ? order by ordinal_position`, [banco, nome],
  );
  const [[{ n: total }]] = await c.query(`select count(*) as n from \`${nome}\``);
  diz(`\n### ${nome} — ${total} linhas`);
  for (const col of cols) {
    diz(`  ${col.COLUMN_NAME.padEnd(34)} ${col.COLUMN_TYPE.padEnd(20)} ${col.IS_NULLABLE === "YES" ? "NULL" : "not null"}  ${col.COLUMN_COMMENT || ""}`);
  }
}

// ── 3. CHAVES ESTRANGEIRAS declaradas (as duas direções) ─────────────────────
diz("\n\n## CHAVES ESTRANGEIRAS DECLARADAS\n");
const [fks] = await c.query(
  `select table_name, column_name, referenced_table_name, referenced_column_name, constraint_name
     from information_schema.key_column_usage
    where table_schema = ? and referenced_table_name is not null
      and (table_name in (?) or referenced_table_name in (?))
    order by table_name, column_name`, [banco, nomes, nomes],
);
for (const f of fks) {
  diz(`  ${f.TABLE_NAME}.${f.COLUMN_NAME} -> ${f.REFERENCED_TABLE_NAME}.${f.REFERENCED_COLUMN_NAME}`);
}
if (!fks.length) diz("  (nenhuma FK declarada — as ligações são por convenção de nome)");

// ── 4. TABELAS DE DOMÍNIO por extenso ────────────────────────────────────────
diz("\n\n## DOMÍNIOS\n");
for (const nome of nomes.filter((n) => n.endsWith("_statuses") || n.endsWith("_types"))) {
  const [rows] = await c.query(`select * from \`${nome}\` order by id`);
  diz(`\n### ${nome}`);
  for (const r of rows) diz(`  ${JSON.stringify(r)}`);
}

await c.end();
fs.writeFileSync(path.join(saida, "01-schema.md"), linhas.join("\n"), "utf8");
console.log(`\n\nescrito em ${path.join(saida, "01-schema.md")}`);
