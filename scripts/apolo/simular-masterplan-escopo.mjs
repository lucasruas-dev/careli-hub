// SIMULA O QUE CADA PORTAL VAI VER NO MASTERPLAN depois da correcao dinamica, repetindo o caminho
// da rota: estado do C2X -> aplicacao no arquivo -> recorte por escopo.
//
// A prova que importa: o mapa tem que dar o MESMO numero da tela de Vendas, que foi onde o Lucas
// achou a divergencia ("na tela de vendas esta correto, 91 vendidos, 2 disponivel e 48 bloqueado").
//
// ⚠️ READ-ONLY. ⚠️ Credencial do .env.local, nunca impressa.
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

const NOME = ["Disponivel", "Reservado", "Vendido", "Bloqueado"];
const chaveDoLote = (q, l) => {
  const n = Number(String(q).trim());
  return `${Number.isFinite(n) ? n : String(q).trim().toUpperCase()}-${String(l).trim().padStart(2, "0")}`;
};

// A MESMA regua de lib/apolo/incorporador/masterplan-estado.ts (situacaoDoMapa).
function situacaoDoMapa(statusId, bloqueado) {
  const s = Number(statusId ?? 0);
  if (s === 5 || Number(bloqueado ?? 0) === 1) return 3;
  if (s === 4 || s === 3) return 2;
  if (s === 2) return 1;
  return 0;
}

const html = fs.readFileSync("apps/hub/masterplans-internos/vale-do-ouro.html", "utf8");
const doArquivo = new Map();
for (const linha of html.split("\n")) {
  const m = linha.match(/^\[\s*(?:(\d+)|"([^"]+)")\s*,\s*"([^"]+)"\s*,\s*(\d+)/);
  if (m) doArquivo.set(chaveDoLote(m[1] ?? m[2], m[3]), Number(m[4]));
}

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});
const [linhas] = await c.query(
  `select e.code emp, u.block quadra, u.lot lote, u.sale_status_id status, u.sale_blocked bloqueado
     from enterprise_unities u join enterprises e on e.id = u.enterprise_id
    where e.code in ('VOL','VOC','VLO')`);
await c.end();

const porEmp = new Map();
for (const l of linhas) {
  if (!porEmp.has(l.emp)) porEmp.set(l.emp, new Map());
  porEmp.get(l.emp).set(chaveDoLote(l.quadra, l.lote), situacaoDoMapa(l.status, l.bloqueado));
}

const conta = (pares, qual) => {
  const c = {};
  for (const [chave, sit] of pares) {
    const v = qual === "mapa" ? doArquivo.get(chave) : sit;
    if (v === undefined) continue;
    c[NOME[v]] = (c[NOME[v]] || 0) + 1;
  }
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(" · ");
};

for (const emp of ["VOL", "VOC", "VLO"]) {
  const escopo = porEmp.get(emp);
  if (!escopo) continue;
  const noArquivo = [...escopo].filter(([k]) => doArquivo.has(k));
  const errados = noArquivo.filter(([k, sit]) => doArquivo.get(k) !== sit);

  console.log(`\n### ${emp} — ${escopo.size} unidades, ${noArquivo.length} desenhadas no mapa`);
  console.log(`   ANTES (arquivo de 11/08): ${conta(noArquivo, "mapa")}`);
  console.log(`   DEPOIS (C2X de agora)   : ${conta(noArquivo, "c2x")}`);
  console.log(`   lotes corrigidos        : ${errados.length}`);
  if (errados.length && errados.length <= 12) {
    for (const [k, sit] of errados) {
      console.log(`      ${k.padEnd(7)} ${NOME[doArquivo.get(k)].padEnd(11)} -> ${NOME[sit]}`);
    }
  }
}
