// READ-ONLY. Extrai as VARIÁVEIS reais usadas nas minutas do C2X, para o catálogo do Temis nascer
// com o vocabulário que o jurídico já conhece — e não com nomes inventados por nós.
// Uso: node scripts/temis/variaveis-das-minutas.mjs
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
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});

const [cols] = await c.query(
  `select column_name, data_type from information_schema.columns
    where table_schema = ? and table_name = 'draft_contracts' order by ordinal_position`,
  [env.GUARDIAN_DB_NAME],
);
console.log("COLUNAS de draft_contracts:", cols.map((x) => `${x.COLUMN_NAME ?? x.column_name}`).join(", "));

const [minutas] = await c.query(
  `select dc.id, dc.name, length(dc.text) tamanho, dc.text
     from draft_contracts dc order by dc.id desc limit 60`,
);
console.log(`\n${minutas.length} minutas lidas.\n`);

const contagem = new Map();
const porMinuta = [];
for (const m of minutas) {
  const texto = String(m.text ?? "");
  const achados = [...texto.matchAll(/\[([a-zA-Z0-9_]{2,60})\]/g)].map((x) => x[1]);
  const unicas = new Set(achados);
  for (const v of achados) contagem.set(v, (contagem.get(v) ?? 0) + 1);
  porMinuta.push({ id: m.id, nome: m.name, tamanho: m.tamanho, variaveis: unicas.size });
}

for (const m of porMinuta) console.log(`#${m.id} · ${m.nome} · ${m.tamanho} chars · ${m.variaveis} variáveis`);

console.log(`\n=== CATÁLOGO (${contagem.size} variáveis distintas) ===`);
for (const [nome, n] of [...contagem.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(4)}x  [${nome}]`);
}
await c.end();
