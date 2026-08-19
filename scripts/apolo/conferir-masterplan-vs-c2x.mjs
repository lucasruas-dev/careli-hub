// CONFERENCIA read-only: a situacao do masterplan bate com o C2X?
//
// Pedido do Lucas (19/08/2026): "no masterplan o valor esta errado, me retorna 6 disponivel, e
// alguns lotes que realmente esta disponivel consta como vendido... teve cancelamento ontem que o
// masterplan nao atualizou".
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

// 1. O que o ARQUIVO diz.
const html = fs.readFileSync("apps/hub/public/masterplans/vale-do-ouro.html", "utf8");
const inicio = html.indexOf("const DADOS=[");
const corpo = html.slice(inicio, html.indexOf("];", inicio));
const doArquivo = new Map();
const contaArquivo = {};
for (const linha of corpo.split("\n")) {
  // [quadra, "lote", "situacao", area, valor, "comprador", "poligono"]
  const m = linha.match(/^\s*\[\s*("?)([^",]+)\1\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"/);
  if (!m) continue;
  const chave = `${String(m[2]).trim().toUpperCase()}-${String(m[3]).trim().padStart(2, "0")}`;
  const situacao = m[4].trim();
  doArquivo.set(chave, situacao);
  contaArquivo[situacao] = (contaArquivo[situacao] || 0) + 1;
}
console.log("### O ARQUIVO (gerado em 10/08): " + doArquivo.size + " lotes");
for (const [s, n] of Object.entries(contaArquivo).sort((a, b) => b[1] - a[1])) console.log("   " + String(n).padStart(4) + "  " + s);

// 2. O que o C2X diz AGORA.
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});
const [linhas] = await c.query(
  `select e.code emp, u.block quadra, u.lot lote, u.sale_blocked bloqueado,
          st.name estagio, ar.acquisition_request_stage_id estagio_id
     from enterprise_unities u
     join enterprises e on e.id = u.enterprise_id
     left join acquisition_requests ar on ar.id = (
       select ar2.id from acquisition_requests ar2
        where ar2.enterprise_unity_id = u.id order by ar2.created_at desc, ar2.id desc limit 1)
     left join acquisition_request_stages st on st.id = ar.acquisition_request_stage_id
    where e.code in ('VOL','VOC','VLO')`,
);
await c.end();

const contaC2x = {};
const divergentes = [];
for (const l of linhas) {
  const chave = `${String(l.quadra).trim().toUpperCase()}-${String(l.lote).trim().padStart(2, "0")}`;
  // A mesma regua da tela de Vendas: sem proposta viva = disponivel; bloqueado tem prioridade.
  const estagio = Number(l.estagio_id ?? 0);
  const vendido = [4, 5, 3, 9].includes(estagio);
  const atual = vendido ? "Vendido" : l.bloqueado ? "Bloqueado" : "Disponivel";
  contaC2x[atual] = (contaC2x[atual] || 0) + 1;

  const noArquivo = doArquivo.get(chave);
  if (noArquivo && noArquivo.toLowerCase().slice(0, 5) !== atual.toLowerCase().slice(0, 5)) {
    divergentes.push({ atual, chave, emp: l.emp, estagio: l.estagio, noArquivo });
  }
}
console.log("\n### O C2X AGORA (VOL+VOC+VLO): " + linhas.length + " unidades");
for (const [s, n] of Object.entries(contaC2x).sort((a, b) => b[1] - a[1])) console.log("   " + String(n).padStart(4) + "  " + s);

console.log("\n### DIVERGENCIAS: " + divergentes.length);
for (const d of divergentes.slice(0, 25)) {
  console.log("   " + d.chave.padEnd(8) + " " + d.emp + "  arquivo=" + d.noArquivo.padEnd(12) + " c2x=" + d.atual.padEnd(11) + " (" + (d.estagio ?? "sem proposta") + ")");
}
if (divergentes.length > 25) console.log("   ... e mais " + (divergentes.length - 25));
