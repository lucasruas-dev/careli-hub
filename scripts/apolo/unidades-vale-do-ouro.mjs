// Preenche a MATRÍCULA na planilha de unidades do Vale do Ouro e normaliza status e tipo para o
// que o C2X aceita. Não sobe nada: só gera a planilha conferida.
//
// Uso (da raiz do repo):
//   node scripts/apolo/unidades-vale-do-ouro.mjs
//
// Entradas:
//   ~/Downloads/Unidades - Vale do Ouro.xlsx     (quadra, lote, m², valor, tipo, status)
//   ~/Desktop/MATRICULAS_VALE_DO_OURO.csv        (quadra, lote, inscrição — extraído da certidão)
// Saída:
//   ~/Desktop/UNIDADES_VALE_DO_OURO_PREENCHIDA.xlsx
//
// A quadra vem escrita diferente nos dois lados: "1" na planilha, "P1" na certidão. O cruzamento é
// por quadra+lote e é ESTRITO: se sobrar ou faltar um par de qualquer lado, o script para e mostra
// quais. Matrícula errada aqui vira contrato errado.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(
  path.resolve(process.cwd(), "apps/hub/package.json"),
);
const ExcelJS = requireDoRepo("exceljs");

const casa = process.env.USERPROFILE || process.env.HOME || ".";
const ENTRADA_PLANILHA = path.join(casa, "Downloads", "Unidades - Vale do Ouro.xlsx");
const ENTRADA_MATRICULAS = path.join(casa, "Desktop", "MATRICULAS_VALE_DO_OURO.csv");
const SAIDA = path.join(casa, "Desktop", "UNIDADES_VALE_DO_OURO_PREENCHIDA.xlsx");

// ── status do C2X (tabela sale_statuses, lida no legado) ──────────────────
// 1 Disponível · 2 Reservado · 3 Em negociação · 4 Vendido · 5 Bloqueado para venda
//
// Regra do Lucas (01/08): "tudo que estiver diferente de disponível marcar como bloqueado". A
// planilha traz PERMUTA e AVALIAR, que não existem no C2X — viram bloqueado, mas o rótulo
// original fica numa coluna à parte para o time não perder o porquê.
const STATUS_DISPONIVEL = 1;
const STATUS_BLOQUEADO = 5;

// ── tipo da unidade (tabela enterprise_unity_types) ───────────────────────
// 1 Unidade interna · 2 Unidade externa
const TIPO_INTERNA = 1;
const TIPO_EXTERNA = 2;

const semAcento = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();

const valorDaCelula = (c) => {
  const v = c.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return String(v.result ?? v.text ?? "");
  return String(v);
};

