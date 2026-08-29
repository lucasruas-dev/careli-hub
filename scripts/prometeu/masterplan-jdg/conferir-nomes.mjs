// CONFERE os nomes do masterplan do JDG contra as unidades carregadas no C2X.
//
// ⚠️ POR QUE ISTO EXISTE. Um path com nome errado NAO QUEBRA NADA: ele so nunca pinta. O erro
// aparece no dia do evento, com o telao projetado e um lote teimando em ficar cinza no meio do
// salao. E a mesma regra escrita em lib/prometeu/desenho-do-masterplan.ts, aqui virada em
// verificacao automatica.
//
// Uso (da raiz do repo), DEPOIS que as unidades do JDG estiverem no C2X:
//   node scripts/prometeu/masterplan-jdg/conferir-nomes.mjs
//
// So LEITURA do legado.

import fs from "node:fs";
import mysql from "mysql2/promise";

const CODE = "JDG";
const CONTORNOS = "apps/hub/public/masterplans-telao/jardim-das-gerais-lotes.json";

const texto = fs.readFileSync("apps/hub/.env.local", "utf8");
const env = {};
for (const linha of texto.split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const pool = mysql.createPool({
  connectionLimit: 2,
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

const [linhas] = await pool.query(
  `select u.name, u.block, u.lot
     from enterprise_unities u
     join enterprises e on e.id = u.enterprise_id
    where e.code = ?`,
  [CODE],
);
await pool.end();

const noC2x = new Set(linhas.map((l) => String(l.name ?? "").trim().toUpperCase()));
const noMapa = new Set(Object.keys(JSON.parse(fs.readFileSync(CONTORNOS, "utf8"))));

const semMapa = [...noC2x].filter((n) => n && !noMapa.has(n)).sort();
const semUnidade = [...noMapa].filter((n) => !noC2x.has(n)).sort();

console.log(`unidades no C2X: ${noC2x.size}`);
console.log(`lotes no mapa:   ${noMapa.size}`);
console.log(`casam:           ${[...noMapa].filter((n) => noC2x.has(n)).length}`);

// Estes sao os graves: a unidade existe, o corretor vai procurar no telao e nao acha.
console.log(`\nNO C2X E SEM DESENHO (${semMapa.length}) - ficam cinza no telao:`);
console.log(semMapa.length ? "  " + semMapa.join(", ") : "  nenhum");

// Estes sao inofensivos no telao, mas denunciam nome divergente ou lote que sumiu da carga.
console.log(`\nDESENHADOS E SEM UNIDADE (${semUnidade.length}):`);
console.log(semUnidade.length ? "  " + semUnidade.join(", ") : "  nenhum");

if (linhas.length) {
  const exemplo = linhas.slice(0, 3).map((l) => `${l.name} (q=${l.block} l=${l.lot})`);
  console.log(`\namostra do C2X: ${exemplo.join(" | ")}`);
} else {
  console.log(`\n⚠️ O C2X ainda nao tem NENHUMA unidade em ${CODE} - a carga nao foi feita.`);
}
