// ESPELHO DO MASTERPLAN — mantém o VLO (35) refletindo o que acontece em VOC (37) e VOL (36).
//
// A ARQUITETURA (definida pelo Lucas, 03/08):
//   • VLO = o MASTERPLAN comercial. É o que os corretores enxergam: o Vale do Ouro INTEIRO,
//     298 unidades, com o status real de cada uma. Nunca é bloqueado em bloco.
//   • VOC (Cecílio) e VOL (Lino) = as carteiras FINANCEIRAS. Cada uma tem conta própria de
//     recebimento, então proposta e pagamento nascem no empreendimento específico.
//   • Logo: o status de venda VIVE em VOC/VOL e precisa VOLTAR para o VLO — senão o corretor
//     olha o masterplan e vê lote livre que já foi vendido (ou o inverso).
//
// O que este script faz: para cada unidade do VLO, copia `sale_status_id` e `sale_blocked` da
// unidade equivalente (mesma quadra+lote) em VOC/VOL. Nada mais é tocado — preço, matrícula,
// área e nome ficam intactos, e as propostas não são movidas.
//
// ⚠️ ESCRITA NO LEGADO: é a exceção autorizada para manter o espelho coerente. Só UPDATE de
// duas colunas, só nas 298 do VLO, e o ensaio é o padrão.
//
//   node scripts/apolo/espelhar-status-vale-do-ouro.mjs            (ensaio: só mostra o que mudaria)
//   node scripts/apolo/espelhar-status-vale-do-ouro.mjs --aplicar  (aplica)
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

const MASTERPLAN = 35;
const CARTEIRAS = [36, 37];
const aplicar = process.argv.includes("--aplicar");

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: +(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});

const chave = (b, l) => `${String(b).trim()}|${String(l).trim()}`;

const [carteira] = await c.query(
  `SELECT enterprise_id, block, lot, sale_status_id, sale_blocked
     FROM enterprise_unities WHERE enterprise_id IN (${CARTEIRAS.join(",")})`);
const porChave = new Map(carteira.map((u) => [chave(u.block, u.lot), u]));

const [master] = await c.query(
  `SELECT id, name, block, lot, sale_status_id, sale_blocked
     FROM enterprise_unities WHERE enterprise_id = ${MASTERPLAN}`);

const mudancas = [];
const semPar = [];
for (const u of master) {
  const par = porChave.get(chave(u.block, u.lot));
  if (!par) { semPar.push(u.name); continue; }
  if (par.sale_status_id !== u.sale_status_id || par.sale_blocked !== u.sale_blocked) {
    mudancas.push({ de: u.sale_status_id, id: u.id, nome: u.name, para: par.sale_status_id, blocked: par.sale_blocked });
  }
}

console.log(`Masterplan VLO: ${master.length} unidades · carteiras: ${carteira.length}`);
console.log(`Divergentes: ${mudancas.length}${semPar.length ? ` · sem par: ${semPar.length} (${semPar.slice(0, 3).join(", ")})` : ""}`);
for (const m of mudancas.slice(0, 15)) console.log(`  ${m.nome}: status ${m.de} -> ${m.para}`);
if (mudancas.length > 15) console.log(`  ... e mais ${mudancas.length - 15}`);

if (!aplicar) {
  console.log("\nENSAIO — nada foi escrito. Use --aplicar para espelhar.");
} else {
  for (const m of mudancas) {
    await c.query("UPDATE enterprise_unities SET sale_status_id = ?, sale_blocked = ? WHERE id = ?",
      [m.para, m.blocked, m.id]);
  }
  console.log(`\nAPLICADO: ${mudancas.length} unidades do masterplan atualizadas.`);
}

const [resumo] = await c.query(
  `SELECT e.code, ss.name status, COUNT(*) qtd
     FROM enterprise_unities eu
     JOIN enterprises e ON e.id = eu.enterprise_id
     LEFT JOIN sale_statuses ss ON ss.id = eu.sale_status_id
    WHERE eu.enterprise_id IN (${MASTERPLAN}, ${CARTEIRAS.join(",")})
    GROUP BY e.code, ss.name ORDER BY e.code, ss.name`);
console.table(resumo);

await c.end();