// "R$  140.401,00" -> 140401.00 · "1" -> 1
const paraNumero = (bruto) => {
  const limpo = String(bruto ?? "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
};

// ── lê a certidão ─────────────────────────────────────────────────────────
const linhasCsv = fs
  .readFileSync(ENTRADA_MATRICULAS, "utf8")
  .replace(/^﻿/, "")
  .trim()
  .split("\n")
  .slice(1);

const porQuadraLote = new Map();
for (const linha of linhasCsv) {
  const [quadra, lote, matricula] = linha.split(";").map((s) => s.trim());
  // "P1" -> "1": a planilha escreve a quadra só com o número.
  const numeroDaQuadra = quadra.replace(/^P/i, "");
  porQuadraLote.set(`${numeroDaQuadra}|${lote}`, { matricula, quadraOriginal: quadra });
}
console.log(`Matrículas lidas: ${porQuadraLote.size}`);

// ── lê a planilha ─────────────────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(ENTRADA_PLANILHA);
const ws = wb.worksheets[0];

const unidades = [];
for (let i = 2; i <= ws.rowCount; i++) {
  const row = ws.getRow(i);
  const quadra = valorDaCelula(row.getCell(1)).trim();
  const lote = valorDaCelula(row.getCell(2)).trim();
  if (!quadra || !lote) continue;

  const statusBruto = valorDaCelula(row.getCell(7)).trim();
  const tipoBruto = valorDaCelula(row.getCell(6)).trim();
  const ehDisponivel = semAcento(statusBruto) === "DISPONIVEL";

  unidades.push({
    area: paraNumero(valorDaCelula(row.getCell(3))),
    ehDisponivel,
    linha: i,
    lote,
    quadra,
    statusBruto,
    statusId: ehDisponivel ? STATUS_DISPONIVEL : STATUS_BLOQUEADO,
    tipoBruto,
    tipoId: semAcento(tipoBruto).startsWith("INTERN") ? TIPO_INTERNA : TIPO_EXTERNA,
    valor: paraNumero(valorDaCelula(row.getCell(4))),
  });
}
console.log(`Unidades na planilha: ${unidades.length}`);

// ── cruzamento ESTRITO ────────────────────────────────────────────────────
const semMatricula = [];
const usadas = new Set();
for (const u of unidades) {
  const achado = porQuadraLote.get(`${u.quadra}|${u.lote}`);
  if (!achado) {
    semMatricula.push(u);
    continue;
  }
  u.matricula = achado.matricula;
  usadas.add(`${u.quadra}|${u.lote}`);
}
const sobrando = [...porQuadraLote.keys()].filter((k) => !usadas.has(k));

if (semMatricula.length > 0 || sobrando.length > 0) {
  console.error("\n⛔ O cruzamento NÃO fechou. Nada foi gerado.");
  if (semMatricula.length) {
    console.error(`\nNa planilha e SEM matrícula na certidão (${semMatricula.length}):`);
    for (const u of semMatricula.slice(0, 20)) console.error(`  quadra ${u.quadra} lote ${u.lote} (linha ${u.linha})`);
  }
  if (sobrando.length) {
    console.error(`\nNa certidão e SEM linha na planilha (${sobrando.length}):`);
    for (const k of sobrando.slice(0, 20)) console.error(`  quadra ${k.split("|")[0]} lote ${k.split("|")[1]}`);
  }
  process.exit(1);
}

// Duas matrículas iguais em lotes diferentes seria erro de leitura da certidão.
const repetidas = new Map();
for (const u of unidades) {
  if (!repetidas.has(u.matricula)) repetidas.set(u.matricula, []);
  repetidas.get(u.matricula).push(`Q${u.quadra}L${u.lote}`);
}
const duplicadas = [...repetidas.entries()].filter(([, ls]) => ls.length > 1);
if (duplicadas.length > 0) {
  console.error("\n⛔ Matrícula repetida em lotes diferentes. Nada foi gerado:");
  for (const [m, ls] of duplicadas) console.error(`  ${m} -> ${ls.join(", ")}`);
  process.exit(1);
}

// ── planilha de saída ─────────────────────────────────────────────────────
const saida = new ExcelJS.Workbook();
const aba = saida.addWorksheet("Unidades");
aba.columns = [
  { header: "Quadra", key: "quadra", width: 9 },
  { header: "Lote", key: "lote", width: 8 },
  { header: "M²", key: "area", width: 11 },
  { header: "Valor", key: "valor", width: 15 },
  { header: "Matrícula", key: "matricula", width: 14 },
  { header: "Tipo", key: "tipo", width: 11 },
  { header: "Tipo (id C2X)", key: "tipoId", width: 13 },
  { header: "Status", key: "status", width: 14 },
  { header: "Status (id C2X)", key: "statusId", width: 15 },
  { header: "Status original", key: "statusBruto", width: 16 },
];
aba.getRow(1).font = { bold: true };
aba.views = [{ state: "frozen", ySplit: 1 }];

// PADRÃO DA CASA: quadra e lote sempre com DOIS DÍGITOS ("1" vira "01"), como o C2X guarda e
// como sai no envio. Também é o que faz a ordenação ficar certa: sem isso o lote 10 vem antes do 2.
const doisDigitos = (v) => String(v).trim().padStart(2, "0");

for (const u of unidades) {
  aba.addRow({
    area: u.area,
    lote: doisDigitos(u.lote),
    matricula: u.matricula,
    quadra: doisDigitos(u.quadra),
    status: u.ehDisponivel ? "DISPONÍVEL" : "BLOQUEADO",
    statusBruto: u.statusBruto,
    statusId: u.statusId,
    tipo: u.tipoBruto,
    tipoId: u.tipoId,
    valor: u.valor,
  });
}
aba.getColumn("valor").numFmt = 'R$ #,##0.00';
aba.getColumn("area").numFmt = "0.00";

await saida.xlsx.writeFile(SAIDA);

// ── resumo ────────────────────────────────────────────────────────────────
const disponiveis = unidades.filter((u) => u.ehDisponivel).length;
const conta = (campo) =>
  unidades.reduce((acc, u) => ((acc[u[campo]] = (acc[u[campo]] ?? 0) + 1), acc), {});

console.log(`\n✅ Cruzamento fechado: ${unidades.length} unidades, todas com matrícula.`);
console.log(`\nStatus  → ${disponiveis} disponíveis · ${unidades.length - disponiveis} bloqueados`);
console.log(`  origem: ${JSON.stringify(conta("statusBruto"))}`);
console.log(`Tipo    → ${JSON.stringify(conta("tipoBruto"))}`);

const valorSuspeito = unidades.filter((u) => u.valor !== null && u.valor <= 1);
if (valorSuspeito.length > 0) {
  console.log(`\n⚠️  ${valorSuspeito.length} unidades com valor R$ 1,00 (todas não-disponíveis: ${valorSuspeito.every((u) => !u.ehDisponivel)}).`);
}
const semArea = unidades.filter((u) => !u.area);
if (semArea.length > 0) console.log(`⚠️  ${semArea.length} sem área.`);

console.log(`\nArquivo: ${SAIDA}`);
