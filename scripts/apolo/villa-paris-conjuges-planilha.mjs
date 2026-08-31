// A LISTA DE TRABALHO: os cônjuges do Villa Paris cujo dado não existe em lugar nenhum.
//
// O conserto do código faz o próximo cadastro subir completo, mas não inventa o que ninguém
// digitou. Estes onze precisam ser perguntados — e SEIS deles travam contrato JÁ GERADO.
//
// Gera um .xlsx com as duas colunas a preencher destacadas, para o time devolver preenchido.
//
// Uso (da raiz do repo):
//   node scripts/apolo/villa-paris-conjuges-planilha.mjs
//
// ⚠️ SÓ LEITURA no banco. O arquivo sai em Downloads.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");
const ExcelJS = requireDoRepo("exceljs");

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

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

const [linhas] = await c.query(
  `select distinct sp.id as spouse_id, sp.name as conjuge, sp.cpf as conjuge_cpf,
          sp.nacionality, sp.profession_id,
          u.id as titular_id, u.name as titular, u.cpf as titular_cpf,
          s.name as etapa, un.name as unidade
     from spouses sp
     join users u on u.id = sp.ownertable_id and sp.ownertable_type = 'User'
     join acquisition_requests ar on ar.client_id = u.id
     join enterprise_unities un on un.id = ar.enterprise_unity_id
     left join acquisition_request_stages s on s.id = ar.acquisition_request_stage_id
    where un.enterprise_id = 38
    order by s.name desc, u.name`,
);

const vazio = (v) => !String(v ?? "").trim();
const semProfissao = (l) => !l.profession_id || Number(l.profession_id) === 25;

// Uma linha por CÔNJUGE, não por unidade: o mesmo casal aparece em várias unidades e perguntar
// duas vezes a mesma coisa queima a paciência do cliente. As unidades entram juntas na linha.
const porConjuge = new Map();
for (const l of linhas) {
  if (!vazio(l.nacionality) && !semProfissao(l)) continue;
  const atual = porConjuge.get(l.spouse_id);
  if (atual) {
    if (!atual.unidades.includes(l.unidade)) atual.unidades.push(l.unidade);
    // "Contrato gerado" manda na urgência da linha.
    if (l.etapa === "Contrato gerado") atual.etapa = l.etapa;
    continue;
  }
  porConjuge.set(l.spouse_id, { ...l, unidades: [l.unidade] });
}

const pendentes = [...porConjuge.values()].sort((a, b) => {
  const peso = (x) => (x.etapa === "Contrato gerado" ? 0 : 1);
  return peso(a) - peso(b) || String(a.titular).localeCompare(String(b.titular));
});

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Cônjuges a completar");

ws.columns = [
  { header: "Urgência", key: "urgencia", width: 17 },
  { header: "Unidade(s)", key: "unidades", width: 16 },
  { header: "Comprador (titular)", key: "titular", width: 32 },
  { header: "CPF do titular", key: "titularCpf", width: 17 },
  { header: "Cônjuge", key: "conjuge", width: 32 },
  { header: "CPF do cônjuge", key: "conjugeCpf", width: 17 },
  { header: "NACIONALIDADE (preencher)", key: "nacionalidade", width: 26 },
  { header: "PROFISSÃO (preencher)", key: "profissao", width: 26 },
];

ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2C2C2A" } };
ws.getRow(1).alignment = { vertical: "middle", wrapText: true };
ws.getRow(1).height = 30;

for (const p of pendentes) {
  const urgente = p.etapa === "Contrato gerado";
  const linha = ws.addRow({
    urgencia: urgente ? "CONTRATO GERADO" : p.etapa,
    unidades: p.unidades.join(", "),
    titular: p.titular,
    titularCpf: p.titular_cpf,
    conjuge: p.conjuge,
    conjugeCpf: p.conjuge_cpf,
    nacionalidade: vazio(p.nacionality) ? "" : p.nacionality,
    profissao: semProfissao(p) ? "" : "(já tem)",
  });
  if (urgente) {
    linha.getCell("urgencia").font = { bold: true, color: { argb: "FFB91C1C" } };
  }
  // As duas colunas a preencher ficam amarelas — mesmo padrão da planilha de CPF.
  for (const key of ["nacionalidade", "profissao"]) {
    linha.getCell(key).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3C4" } };
    linha.getCell(key).border = {
      top: { style: "thin", color: { argb: "FFD4B106" } },
      left: { style: "thin", color: { argb: "FFD4B106" } },
      bottom: { style: "thin", color: { argb: "FFD4B106" } },
      right: { style: "thin", color: { argb: "FFD4B106" } },
    };
  }
}

ws.autoFilter = { from: "A1", to: "H1" };
ws.views = [{ state: "frozen", ySplit: 1 }];

const destino = path.join(os.homedir(), "Downloads", "Villa-Paris-conjuges-a-completar.xlsx");
await wb.xlsx.writeFile(destino);

const urgentes = pendentes.filter((p) => p.etapa === "Contrato gerado").length;
console.log(`Cônjuges a completar: ${pendentes.length} (${urgentes} em contrato JÁ GERADO)`);
console.log(`Arquivo: ${destino}`);

await c.end();
